// services/Lab/labReportService.js
// ═══════════════════════════════════════════════════════════════════
// R7bf-J/A8-CRIT-6 — Cumulative lab view.
//
// Pre-R7bf the cumulative view (rebuild a single grid for a panel of N
// tests across M dates for one patient) fetched each test result row
// individually — N+1 query, 12 s on a 6-month 30-test panel.
//
// This service exposes `buildCumulativeView({ UHID, panelType, from, to,
// limit })` which runs ONE Mongo aggregation grouping on the LabTrend
// collection: $match by patient + window → $unwind tests → $unwind
// readings → $match readings by date window → $group by test name with
// the readings sorted by date.
//
// Result shape:
//   {
//     UHID, panelType,
//     dates: [Date, …],                                  // unique sorted column dates
//     tests: [{ name, unit, refMin, refMax, readings: [{date,value,status}…] }],
//     meta:  { sources: N, scannedReadings: M, durationMs }
//   }
//
// Read-only. All callers use .lean() / aggregate so no docs are loaded.
// ═══════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
const { LabTrend, LabReport } = require("../../models/Clinical/labRecordsModels");

// Build the cumulative view for a patient + panel within an optional
// date window. `panelType` is one of LabTrendSchema.panelType (CBC,
// BIOCHEM, …) or falsy to include all panels.
async function buildCumulativeView({
  UHID,
  panelType,
  from,
  to,
  limit = 200,
} = {}) {
  if (!UHID) throw new Error("UHID required");
  const t0 = Date.now();
  const matchTop = { UHID: String(UHID).toUpperCase() };
  if (panelType) matchTop.panelType = panelType;

  const win = {};
  if (from) win.$gte = new Date(from);
  if (to)   win.$lte = new Date(to);
  const haveWin = Object.keys(win).length > 0;

  // Single aggregation. Stages:
  //   1. $match — by patient + panelType (uses {UHID:1,panelType:1,createdAt:-1} index)
  //   2. $unwind tests[]
  //   3. $unwind readings[]
  //   4. $match — readings.date in [from, to]
  //   5. $group — by test name → push {date,value,status} into readings[]
  //   6. $project — final shape
  const pipeline = [
    { $match: matchTop },
    // Reasonable upper bound so a runaway query can't burst the cluster.
    { $sort:  { createdAt: -1 } },
    { $limit: Math.min(limit, 500) },
    { $unwind: "$tests" },
    { $unwind: "$tests.readings" },
    ...(haveWin ? [{ $match: { "tests.readings.date": win } }] : []),
    { $group: {
        _id: "$tests.name",
        unit:   { $first: "$tests.unit" },
        refMin: { $first: "$tests.refMin" },
        refMax: { $first: "$tests.refMax" },
        readings: { $push: {
          date:   "$tests.readings.date",
          value:  "$tests.readings.value",
          status: "$tests.readings.status",
          notes:  "$tests.readings.notes",
        } },
        count: { $sum: 1 },
    } },
    { $project: {
        _id:    0,
        name:   "$_id",
        unit:   1,
        refMin: 1,
        refMax: 1,
        readings: 1,
        count:  1,
    } },
    { $sort: { name: 1 } },
  ];

  // allowDiskUse for the (rare) case where a patient has thousands of
  // readings — keeps the cluster from rejecting a working-set overflow.
  const rows = await LabTrend.aggregate(pipeline).allowDiskUse(true);

  // Sort each test's readings by date asc + collect the unique column
  // date list. The UI uses `dates` as the X-axis grid.
  const dateSet = new Set();
  for (const t of rows) {
    t.readings.sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const r of t.readings) {
      const k = new Date(r.date).toISOString().slice(0, 10);
      dateSet.add(k);
    }
  }
  const dates = [...dateSet].sort();

  const scannedReadings = rows.reduce((s, t) => s + (t.count || 0), 0);
  return {
    UHID:      String(UHID).toUpperCase(),
    panelType: panelType || "ALL",
    dates,
    tests:     rows,
    meta:      {
      durationMs: Date.now() - t0,
      sources:    rows.length,
      scannedReadings,
    },
  };
}

// Companion: list narrative LabReport rows for the same patient + window.
// Useful to power a "Reports" tab alongside the cumulative grid.
async function listLabReports({ UHID, reportType, from, to, limit = 50 } = {}) {
  if (!UHID) throw new Error("UHID required");
  const filter = { UHID: String(UHID).toUpperCase() };
  if (reportType) filter.reportType = reportType;
  if (from || to) {
    filter.reportDate = {};
    if (from) filter.reportDate.$gte = new Date(from);
    if (to)   filter.reportDate.$lte = new Date(to);
  }
  return LabReport.find(filter)
    .sort({ reportDate: -1 })
    .select("reportType testName bodyPart reportDate impression status reportedByName")
    .limit(Math.min(parseInt(limit, 10) || 50, 200))
    .lean();
}

module.exports = { buildCumulativeView, listLabReports };
