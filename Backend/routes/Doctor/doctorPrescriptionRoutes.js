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
const { credentialExpiryBlocker } = require("../../middleware/credentialExpiryBlocker");
const { validateObjectIdParam } = require("../../utils/queryGuards");

// Create prescription
// R7bm-F8 / R7bl close-out: writing a prescription is a licensed clinical
// act under NMC Regulations 2002 + NABH HRD.3 — the doctor's NMC / state
// medical council registration MUST be current. credentialExpiryBlocker
// runs AFTER the role gate; on missing / expired NMC_REG it 403s with
// CREDENTIAL_MISSING | CREDENTIAL_EXPIRED.
router.post("/uhid/:uhid", requireAction("rx.write"), credentialExpiryBlocker("NMC_REG"), prescriptionController.createPrescription);
// R7bb-B/D4-CRIT-S1: every GET on prescriptions now requires `rx.read`
// (Admin / Doctor / Nurse / Pharmacist / Accountant). Pre-R7bb the routes
// were unauthenticated-by-default behind global authenticate but had NO
// per-action gate, so any non-clinical role (Ward Boy / Security / TPA
// Coordinator / Lab Tech) could pull every prescription, medicine list
// and dose for any UHID — full medication PHI surface.
router.get("/checkByuhid/:uhid",  requireAction("rx.read"), prescriptionController.checkCreateOrUpdate);

// Get all prescriptions (with filters)
router.get("/", requireAction("rx.read"), prescriptionController.getAllPrescriptions);

// Get prescription statistics
router.get("/stats", requireAction("rx.read"), prescriptionController.getPrescriptionStats);

// Get prescription by ID and UHID
router.get("/:id", validateObjectIdParam("id"), requireAction("rx.read"), prescriptionController.getPrescriptionById);
router.get("/uhid/:uhid",                       requireAction("rx.read"), prescriptionController.getPrescriptionByUHID);
// Get prescriptions by patient (UHID or ID)
router.get(
  "/patient/:patientIdentifier",
  requireAction("rx.read"),
  prescriptionController.getPrescriptionsByPatient,
);

// Get prescriptions by doctor
router.get(
  "/doctor/:doctorId",
  requireAction("rx.read"),
  prescriptionController.getPrescriptionsByDoctor,
);

// Update prescription — clinical write; only Doctor/Admin
// R7bm-F8: a doctor editing an Rx is still a licensed clinical act —
// re-verify NMC registration.
router.put("/:id", validateObjectIdParam("id"), requireAction("rx.write"), credentialExpiryBlocker("NMC_REG"), prescriptionController.updatePrescription);

// Update prescription status (e.g. Active → Completed → Cancelled)
// Status flips are also gated — only a credentialed doctor should close
// a prescription, otherwise the credentialing audit trail breaks.
router.patch("/:id/status", validateObjectIdParam("id"), requireAction("rx.write"), credentialExpiryBlocker("NMC_REG"), prescriptionController.updatePrescriptionStatus);

// Delete prescription (soft delete) — clinical write
router.delete("/:id", validateObjectIdParam("id"), requireAction("rx.write"), credentialExpiryBlocker("NMC_REG"), prescriptionController.deletePrescription);

module.exports = router;
