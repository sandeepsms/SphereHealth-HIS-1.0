const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Patient/admissionController");
const { authenticate, authorize, attemptAuth, attachDoctorProfile, requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

// Soft-auth + doctor profile resolver so list endpoints can auto-restrict
// to "only this doctor's admitted patients" when the caller is a Doctor.
router.use(attemptAuth, attachDoctorProfile);

// All /:id surfaces get the ObjectId validator (round-7 expansion of C-08).
// `:id` is the admission ObjectId; `:consultId` is the consultation row ID
// inside the embedded treatmentTeam array.
const idGuard = validateObjectIdParam("id");
const consultGuard = validateObjectIdParam("consultId");

// ── Statistics ───────────────────────────────────────────────
router.get("/statistics", ctrl.getAdmissionStatistics);

// ── NABH discharge clearance workflow ─────────────────────────
router.get("/discharge-queue",                    ctrl.getDischargeQueue);
router.post("/:id/doctor-approve-discharge",      idGuard, ctrl.doctorApproveDischarge);
router.post("/:id/clear-final-bill",              idGuard, ctrl.clearFinalBill);
router.post("/:id/issue-gate-pass",               idGuard, ctrl.issueGatePass);

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
// Both /my-patients and /my-team-patients MUST come BEFORE the /:id
// param routes — otherwise Express matches "/:id" first and runs
// findById("my-patients") which throws CastError.
router.get("/my-patients", authenticate, attachDoctorProfile, authorize("Doctor", "Admin"), ctrl.getMyPatients);
router.get("/my-team-patients", authenticate, attachDoctorProfile, authorize("Doctor", "Admin"), ctrl.getMyTeamPatients);

// ── Patient lookups ──────────────────────────────────────────
router.get("/patient-by-uhid/:uhid", ctrl.getPatientByUHID);
router.get("/patient/:patientId/history", ctrl.getPatientAdmissionHistory); // ✅ history
router.get("/patient/:patientId", ctrl.getPatientAdmissionHistory); // ✅ alias

// ── CRUD ─────────────────────────────────────────────────────
router.post("/", authenticate, requireAction("ipd.assign-bed"), ctrl.createAdmission);
router.get("/", ctrl.getAllAdmissions);
router.get("/:id/access", idGuard, authenticate, ctrl.checkAccess);
router.get("/:id", idGuard, ctrl.getAdmissionById);
router.put("/:id", idGuard, authenticate, requireAction("ipd.assign-bed"), ctrl.updateAdmission);
router.delete("/:id", idGuard, authenticate, requireAction("ipd.delete"), ctrl.deleteAdmission);

// ── Actions ──────────────────────────────────────────────────
// CLINICAL discharge — Admin / Doctor only. Receptionist still uses the
// /clear-final-bill + /issue-gate-pass workflow (above) to settle billing,
// but cannot flip the admission to "Discharged" without medical sign-off
// (security audit 2026-05-17 A-13 / B-05).
router.post("/:id/discharge", idGuard, authenticate, requireAction("ipd.discharge"), ctrl.dischargePatient);
router.post("/:id/cancel",    idGuard, authenticate, requireAction("ipd.cancel"),    ctrl.cancelAdmission);
router.post("/:id/transfer",  idGuard, authenticate, requireAction("ipd.transfer"),  ctrl.transferBed);
router.put("/:id/initial-assessment", idGuard, ctrl.markInitialAssessment);
// Nurse Initial Assessment full payload save (NABH IPSG.6)
router.post("/:id/nurse-assessment", idGuard, ctrl.saveNurseInitialAssessment);

// ── Multi-doctor Consultation / Treatment Team (NABH COP.1) ──────────
// Add a consulting doctor — only primary consultant can call this
router.post("/:id/consultation", idGuard, authenticate, ctrl.addConsultation);
// Get the full treatment team for an admission
router.get("/:id/consultation", idGuard, ctrl.getConsultations);
// Update consultation notes (by consulting doctor) or status (by primary)
router.put("/:id/consultation/:consultId", idGuard, consultGuard, authenticate, ctrl.updateConsultation);
// Remove a consultation — primary consultant only
router.delete("/:id/consultation/:consultId", idGuard, consultGuard, authenticate, ctrl.removeConsultation);

module.exports = router;
