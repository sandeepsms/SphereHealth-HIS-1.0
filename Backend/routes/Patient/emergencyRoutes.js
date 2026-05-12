const express = require("express");
const router = express.Router();
const emergencyController = require("../../controllers/Patient/emergencyController");
const { attemptAuth, attachDoctorProfile } = require("../../middleware/auth");

// Soft-auth + doctor profile resolver — list endpoints will auto-restrict
// to the logged-in doctor's own ER cases. Other roles see everything.
router.use(attemptAuth, attachDoctorProfile);

router.post("/", emergencyController.createEmergencyVisit);
router.get("/", emergencyController.getAllEmergencyVisits);
router.get("/active", emergencyController.getActiveEmergencies);
router.get("/today", emergencyController.getTodayEmergencies);
router.get("/mlc", emergencyController.getMLCCases);
router.get(
  "/triage/:triageCategory",
  emergencyController.getEmergenciesByTriage
);
// `/patient/:patientId` MUST be BEFORE `/:emergencyNumber` — else Express
// matches the param route first and runs getEmergencyVisitById with
// emergencyNumber="patient" → 404.
router.get(
  "/patient/:patientId",
  emergencyController.getPatientEmergencyHistory
);
router.get("/:emergencyNumber", emergencyController.getEmergencyVisitById);
router.put("/:emergencyNumber", emergencyController.updateEmergencyVisit);
router.delete("/:emergencyNumber", emergencyController.deleteEmergencyVisit);
router.post(
  "/:emergencyNumber/investigation",
  emergencyController.addInvestigation
);
router.put(
  "/:emergencyNumber/investigation/status",
  emergencyController.updateInvestigationStatus
);
router.post("/:emergencyNumber/medication", emergencyController.addMedication);
router.post("/:emergencyNumber/procedure", emergencyController.addProcedure);
router.post(
  "/:emergencyNumber/nursing-note",
  emergencyController.addNursingNote
);
router.put(
  "/:emergencyNumber/disposition",
  emergencyController.updateDisposition
);
router.put(
  "/:emergencyNumber/triage",
  emergencyController.updateTriageCategory
);

module.exports = router;
