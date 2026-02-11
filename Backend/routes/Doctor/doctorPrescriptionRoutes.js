// routes/prescriptionRoutes.js
const express = require("express");
const router = express.Router();
const prescriptionController = require("../../controllers/Doctor/prescriptionController");

// Create prescription
router.post("/", prescriptionController.createPrescription);

// Get all prescriptions (with filters)
router.get("/", prescriptionController.getAllPrescriptions);

// Get prescription statistics
router.get("/stats", prescriptionController.getPrescriptionStats);

// Get prescription by ID
router.get("/:id", prescriptionController.getPrescriptionById);

// Get prescriptions by patient (UHID or ID)
router.get(
  "/patient/:patientIdentifier",
  prescriptionController.getPrescriptionsByPatient,
);

// Get prescriptions by doctor
router.get(
  "/doctor/:doctorId",
  prescriptionController.getPrescriptionsByDoctor,
);

// Update prescription
router.put("/:id", prescriptionController.updatePrescription);

// Update prescription status
router.patch("/:id/status", prescriptionController.updatePrescriptionStatus);

// Delete prescription
router.delete("/:id", prescriptionController.deletePrescription);

module.exports = router;
