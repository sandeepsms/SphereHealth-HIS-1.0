/**
 * sharpsInjuryRoutes.js  (R7bj-F6 / NABH HK-CRIT-1 / HIC.6)
 *
 * Routes mounted at /api/sharps-injury. Writes are the treating-team
 * cohort (Admin / Doctor / Nurse — ICN sits inside Nurse for now);
 * reads include MRD for audit-evidence retrieval.
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/sharpsInjuryController");
const { requireAction } = require("../../middleware/auth");

router.get("/",                  requireAction("clinical.sharps-injury.read"),  ctrl.list);
router.get("/:id",               requireAction("clinical.sharps-injury.read"),  ctrl.getOne);

router.post("/",                 requireAction("clinical.sharps-injury.write"), ctrl.create);
router.put("/:id",               requireAction("clinical.sharps-injury.write"), ctrl.update);
router.put("/:id/pep-started",   requireAction("clinical.sharps-injury.write"), ctrl.pepStarted);
router.put("/:id/serology",      requireAction("clinical.sharps-injury.write"), ctrl.serology);
router.put("/:id/close",         requireAction("clinical.sharps-injury.write"), ctrl.close);

module.exports = router;
