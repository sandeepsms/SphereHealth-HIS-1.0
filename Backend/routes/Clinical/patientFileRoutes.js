// routes/Clinical/patientFileRoutes.js
const router = require("express").Router();
const ctrl = require("../../controllers/Clinical/patientFileController");

// Complete file aggregator — used by CompletePatientFilePage.jsx
router.get("/:uhid/complete", ctrl.getCompleteFile);

// Paginated activity feed (audit trail)
router.get("/:uhid/activity", ctrl.getActivityFeed);

// Frontend-driven event logger (clicks, dropdown selects, navigation)
router.post("/:uhid/log", ctrl.logEvent);

// HL7 FHIR R5 bundle export (NABH interop / ABDM)
router.get("/:uhid/fhir-bundle", ctrl.getFhirBundle);

// Audit chain verifier (NABH AAC.7 / ISO 27001)
router.get("/:uhid/audit-verify", ctrl.verifyAuditChain);

// PAdES signature configuration probe (Roadmap F22)
router.get("/:uhid/sign-status",  ctrl.signStatus);

module.exports = router;
