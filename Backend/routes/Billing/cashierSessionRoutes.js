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

module.exports = router;
