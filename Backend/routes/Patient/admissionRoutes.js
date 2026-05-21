const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Patient/admissionController");
const {
  authenticate,
  authorize,
  attemptAuth,
  attachDoctorProfile,
  restrictToOwnDoctorPatients,
  restrictToOwnNurseWard,
  requireAction,
} = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

// Soft-auth + doctor profile resolver so list endpoints can auto-restrict
// to "only this doctor's admitted patients" when the caller is a Doctor.
// R7az-A/D3-CRIT: also attaches req.scopeFilter for Doctor (own patients
// via attendingDoctorId) and Nurse (own ward via bed.ward) so the
// downstream list controllers can merge it into their Mongo query.
router.use(attemptAuth, attachDoctorProfile, restrictToOwnDoctorPatients, restrictToOwnNurseWard);

// All /:id surfaces get the ObjectId validator (round-7 expansion of C-08).
// `:id` is the admission ObjectId; `:consultId` is the consultation row ID
// inside the embedded treatmentTeam array.
const idGuard = validateObjectIdParam("id");
const consultGuard = validateObjectIdParam("consultId");

// ── Statistics ───────────────────────────────────────────────
router.get("/statistics", ctrl.getAdmissionStatistics);

// ── NABH discharge clearance workflow ─────────────────────────
// R7ab: every write here is now action-gated. Pre-R7ab any authenticated
// role could approve discharge, clear the final bill, or issue a gate pass
// — including the Lab Tech / Dietician. doctor-approve is a clinical
// decision (ipd.discharge); the two reception steps stay on
// reception.discharge.
router.get("/discharge-queue",                    ctrl.getDischargeQueue);
router.post("/:id/doctor-approve-discharge",      idGuard, authenticate, requireAction("ipd.discharge"), ctrl.doctorApproveDischarge);
router.post("/:id/clear-final-bill",              idGuard, authenticate, requireAction("reception.discharge"), ctrl.clearFinalBill);
router.post("/:id/issue-gate-pass",               idGuard, authenticate, requireAction("reception.discharge"), ctrl.issueGatePass);

// R7i: Same-day discharge undo — Admin only, time-gated by the controller
// (≤ 24h since actualDischargeDate). The action permission is the trust
// boundary — the controller adds business rules on top.
router.post("/:id/reactivate",                    idGuard, authenticate, requireAction("admission.reactivate"), ctrl.reactivate);

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
// R7az-A/D9-CRIT-2: initial-assessment + nurse-assessment writes were
// ungated pre-R7az — any authenticated role could mark NABH IPSG.6
// initial-assessment complete or stash an arbitrary nurse-assessment
// payload. Now gated on mar.write (Admin/Nurse) since the nurse
// initial-assessment is the source NABH record; doctor initial-
// assessment marks come from a separate doctor-notes write flow.
router.put ("/:id/initial-assessment", idGuard, requireAction("mar.write"), ctrl.markInitialAssessment);
router.post("/:id/nurse-assessment",   idGuard, requireAction("mar.write"), ctrl.saveNurseInitialAssessment);

// ── Multi-doctor Consultation / Treatment Team (NABH COP.1) ──────────
// Add a consulting doctor — only primary consultant can call this.
// R7az-A/D9-CRIT-3: now action-gated on the new `consultation.write`
// (Admin/Doctor) so Nurse / Receptionist can't manipulate the team.
// Controller still enforces "you are the primary or admin" inside.
router.post  ("/:id/consultation",                  idGuard,               requireAction("consultation.write"), ctrl.addConsultation);
router.get   ("/:id/consultation",                  idGuard,                                                    ctrl.getConsultations);
router.put   ("/:id/consultation/:consultId",       idGuard, consultGuard, requireAction("consultation.write"), ctrl.updateConsultation);
router.delete("/:id/consultation/:consultId",       idGuard, consultGuard, requireAction("consultation.write"), ctrl.removeConsultation);

module.exports = router;
