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
 *         + pharmacy dispense cash (initial cash leg at counter)
 *         + pharmacy credit-collections (collectionLog rows in window)
 *         + pharmacy supplements (addedAt in window, amountPaid)
 *     Cash Out =
 *         + bill refunds (negative non-voided payments)
 *         + advance refunds (PatientAdvance.refundedAmount, status REFUNDED)
 *         + pharmacy returns (refundedAt in window, refundMode Cash/Card/UPI)
 *     Net Cash = Cash In - Cash Out - TDS deducted
 *
 *   The reversed-refund leg was the missing piece — without it a
 *   cashier who refunded ₹500 in error and then voided it ended the day
 *   with a ₹500 hole in the till.
 *
 *   R7hr-12 (D2-05) — pharmacy revenue was over- AND under-reported
 *   simultaneously: supplements never updated grandTotal (under),
 *   returns never subtracted from grandTotal (over), credit
 *   collections were ignored (under), partial-pay sales counted full
 *   grandTotal (over). The pharmacy block is now four independent
 *   timestamp-bucketed legs so each event is counted on the day it
 *   actually happened.
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
  // R7hr-12 (D2-05): the pre-fix aggregation summed `grandTotal` of
  // sales created in window. That was wrong on FOUR legs:
  //   (a) Supplements — addedTotal never updates grandTotal, so
  //       supplement revenue (real cash at counter) was invisible.
  //   (b) Partial-Return — refund cash actually leaves the till but
  //       grandTotal stays unchanged; over-reported on every refund.
  //   (c) Credit-collection — when an IPD/credit sale was later paid
  //       (collectionLog), the cash hit the till but never the
  //       Day-Book. Worse, collectCredit flips paymentMode from
  //       "Credit" → Cash/UPI/Mixed on full settlement, so historical
  //       Day-Book runs MUTATE retroactively (a yesterday's credit
  //       sale fully cleared today suddenly appears in yesterday's
  //       cashIn on the next re-run).
  //   (d) Partial pay (Cash + balanceDue > 0) — counted full
  //       grandTotal even though only `amountPaid` actually hit the
  //       till.
  //
  // The fix splits pharmacy cash into FOUR independent legs, each
  // bucketed by its own timestamp:
  //   1. dispense — initialCash = amountPaid - sum(collectionLog
  //      amounts) for the sale; bucketed by current paymentMode but
  //      ONLY when initialCash > 0 (defangs the paymentMode mutation
  //      problem because we measure actual money landed, not the
  //      label).
  //   2. collections — collectionLog rows with collectedAt in window
  //      contribute by their own `mode`. This is where the credit
  //      payments finally show up in cashIn.
  //   3. returns — returns rows with refundedAt in window AND
  //      refundMode in {Cash,Card,UPI} contribute to cashOut. Other
  //      modes ("Adjusted"/"Credit-note") are balance-sheet only.
  //   4. supplements — supplements rows with addedAt in window
  //      contribute amountPaid (NOT addedTotal — addedTotal includes
  //      credit portion) bucketed by their paymentMode.
  //
  // paymentMode/mode strings are Title-case — uppercase-normalise
  // before bucketing so pharmacy collides with hospital keys
  // (CASH/CARD/UPI/...). R7bg-3-HIGH-1 case-drift fix.
  const _UC_MODE_PMODE = { $toUpper: { $ifNull: ["$paymentMode", "Cash"] } };
  const _NUM_GRAND = { $toDouble: { $ifNull: ["$grandTotal", 0] } };

  // Leg 1 — dispense cash leg. Initial cash = amountPaid less every
  // collectionLog row (irrespective of when collected — those land in
  // Leg 2 keyed on collectedAt). Only count where initialCash > 0
  // because credit-only dispenses contribute nothing here.
  const pharmacyDispenseAggP = PharmacySale.aggregate([
    { $match: {
        createdAt: { $gte: start, $lt: end },
        status: { $in: ["Completed", "Supplemented", "Partial-Return"] },
    } },
    { $addFields: {
        _paid: { $toDouble: { $ifNull: ["$amountPaid", 0] } },
        _collSum: {
          $reduce: {
            input: { $ifNull: ["$collectionLog", []] },
            initialValue: 0,
            in: { $add: [
              "$$value",
              { $toDouble: { $ifNull: ["$$this.amount", 0] } },
            ] },
          },
        },
        _mode: _UC_MODE_PMODE,
        _grandTotal: _NUM_GRAND,
    } },
    { $addFields: {
        _initialCash: { $subtract: ["$_paid", "$_collSum"] },
    } },
    // Only the cash that physically landed at dispense. Credit sales
    // (paymentMode "Credit" at dispense with amountPaid=0) drop out
    // here via _initialCash <= 0 — they'll show up in Leg 2 when the
    // patient pays, on the day they pay.
    { $match: { _initialCash: { $gt: 0 } } },
    { $facet: {
        total: [
          { $group: { _id: null, total: { $sum: "$_initialCash" }, count: { $sum: 1 } } },
        ],
        byMode: [
          { $group: { _id: "$_mode", total: { $sum: "$_initialCash" }, count: { $sum: 1 } } },
        ],
    } },
  ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

  // Leg 2 — credit-collection leg. Every collectionLog row whose
  // collectedAt falls in window contributes real cash today. Bucket
  // by the row's own mode (Cash/Card/UPI/Mixed). "Advance" and
  // "Credit" modes are dropped (advance is a balance-sheet transfer
  // from the patient's prepaid pool — no fresh till hit; "Credit"
  // here would mean another credit promise, defensively skipped).
  const pharmacyCollectAggP = PharmacySale.aggregate([
    { $match: {
        "collectionLog.collectedAt": { $gte: start, $lt: end },
    } },
    { $unwind: "$collectionLog" },
    { $match: { "collectionLog.collectedAt": { $gte: start, $lt: end } } },
    { $addFields: {
        _amt:  { $toDouble: { $ifNull: ["$collectionLog.amount", 0] } },
        _mode: { $toUpper: { $ifNull: ["$collectionLog.mode", "Cash"] } },
    } },
    { $match: {
        _amt: { $gt: 0 },
        _mode: { $nin: ["CREDIT", "ADVANCE"] },
    } },
    { $facet: {
        total: [
          { $group: { _id: null, total: { $sum: "$_amt" }, count: { $sum: 1 } } },
        ],
        byMode: [
          { $group: { _id: "$_mode", total: { $sum: "$_amt" }, count: { $sum: 1 } } },
        ],
    } },
  ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

  // Leg 3 — returns leg (cash out). Only refundMode in
  // {Cash,Card,UPI} hits the till; "Credit-note"/"Adjusted" sit on
  // the patientCredit balance sheet and don't move cash.
  const pharmacyReturnAggP = PharmacySale.aggregate([
    { $match: { "returns.refundedAt": { $gte: start, $lt: end } } },
    { $unwind: "$returns" },
    { $match: {
        "returns.refundedAt": { $gte: start, $lt: end },
        "returns.refundMode": { $in: ["Cash", "Card", "UPI"] },
    } },
    { $addFields: {
        _amt:  { $toDouble: { $ifNull: ["$returns.refundAmount", 0] } },
        _mode: { $toUpper: { $ifNull: ["$returns.refundMode", "Cash"] } },
    } },
    { $match: { _amt: { $gt: 0 } } },
    { $facet: {
        total: [
          { $group: { _id: null, total: { $sum: "$_amt" }, count: { $sum: 1 } } },
        ],
        byMode: [
          { $group: { _id: "$_mode", total: { $sum: "$_amt" }, count: { $sum: 1 } } },
        ],
    } },
  ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

  // Leg 4 — supplements leg. The cash leg of a supplement is its own
  // amountPaid, NOT addedTotal (addedTotal includes credit). Bucket
  // by the supplement's own paymentMode and skip Credit.
  const pharmacySupplementAggP = PharmacySale.aggregate([
    { $match: { "supplements.addedAt": { $gte: start, $lt: end } } },
    { $unwind: "$supplements" },
    { $match: { "supplements.addedAt": { $gte: start, $lt: end } } },
    { $addFields: {
        _amt:  { $toDouble: { $ifNull: ["$supplements.amountPaid", 0] } },
        _mode: { $toUpper: { $ifNull: ["$supplements.paymentMode", "Cash"] } },
    } },
    { $match: {
        _amt: { $gt: 0 },
        _mode: { $ne: "CREDIT" },
    } },
    { $facet: {
        total: [
          { $group: { _id: null, total: { $sum: "$_amt" }, count: { $sum: 1 } } },
        ],
        byMode: [
          { $group: { _id: "$_mode", total: { $sum: "$_amt" }, count: { $sum: 1 } } },
        ],
    } },
  ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

  const [billsAgg, advIn, advOut,
         pharmacyDispenseAgg, pharmacyCollectAgg,
         pharmacyReturnAgg, pharmacySupplementAgg] = await Promise.all([
    billsAggP, advanceInAggP, advanceOutAggP,
    pharmacyDispenseAggP, pharmacyCollectAggP,
    pharmacyReturnAggP, pharmacySupplementAggP,
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

  // ── Pharmacy retail (R7bg-1-CRIT-13, R7hr-12 D2-05) ─────────────
  // Four separate legs — see comment block above the aggregations
  // for the why. Each leg has its own `total` (scalar) + `byMode`
  // (per-mode breakdown). cashIn = dispense + collections + supplements;
  // cashOut += pharmacy returns.
  const pharmacyDispenseFacet    = pharmacyDispenseAgg[0]    || {};
  const pharmacyCollectFacet     = pharmacyCollectAgg[0]     || {};
  const pharmacyReturnFacet      = pharmacyReturnAgg[0]      || {};
  const pharmacySupplementFacet  = pharmacySupplementAgg[0]  || {};

  const pharmacyDispenseCash     = toNum(pharmacyDispenseFacet.total?.[0]?.total);
  const pharmacyDispenseCount    = pharmacyDispenseFacet.total?.[0]?.count || 0;
  const pharmacyCreditCollected  = toNum(pharmacyCollectFacet.total?.[0]?.total);
  const pharmacyCollectionsCount = pharmacyCollectFacet.total?.[0]?.count || 0;
  const pharmacyReturnsCash      = toNum(pharmacyReturnFacet.total?.[0]?.total);
  const pharmacyReturnsCount     = pharmacyReturnFacet.total?.[0]?.count || 0;
  const pharmacySupplementsCash  = toNum(pharmacySupplementFacet.total?.[0]?.total);
  const pharmacySupplementsCount = pharmacySupplementFacet.total?.[0]?.count || 0;

  // Total pharmacy cashIn for backward-compat reporting consumers
  // that still read `pharmacyRevenue` — sum of all CashIn legs (the
  // returns leg is netted out separately in cashOut).
  const pharmacyRevenue = +(
    pharmacyDispenseCash + pharmacyCreditCollected + pharmacySupplementsCash
  ).toFixed(2);
  const pharmacyCount   = pharmacyDispenseCount; // keep old semantic: # of dispense rows

  // Merge pharmacy byMode rows from ALL three cashIn legs into the
  // bill byMode list (keyed on UPPERCASE mode). Returns leg is NOT
  // merged here — it nets cashOut, not cashIn.
  const byModeMap = new Map(byMode.map((r) => [r.mode, { ...r }]));
  const _mergeInto = (list) => {
    for (const r of (list || [])) {
      const mode = r._id;
      const existing = byModeMap.get(mode) || { mode, amount: 0, count: 0 };
      existing.amount = +(existing.amount + toNum(r.total)).toFixed(2);
      existing.count  = (existing.count || 0) + (r.count || 0);
      byModeMap.set(mode, existing);
    }
  };
  _mergeInto(pharmacyDispenseFacet.byMode);
  _mergeInto(pharmacyCollectFacet.byMode);
  _mergeInto(pharmacySupplementFacet.byMode);
  const byModeMerged = Array.from(byModeMap.values()).sort((a, b) => b.amount - a.amount);

  // Cash In = collections + advances + reversed refunds + pharmacy
  //   (R7bg-1-CRIT-13 — pharmacy retail cash was missing entirely)
  //   (R7hr-12 D2-05 — pharmacy split into dispense + credit-collections
  //    + supplements; returns leg moved to cashOut)
  const cashIn  = +(collections + advanceDepositsIn + reversedRefunds + pharmacyRevenue).toFixed(2);
  // Cash Out = bill refunds + advance refunds + voided positive payments
  //          + pharmacy returns (Cash/Card/UPI refund modes only)
  const cashOut = +(billRefundsOut + advanceRefundsOut + reversedPayments + pharmacyReturnsCash).toFixed(2);
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
      // R7hr-12 D2-05 — pharmacy cash split. `pharmacyRevenue` stays
      // for backward-compat (= sum of three cashIn legs).
      pharmacyRevenue,
      pharmacyCount,
      pharmacyDispenseCash,
      pharmacyDispenseCount,
      pharmacyCreditCollected,
      pharmacyCollectionsCount,
      pharmacySupplementsCash,
      pharmacySupplementsCount,
      pharmacyReturnsCash,
      pharmacyReturnsCount,
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
