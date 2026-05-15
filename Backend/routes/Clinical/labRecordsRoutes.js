const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Clinical/labRecordsController");
const { requireAction } = require("../../middleware/auth");

/* Reference data — every clinical role can read presets so the
   doctor can suggest a panel from the order page too. */
router.get("/panels",       requireAction("lab.records.read"), ctrl.panels);
router.get("/report-types", requireAction("lab.records.read"), ctrl.reportTypes);

/* Trend sheets */
router.get  ("/trends",         requireAction("lab.records.read"),  ctrl.trendList);
router.get  ("/trends/:id",     requireAction("lab.records.read"),  ctrl.trendGet);
router.post ("/trends",         requireAction("lab.records.write"), ctrl.trendCreate);
router.put  ("/trends/:id",     requireAction("lab.records.write"), ctrl.trendUpdate);
router.patch("/trends/:id/verify", requireAction("lab.records.verify"), ctrl.trendVerify);

/* Reports (imaging / micro / histopath / etc.) */
router.get  ("/reports",        requireAction("lab.records.read"),  ctrl.reportList);
router.get  ("/reports/:id",    requireAction("lab.records.read"),  ctrl.reportGet);
router.post ("/reports",        requireAction("lab.records.write"), ctrl.reportCreate);
router.put  ("/reports/:id",    requireAction("lab.records.write"), ctrl.reportUpdate);
router.patch("/reports/:id/verify", requireAction("lab.records.verify"), ctrl.reportVerify);

module.exports = router;
