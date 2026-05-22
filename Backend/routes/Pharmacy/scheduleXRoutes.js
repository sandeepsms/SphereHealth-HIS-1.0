// Backend/routes/Pharmacy/scheduleXRoutes.js  (R7bd-E-1 / A2-MED-16)
//
// NDPS Schedule-X register endpoints. Gated on `pharmacy.schedule-x.write`
// for dispense + verify (Pharmacist + Admin only) and `pharmacy.schedule-x.read`
// for the register view (mirrors the Pharmacist tier — the register surfaces
// PHI + narcotic provenance and stays inside the pharmacy team).
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Pharmacy/scheduleXController");
const { requireAction } = require("../../middleware/auth");

router.post("/dispense", requireAction("pharmacy.schedule-x.write"), ctrl.dispense);
router.get ("/register", requireAction("pharmacy.schedule-x.read"),  ctrl.register);
router.post("/verify",   requireAction("pharmacy.schedule-x.write"), ctrl.verify);

module.exports = router;
