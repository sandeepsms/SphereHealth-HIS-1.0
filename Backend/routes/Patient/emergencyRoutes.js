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
// R7bb-B/D4-CRIT-S1: all GET reads now gated on `patient.read`. Pre-R7bb
// any authenticated role could pull the ER queue / triage list / MLC
// register — exposes triage category, complaint, MLC details (police
// case PHI). Pharmacist / Ward Boy / Housekeeping / Security all had
// silent read access.
router.get("/", requireAction("patient.read"), emergencyController.getAllEmergencyVisits);
router.get("/active", requireAction("patient.read"), emergencyController.getActiveEmergencies);
router.get("/today", requireAction("patient.read"), emergencyController.getTodayEmergencies);
router.get("/mlc",   requireAction("patient.read"), emergencyController.getMLCCases);
router.get(
  "/triage/:triageCategory",
  requireAction("patient.read"),
  emergencyController.getEmergenciesByTriage
);
// `/patient/:patientId` MUST be BEFORE `/:emergencyNumber` — else Express
// matches the param route first and runs getEmergencyVisitById with
// emergencyNumber="patient" → 404.
router.get(
  "/patient/:patientId",
  requireAction("patient.read"),
  emergencyController.getPatientEmergencyHistory
);
router.get("/:emergencyNumber", requireAction("patient.read"), emergencyController.getEmergencyVisitById);
router.put("/:emergencyNumber", requireAction("reception.register"), emergencyController.updateEmergencyVisit);
router.delete("/:emergencyNumber", requireAction("reception.register"), emergencyController.deleteEmergencyVisit);
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
