/**
 * controllers/Reports/refundsController.js
 * ────────────────────────────────────────────────────────────────────
 * R7bf-H / A6-CRIT-4 — Refunds list honours the from/to date filter.
 *
 * BACKGROUND
 *   The Accounts RefundsTab posted `?from=YYYY-MM-DD&to=YYYY-MM-DD` to
 *   /api/billing/credit-notes — that endpoint already honours from/to.
 *   The tab ALSO posted from/to to /api/billing?status=REFUNDED — the
 *   billingController.listBills handler only looked for `startDate` /
 *   `endDate`, so the date params were silently ignored and every refund
 *   in history was returned regardless of window.
 *
 *   The proper fix is a dedicated refunds endpoint that:
 *     • Reads from/to with strict ISO parsing (parseHospitalDateRange).
 *     • Filters to bills that have at least one REFUND (negative,
 *       non-voided) payment row whose paidAt lands in window.
 *     • Returns refund-only rows (not whole bills with mixed activity)
 *       so the cashier can reconcile the actual money outflow.
 *
 *   Existing /api/billing route is also patched in this PR to accept
 *   `from`/`to` aliases so legacy clients don't 404.
 *
 * SHAPE
 *   GET /api/reports/refunds?from=YYYY-MM-DD&to=YYYY-MM-DD&UHID=...
 *   { from, to,
 *     data: [{ billId, billNumber, UHID, patientName, refundedAt,
 *              refundedBy, paymentMode, amount, reason, voidedAt }],
 *     meta: { count, totalRefunded } }
 */

"use strict";

const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
const { toNum }   = require("../../utils/money");
const { parseHospitalDateRange, safeRegex } = require("../../utils/queryGuards");
// R7bh-F8: envelope normalize — `{success, from, to, data, meta}` →
// `sendOk(res, {from,to,rows}, meta)`.
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

exports.getRefunds = async (req, res, next) => {
  try {
    let from, to;
    try {
      ({ from, to } = parseHospitalDateRange(req.query.from, req.query.to, { defaultDays: 30, maxDays: 366 }));
    } catch (e) {
      return sendErr(res, e, "VALIDATION", e.status || 400);
    }
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const match = {
      "payments.paidAt": { $gte: from, $lt: to },
    };
    if (req.query.UHID)       match.UHID = safeRegex(req.query.UHID);
    if (req.query.billNumber) match.billNumber = safeRegex(req.query.billNumber);

    // Unwind to refund rows only.
    const rows = await PatientBill.aggregate([
      { $match: match },
      { $unwind: "$payments" },
      { $match: {
          "payments.paidAt": { $gte: from, $lt: to },
          "payments.amount": { $lt: 0 },
      } },
      // Optional voidedAt filter: by default include both standing and
      // voided refunds (reconciler needs the full picture). To exclude
      // voided pass ?excludeVoided=true.
      ...(String(req.query.excludeVoided || "").toLowerCase() === "true"
        ? [{ $match: { "payments.voidedAt": { $exists: false } } }]
        : []),
      { $project: {
          _id: 0,
          billId:        "$_id",
          billNumber:    1,
          UHID:          1,
          patientName:   1,
          visitType:     1,
          paymentId:     "$payments._id",
          refundedAt:    "$payments.paidAt",
          refundedBy:    "$payments.receivedBy",
          paymentMode:   "$payments.paymentMode",
          amount:        { $abs: { $toDouble: "$payments.amount" } },
          reason:        "$payments.remarks",
          voidedAt:      "$payments.voidedAt",
          voidedBy:      "$payments.voidedBy",
          voidReason:    "$payments.voidReason",
      } },
      { $sort: { refundedAt: -1 } },
      { $limit: limit },
    ]).option({ allowDiskUse: true, maxTimeMS: 20_000 });

    let total = 0;
    for (const r of rows) {
      r.amount = toNum(r.amount);
      if (!r.voidedAt) total += r.amount;
    }

    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = to.toISOString().slice(0, 10);
    return sendOk(res,
      { from: fromStr, to: toStr, rows },
      { from: fromStr, to: toStr, count: rows.length, totalRefunded: +total.toFixed(2), limit });
  } catch (e) { next(e); }
};
