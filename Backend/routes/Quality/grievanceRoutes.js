/**
 * grievanceRoutes.js  (R7bf-G / A5-CRIT-5 / NABH PRE.6)
 *
 * Routes mounted at /api/grievances. Reception desk + MRD raise + assign
 * + resolve under `quality.grievance.write`. Doctors get read so they
 * see treatment-related complaints attached to a patient.
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Quality/grievanceController");
const { requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.get("/",                requireAction("quality.grievance.read"),  ctrl.list);
router.get("/:id",             validateObjectIdParam("id"), requireAction("quality.grievance.read"),  ctrl.getOne);

router.post("/",               requireAction("quality.grievance.write"), ctrl.create);
router.put("/:id",             validateObjectIdParam("id"), requireAction("quality.grievance.write"), ctrl.update);
router.put("/:id/assign",      validateObjectIdParam("id"), requireAction("quality.grievance.write"), ctrl.assign);
router.put("/:id/resolve",     validateObjectIdParam("id"), requireAction("quality.grievance.write"), ctrl.resolve);
router.put("/:id/close",       validateObjectIdParam("id"), requireAction("quality.grievance.write"), ctrl.close);
router.put("/:id/escalate",    validateObjectIdParam("id"), requireAction("quality.grievance.write"), ctrl.escalate);

module.exports = router;
