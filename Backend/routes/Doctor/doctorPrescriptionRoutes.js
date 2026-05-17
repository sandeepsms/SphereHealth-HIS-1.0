// routes/Doctor/doctorPrescriptionRoutes.js
//
// All write surfaces are gated by `requireAction("rx.write")` so non-Doctor
// roles (Receptionist, Lab Technician, Pharmacist viewing the file) cannot
// rewrite medicine names, diagnosis, or investigation lists. Security audit
// 2026-05-17 finding A-15.

const express = require("express");
const router = express.Router();
const prescriptionController = require("../../controllers/Doctor/prescriptionController");
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

// Create prescription
router.post("/uhid/:uhid", requireAction("rx.write"), prescriptionController.createPrescription);
router.get("/checkByuhid/:uhid", prescriptionController.checkCreateOrUpdate);

// Get all prescriptions (with filters) — read open to any clinical role
// already covered by the routes/index.js global authenticate.
router.get("/", prescriptionController.getAllPrescriptions);

// Get prescription statistics
router.get("/stats", prescriptionController.getPrescriptionStats);

// Get prescription by ID and UHID
router.get("/:id", validateObjectIdParam("id"), prescriptionController.getPrescriptionById);
router.get("/uhid/:uhid", prescriptionController.getPrescriptionByUHID);
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

// Update prescription — clinical write; only Doctor/Admin
router.put("/:id", validateObjectIdParam("id"), requireAction("rx.write"), prescriptionController.updatePrescription);

// Update prescription status (e.g. Active → Completed → Cancelled)
router.patch("/:id/status", validateObjectIdParam("id"), requireAction("rx.write"), prescriptionController.updatePrescriptionStatus);

// Delete prescription (soft delete) — clinical write
router.delete("/:id", validateObjectIdParam("id"), requireAction("rx.write"), prescriptionController.deletePrescription);

module.exports = router;
