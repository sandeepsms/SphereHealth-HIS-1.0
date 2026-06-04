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
 *     • Pharmacy sales:
 *         - dispense grandTotal at sale createdAt (Completed/
 *           Supplemented/Partial-Return)
 *         + supplements.addedTotal at supplements.addedAt
 *         − returns.refundAmount at returns.refundedAt
 *       (R7hr-12 D2-05 — was bare `sum(grandTotal)`, which ignored
 *       both supplements and returns and bucketed everything on the
 *       parent createdAt instead of the event timestamp.)
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
 *   pharmacyDispenseRevenue: number,
 *   pharmacySupplementRevenue: number,
 *   pharmacyReturnReversal: number,
 *   pharmacyCount: number,
 *   pharmacySupplementsCount: number,
 *   pharmacyReturnsCount: number,
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
  //   Completed       — sale finalised
  //   Supplemented    — sale + addendum
  //   Partial-Return  — partial return; original headline grandTotal
  //                     still books at sale time, the refund itself
  //                     is timestamp-bucketed below via returns[]
  // Excludes: Cancelled (no revenue), Refunded (fully reversed; the
  // refund leg below subtracts it on the day it was refunded), Hold
  // (sale not yet released).
  //
  // R7hr-12 (D2-05) — the previous single-pipeline sum of grandTotal
  // for sales created in window was wrong on three legs:
  //   (a) supplements: addedTotal never lifts grandTotal — supplement
  //       revenue invisible.
  //   (b) partial returns: refundAmount never subtracted, even though
  //       the refund actually reverses revenue.
  //   (c) Credit-mode sales: the original code summed every status
  //       including Credit — that's accrual revenue, so it's correct
  //       (revenue is earned when the goods leave, not when cash
  //       arrives). That part stays. But supplements/returns weren't
  //       contributing on the date they happened — they were stuck
  //       on the date the parent sale was created.
  //
  // Fix: split into three timestamp-bucketed legs.
  //   Leg A — dispense grandTotal at sale createdAt (revenue earned)
  //   Leg B — supplements.addedTotal at supplements.addedAt (additional
  //           revenue earned at supplement time, on a possibly later day)
  //   Leg C — returns.refundAmount at returns.refundedAt (revenue
  //           reversed; subtract regardless of refundMode — refundMode
  //           is a till question, revenue is accrual)
  // Final pharmacy revenue = Leg A + Leg B − Leg C.
  const pharmacyDispenseAggP = PharmacySale.aggregate([
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

  const pharmacySupplementAggP = PharmacySale.aggregate([
    { $match: { "supplements.addedAt": { $gte: from, $lt: to } } },
    { $unwind: "$supplements" },
    { $match: { "supplements.addedAt": { $gte: from, $lt: to } } },
    { $group: {
        _id: null,
        gross: { $sum: { $toDouble: { $ifNull: ["$supplements.addedTotal", 0] } } },
        count: { $sum: 1 },
    } },
  ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

  const pharmacyReturnAggP = PharmacySale.aggregate([
    { $match: { "returns.refundedAt": { $gte: from, $lt: to } } },
    { $unwind: "$returns" },
    { $match: { "returns.refundedAt": { $gte: from, $lt: to } } },
    { $group: {
        _id: null,
        gross: { $sum: { $toDouble: { $ifNull: ["$returns.refundAmount", 0] } } },
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

  const [billPaymentsAgg, pharmacyDispenseAgg, pharmacySupplementAgg,
         pharmacyReturnAgg, advanceInAgg, advanceOutAgg] =
    await Promise.all([
      billPaymentsAggP, pharmacyDispenseAggP, pharmacySupplementAggP,
      pharmacyReturnAggP, advanceInAggP, advanceOutAggP,
    ]);

  const bp  = billPaymentsAgg[0]        || { billPayments: 0, advanceAdjustments: 0, billRefundsOut: 0 };
  const phD = pharmacyDispenseAgg[0]    || { gross: 0, count: 0 };
  const phS = pharmacySupplementAgg[0]  || { gross: 0, count: 0 };
  const phR = pharmacyReturnAgg[0]      || { gross: 0, count: 0 };
  const ai  = advanceInAgg[0]           || { advanceIn: 0 };
  const ao  = advanceOutAgg[0]          || { advanceRefundOut: 0 };

  const billPayments       = toNum(bp.billPayments);
  const advanceAdjustments = toNum(bp.advanceAdjustments);
  const billRefundsOut     = toNum(bp.billRefundsOut);

  // R7hr-12 (D2-05) — pharmacyRevenue is now the accrual-basis sum:
  //   dispense grandTotal in window
  // + supplements.addedTotal added in window
  // - returns.refundAmount refunded in window
  const pharmacyDispenseRevenue   = toNum(phD.gross);
  const pharmacySupplementRevenue = toNum(phS.gross);
  const pharmacyReturnReversal    = toNum(phR.gross);
  const pharmacyRevenue = +(
    pharmacyDispenseRevenue + pharmacySupplementRevenue - pharmacyReturnReversal
  ).toFixed(2);

  // ── Revenue: bill payments + advance adjustments + pharmacy, minus refunds.
  const revenue = +(billPayments + advanceAdjustments + pharmacyRevenue - billRefundsOut).toFixed(2);

  return {
    from, to,
    billPayments,
    advanceAdjustments,
    pharmacyRevenue,
    // R7hr-12 D2-05 — expose the per-leg breakdown for reconciliation.
    pharmacyDispenseRevenue,
    pharmacySupplementRevenue,
    pharmacyReturnReversal,
    pharmacyCount:      phD.count || 0,
    pharmacySupplementsCount: phS.count || 0,
    pharmacyReturnsCount:     phR.count || 0,
    billRefundsOut,
    revenue,
    advanceLiabilityIn: toNum(ai.advanceIn),
    advanceRefundsOut:  toNum(ao.advanceRefundOut),
  };
}

module.exports = {
  todayRevenue,
};
