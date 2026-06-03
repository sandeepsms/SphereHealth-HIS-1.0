// routes/Investigation/Investigationmasterroutes.js
//
// R7as-FIX-3/D3-crit: lab-tariff master CRUD now gated. Pre-R7as any
// authenticated user could mutate investigation prices or wipe the
// catalogue. Reads stay on `billing.read` for cashiers / accountants /
// lab desk; writes require `departments.write`; seed is admin-only.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Investigation/investigationMasterController");
const { requireAction, adminOnly } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.get   ("/grouped",            requireAction("billing.read"),      ctrl.getGrouped);
router.post  ("/seed",               adminOnly,                          ctrl.seed);
router.get   ("/",                   requireAction("billing.read"),      ctrl.getAll);
router.post  ("/",                   requireAction("departments.write"), ctrl.create);
router.get   ("/:id",                validateObjectIdParam("id"), requireAction("billing.read"),      ctrl.getById);
router.put   ("/:id",                validateObjectIdParam("id"), requireAction("departments.write"), ctrl.update);
router.delete("/:id",                validateObjectIdParam("id"), requireAction("departments.write"), ctrl.remove);
router.get   ("/:id/pricing",        validateObjectIdParam("id"), requireAction("billing.read"),      ctrl.getPricing);
router.post  ("/:id/pricing",        validateObjectIdParam("id"), requireAction("departments.write"), ctrl.setPricing);
router.get   ("/:id/effective-price",validateObjectIdParam("id"), requireAction("billing.read"),      ctrl.getEffectivePrice);

module.exports = router;
