// Backend/routes/Pharmacy/stockTakeRoutes.js  (R7bd-E-2 / A2-MED-18)
//
// Pharmacy cycle-count endpoints. Gated on `pharmacy.stock-take`
// (Pharmacist + Admin only). Reads share the same gate — a stock-take
// in progress is internal pharmacy data, not clinical.
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Pharmacy/stockTakeController");
const { requireAction } = require("../../middleware/auth");

router.post("/",            requireAction("pharmacy.stock-take"), ctrl.create);
router.get ("/",            requireAction("pharmacy.stock-take"), ctrl.list);
router.get ("/:id",         requireAction("pharmacy.stock-take"), ctrl.getOne);
router.put ("/:id/line",    requireAction("pharmacy.stock-take"), ctrl.enterPhysical);
router.put ("/:id/verify",  requireAction("pharmacy.stock-take"), ctrl.verify);

module.exports = router;
