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

// AI-billing endpoints (aiSuggest / aiConfirm) and their backing
// aiChargeService.js were removed — see commit "Remove AI billing
// surface from HIS". If the AI suggestion engine ever comes back it
// should be re-introduced as a separate audit-confirmable flow, not
// auto-applied to bills.

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

// ─────────────────────────────────────────────────────────────────────
// PATIENT ADVANCE — UHID-level prepayment ledger
// Cash/UPI/card collected from a patient before any bill is generated
// (typical IPD admission deposit) lives here. Later applied to bills.
// ─────────────────────────────────────────────────────────────────────

// POST /api/billing/advance  { UHID, amount, paymentMode, transactionId?, receivedBy, admission?, remarks? }
exports.createAdvance = async (req, res) => {
  try {
    const svc = require("../../services/Billing/patientAdvanceService");
    const adv = await svc.createAdvance({
      ...req.body,
      receivedBy:     req.body.receivedBy     || req.user?.fullName     || req.user?.employeeId,
      receivedById:   req.body.receivedById   || req.user?._id,
      receivedByRole: req.body.receivedByRole || req.user?.role,
    });
    res.status(201).json({ success: true, data: adv });
  } catch (e) {
    res.status(400).json({ success: false, message: e?.message || "Advance create failed" });
  }
};

// GET /api/billing/advance/uhid/:UHID?unspentOnly=true
exports.listAdvancesByUHID = async (req, res) => {
  try {
    const svc = require("../../services/Billing/patientAdvanceService");
    const unspentOnly = String(req.query?.unspentOnly || "").toLowerCase() === "true";
    const rows = await svc.listAdvancesForUHID(req.params.UHID, { unspentOnly });
    const totalUnspent = await svc.getUnspentBalance(req.params.UHID);
    res.json({ success: true, data: { advances: rows, totalUnspent } });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Advance list failed" });
  }
};

// POST /api/billing/advance/:advanceId/apply  { billId, amount? }
exports.applyAdvanceToBill = async (req, res) => {
  try {
    const svc = require("../../services/Billing/patientAdvanceService");
    const { billId, amount } = req.body || {};
    if (!billId) return res.status(400).json({ success: false, message: "billId required" });
    const result = await svc.applyAdvanceToBill(req.params.advanceId, billId, {
      amount,
      appliedBy:   req.user?.fullName || req.user?.employeeId || "Reception",
      appliedById: req.user?._id || null,
    });
    res.json({
      success: true,
      appliedAmount: result.appliedAmount,
      advance: result.advance,
      bill: { _id: result.bill._id, billNumber: result.bill.billNumber, balanceAmount: result.bill.balanceAmount, billStatus: result.bill.billStatus },
    });
  } catch (e) {
    res.status(400).json({ success: false, message: e?.message || "Advance apply failed" });
  }
};

// POST /api/billing/advance/:advanceId/refund  { refundedBy, refundReason }
exports.refundAdvance = async (req, res) => {
  try {
    const svc = require("../../services/Billing/patientAdvanceService");
    const adv = await svc.refundAdvance(req.params.advanceId, {
      refundedBy:   req.body?.refundedBy   || req.user?.fullName || req.user?.employeeId,
      refundReason: req.body?.refundReason || "Refund at patient request",
    });
    res.json({ success: true, data: adv });
  } catch (e) {
    res.status(400).json({ success: false, message: e?.message || "Refund failed" });
  }
};

// ─────────────────────────────────────────────────────────────────────
// ANH PACKAGE — preview / attach / detach
// ─────────────────────────────────────────────────────────────────────

// POST /api/billing/packages/preview  { diagnosis: "..." }
// Dry-run lookup — show what the matcher would pick for a given diagnosis
// text. Used by the receptionist's admission form to confirm before
// committing.
exports.previewPackageMatch = async (req, res) => {
  try {
    const autoBilling = require("../../services/Billing/autoBillingService");
    const diagnosis = String(req.body?.diagnosis || "").trim();
    if (!diagnosis) return res.status(400).json({ success: false, message: "diagnosis required" });
    const pkg = await autoBilling.findMatchingPackage(diagnosis);
    if (!pkg) return res.json({ success: true, matched: false, tokens: autoBilling.tokenize(diagnosis) });
    return res.json({
      success: true,
      matched: true,
      tokens: pkg._matchedTokens,
      matchScore: pkg._matchScore,
      package: {
        serviceCode: pkg.serviceCode,
        serviceName: pkg.serviceName,
        billingType: pkg.billingType,
        tierPricing: pkg.tierPricing,
        maxLOSDays:  pkg.maxLOSDays,
        inclusions:  pkg.inclusions,
        exclusions:  pkg.exclusions,
        speciality:  pkg.speciality,
        diagnosisTags: pkg.diagnosisTags,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Preview failed" });
  }
};

// POST /api/billing/admissions/:admissionId/attach-package  { serviceCode }
// Manual override — receptionist / accountant attaches a package to an
// existing admission. Replaces any prior package binding.
exports.attachPackageToAdmission = async (req, res) => {
  try {
    const Admission     = require("../../models/Patient/admissionModel");
    const ServiceMaster = require("../../models/ServiceMaster/serviceMasterModel");
    const autoBilling   = require("../../services/Billing/autoBillingService");

    const { admissionId } = req.params;
    const { serviceCode } = req.body || {};
    if (!serviceCode) return res.status(400).json({ success: false, message: "serviceCode required" });

    const adm = await Admission.findById(admissionId);
    if (!adm) return res.status(404).json({ success: false, message: "Admission not found" });
    const pkg = await ServiceMaster.findOne({ serviceCode: serviceCode.toUpperCase(), category: "PACKAGE", isActive: true }).lean();
    if (!pkg) return res.status(404).json({ success: false, message: `Package ${serviceCode} not found` });

    const trigger = await autoBilling.attachPackageToAdmission(adm, pkg, {
      auto: false,
      attachedBy: req.user?.employeeId || req.user?.fullName || "Staff",
      matchedDiagnosis: adm.provisionalDiagnosis || adm.reasonForAdmission || "",
    });
    if (!trigger) return res.status(500).json({ success: false, message: "Package attach failed" });

    res.json({
      success: true,
      package: { serviceCode: pkg.serviceCode, packageName: pkg.serviceName, billingType: pkg.billingType },
      trigger: { _id: trigger._id, billed: trigger.billed, billId: trigger.billId },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Attach failed" });
  }
};

// POST /api/billing/admissions/:admissionId/detach-package
// Drop the package binding so future daily-cron runs revert to standard
// bed + nursing + per-investigation billing. Existing posted line items
// are NOT removed — those need manual cancel via the bill UI.
exports.detachPackageFromAdmission = async (req, res) => {
  try {
    const Admission = require("../../models/Patient/admissionModel");
    const adm = await Admission.findById(req.params.admissionId);
    if (!adm) return res.status(404).json({ success: false, message: "Admission not found" });
    adm.package = {
      serviceCode: null, serviceId: null, packageName: null, packageType: null,
      tierUsed: null, unitPrice: 0, maxLOSDays: 0,
      attachedAt: null, attachedBy: null, matchedDiagnosis: null,
      matchScore: 0, autoAttached: false,
    };
    await adm.save();
    res.json({ success: true, message: "Package detached. Future days will bill at room+nursing+investigation rates." });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Detach failed" });
  }
};

// ─────────────────────────────────────────────────────────────────────
// POST /api/billing/backfill-registration
//
// One-shot admin endpoint that walks every Patient whose `totalOPDVisits`
// is > 0 but who has NO PatientBill yet, and back-creates the missing
// OPD visit + admission + billing trigger. Same idempotent path that
// new registrations now take — so re-running it is safe.
//
// Why it's needed: before the patientService dispatch was wired, every
// receptionist registration relied on the frontend making a second
// axios call to /opd/visits. If that call ever silently failed, the
// patient existed but their first OPD bill never did. This sweeps the
// historical residue clean. Filterable by `?uhid=…` for one-off cleanup.
//
// Body params (optional): { uhid?: string, limit?: number, dryRun?: boolean }
// ─────────────────────────────────────────────────────────────────────
exports.backfillRegistrationBills = async (req, res) => {
  try {
    const Patient    = require("../../models/Patient/patientModel");
    const Admission  = require("../../models/Patient/admissionModel");
    const OPDService = require("../../services/Patient/OPDService");
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");

    const { uhid, limit = 200, dryRun = false } = req.body || {};

    const q = { isActive: true, registrationType: "OPD", totalOPDVisits: { $gt: 0 } };
    if (uhid) q.UHID = String(uhid).toUpperCase();

    const patients = await Patient.find(q)
      .limit(Math.max(1, Math.min(2000, Number(limit) || 200)))
      .select("_id UHID fullName department doctor paymentType registrationType");

    const report = { scanned: patients.length, alreadyHadBill: 0, backfilled: 0, skippedNoDoctor: 0, errored: 0, items: [] };

    for (const p of patients) {
      try {
        const hasBill = await PatientBill.exists({ UHID: p.UHID });
        if (hasBill) { report.alreadyHadBill++; continue; }
        if (!p.doctor) { report.skippedNoDoctor++; report.items.push({ UHID: p.UHID, status: "skipped-no-doctor" }); continue; }
        if (dryRun)    { report.items.push({ UHID: p.UHID, status: "would-backfill" }); continue; }

        await OPDService.createOPDVisit({
          patientId:      p._id,
          UHID:           p.UHID,
          departmentId:   p.department,
          doctorId:       p.doctor,
          chiefComplaint: "Registration backfill (auto)",
          visitDate:      new Date(),
          visitType:      "OPD",
          paymentType:    p.paymentType || "GENERAL",
        });
        report.backfilled++;
        report.items.push({ UHID: p.UHID, status: "backfilled" });
      } catch (e) {
        report.errored++;
        report.items.push({ UHID: p.UHID, status: "error", error: e?.message || String(e) });
      }
    }

    res.json({ success: true, dryRun, report });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Backfill failed" });
  }
};
