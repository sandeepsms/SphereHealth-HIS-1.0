/**
 * clinicalAuditRoutes.js — R7eg / NABH HIC.5
 *
 * Read-only roll-ups over the ClinicalAudit + ICUBundle collections.
 * Mount under /api/clinical-audit in routes/index.js.
 *
 * All endpoints gated on `compliance.read` (Admin / Doctor / Nurse / MRD)
 * to mirror the existing surveyor-access policy on the NABH register
 * family.
 */
"use strict";

const express = require("express");
const router = express.Router();
const { requireAction } = require("../../middleware/auth");
const ctrl = require("../../controllers/Compliance/icuBundleSummaryController");
const ClinicalAudit = require("../../models/Compliance/ClinicalAuditModel");

// NABH HIC.5 — ICU Care Bundles compliance summary (period-bucketed
// VAP / CAUTI / CLABSI / DVT / Sepsis / SUP %). Drives the IC officer
// register page (HIC5InfectionControlPage).
router.get("/icu-bundles/summary", requireAction("compliance.read"), ctrl.summary);

// Drill-down: chronological ClinicalAudit events for ICU bundles in
// a given window — used by the per-bundle "click a row to expand"
// interaction on the register page.
router.get("/icu-bundles/events", requireAction("compliance.read"), ctrl.events);

// ════════════════════════════════════════════════════════════════════
// NABH AAC.1 / IMS.2 — IA Amendments register feed.
//
// Generic chronological listing of ClinicalAudit rows filtered by event
// kind. Drives the surveyor-facing IA Amendments register page
// (/compliance/ia-amendments) which renders the WHO / WHAT / WHEN / WHY
// trail for every post-sign edit to a doctor or nurse initial assessment.
//
//   GET /api/clinical-audit?kind=DOCTOR_NOTE_AMENDED,NURSE_NOTE_AMENDED
//                          &limit=200&sort=-createdAt
//
// `kind` is a comma-separated list of event-enum values (whitelisted
// against ClinicalAuditModel's enum so a typo can't ever degrade into a
// full-collection scan). `sort` accepts `-createdAt` (default, newest
// first) or `createdAt` (chronological). Hard-capped at 1000 rows so a
// rogue caller can't drain the collection in a single response.
//
// Gated on `compliance.read` to match the rest of the audit surface;
// the route-level RoleGuard on the page further narrows to Admin / MRD
// / Compliance per AAC.1 surveyor-access policy.
// ════════════════════════════════════════════════════════════════════
router.get("/", requireAction("compliance.read"), async (req, res) => {
  try {
    const kindParam = String(req.query.kind || "").trim();
    if (!kindParam) {
      return res.status(400).json({
        success: false,
        message: "Missing required query param: kind",
      });
    }
    // Whitelist against the schema's enum so an arbitrary `?kind=…`
    // can't bypass the safety net and produce a full collection scan.
    const allowedEvents = new Set(
      ClinicalAudit.schema.path("event").enumValues || [],
    );
    const kinds = kindParam
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && allowedEvents.has(s));
    if (kinds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid event kinds in `kind` param",
      });
    }

    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || "200", 10)));
    const sortDir = String(req.query.sort || "-createdAt") === "createdAt" ? 1 : -1;

    const rows = await ClinicalAudit.find({ event: { $in: kinds } })
      .sort({ createdAt: sortDir })
      .limit(limit)
      .lean();

    return res.json({ success: true, data: rows, count: rows.length });
  } catch (e) {
    console.error("[clinical-audit] list failed:", e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
