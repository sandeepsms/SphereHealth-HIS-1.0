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
  // R7bh-F2 / R7bg-1-CRIT-12: placeOfSupply-driven CGST/SGST/IGST split.
  // Until R7bh PharmacySale had no placeOfSupply field, so this pipeline
  // hard-split CGST=SGST=gst/2 even when the buyer was in another state
  // (under-reporting IGST on GSTR-1). With placeOfSupply now first-class
  // on PharmacySale, the split obeys:
  //   intraState = (no placeOfSupply  ||  placeOfSupply === hospitalState)
  //                → CGST = SGST = gstAmount / 2 ; IGST = 0
  //   interState = otherwise
  //                → CGST = SGST = 0 ; IGST = gstAmount
  // If the SALE_ITEM already stored its own split (post-R7bh writers),
  // those values win — we fall back to the placeOfSupply heuristic only
  // when the split fields are empty/zero (legacy rows).
  //
  // Hospital state code resolves to:
  //   1. process.env.HOSPITAL_STATE_CODE (preferred)
  //   2. empty string → intra-state assumed everywhere (legacy default)
  //
  // HSN comes from Drug master (denormalised here via $lookup).
  const hospitalStateCode = (process.env.HOSPITAL_STATE_CODE || "").trim();
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
    { $addFields: {
        _gst: { $toDouble: { $ifNull: ["$items.gstAmount", 0] } },
        _pos: { $trim: { input: { $ifNull: ["$placeOfSupply", ""] } } },
        // Per-line split if writer provided it (post-R7bh sale writes).
        _lineCgst: { $toDouble: { $ifNull: ["$items.cgstAmount", 0] } },
        _lineSgst: { $toDouble: { $ifNull: ["$items.sgstAmount", 0] } },
        _lineIgst: { $toDouble: { $ifNull: ["$items.igstAmount", 0] } },
    } },
    { $addFields: {
        _hasLineSplit: { $gt: [
          { $add: ["$_lineCgst", "$_lineSgst", "$_lineIgst"] }, 0,
        ] },
        _isInterState: {
          $cond: [
            // No hospital state configured → cannot detect inter-state.
            { $eq: [hospitalStateCode, ""] },
            false,
            { $cond: [
              // No placeOfSupply on the sale → fall back to intra-state.
              { $eq: ["$_pos", ""] },
              false,
              { $ne: ["$_pos", hospitalStateCode] },
            ] },
          ],
        },
    } },
    { $project: {
        _id: 0,
        source:       { $literal: "pharmacy" },
        rate:         { $toDouble: "$items.gstRate" },
        taxableValue: { $toDouble: { $ifNull: ["$items.taxableAmount", 0] } },
        cgst: { $cond: [
          "$_hasLineSplit", "$_lineCgst",
          { $cond: ["$_isInterState", 0, { $divide: ["$_gst", 2] }] },
        ] },
        sgst: { $cond: [
          "$_hasLineSplit", "$_lineSgst",
          { $cond: ["$_isInterState", 0, { $divide: ["$_gst", 2] }] },
        ] },
        igst: { $cond: [
          "$_hasLineSplit", "$_lineIgst",
          { $cond: ["$_isInterState", "$_gst", 0] },
        ] },
        taxAmount:    "$_gst",
        hsnSac:       { $ifNull: [{ $arrayElemAt: ["$_drug.hsnCode", 0] }, ""] },
    } },
  ];

  // R7hr-12 (D2-04) — Pharmacy refunds (PharmacySale.returns[]) live as
  // embedded sub-docs and were silently dropped from the GSTR-1 / GSTR-3B
  // aggregate. Likewise supplements (PharmacySale.supplements[]) — which
  // are NEVER folded back into items[] per schema design — were missing
  // entirely. We emit two more streams that share the projection shape
  // so the existing $group buckets add the supplements and subtract the
  // refunds. The sub-doc's own timestamp (refundedAt / addedAt) drives
  // the period filter so a refund/supplement issued in month M+1 lands
  // in M+1, not in the original sale's M.
  //
  // Refund / supplement lines may not carry per-line CGST/SGST/IGST split,
  // so we derive intra-state at the parent-sale level via placeOfSupply
  // and apply the same gst/2 logic. If items already carry the split
  // (post-R7hr-12 writers), those win.
  const _intraStateExpr = {
    $cond: [
      { $eq: [hospitalStateCode, ""] },
      true,
      { $cond: [
        { $eq: ["$_pos", ""] }, true,
        { $eq: ["$_pos", hospitalStateCode] },
      ] },
    ],
  };

  // Refunds → NEGATIVE-signed rows (subtracted from outward).
  const pharmacyRefundsPipeline = [
    { $match: { "returns.0": { $exists: true } } },
    { $unwind: "$returns" },
    { $match: {
        "returns.refundedAt": { $gte: periodStart, $lt: periodEnd },
    } },
    { $unwind: "$returns.refundedItems" },
    { $match: { "returns.refundedItems.gstAmount": { $gt: 0 } } },
    { $lookup: {
        from: "pharmacydrugs",
        localField: "returns.refundedItems.drugId",
        foreignField: "_id",
        as: "_drug",
        pipeline: [{ $project: { hsnCode: 1 } }],
    } },
    { $addFields: {
        _gst: { $toDouble: { $ifNull: ["$returns.refundedItems.gstAmount", 0] } },
        _pos: { $trim: { input: { $ifNull: ["$placeOfSupply", ""] } } },
        _lineCgst: { $toDouble: { $ifNull: ["$returns.refundedItems.cgstAmount", 0] } },
        _lineSgst: { $toDouble: { $ifNull: ["$returns.refundedItems.sgstAmount", 0] } },
        _lineIgst: { $toDouble: { $ifNull: ["$returns.refundedItems.igstAmount", 0] } },
    } },
    { $addFields: {
        _hasLineSplit: { $gt: [{ $add: ["$_lineCgst", "$_lineSgst", "$_lineIgst"] }, 0] },
        _isIntraState: _intraStateExpr,
    } },
    { $project: {
        _id: 0,
        source: { $literal: "pharmacy" },
        rate: { $toDouble: "$returns.refundedItems.gstRate" },
        // Negative-signed so $sum subtracts.
        taxableValue: { $multiply: [
          { $toDouble: { $ifNull: ["$returns.refundedItems.taxableAmount", 0] } },
          -1,
        ] },
        cgst: { $multiply: [
          { $cond: [
            "$_hasLineSplit", "$_lineCgst",
            { $cond: ["$_isIntraState", { $divide: ["$_gst", 2] }, 0] },
          ] }, -1,
        ] },
        sgst: { $multiply: [
          { $cond: [
            "$_hasLineSplit", "$_lineSgst",
            { $cond: ["$_isIntraState", { $divide: ["$_gst", 2] }, 0] },
          ] }, -1,
        ] },
        igst: { $multiply: [
          { $cond: [
            "$_hasLineSplit", "$_lineIgst",
            { $cond: ["$_isIntraState", 0, "$_gst"] },
          ] }, -1,
        ] },
        taxAmount: { $multiply: ["$_gst", -1] },
        hsnSac: { $ifNull: [{ $arrayElemAt: ["$_drug.hsnCode", 0] }, ""] },
    } },
  ];

  // Supplements → POSITIVE-signed rows (added to outward).
  const pharmacySupplementsPipeline = [
    { $match: { "supplements.0": { $exists: true } } },
    { $unwind: "$supplements" },
    { $match: {
        "supplements.addedAt": { $gte: periodStart, $lt: periodEnd },
    } },
    { $unwind: "$supplements.addedItems" },
    { $match: { "supplements.addedItems.gstAmount": { $gt: 0 } } },
    { $lookup: {
        from: "pharmacydrugs",
        localField: "supplements.addedItems.drugId",
        foreignField: "_id",
        as: "_drug",
        pipeline: [{ $project: { hsnCode: 1 } }],
    } },
    { $addFields: {
        _gst: { $toDouble: { $ifNull: ["$supplements.addedItems.gstAmount", 0] } },
        _pos: { $trim: { input: { $ifNull: ["$placeOfSupply", ""] } } },
        _lineCgst: { $toDouble: { $ifNull: ["$supplements.addedItems.cgstAmount", 0] } },
        _lineSgst: { $toDouble: { $ifNull: ["$supplements.addedItems.sgstAmount", 0] } },
        _lineIgst: { $toDouble: { $ifNull: ["$supplements.addedItems.igstAmount", 0] } },
    } },
    { $addFields: {
        _hasLineSplit: { $gt: [{ $add: ["$_lineCgst", "$_lineSgst", "$_lineIgst"] }, 0] },
        _isIntraState: _intraStateExpr,
    } },
    { $project: {
        _id: 0,
        source: { $literal: "pharmacy" },
        rate: { $toDouble: "$supplements.addedItems.gstRate" },
        taxableValue: { $toDouble: { $ifNull: ["$supplements.addedItems.taxableAmount", 0] } },
        cgst: { $cond: [
          "$_hasLineSplit", "$_lineCgst",
          { $cond: ["$_isIntraState", { $divide: ["$_gst", 2] }, 0] },
        ] },
        sgst: { $cond: [
          "$_hasLineSplit", "$_lineSgst",
          { $cond: ["$_isIntraState", { $divide: ["$_gst", 2] }, 0] },
        ] },
        igst: { $cond: [
          "$_hasLineSplit", "$_lineIgst",
          { $cond: ["$_isIntraState", 0, "$_gst"] },
        ] },
        taxAmount: "$_gst",
        hsnSac: { $ifNull: [{ $arrayElemAt: ["$_drug.hsnCode", 0] }, ""] },
    } },
  ];

  // ── Combined facet on the merged stream ────────────────────────
  // PatientBill.aggregate is the entry collection; $unionWith pulls the
  // pharmacy stream into the same pipeline. Both project to the same
  // {source, rate, taxableValue, cgst, sgst, igst, taxAmount, hsnSac}
  // shape so downstream $group works uniformly.
  // R7hr-12 (D2-04): three pharmacy streams now contribute — original
  // sales (positive), refunds (negative), supplements (positive).
  const combined = await PatientBill.aggregate([
    ...hospitalPipeline,
    { $unionWith: { coll: "pharmacysales", pipeline: pharmacyPipeline } },
    { $unionWith: { coll: "pharmacysales", pipeline: pharmacyRefundsPipeline } },
    { $unionWith: { coll: "pharmacysales", pipeline: pharmacySupplementsPipeline } },
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
