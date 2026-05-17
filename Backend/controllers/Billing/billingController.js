// controllers/billingController.js
// ═══════════════════════════════════════════════════════════════
// Controller sirf karta hai:
//   1. Request validate karo (required fields check)
//   2. Service call karo
//   3. HTTP response bhejo
// Koi bhi DB access, calculation, ya business rule yahan nahi
// ═══════════════════════════════════════════════════════════════

const billingService = require("../../services/Billing/billingService");
const BillingService = require("../../services/Billing/billingService");

// ── GET /api/billing/uhid/:UHID ───────────────────────────────
exports.getBillsByUHID = async (req, res) => {
  try {
    const data = await billingService.getPatientWithBills(req.params.UHID);
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/create ──────────────────────────────────
exports.getOrCreateBill = async (req, res) => {
  try {
    const { UHID, visitType, admissionId } = req.body;
    if (!UHID || !visitType) {
      return res
        .status(400)
        .json({ success: false, message: "UHID and visitType required" });
    }

    const data = await billingService.getDraftBillPopulated(
      UHID,
      visitType,
      admissionId,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ── GET /api/billing/:billId ──────────────────────────────────
exports.getBillById = async (req, res) => {
  try {
    const data = await billingService.getBillById(req.params.billId);
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message === "Bill not found" ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/:billId/add-service ─────────────────────
exports.addService = async (req, res) => {
  try {
    const { serviceId, quantity = 1, chargeDate, remarks } = req.body;
    if (!serviceId) {
      return res
        .status(400)
        .json({ success: false, message: "serviceId required" });
    }

    const data = await billingService.addServiceToBill(
      req.params.billId,
      serviceId,
      quantity,
      chargeDate ? new Date(chargeDate) : new Date(),
      remarks,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ── DELETE /api/billing/:billId/items/:itemId ─────────────────
exports.removeItem = async (req, res) => {
  try {
    const data = await billingService.removeItemFromBill(
      req.params.billId,
      req.params.itemId,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ── PUT /api/billing/:billId/items/:itemId ────────────────────
exports.updateItemQty = async (req, res) => {
  try {
    if (!req.body.quantity) {
      return res
        .status(400)
        .json({ success: false, message: "quantity required" });
    }

    const data = await billingService.updateItemQuantity(
      req.params.billId,
      req.params.itemId,
      req.body.quantity,
    );
    res.json({ success: true, data });
  } catch (e) {
    const status = e.message.includes("not found") ? 404 : 400;
    res.status(status).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/:billId/generate ───────────────────────
exports.generateBill = async (req, res) => {
  try {
    const data = await billingService.generateFinalBill(
      req.params.billId,
      req.body.generatedBy || "Staff",
    );
    res.json({
      success: true,
      data,
      message: `Bill ${data.billNumber} generated successfully`,
    });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/:billId/payment ────────────────────────
exports.recordPayment = async (req, res) => {
  try {
    const { amount, paymentMode } = req.body;
    if (!amount || !paymentMode) {
      return res
        .status(400)
        .json({ success: false, message: "amount and paymentMode required" });
    }

    const data = await billingService.recordPayment(
      req.params.billId,
      req.body,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/:billId/tpa-claim ──────────────────────
exports.setTPAClaimStatus = async (req, res) => {
  try {
    if (!req.body.status) {
      return res
        .status(400)
        .json({ success: false, message: "status required" });
    }

    const data = await billingService.updateTPAClaimStatus(
      req.params.billId,
      req.body,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ── GET /api/billing/price/:serviceId ────────────────────────
exports.getServicePrice = async (req, res) => {
  try {
    const { tariffType = "CASH", tpaId } = req.query;
    // `billingService.getEffectivePrice` doesn't exist — pricing logic lives
    // on ServicePricing.getPriceFor(serviceId, paymentType, tpaId).
    const ServicePricing = require("../../models/ServicePricing/ServicePricingModel");
    const ServiceMaster  = require("../../models/ServiceMaster/serviceMasterModel");
    const service = await ServiceMaster.findById(req.params.serviceId).lean();
    if (!service) return res.status(404).json({ success: false, message: "Service not found" });
    const pricing = await ServicePricing.getPriceFor(req.params.serviceId, tariffType, tpaId || null);
    res.json({
      success: true,
      data: {
        serviceId:       req.params.serviceId,
        tariffType,
        effectivePrice:  pricing ? pricing.finalPrice : (service.defaultPrice || 0),
        pricing:         pricing || null,
        service:         { serviceName: service.serviceName, serviceCode: service.serviceCode },
      },
    });
  } catch (e) {
    const status = e.message?.includes("not found") ? 404 : 500;
    res.status(status).json({ success: false, message: e.message });
  }
};

// ── GET /api/billing/daycare-check/:admissionId ───────────────
exports.checkDaycare = async (req, res) => {
  try {
    const data = await billingService.checkAndHandleDaycareConversion(
      req.params.admissionId,
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── GET /api/billing/summary ──────────────────────────────────
exports.getSummary = async (req, res) => {
  try {
    const data = await billingService.getBillingSummary();
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── GET /api/billing/revenue-breakdown?from=YYYY-MM-DD&to=… ────
// Accountant-facing revenue cuts:
//   • byCategory     — service-line categories (Consultation / Pharmacy /
//                      Lab / Room / Procedure / Other) with count + paid
//                      + gross
//   • byVisitType    — OPD / IPD / ER / Day Care / Services
//   • byPayer        — Cash / TPA / Corporate / Government / Insurance
//   • byDepartment   — Cardiology / Medicine / Ortho etc. (from bill.dept
//                      fallback to ipd admission)
//   • byDoctor       — top 20 by collection (for consultant payout base)
// All numbers are sums over the date window (createdAt between from..to,
// inclusive). Returns empty arrays when range has no bills — never throws.
exports.getRevenueBreakdown = async (req, res) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00`) : new Date(Date.now() - 30 * 86400000);
    const to   = req.query.to   ? new Date(`${req.query.to}T23:59:59.999`) : new Date();
    const bills = await PatientBill.find({
      createdAt: { $gte: from, $lte: to },
      billStatus: { $nin: ["DRAFT"] },
    }).lean();

    const inc = (map, key, paid, gross = 0) => {
      const k = (key || "Other").toString();
      if (!map[k]) map[k] = { count: 0, paid: 0, gross: 0 };
      map[k].count += 1;
      map[k].paid  += Number(paid || 0);
      map[k].gross += Number(gross || 0);
    };
    const byCategory = {};
    const byVisitType = {};
    const byPayer = {};
    const byDepartment = {};
    const byDoctor = {};

    let grandPaid = 0, grandGross = 0, txnCount = 0;
    for (const b of bills) {
      const paid  = Number(b.advancePaid ?? b.totalPaid ?? b.amountPaid ?? 0);
      const gross = Number(b.netAmount ?? b.netPayable ?? b.grossAmount ?? b.totalAmount ?? 0);
      grandPaid += paid; grandGross += gross; txnCount += 1;
      inc(byVisitType, b.visitType || b.patientType || "Other", paid, gross);
      inc(byPayer,     b.paymentType || "Cash",                  paid, gross);
      inc(byDepartment,b.department || "Unspecified",            paid, gross);

      // Service-line cut — sum each line item's gross into its category.
      for (const it of (b.billItems || [])) {
        const cat = (it.category || it.serviceName || "Other").toString();
        if (!byCategory[cat]) byCategory[cat] = { count: 0, paid: 0, gross: 0 };
        byCategory[cat].count += 1;
        byCategory[cat].gross += Number(it.grossAmount || it.unitPrice * (it.quantity || 1) || 0);
      }

      if (b.doctor) {
        const did = String(b.doctor._id || b.doctor);
        if (!byDoctor[did]) byDoctor[did] = {
          doctorId: did,
          name: b.doctor.personalInfo?.fullName || b.doctorName || "Doctor",
          count: 0, paid: 0,
        };
        byDoctor[did].count += 1;
        byDoctor[did].paid  += paid;
      }
    }

    const toArr = (obj, keyName) => Object.entries(obj)
      .map(([k, v]) => ({ [keyName]: k, ...v }))
      .sort((a, b) => b.paid - a.paid);

    res.json({
      success: true,
      window: { from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10), days: Math.ceil((to - from) / 86400000) + 1 },
      totals: { paid: grandPaid, gross: grandGross, outstanding: grandGross - grandPaid, count: txnCount },
      byCategory:   toArr(byCategory, "category"),
      byVisitType:  toArr(byVisitType, "visitType"),
      byPayer:      toArr(byPayer, "payer"),
      byDepartment: toArr(byDepartment, "department"),
      byDoctor:     Object.values(byDoctor).sort((a, b) => b.paid - a.paid).slice(0, 20),
    });
  } catch (e) {
    console.error("[billing] getRevenueBreakdown error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── GET /api/billing/aging?asOf=YYYY-MM-DD ────────────────────
// Receivables-aging cut for the Accountant's collections desk:
//   • 0-30 days  ·  31-60  ·  61-90  ·  90+
// Patient-credit ledger: every bill with outstanding > 0, sorted desc,
// limited to 100. TPA-marked bills go to a separate sub-list so the
// patient credit list isn't polluted with insurance receivables.
exports.getAging = async (req, res) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const asOf = req.query.asOf ? new Date(`${req.query.asOf}T23:59:59.999`) : new Date();

    const open = await PatientBill.find({
      billStatus: { $in: ["GENERATED", "PARTIAL"] },
    }).select("billNumber UHID patientName netAmount netPayable grossAmount advancePaid totalPaid amountPaid paymentType billStatus createdAt").lean();

    const buckets = { "0-30": { count: 0, amount: 0 }, "31-60": { count: 0, amount: 0 }, "61-90": { count: 0, amount: 0 }, "90+": { count: 0, amount: 0 } };
    const patientCredit = [];
    const tpaCredit     = [];

    for (const b of open) {
      const paid    = Number(b.advancePaid ?? b.totalPaid ?? b.amountPaid ?? 0);
      const gross   = Number(b.netAmount ?? b.netPayable ?? b.grossAmount ?? 0);
      const due     = Math.max(gross - paid, 0);
      if (due <= 0) continue;
      const ageDays = Math.floor((asOf - new Date(b.createdAt)) / 86400000);
      const bucket  = ageDays <= 30 ? "0-30" : ageDays <= 60 ? "31-60" : ageDays <= 90 ? "61-90" : "90+";
      buckets[bucket].count  += 1;
      buckets[bucket].amount += due;

      const entry = {
        billNumber: b.billNumber || String(b._id).slice(-8),
        UHID: b.UHID, patientName: b.patientName,
        gross, paid, due, ageDays, bucket,
        status: b.billStatus, createdAt: b.createdAt,
      };
      const isTPA = /tpa|insurance|corporate/i.test(b.paymentType || "");
      (isTPA ? tpaCredit : patientCredit).push(entry);
    }

    patientCredit.sort((a, b) => b.due - a.due);
    tpaCredit.sort((a, b) => b.due - a.due);

    res.json({
      success: true,
      asOf: asOf.toISOString().slice(0,10),
      buckets: Object.entries(buckets).map(([bucket, v]) => ({ bucket, ...v })),
      totalOutstanding: patientCredit.reduce((s, e) => s + e.due, 0) + tpaCredit.reduce((s, e) => s + e.due, 0),
      patientCredit: patientCredit.slice(0, 100),
      tpaCredit:     tpaCredit.slice(0, 100),
    });
  } catch (e) {
    console.error("[billing] getAging error:", e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── GET /api/billing  — paginated bills list (Accountant/Admin) ─
// Filters: status, visitType, paymentType, UHID, billNumber, startDate, endDate
exports.listBills = async (req, res) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const { page = 1, limit = 50, status, visitType, paymentType, UHID, billNumber, patientName, startDate, endDate } = req.query;
    const query = {};
    // Enum values on the model are upper-case (DRAFT/GENERATED/PAID/etc.);
    // accept lower-case from the frontend dropdown and normalize.
    if (status)       query.billStatus  = String(status).toUpperCase();
    if (visitType)    query.visitType   = String(visitType).toUpperCase();
    if (paymentType)  query.paymentType = String(paymentType).toUpperCase();
    // Escape user-supplied regex chars so a caller can't pass `.*` and
    // dump every bill (security audit 2026-05-17 finding B-01).
    const { safeRegex } = require("../../utils/queryGuards");
    if (UHID)         query.UHID        = safeRegex(UHID);
    if (billNumber)   query.billNumber  = safeRegex(billNumber);
    if (patientName)  query.patientName = safeRegex(patientName);
    if (startDate || endDate) {
      query.billDate = {};
      if (startDate) query.billDate.$gte = new Date(startDate);
      if (endDate)   query.billDate.$lte = new Date(endDate);
    }
    const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
    const [bills, total] = await Promise.all([
      PatientBill.find(query)
        .populate("patient", "fullName UHID contactNumber")
        .populate("tpa", "tpaName")
        .sort({ billDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      PatientBill.countDocuments(query),
    ]);
    bills.forEach(b => { if (!b.patientName) b.patientName = b.patient?.fullName || ""; });
    return res.json({
      success: true,
      data: bills,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/ai-suggest ──────────────────────────────
exports.aiSuggest = async (req, res, next) => {
  try {
    const { billId, diagnosis, patientType, additionalContext } = req.body;
    if (!billId || !diagnosis) {
      return res
        .status(400)
        .json({ success: false, message: "billId and diagnosis are required" });
    }
    const aiSvc = require("../../services/Billing/aiChargeService");
    const result = await aiSvc.suggestMissedCharges({
      billId,
      diagnosis,
      patientType: patientType || "IPD",
      additionalContext,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
};

// ── POST /api/billing/ai-confirm ──────────────────────────────
exports.aiConfirm = async (req, res, next) => {
  try {
    const { billId, serviceIds, confirmedBy } = req.body;
    if (!billId || !Array.isArray(serviceIds)) {
      return res
        .status(400)
        .json({ success: false, message: "billId and serviceIds[] required" });
    }
    const aiSvc = require("../../services/Billing/aiChargeService");
    const result = await aiSvc.confirmAISuggestions(
      billId,
      serviceIds,
      confirmedBy || "Staff",
    );
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
};

// ── POST /api/billing/:billId/nurse-charge ────────────────────
exports.addNurseCharge = async (req, res, next) => {
  try {
    const { serviceId, quantity, nurseName, shift, remarks } = req.body;
    if (!serviceId) {
      return res
        .status(400)
        .json({ success: false, message: "serviceId required" });
    }
    const bill = await BillingService.addNurseCharge(
      req.params.billId,
      serviceId,
      quantity || 1,
      { nurseName, shift, remarks },
    );
    res.json({ success: true, data: bill });
  } catch (e) {
    next(e);
  }
};

// ── GET /api/billing/nurse-services?patientType=IPD ───────────
exports.getNurseChargeableServices = async (req, res, next) => {
  try {
    const services = await BillingService.getNurseChargeableServices(
      req.query.patientType || "IPD",
    );
    res.json({ success: true, data: services });
  } catch (e) {
    next(e);
  }
};

// GET /api/billing/audit-trail/:admissionId
exports.getAuditTrail = async (req, res, next) => {
  try {
    const autoBilling = require("../../services/Billing/autoBillingService");
    const result = await autoBilling.getAuditTrail(req.params.admissionId, req.query);
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
};

// GET /api/billing/audit-summary/:admissionId
exports.getAuditSummary = async (req, res, next) => {
  try {
    const autoBilling = require("../../services/Billing/autoBillingService");
    const result = await autoBilling.getAdmissionBillingSummary(req.params.admissionId);
    res.json({ success: true, data: result });
  } catch (e) { next(e); }
};

// POST /api/billing/audit/:triggerId/confirm-bill
exports.confirmTriggerBill = async (req, res, next) => {
  try {
    const autoBilling = require("../../services/Billing/autoBillingService");
    const { confirmedBy, confirmedByRole } = req.body;
    const result = await autoBilling.confirmAndBillTrigger(req.params.triggerId, { confirmedBy, confirmedByRole });
    res.json({ success: true, data: result });
  } catch (e) { next(e); }
};

/* ─────────────────────────────────────────────────────────────
   TPA CASES WORKFLOW
   List patients with TPA/Insurance + manage pre-auth / approval flow
───────────────────────────────────────────────────────────── */
// GET /api/billing/tpa-cases?status=...
exports.getTPACases = async (req, res, next) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const filter = {
      paymentType: { $in: ["TPA", "CORPORATE"] },
    };
    if (req.query.status) filter.tpaClaimStatus = req.query.status;
    if (req.query.q) {
      const q = new RegExp(req.query.q, "i");
      filter.$or = [{ patientName: q }, { UHID: q }, { billNumber: q }, { tpaClaimNumber: q }];
    }
    const list = await PatientBill.find(filter)
      .populate("tpa", "tpaName tpaCode")
      .populate("patient", "fullName UHID contactNumber")
      .sort({ updatedAt: -1 })
      .limit(500)
      .lean();
    // Denormalise patientName for the UI so the row labels are filled in.
    list.forEach(b => { if (!b.patientName) b.patientName = b.patient?.fullName || ""; });
    res.json({ success: true, count: list.length, data: list });
  } catch (e) { next(e); }
};

// POST /api/billing/:billId/tpa-preauth-submit
//   Body: { claimNumber, requestedAmount, submittedBy, notes }
exports.tpaPreAuthSubmit = async (req, res, next) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const bill = await PatientBill.findById(req.params.billId);
    if (!bill) return res.status(404).json({ success: false, message: "Bill not found" });

    // FIX (audit P6-B5): transition guard. Pre-auth was previously a one-way
    // override — any user with API access could flip an APPROVED claim back
    // to SUBMITTED (erasing the desk approval) or re-submit a settled claim
    // (corrupting the TPA ledger). Only initial-state claims may transition
    // to SUBMITTED; re-submits after rejection are allowed but log a note.
    const ALLOWED_FROM = ["NOT_APPLICABLE", "PENDING", "REJECTED"];
    if (!ALLOWED_FROM.includes(bill.tpaClaimStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot submit pre-auth — claim is already in '${bill.tpaClaimStatus}' state`,
      });
    }
    if (bill.paymentType !== "TPA" && bill.paymentType !== "CORPORATE") {
      return res.status(400).json({
        success: false,
        message: "Pre-auth is only valid for TPA or Corporate payment types",
      });
    }

    bill.tpaClaimNumber  = req.body.claimNumber || bill.tpaClaimNumber || "";
    bill.tpaClaimStatus  = "SUBMITTED";
    bill.tpaPayableAmount = Number(req.body.requestedAmount) || bill.tpaPayableAmount || 0;
    bill.markModified("tpaClaimStatus");
    await bill.save();
    res.json({ success: true, data: bill });
  } catch (e) { next(e); }
};

// POST /api/billing/:billId/tpa-approve
//   Body: { approvedAmount, validUntil, approvedBy, notes }
exports.tpaApprove = async (req, res, next) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const bill = await PatientBill.findById(req.params.billId);
    if (!bill) return res.status(404).json({ success: false, message: "Bill not found" });
    bill.tpaClaimStatus  = "APPROVED";
    bill.tpaApprovedAmount = Number(req.body.approvedAmount) || bill.tpaPayableAmount || 0;
    await bill.save();
    res.json({ success: true, data: bill });
  } catch (e) { next(e); }
};

// POST /api/billing/:billId/refund
//   Body: { amount, reason, mode?, refundedBy?, transactionId? }
// Records a refund payment row (negative amount) on the bill, recalculates
// balance, and flips status to REFUNDED if the full amount was refunded.
// Cannot refund more than what's already been paid.
exports.refundPayment = async (req, res, next) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const bill = await PatientBill.findById(req.params.billId);
    if (!bill) return res.status(404).json({ success: false, message: "Bill not found" });

    // FIX (audit P6-B4): bill state guard. Refunds were previously allowed
    // on any bill that had a payment row — including DRAFT/GENERATED bills
    // that the cashier shouldn't even be looking at, and already REFUNDED
    // bills, which would let staff drive the balance arbitrarily negative.
    if (!["PAID", "PARTIAL"].includes(bill.billStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot refund a ${bill.billStatus} bill — only PAID or PARTIAL bills can be refunded`,
      });
    }

    const amt = Number(req.body.amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ success: false, message: "Refund amount must be greater than zero" });
    }
    const paid = (bill.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
    if (amt > paid + 0.5) {
      return res.status(400).json({
        success: false,
        message: `Cannot refund ₹${amt} — only ₹${paid} has been collected on this bill`,
      });
    }
    if (!req.body.reason || !String(req.body.reason).trim()) {
      return res.status(400).json({ success: false, message: "Refund reason is required for audit trail" });
    }

    // Allowed payment modes (must match PaymentSchema enum exactly)
    const ALLOWED = ["CASH", "CARD", "UPI", "CHEQUE", "ONLINE", "TPA_CLAIM"];
    const reqMode = String(req.body.mode || "CASH").toUpperCase();
    const mode = ALLOWED.includes(reqMode) ? reqMode : "CASH";

    bill.payments.push({
      amount:        -amt, // negative entry = refund
      paymentMode:   mode,
      transactionId: req.body.transactionId,
      receivedBy:    req.body.refundedBy || "Reception",
      remarks:       `REFUND: ${req.body.reason}`,
    });

    // Status: fully refunded → REFUNDED, partial refund of a PAID bill → PARTIAL.
    // (advancePaid / balanceAmount are recomputed in the pre-save hook based on
    // billStatus, so we just set the status here.)
    const newPaid = paid - amt;
    if (newPaid <= 0.5) {
      bill.billStatus = "REFUNDED";
    } else if (bill.billStatus === "PAID") {
      bill.billStatus = "PARTIAL";
    }
    bill.remarks = (bill.remarks || "") + ` | Refund ₹${amt}: ${req.body.reason}`;
    await bill.save();
    return res.json({ success: true, data: bill });
  } catch (e) { next(e); }
};

// POST /api/billing/:billId/cancel-bill
//   Body: { reason, cancelledBy }
// Marks a bill as CANCELLED. Only allowed when no payments have been made.
exports.cancelBill = async (req, res, next) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const bill = await PatientBill.findById(req.params.billId);
    if (!bill) return res.status(404).json({ success: false, message: "Bill not found" });
    const paid = (bill.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
    if (paid > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel — ₹${paid} already collected. Issue a refund first.`,
      });
    }
    if (!req.body.reason || !String(req.body.reason).trim()) {
      return res.status(400).json({ success: false, message: "Cancellation reason is required" });
    }
    bill.billStatus = "CANCELLED";
    bill.remarks = (bill.remarks || "") + ` | Cancelled: ${req.body.reason} (by ${req.body.cancelledBy || "Reception"})`;
    await bill.save();
    return res.json({ success: true, data: bill });
  } catch (e) { next(e); }
};

// POST /api/billing/:billId/tpa-deny  Body: { reason }
// NOTE: the bill schema's tpaClaimStatus enum is
// [NOT_APPLICABLE, PENDING, SUBMITTED, APPROVED, REJECTED, PARTIAL_APPROVED]
// — there is no "DENIED" value. Map UI "Deny" → "REJECTED".
exports.tpaDeny = async (req, res, next) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const bill = await PatientBill.findById(req.params.billId);
    if (!bill) return res.status(404).json({ success: false, message: "Bill not found" });
    bill.tpaClaimStatus = "REJECTED";
    bill.tpaApprovedAmount = 0;
    if (req.body.reason) bill.remarks = `TPA Denied: ${req.body.reason}`;
    await bill.save();
    res.json({ success: true, data: bill });
  } catch (e) { next(e); }
};

/* ─────────────────────────────────────────────────────────────
   COLLECTION DASHBOARD
   GET /api/billing/collection-summary?date=YYYY-MM-DD
   Returns aggregated totals for the day:
     • Total collection
     • By visit type (OPD / IPD / DC / ER / Services)
     • By payment mode  (Cash / Card / UPI / TPA / Insurance / Corporate)
     • By doctor (OPD consultation revenue)
     • Outstanding (advance dues + TPA pending)
     • Per-receptionist breakdown
───────────────────────────────────────────────────────────── */
exports.getCollectionSummary = async (req, res, next) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const Doctor      = require("../../models/Doctor/doctorModel");

    // Parse date or default to today
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd   = new Date(`${dateStr}T23:59:59.999`);

    // All bills created/updated today (cast a wide net — bill mutation captures the work)
    // NOTE: PatientBill has no `doctor` ref field — populating it would throw
    // StrictPopulateError on Mongoose 8 and 500 the entire endpoint. The
    // per-doctor breakdown below correctly returns empty when bill.doctor is
    // absent (documented system debt).
    const bills = await PatientBill.find({
      $or: [
        { createdAt: { $gte: dayStart, $lte: dayEnd } },
        { updatedAt: { $gte: dayStart, $lte: dayEnd } },
      ],
    }).lean();

    // Aggregators
    let totalCollected = 0, totalGross = 0, totalPending = 0, advanceDue = 0, tpaPending = 0;
    let txnCount = 0;
    const byVisitType = { OPD: 0, IPD: 0, DC: 0, ER: 0, Services: 0, Other: 0 };
    const byVisitTxn  = { OPD: 0, IPD: 0, DC: 0, ER: 0, Services: 0, Other: 0 };
    const byMode      = { Cash: 0, Card: 0, UPI: 0, TPA: 0, Insurance: 0, Corporate: 0, Other: 0 };
    const byDoctor    = {};  // { doctorId: { name, count, amount } }
    const byReceptionist = {};

    for (const b of bills) {
      // PatientBillModel exposes paid as `advancePaid` (the pre-save hook
      // sums the payments[] array). Older bills used `totalPaid`/`amountPaid`
      // — keep them as fallbacks for compatibility.
      const paid    = Number(b.advancePaid ?? b.totalPaid ?? b.amountPaid ?? 0);
      const gross   = Number(b.netAmount ?? b.netPayable ?? b.grossAmount ?? b.totalAmount ?? 0);
      const pending = Math.max(gross - paid, 0);
      totalCollected += paid;
      totalGross     += gross;
      totalPending   += pending;
      txnCount       += 1;

      // Visit type
      const vt = (b.visitType || b.patientType || "Other").toString().toUpperCase();
      const key = vt.startsWith("OPD")        ? "OPD"
                : vt.startsWith("IPD")        ? "IPD"
                : vt.includes("DAY")          ? "DC"
                : vt.startsWith("ER") || vt.includes("EMERGENCY") ? "ER"
                : vt.startsWith("SERV")       ? "Services"
                : "Other";
      byVisitType[key] += paid;
      byVisitTxn[key]  += 1;

      // Payment mode (each bill may have multiple payment rows)
      const payments = Array.isArray(b.payments) ? b.payments : [];
      if (payments.length === 0 && paid > 0) {
        // Fallback to single paymentType on bill
        const m = (b.paymentType || "Cash").toString();
        byMode[m] = (byMode[m] || 0) + paid;
      } else {
        for (const p of payments) {
          const m = (p.mode || p.paymentMode || "Other").toString();
          const amt = Number(p.amount || 0);
          if (byMode[m] === undefined) byMode[m] = 0;
          byMode[m] += amt;
        }
      }

      // Doctor (consultation only — OPD/ER)
      if (b.doctor) {
        const did = String(b.doctor._id);
        if (!byDoctor[did]) byDoctor[did] = {
          doctorId: did,
          name:     b.doctor.personalInfo?.fullName || "Doctor",
          specialization: b.doctor.professional?.specialization || "",
          count:    0,
          amount:   0,
        };
        byDoctor[did].count += 1;
        byDoctor[did].amount += paid;
      }

      // Per-receptionist (createdBy or last updater)
      const recId = String(b.createdBy || b.updatedBy || "unknown");
      if (!byReceptionist[recId]) byReceptionist[recId] = { id: recId, name: b.createdByName || "Unknown", count: 0, amount: 0 };
      byReceptionist[recId].count += 1;
      byReceptionist[recId].amount += paid;

      // Outstanding categorization
      if (pending > 0) {
        if (key === "IPD") advanceDue += pending;
        else if ((b.paymentType || "").toLowerCase().includes("tpa") || (b.paymentType || "").toLowerCase().includes("insurance"))
          tpaPending += pending;
      }
    }

    res.json({
      success: true,
      date: dateStr,
      summary: {
        totalCollected,
        totalGross,
        totalPending,
        txnCount,
        advanceDue,
        tpaPending,
      },
      byVisitType: Object.entries(byVisitType).map(([type, amount]) => ({ type, amount, count: byVisitTxn[type] || 0 })),
      byMode:      Object.entries(byMode).filter(([, v]) => v > 0).map(([mode, amount]) => ({ mode, amount })),
      byDoctor:    Object.values(byDoctor).sort((a, b) => b.amount - a.amount),
      byReceptionist: Object.values(byReceptionist),
    });
  } catch (e) { next(e); }
};
