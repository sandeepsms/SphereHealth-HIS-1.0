const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/consentFormController");
// R7n: NABH PRE.3/PRE.4 — consent records are clinical-legal documents.
// Capture/sign/refuse/revoke gated to Admin/Doctor/Nurse; deletion to
// Admin only (signed/refused consent is a permanent legal record).
const { requireAction } = require("../../middleware/auth");

router.get("/uhid/:uhid", ctrl.getByUHID);
router.get("/admission/:admissionId", ctrl.getByAdmission);
router.post("/",               requireAction("consent.write"),  ctrl.create);
router.get("/:id", ctrl.getById);
router.put("/:id",             requireAction("consent.write"),  ctrl.update);
router.patch("/:id/sign",      requireAction("consent.write"),  ctrl.sign);
router.patch("/:id/refuse",    requireAction("consent.write"),  ctrl.refuse);
router.patch("/:id/revoke",    requireAction("consent.write"),  ctrl.revoke);
router.delete("/:id",          requireAction("consent.delete"), ctrl.delete);

module.exports = router;
