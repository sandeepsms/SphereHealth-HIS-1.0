const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Clinical/labRecordsController");
const { requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

/* Reference data — every clinical role can read presets so the
   doctor can suggest a panel from the order page too. */
router.get("/panels",       requireAction("lab.records.read"), ctrl.panels);
router.get("/report-types", requireAction("lab.records.read"), ctrl.reportTypes);
// R7bb-FIX-E-8 / E-18: custom panel CRUD + merged view.
router.get   ("/panels/all",        requireAction("lab.records.read"),  ctrl.panelsMerged);
router.post  ("/panels",            requireAction("lab.records.write"), ctrl.panelCreate);
router.put   ("/panels/:code",      requireAction("lab.records.write"), ctrl.panelUpdate);
router.delete("/panels/:code",      requireAction("lab.records.write"), ctrl.panelDelete);
// R7bb-FIX-E-8 / D6-CRIT-5: QC log — list + create. POST is Lab Tech /
// Admin; list reachable to Doctor / Nurse for context.
router.get   ("/qc",                requireAction("lab.records.read"),  ctrl.qcList);
router.post  ("/qc",                requireAction("lab.records.write"), ctrl.qcCreate);

/* Trend sheets */
router.get  ("/trends",         requireAction("lab.records.read"),  ctrl.trendList);
router.get  ("/trends/:id",     validateObjectIdParam("id"), requireAction("lab.records.read"),  ctrl.trendGet);
router.post ("/trends",         requireAction("lab.records.write"), ctrl.trendCreate);
router.put  ("/trends/:id",     validateObjectIdParam("id"), requireAction("lab.records.write"), ctrl.trendUpdate);
router.patch("/trends/:id/verify", validateObjectIdParam("id"), requireAction("lab.records.verify"), ctrl.trendVerify);

/* Reports (imaging / micro / histopath / etc.) */
router.get  ("/reports",        requireAction("lab.records.read"),  ctrl.reportList);
router.get  ("/reports/:id",    validateObjectIdParam("id"), requireAction("lab.records.read"),  ctrl.reportGet);
router.post ("/reports",        requireAction("lab.records.write"), ctrl.reportCreate);
router.put  ("/reports/:id",    validateObjectIdParam("id"), requireAction("lab.records.write"), ctrl.reportUpdate);
router.patch("/reports/:id/verify", validateObjectIdParam("id"), requireAction("lab.records.verify"), ctrl.reportVerify);

module.exports = router;
