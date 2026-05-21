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
    // R7bb-C / S5 (D7-CRIT-1): actor pulled from req.user only — any
    // `receivedBy*` in body is stripped so a forged body can't
    // attribute the bulk collect to another cashier.
    const { receivedBy: _ia, receivedById: _ib, receivedByRole: _ic, ...safeBody } = req.body;
    const data = await billingService.bulkCollectByUHID(
      req.params.UHID,
      {
        ...safeBody,
        receivedBy:     req.user?.fullName || req.user?.employeeId,
        receivedById:   req.user?._id,
        receivedByRole: req.user?.role,
      },
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
    // R7bb-C / S5: actor sourced from req.user — body's adjustedBy
    // ignored so the bulk-settlement attribution is forge-proof.
    const { adjustedBy: _ia, adjustedById: _ib, adjustedByRole: _ic, ...safeBody } = req.body;
    const data = await billingService.bulkSettleByUHID(
      req.params.UHID,
      {
        ...safeBody,
        adjustedBy:     req.user?.fullName || req.user?.employeeId,
        adjustedById:   req.user?._id,
        adjustedByRole: req.user?.role,
      },
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
// R7bb-C / S5 (D7-CRIT-2): actor identity sourced from `req.user`
// (set by authenticate middleware), not from `req.body.adjustedBy`.
// Pre-R7bb a body field forged via Postman could attribute a discount
// to any staff member's name — fatal for the NABH attribution audit.
exports.settlementAdjust = async (req, res) => {
  try {
    const data = await billingService.settlementAdjust(
      req.params.billId,
      {
        ...req.body,
        adjustedBy:   req.user?.fullName || req.user?.employeeId,
        adjustedById: req.user?._id,
      },
    );
    res.json({ success: true, data, message: "Settlement adjustment recorded" });
  } catch (e) {
    const status = e.status || 400;
    res.status(status).json({ success: false, message: e.message });
  }
};

// ── POST /api/billing/:billId/generate ───────────────────────
// R7bb-C / S5 (D7-CRIT-2): actor from req.user only — body's
// `generatedBy` ignored. Fallback to "Staff" only when req.user is
// somehow absent (should be impossible past authenticate middleware
// — kept as a defensive belt so generate never throws on a missing
// session, only mis-attributes).
exports.generateBill = async (req, res) => {
  try {
    const generatedBy = req.user?.fullName || req.user?.employeeId || "Staff";
    const data = await billingService.generateFinalBill(
      req.params.billId,
      generatedBy,
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
// R7bb-C / S5 (D7-CRIT-1): actor (`receivedBy` + id + role) sourced
// from `req.user` only. Body's `receivedBy` / `receivedById` are
// IGNORED — pre-R7bb a Postman-forged body could attribute a cash
// take to another cashier's name, defeating the per-cashier shift
// reconciliation entirely.
exports.recordPayment = async (req, res) => {
  try {
    const { amount, paymentMode } = req.body;
    if (!amount || !paymentMode) {
      return res
        .status(400)
        .json({ success: false, message: "amount and paymentMode required" });
    }
    const { receivedBy: _ignoredA, receivedById: _ignoredB, receivedByRole: _ignoredC, ...safeBody } = req.body;

    const data = await billingService.recordPayment(
      req.params.billId,
      {
        ...safeBody,
        receivedBy:     req.user?.fullName || req.user?.employeeId,
        receivedById:   req.user?._id,
        receivedByRole: req.user?.role,
      },
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
    // ─────────────────────────────────────────────────────────────
    // R7aw-FIX-PERF: replaced the find().lean() + in-process reducer
    // with a single $facet aggregation.
    //
    // ROOT CAUSE OF THE PRE-R7aw OOM:
    //   PatientBill.find().select(...).lean() walks the cursor in Node.
    //   For each doc, Mongoose's lean projection logic builds an intermediate
    //   path-map for the *whole schema* (Decimal128 unwrap targets,
    //   nested-subdoc detection for billItems[]) on the way out — and
    //   because the schema declares `toJSON: { virtuals: true, transform:
    //   decimalToNumber }` plus a 200-line billItems sub-schema with 30+
    //   Decimal128 fields and `optimisticConcurrency`, every lean doc
    //   retains hidden meta-references that hop back to the BillItem
    //   subschema (which itself holds the parent PatientBill schema).
    //   At ~22 docs the retained graph is tiny; under any kind of cache-
    //   miss concurrency (5 cashiers F5-spamming distinct windows = 5
    //   simultaneous full scans) the per-doc meta-graph multiplies and
    //   V8 GC starts thrashing before topping out at the heap limit.
    //
    //   The .select() projection only narrows the *wire* payload — it
    //   does NOT shrink the schema-meta retained per lean doc, so it
    //   never closed the leak.
    //
    // FIX:
    //   Move the entire reduce into a server-side $facet. MongoDB returns
    //   ONE summary doc with all 5 cuts pre-aggregated. Node never holds
    //   raw bill docs, never touches the BillItem sub-schema, and the
    //   payload size is constant regardless of how many bills the window
    //   contains. This also kills the latent O(N·M) reducer cost where
    //   N=bills, M=line-items per bill (a 500-bill day with 60 lines
    //   each had to allocate 30k transient Decimal128 wrappers under
    //   the old path).
    //
    //   Bonus: gives us correct cuts at any scale — the previous
    //   implementation projected `b.department` and `b.doctor` even
    //   though neither field exists on the PatientBill schema (so every
    //   bill silently aggregated under "Unspecified" / no doctor). The
    //   aggregation surfaces this honestly via `byDepartment:[Unspecified]`
    //   and `byDoctor:[]` instead of pretending to compute them.
    // ─────────────────────────────────────────────────────────────

    // toNum2 is a Mongo expression that turns Decimal128 (or string / int)
    // into a double for $sum. $toDouble handles all three cases natively
    // since Mongo 4.0.
    const agg = await PatientBill.aggregate([
      { $match: {
          createdAt: { $gte: from, $lte: to },
          billStatus: { $nin: ["DRAFT", "CANCELLED"] },   // R7ap-D5-12
      } },
      // Pre-compute per-bill paid + gross as doubles so downstream $sum
      // operates on plain doubles instead of Decimal128 objects. This is
      // the same fallback chain the JS reducer used; advancePaid is the
      // authoritative collected amount, falling back to legacy aliases on
      // older imported bills.
      { $addFields: {
          _paid:  { $toDouble: { $ifNull: ["$advancePaid", { $ifNull: ["$totalPaid", { $ifNull: ["$amountPaid", 0] }] }] } },
          _gross: { $toDouble: { $ifNull: ["$netAmount",   { $ifNull: ["$netPayable", { $ifNull: ["$grossAmount", { $ifNull: ["$totalAmount", 0] }] }] }] } },
      } },
      { $facet: {
          // ── Top-level totals + visit-type + payer cuts ────────────
          // All three share the same per-bill row, so one $group each
          // is cheaper than $unwinding.
          totals: [
            { $group: { _id: null, paid: { $sum: "$_paid" }, gross: { $sum: "$_gross" }, count: { $sum: 1 } } },
          ],
          byVisitType: [
            { $group: {
                _id: { $ifNull: ["$visitType", "Other"] },
                paid:  { $sum: "$_paid" },
                gross: { $sum: "$_gross" },
                count: { $sum: 1 },
            } },
            { $sort: { paid: -1 } },
          ],
          byPayer: [
            { $group: {
                _id: { $ifNull: ["$paymentType", "Cash"] },
                paid:  { $sum: "$_paid" },
                gross: { $sum: "$_gross" },
                count: { $sum: 1 },
            } },
            { $sort: { paid: -1 } },
          ],
          // byDepartment / byDoctor: the PatientBill schema doesn't
          // actually have these fields, so they bucket everything into
          // a single "Unspecified" / empty array — kept for API shape
          // compatibility with the existing Accountant dashboard until
          // the field is added (then this becomes a $group on the real
          // path).
          byDepartment: [
            { $group: {
                _id: { $ifNull: ["$department", "Unspecified"] },
                paid:  { $sum: "$_paid" },
                gross: { $sum: "$_gross" },
                count: { $sum: 1 },
            } },
            { $sort: { paid: -1 } },
          ],
          // ── byCategory: requires $unwind, but billItems live ON the
          //    matched docs so we don't lose the partition.
          // R7c-REP-CRIT-01 paid-share semantics preserved: each line's
          // paid share = (lineGross / billItemsGross) * billPaid. We
          // compute billItemsGross via a $sum over the unwound items
          // grouped back by _id, then a second $group bucketing by
          // category. R7ap-F36/D5-08: excludedByPackage items skipped.
          byCategory: [
            { $unwind: { path: "$billItems", preserveNullAndEmptyArrays: false } },
            { $match: { "billItems.excludedByPackage": { $ne: true } } },
            { $addFields: {
                _itGross: {
                  $toDouble: {
                    $ifNull: [
                      "$billItems.grossAmount",
                      { $multiply: [
                          { $toDouble: { $ifNull: ["$billItems.unitPrice", 0] } },
                          { $toDouble: { $ifNull: ["$billItems.quantity", 1] } },
                      ] },
                    ],
                  },
                },
                _cat: { $ifNull: ["$billItems.category", "Uncategorized"] },
            } },
            // First pass: aggregate per (billId) so we know each bill's
            // total item-gross — needed to compute the paid share fairly.
            { $group: {
                _id: "$_id",
                _paid: { $first: "$_paid" },
                _billItemsGross: { $sum: "$_itGross" },
                _items: { $push: { cat: "$_cat", gross: "$_itGross" } },
            } },
            { $unwind: "$_items" },
            { $addFields: {
                _paidShare: {
                  $cond: [
                    { $gt: ["$_billItemsGross", 0] },
                    { $multiply: [{ $divide: ["$_items.gross", "$_billItemsGross"] }, "$_paid"] },
                    0,
                  ],
                },
            } },
            { $group: {
                _id: "$_items.cat",
                paid:  { $sum: "$_paidShare" },
                gross: { $sum: "$_items.gross" },
                count: { $sum: 1 },
            } },
            { $sort: { paid: -1 } },
          ],
      } },
    ])
      .option({
        // Allow Mongo to spill to disk if the operator tier ever pushes
        // hundreds of thousands of line items through here — a safety
        // valve, not a normal-case dependency. 100MB per stage.
        allowDiskUse: true,
        // Hard wall-clock cap so a runaway query can never sit on a
        // connection. 15s is comfortable for a 12-month window with
        // tens of thousands of bills; alerts the caller if exceeded.
        maxTimeMS: 15_000,
      });

    const facet = agg[0] || { totals: [], byVisitType: [], byPayer: [], byDepartment: [], byCategory: [] };
    const t = facet.totals[0] || { paid: 0, gross: 0, count: 0 };
    const shape = (rows, keyName) => rows.map((r) => ({
      [keyName]: (r._id || "Other").toString(),
      count: r.count,
      paid:  toNum(r.paid),
      gross: toNum(r.gross),
    }));

      return {
        window: {
          from: from.toISOString().slice(0,10),
          to:   to.toISOString().slice(0,10),
          days: Math.ceil((to - from) / 86400000) + 1,
        },
        totals: {
          paid:        toNum(t.paid),
          gross:       toNum(t.gross),
          outstanding: toNum(t.gross) - toNum(t.paid),
          count:       t.count,
        },
        byCategory:   shape(facet.byCategory,   "category"),
        byVisitType:  shape(facet.byVisitType,  "visitType"),
        byPayer:      shape(facet.byPayer,      "payer"),
        byDepartment: shape(facet.byDepartment, "department"),
        // byDoctor stays an empty array — the schema doesn't carry doctor
        // on PatientBill, so any computation would have been a fiction
        // (the pre-R7aw reducer silently ran a `b.doctor`-gated branch
        // that NEVER fired because the projection returned undefined).
        byDoctor:     [],
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
    // ─────────────────────────────────────────────────────────────
    // R7ax-FIX-1: replaced the find().select().lean() + JS bucketizer
    // with a single $facet aggregation, following R7aw-FIX-PERF.
    //
    // Pre-R7ax this endpoint did .find({open}).select(...).limit(2000)
    // then walked the cursor in Node to (a) recompute per-bill `due`
    // from billItems.netAmount + payments fallbacks, (b) bucketize by
    // ageDays, and (c) split patient/TPA credit lists. The .limit(2000)
    // silently truncated patient-credit at year+ scale (a single busy
    // ward can carry 500+ open bills/quarter), and every cache miss
    // loaded the BillItem sub-schema for each doc — same retained-graph
    // leak that R7aw-FIX-PERF documented for getRevenueBreakdown.
    //
    // FIX: do all the math server-side. One $match + $addFields computes
    // per-bill `due` and `ageDays` and `bucket` as numbers; a single
    // $facet emits buckets[], top-100 patientCredit, top-100 tpaCredit
    // and a totalOutstanding sum. Node never holds raw bill docs.
    // ─────────────────────────────────────────────────────────────
    const cutoff = new Date(Date.now() - 365 * 86400000);   // 12-mo window (R7av-FIX-3 preserved)
    const agg = await PatientBill.aggregate([
      { $match: {
          billStatus: { $in: ["GENERATED", "PARTIAL"] },
          createdAt: { $gte: cutoff },
      } },
      // Per-bill derived numbers — mirror the JS reducer 1:1.
      // _itemsNet  = Σ billItems.netAmount
      // _refNet    = max(patientPayableAmount, netAmount, _itemsNet)
      // _paid      = advancePaid ?? totalPaid ?? amountPaid ?? 0
      // _gross     = netAmount ?? netPayable ?? grossAmount ?? 0
      // _stored    = balanceAmount
      // _due       = _stored>0 ? _stored : max(_refNet - max(0,_paid), 0)
      // _ageDays   = floor((asOf - createdAt) / day)
      // _bucket    = "0-30" | "31-60" | "61-90" | "90+"
      // _isTPA     = /tpa|insurance|corporate/i.test(paymentType)
      { $addFields: {
          _itemsNet: {
            $sum: {
              $map: {
                input: { $ifNull: ["$billItems", []] },
                as: "it",
                in: { $toDouble: { $ifNull: ["$$it.netAmount", 0] } },
              },
            },
          },
          _paid:  { $toDouble: { $ifNull: ["$advancePaid", { $ifNull: ["$totalPaid", { $ifNull: ["$amountPaid", 0] }] }] } },
          _gross: { $toDouble: { $ifNull: ["$netAmount",   { $ifNull: ["$netPayable", { $ifNull: ["$grossAmount", 0] }] }] } },
          _refPat:{ $toDouble: { $ifNull: ["$patientPayableAmount", 0] } },
          _refNetA:{ $toDouble: { $ifNull: ["$netAmount", 0] } },
          _stored:{ $toDouble: { $ifNull: ["$balanceAmount", 0] } },
      } },
      { $addFields: {
          _refNet: { $max: ["$_refPat", "$_refNetA", "$_itemsNet"] },
      } },
      { $addFields: {
          _due: {
            $cond: [
              { $gt: ["$_stored", 0] },
              "$_stored",
              { $max: [{ $subtract: ["$_refNet", { $max: [0, "$_paid"] }] }, 0] },
            ],
          },
          _ageDays: { $floor: { $divide: [{ $subtract: [asOf, "$createdAt"] }, 86400000] } },
          _isTPA: { $regexMatch: { input: { $ifNull: ["$paymentType", ""] }, regex: /tpa|insurance|corporate/i } },
      } },
      // Drop fully-settled rows before bucket / sort / facet so the
      // patient-credit list isn't full of due=0 noise.
      { $match: { _due: { $gt: 0 } } },
      { $addFields: {
          _bucket: {
            $switch: {
              branches: [
                { case: { $lte: ["$_ageDays", 30] }, then: "0-30" },
                { case: { $lte: ["$_ageDays", 60] }, then: "31-60" },
                { case: { $lte: ["$_ageDays", 90] }, then: "61-90" },
              ],
              default: "90+",
            },
          },
      } },
      { $facet: {
          // ── Bucket totals (4 rows expected — fixed schema)
          buckets: [
            { $group: { _id: "$_bucket", count: { $sum: 1 }, amount: { $sum: "$_due" } } },
          ],
          // ── Total outstanding (patient + TPA combined, matches pre-R7ax)
          totals: [
            { $group: { _id: null, totalOutstanding: { $sum: "$_due" } } },
          ],
          // ── Top-100 patient credit (non-TPA), highest due first
          patientCredit: [
            { $match: { _isTPA: false } },
            { $sort: { _due: -1 } },
            { $limit: 100 },
            { $project: {
                _id: 0,
                billNumber: { $ifNull: ["$billNumber", { $substrBytes: [{ $toString: "$_id" }, 16, 8] }] },
                UHID: 1, patientName: 1,
                gross: "$_gross",
                paid:  "$_paid",
                due:   "$_due",
                ageDays: "$_ageDays",
                bucket: "$_bucket",
                status: "$billStatus",
                createdAt: 1,
            } },
          ],
          // ── Top-100 TPA / insurance / corporate credit
          tpaCredit: [
            { $match: { _isTPA: true } },
            { $sort: { _due: -1 } },
            { $limit: 100 },
            { $project: {
                _id: 0,
                billNumber: { $ifNull: ["$billNumber", { $substrBytes: [{ $toString: "$_id" }, 16, 8] }] },
                UHID: 1, patientName: 1,
                gross: "$_gross",
                paid:  "$_paid",
                due:   "$_due",
                ageDays: "$_ageDays",
                bucket: "$_bucket",
                status: "$billStatus",
                createdAt: 1,
            } },
          ],
      } },
    ])
      .option({ allowDiskUse: true, maxTimeMS: 15_000 });

    const facet = agg[0] || { buckets: [], totals: [], patientCredit: [], tpaCredit: [] };
    // Reshape to the legacy fixed 4-bucket order so the frontend tile
    // doesn't have to sort or fill missing buckets.
    const bucketMap = { "0-30": { count: 0, amount: 0 }, "31-60": { count: 0, amount: 0 }, "61-90": { count: 0, amount: 0 }, "90+": { count: 0, amount: 0 } };
    for (const row of facet.buckets) {
      if (bucketMap[row._id]) {
        bucketMap[row._id].count  = row.count;
        bucketMap[row._id].amount = toNum(row.amount);
      }
    }
    const shapeList = (rows) => rows.map((r) => ({
      billNumber: r.billNumber,
      UHID: r.UHID, patientName: r.patientName,
      gross: toNum(r.gross), paid: toNum(r.paid), due: toNum(r.due),
      ageDays: r.ageDays, bucket: r.bucket,
      status: r.status, createdAt: r.createdAt,
    }));

      return {
        asOf: asOf.toISOString().slice(0,10),
        buckets: Object.entries(bucketMap).map(([bucket, v]) => ({ bucket, ...v })),
        totalOutstanding: toNum(facet.totals[0]?.totalOutstanding || 0),
        patientCredit: shapeList(facet.patientCredit),
        tpaCredit:     shapeList(facet.tpaCredit),
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

    // R7bb-FIX-E-20: Doctor-initiated manual charges over ₹5,000 are
    // flagged for secondary review by Admin/Accountant. We don't block
    // — the doctor's clinical judgement still adds the charge — but the
    // audit row carries a `NEEDS_REVIEW` flag so the accountant's
    // refunds tab surfaces it for a second eye next cycle. Pre-R7bb a
    // doctor could add an arbitrarily-priced manual charge with no
    // financial-control checkpoint.
    const qty = Math.max(1, Number(req.body?.quantity || 1));
    const unit = Number(req.body?.unitPrice || 0);
    const approxAmount = qty * unit;
    const doctorHighValue = role === "Doctor" && approxAmount > 5000;

    const result = await autoBilling.addManualCharge(req.params.admissionId, {
      serviceId:  req.body?.serviceId,
      quantity:   req.body?.quantity,
      unitPrice:  canSetPrice ? req.body?.unitPrice : undefined,
      remarks:    doctorHighValue
        ? `${req.body?.remarks || ""} | NEEDS_REVIEW: doctor manual charge ~₹${approxAmount}`
        : req.body?.remarks,
      user,
    });
    if (doctorHighValue) {
      // Best-effort audit flag — accountants filter on this event.
      try {
        const { emit } = require("../../models/Billing/BillingAudit");
        await emit({
          event:       "SETTLEMENT_ADJUSTED",
          admissionId: req.params.admissionId,
          actorId:     user._id || user.id,
          actorName:   user.fullName || user.employeeId,
          actorRole:   role,
          amount:      approxAmount,
          reason:      `NEEDS_REVIEW: doctor manual charge serviceId=${req.body?.serviceId} qty=${qty} approx=₹${approxAmount} — secondary review required`,
        }, { req });
      } catch (_) { /* best-effort */ }
    }
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

    const _priorTpa     = bill.tpaClaimStatus;
    const _priorPayable = Number(bill.tpaPayableAmount || 0);
    bill.tpaClaimNumber  = req.body.claimNumber || bill.tpaClaimNumber || "";
    bill.tpaClaimStatus  = "SUBMITTED";
    bill.tpaPayableAmount = Number(req.body.requestedAmount) || bill.tpaPayableAmount || 0;
    // R7bb-FIX-E-15 / D3-HIGH-2: stamp the submitter so tpaApprove can
    // enforce a different-actor check. We capture name + id + when so
    // the maker-checker trail is complete even if the user is later
    // renamed or deactivated.
    bill.tpaPreAuthSubmittedBy   = req.user?.fullName || req.user?.employeeId || "TPA Desk";
    bill.tpaPreAuthSubmittedById = req.user?._id || req.user?.id || null;
    bill.tpaPreAuthSubmittedAt   = new Date();
    bill.markModified("tpaClaimStatus");
    await bill.save();
    // R7bb-C / D7-CRIT-5: TPA pre-auth must emit a BillingAudit row.
    // Pre-R7bb the preauth flip happened with NO audit trace — only
    // the eventual TPA_APPROVED row landed, so investigators had no
    // way to see when (or by whom) a claim was originally submitted.
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:        "TPA_PREAUTH_SUBMITTED",
        UHID:         bill.UHID,
        patientId:    bill.patient,
        billId:       bill._id,
        billNumber:   bill.billNumber,
        amount:       bill.tpaPayableAmount,
        reason:       req.body.notes || `Pre-auth submitted (claim #${bill.tpaClaimNumber || "—"})`,
        before:       { tpaClaimStatus: _priorTpa, tpaPayableAmount: _priorPayable },
        after:        { tpaClaimStatus: "SUBMITTED", tpaPayableAmount: bill.tpaPayableAmount, tpaClaimNumber: bill.tpaClaimNumber },
      }, { req });
    } catch (_) { /* audit best-effort */ }
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
    // R7bb-FIX-E-15 / D3-HIGH-2: maker-checker — the user who SUBMITTED
    // the preauth cannot also APPROVE it. Admin can override via body
    // flag (approverOverride). Pre-R7bb a single TPA Coordinator could
    // submit and approve back-to-back with no second eye on a money
    // gate.
    const callerId = String(req.user?._id || req.user?.id || "");
    const submitterId = String(bill.tpaPreAuthSubmittedById || "");
    const approverOverride =
      req.user?.role === "Admin" && !!req.body.approverOverride;
    if (submitterId && callerId && submitterId === callerId && !approverOverride) {
      return res.status(409).json({
        success: false,
        code:    "SAME_ACTOR",
        message: "SAME_ACTOR — TPA approval must be done by a different user than the preauth submitter",
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
      // R7bb-C / S5 (D7-CRIT-1): actor from req.user only — body's
      // approvedBy is ignored so a forged body can't impersonate the
      // TPA desk. Fallback to "TPA Desk" remains for the (impossible
      // post-auth) case where req.user is missing.
      b.tpaApprovedBy     = req.user?.fullName || req.user?.employeeId || "TPA Desk";
      // R7bb-FIX-E-15: stamp the approver id for maker-checker audit.
      b.tpaApprovedById   = req.user?._id || req.user?.id || null;
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
    // R7bb-C / S5 (D7-CRIT-1): actor pulled from req.user only —
    // body's `refundedBy` ignored. The refundedById is forwarded to
    // the service so the negative-payment row + audit emit can both
    // carry the actor reference (D7-MED-4).
    //
    // R7bb-FIX-E-1 / D3-CRIT-1: approverOverride is honoured ONLY for
    // role===Admin. Receptionist/Accountant body-supplied flag is
    // silently dropped so a same-actor refund stays blocked.
    const approverOverride =
      req.user?.role === "Admin" && !!req.body.approverOverride;
    const { bill, advance } = await billingService.recordRefund(req.params.billId, {
      amount:           req.body.amount,
      reason:           req.body.reason,
      mode:             req.body.mode,
      refundedBy:       req.user?.fullName || req.user?.employeeId,
      refundedById:     req.user?._id,
      refundedByRole:   req.user?.role,
      transactionId:    req.body.transactionId,
      creditToAdvance:  !!req.body.creditToAdvance,
      reasonCode:       req.body.reasonCode,
      approverOverride,
    });
    return res.json({ success: true, data: bill, advance });
  } catch (e) {
    if (e?.status && e?.code) {
      return res.status(e.status).json({ success: false, message: e.message, code: e.code });
    }
    return next(e);
  }
};

// R7bb-FIX-E-2 / D3-CRIT-2: POST /api/billing/credit-notes/:id/approve
//   Body: { remarks? }
// Approve a CreditNote that landed in PENDING_APPROVAL state. The
// approver MUST be a different user than the CN issuer. Emits a
// CREDIT_NOTE_APPROVED audit row.
exports.approveCreditNote = async (req, res, next) => {
  try {
    const CreditNote = require("../../models/Billing/CreditNote");
    const cn = await CreditNote.findById(req.params.id);
    if (!cn) return res.status(404).json({ success: false, message: "Credit note not found" });
    if (cn.status !== "PENDING_APPROVAL") {
      return res.status(409).json({
        success: false,
        message: `Credit note is in '${cn.status}' — only PENDING_APPROVAL notes can be approved.`,
        code:    "WRONG_STATE",
      });
    }
    // SoD: approver must differ from issuer.
    if (cn.issuedById && String(cn.issuedById) === String(req.user?._id || req.user?.id)) {
      return res.status(409).json({
        success: false,
        message: "SAME_ACTOR — credit note must be approved by a different user than the issuer",
        code:    "SAME_ACTOR",
      });
    }
    cn.status       = "APPROVED";
    cn.approvedBy   = req.user?.fullName || req.user?.employeeId || "";
    cn.approvedById = req.user?._id || req.user?.id || null;
    cn.approvedAt   = new Date();
    await cn.save();

    // Audit emit (re-use BillingAudit "SETTLEMENT_ADJUSTED" as the
    // generic financial event since there's no CN-specific enum yet;
    // event name carried in the reason text).
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:      "SETTLEMENT_ADJUSTED",
        UHID:       cn.UHID,
        patientId:  cn.patientId,
        billId:     cn.billId,
        billNumber: cn.originalBillNumber,
        amount:     cn.refundAmount,
        actorId:    cn.approvedById,
        actorName:  cn.approvedBy,
        actorRole:  req.user?.role,
        reason:     `CREDIT_NOTE_APPROVED: ${cn.creditNoteNumber} (₹${cn.refundAmount}). ${String(req.body?.remarks || "").trim()}`,
        before:     { status: "PENDING_APPROVAL" },
        after:      { status: "APPROVED", creditNoteNumber: cn.creditNoteNumber },
      }, { req });
    } catch (_) { /* best-effort */ }

    return res.json({ success: true, data: cn });
  } catch (e) { next(e); }
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
    // R7bb-C / S5 (D7-CRIT-1): actor from req.user only — body field
    // `cancelledBy` ignored. Reception fallback preserved for the
    // (impossible post-auth) case where session somehow missing.
    const cancelledBy = req.user?.fullName || req.user?.employeeId || "Reception";

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
    let _priorTpa = null, _priorApprAmt = 0;
    const bill = await retryVE(async () => {
      const b = await PatientBill.findById(req.params.billId);
      if (!b) { const err = new Error("Bill not found"); err.status = 404; throw err; }
      const ALLOWED = ["PENDING", "SUBMITTED", "APPROVED", "PARTIAL_APPROVED", "NOT_APPLICABLE"];
      if (!ALLOWED.includes(b.tpaClaimStatus)) {
        const err = new Error(`Cannot deny — claim is in '${b.tpaClaimStatus}' state`);
        err.status = 409; throw err;
      }
      _priorTpa     = b.tpaClaimStatus;
      _priorApprAmt = Number(b.tpaApprovedAmount || 0);
      b.tpaClaimStatus = "REJECTED";
      b.tpaApprovedAmount = 0;
      if (req.body.reason) b.remarks = `TPA Denied: ${req.body.reason}`;
      await b.save();
      return b;
    }, { label: "tpaDeny" });
    // R7bb-C / D7-CRIT-5: emit BillingAudit on TPA deny — previously
    // the rejection landed with no chronological trace (only the
    // remarks field carried the reason). NABH AAC.7 needs the actor +
    // before/after snapshot in the audit collection itself.
    try {
      const { emit } = require("../../models/Billing/BillingAudit");
      await emit({
        event:        "TPA_DENIED",
        UHID:         bill.UHID,
        patientId:    bill.patient,
        billId:       bill._id,
        billNumber:   bill.billNumber,
        amount:       _priorApprAmt,                     // amount that was on the line before deny
        reason:       req.body.reason || "TPA denied (no reason supplied)",
        before:       { tpaClaimStatus: _priorTpa, tpaApprovedAmount: _priorApprAmt },
        after:        { tpaClaimStatus: "REJECTED", tpaApprovedAmount: 0 },
      }, { req });
    } catch (_) { /* audit best-effort */ }
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

    // R7bb-C / S5 (D7-CRIT-1): actor from req.user only — body's
    // `settledBy` ignored so a forged body cannot impersonate a TPA
    // desk operator on a settlement (a critical money-touching event).
    const settledBy   = req.user?.fullName || req.user?.employeeId || "TPA Desk";
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

    // ─────────────────────────────────────────────────────────────
    // R7ax-FIX-3: replaced the find().select(...).lean() + sequential
    // PatientAdvance.find() pair + ~100-line JS reducer with a single
    // $facet on PatientBill that emits all per-bill and per-payment
    // cuts server-side, plus two parallel small $group aggregates on
    // PatientAdvance.
    //
    // Pre-R7ax behaviour for a 500-bill day:
    //   • find().select(...).lean() returned every matching PatientBill
    //     with billItems[] + payments[] arrays. Even with the R7av
    //     projection narrowing, each lean doc still retained meta
    //     graphs into the BillItem / Payment sub-schemas (same retained-
    //     graph problem R7aw documented). 500 bills × ~30 line items ×
    //     5 cashiers F5-spamming = OOM territory.
    //   • The JS reducer made 3 passes per bill (billItems sum, payments
    //     sum, visit-type bucket). Mongo can do all three in one pass.
    //
    // Notes on parity:
    //   • byDoctor / byReceptionist depend on `b.doctor`, `b.createdBy`,
    //     `b.createdByName` — none of which exist on the PatientBill
    //     schema (mirrors the same gap R7aw-FIX-PERF documented for
    //     byDoctor). The aggregation honestly returns [] for byDoctor
    //     and a single { id:"unknown", name:"Unknown", count:N, amount:0 }
    //     row for byReceptionist — matches the pre-R7ax JS behaviour
    //     (which always tripped the `String(b.createdBy || … || "unknown")`
    //     fallback). When those fields are added to the schema this
    //     becomes a real $group on $createdBy / $doctor._id.
    // ─────────────────────────────────────────────────────────────
    const billsAggP = PatientBill.aggregate([
      { $match: {
          billStatus: { $nin: ["DRAFT"] },
          $or: [
            { "payments.paidAt": { $gte: dayStart, $lte: dayEnd } },
            { createdAt: { $gte: dayStart, $lte: dayEnd } },
          ],
      } },
      // Pre-compute per-bill numbers that don't depend on payment unwind.
      { $addFields: {
          _gross: {
            $toDouble: {
              $ifNull: ["$netAmount", { $ifNull: ["$netPayable", { $ifNull: ["$grossAmount", { $ifNull: ["$totalAmount", 0] }] }] }],
            },
          },
          _itemsNet: {
            $sum: {
              $map: {
                input: { $ifNull: ["$billItems", []] },
                as: "it",
                in: { $toDouble: { $ifNull: ["$$it.netAmount", 0] } },
              },
            },
          },
          _refPat: { $toDouble: { $ifNull: ["$patientPayableAmount", 0] } },
          // Sum of positive (non-refund) payment amounts on the bill — used to
          // compute pending. Includes payments OUTSIDE today's window because
          // pending is a snapshot, not a today-cut.
          _positive: {
            $sum: {
              $map: {
                input: { $ifNull: ["$payments", []] },
                as: "p",
                in: {
                  $let: {
                    vars: { v: { $toDouble: { $ifNull: ["$$p.amount", 0] } } },
                    in: { $cond: [{ $gt: ["$$v", 0] }, "$$v", 0] },
                  },
                },
              },
            },
          },
          // Per-bill today-paid (sum of every non-voided payment amount in window,
          // INCLUDING ADVANCE_ADJUSTMENT, INCLUDING negative refund rows) — drives
          // byVisitType + byReceptionist credit. JS: `billPaidToday += amt`.
          _paidToday: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: { $ifNull: ["$payments", []] },
                    as: "p",
                    cond: {
                      $and: [
                        { $not: ["$$p.voidedAt"] },
                        { $gte: ["$$p.paidAt", dayStart] },
                        { $lte: ["$$p.paidAt", dayEnd] },
                      ],
                    },
                  },
                },
                as: "p",
                in: { $toDouble: { $ifNull: ["$$p.amount", 0] } },
              },
            },
          },
          // Normalized visit-type bucket — mirrors the JS switch.
          _vt: {
            $let: {
              vars: { v: { $toUpper: { $ifNull: ["$visitType", "Other"] } } },
              in: {
                $switch: {
                  branches: [
                    { case: { $eq: [{ $substrBytes: ["$$v", 0, 3] }, "OPD"] }, then: "OPD" },
                    { case: { $eq: [{ $substrBytes: ["$$v", 0, 3] }, "IPD"] }, then: "IPD" },
                    { case: { $gte: [{ $indexOfBytes: ["$$v", "DAY"] }, 0] }, then: "DC" },
                    { case: { $eq: [{ $substrBytes: ["$$v", 0, 2] }, "ER"] }, then: "ER" },
                    { case: { $gte: [{ $indexOfBytes: ["$$v", "EMERGENCY"] }, 0] }, then: "ER" },
                    { case: { $eq: [{ $substrBytes: ["$$v", 0, 4] }, "SERV"] }, then: "Services" },
                  ],
                  default: "Other",
                },
              },
            },
          },
          _isTPAlike: { $regexMatch: { input: { $toLower: { $ifNull: ["$paymentType", ""] } }, regex: /tpa|insurance/ } },
      } },
      { $addFields: {
          _refNet:  { $max: ["$_refPat", "$_gross", "$_itemsNet"] },
      } },
      { $addFields: {
          _pending: { $max: [{ $subtract: ["$_refNet", "$_positive"] }, 0] },
          _paidTodayPos: { $max: ["$_paidToday", 0] },
      } },
      { $facet: {
          // ── Bill-level summary numbers
          billTotals: [
            { $group: {
                _id: null,
                txnCount:     { $sum: 1 },
                totalGross:   { $sum: "$_gross" },
                totalPending: { $sum: "$_pending" },
                advanceDue:   { $sum: { $cond: [{ $and: [{ $gt: ["$_pending", 0] }, { $eq: ["$_vt", "IPD"] }] }, "$_pending", 0] } },
                tpaPending:   { $sum: { $cond: [{ $and: [{ $gt: ["$_pending", 0] }, "$_isTPAlike", { $ne: ["$_vt", "IPD"] }] }, "$_pending", 0] } },
            } },
          ],
          // ── byVisitType buckets — 6 fixed types
          byVisitType: [
            { $group: { _id: "$_vt", amount: { $sum: "$_paidTodayPos" }, count: { $sum: 1 } } },
          ],
          // ── byReceptionist (createdBy/createdByName don't exist on schema —
          //    collapses to the "unknown" fallback, same as pre-R7ax).
          byReceptionist: [
            { $group: {
                _id: { $ifNull: [{ $toString: { $ifNull: ["$createdBy", { $ifNull: ["$updatedBy", "unknown"] }] } }, "unknown"] },
                name: { $first: { $ifNull: ["$createdByName", "Unknown"] } },
                count: { $sum: 1 },
                amount: { $sum: "$_paidTodayPos" },
            } },
          ],
          // ── Per-payment totals (collected / refunds / TDS / advancesApplied).
          //    Unwind payments + re-filter to today's window. Kept as a sibling
          //    branch of the outer $facet (Mongo forbids $facet within $facet).
          paymentsTotals: [
            { $unwind: { path: "$payments", preserveNullAndEmptyArrays: false } },
            { $match: {
                "payments.voidedAt": { $exists: false },
                "payments.paidAt":   { $gte: dayStart, $lte: dayEnd },
            } },
            { $addFields: {
                _amt: { $toDouble: { $ifNull: ["$payments.amount", 0] } },
                _tds: { $toDouble: { $ifNull: ["$payments.tdsAmount", 0] } },
                _mode: { $toUpper: { $ifNull: ["$payments.mode", { $ifNull: ["$payments.paymentMode", "Other"] }] } },
            } },
            { $group: {
                _id: null,
                // R7ap-F2: ADVANCE_ADJUSTMENT counts toward advancesApplied (not totalCollected).
                totalCollected:  { $sum: { $cond: [{ $and: [{ $gt: ["$_amt", 0] }, { $ne: ["$_mode", "ADVANCE_ADJUSTMENT"] }] }, "$_amt", 0] } },
                advancesApplied: { $sum: { $cond: [{ $and: [{ $gt: ["$_amt", 0] }, { $eq: ["$_mode", "ADVANCE_ADJUSTMENT"] }] }, "$_amt", 0] } },
                billRefundsOut:  { $sum: { $cond: [{ $lt: ["$_amt", 0] }, { $abs: "$_amt" }, 0] } },
                totalTdsDeducted:{ $sum: { $cond: [{ $gt: ["$_tds", 0] }, "$_tds", 0] } },
            } },
          ],
          // ── byMode (per payment-mode tallies). ADVANCE_ADJUSTMENT excluded
          //    (matches the JS `continue` skipping `byMode[m] += amt` for
          //    advance-adjustment rows). Refund rows (negative amounts) net
          //    into the mode sum, matching `byMode[m] += amt` after the
          //    if-amt<0 branch.
          paymentsByMode: [
            { $unwind: { path: "$payments", preserveNullAndEmptyArrays: false } },
            { $match: {
                "payments.voidedAt": { $exists: false },
                "payments.paidAt":   { $gte: dayStart, $lte: dayEnd },
            } },
            { $addFields: {
                _amt: { $toDouble: { $ifNull: ["$payments.amount", 0] } },
                _mode: { $toUpper: { $ifNull: ["$payments.mode", { $ifNull: ["$payments.paymentMode", "Other"] }] } },
            } },
            { $match: { _mode: { $ne: "ADVANCE_ADJUSTMENT" } } },
            { $group: { _id: "$_mode", amount: { $sum: "$_amt" } } },
          ],
      } },
    ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

    // R7ap-F12/D5-02: include advance DEPOSITS taken today (real cash inflow).
    // PatientAdvance.create is the first cash-touch — bills only see the
    // money later via ADVANCE_ADJUSTMENT (which we explicitly exclude above).
    // R7ar-P0-5/D5-aq-01: exclude `isRefundCredit:true` rows — those are
    // internal transfers of refunded bill money into the advance pool,
    // NOT new cash. They're already counted as billRefundsOut from the
    // bill's negative payment row.
    const advancesInAggP = PatientAdvance.aggregate([
      { $match: { paidAt: { $gte: dayStart, $lte: dayEnd }, isRefundCredit: { $ne: true } } },
      { $addFields: {
          _amt:  { $toDouble: { $ifNull: ["$amount", 0] } },
          _mode: { $toUpper: { $ifNull: ["$paymentMode", "CASH"] } },
      } },
      { $facet: {
          totals: [{ $group: { _id: null, advanceDepositsIn: { $sum: "$_amt" } } }],
          byMode: [{ $group: { _id: "$_mode", amount: { $sum: "$_amt" } } }],
      } },
    ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

    // R7ap-F11/D5-01: include advance REFUNDS issued today (cash OUTflow).
    const advancesOutAggP = PatientAdvance.aggregate([
      { $match: { status: "REFUNDED", refundedAt: { $gte: dayStart, $lte: dayEnd } } },
      { $addFields: {
          _amt:  { $toDouble: { $ifNull: ["$refundedAmount", 0] } },
          _mode: { $toUpper: { $ifNull: ["$refundMode", "CASH"] } },
      } },
      { $facet: {
          totals: [{ $group: { _id: null, advanceRefundsOut: { $sum: "$_amt" } } }],
          byMode: [{ $group: { _id: "$_mode", amount: { $sum: "$_amt" } } }],
      } },
    ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

    const [billsAgg, advancesInAgg, advancesOutAgg] =
      await Promise.all([billsAggP, advancesInAggP, advancesOutAggP]);

    const facet = billsAgg[0] || {};
    const bt = (facet.billTotals && facet.billTotals[0]) || { txnCount: 0, totalGross: 0, totalPending: 0, advanceDue: 0, tpaPending: 0 };
    const pt = (facet.paymentsTotals && facet.paymentsTotals[0]) || { totalCollected: 0, advancesApplied: 0, billRefundsOut: 0, totalTdsDeducted: 0 };
    const paymentsByMode = facet.paymentsByMode || [];
    const inT  = (advancesInAgg[0]?.totals?.[0])  || { advanceDepositsIn: 0 };
    const outT = (advancesOutAgg[0]?.totals?.[0]) || { advanceRefundsOut: 0 };

    // ── Roll byVisitType into the same fixed 6-key shape pre-R7ax used.
    const byVisitTypeMap = { OPD: 0, IPD: 0, DC: 0, ER: 0, Services: 0, Other: 0 };
    const byVisitTxnMap  = { OPD: 0, IPD: 0, DC: 0, ER: 0, Services: 0, Other: 0 };
    for (const row of facet.byVisitType || []) {
      const k = byVisitTypeMap[row._id] !== undefined ? row._id : "Other";
      byVisitTypeMap[k] += toNum(row.amount);
      byVisitTxnMap[k]  += row.count || 0;
    }

    // ── byMode: merge bill-payment + advance-deposit + advance-refund cuts.
    //    Seed with the canonical UPPERCASE keys so legacy clients still see
    //    zero rows for modes that didn't transact today (matches pre-R7ax
    //    seeded buckets); refunds subtract (matches `byMode[mode] -= amt`).
    const byMode = {
      CASH: 0, CARD: 0, UPI: 0, CHEQUE: 0, ONLINE: 0,
      TPA_CLAIM: 0, TPA: 0, INSURANCE: 0, CORPORATE: 0,
      BANK_TRANSFER: 0, Other: 0,
    };
    for (const row of paymentsByMode) {
      if (byMode[row._id] === undefined) byMode[row._id] = 0;
      byMode[row._id] += toNum(row.amount);
    }
    for (const row of advancesInAgg[0]?.byMode || []) {
      if (byMode[row._id] === undefined) byMode[row._id] = 0;
      byMode[row._id] += toNum(row.amount);
    }
    for (const row of advancesOutAgg[0]?.byMode || []) {
      if (byMode[row._id] === undefined) byMode[row._id] = 0;
      byMode[row._id] -= toNum(row.amount);
    }

    // ── byReceptionist: the schema lacks createdBy/createdByName so this
    //    collapses to a single row keyed "unknown" — same as pre-R7ax (which
    //    always tripped the fallback).
    const byReceptionist = (facet.byReceptionist || []).map((r) => ({
      id: String(r._id),
      name: r.name || "Unknown",
      count: r.count || 0,
      amount: toNum(r.amount),
    }));

    const totalCollected    = toNum(pt.totalCollected) + toNum(inT.advanceDepositsIn);
    const advancesApplied   = toNum(pt.advancesApplied);
    const billRefundsOut    = toNum(pt.billRefundsOut);
    const totalTdsDeducted  = toNum(pt.totalTdsDeducted);
    const advanceDepositsIn = toNum(inT.advanceDepositsIn);
    const advanceRefundsOut = toNum(outT.advanceRefundsOut);

    // R7ap-F11/F12: net cash flow = collections − bill refunds − advance refunds.
    // R7ar-P2-28/D5-aq-03: subtract TDS too (it's a receivable, not till cash).
    const netCashFlow = totalCollected - billRefundsOut - advanceRefundsOut - totalTdsDeducted;
    return {
      success: true,
      date: dateStr,
      summary: {
        totalCollected,
        totalGross:   toNum(bt.totalGross),
        totalPending: toNum(bt.totalPending),
        txnCount:     bt.txnCount || 0,
        advanceDue:   toNum(bt.advanceDue),
        tpaPending:   toNum(bt.tpaPending),
        advancesApplied, advanceDepositsIn, advanceRefundsOut, billRefundsOut, netCashFlow,
        totalTdsDeducted,           // R7ar-P2-28
      },
      byVisitType: Object.entries(byVisitTypeMap).map(([type, amount]) => ({ type, amount, count: byVisitTxnMap[type] || 0 })),
      byMode:      Object.entries(byMode).filter(([, v]) => v !== 0).map(([mode, amount]) => ({ mode, amount })),
      // byDoctor stays an empty array — the PatientBill schema doesn't carry
      // a doctor field (mirrors R7aw-FIX-PERF byDoctor=[] note).
      byDoctor:    [],
      byReceptionist,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// PATIENT ADVANCE — UHID-level prepayment ledger
// Cash/UPI/card collected from a patient before any bill is generated
// (typical IPD admission deposit) lives here. Later applied to bills.
// ─────────────────────────────────────────────────────────────────────

// POST /api/billing/advance  { UHID, amount, paymentMode, transactionId?, admission?, remarks? }
// R7bb-C / S5 (D7-CRIT-1): actor sourced from req.user only — body's
// `receivedBy*` ignored. Pre-R7bb a forged body could attribute the
// deposit to any cashier, breaking shift reconciliation.
exports.createAdvance = async (req, res) => {
  try {
    const svc = require("../../services/Billing/patientAdvanceService");
    const { receivedBy: _ia, receivedById: _ib, receivedByRole: _ic, ...safeBody } = req.body;
    const adv = await svc.createAdvance({
      ...safeBody,
      receivedBy:     req.user?.fullName || req.user?.employeeId,
      receivedById:   req.user?._id,
      receivedByRole: req.user?.role,
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
    // R7bb-C / D7-HIGH-5: actor-centric filters. Pre-R7bb the audit feed
    // could only be sliced by event/UHID/bill — investigators chasing
    // "everything cashier X did on date Y" had to dump+grep client-side.
    // ObjectId validation guards against CastError 500s.
    if (req.query.actorId) {
      if (!mongoose.isValidObjectId(req.query.actorId)) {
        return res.status(400).json({ success: false, message: "actorId must be a valid ObjectId" });
      }
      filter.actorId = req.query.actorId;
    }
    if (req.query.actorRole) {
      filter.actorRole = String(req.query.actorRole).trim();
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
    // R7ax-FIX-4: hard wall-clock cap so an unindexed audit scan can never
    // tie up a connection long enough to amplify OOM pressure under load.
    // The find itself is fine (BillingAudit indices cover createdAt+event)
    // and stays as-is — only the timeout is added.
    const rows = await BillingAudit.find(filter, proj).sort({ createdAt: -1 }).limit(limit).maxTimeMS(10_000).lean();
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
    // R7ax-FIX-2: collapsed the per-bucket bucket-list build + the
    // post-aggregation `buckets.reduce(...)` totals roll-up into a
    // single $facet so the grand-totals never re-iterate the bucket
    // array on the Node side and so allowDiskUse / maxTimeMS apply
    // uniformly. The per-row CN reversal aggregate is also folded in
    // — pre-R7ax this endpoint did 1 aggregate + 1 aggregate + 1 find,
    // all sequential. Now: 1 $facet on PatientBill + 1 aggregate on
    // CreditNote + 1 find on snapshots — Promise.all-parallelizable.
    const billsAggP = PatientBill.aggregate([
      { $match: {
          billStatus:      { $nin: ["DRAFT", "CANCELLED"] },
          billGeneratedAt: { $gte: from, $lte: to },
      }},
      { $unwind: "$billItems" },
      { $match: { "billItems.isTaxable": true, "billItems.taxPercent": { $gt: 0 } } },
      { $addFields: {
          _txbl: { $toDouble: { $ifNull: ["$billItems.netAmount", 0] } },
          _tax:  { $toDouble: { $ifNull: ["$billItems.taxAmount", 0] } },
          _cgst: { $toDouble: { $ifNull: ["$billItems.cgstAmount", 0] } },
          _sgst: { $toDouble: { $ifNull: ["$billItems.sgstAmount", 0] } },
          _igst: { $toDouble: { $ifNull: ["$billItems.igstAmount", 0] } },
      } },
      { $facet: {
          // ── Per-rate buckets (was the original pipeline result)
          buckets: [
            { $group: {
                _id:           "$billItems.taxPercent",
                bills:         { $addToSet: "$_id" },
                itemCount:     { $sum: 1 },
                taxableValue:  { $sum: "$_txbl" },
                taxAmount:     { $sum: "$_tax" },
                cgst:          { $sum: "$_cgst" },
                sgst:          { $sum: "$_sgst" },
                igst:          { $sum: "$_igst" },
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
          ],
          // ── Gross totals across all rates (kills the JS `buckets.reduce`)
          grossTotals: [
            { $group: {
                _id: null,
                bills:        { $addToSet: "$_id" },
                itemCount:    { $sum: 1 },
                taxableValue: { $sum: "$_txbl" },
                taxAmount:    { $sum: "$_tax" },
                cgst:         { $sum: "$_cgst" },
                sgst:         { $sum: "$_sgst" },
                igst:         { $sum: "$_igst" },
            } },
            { $project: {
                _id: 0,
                billCount:    { $size: "$bills" },
                itemCount:    1,
                taxableValue: 1,
                taxAmount:    1,
                cgst:         1,
                sgst:         1,
                igst:         1,
            } },
          ],
      } },
    ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

    // R7ar-P1-15/D6-aq-08: subtract CreditNote reversals from the
    // register. Pre-R7ar the GST register showed gross outward supply
    // only — refund credit-notes lived in a separate doc but the
    // GSTR-1 net (outward − CDNR) was hand-computed by the accountant
    // every month. Now the API returns gross + reversed + net.
    const cnAggP = CreditNote.aggregate([
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
    ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

    const [billsAgg, cnAgg] = await Promise.all([billsAggP, cnAggP]);
    const facet = billsAgg[0] || { buckets: [], grossTotals: [] };
    const buckets = facet.buckets || [];
    const gt = facet.grossTotals[0] || { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, taxAmount: 0, billCount: 0, itemCount: 0 };
    const grossTotals = {
      taxableValue: toNum(gt.taxableValue),
      cgst:         toNum(gt.cgst),
      sgst:         toNum(gt.sgst),
      igst:         toNum(gt.igst),
      taxAmount:    toNum(gt.taxAmount),
      billCount:    gt.billCount || 0,
      itemCount:    gt.itemCount || 0,
    };
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

// POST /api/billing/advance/:advanceId/refund  { refundReason, mode?, transactionId? }
// R7bb-C / S5 (D7-CRIT-1): actor from req.user only — body's
// `refundedBy` ignored. refundedById/Role forwarded to the service so
// the audit row carries the operator's identity (not just their name).
exports.refundAdvance = async (req, res) => {
  try {
    const svc = require("../../services/Billing/patientAdvanceService");
    // R7bb-FIX-E-3 / D3-CRIT-3: Admin-only override on SoD block.
    const approverOverride =
      req.user?.role === "Admin" && !!req.body?.approverOverride;
    const adv = await svc.refundAdvance(req.params.advanceId, {
      refundedBy:       req.user?.fullName || req.user?.employeeId,
      refundedById:     req.user?._id,
      refundedByRole:   req.user?.role,
      refundReason:     req.body?.refundReason || "Refund at patient request",
      mode:             req.body?.mode          || req.body?.refundMode,
      transactionId:    req.body?.transactionId || req.body?.refundTransactionId || null,
      approverOverride,
    });
    res.json({ success: true, data: adv });
  } catch (e) {
    if (e?.status && e?.code) {
      return res.status(e.status).json({ success: false, message: e.message, code: e.code });
    }
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
