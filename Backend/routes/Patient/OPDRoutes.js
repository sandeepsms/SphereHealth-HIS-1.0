const express = require("express");
const router = express.Router();
const opdController = require("../../controllers/patient/opdController");

router.post("/", opdController.createOPDVisit);
router.get("/", opdController.getAllOPDVisits);
router.get("/today", opdController.getTodayVisits);
router.get("/followup-due", opdController.getFollowUpDue);
router.get("/:visitNumber", opdController.getOPDVisitById);
router.get("/patient/:patientId", opdController.getPatientOPDHistory);
router.put("/:visitNumber", opdController.updateOPDVisit);
router.delete("/:visitNumber", opdController.deleteOPDVisit);
router.post("/:visitNumber/investigation", opdController.addInvestigation);
router.put(
  "/:visitNumber/investigation/status",
  opdController.updateInvestigationStatus
);
router.post("/:visitNumber/prescription", opdController.addPrescription);
router.put("/:visitNumber/complete", opdController.completeVisit);

module.exports = router;
