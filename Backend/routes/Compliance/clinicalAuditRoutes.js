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

// NABH HIC.5 — ICU Care Bundles compliance summary (period-bucketed
// VAP / CAUTI / CLABSI / DVT / Sepsis / SUP %). Drives the IC officer
// register page (HIC5InfectionControlPage).
router.get("/icu-bundles/summary", requireAction("compliance.read"), ctrl.summary);

// Drill-down: chronological ClinicalAudit events for ICU bundles in
// a given window — used by the per-bundle "click a row to expand"
// interaction on the register page.
router.get("/icu-bundles/events", requireAction("compliance.read"), ctrl.events);

module.exports = router;
