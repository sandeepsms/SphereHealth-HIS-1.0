// Backend/routes/Pharmacy/scheduleXRoutes.js  (R7bd-E-1 / A2-MED-16)
//
// NDPS Schedule-X register endpoints. Gated on `pharmacy.schedule-x.write`
// for dispense + verify (Pharmacist + Admin only) and `pharmacy.schedule-x.read`
// for the register view (mirrors the Pharmacist tier — the register surfaces
// PHI + narcotic provenance and stays inside the pharmacy team).
// R7bh-F4 / R7bg-3-CRIT-2: no :id routes in this file (all endpoints
// take their identifier from req.body), so validateObjectIdParam is not
// applied here. Body-level id validation lives in the controller/service.
//
// R7hr-12-S2 (D6-06): NDPS Schedule-X dispense + verify are licensed
// acts under D&C Rules 65 + NDPS Act §8 — the dispensing pharmacist
// must hold a current PCI / State Pharmacy Council practising
// registration on the date of the act. Mount credentialExpiryBlocker
// ("PHARMACIST_REG") AFTER requireAction so the role gate still runs
// first; the credential check then 403s on missing/expired PCI rows
// with code CREDENTIAL_MISSING | CREDENTIAL_EXPIRED. Mirrors the
// kitchenIndentRoutes.js mark-delivered + FSSAI_FOOD_HANDLER precedent.
// NABH HRD.3 ("credentialed staff for licensed acts") gap closed.
// The /register read endpoint is intentionally not gated — the register
// view is itself a compliance artefact and read access must not depend
// on the reader's own licence status (Admin / Auditor / Surveyor).
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Pharmacy/scheduleXController");
const { requireAction } = require("../../middleware/auth");
const { credentialExpiryBlocker } = require("../../middleware/credentialExpiryBlocker");

router.post("/dispense",
  requireAction("pharmacy.schedule-x.write"),
  // R7hr-12-S2 (D6-06): block dispense if PCI registration expired/missing.
  credentialExpiryBlocker("PHARMACIST_REG"),
  ctrl.dispense,
);
router.get ("/register", requireAction("pharmacy.schedule-x.read"),  ctrl.register);
router.post("/verify",
  requireAction("pharmacy.schedule-x.write"),
  // R7hr-12-S2 (D6-06): block verify if PCI registration expired/missing.
  credentialExpiryBlocker("PHARMACIST_REG"),
  ctrl.verify,
);

module.exports = router;
