/**
 * services/Reports/incomeService.js
 * ────────────────────────────────────────────────────────────────────
 * R7bf-H / A6-CRIT-7 — Today's revenue excludes ADVANCE_DEPOSIT.
 *
 * BACKGROUND
 *   `todayRevenue` previously summed every positive payment row landing
 *   between IST start-of-today and IST end-of-today. That conflates two
 *   different ledger events:
 *     • BILL_PAYMENT          → real revenue (patient paid for a service)
 *     • ADVANCE_DEPOSIT       → LIABILITY (hospital owes patient until
 *                                an actual bill is settled)
 *     • ADVANCE_ADJUSTMENT    → revenue (the moment a parked advance is
 *                                consumed against a bill, that liability
 *                                converts into revenue)
 *     • PHARMACY_SALE         → revenue (pharmacy OTC + dispensed)
 *
 *   Old behaviour counted both advance deposit AND advance adjustment
 *   AND the original bill payment — so a patient who paid ₹10K advance
 *   on day 1 and ₹5K bill on day 7 (settled ₹4K from advance) would show
 *   as ₹19K income on a calendar that summed all three.
 *
 * THIS MODULE
 *   `todayRevenue(opts)` returns the IST-anchored revenue rollup with
 *   correct accounting semantics:
 *     • Bill payments in [istStart, istEnd) where paymentMode !==
 *       ADVANCE_ADJUSTMENT and amount > 0 contribute to revenue.
 *     • Advance adjustments contribute (advance liability → revenue).
 *     • Pure advance DEPOSITS are tracked separately as `advanceLiability
 *       In` (a balance-sheet movement, not income).
 *     • Pharmacy sales (PharmacySale.grandTotal where status not in
 *       ["Cancelled", "Refunded"]) contribute.
 *     • Negative payment rows (refunds) net out of bill revenue.
 *     • Refund-of-refund: a voided refund payment must add the cash back
 *       in. That's handled in dayBookService.netCashFlow — not here.
 */

"use strict";

const PatientBill    = require("../../models/PatientBillModel/PatientBillModel");
const PatientAdvance = require("../../models/PatientBillModel/PatientAdvanceModel");
const PharmacySale   = require("../../models/Pharmacy/PharmacySaleModel");
const { toNum }      = require("../../utils/money");
const { istStartOfToday, istEndOfToday } = require("../../utils/queryGuards");

/**
 * @param {Object} [opts]
 * @param {Date} [opts.from]  default = IST start of today
 * @param {Date} [opts.to]    default = IST end of today (exclusive)
 * @returns {Promise<{
 *   from: Date, to: Date,
 *   billPayments: number,
 *   advanceAdjustments: number,
 *   pharmacyRevenue: number,
 *   billRefundsOut: number,
 *   revenue: number,
 *   advanceLiabilityIn: number,
 *   advanceRefundsOut: number,
 * }>}
 */
async function todayRevenue(opts = {}) {
  const from = opts.from || istStartOfToday();
  const to   = opts.to   || istEndOfToday();

  // ── Bill payments (revenue side) ─────────────────────────────────
  // Sum positive amounts excluding ADVANCE_ADJUSTMENT (counted separately
  // below as the moment liability → revenue) AND voided rows.
  const billPaymentsAggP = PatientBill.aggregate([
    { $match: {
        "payments.paidAt": { $gte: from, $lt: to },
        billStatus:        { $nin: ["DRAFT"] },
    } },
    { $unwind: "$payments" },
    { $match: {
        "payments.paidAt":   { $gte: from, $lt: to },
        "payments.voidedAt": { $exists: false },
    } },
    { $addFields: {
        _amt:  { $toDouble: { $ifNull: ["$payments.amount", 0] } },
        _mode: { $toUpper: { $ifNull: ["$payments.paymentMode", "Other"] } },
    } },
    { $group: {
        _id: null,
        billPayments: {
          $sum: { $cond: [
            { $and: [{ $gt: ["$_amt", 0] }, { $ne: ["$_mode", "ADVANCE_ADJUSTMENT"] }] },
            "$_amt", 0,
          ] },
        },
        advanceAdjustments: {
          $sum: { $cond: [
            { $and: [{ $gt: ["$_amt", 0] }, { $eq: ["$_mode", "ADVANCE_ADJUSTMENT"] }] },
            "$_amt", 0,
          ] },
        },
        billRefundsOut: {
          $sum: { $cond: [{ $lt: ["$_amt", 0] }, { $abs: "$_amt" }, 0] },
        },
    } },
  ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

  // ── Pharmacy revenue ─────────────────────────────────────────────
  // R7bh-F2: explicit allowlist instead of $nin so future statuses
  // (e.g. a "Quarantined" state) don't accidentally book as revenue.
  // Mirrors dayBookService.computeDayBook for ledger parity:
  //   Completed       — sale finalised, money in drawer
  //   Supplemented    — sale + addendum, money in drawer
  //   Partial-Return  — partial return; original headline grandTotal
  //                     still books, the refund leg is netted via the
  //                     patientCredit accounting (per R7c-design).
  // Excludes: Cancelled (no revenue), Refunded (fully reversed), Hold
  // (sale not yet released to the till).
  const pharmacyAggP = PharmacySale.aggregate([
    { $match: {
        createdAt: { $gte: from, $lt: to },
        status:    { $in: ["Completed", "Supplemented", "Partial-Return"] },
    } },
    { $group: {
        _id: null,
        gross: { $sum: { $toDouble: { $ifNull: ["$grandTotal", 0] } } },
        count: { $sum: 1 },
    } },
  ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

  // ── Advance deposits (liability inflow — NOT revenue) ────────────
  // R7ar-P0-5 isRefundCredit:true rows are internal transfers, not new
  // cash. Excluded to match dayBookService.
  const advanceInAggP = PatientAdvance.aggregate([
    { $match: {
        paidAt: { $gte: from, $lt: to },
        isRefundCredit: { $ne: true },
    } },
    { $group: { _id: null, advanceIn: { $sum: { $toDouble: { $ifNull: ["$amount", 0] } } } } },
  ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

  // ── Advance refunds (liability OUTflow — NOT revenue) ────────────
  const advanceOutAggP = PatientAdvance.aggregate([
    { $match: {
        status: "REFUNDED",
        refundedAt: { $gte: from, $lt: to },
    } },
    { $group: { _id: null, advanceRefundOut: { $sum: { $toDouble: { $ifNull: ["$refundedAmount", 0] } } } } },
  ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

  const [billPaymentsAgg, pharmacyAgg, advanceInAgg, advanceOutAgg] =
    await Promise.all([billPaymentsAggP, pharmacyAggP, advanceInAggP, advanceOutAggP]);

  const bp = billPaymentsAgg[0] || { billPayments: 0, advanceAdjustments: 0, billRefundsOut: 0 };
  const ph = pharmacyAgg[0]    || { gross: 0, count: 0 };
  const ai = advanceInAgg[0]   || { advanceIn: 0 };
  const ao = advanceOutAgg[0]  || { advanceRefundOut: 0 };

  const billPayments       = toNum(bp.billPayments);
  const advanceAdjustments = toNum(bp.advanceAdjustments);
  const billRefundsOut     = toNum(bp.billRefundsOut);
  const pharmacyRevenue    = toNum(ph.gross);

  // ── Revenue: bill payments + advance adjustments + pharmacy, minus refunds.
  const revenue = +(billPayments + advanceAdjustments + pharmacyRevenue - billRefundsOut).toFixed(2);

  return {
    from, to,
    billPayments,
    advanceAdjustments,
    pharmacyRevenue,
    pharmacyCount:      ph.count || 0,
    billRefundsOut,
    revenue,
    advanceLiabilityIn: toNum(ai.advanceIn),
    advanceRefundsOut:  toNum(ao.advanceRefundOut),
  };
}

module.exports = {
  todayRevenue,
};
