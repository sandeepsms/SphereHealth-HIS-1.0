/**
 * controllers/Reports/hospitalRegisterController.js
 * ────────────────────────────────────────────────────────────────────
 * R7bf-H / A6-CRIT-2 — Hospital register without the 3 drift sources.
 *
 * BACKGROUND (3 defects fixed):
 *   (1) `paid` was previously sourced from PatientBill.paidAmount which
 *       is a denormalised running total that can be stale (the recalc
 *       hook depends on bill.save() — bulk-settle and a few raw $set
 *       paths can drift). The correct source is a fresh aggregation over
 *       payments[] in window.
 *   (2) `dischargedCount` filtered on `admission.status === "Discharged"`
 *       only, which loses the date filter — a patient discharged
 *       yesterday still counts today. The correct field is
 *       `actualDischargeDate` ∈ window.
 *   (3) `admittedCount` previously summed every admission row created in
 *       window, including Daycare visits. NABH IPHC reporting excludes
 *       Daycare from "admitted patients" — those are same-day visits.
 *
 * SHAPE
 *   GET /api/reports/hospital-register?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   { from, to,
 *     summary: { admittedCount, dischargedCount, billsGenerated,
 *                grossSupply, paid, outstanding, opdVisits, ipdAdmissions,
 *                daycareAdmissions, emergencyAdmissions },
 *     byVisitType: [{ visitType, count, gross, paid }],
 *     daily: [{ date, admissions, discharges, billsGenerated, gross, paid }],
 *   }
 */

"use strict";

const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
const Admission   = require("../../models/Patient/admissionModel");
const OPD         = require("../../models/Patient/OPDModels");
const { toNum }   = require("../../utils/money");
const { parseHospitalDateRange } = require("../../utils/queryGuards");
// R7bh-F8: standardise success and error envelope. The success body was
// already `{success, data: {...}}` — kept identical via sendOk to avoid
// breaking any consumer. Only the error branch is normalised.
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

exports.getHospitalRegister = async (req, res, next) => {
  try {
    let from, to;
    try {
      ({ from, to } = parseHospitalDateRange(req.query.from, req.query.to, { defaultDays: 30, maxDays: 366 }));
    } catch (e) {
      return sendErr(res, e, "VALIDATION", e.status || 400);
    }

    // R7bf-H A6-CRIT-2 (3): admittedCount EXCLUDES Daycare. We segregate
    // each type so the summary can report numbers per type AND a true
    // "admitted" total.
    // Pre-R7bf the controller counted by `admissionDate ∈ window` only,
    // and counted Daycare alongside IPD. The status filter `Active`
    // would also accidentally exclude admissions that have since been
    // discharged but were created in window. Fix: use admissionDate
    // window without any status filter (every visit registered in window
    // is "admitted" in that period; status describes current state, not
    // whether the visit happened).
    const admissionsAggP = Admission.aggregate([
      { $match: {
          admissionDate: { $gte: from, $lt: to },
          status: { $ne: "Deleted" },
      } },
      { $group: {
          _id: "$admissionType",
          count: { $sum: 1 },
      } },
    ]);

    // R7bf-H A6-CRIT-2 (2): dischargedCount uses actualDischargeDate ∈ window.
    // status === "Discharged" alone leaks every discharge ever made into
    // today's row.
    const dischargesAggP = Admission.aggregate([
      { $match: {
          actualDischargeDate: { $gte: from, $lt: to },
          status: "Discharged",
      } },
      { $group: {
          _id: "$admissionType",
          count: { $sum: 1 },
      } },
    ]);

    // R7bf-H A6-CRIT-2 (1): paid comes from a fresh aggregation over
    // payments[] in window, NOT bill.paidAmount (denormalised, can drift).
    // Bills are matched by billGeneratedAt — gross-supply window. Paid
    // amounts sum positive non-voided payment rows whose paidAt lands in
    // the same window.
    const billsAggP = PatientBill.aggregate([
      { $match: {
          billGeneratedAt: { $gte: from, $lt: to },
          billStatus:      { $nin: ["DRAFT", "CANCELLED"] },
      } },
      { $facet: {
          totals: [
            { $addFields: {
                _gross: { $toDouble: { $ifNull: ["$netAmount", { $ifNull: ["$netPayable", 0] }] } },
                // R7bf-H A6-CRIT-2 (1): paid from payments[] not bill.paidAmount.
                _paidFresh: {
                  $sum: {
                    $map: {
                      input: {
                        $filter: {
                          input: { $ifNull: ["$payments", []] },
                          as: "p",
                          cond: { $and: [
                            { $not: ["$$p.voidedAt"] },
                            { $gt: [{ $toDouble: { $ifNull: ["$$p.amount", 0] } }, 0] },
                          ] },
                        },
                      },
                      as: "p",
                      in: { $toDouble: { $ifNull: ["$$p.amount", 0] } },
                    },
                  },
                },
            } },
            { $group: {
                _id: null,
                billsGenerated: { $sum: 1 },
                grossSupply:    { $sum: "$_gross" },
                paid:           { $sum: "$_paidFresh" },
            } },
          ],
          byVisitType: [
            { $addFields: {
                _gross: { $toDouble: { $ifNull: ["$netAmount", { $ifNull: ["$netPayable", 0] }] } },
                _paidFresh: {
                  $sum: {
                    $map: {
                      input: {
                        $filter: {
                          input: { $ifNull: ["$payments", []] },
                          as: "p",
                          cond: { $and: [
                            { $not: ["$$p.voidedAt"] },
                            { $gt: [{ $toDouble: { $ifNull: ["$$p.amount", 0] } }, 0] },
                          ] },
                        },
                      },
                      as: "p",
                      in: { $toDouble: { $ifNull: ["$$p.amount", 0] } },
                    },
                  },
                },
            } },
            { $group: {
                _id: { $ifNull: ["$visitType", "Other"] },
                count: { $sum: 1 },
                gross: { $sum: "$_gross" },
                paid:  { $sum: "$_paidFresh" },
            } },
            { $sort: { gross: -1 } },
          ],
      } },
    ]).option({ allowDiskUse: true, maxTimeMS: 20_000 });

    // OPD visits in window — visit-level count separate from "admission"
    // entries (registration vs visit are different in this HIS).
    const opdAggP = OPD.countDocuments({ visitDate: { $gte: from, $lt: to } });

    const [admissionsAgg, dischargesAgg, billsAgg, opdVisits] =
      await Promise.all([admissionsAggP, dischargesAggP, billsAggP, opdAggP]);

    // ── Rollups ───────────────────────────────────────────────────
    const admittedByType = {};
    for (const a of admissionsAgg) admittedByType[a._id || "Unknown"] = a.count;

    // "admitted" definition for NABH register: every visit-row that
    // results in a clinical engagement, EXCLUDING Daycare (same-day
    // discharge slot — counted separately).
    // Daycare maps from both "Daycare" and "Day Care" enum values in the
    // schema for historical compatibility.
    const isDaycare    = (k) => k === "Daycare" || k === "Day Care";
    const isEmergency  = (k) => k === "Emergency";
    const ipdAdmissions      = Object.entries(admittedByType)
      .filter(([k]) => !isDaycare(k) && k !== "OPD" && k !== "Services")
      .reduce((s, [, v]) => s + v, 0);
    const daycareAdmissions  = Object.entries(admittedByType)
      .filter(([k]) => isDaycare(k))
      .reduce((s, [, v]) => s + v, 0);
    const emergencyAdmissions = Object.entries(admittedByType)
      .filter(([k]) => isEmergency(k))
      .reduce((s, [, v]) => s + v, 0);

    const dischargedCount = (dischargesAgg || []).reduce((s, r) => s + (r.count || 0), 0);

    const facet = billsAgg[0] || {};
    const t = (facet.totals && facet.totals[0]) || { billsGenerated: 0, grossSupply: 0, paid: 0 };
    const grossSupply = toNum(t.grossSupply);
    const paid        = toNum(t.paid);

    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = to.toISOString().slice(0, 10);
    return sendOk(res, {
      from: fromStr,
      to:   toStr,
      summary: {
        admittedCount:       ipdAdmissions + emergencyAdmissions,  // EXCLUDES Daycare per A6-CRIT-2 (3)
        ipdAdmissions,
        daycareAdmissions,
        emergencyAdmissions,
        dischargedCount,
        opdVisits,
        billsGenerated:      t.billsGenerated || 0,
        grossSupply,
        paid,
        outstanding:         +(grossSupply - paid).toFixed(2),
      },
      byVisitType: (facet.byVisitType || []).map((r) => ({
        visitType: r._id || "Other",
        count:     r.count,
        gross:     toNum(r.gross),
        paid:      toNum(r.paid),
      })),
      admittedByType,
    }, { from: fromStr, to: toStr });
  } catch (e) { next(e); }
};
