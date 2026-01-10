const express = require("express");
const router = express.Router();
const AdmissionController = require("../../controllers/Patient/admissionController");

router.post("/", AdmissionController.createAdmission);
router.get("/", AdmissionController.getAllAdmissions);
router.get("/search", AdmissionController.searchAdmissions);
router.get("/active", AdmissionController.getActiveAdmissions);
router.get("/today", AdmissionController.getTodayAdmissions);
router.get("/statistics", AdmissionController.getAdmissionStatistics);
router.get(
  "/patient/:patientId/history",
  AdmissionController.getPatientAdmissionHistory
);
router.get("/:id", AdmissionController.getAdmissionById);
router.put("/:id", AdmissionController.updateAdmission);
router.post("/:id/transfer", AdmissionController.transferBed);
router.post("/:id/discharge", AdmissionController.dischargePatient);
router.post("/:id/cancel", AdmissionController.cancelAdmission);
router.delete("/:id", AdmissionController.deleteAdmission);
module.exports = router;
