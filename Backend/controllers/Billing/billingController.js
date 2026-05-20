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
    const {
      serviceId, quantity = 1, chargeDate, remarks,
      // Order-lifecycle hints (NABH AAC.5). When the doctor adds a lab/
      // imaging/procedure line from the OPD orders panel, the frontend
      // passes addedBySource: "Doctor" → the service infers
      // orderStatus: "Ordered" and the item does NOT count toward the
      // billable total until the executing team confirms completion.
      // Walk-in flows (Reception) pass addedBySource: "Reception" → the
      // service writes orderStatus: "Completed" and the charge lands
      // immediately, preserving the existing front-desk cash flow.
      addedBySource, addedBy, addedByRole, orderStatus,
    } = req.body;
    if (!serviceId) {
      return res
        .status(400)
        .json({ success: false, message: "serviceId required" });
    }

    // Auth context — fall back through fullName → employeeId → role so
    // older client builds that don't send addedBy explicitly still get
    // a meaningful audit trail entry.
    const u = req.user || {};
    const resolvedAddedBy   = addedBy     || u.fullName || u.employeeId || "";
    const resolvedAddedRole = addedByRole || u.role || "";

    const data = await billingService.addServiceToBill(
      req.params.billId,
      serviceId,
      quantity,
      chargeDate ? new Date(chargeDate) : new Date(),
      remarks,
      {
        addedBySource: addedBySource || "Reception",
        addedBy: resolvedAddedBy,
        addedByRole: resolvedAddedRole,
        orderStatus, // optional explicit override
        orderedBy: resolvedAddedBy,
        orderedById: u._id,
        orderedByRole: resolvedAddedRole,
      },
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 400).json({ success: false, message: e.message });
  }
};

// ── PATCH /api/billing/:billId/items/:itemId/complete ─────────
// Flip an Active Order (Ordered / InProgress) → Completed. After this,
// the line counts toward the patient's billable total. Used by the lab
// tech / radiologist / proceduralist who actually executed the work
// (or by the doctor for procedure orders they performed themselves).
exports.completeItemOrder = async (req, res) => {
  try {
    const u = req.user || {};
    const data = await billingService.completeBillItemOrder(
      req.params.billId,
      req.params.itemId,
      {
        completedBy: req.body?.completedBy || u.fullName || u.employeeId || "",
        completedByRole: req.body?.completedByRole || u.role || "",
      },
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 400).json({ success: false, message: e.message });
  }
};

// ── PATCH /api/billing/:billId/items/:itemId/cancel-order ─────
// Soft-cancel an Active Order — keeps the line in the bill document for
// audit (NABH AAC.5) but excludes it from billable + pending totals.
// Refuses on Completed lines — use refund / accountant cancel for those.
exports.cancelItemOrder = async (req, res) => {
  try {
    const data = await billingService.cancelBillItemOrder(
      req.params.billId,
      req.params.itemId,
      { cancelReason: req.body?.cancelReason || "" },
    );
    res.json({ success: true, data });
  } catch (e) {
    res.status(e.status || 400).json({ success: false, message: e.message });
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

// ── POST /api/billing/uhid/:UHID/collect-all ────────────────
// Bulk-collect across every outstanding bill for the UHID. Distributes
// the lump sum FIFO (oldest bill first), capping each leg at that
// bill's balance. Returns the allocation list + a parent transaction
// id that joins every per-bill payment row.
exports.bulkCollectByUHID = async (req, res) => {
  try {
    const data = await billingService.bulkCollectByUHID(
      req.params.UHID,
      req.body,
    );
    res.json({
      success: true,
      data,
      message: `₹${data.totalCollected} collected across ${data.billsTouched} bill(s)`,
    });
  } catch (e) {
    res.status(e.status || 400).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/uhid/:UHID/bulk-settle ────────────────
// One discount distributed across every outstanding bill for the
// UHID. PERCENT mode applies the same % to each bill's balance;
// AMOUNT mode distributes the flat ₹ proportionally to each bill's
// share of total outstanding. Every touched bill gets its own audit
// log entry.
exports.bulkSettleByUHID = async (req, res) => {
  try {
    const data = await billingService.bulkSettleByUHID(
      req.params.UHID,
      req.body,
    );
    res.json({
      success: true,
      data,
      message: `Bulk settlement applied to ${data.billsTouched} bill(s)`,
    });
  } catch (e) {
    res.status(e.status || 400).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/:billId/settlement-adjust ──────────────
// Lets the receptionist adjust a GENERATED/PARTIAL bill at settlement
// time (extra discount + per-item qty/price edits). Audited — backend
// requires `adjustedBy` + `reason` and pushes a before/after snapshot
// onto bill.adjustmentLog.
exports.settlementAdjust = async (req, res) => {
  try {
    const data = await billingService.settlementAdjust(
      req.params.billId,
      req.body,
    );
    res.json({ success: true, data, message: "Settlement adjustment recorded" });
  } catch (e) {
    const status = e.status || 400;
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
// R7av-FIX-1/D2-HIGH-1: shared dashboard caches + safe-date helper.
// Pre-R7av every `?from=&to=` endpoint silently dumped the full table
// when the date was malformed, and the 5 heaviest endpoints rebuilt
// their aggregations on every request. The cache TTL is short (60s)
// so post-mutation staleness is tolerable; the date helper throws on
// bad input so the controller surfaces 400 instead of running an
// unbounded query.
const _revenueCache  = require("../../utils/lruCache")({ max: 30, ttlMs: 60_000 });
const _agingCache    = require("../../utils/lruCache")({ max: 30, ttlMs: 60_000 });
const _gstRegCache   = require("../../utils/lruCache")({ max: 30, ttlMs: 5 * 60_000 });
const _cnListCache   = require("../../utils/lruCache")({ max: 30, ttlMs: 60_000 });
const _gstSnapCache  = require("../../utils/lruCache")({ max: 30, ttlMs: 5 * 60_000 });
function _safeRange(req, opts) {
  const { parseHospitalDateRange } = require("../../utils/queryGuards");
  return parseHospitalDateRange(req.query.from, req.query.to, opts);
}

exports.getRevenueBreakdown = async (req, res, next) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const { toNum } = require("../../utils/money");        // R7ap-F1: Decimal128 unwrap
    // R7av-FIX-1/D2-HIGH-1: replaced silent `new Date("abc")=Invalid Date`
    // with the strict parseHospitalDateRange — bad input now 400s instead
    // of dumping the full collection. 30-day default; max 366d window.
    const { from, to } = _safeRange(req, { defaultDays: 30, maxDays: 366 });
    const cacheKey = `rev:${from.toISOString()}:${to.toISOString()}`;
    const payload = await _revenueCache.get(cacheKey, async () => {
    const bills = await PatientBill.find({
      createdAt: { $gte: from, $lte: to },
      billStatus: { $nin: ["DRAFT", "CANCELLED"] },        // R7ap-D5-12: also exclude cancelled
    })
      // R7av-FIX-2/D8-HIGH: project only the fields the reducer below
      // actually consumes — pre-R7av this loaded full billItems[],
      // payments[], adjustmentLog[] per row (~50-100 MB heap spike on
      // 500-bill days).
      .select("billStatus visitType paymentType department doctor advancePaid totalPaid amountPaid netAmount netPayable grossAmount totalAmount billItems.category billItems.netAmount billItems.grossAmount billItems.unitPrice billItems.quantity billItems.excludedByPackage")
      .lean();

    const inc = (map, key, paid, gross = 0) => {
      const k = (key || "Other").toString();
      if (!map[k]) map[k] = { count: 0, paid: 0, gross: 0 };
      map[k].count += 1;
      map[k].paid  += toNum(paid);
      map[k].gross += toNum(gross);
    };
    const byCategory = {};
    const byVisitType = {};
    const byPayer = {};
    const byDepartment = {};
    const byDoctor = {};

    let grandPaid = 0, grandGross = 0, txnCount = 0;
    for (const b of bills) {
      // R7ap-F1: toNum() unwraps Decimal128 objects (which Number() would NaN on).
      const paid  = toNum(b.advancePaid ?? b.totalPaid ?? b.amountPaid ?? 0);
      const gross = toNum(b.netAmount ?? b.netPayable ?? b.grossAmount ?? b.totalAmount ?? 0);
      grandPaid += paid; grandGross += gross; txnCount += 1;
      inc(byVisitType, b.visitType || b.patientType || "Other", paid, gross);
      inc(byPayer,     b.paymentType || "Cash",                  paid, gross);
      inc(byDepartment,b.department || "Unspecified",            paid, gross);

      // Service-line cut — sum each line item's gross into its category.
      // R7c-REP-CRIT-01: previously this loop only added to `.gross` and
      // `.count`, leaving `.paid` permanently at 0. The accountant's
      // "Revenue by Category" tile would render every row with paid=0,
      // suggesting nothing had been collected even when the bill was
      // fully paid. The fix is to distribute the bill's `paid` total
      // across its categories proportionally to each item's gross share
      // (so a Pharmacy line that's 30% of the bill's gross gets credited
      // with 30% of the bill's paid amount). For bills where gross is 0
      // (corner case: fully discounted), we fall back to per-item count.
      // R7ap-F36/D5-08: skip items that have been excluded by an ANH
      // package attachment. Pre-R7ap the byCategory chart double-counted
      // room/nursing line items AND the package bundle for the same bill.
      const _items = (b.billItems || []).filter((it) => !it.excludedByPackage);
      const billItemsGross = _items.reduce(
        (s, it) => s + toNum(it.grossAmount || toNum(it.unitPrice) * (toNum(it.quantity) || 1)),
        0,
      );
      for (const it of _items) {
        const itGross = toNum(it.grossAmount || toNum(it.unitPrice) * (toNum(it.quantity) || 1));
        const itPaidShare = billItemsGross > 0
          ? (itGross / billItemsGross) * paid
          : paid / Math.max(1, (b.billItems || []).length); // equal split fallback
        // R7ap-D2-15: drop serviceName fallback — was exploding chart into slivers.
        // Missing-category lines now aggregate into "Uncategorized" so the
        // cleanup signal sticks out instead of polluting the bar chart.
        const cat = (it.category || "Uncategorized").toString();
        if (!byCategory[cat]) byCategory[cat] = { count: 0, paid: 0, gross: 0 };
        byCategory[cat].count += 1;
        byCategory[cat].gross += itGross;
        byCategory[cat].paid  += itPaidShare;
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

      return {
        window: { from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10), days: Math.ceil((to - from) / 86400000) + 1 },
        totals: { paid: grandPaid, gross: grandGross, outstanding: grandGross - grandPaid, count: txnCount },
        byCategory:   toArr(byCategory, "category"),
        byVisitType:  toArr(byVisitType, "visitType"),
        byPayer:      toArr(byPayer, "payer"),
        byDepartment: toArr(byDepartment, "department"),
        byDoctor:     Object.values(byDoctor).sort((a, b) => b.paid - a.paid).slice(0, 20),
      };
    });
    res.json({ success: true, ...payload });
  } catch (e) {
    if (e?.status && !res.headersSent) {
      return res.status(e.status).json({ success: false, message: e.message });
    }
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
exports.getAging = async (req, res, next) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const { toNum } = require("../../utils/money");        // R7ap-F1: Decimal128 unwrap
    const { parseHospitalDate } = require("../../utils/queryGuards");
    // R7av-FIX-1/D2-HIGH-1: strict date parse; default = today end-of-day.
    let asOf;
    try { asOf = parseHospitalDate(req.query.asOf, { endOfDay: true }) || new Date(); }
    catch (e) { return res.status(400).json({ success: false, message: e.message }); }
    const cacheKey = `aging:${asOf.toISOString()}`;
    const payload = await _agingCache.get(cacheKey, async () => {

    const open = await PatientBill.find({
      billStatus: { $in: ["GENERATED", "PARTIAL"] },
      // R7av-FIX-3/D8-HIGH-4: cap to 12-month window. Pre-R7av loaded
      // every open bill since inception → 5-10k docs at year+ hospital.
      createdAt: { $gte: new Date(Date.now() - 365 * 86400000) },
    })
      .select("billNumber UHID patientName netAmount netPayable grossAmount balanceAmount patientPayableAmount advancePaid totalPaid amountPaid paymentType tpaClaimStatus billStatus createdAt billItems.netAmount")
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean();

    const buckets = { "0-30": { count: 0, amount: 0 }, "31-60": { count: 0, amount: 0 }, "61-90": { count: 0, amount: 0 }, "90+": { count: 0, amount: 0 } };
    const patientCredit = [];
    const tpaCredit     = [];

    for (const b of open) {
      // R7ap-D2-06: prefer bill.balanceAmount (authoritative) — refunds inflate
      // (gross−paid) when applied to PARTIAL bills via negative rows. Fall back
      // to items-net (R7am pattern) when balanceAmount is stale-zero.
      const itemsNet = (b.billItems || []).reduce((s, it) => s + toNum(it.netAmount), 0);
      const refNet   = Math.max(toNum(b.patientPayableAmount), toNum(b.netAmount), itemsNet);
      const stored   = toNum(b.balanceAmount);
      const paid     = toNum(b.advancePaid ?? b.totalPaid ?? b.amountPaid ?? 0);
      const gross    = toNum(b.netAmount ?? b.netPayable ?? b.grossAmount ?? 0);
      const due      = stored > 0 ? stored : Math.max(refNet - Math.max(0, paid), 0);
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

      return {
        asOf: asOf.toISOString().slice(0,10),
        buckets: Object.entries(buckets).map(([bucket, v]) => ({ bucket, ...v })),
        totalOutstanding: patientCredit.reduce((s, e) => s + e.due, 0) + tpaCredit.reduce((s, e) => s + e.due, 0),
        patientCredit: patientCredit.slice(0, 100),
        tpaCredit:     tpaCredit.slice(0, 100),
      };
    });
    res.json({ success: true, ...payload });
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
    // R7ap-F1: .lean() bypasses the toJSON decimalToNumber transform — money
    // fields arrive as raw Decimal128 objects that Number() coerces to NaN.
    // Walk every doc and unwrap before sending to the wire.
    const { decimalToNumber } = require("../../utils/money");
    bills.forEach((b) => {
      decimalToNumber(null, b);
      if (!b.patientName) b.patientName = b.patient?.fullName || "";
    });
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

// ─── IPD Live Ledger (Phase A) ────────────────────────────────
// GET /api/billing/ipd/:admissionId/ledger
// Single read returns admission + bill summary + every trigger
// (with role-aware canUndo / canOverride / canCancel flags) +
// category- and day-grouped totals. Powers the IPD Live Billing
// page so the UI doesn't have to re-aggregate on every render.
exports.getIPDLedger = async (req, res, next) => {
  try {
    const autoBilling = require("../../services/Billing/autoBillingService");
    const data = await autoBilling.getIPDLedger(req.params.admissionId, req.user || {});
    res.json({ success: true, data });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ success: false, message: e.message });
    next(e);
  }
};

// Shared error → HTTP mapping for undo/override/cancel. All three throw
// `err.code` values the UI can act on (show a toast vs an inline error vs
// a modal). 400 for client-side mistakes (no reason, expired window),
// 404 for missing, 409 for state conflicts (closed bill, already voided).
function ledgerErrorStatus(code) {
  if (code === "REASON_REQUIRED" || code === "INVALID_QTY" || code === "INVALID_PRICE" || code === "NOT_AUTO" || code === "WINDOW_EXPIRED") return 400;
  if (code === "BILL_CLOSED" || code === "ALREADY_CLOSED" || code === "BILL_MISSING") return 409;
  return 500;
}

// POST /api/billing/trigger/:triggerId/undo  { reason }
// Receptionist (15-min auto-charge undo) + Accountant/Admin (no time gate)
exports.undoTrigger = async (req, res, next) => {
  try {
    const autoBilling = require("../../services/Billing/autoBillingService");
    const user = req.user || {};
    const skipTimeGate = user.role === "Admin" || user.role === "Accountant";
    const trigger = await autoBilling.undoTrigger(req.params.triggerId, {
      reason: req.body?.reason,
      user,
      skipTimeGate,
    });
    res.json({ success: true, data: trigger });
  } catch (e) {
    const status = e.status || ledgerErrorStatus(e.code);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// POST /api/billing/trigger/:triggerId/override  { quantity, unitPrice, reason }
exports.overrideTrigger = async (req, res, next) => {
  try {
    const autoBilling = require("../../services/Billing/autoBillingService");
    const trigger = await autoBilling.overrideTrigger(req.params.triggerId, {
      quantity: req.body?.quantity,
      unitPrice: req.body?.unitPrice,
      reason: req.body?.reason,
      user: req.user || {},
    });
    res.json({ success: true, data: trigger });
  } catch (e) {
    const status = e.status || ledgerErrorStatus(e.code);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

// POST /api/billing/ipd/:admissionId/manual-charge
// Body: { serviceId, quantity, unitPrice, remarks }
// Permissions: doctor (any service in their dept), nurse (nursing services),
// receptionist/accountant (anything). Pricing override is locked to
// Accountant/Admin — lower tiers' unitPrice is dropped so they can't
// silently undercut the tariff.
exports.addManualCharge = async (req, res, next) => {
  try {
    const autoBilling = require("../../services/Billing/autoBillingService");
    const user = req.user || {};
    const role = user.role || "";
    const canSetPrice = role === "Admin" || role === "Accountant";
    const result = await autoBilling.addManualCharge(req.params.admissionId, {
      serviceId:  req.body?.serviceId,
      quantity:   req.body?.quantity,
      unitPrice:  canSetPrice ? req.body?.unitPrice : undefined,
      remarks:    req.body?.remarks,
      user,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    const code = e.code;
    const status = e.status
      || (code === "ARG_MISSING" || code === "INVALID_QTY" || code === "INVALID_PRICE" ? 400 : 500);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code });
    next(e);
  }
};

// POST /api/billing/:billId/payment/:paymentId/void  { reason }
// Cashier-typo 15-min undo. Receptionist can void their OWN payment
// within 15 min of recording; Accountant/Admin can void anyone's
// payment any time (effectively a soft-refund). Logs to bill.payments
// as a negative row so the audit replay stays intact.
exports.voidPayment = async (req, res, next) => {
  try {
    const user = req.user || {};
    const skipTimeGate = user.role === "Admin" || user.role === "Accountant";
    const bill = await billingService.voidPayment(req.params.billId, req.params.paymentId, {
      reason: req.body?.reason,
      user,
      skipTimeGate,
    });
    res.json({ success: true, data: bill });
  } catch (e) {
    const code = e.code;
    const status = e.status
      || (code === "REASON_REQUIRED" || code === "WINDOW_EXPIRED" || code === "NOT_OWNER" ? 400 :
          code === "ALREADY_VOIDED" || code === "ALREADY_REVERSAL" ? 409 : 500);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code });
    next(e);
  }
};

// POST /api/billing/trigger/:triggerId/cancel  { reason }
exports.cancelTrigger = async (req, res, next) => {
  try {
    const autoBilling = require("../../services/Billing/autoBillingService");
    const trigger = await autoBilling.cancelTrigger(req.params.triggerId, {
      reason: req.body?.reason,
      user: req.user || {},
    });
    res.json({ success: true, data: trigger });
  } catch (e) {
    const status = e.status || ledgerErrorStatus(e.code);
    if (status !== 500) return res.status(status).json({ success: false, message: e.message, code: e.code });
    next(e);
  }
};

/* ─────────────────────────────────────────────────────────────
   TPA CASES WORKFLOW
   List patients with TPA/Insurance + manage pre-auth / approval flow
───────────────────────────────────────────────────────────── */
// GET /api/billing/tpa-cases?status=...
exports.getTPACases = async (req, res, next) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const { safeRegex } = require("../../utils/queryGuards");
    const { decimalToNumber } = require("../../utils/money");
    // R7ap-D3-08: gate on active states only so DRAFT/CANCELLED/REFUNDED
    // bills don't pollute the TPA receivables count + outstanding total.
    const filter = {
      paymentType: { $in: ["TPA", "CORPORATE"] },
      billStatus:  { $in: ["GENERATED", "PARTIAL", "PAID"] },
    };
    if (req.query.status) filter.tpaClaimStatus = req.query.status;
    // R7ap-D3-11: escape user-supplied regex to prevent ReDoS / dump-all.
    if (req.query.q) {
      const q = safeRegex(req.query.q);
      filter.$or = [{ patientName: q }, { UHID: q }, { billNumber: q }, { tpaClaimNumber: q }];
    }
    const list = await PatientBill.find(filter)
      .populate("tpa", "tpaName tpaCode")
      .populate("patient", "fullName UHID contactNumber")
      .sort({ updatedAt: -1 })
      .limit(500)
      .lean();
    // R7ap-F1: .lean() bypasses Decimal128→Number transform; unwrap before wire.
    list.forEach((b) => {
      decimalToNumber(null, b);
      if (!b.patientName) b.patientName = b.patient?.fullName || "";
    });
    // R7ap-F23/D3-08: standardise to {success, data, meta} shape across
    // all billing endpoints. Frontend `r.data?.data || r.data?.bills` chain
    // becomes a clean `r.data.data` access.
    res.json({ success: true, data: list, meta: { count: list.length } });
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
//
// R7z: State-machine guard. Previously a pure flip — any caller could
// move an already-PAID / SETTLED / DENIED claim back to APPROVED,
// overwriting desk decisions and corrupting the TPA ledger. Mirror
// the preauth-submit pattern: only SUBMITTED / PENDING / PARTIAL_APPROVED
// can transition to APPROVED. Re-approval (idempotent) is allowed but
// noted.
exports.tpaApprove = async (req, res, next) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const bill = await PatientBill.findById(req.params.billId);
    if (!bill) return res.status(404).json({ success: false, message: "Bill not found" });

    const ALLOWED_FROM = ["SUBMITTED", "PENDING", "PARTIAL_APPROVED", "APPROVED"];
    if (!ALLOWED_FROM.includes(bill.tpaClaimStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot approve — claim is in '${bill.tpaClaimStatus}' state (must be SUBMITTED / PENDING / PARTIAL_APPROVED).`,
      });
    }
    if (bill.paymentType !== "TPA" && bill.paymentType !== "CORPORATE") {
      return res.status(400).json({
        success: false,
        message: "Approval is only valid for TPA or Corporate bills",
      });
    }
    const _priorTpa     = bill.tpaClaimStatus;
    const _priorApprAmt = Number(bill.tpaApprovedAmount || 0);
    // R7ap-F26/D7-10: VersionError retry — concurrent cashier-payment vs
    // TPA-approval on the same bill no longer 500s; second writer retries.
    const PatientBillM = require("../../models/PatientBillModel/PatientBillModel");
    const retryVE = require("../../utils/retryVersionError");
    const updatedBill = await retryVE(async (attempt) => {
      const b = attempt === 0 ? bill : await PatientBillM.findById(req.params.billId);
      b.tpaClaimStatus    = "APPROVED";
      b.tpaApprovedAmount = Number(req.body.approvedAmount) || b.tpaPayableAmount || 0;
      b.tpaApprovedAt     = new Date();
      b.tpaApprovedBy     = req.body.approvedBy || req.user?.fullName || "TPA Desk";
      b.markModified("tpaClaimStatus");
      await b.save();
      return b;
    }, { label: "tpaApprove" });
    bill.tpaClaimStatus    = updatedBill.tpaClaimStatus;
    bill.tpaApprovedAmount = updatedBill.tpaApprovedAmount;
    // R7ap-F15: TPA approve audit
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:        "TPA_APPROVED",
        UHID:         bill.UHID,
        patientId:    bill.patient,
        billId:       bill._id,
        billNumber:   bill.billNumber,
        amount:       bill.tpaApprovedAmount,
        actorName:    bill.tpaApprovedBy,
        reason:       req.body.notes || "TPA claim approved",
        before:       { tpaClaimStatus: _priorTpa, tpaApprovedAmount: _priorApprAmt },
        after:        { tpaClaimStatus: "APPROVED", tpaApprovedAmount: bill.tpaApprovedAmount },
      }, { req });
    } catch (_) { /* audit best-effort */ }
    res.json({ success: true, data: bill });
  } catch (e) { next(e); }
};

// POST /api/billing/:billId/refund
//   Body: { amount, reason, mode?, refundedBy?, transactionId?, creditToAdvance? }
// R7a: thin wrapper — all validation + state + concurrency lives in
// billingService.recordRefund() so it gets the same VersionError retry
// protection as recordPayment. Service throws typed errors with
// `code` + `status`; we map them to HTTP responses.
// R7c: response now carries both `data` (the bill) AND `advance` (the
// PatientAdvance row created when creditToAdvance=true). Frontend
// uses `advance.receiptNumber` to print the second receipt.
exports.refundPayment = async (req, res, next) => {
  try {
    const billingService = require("../../services/Billing/billingService");
    const { bill, advance } = await billingService.recordRefund(req.params.billId, {
      amount:           req.body.amount,
      reason:           req.body.reason,
      mode:             req.body.mode,
      refundedBy:       req.body.refundedBy,
      transactionId:    req.body.transactionId,
      creditToAdvance:  !!req.body.creditToAdvance,
    });
    return res.json({ success: true, data: bill, advance });
  } catch (e) {
    if (e?.status && e?.code) {
      return res.status(e.status).json({ success: false, message: e.message, code: e.code });
    }
    return next(e);
  }
};

// POST /api/billing/:billId/cancel-bill
//   Body: { reason, cancelledBy }
// Marks a bill as CANCELLED. Only allowed when no payments have been made.
// R7z: also invalidates any live TPA pre-auth/claim attached to the bill.
// Previously the bill flipped to CANCELLED but its tpaClaimStatus stayed at
// SUBMITTED / APPROVED, so the TPA register still showed an active claim
// that could never settle. The shortest correct path is to flip the claim
// to REJECTED with a "bill-cancelled" reason and zero the approved amount.
//
// R7ar-P1-17/D5-aq-09: the inline load+mutate+save block previously
// 500'd on VersionError if a concurrent payment / void landed between
// the findById and the save. We now wrap the whole thing in
// retryVersionError so a benign concurrent write gets retried with a
// fresh read instead of bubbling up as "Internal Server Error".
exports.cancelBill = async (req, res, next) => {
  try {
    const retryVE    = require("../../utils/retryVersionError");
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");

    if (!req.body.reason || !String(req.body.reason).trim()) {
      return res.status(400).json({ success: false, message: "Cancellation reason is required" });
    }
    const reason      = String(req.body.reason).trim();
    const cancelledBy = req.body.cancelledBy || req.user?.fullName || "Reception";

    const { bill, _priorBillStatus, _priorTpaStatus } = await retryVE(async () => {
      const b = await PatientBill.findById(req.params.billId);
      if (!b) {
        const err = new Error("Bill not found"); err.status = 404; throw err;
      }
      // R7ab: state-machine guard. Terminal statuses (CANCELLED / REFUNDED
      // / PAID) cannot be cancelled — previously a REFUNDED bill could be
      // re-cancelled because the `paid` aggregate (negatives + positives)
      // summed to 0 and bypassed the guard, leaving the bill double-
      // labelled in the audit register.
      if (["CANCELLED", "REFUNDED", "PAID"].includes(b.billStatus)) {
        const err = new Error(`Cannot cancel — bill is already in '${b.billStatus}' state.`);
        err.status = 409; throw err;
      }
      // R7ab: compute "paid" from positive rows only — a refund row is a
      // negative entry, so the simple sum lets a fully-refunded bill look
      // unpaid. Cashier-intent collection is what we want to gate on.
      const paid = (b.payments || []).reduce(
        (s, p) => s + Math.max(0, Number(p.amount || 0)), 0,
      );
      if (paid > 0) {
        const err = new Error(`Cannot cancel — ₹${paid} already collected. Issue a refund first.`);
        err.status = 400; throw err;
      }
      // R7ap-F15: capture before-state for the BillingAudit emit at the end.
      const priorBillStatus = b.billStatus;
      const priorTpaStatus  = b.tpaClaimStatus;

      b.billStatus = "CANCELLED";
      b.remarks    = (b.remarks || "") + ` | Cancelled: ${reason} (by ${cancelledBy})`;

      // R7z: invalidate any active TPA claim attached to this bill.
      const ACTIVE = new Set(["PENDING", "SUBMITTED", "APPROVED", "PARTIAL_APPROVED"]);
      if (ACTIVE.has(b.tpaClaimStatus)) {
        const tpaPriorStatus = b.tpaClaimStatus;
        const tpaPriorAmount = b.tpaApprovedAmount;
        b.tpaClaimStatus    = "REJECTED";
        b.tpaApprovedAmount = 0;
        b.markModified("tpaClaimStatus");
        b.remarks += ` | TPA claim auto-invalidated on bill cancel (was ${tpaPriorStatus}, ₹${tpaPriorAmount || 0} approved)`;
        b.adjustmentLog = b.adjustmentLog || [];
        b.adjustmentLog.push({
          at:     new Date(),
          by:     cancelledBy,
          type:   "EXTRA_DISCOUNT",
          reason: `TPA claim invalidated due to bill cancellation: ${reason}`,
          before: { tpaClaimStatus: tpaPriorStatus, tpaApprovedAmount: tpaPriorAmount },
          after:  { tpaClaimStatus: "REJECTED",     tpaApprovedAmount: 0 },
        });
      }

      await b.save();
      return { bill: b, _priorBillStatus: priorBillStatus, _priorTpaStatus: priorTpaStatus };
    }, { label: "cancelBill" });

    // R7ap-F15: cancel-bill audit — outside the retry block so it doesn't
    // double-emit on a VersionError replay.
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:        "BILL_CANCELLED",
        UHID:         bill.UHID,
        patientId:    bill.patient,
        billId:       bill._id,
        billNumber:   bill.billNumber,
        actorName:    cancelledBy,
        reason:       reason,
        before:       { billStatus: _priorBillStatus, tpaClaimStatus: _priorTpaStatus },
        after:        { billStatus: "CANCELLED", tpaClaimStatus: bill.tpaClaimStatus },
      }, { req });
    } catch (_) { /* audit best-effort */ }
    // R7ar-P1-7: cache invalidation — a cancel can flip a bill out of
    // the Day Book's "expected collection" universe.
    try { exports.invalidateDayBookCache(); } catch (_) {}
    return res.json({ success: true, data: bill });
  } catch (e) {
    if (e?.status && !res.headersSent) {
      return res.status(e.status).json({ success: false, message: e.message });
    }
    next(e);
  }
};

// POST /api/billing/:billId/tpa-deny  Body: { reason }
// NOTE: the bill schema's tpaClaimStatus enum is
// [NOT_APPLICABLE, PENDING, SUBMITTED, APPROVED, REJECTED, PARTIAL_APPROVED]
// — there is no "DENIED" value. Map UI "Deny" → "REJECTED".
exports.tpaDeny = async (req, res, next) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const retryVE    = require("../../utils/retryVersionError");
    // R7av-FIX-11/D7-MED-2: state-machine guard + retry. Pre-R7av tpaDeny
    // could be invoked on already-SETTLED claims (wiping the approved
    // amount) and 500'd under concurrent writer races.
    const bill = await retryVE(async () => {
      const b = await PatientBill.findById(req.params.billId);
      if (!b) { const err = new Error("Bill not found"); err.status = 404; throw err; }
      const ALLOWED = ["PENDING", "SUBMITTED", "APPROVED", "PARTIAL_APPROVED", "NOT_APPLICABLE"];
      if (!ALLOWED.includes(b.tpaClaimStatus)) {
        const err = new Error(`Cannot deny — claim is in '${b.tpaClaimStatus}' state`);
        err.status = 409; throw err;
      }
      b.tpaClaimStatus = "REJECTED";
      b.tpaApprovedAmount = 0;
      if (req.body.reason) b.remarks = `TPA Denied: ${req.body.reason}`;
      await b.save();
      return b;
    }, { label: "tpaDeny" });
    res.json({ success: true, data: bill });
  } catch (e) {
    if (e?.status && !res.headersSent) {
      return res.status(e.status).json({ success: false, message: e.message });
    }
    next(e);
  }
};

// POST /api/billing/:billId/tpa-settle
//   Body: { settledAmount, transactionId, settledOn?, settledBy?, remarks?,
//           shortfallTo? ("PATIENT" | "WRITEOFF") }
//
// R7z: short-pay reconciliation.
//
// TPA payers routinely settle less than the approved amount — disallowed
// items, room-rent cap excess, co-pay clauses. Previously we had no
// endpoint to record what they actually paid; staff would either inflate
// the approval to match or leave the bill APPROVED-but-unpaid forever
// (TPA register reported a phantom outstanding).
//
// This endpoint accepts the actual remittance, posts a TPA_CLAIM payment
// row, and reconciles the shortfall:
//   • shortfallTo=PATIENT   (default) — bumps patientPayableAmount by the
//     shortfall so the cashier can collect it from the patient/family.
//     tpaClaimStatus → PARTIAL_APPROVED so the TPA register reflects truth.
//   • shortfallTo=WRITEOFF — recorded as an extraDiscount + adjustmentLog
//     entry. tpaClaimStatus → REJECTED (with "settled short — wrote off").
//     Useful for trivial ₹50-100 differences that aren't worth chasing.
//
// Net effect either way: bill.balanceAmount lands at zero (or only the
// patient's intentional liability), the audit log shows the exact path.
// R7ar-P1-17/D5-aq-09: wrap the full load+validate+mutate+save block in
// retryVersionError so a concurrent payment / refund / cancel landing
// between the findById and save() doesn't 500 the TPA desk. The
// validation throws still surface as 4xx via the err.status handler.
exports.tpaSettle = async (req, res, next) => {
  try {
    const retryVE    = require("../../utils/retryVersionError");
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");

    const settledAmount = Number(req.body.settledAmount);
    if (!Number.isFinite(settledAmount) || settledAmount < 0) {
      return res.status(400).json({ success: false, message: "settledAmount is required and must be ≥ 0" });
    }
    if (!req.body.transactionId || !String(req.body.transactionId).trim()) {
      return res.status(400).json({ success: false, message: "transactionId (NEFT/UTR/cheque ref) is required for TPA settlement" });
    }

    const settledBy   = req.body.settledBy || req.user?.fullName || "TPA Desk";
    const settledOn   = req.body.settledOn ? new Date(req.body.settledOn) : new Date();
    const shortfallTo = (req.body.shortfallTo || "PATIENT").toUpperCase();

    const result = await retryVE(async () => {
      const bill = await PatientBill.findById(req.params.billId);
      if (!bill) {
        const err = new Error("Bill not found"); err.status = 404; throw err;
      }

      const ALLOWED = ["APPROVED", "PARTIAL_APPROVED", "SUBMITTED"];
      if (!ALLOWED.includes(bill.tpaClaimStatus)) {
        const err = new Error(`Cannot settle — claim is in '${bill.tpaClaimStatus}' state (must be APPROVED / PARTIAL_APPROVED / SUBMITTED).`);
        err.status = 400; throw err;
      }
      if (!["TPA", "CORPORATE"].includes(bill.paymentType)) {
        const err = new Error("Settle is only valid for TPA / Corporate bills");
        err.status = 400; throw err;
      }

      // Unwrap Decimal128 to plain number for arithmetic.
      const toN = (v) => v == null ? 0 : (typeof v === "object" && v.toString ? Number(v.toString()) : Number(v));
      const approved = toN(bill.tpaApprovedAmount) || toN(bill.tpaPayableAmount);
      const shortfall = Math.max(0, approved - settledAmount);
      const overpay   = Math.max(0, settledAmount - approved);

      // Reject suspiciously large overpayments — likely a typo. Tiny
      // overpayments (≤ ₹10 rounding) we accept silently.
      if (overpay > 10) {
        const err = new Error(
          `Settled amount ₹${settledAmount} exceeds approved ₹${approved} by ₹${overpay}. ` +
          `Re-approve the higher amount via /tpa-approve first, then settle.`,
        );
        err.status = 400; throw err;
      }

      // Post the TPA payment row (idempotent on transactionId — if the same
      // UTR has been posted before, reject so we don't double-credit).
      const duplicate = (bill.payments || []).find(
        (p) => p.paymentMode === "TPA_CLAIM" && p.transactionId === String(req.body.transactionId).trim(),
      );
      if (duplicate) {
        const err = new Error(`TPA payment with transactionId '${req.body.transactionId}' already recorded on this bill.`);
        err.status = 409; throw err;
      }

      bill.payments = bill.payments || [];
      if (settledAmount > 0) {
        // R7ap-F28/D6-17: capture TDS deducted by TPA at settlement time
        // (typically 10% u/s 194J for professional fees, 2% u/s 194C for
        // contractual). Hospital books need it for 26AS reconciliation.
        const tdsAmount   = Number(req.body.tdsAmount || 0);
        const tdsCertNo   = String(req.body.tdsCertificateNo || "").trim() || null;
        const tdsSection  = String(req.body.tdsSection || "").trim() || null;
        bill.payments.push({
          amount:        settledAmount,
          paymentMode:   "TPA_CLAIM",
          transactionId: String(req.body.transactionId).trim(),
          paidAt:        settledOn,
          receivedBy:    settledBy,
          remarks:       req.body.remarks || `TPA settlement against approved ₹${approved}` + (tdsAmount > 0 ? ` (TDS ₹${tdsAmount} ${tdsSection || ""})` : ""),
          tdsAmount,
          tdsCertificateNo: tdsCertNo,
          tdsSection,
        });
      }

      // Reconcile shortfall.
      //
      // R7ab CRITICAL fix: the previous R7z version of this block mutated
      // `bill.patientPayableAmount` directly, but the bill's pre-save
      // recalcTotals() ALWAYS overwrites that field from sum(item.tpaPay) /
      // billing-type — so the bump never persisted and the patient was
      // never charged for the TPA shortfall. We now route the shortfall
      // through fields the hook respects:
      //   • PATIENT (default) — flip every line item's tpaPayableAmount to
      //     0 + patientPayableAmount to its gross share. The hook re-sums
      //     and `patientPayableAmount` ends up = net (sans extraDiscount).
      //   • WRITEOFF — add to extraDiscount + reason. The hook subtracts
      //     extraDiscount from netAmount + patientPayableAmount in place,
      //     collapsing the bill to whatever the TPA actually paid.
      const priorStatus  = bill.tpaClaimStatus;
      const priorPatient = toN(bill.patientPayableAmount);
      const priorExtra   = toN(bill.extraDiscount);
      if (shortfall > 0) {
        if (shortfallTo === "WRITEOFF") {
          bill.extraDiscount = priorExtra + shortfall;
          bill.extraDiscountReason = (bill.extraDiscountReason || "") +
            ` | TPA short-pay write-off ₹${shortfall.toFixed(2)} on UTR ${req.body.transactionId}`;
          bill.extraDiscountBy = settledBy;
          bill.tpaClaimStatus  = "REJECTED";
          bill.remarks = (bill.remarks || "") +
            ` | TPA settled ₹${settledAmount} of approved ₹${approved}; ₹${shortfall.toFixed(2)} written off`;
        } else {
          // Patient liability bump — re-tag each TPA line item so the hook
          // recomputes patientPayableAmount upward.
          const totalTpaShare = (bill.billItems || []).reduce(
            (s, i) => s + toN(i.tpaPayableAmount), 0);
          if (totalTpaShare > 0) {
            let remaining = shortfall;
            for (const item of bill.billItems) {
              const itemTpa = toN(item.tpaPayableAmount);
              if (itemTpa <= 0) continue;
              const moveRaw = (itemTpa / totalTpaShare) * shortfall;
              const move = Math.min(moveRaw, itemTpa, remaining);
              const itemPt = toN(item.patientPayableAmount);
              item.tpaPayableAmount     = Number((itemTpa - move).toFixed(2));
              item.patientPayableAmount = Number((itemPt + move).toFixed(2));
              // R7au-FIX-4/D5-CRIT-C6: also recompute (or zero) the
              // line's `tpaPercent` so PatientBill pre-save's
              // `recalcTotals()` doesn't re-derive the OLD split on
              // the next save. Pre-R7au we mutated absolute values but
              // left tpaPercent at the original (e.g. 80%) — the hook
              // re-applied `lineTotal × 80/100` on next touch and
              // silently reverted the shortfall split. % policies
              // (the common TPA case) silently dropped the patient
              // liability bump. Now: rebase percent to the post-move
              // share of the line total so subsequent recalc agrees.
              const lineTotal = toN(item.netAmount) || (itemTpa + itemPt);
              if (lineTotal > 0) {
                item.tpaPercent = Math.max(0, Math.min(100,
                  Number(((item.tpaPayableAmount / lineTotal) * 100).toFixed(2)),
                ));
              } else {
                item.tpaPercent = 0;
              }
              remaining -= move;
              if (remaining <= 0.005) break;
            }
            bill.markModified("billItems");
          } else {
            bill.extraDiscount = priorExtra + shortfall;
            bill.extraDiscountReason = (bill.extraDiscountReason || "") +
              ` | TPA short-pay ₹${shortfall.toFixed(2)} (no per-line split — collected from patient at desk)`;
            bill.extraDiscountBy = settledBy;
          }
          bill.tpaClaimStatus = "PARTIAL_APPROVED";
          bill.remarks = (bill.remarks || "") +
            ` | TPA settled ₹${settledAmount} of approved ₹${approved}; ₹${shortfall.toFixed(2)} → patient liability`;
        }
      } else {
        // Fully settled — keep APPROVED (the schema enum has no SETTLED
        // value; APPROVED + a TPA_CLAIM payment row is the signal).
        bill.remarks = (bill.remarks || "") + ` | TPA fully settled ₹${settledAmount} on UTR ${req.body.transactionId}`;
      }

      // Audit trail entry — captures the full before/after.
      bill.adjustmentLog = bill.adjustmentLog || [];
      bill.adjustmentLog.push({
        at:     settledOn,
        by:     settledBy,
        type:   "EXTRA_DISCOUNT",   // re-use existing enum bucket for any financial event
        reason: `TPA settlement: paid ₹${settledAmount} of approved ₹${approved} (shortfall ₹${shortfall.toFixed(2)} → ${shortfallTo}). UTR: ${req.body.transactionId}`,
        before: { tpaClaimStatus: priorStatus, patientPayableAmount: priorPatient, extraDiscount: priorExtra },
        after:  { tpaClaimStatus: bill.tpaClaimStatus, settledAmount, shortfallTo },
      });

      bill.markModified("tpaClaimStatus");
      bill.markModified("payments");

      await bill.save();
      return { bill, approved, shortfall, priorStatus, priorPatient, priorExtra };
    }, { label: "tpaSettle" });

    const { bill, approved, shortfall, priorStatus, priorPatient, priorExtra } = result;

    // R7ap-F15: TPA settle audit — emitted outside retry so a retried save
    // doesn't double-emit.
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:        "TPA_SETTLED",
        UHID:         bill.UHID,
        patientId:    bill.patient,
        billId:       bill._id,
        billNumber:   bill.billNumber,
        amount:       settledAmount,
        paymentMode:  "TPA_CLAIM",
        transactionId:req.body.transactionId,
        actorName:    settledBy,
        reason:       `TPA settled ₹${settledAmount} of approved ₹${approved} (shortfall ₹${shortfall.toFixed(2)} → ${shortfallTo}). UTR: ${req.body.transactionId}`,
        before:       { tpaClaimStatus: priorStatus, patientPayableAmount: priorPatient, extraDiscount: priorExtra },
        after:        { tpaClaimStatus: bill.tpaClaimStatus, settledAmount, shortfallTo },
      }, { req });
    } catch (_) { /* audit best-effort */ }
    // R7ar-P1-7: invalidate Day Book — TPA receipts feed the by-mode tile.
    try { exports.invalidateDayBookCache(); } catch (_) {}
    return res.json({
      success: true,
      data: bill,
      settled: { approved, settledAmount, shortfall, shortfallTo },
    });
  } catch (e) {
    if (e?.status && !res.headersSent) {
      return res.status(e.status).json({ success: false, message: e.message });
    }
    next(e);
  }
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
// R7ap-F24/D8-01: 30s LRU cache for Day Book — 5 cashiers refreshing the
// dashboard no longer translates into 5 collection scans of PatientBill.
// R7ar-P1-7/D2-aq-02: exported so mutation paths can invalidate after
// recordPayment / refund / advance / void. Pre-R7ar the cache stayed stale
// for up to 30s after a cashier touch — head desk handover misled.
const _collectionSummaryCache = require("../../utils/lruCache")({ max: 30, ttlMs: 30_000 });
exports._collectionSummaryCache = _collectionSummaryCache;
// Helper for invalidation — formats today's IST key and clears it from cache.
exports.invalidateDayBookCache = function invalidateDayBookCache() {
  try {
    // IST date key — matches the cache-write side.
    const istKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: process.env.HOSPITAL_TZ || "Asia/Kolkata",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    _collectionSummaryCache.invalidate(`daybook:${istKey}`);
    // Also invalidate UTC-key just in case of mismatch (P1-8 fix below).
    _collectionSummaryCache.invalidate(`daybook:${new Date().toISOString().slice(0, 10)}`);
  } catch (_) { /* invalidation is best-effort */ }
};

exports.getCollectionSummary = async (req, res, next) => {
  try {
    // R7ar-P1-8/D2-aq-03: use IST calendar day not UTC ISO. Pre-R7ar a
    // request at 00:35 IST defaulted to YESTERDAY because `toISOString()`
    // returned UTC date which had already rolled over (UTC was 19:05 prev day).
    const istKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: process.env.HOSPITAL_TZ || "Asia/Kolkata",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    // Validate user-supplied date and reject obvious garbage to prevent
    // cache-key pollution (D3-aq-06).
    let dateStr = req.query.date || istKey;
    if (req.query.date && !/^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
      return res.status(400).json({ success: false, message: "Invalid date — expected YYYY-MM-DD" });
    }
    const cacheKey = `daybook:${dateStr}`;
    const payload  = await _collectionSummaryCache.get(cacheKey, () => computeCollectionSummary(dateStr));
    res.json(payload);
  } catch (e) { next(e); }
};

async function computeCollectionSummary(dateStr) {
  const PatientBill     = require("../../models/PatientBillModel/PatientBillModel");
  const PatientAdvance  = require("../../models/PatientBillModel/PatientAdvanceModel");
  const { toNum }       = require("../../utils/money");
  {
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd   = new Date(`${dateStr}T23:59:59.999`);

    // R7ap-F1/F2/F12: switch attribution from bill.updatedAt to payments[].paidAt
    // — fixes wrong-day attribution (D2-02, D5-04/06). DRAFT excluded (D2-01).
    const bills = await PatientBill.find({
      billStatus: { $nin: ["DRAFT"] },
      $or: [
        // Bills with at least one payment in window OR bills created in window
        { "payments.paidAt": { $gte: dayStart, $lte: dayEnd } },
        { createdAt: { $gte: dayStart, $lte: dayEnd } },
      ],
    })
      // R7av-FIX-2/D8-HIGH-2: project only the fields the reducers below
      // actually read. Pre-R7av every cache miss loaded billItems[] +
      // adjustmentLog[] for every bill → 50-100 MB heap spike on 500-
      // bill days. The reducers consume payments, billItems.netAmount,
      // visitType, paymentType, doctor, createdBy + a few money totals.
      .select("payments billItems.netAmount billItems.category billItems.excludedByPackage visitType paymentType doctor doctorName createdBy createdByName netAmount netPayable grossAmount totalAmount balanceAmount patientPayableAmount advancePaid totalPaid amountPaid")
      .lean();

    // Aggregators
    let totalCollected = 0, totalGross = 0, totalPending = 0, advanceDue = 0, tpaPending = 0;
    let advancesApplied = 0, advanceDepositsIn = 0, advanceRefundsOut = 0, billRefundsOut = 0;
    // R7ar-P2-28/D5-aq-03: TDS deducted by TPA payers at settlement is
    // NOT cash in the till — it's a govt receivable on Form 26AS. Track
    // separately so netCashFlow reflects what's actually in the drawer.
    let totalTdsDeducted = 0;
    let txnCount = 0;
    const byVisitType = { OPD: 0, IPD: 0, DC: 0, ER: 0, Services: 0, Other: 0 };
    const byVisitTxn  = { OPD: 0, IPD: 0, DC: 0, ER: 0, Services: 0, Other: 0 };
    // R7ar-P0-6/D2-aq-01: byMode keys are UPPERCASE to match PaymentSchema enum
    // (CASH/CARD/UPI/CHEQUE/ONLINE/TPA_CLAIM/ADVANCE_ADJUSTMENT). Pre-R7ar
    // the seed used mixed-case ("Cash"/"Card") but the incoming `paymentMode`
    // was uppercase, so the loop created NEW keys ("CASH":N, "CARD":M) while
    // the seeded zero-buckets remained — the UI shows two rows for the same
    // mode + the seeded row always reads ₹0.
    const byMode      = {
      CASH: 0, CARD: 0, UPI: 0, CHEQUE: 0, ONLINE: 0,
      TPA_CLAIM: 0, TPA: 0, INSURANCE: 0, CORPORATE: 0,
      BANK_TRANSFER: 0, Other: 0,
    };
    const byDoctor    = {};  // { doctorId: { name, count, amount } }
    const byReceptionist = {};

    for (const b of bills) {
      // R7ap-F1: toNum() unwraps Decimal128. R7ap-D2-02: today-only attribution.
      const gross = toNum(b.netAmount ?? b.netPayable ?? b.grossAmount ?? b.totalAmount);
      txnCount += 1;
      // Per-payment attribution: only sum payment rows that landed today.
      // Refunds (negative rows) net into today's collection on the refund date.
      const payments = Array.isArray(b.payments) ? b.payments : [];
      let billPaidToday = 0;
      for (const p of payments) {
        if (p.voidedAt) continue;                                          // R7ap-D2-03: skip voided
        const pAt = p.paidAt ? new Date(p.paidAt) : null;
        if (!pAt || pAt < dayStart || pAt > dayEnd) continue;
        const amt = toNum(p.amount);
        // R7ar-P0-6/D2-aq-01: normalise mode to UPPERCASE so byMode buckets
        // don't get duplicated as Cash/CASH/cash.
        const m   = (p.mode || p.paymentMode || "Other").toString().toUpperCase();
        // R7ap-F2/D5-03: ADVANCE_ADJUSTMENT is an INTERNAL transfer, not new
        // cash. Track separately so the accountant sees what was "applied
        // from pool" without confusing it with cash inflow.
        if (m === "ADVANCE_ADJUSTMENT") {
          if (amt > 0) advancesApplied += amt;
          billPaidToday += amt; // counts toward bill-level paid (it's still a payment)
          continue;
        }
        // R7ar-P2-28/D5-aq-03: aggregate TDS so we can subtract from netCashFlow.
        if (p.tdsAmount && Number(p.tdsAmount) > 0) {
          totalTdsDeducted += Number(p.tdsAmount);
        }
        // Separate refund (negative payment) totals from gross collection so
        // Day Book can show "Cash In" / "Refund Out" cleanly.
        if (amt < 0) {
          billRefundsOut += -amt;
        } else {
          totalCollected += amt;
        }
        if (byMode[m] === undefined) byMode[m] = 0;
        byMode[m] += amt;
        billPaidToday += amt;
      }
      // Bill-level pending derived from authoritative balance (R7am pattern).
      const itemsNet  = (b.billItems || []).reduce((s, it) => s + toNum(it.netAmount), 0);
      const refNet    = Math.max(toNum(b.patientPayableAmount), gross, itemsNet);
      const positive  = payments.reduce((s, p) => { const v = toNum(p.amount); return s + (v > 0 ? v : 0); }, 0);
      const pending   = Math.max(0, refNet - positive);
      totalGross   += gross;
      totalPending += pending;

      // Visit type bucket — credit each bill's TODAY paid amount.
      const vt = (b.visitType || b.patientType || "Other").toString().toUpperCase();
      const key = vt.startsWith("OPD")        ? "OPD"
                : vt.startsWith("IPD")        ? "IPD"
                : vt.includes("DAY")          ? "DC"
                : vt.startsWith("ER") || vt.includes("EMERGENCY") ? "ER"
                : vt.startsWith("SERV")       ? "Services"
                : "Other";
      byVisitType[key] += Math.max(0, billPaidToday);
      byVisitTxn[key]  += 1;

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
        byDoctor[did].amount += Math.max(0, billPaidToday);
      }

      // Per-receptionist (createdBy or last updater)
      const recId = String(b.createdBy || b.updatedBy || "unknown");
      if (!byReceptionist[recId]) byReceptionist[recId] = { id: recId, name: b.createdByName || "Unknown", count: 0, amount: 0 };
      byReceptionist[recId].count += 1;
      byReceptionist[recId].amount += Math.max(0, billPaidToday);

      // Outstanding categorization
      if (pending > 0) {
        if (key === "IPD") advanceDue += pending;
        else if ((b.paymentType || "").toLowerCase().includes("tpa") || (b.paymentType || "").toLowerCase().includes("insurance"))
          tpaPending += pending;
      }
    }

    // R7ap-F12/D5-02: include advance DEPOSITS taken today (real cash inflow).
    // PatientAdvance.create is the first cash-touch — bills only see the
    // money later via ADVANCE_ADJUSTMENT (which we explicitly exclude above).
    // R7ar-P0-5/D5-aq-01: exclude `isRefundCredit:true` rows — those are
    // internal transfers of refunded bill money into the advance pool,
    // NOT new cash. They're already counted as billRefundsOut from the
    // bill's negative payment row.
    const advancesToday = await PatientAdvance.find({
      paidAt: { $gte: dayStart, $lte: dayEnd },
      isRefundCredit: { $ne: true },
    }).lean();
    for (const a of advancesToday) {
      const amt = toNum(a.amount);
      const m   = (a.paymentMode || "Cash").toString().toUpperCase();   // R7ar-P0-6
      advanceDepositsIn += amt;
      totalCollected   += amt;
      if (byMode[m] === undefined) byMode[m] = 0;
      byMode[m] += amt;
    }

    // R7ap-F11/D5-01: include advance REFUNDS issued today (cash OUTflow).
    const refundsToday = await PatientAdvance.find({
      status:     "REFUNDED",
      refundedAt: { $gte: dayStart, $lte: dayEnd },
    }).lean();
    for (const a of refundsToday) {
      const amt  = toNum(a.refundedAmount);
      // R7ar-P0-6: uppercase normalization
      const mode = (a.refundMode || "CASH").toString().toUpperCase();
      advanceRefundsOut += amt;
      if (byMode[mode] === undefined) byMode[mode] = 0;
      byMode[mode] -= amt; // refund out reduces mode net
    }

    // R7ap-F11/F12: net cash flow = collections − bill refunds − advance refunds.
    // R7ar-P2-28/D5-aq-03: subtract TDS too (it's a receivable, not till cash).
    const netCashFlow = totalCollected - billRefundsOut - advanceRefundsOut - totalTdsDeducted;
    return {
      success: true,
      date: dateStr,
      summary: {
        totalCollected, totalGross, totalPending, txnCount, advanceDue, tpaPending,
        advancesApplied, advanceDepositsIn, advanceRefundsOut, billRefundsOut, netCashFlow,
        totalTdsDeducted,           // R7ar-P2-28
      },
      byVisitType: Object.entries(byVisitType).map(([type, amount]) => ({ type, amount, count: byVisitTxn[type] || 0 })),
      byMode:      Object.entries(byMode).filter(([, v]) => v !== 0).map(([mode, amount]) => ({ mode, amount })),
      byDoctor:    Object.values(byDoctor).sort((a, b) => b.amount - a.amount),
      byReceptionist: Object.values(byReceptionist),
    };
  }
}

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
    // R7ap-F23/D3-08: dual shape during migration — new clients can use
    // top-level `data` (array) + `meta.totalUnspent`, old clients still
    // get `data.advances` and `data.totalUnspent`. Frontend should
    // migrate to the new shape and the legacy nested form can be
    // removed in a future cleanup.
    res.json({
      success: true,
      data:    { advances: rows, totalUnspent },   // legacy
      advances: rows,                              // new (top-level alias)
      meta:    { totalUnspent, count: rows.length },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Advance list failed" });
  }
};

// R7ap-F34/D6-10: GET /api/billing/sequence-audit?year=YYYY
// Detect gaps in BILL-* / ADV-* / CN-* sequences (Income-Tax §44AB
// requires gap-less invoice + receipt sequences). Returns the list of
// MISSING numbers per series, so accountant can investigate (typically
// a save that failed AFTER the counter incremented).
exports.sequenceAudit = async (req, res, next) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const PatientBill    = require("../../models/PatientBillModel/PatientBillModel");
    const PatientAdvance = require("../../models/PatientBillModel/PatientAdvanceModel");
    const CreditNote     = require("../../models/Billing/CreditNote");

    const checkGaps = async (Model, field, prefix, padLen) => {
      const rows = await Model.find({ [field]: { $regex: `^${prefix}` } }).select(field).lean();
      const nums = rows.map((r) => parseInt(r[field].slice(-padLen), 10)).filter(Number.isFinite).sort((a, b) => a - b);
      if (nums.length === 0) return { prefix, total: 0, max: 0, missing: [] };
      const max = nums[nums.length - 1];
      const present = new Set(nums);
      const missing = [];
      for (let i = 1; i <= max; i++) if (!present.has(i)) missing.push(`${prefix}${String(i).padStart(padLen, "0")}`);
      return { prefix, total: nums.length, max, missing };
    };

    const [bills, advances, creditNotes] = await Promise.all([
      checkGaps(PatientBill,    "billNumber",     `BILL-${year}-`, 6),
      checkGaps(PatientAdvance, "receiptNumber",  `ADV-${year}-`,  6),
      checkGaps(CreditNote,     "creditNoteNumber", `CN-${year}-`, 6),
    ]);

    res.json({
      success: true,
      data: {
        year,
        bills,
        advances,
        creditNotes,
        anyGaps: bills.missing.length + advances.missing.length + creditNotes.missing.length > 0,
      },
    });
  } catch (e) { next(e); }
};

// R7ap-F17/D9-13: GET /api/billing/uhid/:UHID/summary
// Single canonical totals endpoint for a UHID — used by ReceptionBilling,
// PatientLookupPage, IPDBillingLedger, DischargeQueue. Pre-R7ap each page
// computed its own totals from /billing/uhid/:UHID with different field
// fallbacks (some used `b.totalPaid ?? b.paidAmount`, others `gross - due`)
// and got different numbers for the same patient. Centralising the math.
exports.getUhidSummary = async (req, res, next) => {
  try {
    const PatientBill    = require("../../models/PatientBillModel/PatientBillModel");
    const PatientAdvance = require("../../models/PatientBillModel/PatientAdvanceModel");
    const { toNum }      = require("../../utils/money");
    const UHID = String(req.params.UHID || "").toUpperCase();
    if (!UHID) return res.status(400).json({ success: false, message: "UHID required" });

    const [bills, advances] = await Promise.all([
      PatientBill.find({ UHID }).select("billNumber billDate billStatus visitType paymentType netAmount patientPayableAmount balanceAmount advancePaid grossAmount billItems payments tpaClaimStatus").lean(),
      PatientAdvance.find({ UHID }).lean(),
    ]);

    // Same eff() formula as Frontend/src/utils/money.js
    const eff = (b) => {
      const itemsNet = (b.billItems || []).reduce((s, it) => s + toNum(it.netAmount), 0);
      const refNet   = Math.max(toNum(b.patientPayableAmount), toNum(b.netAmount), itemsNet);
      const paidPos  = (b.payments || []).reduce((s, p) => { const v = toNum(p.amount); return s + (v > 0 ? v : 0); }, 0);
      const stored   = toNum(b.balanceAmount);
      const due      = stored > 0 ? stored : Math.max(0, refNet - paidPos);
      return { gross: refNet, paid: Math.max(0, refNet - due), due };
    };

    const totals       = { bills: 0, drafts: 0, open: 0, gross: 0, paid: 0, due: 0 };
    const byVisitType  = {};
    const byBillList   = [];

    for (const b of bills) {
      if (b.billStatus === "CANCELLED") continue;
      const e = eff(b);
      totals.bills += 1;
      if (b.billStatus === "DRAFT") totals.drafts += 1;
      if (b.billStatus === "GENERATED" || b.billStatus === "PARTIAL") totals.open += 1;
      totals.gross += e.gross;
      totals.paid  += e.paid;
      totals.due   += e.due;

      const key = (b.visitType || "Other").toString();
      if (!byVisitType[key]) byVisitType[key] = { count: 0, gross: 0, paid: 0, due: 0 };
      byVisitType[key].count += 1;
      byVisitType[key].gross += e.gross;
      byVisitType[key].paid  += e.paid;
      byVisitType[key].due   += e.due;

      byBillList.push({
        _id:         b._id,
        billNumber:  b.billNumber,
        billDate:    b.billDate,
        visitType:   b.visitType,
        paymentType: b.paymentType,
        billStatus:  b.billStatus,
        gross:       e.gross,
        paid:        e.paid,
        due:         e.due,
      });
    }

    // Advance pool: UHID-level refundable credit (deposits minus applied minus refunded).
    const advance = {
      total:           0,
      applied:         0,
      refunded:        0,
      unspent:         0,
      activeCount:     0,
    };
    for (const a of advances) {
      advance.total    += toNum(a.amount);
      advance.applied  += toNum(a.appliedAmount);
      advance.refunded += toNum(a.refundedAmount);
      if (a.status === "ACTIVE" || a.status === "PARTIALLY_APPLIED") advance.activeCount += 1;
    }
    advance.unspent = Math.max(0, advance.total - advance.applied - advance.refunded);

    res.json({
      success: true,
      data: {
        UHID,
        totals,
        byVisitType: Object.entries(byVisitType).map(([visitType, v]) => ({ visitType, ...v })),
        byBill: byBillList.sort((a, b) => new Date(b.billDate || 0) - new Date(a.billDate || 0)),
        advance,
      },
    });
  } catch (e) { next(e); }
};

// R7ap-F15: GET /api/billing/audit?from&to&event&UHID&billId&limit
// Single chronological view of every billing audit event (the BillingAudit
// collection added by R7ap). Accountant uses this to reconstruct refund
// history, payment audit, cancel chain, TPA settlements for NABH AAC.7.
exports.listBillingAudit = async (req, res, next) => {
  try {
    const BillingAudit = require("../../models/Billing/BillingAudit");
    const mongoose = require("mongoose");
    const filter = {};
    if (req.query.event)  filter.event  = req.query.event;
    if (req.query.UHID)   filter.UHID   = String(req.query.UHID).toUpperCase();
    if (req.query.billId) {
      // R7av-FIX-4/D2-MED-2: ObjectId validate before stuffing into filter
      // — bad input previously CastError 500'd.
      if (!mongoose.isValidObjectId(req.query.billId)) {
        return res.status(400).json({ success: false, message: "billId must be a valid ObjectId" });
      }
      filter.billId = req.query.billId;
    }
    if (req.query.from || req.query.to) {
      try {
        // R7av-FIX-1/D2-HIGH-1: strict date parse — pre-R7av invalid
        // dates produced `Invalid Date` and Mongo treated `$gte:Invalid`
        // as wide-open. Default last 90d when both present so the audit
        // page works without a window picker.
        const { parseHospitalDate } = require("../../utils/queryGuards");
        filter.createdAt = {};
        if (req.query.from) filter.createdAt.$gte = parseHospitalDate(req.query.from);
        if (req.query.to)   filter.createdAt.$lte = parseHospitalDate(req.query.to, { endOfDay: true });
      } catch (e) {
        return res.status(400).json({ success: false, message: e.message });
      }
    }
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    // R7av-FIX-5/D8-MED-4: project out before/after Mixed blobs by default
    // (each can be ~12KB → 500-row page = 6MB payload). Caller can opt
    // back in via ?include=before,after for a specific row inspect.
    const include = String(req.query.include || "");
    const proj = include.includes("before") || include.includes("after")
      ? {} : { before: 0, after: 0 };
    const rows = await BillingAudit.find(filter, proj).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ success: true, data: rows, meta: { count: rows.length, limit } });
  } catch (e) { next(e); }
};

// R7ap-F13/C-08/D5-10/D6-04: GET /api/billing/gst-register?from&to
// Hospital-service GST aggregator. Pre-R7ap the GSTTab only saw pharmacy
// GST; hospital service GST (consultation/room/procedure/investigation)
// was data-resident but no endpoint exposed it. Buckets by tax rate +
// returns CGST/SGST split (50/50 of taxAmount — IGST cross-state split
// requires placeOfSupply work, tracked as D6-04).
exports.getHospitalGstRegister = async (req, res, next) => {
  try {
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
    const CreditNote  = require("../../models/Billing/CreditNote");
    const GstMonthlySnapshot = require("../../models/Billing/GstMonthlySnapshot");
    const { toNum }   = require("../../utils/money");
    // R7av-FIX-1/D2-HIGH-1 + D8-HIGH-5: strict date parse + 5-min cache.
    // GST register data changes slowly (most period rows are frozen via
    // monthly snapshot) so caching aggressively is safe.
    let from, to;
    try {
      ({ from, to } = _safeRange(req, { defaultDays: 30, maxDays: 366 }));
    } catch (e) {
      return res.status(e.status || 400).json({ success: false, message: e.message });
    }
    const cacheKey = `gstreg:${from.toISOString()}:${to.toISOString()}`;
    const payload = await _gstRegCache.get(cacheKey, async () => {

    // Aggregate over GENERATED/PARTIAL/PAID/REFUNDED bills only (DRAFT/CANCELLED
    // not yet finalised). For each line item, bucket by taxPercent.
    // R7as-FIX-6/D6-crit-2: unified on `billGeneratedAt` (immutable, set
    // at DRAFT→GENERATED) so the register window matches the monthly
    // snapshot cron exactly. Pre-R7as the register filtered by `billDate`
    // (editable, defaults to creation) while the cron froze by
    // `billGeneratedAt` — period attribution drifted whenever a cashier
    // re-edited billDate on a late-night bill near month boundary.
    // R7av-FIX-6/D6-HIGH-1: aggregate the per-item CGST/SGST/IGST
    // amounts directly instead of hard-coding `taxAmount/2` for both.
    // Pre-R7av the register reported inter-state IGST as 50/50 intra-
    // state — register vs monthly-snapshot drift on every IGST bill.
    const pipeline = [
      { $match: {
          billStatus:      { $nin: ["DRAFT", "CANCELLED"] },
          billGeneratedAt: { $gte: from, $lte: to },
      }},
      { $unwind: "$billItems" },
      { $match: { "billItems.isTaxable": true, "billItems.taxPercent": { $gt: 0 } } },
      { $group: {
          _id:           "$billItems.taxPercent",
          bills:         { $addToSet: "$_id" },
          itemCount:     { $sum: 1 },
          taxableValue:  { $sum: { $toDouble: "$billItems.netAmount" } },
          taxAmount:     { $sum: { $toDouble: "$billItems.taxAmount" } },
          cgst:          { $sum: { $toDouble: { $ifNull: ["$billItems.cgstAmount", 0] } } },
          sgst:          { $sum: { $toDouble: { $ifNull: ["$billItems.sgstAmount", 0] } } },
          igst:          { $sum: { $toDouble: { $ifNull: ["$billItems.igstAmount", 0] } } },
      }},
      { $project: {
          _id: 0,
          rate:         "$_id",
          billCount:    { $size: "$bills" },
          itemCount:    1,
          taxableValue: 1,
          taxAmount:    1,
          cgst:         1,
          sgst:         1,
          igst:         1,
      }},
      { $sort: { rate: 1 } },
    ];
    const buckets = await PatientBill.aggregate(pipeline);
    const grossTotals = buckets.reduce(
      (acc, b) => ({
        taxableValue: acc.taxableValue + toNum(b.taxableValue),
        cgst:         acc.cgst         + toNum(b.cgst),
        sgst:         acc.sgst         + toNum(b.sgst),
        igst:         acc.igst         + toNum(b.igst),
        taxAmount:    acc.taxAmount    + toNum(b.taxAmount),
        billCount:    acc.billCount    + (b.billCount || 0),
        itemCount:    acc.itemCount    + (b.itemCount || 0),
      }),
      { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, taxAmount: 0, billCount: 0, itemCount: 0 },
    );

    // R7ar-P1-15/D6-aq-08: subtract CreditNote reversals from the
    // register. Pre-R7ar the GST register showed gross outward supply
    // only — refund credit-notes lived in a separate doc but the
    // GSTR-1 net (outward − CDNR) was hand-computed by the accountant
    // every month. Now the API returns gross + reversed + net.
    const cnAgg = await CreditNote.aggregate([
      { $match: { creditNoteDate: { $gte: from, $lte: to } } },
      { $group: {
          _id: null,
          count:        { $sum: 1 },
          taxableValue: { $sum: { $toDouble: "$taxableValue" } },
          cgst:         { $sum: { $toDouble: "$cgstAmount" } },
          sgst:         { $sum: { $toDouble: "$sgstAmount" } },
          igst:         { $sum: { $toDouble: "$igstAmount" } },
          taxAmount:    { $sum: { $toDouble: "$taxAmount" } },
      } },
    ]);
    const reversals = cnAgg[0] || { count: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, taxAmount: 0 };

    const totals = {
      ...grossTotals,
      // Net = gross outward − refunds (CDNR reversal). Now includes
      // IGST so inter-state reversals are visible (R7av-FIX-6).
      netTaxableValue: grossTotals.taxableValue - toNum(reversals.taxableValue),
      netCgst:         grossTotals.cgst         - toNum(reversals.cgst),
      netSgst:         grossTotals.sgst         - toNum(reversals.sgst),
      netIgst:         grossTotals.igst         - toNum(reversals.igst),
      netTaxAmount:    grossTotals.taxAmount    - toNum(reversals.taxAmount),
      reversed: {
        count:        reversals.count,
        taxableValue: toNum(reversals.taxableValue),
        cgst:         toNum(reversals.cgst),
        sgst:         toNum(reversals.sgst),
        igst:         toNum(reversals.igst),
        taxAmount:    toNum(reversals.taxAmount),
      },
    };

    // Surface any frozen monthly snapshots in the window so the
    // accountant can tell which periods are LOCKED (filed) vs. open.
    const snapshots = await GstMonthlySnapshot.find({
      periodStart: { $lte: to },
      periodEnd:   { $gte: from },
    }).sort({ periodStart: 1 }).lean();

      return {
        from: from.toISOString().slice(0, 10),
        to:   to.toISOString().slice(0, 10),
        buckets,
        totals,
        snapshots,                                // R7ar-P1-23
      };
    });
    res.json({ success: true, data: payload });
  } catch (e) { next(e); }
};

// R7ar-P1-15/D6-aq-08: GET /api/billing/credit-notes?from=&to=&UHID=
// Surfaces every GST-Act §34 credit note (refund reversal) within the
// window. Pre-R7ar the CN docs were created by recordRefund but had no
// listing endpoint — the accountant couldn't see them in /accounts.
exports.listCreditNotes = async (req, res, next) => {
  try {
    const CreditNote = require("../../models/Billing/CreditNote");
    const { decimalToNumber } = require("../../utils/money");
    const { parseHospitalDate } = require("../../utils/queryGuards");
    const filter = {};
    // R7av-FIX-1/D2-HIGH-1: strict date validation.
    if (req.query.from || req.query.to) {
      try {
        filter.creditNoteDate = {};
        if (req.query.from) filter.creditNoteDate.$gte = parseHospitalDate(req.query.from);
        if (req.query.to)   filter.creditNoteDate.$lte = parseHospitalDate(req.query.to, { endOfDay: true });
      } catch (e) {
        return res.status(400).json({ success: false, message: e.message });
      }
    }
    if (req.query.UHID) filter.UHID = String(req.query.UHID).toUpperCase().trim();
    if (req.query.billNumber) filter.originalBillNumber = String(req.query.billNumber).trim();
    if (req.query.reasonCode) filter.reasonCode = String(req.query.reasonCode).trim();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    // R7av-FIX-7/D8-HIGH-6: replace populate with $lookup to avoid N+1
    // round-trips. Only project the patient name fields the Refunds tab
    // actually renders.
    const rows = await CreditNote.aggregate([
      { $match: filter },
      { $sort: { creditNoteDate: -1 } },
      { $limit: limit },
      { $lookup: {
          from: "patients",
          localField: "patientId",
          foreignField: "_id",
          as: "_p",
          pipeline: [{ $project: { fullName: 1, UHID: 1, contactNumber: 1 } }],
      } },
      { $addFields: {
          patientId: { $arrayElemAt: ["$_p", 0] },
      } },
      { $project: { _p: 0 } },
    ]);
    rows.forEach((r) => decimalToNumber(null, r));
    const total = rows.reduce((s, r) => s + Number(r.refundAmount || 0), 0);
    const totalTax = rows.reduce((s, r) => s + Number(r.taxAmount || 0), 0);
    res.json({
      success: true,
      data: rows,
      meta: { count: rows.length, limit, total, totalTax },
    });
  } catch (e) { next(e); }
};

// R7ar-P1-23/D6-aq-06: GET /api/billing/gst-snapshots?from=&to= — list
// frozen monthly GST snapshots. Lets the accountant confirm what got
// written to /accounts → GST Register for each closed month.
exports.listGstSnapshots = async (req, res, next) => {
  try {
    const GstMonthlySnapshot = require("../../models/Billing/GstMonthlySnapshot");
    const { parseHospitalDate } = require("../../utils/queryGuards");
    // R7av-FIX-1/D2-HIGH-1 + D6-MED-2: strict date parse + overlap test.
    // Pre-R7av the AND-of-bounds filter `periodStart>=from && periodEnd<=to`
    // missed snapshots that STRADDLE the window (e.g. "show me Q1" =
    // 3 months, but each snapshot is 1 month). Now uses overlap:
    // `periodStart<=to && periodEnd>=from`.
    let from, to;
    try {
      from = parseHospitalDate(req.query.from);
      to   = parseHospitalDate(req.query.to, { endOfDay: true });
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }
    const filter = {};
    if (to)   filter.periodStart = { $lte: to };
    if (from) filter.periodEnd   = { $gte: from };
    const limit = Math.min(120, Math.max(1, Number(req.query.limit) || 60));
    const cacheKey = `gstsnap:${from ? from.toISOString() : ""}:${to ? to.toISOString() : ""}:${limit}`;
    const rows = await _gstSnapCache.get(cacheKey, async () =>
      GstMonthlySnapshot.find(filter).sort({ periodStart: -1 }).limit(limit).lean());
    res.json({ success: true, data: rows, meta: { count: rows.length, limit } });
  } catch (e) { next(e); }
};

// R7ar-P1-23/D6-aq-06: POST /api/billing/gst-snapshots/:period/lock
// Body: { lockedBy }
// Locks a frozen monthly snapshot (period = "YYYY-MM"). Cascades
// periodLocked:true onto every CreditNote in the same range so the
// refund flow can refuse to issue notes against the filed period
// (it'll suggest the current month and inform the patient instead).
//
// Requires reports.audit permission — same gate as the register view.
exports.lockGstSnapshot = async (req, res, next) => {
  try {
    const GstMonthlySnapshot = require("../../models/Billing/GstMonthlySnapshot");
    const CreditNote        = require("../../models/Billing/CreditNote");
    const period = String(req.params.period || "").trim();
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ success: false, message: "period must be YYYY-MM" });
    }
    const snap = await GstMonthlySnapshot.findOne({ period });
    if (!snap) {
      return res.status(404).json({
        success: false,
        message: `No snapshot for ${period} — wait for the next gst-monthly-snapshot cron run on the 1st 02:00 IST.`,
      });
    }
    if (snap.lockedAt) {
      return res.status(409).json({
        success: false,
        message: `Period ${period} is already locked since ${snap.lockedAt.toISOString().slice(0, 10)} by ${snap.lockedBy || "—"}.`,
        data: snap,
      });
    }
    snap.lockedAt   = new Date();
    snap.lockedBy   = req.body?.lockedBy || req.user?.fullName || req.user?.employeeId || "Accounts";
    snap.lockedById = req.user?._id || null;
    await snap.save();
    // Cascade onto CreditNotes in the window.
    const cn = await CreditNote.updateMany(
      { creditNoteDate: { $gte: snap.periodStart, $lt: snap.periodEnd } },
      { $set: { periodLocked: true } },
    );
    res.json({ success: true, data: snap, meta: { creditNotesLocked: cn.modifiedCount } });
  } catch (e) { next(e); }
};

// R7ap-F11/D5-01/D6-08/D9-13: GET /api/billing/advance/refunds?from&to
// Surfaces every PatientAdvance refunded within the date window. Pre-R7ap
// the Accounts → Refunds tab queried only PatientBill.status=REFUNDED, so
// advance refunds (the cash-out path introduced by R7ao) were invisible
// to the accountant. Cashier-drawer reconciliation impossible without this.
exports.listAdvanceRefunds = async (req, res) => {
  try {
    const PatientAdvance = require("../../models/PatientBillModel/PatientAdvanceModel");
    const { decimalToNumber } = require("../../utils/money");
    // R7av-FIX-1/D2-HIGH-1 + D8-HIGH-7: strict date parse + bounded limit.
    let from, to;
    try {
      ({ from, to } = _safeRange(req, { defaultDays: 30, maxDays: 366 }));
    } catch (e) {
      return res.status(e.status || 400).json({ success: false, message: e.message });
    }
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const rows = await PatientAdvance.find({
      status: "REFUNDED",
      refundedAt: { $gte: from, $lte: to },
    })
      .populate("patientId", "fullName UHID contactNumber")
      .sort({ refundedAt: -1 })
      .limit(limit)
      .lean();
    rows.forEach((r) => decimalToNumber(null, r));
    const total = rows.reduce((s, r) => s + Number(r.refundedAmount || 0), 0);
    res.json({ success: true, data: rows, meta: { count: rows.length, limit, total } });
  } catch (e) {
    res.status(500).json({ success: false, message: e?.message || "Advance refund list failed" });
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
      refundedBy:    req.body?.refundedBy   || req.user?.fullName || req.user?.employeeId,
      refundReason:  req.body?.refundReason || "Refund at patient request",
      mode:          req.body?.mode          || req.body?.refundMode,
      transactionId: req.body?.transactionId || req.body?.refundTransactionId || null,
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
    // R7ar-P0-4/D5-aq-09: reverse the excludedByPackage flag on this
    // admission's active bills so room/nursing/doctor-visit line items
    // resume contributing to gross/net. Pre-R7ar, detach left items
    // perma-excluded — patient never billed even after package removed.
    try {
      const PatientBillM = require("../../models/PatientBillModel/PatientBillModel");
      await PatientBillM.updateMany(
        { admission: adm._id, billStatus: { $in: ["DRAFT", "GENERATED", "PARTIAL"] } },
        { $set: { "billItems.$[el].excludedByPackage": false } },
        { arrayFilters: [{ "el.excludedByPackage": true }] },
      );
      const affected = await PatientBillM.find({
        admission: adm._id,
        billStatus: { $in: ["DRAFT", "GENERATED", "PARTIAL"] },
      });
      for (const b of affected) await b.save().catch(() => null);
    } catch (e) {
      console.warn("[detachPackage] excludedByPackage reverse skipped:", e.message);
    }
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
