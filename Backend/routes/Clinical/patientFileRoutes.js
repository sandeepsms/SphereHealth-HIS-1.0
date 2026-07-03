// routes/Clinical/patientFileRoutes.js
const router = require("express").Router();
const ctrl = require("../../controllers/Clinical/patientFileController");
const { requireAction } = require("../../middleware/auth");

// R7az-A/D1-CRIT/D9-CRIT-1: every PHI endpoint now action-gated.
// Pre-R7az `/:uhid/complete` and the audit/sign-status verifiers were
// only behind the global authenticate() — any logged-in role (Pharmacist,
// Lab Tech, Receptionist) could pull every chart/note/MAR/payment for
// any UHID. DPDP §5 purpose-limitation + NABH AAC.7 violation.

// Complete file aggregator — used by CompletePatientFilePage.jsx
// R7hr-214 (RBAC audit): the consolidated clinical file (notes, MAR, vitals,
// consents, MLC PHI, discharge, billing) is a clinical-only surface. Gating it
// on the broad `patient.read` let Receptionist / Lab / Pharmacist / Dietician /
// TPA / Accountant pull the whole chart via direct API even though the UI hides
// it (DPDP §5 purpose-limitation). Tightened to `patient-file.read`
// [Admin, Doctor, Nurse, MRD] — the token already defined for exactly this.
router.get("/:uhid/complete",     requireAction("patient-file.read"), ctrl.getCompleteFile);

// Paginated activity feed (audit trail) — same clinical-only audience as /complete.
router.get("/:uhid/activity",     requireAction("patient-file.read"), ctrl.getActivityFeed);

// Aggregated audit bundle (activity + print + billing + clinical trails) for
// the "print Complete File WITH audit logs" option. Deliberately gated on the
// dedicated patient-file.audit-print token [Admin, MRD] — NOT reports.audit —
// so MRD gets patient-scoped audit prints without inheriting the hospital-wide
// billing-audit surfaces that reports.audit unlocks.
router.get("/:uhid/audit-bundle", requireAction("patient-file.audit-print"), ctrl.getAuditBundle);

// Frontend-driven event logger (clicks, dropdown selects, navigation)
// Write is auto-allow-listed for MRD in blockReadOnlyRoleWrites so MRD's
// view actions still log to PatientActivityLog.
router.post("/:uhid/log",         requireAction("patient.read"), ctrl.logEvent);

// HL7 FHIR R5 bundle export (NABH interop / ABDM). This is a full clinical
// dump and triggers a DPDP-relevant disclosure event, so it's gated to the
// clinical role set only (Admin / Doctor) — receptionists and other PHI
// readers cannot enumerate the bundle even though they can view individual
// fields. Security audit 2026-05-17 B-11 / G-01. The controller layers an
// additional INFORMATION_RELEASE-consent check on top of this gate.
router.get("/:uhid/fhir-bundle",  requireAction("patient.export"), ctrl.getFhirBundle);

// Audit chain verifier (NABH AAC.7 / ISO 27001) — admin/auditor surface.
router.get("/:uhid/audit-verify", requireAction("reports.audit"), ctrl.verifyAuditChain);

// PAdES signature configuration probe (Roadmap F22) — clinical-file surface.
router.get("/:uhid/sign-status",  requireAction("patient-file.read"), ctrl.signStatus);

module.exports = router;
