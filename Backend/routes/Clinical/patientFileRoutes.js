// routes/Clinical/patientFileRoutes.js
const router = require("express").Router();
const ctrl = require("../../controllers/Clinical/patientFileController");
const { requireAction } = require("../../middleware/auth");

// Complete file aggregator — used by CompletePatientFilePage.jsx
router.get("/:uhid/complete", ctrl.getCompleteFile);

// Paginated activity feed (audit trail)
router.get("/:uhid/activity", ctrl.getActivityFeed);

// Frontend-driven event logger (clicks, dropdown selects, navigation)
router.post("/:uhid/log", ctrl.logEvent);

// HL7 FHIR R5 bundle export (NABH interop / ABDM). This is a full clinical
// dump and triggers a DPDP-relevant disclosure event, so it's gated to the
// clinical role set only (Admin / Doctor) — receptionists and other PHI
// readers cannot enumerate the bundle even though they can view individual
// fields. Security audit 2026-05-17 B-11 / G-01. The controller layers an
// additional INFORMATION_RELEASE-consent check on top of this gate.
router.get("/:uhid/fhir-bundle", requireAction("patient.export"), ctrl.getFhirBundle);

// Audit chain verifier (NABH AAC.7 / ISO 27001)
router.get("/:uhid/audit-verify", ctrl.verifyAuditChain);

// PAdES signature configuration probe (Roadmap F22)
router.get("/:uhid/sign-status",  ctrl.signStatus);

module.exports = router;
