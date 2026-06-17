// routes/Clinical/patientHistoryRoutes.js
// ═══════════════════════════════════════════════════════════════
// Patient History — read-only chronological views over per-UHID
// OPD visits and per-admission IPD files.
//
// R7hr-220 (RBAC review #1/#2 — "narrow reception view" policy): the two
// FULL-CLINICAL aggregators (/opd = chief complaint/HOPI/dx/Rx/SOAP;
// /file = the entire per-admission chart incl. MLC PHI + every NABH
// register) were on the broad `patient.read` (9 roles), leaking the full
// clinical narrative to Lab Tech / Pharmacist / Dietician / TPA /
// Accountant — the exact roles permissions.js says must get "demographics
// ... NOT the full clinical narrative". They are the live twins of
// /api/patient-file/:uhid/complete, which R7hr-214 already narrowed to
// `patient-file.read` [Admin/Doctor/Nurse/MRD]. Aligned them with that
// gate (this also REPAIRS the MRD console, which 403'd here because
// patient.read excludes MRD). The admission-LIST picker (/admissions) is
// deliberately LEFT on `patient.read` so the front desk keeps the
// visit-history picker (summary fields only — admissionType / bed / ward /
// doctor / status), per the owner's "narrow reception view" decision.
//
// New surface (does NOT replace /api/patient-file/:uhid/complete,
// which the existing CompletePatientFilePage still uses):
//
//   GET /api/patient-history/:uhid/opd?from=&to=
//   GET /api/patient-history/:uhid/admissions
//   GET /api/patient-history/:idOrUhid/file
//
// See controllers/Clinical/patientHistoryController.js for the
// per-endpoint response shapes.
// ═══════════════════════════════════════════════════════════════

const router = require("express").Router();
const ctrl = require("../../controllers/Clinical/patientHistoryController");
const { requireAction, requireAnyAction } = require("../../middleware/auth");

// OPD history per UHID — chronological list of every OPDRegistration with
// the full assessment payload. Clinical-file gate (R7hr-220).
router.get("/:uhid/opd",        requireAction("patient-file.read"), ctrl.getOPDHistory);

// Per-UHID list of admissions (picker for the IPD file tab). Summary fields
// only. requireAnyAction so BOTH audiences can use the picker: the front desk
// (patient.read — the owner's "narrow reception view") AND the clinical-file
// roles incl. MRD (patient-file.read). MRD is NOT in patient.read, so gating
// this on patient.read alone would let MRD open /file but not reach the picker
// that feeds it — the OR gate keeps reception's picker while repairing MRD's
// IPD File tab end-to-end (R7hr-220). Adds only MRD over the patient.read set.
router.get("/:uhid/admissions", requireAnyAction("patient.read", "patient-file.read"), ctrl.listAdmissions);

// Per-admission IPD file — chronological merged timeline (full clinical chart).
// `:idOrUhid` accepts ADM-number, IPD-number, Mongo _id, or a UHID
// (UHID falls back to the active or latest admission for that patient).
// Clinical-file gate (R7hr-220).
router.get("/:idOrUhid/file",   requireAction("patient-file.read"), ctrl.getIPDFile);

module.exports = router;
