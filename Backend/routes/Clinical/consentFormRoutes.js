const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Clinical/consentFormController");
// R7n: NABH PRE.3/PRE.4 — consent records are clinical-legal documents.
// Capture/sign/refuse/revoke gated to Admin/Doctor/Nurse; deletion to
// Admin only (signed/refused consent is a permanent legal record).
const { requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

// R7bb-B/D4-CRIT-S1: consent reads gated off "any authenticated role".
// R7hr-225 (security audit): tightened further from the broad patient.read
// (which still admitted the demographics-only roles Lab/Pharm/Dietician/TPA/
// Accountant) onto patient-file.read [Admin/Doctor/Nurse/MRD]. A consent
// reveals its TYPE (HIV_TESTING / DNR / RESEARCH / LAMA), the procedure, and
// the consenting party's govt-ID number + contact — special-category PHI that
// must not reach billing/insurance-facing roles. consent.write is already
// [Admin/Doctor/Nurse]; the only read consumers are the Dr/Nurse panels.
router.get("/uhid/:uhid",             requireAction("patient-file.read"), ctrl.getByUHID);
router.get("/admission/:admissionId", requireAction("patient-file.read"), ctrl.getByAdmission);
router.post("/",               requireAction("consent.write"),  ctrl.create);
router.get("/:id", validateObjectIdParam("id"), requireAction("patient-file.read"), ctrl.getById);
router.put("/:id",             validateObjectIdParam("id"), requireAction("consent.write"),  ctrl.update);
router.patch("/:id/sign",      validateObjectIdParam("id"), requireAction("consent.write"),  ctrl.sign);
router.patch("/:id/refuse",    validateObjectIdParam("id"), requireAction("consent.write"),  ctrl.refuse);
router.patch("/:id/revoke",    validateObjectIdParam("id"), requireAction("consent.write"),  ctrl.revoke);
router.delete("/:id",          validateObjectIdParam("id"), requireAction("consent.delete"), ctrl.delete);

// R7ez — Paperless consent: biometric (WebAuthn) + staff e-sign + bypass.
// Same `consent.write` permission scope as the existing edit/sign chain so
// the same roles (Admin/Doctor/Nurse) can capture biometric + sign. The
// bypass endpoint enforces Admin-only at the controller layer (since it
// requires a documented reason and we want a clean 403 message).
router.put  ("/:id/consenting-party", validateObjectIdParam("id"), requireAction("consent.write"), ctrl.setConsentingParty);
router.post ("/:id/biometric/options", validateObjectIdParam("id"), requireAction("consent.write"), ctrl.biometricOptions);
router.post ("/:id/biometric/verify",  validateObjectIdParam("id"), requireAction("consent.write"), ctrl.biometricVerify);
router.post ("/:id/staff-sign",        validateObjectIdParam("id"), requireAction("consent.write"), ctrl.staffSign);
router.post ("/:id/bypass",            validateObjectIdParam("id"), requireAction("consent.write"), ctrl.bypassBiometric);

module.exports = router;
