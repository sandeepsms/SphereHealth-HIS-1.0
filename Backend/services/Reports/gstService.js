/**
 * services/Reports/gstService.js
 * ────────────────────────────────────────────────────────────────────
 * R7bf-H / A6-CRIT-1 — Pharmacy GST included in monthly snapshot.
 *
 * BACKGROUND
 *   Pre-R7bf the monthly snapshot cron in Backend/index.js only aggregated
 *   PatientBill.billItems (hospital service GST: consultation / room /
 *   procedure / investigation). Pharmacy GST lives on PharmacySale.items
 *   and was completely ignored — every month's GSTR-1 outward supply
 *   under-reported by the entire pharmacy turnover (~30-40% of a typical
 *   hospital's tax base). This is a filing-level defect, not a display
 *   glitch.
 *
 * THIS MODULE
 *   `aggregateGSTForMonth(periodStart, periodEnd)` returns the same shape
 *   the cron writes into GstMonthlySnapshot, but $unionWith merges
 *   PatientBill bill-item rows with PharmacySale item rows so a single
 *   pipeline emits the combined buckets. The cron and the live register
 *   both call this helper so the two views can't drift.
 *
 *   Output buckets: per-taxPercent rows with taxableValue / cgst / sgst /
 *   igst sums. HSN/SAC codes are aggregated separately so GSTR-1 line 12
 *   (HSN summary) can be emitted with one extra grouping later.
 */

"use strict";

const PatientBill   = require("../../models/PatientBillModel/PatientBillModel");
const PharmacySale  = require("../../models/Pharmacy/PharmacySaleModel");
const Drug          = require("../../models/Pharmacy/DrugModel");
const { toNum }     = require("../../utils/money");

/**
 * Aggregate combined hospital-service + pharmacy GST for the IST period
 * `[periodStart, periodEnd)`. Returns:
 *   {
 *     buckets:        [{ rate, taxableValue, cgst, sgst, igst, taxAmount,
 *                        itemCount, source }],
 *     grossTotals:    { taxableValue, cgst, sgst, igst, taxAmount, itemCount },
 *     bySource:       { hospital: { ... }, pharmacy: { ... } },
 *     byHsn:          [{ hsnSac, taxableValue, taxAmount, itemCount }],
 *   }
 *
 * @param {Date} periodStart
 * @param {Date} periodEnd  exclusive
 */
async function aggregateGSTForMonth(periodStart, periodEnd) {
  if (!(periodStart instanceof Date) || !(periodEnd instanceof Date)) {
    throw new Error("aggregateGSTForMonth: periodStart and periodEnd must be Date");
  }
  if (!(periodEnd > periodStart)) {
    throw new Error("aggregateGSTForMonth: periodEnd must be > periodStart");
  }
  // ── Hospital side (PatientBill.billItems) ──────────────────────
  // Match the existing gst-monthly-snapshot cron exactly so the result
  // sums identically when pharmacy contributes 0. R7as-FIX-6 anchored
  // billGeneratedAt as the immutable period key — preserved here.
  const hospitalPipeline = [
    { $match: {
        billGeneratedAt: { $gte: periodStart, $lt: periodEnd },
        billStatus:      { $nin: ["DRAFT", "CANCELLED"] },
    } },
    { $unwind: "$billItems" },
    { $match: {
        "billItems.excludedByPackage": { $ne: true },
        "billItems.isTaxable":         true,
        "billItems.taxPercent":        { $gt: 0 },
    } },
    { $project: {
        _id: 0,
        source:       { $literal: "hospital" },
        rate:         { $toDouble: "$billItems.taxPercent" },
        taxableValue: { $toDouble: { $ifNull: ["$billItems.netAmount", 0] } },
        cgst:         { $toDouble: { $ifNull: ["$billItems.cgstAmount", 0] } },
        sgst:         { $toDouble: { $ifNull: ["$billItems.sgstAmount", 0] } },
        igst:         { $toDouble: { $ifNull: ["$billItems.igstAmount", 0] } },
        taxAmount:    { $toDouble: { $ifNull: ["$billItems.taxAmount",  0] } },
        hsnSac:       { $ifNull: ["$billItems.hsnSac", "$billItems.hsnCode"] },
    } },
  ];

  // ── Pharmacy side (PharmacySale.items) ─────────────────────────
  // PharmacySale.items.gstRate + gstAmount + taxableAmount. CGST/SGST
  // are not stored split on the item — pharmacy bills are intra-state
  // by default in this HIS, so we split 50/50 (mirrors the same
  // assumption hospital-side made before R7av-FIX-6). When inter-state
  // pharmacy work is added later this can be enriched via $lookup on
  // patient.state vs hospital.state.
  // HSN comes from Drug master (denormalised here via $lookup).
  const pharmacyPipeline = [
    { $match: {
        createdAt: { $gte: periodStart, $lt: periodEnd },
        status:    { $nin: ["Cancelled"] },          // Refunded/Partial-Return still on the GSTR-1 invoice
    } },
    { $unwind: "$items" },
    { $match: {
        "items.gstAmount": { $gt: 0 },
    } },
    { $lookup: {
        from: "pharmacydrugs",
        localField: "items.drugId",
        foreignField: "_id",
        as: "_drug",
        pipeline: [{ $project: { hsnCode: 1 } }],
    } },
    { $project: {
        _id: 0,
        source:       { $literal: "pharmacy" },
        rate:         { $toDouble: "$items.gstRate" },
        taxableValue: { $toDouble: { $ifNull: ["$items.taxableAmount", 0] } },
        cgst:         { $divide: [{ $toDouble: { $ifNull: ["$items.gstAmount", 0] } }, 2] },
        sgst:         { $divide: [{ $toDouble: { $ifNull: ["$items.gstAmount", 0] } }, 2] },
        igst:         { $literal: 0 },
        taxAmount:    { $toDouble: { $ifNull: ["$items.gstAmount",  0] } },
        hsnSac:       { $ifNull: [{ $arrayElemAt: ["$_drug.hsnCode", 0] }, ""] },
    } },
  ];

  // ── Combined facet on the merged stream ────────────────────────
  // PatientBill.aggregate is the entry collection; $unionWith pulls the
  // pharmacy stream into the same pipeline. Both project to the same
  // {source, rate, taxableValue, cgst, sgst, igst, taxAmount, hsnSac}
  // shape so downstream $group works uniformly.
  const combined = await PatientBill.aggregate([
    ...hospitalPipeline,
    { $unionWith: { coll: "pharmacysales", pipeline: pharmacyPipeline } },
    { $facet: {
        buckets: [
          { $group: {
              _id: "$rate",
              taxableValue: { $sum: "$taxableValue" },
              cgst:         { $sum: "$cgst" },
              sgst:         { $sum: "$sgst" },
              igst:         { $sum: "$igst" },
              taxAmount:    { $sum: "$taxAmount" },
              itemCount:    { $sum: 1 },
          } },
          { $project: {
              _id: 0,
              rate: "$_id",
              taxableValue: 1, cgst: 1, sgst: 1, igst: 1, taxAmount: 1, itemCount: 1,
          } },
          { $sort: { rate: 1 } },
        ],
        grossTotals: [
          { $group: {
              _id: null,
              taxableValue: { $sum: "$taxableValue" },
              cgst:         { $sum: "$cgst" },
              sgst:         { $sum: "$sgst" },
              igst:         { $sum: "$igst" },
              taxAmount:    { $sum: "$taxAmount" },
              itemCount:    { $sum: 1 },
          } },
          { $project: { _id: 0 } },
        ],
        bySource: [
          { $group: {
              _id: "$source",
              taxableValue: { $sum: "$taxableValue" },
              cgst:         { $sum: "$cgst" },
              sgst:         { $sum: "$sgst" },
              igst:         { $sum: "$igst" },
              taxAmount:    { $sum: "$taxAmount" },
              itemCount:    { $sum: 1 },
          } },
        ],
        byHsn: [
          { $match: { hsnSac: { $ne: "" } } },
          { $group: {
              _id: "$hsnSac",
              taxableValue: { $sum: "$taxableValue" },
              taxAmount:    { $sum: "$taxAmount" },
              itemCount:    { $sum: 1 },
          } },
          { $project: { _id: 0, hsnSac: "$_id", taxableValue: 1, taxAmount: 1, itemCount: 1 } },
          { $sort: { taxableValue: -1 } },
          { $limit: 500 },
        ],
    } },
  ]).option({ allowDiskUse: true, maxTimeMS: 30_000 });

  const facet = combined[0] || { buckets: [], grossTotals: [], bySource: [], byHsn: [] };
  const buckets = (facet.buckets || []).map((b) => ({
    rate:         toNum(b.rate),
    taxableValue: toNum(b.taxableValue),
    cgst:         toNum(b.cgst),
    sgst:         toNum(b.sgst),
    igst:         toNum(b.igst),
    taxAmount:    toNum(b.taxAmount),
    itemCount:    b.itemCount || 0,
  }));
  const gt = facet.grossTotals[0] || {};
  const grossTotals = {
    taxableValue: toNum(gt.taxableValue),
    cgst:         toNum(gt.cgst),
    sgst:         toNum(gt.sgst),
    igst:         toNum(gt.igst),
    taxAmount:    toNum(gt.taxAmount),
    itemCount:    gt.itemCount || 0,
  };
  const bySource = { hospital: _zeroSrc(), pharmacy: _zeroSrc() };
  for (const r of facet.bySource || []) {
    if (!bySource[r._id]) bySource[r._id] = _zeroSrc();
    bySource[r._id] = {
      taxableValue: toNum(r.taxableValue),
      cgst:         toNum(r.cgst),
      sgst:         toNum(r.sgst),
      igst:         toNum(r.igst),
      taxAmount:    toNum(r.taxAmount),
      itemCount:    r.itemCount || 0,
    };
  }
  const byHsn = (facet.byHsn || []).map((h) => ({
    hsnSac:       h.hsnSac,
    taxableValue: toNum(h.taxableValue),
    taxAmount:    toNum(h.taxAmount),
    itemCount:    h.itemCount || 0,
  }));
  return { buckets, grossTotals, bySource, byHsn };
}

function _zeroSrc() {
  return { taxableValue: 0, cgst: 0, sgst: 0, igst: 0, taxAmount: 0, itemCount: 0 };
}

module.exports = {
  aggregateGSTForMonth,
};
