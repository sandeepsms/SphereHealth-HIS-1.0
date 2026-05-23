/**
 * services/Reports/dayBookService.js
 * ────────────────────────────────────────────────────────────────────
 * R7bf-H / A6-CRIT-6 — Day Book cash-in correctly includes reversed
 * refunds.
 *
 * BACKGROUND
 *   A refund is recorded as a NEGATIVE payment row on PatientBill (a
 *   refund of ₹500 in CASH posts amount = -500 on payments[]). When a
 *   cashier later VOIDS that refund within the 15-min window (R6) — say
 *   it was issued to the wrong patient — the original negative row stays
 *   in place but gets `voidedAt`/`voidedBy` stamped, and a counter-row
 *   may also be pushed with amount = +500 (reversal credit).
 *
 *   In the original Day Book aggregation the netCashFlow read every
 *   non-voided positive payment as collection, every non-voided negative
 *   as refund. A voided refund therefore drops out of refunds (correct),
 *   but the *reversal credit row* that puts cash back in the drawer was
 *   not always being booked because some reversal flows lean on the
 *   voidedAt flag rather than inserting a counter-row.
 *
 *   This service computes EOD with the following invariant:
 *     Cash In =
 *         + bill payments (positive, non-voided, non-ADVANCE_ADJUSTMENT)
 *         + advance deposits (PatientAdvance.amount, isRefundCredit:false)
 *         + reversed refunds (originally negative payment rows that have
 *                              voidedAt set in window — money returns to
 *                              the drawer)
 *     Cash Out =
 *         + bill refunds (negative non-voided payments)
 *         + advance refunds (PatientAdvance.refundedAmount, status REFUNDED)
 *     Net Cash = Cash In - Cash Out - TDS deducted
 *
 *   The reversed-refund leg was the missing piece — without it a
 *   cashier who refunded ₹500 in error and then voided it ended the day
 *   with a ₹500 hole in the till.
 */

"use strict";

const PatientBill    = require("../../models/PatientBillModel/PatientBillModel");
const PatientAdvance = require("../../models/PatientBillModel/PatientAdvanceModel");
const PharmacySale   = require("../../models/Pharmacy/PharmacySaleModel");
const { toNum }      = require("../../utils/money");
const { istStartOfToday, istEndOfToday, parseHospitalDate } = require("../../utils/queryGuards");

/**
 * @param {string|Date} dayOrStart  YYYY-MM-DD or Date
 * @returns {Promise<Object>}
 */
async function computeDayBook(dayOrStart) {
  let start, end;
  if (dayOrStart instanceof Date) {
    start = dayOrStart;
    end   = new Date(start.getTime() + 86400000);
  } else if (typeof dayOrStart === "string") {
    start = parseHospitalDate(dayOrStart);
    end   = new Date(start.getTime() + 86400000);
  } else {
    start = istStartOfToday();
    end   = istEndOfToday();
  }

  // ── Bill payments rollup with all three legs (collection / refund out /
  //    reversed refund cash-back) in a single facet pass.
  const billsAggP = PatientBill.aggregate([
    { $match: {
        $or: [
          { "payments.paidAt":   { $gte: start, $lt: end } },
          { "payments.voidedAt": { $gte: start, $lt: end } },
        ],
    } },
    { $unwind: "$payments" },
    { $addFields: {
        _amt:  { $toDouble: { $ifNull: ["$payments.amount", 0] } },
        _mode: { $toUpper: { $ifNull: ["$payments.paymentMode", "Other"] } },
        _tds:  { $toDouble: { $ifNull: ["$payments.tdsAmount", 0] } },
        _paidInWindow:   { $and: [
          { $gte: ["$payments.paidAt", start] }, { $lt: ["$payments.paidAt", end] },
        ] },
        _voidedInWindow: { $and: [
          { $ne: ["$payments.voidedAt", null] },
          { $ne: [{ $type: "$payments.voidedAt" }, "missing"] },
          { $gte: ["$payments.voidedAt", start] }, { $lt: ["$payments.voidedAt", end] },
        ] },
    } },
    { $facet: {
        collections: [
          // Positive non-voided non-ADVANCE_ADJUSTMENT rows paid in window.
          { $match: {
              _paidInWindow: true,
              "payments.voidedAt": { $exists: false },
              _mode: { $ne: "ADVANCE_ADJUSTMENT" },
          } },
          { $match: { _amt: { $gt: 0 } } },
          { $group: { _id: null, total: { $sum: "$_amt" }, count: { $sum: 1 } } },
        ],
        advancesApplied: [
          { $match: {
              _paidInWindow: true,
              "payments.voidedAt": { $exists: false },
              _mode: "ADVANCE_ADJUSTMENT",
              _amt: { $gt: 0 },
          } },
          { $group: { _id: null, total: { $sum: "$_amt" } } },
        ],
        billRefundsOut: [
          // Negative non-voided rows paid in window (real refunds STANDING).
          { $match: {
              _paidInWindow: true,
              "payments.voidedAt": { $exists: false },
              _amt: { $lt: 0 },
          } },
          { $group: {
              _id: null,
              total: { $sum: { $abs: "$_amt" } },
              count: { $sum: 1 },
          } },
        ],
        // R7bf-H A6-CRIT-6: reversed refunds. A negative payment row that
        // was VOIDED in this window means the cashier rolled back a
        // refund — cash is back in the drawer. Booking it as IN closes
        // the netCashFlow leak. paidAt may be from an earlier day; what
        // matters is that the void happened today.
        reversedRefunds: [
          { $match: {
              _voidedInWindow: true,
              _amt: { $lt: 0 },
          } },
          { $group: {
              _id: null,
              total: { $sum: { $abs: "$_amt" } },
              count: { $sum: 1 },
          } },
        ],
        // Voided positive payments — money LEAVES the drawer (cashier
        // gave the patient back the cash for a typo'd payment).
        reversedPayments: [
          { $match: {
              _voidedInWindow: true,
              _amt: { $gt: 0 },
              _mode: { $ne: "ADVANCE_ADJUSTMENT" },
          } },
          { $group: {
              _id: null,
              total: { $sum: "$_amt" },
              count: { $sum: 1 },
          } },
        ],
        tds: [
          { $match: {
              _paidInWindow: true,
              "payments.voidedAt": { $exists: false },
              _tds: { $gt: 0 },
          } },
          { $group: { _id: null, total: { $sum: "$_tds" } } },
        ],
        byMode: [
          { $match: {
              _paidInWindow: true,
              "payments.voidedAt": { $exists: false },
              _mode: { $ne: "ADVANCE_ADJUSTMENT" },
          } },
          { $group: { _id: "$_mode", total: { $sum: "$_amt" }, count: { $sum: 1 } } },
          { $sort: { total: -1 } },
        ],
    } },
  ]).option({ allowDiskUse: true, maxTimeMS: 20_000 });

  // ── Advance deposits IN (real cash inflow) ──────────────────────
  const advanceInAggP = PatientAdvance.aggregate([
    { $match: {
        paidAt: { $gte: start, $lt: end },
        isRefundCredit: { $ne: true },
    } },
    { $group: {
        _id: null,
        total: { $sum: { $toDouble: { $ifNull: ["$amount", 0] } } },
        count: { $sum: 1 },
    } },
  ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

  // ── Advance refunds OUT ─────────────────────────────────────────
  const advanceOutAggP = PatientAdvance.aggregate([
    { $match: {
        status: "REFUNDED",
        refundedAt: { $gte: start, $lt: end },
    } },
    { $group: {
        _id: null,
        total: { $sum: { $toDouble: { $ifNull: ["$refundedAmount", 0] } } },
        count: { $sum: 1 },
    } },
  ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

  // ── Pharmacy retail cash leg (R7bh-F2 / R7bg-1-CRIT-13) ─────────
  // Pre-R7bh the Day Book ignored PharmacySale entirely → Bahi Khata
  // under-reported by 30-40% on any hospital with an OTC counter. We
  // fold pharmacy sales into the same cashIn computation, bucketed by
  // paymentMode for the byMode breakdown.
  //
  // Status filter mirrors incomeService.todayRevenue: Completed +
  // Supplemented + Partial-Return all contribute (the partial-return
  // refund itself is captured on the *original* sale via patientCredit
  // accounting; the headline grandTotal still reflects the booked
  // revenue). Cancelled / Refunded are excluded (no cash inflow).
  //
  // paymentMode source is Title-case ("Cash"/"Card"/"UPI"/"Mixed"/
  // "Credit") — UPPERCASE-normalize before bucketing so PHARMACY rows
  // collide with the hospital `byMode` keys (CASH / CARD / UPI / …).
  // R7bg-3-HIGH-1 case-drift fix.
  const pharmacyAggP = PharmacySale.aggregate([
    { $match: {
        // saleDate isn't a column — createdAt is the truthful event time
        // for a counter sale (mirrors incomeService).
        createdAt: { $gte: start, $lt: end },
        status: { $in: ["Completed", "Supplemented", "Partial-Return"] },
    } },
    { $addFields: {
        _amt:  { $toDouble: { $ifNull: ["$grandTotal", 0] } },
        _mode: { $toUpper: { $ifNull: ["$paymentMode", "Cash"] } },
    } },
    // Credit-mode sales DON'T touch the till — they bump patient
    // balance only. Same logic as hospital ADVANCE_ADJUSTMENT.
    { $match: { _mode: { $ne: "CREDIT" }, _amt: { $gt: 0 } } },
    { $facet: {
        total: [
          { $group: { _id: null, total: { $sum: "$_amt" }, count: { $sum: 1 } } },
        ],
        byMode: [
          { $group: { _id: "$_mode", total: { $sum: "$_amt" }, count: { $sum: 1 } } },
        ],
    } },
  ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

  const [billsAgg, advIn, advOut, pharmacyAgg] = await Promise.all([
    billsAggP, advanceInAggP, advanceOutAggP, pharmacyAggP,
  ]);
  const facet = billsAgg[0] || {};

  const collections       = toNum(facet.collections?.[0]?.total);
  const collectionsCount  = facet.collections?.[0]?.count || 0;
  const advancesApplied   = toNum(facet.advancesApplied?.[0]?.total);
  const billRefundsOut    = toNum(facet.billRefundsOut?.[0]?.total);
  const reversedRefunds   = toNum(facet.reversedRefunds?.[0]?.total);
  const reversedPayments  = toNum(facet.reversedPayments?.[0]?.total);
  const tdsDeducted       = toNum(facet.tds?.[0]?.total);
  const byMode            = (facet.byMode || []).map((r) => ({
    mode: r._id, amount: toNum(r.total), count: r.count || 0,
  }));

  const advanceDepositsIn = toNum(advIn[0]?.total);
  const advanceDepositsCount = advIn[0]?.count || 0;
  const advanceRefundsOut = toNum(advOut[0]?.total);
  const advanceRefundsCount = advOut[0]?.count || 0;

  // ── Pharmacy retail (R7bg-1-CRIT-13) ────────────────────────────
  const pharmacyFacet     = pharmacyAgg[0] || {};
  const pharmacyRevenue   = toNum(pharmacyFacet.total?.[0]?.total);
  const pharmacyCount     = pharmacyFacet.total?.[0]?.count || 0;
  // Merge pharmacy byMode into the bill byMode list — keyed on the
  // UPPERCASE paymentMode, sum amount + count where the keys overlap.
  const byModeMap = new Map(byMode.map((r) => [r.mode, { ...r }]));
  for (const r of pharmacyFacet.byMode || []) {
    const mode = r._id;
    const existing = byModeMap.get(mode) || { mode, amount: 0, count: 0 };
    existing.amount = +(existing.amount + toNum(r.total)).toFixed(2);
    existing.count  = (existing.count || 0) + (r.count || 0);
    byModeMap.set(mode, existing);
  }
  const byModeMerged = Array.from(byModeMap.values()).sort((a, b) => b.amount - a.amount);

  // Cash In = collections + advances + reversed refunds + pharmacy
  //   (R7bg-1-CRIT-13 — pharmacy retail cash was missing entirely)
  const cashIn  = +(collections + advanceDepositsIn + reversedRefunds + pharmacyRevenue).toFixed(2);
  // Cash Out = bill refunds + advance refunds + voided positive payments
  const cashOut = +(billRefundsOut + advanceRefundsOut + reversedPayments).toFixed(2);
  const netCashFlow = +(cashIn - cashOut - tdsDeducted).toFixed(2);

  return {
    date: start.toISOString().slice(0, 10),
    from: start,
    to:   end,
    summary: {
      collections,
      collectionsCount,
      advancesApplied,
      advanceDepositsIn,
      advanceDepositsCount,
      advanceRefundsOut,
      advanceRefundsCount,
      billRefundsOut,
      reversedRefunds,         // R7bf-H A6-CRIT-6
      reversedPayments,
      pharmacyRevenue,         // R7bh-F2 / R7bg-1-CRIT-13
      pharmacyCount,
      tdsDeducted,
      cashIn,
      cashOut,
      netCashFlow,
    },
    byMode: byModeMerged,
  };
}

module.exports = {
  computeDayBook,
};
