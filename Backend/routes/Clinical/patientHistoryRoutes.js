// routes/Clinical/patientHistoryRoutes.js
// ═══════════════════════════════════════════════════════════════
// Patient History — read-only chronological views over per-UHID
// OPD visits and per-admission IPD files. Both endpoints are
// gated on `patient.read` so any clinical role (Doctor / Nurse /
// Admin / MRD / Receptionist / etc.) can consult them.
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
const { requireAction } = require("../../middleware/auth");

// OPD history per UHID — chronological list of every OPDRegistration
router.get("/:uhid/opd",        requireAction("patient.read"), ctrl.getOPDHistory);

// Per-UHID list of admissions (picker for the IPD file tab)
router.get("/:uhid/admissions", requireAction("patient.read"), ctrl.listAdmissions);

// Per-admission IPD file — chronological merged timeline.
// `:idOrUhid` accepts ADM-number, IPD-number, Mongo _id, or a UHID
// (UHID falls back to the active or latest admission for that patient).
router.get("/:idOrUhid/file",   requireAction("patient.read"), ctrl.getIPDFile);

module.exports = router;
