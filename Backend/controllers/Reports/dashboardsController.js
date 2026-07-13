/**
 * controllers/Reports/dashboardsController.js
 * ────────────────────────────────────────────────────────────────────
 * R7bf-H — Operational dashboards.
 *
 * Endpoints exposed (see routes/Reports/reportsRoutes.js):
 *
 *   GET /api/reports/today-revenue
 *     A6-CRIT-7 — sane revenue rollup that excludes ADVANCE_DEPOSIT.
 *
 *   GET /api/reports/day-book?date=YYYY-MM-DD
 *     A6-CRIT-6 — Day Book with reversed-refund cash-back booking.
 *
 *   GET /api/reports/gst-monthly?period=YYYY-MM
 *     A6-CRIT-1 — combined hospital + pharmacy GST (live aggregate).
 *
 *   GET /api/reports/patient-census
 *     A6-HIGH-1 — IST-anchored census tile (today admissions / discharges).
 *
 *   GET /api/reports/pharmacy-revenue-trend?days=N
 *     A6-HIGH-2 — daily pharmacy revenue series with LRU cache.
 *
 *   GET /api/reports/doctor-performance?from=&to=
 *     A6-HIGH-3 — doctor performance excludes CANCELLED appointments.
 *     A6-HIGH-9 — includes orderedBy-attributed BillingTriggers.
 *
 *   GET /api/reports/bed-occupancy
 *     A6-HIGH-4 — excludes Maintenance / Cleaning beds.
 *
 *   GET /api/reports/lab-tat?from=&to=
 *     A6-HIGH-5 — TAT = verifiedAt - sampleCollectedAt (with workflow
 *     fallback chain).
 *
 *   GET /api/reports/inventory/abc-analysis
 *     A6-HIGH-6 — ABC buckets by 12-month consumption value.
 *
 *   GET /api/reports/ar-aging?asOf=YYYY-MM-DD
 *     A6-HIGH-7 — aging buckets by patient / TPA.
 *
 *   GET /api/reports/daily-collection?date=&page=&limit=
 *     A6-HIGH-8 — paginated drill-down by mode.
 *
 *   GET /api/reports/diagnosis-frequency?from=&to=
 *     A6-HIGH-10 — normalized ICD codes.
 */

"use strict";

const PatientBill    = require("../../models/PatientBillModel/PatientBillModel");
const Admission      = require("../../models/Patient/admissionModel");
const OPD            = require("../../models/Patient/OPDModels");
const Bed            = require("../../models/bedMgmt/bedsModel");
const PharmacySale   = require("../../models/Pharmacy/PharmacySaleModel");
const Investigation  = require("../../models/Investigation/InvestigationOrderModel");
const BillingTrigger = require("../../models/Billing/BillingTrigger");
const Appointment    = require("../../models/Appointment/appointmentModel");

const { toNum } = require("../../utils/money");
const {
  istStartOfToday, istStartOfDayPlus, istEndOfToday,
  parseHospitalDate, parseHospitalDateRange,
} = require("../../utils/queryGuards");
const lruCache = require("../../utils/lruCache");
// R7bh-F8: dashboards envelope normalization. Every response now uses
// `sendOk(res, data, meta?)` — top-level scalars (from/to/date) move into
// `meta`, and primary payloads land under `data`.
const { sendOk, sendErr } = require("../../utils/apiEnvelope");

// R7bf-H A6-HIGH-2: 24h cache previously made bulk-sale staleness lag the
// dashboard for hours. We shorten TTL to 5 min and expose an invalidator the
// pharmacy sale creator can call.
const _pharmacyTrendCache = lruCache({ max: 30, ttlMs: 5 * 60 * 1000 });
exports.invalidatePharmacyTrendCache = () => _pharmacyTrendCache.clear();

const _abcCache    = lruCache({ max: 5,  ttlMs: 60 * 60 * 1000 });   // 1h
const _agingCache  = lruCache({ max: 30, ttlMs: 5 * 60 * 1000 });
const _censusCache = lruCache({ max: 5,  ttlMs: 30 * 1000 });        // 30s

// R7hr-12-S3 (D10-10): cache busters for ABC analysis (post-sale) and AR
// aging (post-payment / post-bill-generate). Without these the dashboards
// were stale by up to 1h (ABC) and 5min (aging) after a write. Callers in
// pharmacyController.createSale + billingController.recordPayment /
// generateBill invoke these best-effort (try/catch swallow) so a cache
// hiccup never blocks the underlying write.
exports.invalidateAbcCache   = () => _abcCache.clear();
exports.invalidateAgingCache = () => _agingCache.clear();

// ════════════════════════════════════════════════════════════════════
// A6-CRIT-7: today's revenue (excludes ADVANCE_DEPOSIT)
// ════════════════════════════════════════════════════════════════════
exports.getTodayRevenue = async (req, res, next) => {
  try {
    const incomeService = require("../../services/Reports/incomeService");
    const data = await incomeService.todayRevenue();
    return sendOk(res, data);
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// A6-CRIT-6: Day Book with reversed-refund cash-back
// ════════════════════════════════════════════════════════════════════
exports.getDayBook = async (req, res, next) => {
  try {
    const dayBookService = require("../../services/Reports/dayBookService");
    const data = await dayBookService.computeDayBook(req.query.date);
    return sendOk(res, data);
  } catch (e) {
    if (e?.status) return sendErr(res, e, e.code || "BAD_REQUEST", e.status);
    next(e);
  }
};

// ════════════════════════════════════════════════════════════════════
// A6-CRIT-1: live GST aggregation (hospital + pharmacy)
// ════════════════════════════════════════════════════════════════════
exports.getMonthlyGst = async (req, res, next) => {
  try {
    const period = String(req.query.period || "").trim();
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return sendErr(res, "period must be YYYY-MM", "VALIDATION", 400);
    }
    const [y, m] = period.split("-").map(Number);
    const periodStart = new Date(`${period}-01T00:00:00+05:30`);
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    const periodEnd = new Date(`${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00+05:30`);
    const gstService = require("../../services/Reports/gstService");
    const data = await gstService.aggregateGSTForMonth(periodStart, periodEnd);
    return sendOk(res, { period, periodStart, periodEnd, ...data }, { period });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// A6-HIGH-1: IST-anchored patient census tile
// ════════════════════════════════════════════════════════════════════
exports.getPatientCensus = async (req, res, next) => {
  try {
    const now = new Date();
    const todayStart = istStartOfToday(now);
    const todayEnd   = istEndOfToday(now);
    const yesterdayStart = istStartOfDayPlus(-1, now);

    const cacheKey = `census:${todayStart.toISOString()}`;
    const data = await _censusCache.get(cacheKey, async () => {
      const [admissionsToday, dischargesToday, opdToday, opdYesterday, ipdActive] = await Promise.all([
        // R7bf-H A6-HIGH-1: IST window — pre-R7bf used setHours(0,0,0,0)
        // server-local, which drifted by 5h30m on UTC-deployed boxes.
        Admission.countDocuments({
          admissionDate: { $gte: todayStart, $lt: todayEnd },
          status:        { $ne: "Deleted" },
          admissionType: { $nin: ["OPD", "Services"] },
        }),
        Admission.countDocuments({
          actualDischargeDate: { $gte: todayStart, $lt: todayEnd },
          status:              "Discharged",
        }),
        OPD.countDocuments({ visitDate: { $gte: todayStart, $lt: todayEnd } }),
        OPD.countDocuments({ visitDate: { $gte: yesterdayStart, $lt: todayStart } }),
        Admission.countDocuments({ status: "Active", hasBed: true }),
      ]);
      return {
        date:             todayStart.toISOString().slice(0, 10),
        admissionsToday,
        dischargesToday,
        opdToday,
        opdYesterday,
        opdDelta:         opdToday - opdYesterday,
        ipdActive,
      };
    });
    return sendOk(res, data);
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// A6-HIGH-2: pharmacy revenue trend (LRU 5-min cache, bustable)
// ════════════════════════════════════════════════════════════════════
exports.getPharmacyRevenueTrend = async (req, res, next) => {
  try {
    const days = Math.min(120, Math.max(1, Number(req.query.days) || 30));
    const cacheKey = `pharmacy-trend:${days}`;
    const data = await _pharmacyTrendCache.get(cacheKey, async () => {
      const start = istStartOfDayPlus(-days);
      const end   = istEndOfToday();
      const rows = await PharmacySale.aggregate([
        { $match: { createdAt: { $gte: start, $lt: end }, status: { $nin: ["Cancelled"] } } },
        { $addFields: {
            _day: {
              $dateToString: {
                date: "$createdAt", timezone: "Asia/Kolkata", format: "%Y-%m-%d",
              },
            },
        } },
        { $group: {
            _id: "$_day",
            count: { $sum: 1 },
            net:   { $sum: { $toDouble: { $ifNull: ["$netAmount", 0] } } },
            grand: { $sum: { $toDouble: { $ifNull: ["$grandTotal", 0] } } },
        } },
        { $sort: { _id: 1 } },
      ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });
      return rows.map((r) => ({ date: r._id, count: r.count, net: toNum(r.net), grand: toNum(r.grand) }));
    });
    return sendOk(res, data);
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// A6-HIGH-3 + A6-HIGH-9: doctor performance dashboard
// ════════════════════════════════════════════════════════════════════
exports.getDoctorPerformance = async (req, res, next) => {
  try {
    let from, to;
    try {
      ({ from, to } = parseHospitalDateRange(req.query.from, req.query.to, { defaultDays: 30, maxDays: 366 }));
    } catch (e) {
      return sendErr(res, e, "VALIDATION", e.status || 400);
    }

    // R7bf-H A6-HIGH-3: appointment counts EXCLUDE Cancelled (and NoShow
    // can be opted-in via ?includeNoShow=true). Pre-R7bf cancelled
    // appointments inflated every doctor's "patients seen" count.
    const includeNoShow = String(req.query.includeNoShow || "").toLowerCase() === "true";
    const excludeStatuses = includeNoShow ? ["Cancelled"] : ["Cancelled", "NoShow"];

    const apptAggP = Appointment.aggregate([
      { $match: {
          appointmentDate: { $gte: from, $lt: to },
          status: { $nin: excludeStatuses },
      } },
      { $group: {
          _id:    "$doctorId",
          name:   { $first: "$doctorName" },
          count:  { $sum: 1 },
          completedCount: {
            $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
          },
      } },
    ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

    // R7bf-H A6-HIGH-9: procedure attribution — every BillingTrigger
    // with orderedByRole="Doctor" is the doctor who initiated the
    // chargeable event. Sum gross revenue by orderedById.
    const triggerAggP = BillingTrigger.aggregate([
      { $match: {
          orderedAt: { $gte: from, $lt: to },
          orderedByRole: "Doctor",
          status: { $in: ["billed", "completed"] },
      } },
      { $group: {
          _id:  "$orderedById",
          name: { $first: "$orderedBy" },
          revenue: { $sum: { $toDouble: { $ifNull: ["$totalAmount", 0] } } },
          triggerCount: { $sum: 1 },
      } },
    ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });

    const [apptAgg, triggerAgg] = await Promise.all([apptAggP, triggerAggP]);

    // Merge appointment and trigger rows by doctor id.
    const byDoctor = new Map();
    for (const r of apptAgg) {
      const id = String(r._id || "unknown");
      byDoctor.set(id, {
        doctorId: r._id,
        name:     r.name || "—",
        appointments: r.count,
        completed:    r.completedCount,
        revenue:      0,
        procedureCount: 0,
      });
    }
    for (const r of triggerAgg) {
      const id = String(r._id || "unknown");
      const row = byDoctor.get(id) || {
        doctorId: r._id, name: r.name || "—", appointments: 0, completed: 0,
        revenue: 0, procedureCount: 0,
      };
      row.revenue = toNum(r.revenue);
      row.procedureCount = r.triggerCount || 0;
      if (!row.name || row.name === "—") row.name = r.name || "—";
      byDoctor.set(id, row);
    }
    const data = [...byDoctor.values()].sort((a, b) => b.revenue - a.revenue);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = to.toISOString().slice(0, 10);
    return sendOk(res,
      { from: fromStr, to: toStr, rows: data },
      { from: fromStr, to: toStr, count: data.length });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// A6-HIGH-4: bed occupancy without Maintenance/Cleaning beds
// ════════════════════════════════════════════════════════════════════
exports.getBedOccupancy = async (req, res, next) => {
  try {
    // R7bf-H A6-HIGH-4: exclude Maintenance + Cleaning-stage beds from
    // the denominator. Cleaning lives on bed.housekeeping.state — when
    // it's any "Cleaning*" state the bed is not in revenue service.
    const rows = await Bed.aggregate([
      { $addFields: {
          _isCleaning: { $in: ["$housekeeping.state", ["CleaningPending", "CleaningInProgress", "CleaningDone"]] },
      } },
      { $match: { status: { $nin: ["Maintenance", "Blocked"] }, _isCleaning: { $ne: true } } },
      { $group: {
          _id: { ward: "$wardName", code: "$wardCode" },
          total:     { $sum: 1 },
          occupied:  { $sum: { $cond: [{ $eq: ["$status", "Occupied"] }, 1, 0] } },
          available: { $sum: { $cond: [{ $eq: ["$status", "Available"] }, 1, 0] } },
          reserved:  { $sum: { $cond: [{ $eq: ["$status", "Reserved"] }, 1, 0] } },
      } },
      { $project: {
          _id: 0,
          ward:   { $ifNull: ["$_id.ward", "Unassigned"] },
          code:   { $ifNull: ["$_id.code", "—"] },
          total: 1, occupied: 1, available: 1, reserved: 1,
          occupancyPct: { $cond: [{ $gt: ["$total", 0] }, { $multiply: [{ $divide: ["$occupied", "$total"] }, 100] }, 0] },
      } },
      { $sort: { total: -1 } },
    ]).option({ allowDiskUse: true, maxTimeMS: 10_000 });
    const totals = rows.reduce(
      (acc, w) => ({
        total: acc.total + w.total,
        occupied: acc.occupied + w.occupied,
        available: acc.available + w.available,
        reserved: acc.reserved + w.reserved,
      }),
      { total: 0, occupied: 0, available: 0, reserved: 0 },
    );
    totals.occupancyPct = totals.total ? Math.round((totals.occupied / totals.total) * 100) : 0;
    return sendOk(res, { totals, byWard: rows });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// A6-HIGH-5: lab TAT (verifiedAt - sampleCollectedAt)
// ════════════════════════════════════════════════════════════════════
exports.getLabTat = async (req, res, next) => {
  try {
    let from, to;
    try {
      ({ from, to } = parseHospitalDateRange(req.query.from, req.query.to, { defaultDays: 30, maxDays: 366 }));
    } catch (e) {
      return sendErr(res, e, "VALIDATION", e.status || 400);
    }
    // R7bf-H A6-HIGH-5: TAT = items[].verifiedAt - items[].sampleCollectedAt.
    // Pre-R7bf we used createdAt for both endpoints, giving a near-zero TAT
    // for every test. sampleCollectedAt / resultEnteredAt / verifiedAt all
    // live on the per-item subdoc, so we unwind first. Fallback chain when
    // collection time is null: resultEnteredAt → order.createdAt.
    const rows = await Investigation.aggregate([
      { $match: { "items.verifiedAt": { $gte: from, $lt: to } } },
      { $unwind: "$items" },
      { $match: {
          "items.verifiedAt": { $gte: from, $lt: to },
          $or: [
            { "items.sampleCollectedAt": { $type: "date" } },
            { "items.resultEnteredAt":   { $type: "date" } },
          ],
      } },
      { $addFields: {
          _startedAt: { $ifNull: [
            "$items.sampleCollectedAt",
            { $ifNull: ["$items.resultEnteredAt", "$createdAt"] },
          ] },
          _category: { $ifNull: ["$items.category", "Other"] },
      } },
      // NABL / ISO 15189 7.4.1 — join each item's TAT TARGET (InvestigationMaster
      // .tatHours) so we can flag breaches + report % within target, not just
      // raw averages. Tests with no target are counted but excluded from the
      // within-target denominator.
      { $lookup: { from: "investigationmasters", localField: "items.investigationId", foreignField: "_id", as: "_mst" } },
      { $addFields: {
          _tatMins: { $divide: [{ $subtract: ["$items.verifiedAt", "$_startedAt"] }, 1000 * 60] },
          _targetMins: { $multiply: [{ $ifNull: [{ $arrayElemAt: ["$_mst.tatHours", 0] }, 0] }, 60] },
      } },
      { $match: { _tatMins: { $gt: 0 } } },
      { $addFields: {
          _targeted:    { $cond: [{ $gt: ["$_targetMins", 0] }, 1, 0] },
          _withinTarget: { $cond: [{ $and: [{ $gt: ["$_targetMins", 0] }, { $lte: ["$_tatMins", "$_targetMins"] }] }, 1, 0] },
      } },
      { $group: {
          _id: "$_category",
          count: { $sum: 1 },
          avgMins: { $avg: "$_tatMins" },
          // R7hr(DEFER-18): true median — collect the per-item TATs and
          // compute in Node (the old medianMins was silently just the avg).
          // Bounded: per-category verified items in a ≤366-day window.
          mins: { $push: "$_tatMins" },
          maxMins: { $max: "$_tatMins" },
          minMins: { $min: "$_tatMins" },
          targetedCount: { $sum: "$_targeted" },
          withinCount:   { $sum: "$_withinTarget" },
      } },
      { $sort: { count: -1 } },
    ]).option({ allowDiskUse: true, maxTimeMS: 20_000 });

    const median = (arr) => {
      if (!arr || !arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = to.toISOString().slice(0, 10);
    const items = rows.map((r) => ({
      category:   r._id,
      count:      r.count,
      avgMins:    Math.round(r.avgMins),
      medianMins: Math.round(median(r.mins)),
      maxMins:    Math.round(r.maxMins),
      minMins:    Math.round(r.minMins),
      // NABL TAT-vs-target
      targetedCount:   r.targetedCount,
      breachCount:     r.targetedCount - r.withinCount,
      pctWithinTarget: r.targetedCount ? Math.round((100 * r.withinCount) / r.targetedCount) : null,
    }));
    // R7hr(LAB-TAT tile): overall rollup mirroring getErTat so a KPI strip
    // can consume one block instead of re-weighting the category rows.
    const totalCount = items.reduce((s, r) => s + r.count, 0);
    const totTargeted = items.reduce((s, r) => s + r.targetedCount, 0);
    const totWithin   = totTargeted - items.reduce((s, r) => s + r.breachCount, 0);
    const overall = totalCount > 0 ? {
      count:   totalCount,
      avgMins: Math.round(items.reduce((s, r) => s + r.avgMins * r.count, 0) / totalCount),
      maxMins: Math.max(...items.map((r) => r.maxMins)),
      targetedCount:   totTargeted,
      breachCount:     totTargeted - totWithin,
      pctWithinTarget: totTargeted ? Math.round((100 * totWithin) / totTargeted) : null,
    } : { count: 0 };
    return sendOk(res,
      { from: fromStr, to: toStr, rows: items, overall },
      { from: fromStr, to: toStr, count: items.length });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// R7hr(NABH-P2.5): IPD discharge TAT — the NABH CQI discharge-process
// quality indicator. dischargeWorkflow has carried the stage timestamps
// (doctorApprovedAt → billClearedAt → gatePassIssuedAt) since R7hr-197,
// but nothing ever derived the metric — the re-audit flagged the
// indicator as absent. Stage semantics:
//   billingMins = doctorApprovedAt → billClearedAt   (cashier settle time)
//   exitMins    = billClearedAt   → gatePassIssuedAt (paperwork/exit time)
//   totalMins   = doctorApprovedAt → gatePassIssuedAt (patient-felt TAT)
// Grouped overall + by dischargeType, with the 5 slowest discharges
// listed for actionability. Mirrors getLabTat's shape/limits.
// ════════════════════════════════════════════════════════════════════
exports.getDischargeTat = async (req, res, next) => {
  try {
    let from, to;
    try {
      ({ from, to } = parseHospitalDateRange(req.query.from, req.query.to, { defaultDays: 30, maxDays: 366 }));
    } catch (e) {
      return sendErr(res, e, "VALIDATION", e.status || 400);
    }
    const rows = await Admission.aggregate([
      { $match: {
          "dischargeWorkflow.gatePassIssuedAt": { $gte: from, $lt: to },
          "dischargeWorkflow.doctorApprovedAt": { $type: "date" },
      } },
      { $addFields: {
          _billClearedAt: { $ifNull: ["$dischargeWorkflow.billClearedAt", "$dischargeWorkflow.gatePassIssuedAt"] },
      } },
      { $addFields: {
          billingMins: { $divide: [{ $subtract: ["$_billClearedAt", "$dischargeWorkflow.doctorApprovedAt"] }, 60000] },
          exitMins:    { $divide: [{ $subtract: ["$dischargeWorkflow.gatePassIssuedAt", "$_billClearedAt"] }, 60000] },
          totalMins:   { $divide: [{ $subtract: ["$dischargeWorkflow.gatePassIssuedAt", "$dischargeWorkflow.doctorApprovedAt"] }, 60000] },
      } },
      { $match: { totalMins: { $gte: 0 } } },   // clock-skew guard
      { $facet: {
          overall: [
            { $group: {
                _id: null, count: { $sum: 1 },
                avgBillingMins: { $avg: "$billingMins" }, avgExitMins: { $avg: "$exitMins" },
                avgTotalMins: { $avg: "$totalMins" }, maxTotalMins: { $max: "$totalMins" }, minTotalMins: { $min: "$totalMins" },
            } },
          ],
          byType: [
            { $group: {
                _id: { $ifNull: ["$dischargeWorkflow.dischargeType", "Routine"] },
                count: { $sum: 1 }, avgTotalMins: { $avg: "$totalMins" },
            } },
            { $sort: { count: -1 } },
          ],
          slowest: [
            { $sort: { totalMins: -1 } },
            { $limit: 5 },
            { $project: {
                _id: 0, admissionNumber: 1, UHID: 1,
                dischargeType: "$dischargeWorkflow.dischargeType",
                totalMins: { $round: ["$totalMins", 0] },
                billingMins: { $round: ["$billingMins", 0] },
                gatePassIssuedAt: "$dischargeWorkflow.gatePassIssuedAt",
            } },
          ],
      } },
    ]).option({ allowDiskUse: true, maxTimeMS: 20_000 });

    const o = rows?.[0]?.overall?.[0] || null;
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = to.toISOString().slice(0, 10);
    return sendOk(res, {
      from: fromStr, to: toStr,
      overall: o ? {
        count: o.count,
        avgBillingMins: Math.round(o.avgBillingMins || 0),
        avgExitMins:    Math.round(o.avgExitMins || 0),
        avgTotalMins:   Math.round(o.avgTotalMins || 0),
        maxTotalMins:   Math.round(o.maxTotalMins || 0),
        minTotalMins:   Math.round(o.minTotalMins || 0),
      } : { count: 0 },
      byType: (rows?.[0]?.byType || []).map((r) => ({
        dischargeType: r._id, count: r.count, avgTotalMins: Math.round(r.avgTotalMins || 0),
      })),
      slowest: rows?.[0]?.slowest || [],
    }, { from: fromStr, to: toStr, count: o?.count || 0 });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// R7hr(ER-P2): ER TAT — door-to-triage / door-to-doctor / door-to-
// disposition minutes from the NABH Emergency register (rows carry the
// pre-computed fields). Mirrors getLabTat/getDischargeTat.
// ════════════════════════════════════════════════════════════════════
exports.getErTat = async (req, res, next) => {
  try {
    let from, to;
    try {
      ({ from, to } = parseHospitalDateRange(req.query.from, req.query.to, { defaultDays: 30, maxDays: 366 }));
    } catch (e) {
      return sendErr(res, e, "VALIDATION", e.status || 400);
    }
    const EmergencyRegister = require("../../models/Compliance/EmergencyRegisterModel");
    const rows = await EmergencyRegister.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      { $group: {
          _id: null, count: { $sum: 1 },
          avgTriageMins:      { $avg: "$doorToTriageMinutes" },
          avgDoctorMins:      { $avg: "$doorToDoctorMinutes" },
          avgDispositionMins: { $avg: "$doorToDispositionMinutes" },
          maxDispositionMins: { $max: "$doorToDispositionMinutes" },
      } },
    ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });
    const o = rows[0] || null;
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = to.toISOString().slice(0, 10);
    return sendOk(res, {
      from: fromStr, to: toStr,
      overall: o ? {
        count: o.count,
        avgTriageMins:      Math.round(o.avgTriageMins || 0),
        avgDoctorMins:      Math.round(o.avgDoctorMins || 0),
        avgDispositionMins: Math.round(o.avgDispositionMins || 0),
        maxDispositionMins: Math.round(o.maxDispositionMins || 0),
      } : { count: 0 },
    }, { from: fromStr, to: toStr, count: o?.count || 0 });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// #134 — HAI rate per 1000 device-days (NABH HIC.5). Numerator = HAI events
// by type in the window; denominator = device-days from the PatientDevice
// registry (the true denominator, not summed infected-patient device-days).
// SSI is expressed per-100-surgeries (OT count denominator) since it has no
// device-day base. GET /api/reports/hai-rate?from=&to=
// ════════════════════════════════════════════════════════════════════
exports.getHaiRate = async (req, res, next) => {
  try {
    let from, to;
    try {
      ({ from, to } = parseHospitalDateRange(req.query.from, req.query.to, { defaultDays: 30, maxDays: 366 }));
    } catch (e) {
      return sendErr(res, e, "VALIDATION", e.status || 400);
    }
    const HAISurveillance = require("../../models/Compliance/HAISurveillanceRegisterModel");
    const PatientDevice   = require("../../models/Clinical/PatientDeviceModel");
    const OTRegister      = require("../../models/Compliance/OTRegisterModel");

    // Numerators — HAI events by type.
    const byType = await HAISurveillance.aggregate([
      { $match: { onsetDate: { $gte: from, $lt: to } } },
      { $group: { _id: "$HAIType", count: { $sum: 1 } } },
    ]).option({ allowDiskUse: true, maxTimeMS: 15_000 });
    const numer = { CAUTI: 0, CLABSI: 0, VAP: 0, SSI: 0, CDI: 0, "MRSA-Bacteremia": 0 };
    for (const r of byType) if (r._id in numer) numer[r._id] = r.count;

    // Denominator — device-days by bundle category, from the device registry.
    // bundle: vap ← ET_TUBE/TRACHEOSTOMY, clabsi ← CENTRAL_LINE/PICC_LINE,
    // cauti ← URINARY_CATHETER. Sum the in-window dwell of each device.
    const DEV_BUNDLE = {
      ET_TUBE: "vap", TRACHEOSTOMY: "vap",
      CENTRAL_LINE: "clabsi", PICC_LINE: "clabsi",
      URINARY_CATHETER: "cauti",
    };
    // D15 — stream the device registry via a cursor instead of a capped
    // .limit(50000).lean() find(): the old cap silently truncated active
    // devices on busy/long windows, understating device-days and OVERSTATING
    // the NABH-reported infection rate per 1000 device-days. A cursor sums
    // every in-window device with bounded memory (no cap, no truncation).
    const deviceDays = { vap: 0, clabsi: 0, cauti: 0 };
    const DAY = 24 * 3600 * 1000;
    const deviceCursor = PatientDevice.find({
      deviceType: { $in: Object.keys(DEV_BUNDLE) },
      placedAt: { $lt: to },
      $or: [{ removedAt: null }, { removedAt: { $gte: from } }],
    }).select("deviceType placedAt removedAt").lean().cursor();
    for await (const d of deviceCursor) {
      const start = new Date(Math.max(new Date(d.placedAt).getTime(), from.getTime()));
      const end = new Date(Math.min(d.removedAt ? new Date(d.removedAt).getTime() : to.getTime(), to.getTime()));
      const days = Math.max(0, (end - start) / DAY);
      const bundle = DEV_BUNDLE[d.deviceType];
      if (bundle) deviceDays[bundle] += days;
    }

    const surgeries = await OTRegister.countDocuments({ occurredAt: { $gte: from, $lt: to }, status: { $ne: "Cancelled" } });
    const rate1000 = (num, den) => (den > 0 ? Math.round((num / den) * 1000 * 100) / 100 : null);

    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = to.toISOString().slice(0, 10);
    return sendOk(res, {
      from: fromStr, to: toStr,
      deviceDays: {
        ventilator: Math.round(deviceDays.vap),
        centralLine: Math.round(deviceDays.clabsi),
        urinaryCatheter: Math.round(deviceDays.cauti),
      },
      surgeries,
      indicators: {
        CAUTI:  { events: numer.CAUTI,  deviceDays: Math.round(deviceDays.cauti),  ratePer1000DeviceDays: rate1000(numer.CAUTI, deviceDays.cauti) },
        CLABSI: { events: numer.CLABSI, deviceDays: Math.round(deviceDays.clabsi), ratePer1000DeviceDays: rate1000(numer.CLABSI, deviceDays.clabsi) },
        VAP:    { events: numer.VAP,    deviceDays: Math.round(deviceDays.vap),    ratePer1000DeviceDays: rate1000(numer.VAP, deviceDays.vap) },
        SSI:    { events: numer.SSI,    surgeries, ratePer100Surgeries: surgeries > 0 ? Math.round((numer.SSI / surgeries) * 100 * 100) / 100 : null },
      },
      other: { CDI: numer.CDI, "MRSA-Bacteremia": numer["MRSA-Bacteremia"] },
    }, { from: fromStr, to: toStr });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// #148 — QPS quality-indicator engine (NABH PSQ). Rate-based clinical
// indicators with numerator/denominator + a period-over-period trend:
//   • mortality rate       — deaths / discharges × 100
//   • readmission rate      — 30-day readmissions / discharges × 100
//   • HAI rate              — HAI events / device-days × 1000
//   • medication-error rate — med errors / admissions × 100
//   • high fall-risk rate   — high-fall-risk assessments / admissions × 100
// Trend compares the window to the immediately preceding equal window.
// GET /api/reports/qps-indicators?from=&to=
// ════════════════════════════════════════════════════════════════════
exports.getQpsIndicators = async (req, res, next) => {
  try {
    let from, to;
    try {
      ({ from, to } = parseHospitalDateRange(req.query.from, req.query.to, { defaultDays: 90, maxDays: 366 }));
    } catch (e) {
      return sendErr(res, e, "VALIDATION", e.status || 400);
    }
    const winMs = to - from;
    const prevFrom = new Date(from.getTime() - winMs);

    const Admission     = require("../../models/Patient/admissionModel");
    const Mortality     = require("../../models/Compliance/MortalityRegisterModel");
    const Readmission   = require("../../models/Compliance/ReadmissionRegisterModel");
    const HAI           = require("../../models/Compliance/HAISurveillanceRegisterModel");
    const MedError      = require("../../models/Compliance/MedicationErrorRegisterModel");
    const FallRisk      = require("../../models/Compliance/FallRiskRegisterModel");
    const PatientDevice = require("../../models/Clinical/PatientDeviceModel");

    const DEV_BUNDLE = { ET_TUBE: 1, TRACHEOSTOMY: 1, CENTRAL_LINE: 1, PICC_LINE: 1, URINARY_CATHETER: 1 };
    const DAY = 24 * 3600 * 1000;
    async function deviceDaysIn(f, t) {
      // D15 — cursor stream (no .limit cap) so long/busy windows aren't silently
      // truncated, which would understate device-days and overstate the HAI rate.
      let total = 0;
      const cursor = PatientDevice.find({
        deviceType: { $in: Object.keys(DEV_BUNDLE) },
        placedAt: { $lt: t },
        $or: [{ removedAt: null }, { removedAt: { $gte: f } }],
      }).select("placedAt removedAt").lean().cursor();
      for await (const d of cursor) {
        const start = Math.max(new Date(d.placedAt).getTime(), f.getTime());
        const end = Math.min(d.removedAt ? new Date(d.removedAt).getTime() : t.getTime(), t.getTime());
        total += Math.max(0, (end - start) / DAY);
      }
      return total;
    }

    const round2 = (v) => Math.round(v * 100) / 100;
    const per100  = (n, d) => (d > 0 ? round2((n / d) * 100) : null);
    const per1000 = (n, d) => (d > 0 ? round2((n / d) * 1000) : null);

    async function period(f, t) {
      const [admissions, discharges, deaths, readmits, hai, medErr, medErrHarm, highFall, dev] = await Promise.all([
        Admission.countDocuments({ admissionDate: { $gte: f, $lt: t }, status: { $ne: "Deleted" }, admissionType: { $nin: ["OPD", "Services"] } }),
        Admission.countDocuments({ actualDischargeDate: { $gte: f, $lt: t }, status: "Discharged" }),
        Mortality.countDocuments({ dateOfDeath: { $gte: f, $lt: t } }),
        Readmission.countDocuments({ occurredAt: { $gte: f, $lt: t } }),
        HAI.countDocuments({ onsetDate: { $gte: f, $lt: t } }),
        MedError.countDocuments({ reportedAt: { $gte: f, $lt: t } }),
        MedError.countDocuments({ reportedAt: { $gte: f, $lt: t }, patientHarm: { $in: ["Minor", "Major", "Death"] } }),
        FallRisk.countDocuments({ assessedAt: { $gte: f, $lt: t }, highRiskFlag: true }),
        deviceDaysIn(f, t),
      ]);
      return {
        denominators: { admissions, discharges, deviceDays: Math.round(dev) },
        counts: { deaths, readmissions: readmits, haiEvents: hai, medErrors: medErr, medErrorsWithHarm: medErrHarm, highFallRisk: highFall },
        rates: {
          mortalityPer100Discharges:   per100(deaths, discharges),
          readmissionPer100Discharges: per100(readmits, discharges),
          haiPer1000DeviceDays:        per1000(hai, dev),
          medErrorPer100Admissions:    per100(medErr, admissions),
          highFallRiskPer100Admissions:per100(highFall, admissions),
        },
      };
    }

    const [current, previous] = await Promise.all([period(from, to), period(prevFrom, from)]);
    // For rates, a rise in an adverse indicator is "worse" — expose the raw
    // direction; the caller colours it.
    const dir = (c, p) => (c == null || p == null ? "flat" : c > p ? "up" : c < p ? "down" : "flat");
    const trend = {};
    for (const k of Object.keys(current.rates)) trend[k] = dir(current.rates[k], previous.rates[k]);

    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = to.toISOString().slice(0, 10);
    return sendOk(res, {
      from: fromStr, to: toStr,
      current, previous, trend,
    }, { from: fromStr, to: toStr });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// R7hr(TPA-P1): TPA MIS — claim-desk performance from PatientBill TPA
// fields: status counts, submit→approve TAT, approval %, approved-vs-
// settled realization, per-TPA breakdown, and stale SUBMITTED claims
// (ageing) so the desk chases insurers before claims rot.
// ════════════════════════════════════════════════════════════════════
exports.getTpaMis = async (req, res, next) => {
  try {
    let from, to;
    try {
      ({ from, to } = parseHospitalDateRange(req.query.from, req.query.to, { defaultDays: 90, maxDays: 366 }));
    } catch (e) {
      return sendErr(res, e, "VALIDATION", e.status || 400);
    }
    const staleDays = Math.max(1, Number(req.query.staleDays) || 7);
    const PatientBill = require("../../models/PatientBillModel/PatientBillModel");

    const [agg] = await PatientBill.aggregate([
      { $match: {
          paymentType: { $in: ["TPA", "CORPORATE"] },
          tpaClaimStatus: { $ne: "NOT_APPLICABLE" },
          createdAt: { $gte: from, $lt: to },
      } },
      { $addFields: {
          _approveTatDays: { $cond: [
            { $and: ["$tpaPreAuthSubmittedAt", "$tpaApprovedAt"] },
            { $divide: [{ $subtract: ["$tpaApprovedAt", "$tpaPreAuthSubmittedAt"] }, 86400000] },
            null,
          ] },
          _approved: { $toDouble: { $ifNull: ["$tpaApprovedAmount", 0] } },
          _tpaPaid: { $reduce: {
            input: { $ifNull: ["$payments", []] },
            initialValue: 0,
            in: { $add: ["$$value", { $cond: [
              { $and: [{ $eq: ["$$this.paymentMode", "TPA_CLAIM"] }, { $gt: [{ $toDouble: "$$this.amount" }, 0] }] },
              { $toDouble: "$$this.amount" }, 0,
            ] }] },
          } },
      } },
      { $facet: {
          byStatus: [
            { $group: { _id: "$tpaClaimStatus", n: { $sum: 1 } } },
          ],
          overall: [
            { $group: {
                _id: null, claims: { $sum: 1 },
                avgApproveTatDays: { $avg: "$_approveTatDays" },
                approvedAmt: { $sum: "$_approved" },
                settledAmt:  { $sum: "$_tpaPaid" },
            } },
          ],
          byTpa: [
            { $group: {
                _id: { $ifNull: ["$tpaName", "(unnamed TPA)"] },
                claims: { $sum: 1 },
                approvedAmt: { $sum: "$_approved" },
                settledAmt:  { $sum: "$_tpaPaid" },
                avgApproveTatDays: { $avg: "$_approveTatDays" },
            } },
            { $sort: { claims: -1 } }, { $limit: 25 },
          ],
          stale: [
            { $match: {
                tpaClaimStatus: "SUBMITTED",
                tpaPreAuthSubmittedAt: { $lt: new Date(Date.now() - staleDays * 86400000) },
            } },
            { $project: {
                _id: 0, billNumber: 1, UHID: 1, patientName: 1, tpaName: 1,
                tpaClaimNumber: 1, tpaPreAuthSubmittedAt: 1,
                ageingDays: { $round: [{ $divide: [{ $subtract: [new Date(), "$tpaPreAuthSubmittedAt"] }, 86400000] }, 0] },
            } },
            { $sort: { ageingDays: -1 } }, { $limit: 50 },
          ],
          // R7hr(TPA-P2) — unanswered insurer queries (the other rot vector:
          // claim technically SUBMITTED/APPROVED but a query sits unreplied).
          openQueries: [
            { $unwind: "$tpaQueryLog" },
            { $match: { "tpaQueryLog.status": "OPEN" } },
            { $project: {
                _id: 0, billId: "$_id", billNumber: 1, UHID: 1, patientName: 1, tpaName: 1,
                queryText: "$tpaQueryLog.queryText", raisedAt: "$tpaQueryLog.raisedAt",
                ageingDays: { $round: [{ $divide: [{ $subtract: [new Date(), "$tpaQueryLog.raisedAt"] }, 86400000] }, 0] },
            } },
            { $sort: { ageingDays: -1 } }, { $limit: 50 },
          ],
      } },
    ]).option({ allowDiskUse: true, maxTimeMS: 20_000 });

    const statusMap = Object.fromEntries((agg?.byStatus || []).map((s) => [s._id, s.n]));
    const o = agg?.overall?.[0] || null;
    const approvedN = statusMap.APPROVED || 0;
    const rejectedN = statusMap.REJECTED || 0;
    const round2 = (v) => Math.round((v || 0) * 100) / 100;
    return sendOk(res, {
      from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), staleDays,
      overall: {
        claims: o?.claims || 0,
        byStatus: statusMap,
        approvalPct: approvedN + rejectedN ? Math.round((approvedN / (approvedN + rejectedN)) * 100) : null,
        avgApproveTatDays: round2(o?.avgApproveTatDays),
        approvedAmt: round2(o?.approvedAmt),
        settledAmt:  round2(o?.settledAmt),
        realizationPct: o?.approvedAmt ? Math.round(((o.settledAmt || 0) / o.approvedAmt) * 100) : null,
      },
      byTpa: (agg?.byTpa || []).map((t) => ({
        tpa: t._id, claims: t.claims,
        approvedAmt: round2(t.approvedAmt), settledAmt: round2(t.settledAmt),
        realizationPct: t.approvedAmt ? Math.round((t.settledAmt / t.approvedAmt) * 100) : null,
        avgApproveTatDays: round2(t.avgApproveTatDays),
      })),
      staleClaims: agg?.stale || [],
      openQueries: agg?.openQueries || [],   // R7hr(TPA-P2)
    });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// A6-HIGH-6: inventory ABC analysis (12-month consumption value)
// ════════════════════════════════════════════════════════════════════
exports.getAbcAnalysis = async (req, res, next) => {
  try {
    const months = Math.min(36, Math.max(1, Number(req.query.months) || 12));
    const cacheKey = `abc:${months}`;
    const data = await _abcCache.get(cacheKey, async () => {
      const start = istStartOfDayPlus(-months * 30);
      // Sum consumption value per drug across PharmacySale.items.
      const rows = await PharmacySale.aggregate([
        { $match: { createdAt: { $gte: start }, status: { $nin: ["Cancelled"] } } },
        { $unwind: "$items" },
        { $group: {
            _id: "$items.drugId",
            drugName:        { $first: "$items.drugName" },
            quantity:        { $sum: { $toDouble: "$items.quantity" } },
            consumptionValue:{ $sum: { $toDouble: { $ifNull: ["$items.netAmount", 0] } } },
            saleCount:       { $sum: 1 },
        } },
        { $sort: { consumptionValue: -1 } },
      ]).option({ allowDiskUse: true, maxTimeMS: 30_000 });

      // Classify A/B/C by Pareto cumulative percentage:
      //   A: top items contributing 0-80% of value
      //   B: next contributing to 95%
      //   C: remaining
      const grandTotal = rows.reduce((s, r) => s + toNum(r.consumptionValue), 0) || 1;
      let cum = 0;
      const classified = rows.map((r) => {
        const value = toNum(r.consumptionValue);
        cum += value;
        const pct = (cum / grandTotal) * 100;
        const bucket = pct <= 80 ? "A" : pct <= 95 ? "B" : "C";
        return {
          drugId:           r._id,
          drugName:         r.drugName,
          quantity:         toNum(r.quantity),
          consumptionValue: value,
          saleCount:        r.saleCount,
          cumulativePct:    +pct.toFixed(2),
          bucket,
        };
      });
      const counts = classified.reduce((acc, r) => {
        acc[r.bucket] = (acc[r.bucket] || 0) + 1;
        return acc;
      }, { A: 0, B: 0, C: 0 });
      return { months, grandTotal: +grandTotal.toFixed(2), buckets: counts, items: classified };
    });
    return sendOk(res, data);
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// A6-HIGH-7: AR aging
// ════════════════════════════════════════════════════════════════════
exports.getArAging = async (req, res, next) => {
  try {
    let asOf;
    try {
      asOf = req.query.asOf ? parseHospitalDate(req.query.asOf, { endOfDay: true }) : istEndOfToday();
    } catch (e) {
      return sendErr(res, e, "VALIDATION", e.status || 400);
    }
    const cacheKey = `aging:${asOf.toISOString().slice(0, 10)}`;
    const data = await _agingCache.get(cacheKey, async () => {
      // Outstanding = netAmount - paid (computed fresh from payments[]).
      const rows = await PatientBill.aggregate([
        { $match: {
            billStatus:    { $nin: ["DRAFT", "CANCELLED"] },
            billGeneratedAt: { $lte: asOf },
        } },
        { $addFields: {
            _gross: { $toDouble: { $ifNull: ["$netAmount", { $ifNull: ["$netPayable", 0] }] } },
            _paid: {
              $sum: {
                $map: {
                  input: {
                    $filter: {
                      input: { $ifNull: ["$payments", []] },
                      as: "p",
                      cond: { $and: [
                        { $not: ["$$p.voidedAt"] },
                        { $lte: ["$$p.paidAt", asOf] },
                      ] },
                    },
                  },
                  as: "p",
                  in: { $toDouble: { $ifNull: ["$$p.amount", 0] } },
                },
              },
            },
        } },
        { $addFields: {
            _outstanding: { $subtract: ["$_gross", "$_paid"] },
            _ageDays: {
              $floor: { $divide: [{ $subtract: [asOf, "$billGeneratedAt"] }, 86400000] },
            },
        } },
        { $match: { _outstanding: { $gt: 0.99 } } },
        { $group: {
            _id: {
              isTPA:  { $regexMatch: { input: { $toLower: { $ifNull: ["$paymentType", ""] } }, regex: /tpa|insurance|corporate/ } },
              bucket: {
                $switch: {
                  branches: [
                    { case: { $lte: ["$_ageDays", 30] }, then: "0-30" },
                    { case: { $lte: ["$_ageDays", 60] }, then: "31-60" },
                    { case: { $lte: ["$_ageDays", 90] }, then: "61-90" },
                  ],
                  default: "90+",
                },
              },
            },
            outstanding: { $sum: "$_outstanding" },
            count:       { $sum: 1 },
        } },
      ]).option({ allowDiskUse: true, maxTimeMS: 30_000 });
      // Shape into the standard 4-bucket × 2-payer matrix.
      const empty = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
      const out = {
        asOf: asOf.toISOString().slice(0, 10),
        patient: { ...empty }, tpa: { ...empty },
        patientCount: { ...empty }, tpaCount: { ...empty },
        totals: { patient: 0, tpa: 0 },
      };
      for (const r of rows) {
        const target = r._id.isTPA ? "tpa" : "patient";
        const cntKey = r._id.isTPA ? "tpaCount" : "patientCount";
        out[target][r._id.bucket] = toNum(r.outstanding);
        out[cntKey][r._id.bucket] = r.count;
        out.totals[target] += toNum(r.outstanding);
      }
      return out;
    });
    return sendOk(res, data, { asOf: asOf.toISOString().slice(0, 10) });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// A6-HIGH-8: paginated daily collection drill-down by mode
// ════════════════════════════════════════════════════════════════════
exports.getDailyCollection = async (req, res, next) => {
  try {
    let dayStart, dayEnd;
    if (req.query.date) {
      try { dayStart = parseHospitalDate(req.query.date); }
      catch (e) { return sendErr(res, e, "VALIDATION", 400); }
    } else {
      dayStart = istStartOfToday();
    }
    dayEnd = new Date(dayStart.getTime() + 86400000);
    const mode = req.query.mode ? String(req.query.mode).toUpperCase() : null;
    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const skip  = (page - 1) * limit;

    const baseStages = [
      { $match: { "payments.paidAt": { $gte: dayStart, $lt: dayEnd } } },
      { $unwind: "$payments" },
      { $match: {
          "payments.paidAt":   { $gte: dayStart, $lt: dayEnd },
          "payments.voidedAt": { $exists: false },
          "payments.amount":   { $gt: 0 },
      } },
      ...(mode
        ? [{ $match: { "payments.paymentMode": mode } }]
        : []),
      { $project: {
          _id:           0,
          billId:        "$_id",
          billNumber:    1,
          UHID:          1,
          patientName:   1,
          paymentId:     "$payments._id",
          paidAt:        "$payments.paidAt",
          paymentMode:   "$payments.paymentMode",
          amount:        { $toDouble: "$payments.amount" },
          receivedBy:    "$payments.receivedBy",
          transactionId: "$payments.transactionId",
      } },
      { $sort: { paidAt: -1 } },
    ];

    // R7bf-H A6-HIGH-8: $facet for paginated rows + total count + per-mode summary
    // so the drill-down works at 5k+ rows without paging the entire collection.
    const facetP = PatientBill.aggregate([
      ...baseStages,
      { $facet: {
          rows:  [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: "n" }],
          byMode: [
            { $group: { _id: "$paymentMode", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
            { $sort: { amount: -1 } },
          ],
      } },
    ]).option({ allowDiskUse: true, maxTimeMS: 25_000, hint: { "payments.paidAt": 1 } })
       .catch((e) => {
         // Hint may not match an existing index — retry without it.
         if (/hint/i.test(e.message || "")) {
           return PatientBill.aggregate([
             ...baseStages,
             { $facet: {
                 rows: [{ $skip: skip }, { $limit: limit }],
                 total: [{ $count: "n" }],
                 byMode: [
                   { $group: { _id: "$paymentMode", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
                   { $sort: { amount: -1 } },
                 ],
             } },
           ]).option({ allowDiskUse: true, maxTimeMS: 25_000 });
         }
         throw e;
       });
    const facet = (await facetP)[0] || {};
    const total = facet.total?.[0]?.n || 0;
    const rows  = (facet.rows  || []).map((r) => ({ ...r, amount: toNum(r.amount) }));
    const byMode = (facet.byMode || []).map((r) => ({ mode: r._id, amount: toNum(r.amount), count: r.count }));
    const dateStr = dayStart.toISOString().slice(0, 10);
    const pagination = { page, limit, total, pages: Math.ceil(total / limit) };
    return sendOk(res,
      { date: dateStr, rows, byMode, pagination },
      { date: dateStr, total, page, limit });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════════
// A6-HIGH-10: diagnosis frequency (normalized ICD codes)
// ════════════════════════════════════════════════════════════════════
exports.getDiagnosisFrequency = async (req, res, next) => {
  try {
    let from, to;
    try {
      ({ from, to } = parseHospitalDateRange(req.query.from, req.query.to, { defaultDays: 90, maxDays: 366 }));
    } catch (e) {
      return sendErr(res, e, "VALIDATION", e.status || 400);
    }
    // R7bf-H A6-HIGH-10: pre-R7bf the report grouped by raw codeRaw string
    // so "I10", "i10 ", " I10\n" all bucketed separately. Now normalize
    // on the cleaned `code` (uppercase, trimmed) so the frequency table
    // matches the ICD-10 master.
    const rows = await Admission.aggregate([
      { $match: { admissionDate: { $gte: from, $lt: to } } },
      { $unwind: { path: "$diagnoses", preserveNullAndEmptyArrays: false } },
      { $addFields: {
          _code: {
            $toUpper: {
              $trim: {
                input: { $ifNull: ["$diagnoses.code", { $ifNull: ["$diagnoses.icd10Code", "$diagnoses.codeRaw"] }] },
              },
            },
          },
      } },
      { $match: { _code: { $ne: "" } } },
      { $group: {
          _id: "$_code",
          count:        { $sum: 1 },
          description:  { $first: { $ifNull: ["$diagnoses.description", "$diagnoses.text"] } },
      } },
      { $sort: { count: -1 } },
      { $limit: 100 },
    ]).option({ allowDiskUse: true, maxTimeMS: 20_000 });
    const fromStr = from.toISOString().slice(0, 10);
    const toStr   = to.toISOString().slice(0, 10);
    const items = rows.map((r) => ({ code: r._id, description: r.description || "", count: r.count }));
    return sendOk(res,
      { from: fromStr, to: toStr, rows: items },
      { from: fromStr, to: toStr, count: items.length });
  } catch (e) { next(e); }
};

// ═══════════════════════════════════════════════════════════════════
// R7hr(ER-P3/DC-P3) — statutory attendance registers.
// ER register: chronological log of every ER attendance (NABH requires a
// bound ER register — this is its printable source). DC register: the
// DayCareRegister rows the daycare workflow emits (emit existed since
// DC-P2 but had NO read surface — this closes that gap).
// ═══════════════════════════════════════════════════════════════════
exports.getErRegister = async (req, res) => {
  try {
    let from, to;
    try {
      ({ from, to } = parseHospitalDateRange(req.query.from, req.query.to, { defaultDays: 31, maxDays: 366 }));
    } catch (e) { return sendErr(res, e, "VALIDATION", e.status || 400); }
    // Source is the Compliance EmergencyRegister (same emitter-fed model
    // getErTat aggregates) — not the live Emergency visit doc — because
    // register rows are locked at disposition and carry the statutory
    // fields (mode/broughtBy/complaint/TAT minutes) the print needs.
    const EmergencyRegister = require("../../models/Compliance/EmergencyRegisterModel");
    const rows = await EmergencyRegister.find({ arrivalAt: { $gte: from, $lte: to } })
      .select("erNumber emergencyNumber arrivalAt modeOfArrival broughtBy patientName UHID age sex triageCategory presentingComplaint consultantIncharge isMLC mlcNumber disposition dispositionAt doorToDispositionMinutes")
      .sort({ arrivalAt: 1 })
      .limit(2000)
      .lean();
    res.json({ success: true, from, to, count: rows.length, data: rows });
  } catch (e) { return sendErr(res, e); }
};

exports.getDcRegister = async (req, res) => {
  try {
    let from, to;
    try {
      ({ from, to } = parseHospitalDateRange(req.query.from, req.query.to, { defaultDays: 31, maxDays: 366 }));
    } catch (e) { return sendErr(res, e, "VALIDATION", e.status || 400); }
    const DayCareRegister = require("../../models/Compliance/DayCareRegisterModel");
    const rows = await DayCareRegister.find({ createdAt: { $gte: from, $lte: to } })
      .select("dcNumber UHID patientName age sex admissionNumber procedure doctor admittedAt dischargedAt checklistComplete readinessScore outcome remarks")
      .sort({ createdAt: 1 })
      .limit(2000)
      .lean();
    res.json({ success: true, from, to, count: rows.length, data: rows });
  } catch (e) { return sendErr(res, e); }
};
