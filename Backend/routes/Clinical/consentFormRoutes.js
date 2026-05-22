const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/consentFormController");
// R7n: NABH PRE.3/PRE.4 — consent records are clinical-legal documents.
// Capture/sign/refuse/revoke gated to Admin/Doctor/Nurse; deletion to
// Admin only (signed/refused consent is a permanent legal record).
const { requireAction } = require("../../middleware/auth");

// R7bb-B/D4-CRIT-S1: consent reads now gated on `patient.read` (a signed
// consent reveals the planned procedure + patient demographics + signer
// identity — sensitive PHI). Pre-R7bb any authenticated role could pull
// every consent record for any UHID.
router.get("/uhid/:uhid",             requireAction("patient.read"), ctrl.getByUHID);
router.get("/admission/:admissionId", requireAction("patient.read"), ctrl.getByAdmission);
router.post("/",               requireAction("consent.write"),  ctrl.create);
router.get("/:id", requireAction("patient.read"), ctrl.getById);
router.put("/:id",             requireAction("consent.write"),  ctrl.update);
router.patch("/:id/sign",      requireAction("consent.write"),  ctrl.sign);
router.patch("/:id/refuse",    requireAction("consent.write"),  ctrl.refuse);
router.patch("/:id/revoke",    requireAction("consent.write"),  ctrl.revoke);
router.delete("/:id",          requireAction("consent.delete"), ctrl.delete);

module.exports = router;
