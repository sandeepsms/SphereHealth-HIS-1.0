const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Patient/admissionController");
const { authenticate, authorize } = require("../../middleware/auth");

// ── Statistics ───────────────────────────────────────────────
router.get("/statistics", ctrl.getAdmissionStatistics);

// ── Lists ────────────────────────────────────────────────────
router.get("/active", ctrl.getActiveAdmissions);
router.get("/today", ctrl.getTodayAdmissions);
router.get("/search", ctrl.searchAdmissions);

// ── Discharge lists ──────────────────────────────────────────
router.get("/discharges/today", ctrl.getTodayDischarges);
router.get("/discharges/expected", ctrl.getExpectedDischarges);

// ── Doctor filter ────────────────────────────────────────────
router.get("/doctor/:doctorName", ctrl.getAdmissionsByDoctor);

// ── Doctor's own IPD patients (auth required) ────────────────
router.get("/my-patients", authenticate, authorize("Doctor", "Admin"), ctrl.getMyPatients);

// ── Patient lookups ──────────────────────────────────────────
router.get("/patient-by-uhid/:uhid", ctrl.getPatientByUHID);
router.get("/patient/:patientId/history", ctrl.getPatientAdmissionHistory); // ✅ history
router.get("/patient/:patientId", ctrl.getPatientAdmissionHistory); // ✅ alias

// ── CRUD ─────────────────────────────────────────────────────
router.post("/", ctrl.createAdmission);
router.get("/", ctrl.getAllAdmissions);
router.get("/:id/access", authenticate, ctrl.checkAccess);
router.get("/:id", ctrl.getAdmissionById);
router.put("/:id", ctrl.updateAdmission);
router.delete("/:id", ctrl.deleteAdmission);

// ── Actions ──────────────────────────────────────────────────
router.post("/:id/discharge", ctrl.dischargePatient);
router.post("/:id/cancel", ctrl.cancelAdmission);
router.post("/:id/transfer", ctrl.transferBed);

module.exports = router;
