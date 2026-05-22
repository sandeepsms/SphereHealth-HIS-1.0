// routes/Billing/cashierSessionRoutes.js — R7ap-F20
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Billing/cashierSessionController");
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.get  ("/current",         requireAction("billing.write"), ctrl.getCurrentSession);
router.get  ("/",                requireAction("billing.read"),  ctrl.listSessions);
router.post ("/open",            requireAction("billing.write"), ctrl.openSession);
router.post ("/:id/close",       validateObjectIdParam("id"), requireAction("billing.write"), ctrl.closeSession);
// R7bb-FIX-E-17 / D3-HIGH-6: Admin co-sign clear for self-close that
// landed in PENDING APPROVAL due to material variance / cash short.
router.post ("/:id/clear-close", validateObjectIdParam("id"), requireAction("billing.refund"), ctrl.clearCloseApproval);

module.exports = router;
