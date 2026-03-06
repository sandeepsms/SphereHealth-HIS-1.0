const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Patient/admissionController");

// ── Statistics ───────────────────────────────────────────────
// GET /api/admissions/statistics
// GET /api/admissions/statistics?startDate=2026-01-01&endDate=2026-02-28
// Response now includes: admissionTypeWise, doctorWise aggregates
router.get("/statistics", ctrl.getAdmissionStatistics);

// ── Lists ────────────────────────────────────────────────────
// GET /api/admissions/active
// GET /api/admissions/active?department=ICU&admissionType=Emergency&attendingDoctor=Dr.Sharma
router.get("/active", ctrl.getActiveAdmissions);

// GET /api/admissions/today
router.get("/today", ctrl.getTodayAdmissions);

// GET /api/admissions/search?q=Rahul
router.get("/search", ctrl.searchAdmissions);

// ── Discharge lists ──────────────────────────────────────────
// GET /api/admissions/discharges/today
router.get("/discharges/today", ctrl.getTodayDischarges);

// GET /api/admissions/discharges/expected
// GET /api/admissions/discharges/expected?date=2026-02-27
router.get("/discharges/expected", ctrl.getExpectedDischarges);

// ── Doctor filter ────────────────────────────────────────────
// GET /api/admissions/doctor/Dr.%20Sharma
// Returns all ACTIVE admissions under that doctor
router.get("/doctor/:doctorName", ctrl.getAdmissionsByDoctor);

// ── Patient lookups ──────────────────────────────────────────
// GET /api/admissions/patient-by-uhid/UH00000001
router.get("/patient-by-uhid/:uhid", ctrl.getPatientByUHID);

// GET /api/admissions/patient/:patientId/history
router.get("/patient/:patientId/history", ctrl.getPatientAdmissionHistory);

// ── CRUD ─────────────────────────────────────────────────────
// POST /api/admissions
// Body: { patientId|UHID, bedId, department, admissionDate?,
//         expectedDischargeDate?, reasonForAdmission,
//         admissionType?, attendingDoctor?,
//         estimatedCost?, advancePaid? }
router.post("/", ctrl.createAdmission);

// GET /api/admissions
// GET /api/admissions?status=Active&admissionType=Emergency&attendingDoctor=Dr.Sharma
router.get("/", ctrl.getAllAdmissions);

// GET /api/admissions/:id
router.get("/:id", ctrl.getAdmissionById);

// PUT /api/admissions/:id
// Allowed: department, expectedDischargeDate, reasonForAdmission,
//          admissionType, attendingDoctor, dischargeNotes,
//          dischargeSummary, estimatedCost, advancePaid
// NOT allowed: status, patientId, bedId, admissionNumber
router.put("/:id", ctrl.updateAdmission);

// DELETE /api/admissions/:id  (admin only — frees bed if Active)
router.delete("/:id", ctrl.deleteAdmission);

// ── Actions ──────────────────────────────────────────────────
// POST /api/admissions/:id/discharge
// Body: { actualDischargeDate?, dischargeNotes?, dischargeSummary?,
//         conditionOnDischarge?, followUpInstructions?, totalCost? }
router.post("/:id/discharge", ctrl.dischargePatient);

// POST /api/admissions/:id/cancel
// Body: { reason }
router.post("/:id/cancel", ctrl.cancelAdmission);

// POST /api/admissions/:id/transfer
// Body: { newBedId, reason? }
router.post("/:id/transfer", ctrl.transferBed);

module.exports = router;
