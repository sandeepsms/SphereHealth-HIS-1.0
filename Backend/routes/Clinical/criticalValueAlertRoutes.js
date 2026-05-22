/**
 * criticalValueAlertRoutes.js  (R7bf-G / A5-CRIT-1 / NABH AAC.6)
 *
 * Routes mounted at /api/critical-value-alerts. Gated on two distinct
 * permission tokens:
 *   clinical.emit-critical       — allowed for system writers (Lab Tech
 *                                   transcribing a flagged result, Nurse
 *                                   filing a manual alarm, Doctor noting
 *                                   a panic-value observation, plus Admin)
 *   clinical.acknowledge-critical — strictly the bedside / on-call team
 *                                   (Admin / Doctor / Nurse). Reads share
 *                                   this token so an unauthenticated probe
 *                                   doesn't see the open-alert queue.
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/criticalValueAlertController");
const { requireAction } = require("../../middleware/auth");

// Reads (operator dashboard, drill-down)
router.get("/open",            requireAction("clinical.acknowledge-critical"), ctrl.listOpen);
router.get("/by-uhid/:UHID",   requireAction("clinical.acknowledge-critical"), ctrl.byUHID);
router.get("/:id",             requireAction("clinical.acknowledge-critical"), ctrl.getOne);

// Writes
router.post("/",               requireAction("clinical.emit-critical"),         ctrl.create);
router.post("/:id/acknowledge",requireAction("clinical.acknowledge-critical"),  ctrl.acknowledge);
router.post("/:id/close",      requireAction("clinical.acknowledge-critical"),  ctrl.close);

module.exports = router;
