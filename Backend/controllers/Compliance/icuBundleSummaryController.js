/**
 * icuBundleSummaryController.js — R7eg / NABH HIC.5
 *
 * Aggregation endpoints powering the Infection Control register
 * (HIC5InfectionControlPage). All gated by `compliance.read` to match
 * the surveyor-access policy on the rest of the NABH register family.
 *
 *   GET /api/clinical-audit/icu-bundles/summary?from=&to=&groupBy=
 *   GET /api/clinical-audit/icu-bundles/events?from=&to=&bundleKey=&eventType=&limit=
 *
 * Both endpoints are read-only — no writes happen through this surface.
 * Underlying data is populated by the ICU Care Bundle save/finalize
 * flow (Backend/controllers/Clinical/icuBundleController.js).
 */
"use strict";

const {
  getIcuBundleSummary,
  listIcuBundleEvents,
} = require("../../services/Compliance/clinicalAuditService");

// Default window for the IC officer's view: last 90 days, grouped by month
// — matches the brief's default surfaced on HIC5InfectionControlPage.
const DEFAULT_DAYS = 90;

function parseRange(query) {
  let from = query.from ? new Date(query.from) : null;
  let to   = query.to   ? new Date(query.to)   : null;

  if (!from || isNaN(from.getTime())) {
    from = new Date();
    from.setDate(from.getDate() - DEFAULT_DAYS);
  }
  if (!to || isNaN(to.getTime())) {
    to = new Date();
  }

  // Anchor "from" to start-of-day and "to" to end-of-day so a single
  // calendar day passed as from===to still produces a non-empty window.
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

exports.summary = async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const groupBy = String(req.query.groupBy || "month").toLowerCase();
    const trendLen = Math.min(24, Math.max(2, parseInt(req.query.trendLen || "6", 10)));

    const data = await getIcuBundleSummary({ from, to, groupBy, trendLen });
    res.json({ success: true, data });
  } catch (e) {
    console.error("[icuBundleSummary] summary failed:", e);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.events = async (req, res) => {
  try {
    const { from, to } = parseRange(req.query);
    const bundleKey = req.query.bundleKey ? String(req.query.bundleKey).toLowerCase() : null;
    const eventType = req.query.eventType ? String(req.query.eventType) : null;
    const limit = parseInt(req.query.limit || "200", 10);

    const rows = await listIcuBundleEvents({ from, to, bundleKey, eventType, limit });
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error("[icuBundleSummary] events failed:", e);
    res.status(500).json({ success: false, message: e.message });
  }
};
