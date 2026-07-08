const express = require("express");
const router = express.Router();
const emergencyController = require("../../controllers/Patient/emergencyController");
const { attemptAuth, attachDoctorProfile, requireAction } = require("../../middleware/auth");

// Soft-auth + doctor profile resolver — list endpoints will auto-restrict
// to the logged-in doctor's own ER cases. Other roles see everything.
router.use(attemptAuth, attachDoctorProfile);

// R7ab: writes are now action-gated. Pre-R7ab any authenticated user
// (Pharmacist, Dietician, etc.) could create ER visits or flip triage —
// the parent /api/patients gate was bypassable by hitting these routes
// directly on an existing patient.
router.post("/", requireAction("reception.register"), emergencyController.createEmergencyVisit);
// R7bb-FIX-C-1/S1 (D4-CRIT): all GET reads now gated on the narrower
// `er.read` (Admin / Doctor / Nurse / Receptionist) instead of the wide
// `patient.read` (9 roles). The ER queue exposes triage category +
// complaint + MLC details (police-case PHI) — Pharmacist / Lab Tech /
// Dietician / TPA / Accountant / Ward Boy / Housekeeping / Security do
// not need to enumerate it.
router.get("/", requireAction("er.read"), emergencyController.getAllEmergencyVisits);
router.get("/active", requireAction("er.read"), emergencyController.getActiveEmergencies);
router.get("/today", requireAction("er.read"), emergencyController.getTodayEmergencies);
router.get("/mlc",   requireAction("er.read"), emergencyController.getMLCCases);
router.get(
  "/triage/:triageCategory",
  requireAction("er.read"),
  emergencyController.getEmergenciesByTriage
);
// `/patient/:patientId` MUST be BEFORE `/:emergencyNumber` — else Express
// matches the param route first and runs getEmergencyVisitById with
// emergencyNumber="patient" → 404.
router.get(
  "/patient/:patientId",
  requireAction("er.read"),
  emergencyController.getPatientEmergencyHistory
);
router.get("/:emergencyNumber", requireAction("er.read"), emergencyController.getEmergencyVisitById);
router.put("/:emergencyNumber", requireAction("reception.register"), emergencyController.updateEmergencyVisit);
// R7bb-FIX-C-11/D2-HIGH-2: DELETE on an ER visit record is clinical-
// history erasure — only Admin and Doctor should perform it. Pre-R7bb
// the gate was `reception.register` which let any front-desk staffer
// wipe an MLC / triage record without the clinician's sign-off.
// `er.delete` = [Admin, Doctor].
router.delete("/:emergencyNumber", requireAction("er.delete"), emergencyController.deleteEmergencyVisit);
router.post(
  "/:emergencyNumber/investigation",
  requireAction("lab.order"),
  emergencyController.addInvestigation
);
router.put(
  "/:emergencyNumber/investigation/status",
  requireAction("lab.result-entry"),
  emergencyController.updateInvestigationStatus
);
router.post("/:emergencyNumber/medication", requireAction("rx.write"), emergencyController.addMedication);
router.post("/:emergencyNumber/procedure",  requireAction("rx.write"), emergencyController.addProcedure);
router.post(
  "/:emergencyNumber/nursing-note",
  requireAction("vitals.write"),
  emergencyController.addNursingNote
);
// R7hr(ER-P1.1) — serial vitals during the ER stay (the Observation loop
// rides this). Same vitals.write tier as nursing notes: nurse-recordable.
router.post(
  "/:emergencyNumber/vitals",
  requireAction("vitals.write"),
  emergencyController.addVitals
);
// Disposition can be set by Doctor (clinical decision) or Receptionist
// (operational — discharge home / refer out). The service-side state
// machine enforces the per-branch attestation (R7z).
router.put(
  "/:emergencyNumber/disposition",
  requireAction("ipd.discharge"),  // Admin/Doctor only
  emergencyController.updateDisposition
);
// Triage upgrade/downgrade — Doctor or Nurse (clinical assessment).
router.put(
  "/:emergencyNumber/triage",
  requireAction("vitals.write"),
  emergencyController.updateTriageCategory
);

module.exports = router;
