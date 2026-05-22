// Backend/routes/Pharmacy/stockTakeRoutes.js  (R7bd-E-2 / A2-MED-18)
//
// Pharmacy cycle-count endpoints. Gated on `pharmacy.stock-take`
// (Pharmacist + Admin only). Reads share the same gate — a stock-take
// in progress is internal pharmacy data, not clinical.
//
// R7bh-F4 / R7bg-3-CRIT-2: every :id route now runs through
// validateObjectIdParam so a malformed id surfaces as a uniform 400.
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Pharmacy/stockTakeController");
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.post("/",            requireAction("pharmacy.stock-take"), ctrl.create);
router.get ("/",            requireAction("pharmacy.stock-take"), ctrl.list);
router.get ("/:id",         validateObjectIdParam("id"), requireAction("pharmacy.stock-take"), ctrl.getOne);
router.put ("/:id/line",    validateObjectIdParam("id"), requireAction("pharmacy.stock-take"), ctrl.enterPhysical);
router.put ("/:id/verify",  validateObjectIdParam("id"), requireAction("pharmacy.stock-take"), ctrl.verify);

module.exports = router;
