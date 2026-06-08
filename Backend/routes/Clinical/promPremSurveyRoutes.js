/**
 * R7hr-113 — PROM / PREM Survey routes
 * Mounted at /api/prom-prem-surveys
 */
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/promPremSurveyController");
const { authenticate, requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

// All endpoints require authentication
router.use(authenticate);

// LIST + GET — anyone with patient.read can view
router.get("/", requireAction("patient.read"), ctrl.list);
router.get("/:id", validateObjectIdParam("id"), requireAction("patient.read"), ctrl.getById);

// CREATE / UPDATE / SIGN — gated on nursing.write (nurse / doctor / admin)
router.post("/", requireAction("nurse.write"), ctrl.create);
router.patch("/:id", validateObjectIdParam("id"), requireAction("nurse.write"), ctrl.update);
router.post("/:id/sign", validateObjectIdParam("id"), requireAction("nurse.write"), ctrl.sign);

module.exports = router;
