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

// ── R7bb-B/D4-CRIT-S1: every GET below is now gated on `ipd.read` ──
// Admin / Doctor / Nurse / Receptionist. Pre-R7bb any authenticated role
// (Pharmacist, Lab Tech, Ward Boy, Housekeeping, Security) could pull
// the full active-IPD list, today's discharges, the discharge queue,
// per-doctor admission rosters and individual admission detail — all of
// which expose PHI + bed + diagnosis fields. NABH AAC.7 / DPDP
// purpose-limitation violation. The `attemptAuth` + `attachDoctorProfile`
// + scope-filter chain stays mounted at router.use() so a Doctor still
// gets auto-restricted to their own attendingDoctorId set.

// ── Statistics ───────────────────────────────────────────────
router.get("/statistics", requireAction("ipd.read"), ctrl.getAdmissionStatistics);

// ── NABH discharge clearance workflow ─────────────────────────
// R7ab: every write here is now action-gated. Pre-R7ab any authenticated
// role could approve discharge, clear the final bill, or issue a gate pass
// — including the Lab Tech / Dietician. doctor-approve is a clinical
// decision (ipd.discharge); the two reception steps stay on
// reception.discharge.
router.get("/discharge-queue",                    requireAction("ipd.read"), ctrl.getDischargeQueue);
router.post("/:id/doctor-approve-discharge",      idGuard, authenticate, requireAction("ipd.discharge"), ctrl.doctorApproveDischarge);
router.post("/:id/clear-final-bill",              idGuard, authenticate, requireAction("reception.discharge"), ctrl.clearFinalBill);
router.post("/:id/issue-gate-pass",               idGuard, authenticate, requireAction("reception.discharge"), ctrl.issueGatePass);
// R7hr(DC-P1) — day-care checklist + discharge-readiness (nurse tier).
router.patch("/:id/daycare",                      idGuard, authenticate, requireAction("vitals.write"), ctrl.updateDayCare);
// NABH COP.10/11 — vulnerable-patient flags + special-care checklist.
router.patch("/:id/vulnerability",                idGuard, authenticate, requireAction("vitals.write"), ctrl.updateVulnerability);
// R7hr(DC-P2) — day-care → IPD conversion (doctor/discharge tier; reason mandatory).
router.post("/:id/convert-to-ipd",                idGuard, authenticate, requireAction("ipd.discharge"), ctrl.convertDayCareToIpd);

// R7i: Same-day discharge undo — Admin only, time-gated by the controller
// (≤ 24h since actualDischargeDate). The action permission is the trust
// boundary — the controller adds business rules on top.
router.post("/:id/reactivate",                    idGuard, authenticate, requireAction("admission.reactivate"), ctrl.reactivate);

// ── Lists ────────────────────────────────────────────────────
router.get("/active",  requireAction("ipd.read"), ctrl.getActiveAdmissions);
router.get("/today",   requireAction("ipd.read"), ctrl.getTodayAdmissions);
router.get("/search",  requireAction("ipd.read"), ctrl.searchAdmissions);

// ── Discharge lists ──────────────────────────────────────────
router.get("/discharges/today",    requireAction("ipd.read"), ctrl.getTodayDischarges);
router.get("/discharges/expected", requireAction("ipd.read"), ctrl.getExpectedDischarges);

// ── Doctor filter ────────────────────────────────────────────
router.get("/doctor/:doctorName", requireAction("ipd.read"), ctrl.getAdmissionsByDoctor);

// ── Doctor's own IPD patients (auth required) ────────────────
// Both /my-patients and /my-team-patients MUST come BEFORE the /:id
// param routes — otherwise Express matches "/:id" first and runs
// findById("my-patients") which throws CastError.
// R7bb-B/D4-CRIT-S1: inline authorize("Doctor","Admin") replaced with
// requireAction("ipd.read") so the gate is centrally managed in
// permissions.js and the audit map keeps a single source of truth.
// `attachDoctorProfile` is still needed because the controller reads
// req.doctorProfile to scope to the logged-in doctor's own roster.
router.get("/my-patients",      authenticate, attachDoctorProfile, requireAction("ipd.read"), ctrl.getMyPatients);
router.get("/my-team-patients", authenticate, attachDoctorProfile, requireAction("ipd.read"), ctrl.getMyTeamPatients);

// ── Patient lookups ──────────────────────────────────────────
router.get("/patient-by-uhid/:uhid",       requireAction("ipd.read"), ctrl.getPatientByUHID);
router.get("/patient/:patientId/history",  requireAction("ipd.read"), ctrl.getPatientAdmissionHistory); // ✅ history
router.get("/patient/:patientId",          requireAction("ipd.read"), ctrl.getPatientAdmissionHistory); // ✅ alias

// ── CRUD ─────────────────────────────────────────────────────
router.post("/", authenticate, requireAction("ipd.assign-bed"), ctrl.createAdmission);
router.get("/",  requireAction("ipd.read"), ctrl.getAllAdmissions);
router.get("/:id/access", idGuard, authenticate, requireAction("ipd.read"), ctrl.checkAccess);
router.get("/:id",        idGuard, requireAction("ipd.read"), ctrl.getAdmissionById);
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
// R7bb-B/D4-CRIT-S1: GET consultations now gated on `ipd.read`
// (Admin/Doctor/Nurse/Receptionist) — pre-R7bb the treatment-team
// roster + consultant fee history was ungated.
router.get   ("/:id/consultation",                  idGuard,               requireAction("ipd.read"),           ctrl.getConsultations);
router.put   ("/:id/consultation/:consultId",       idGuard, consultGuard, requireAction("consultation.write"), ctrl.updateConsultation);
router.delete("/:id/consultation/:consultId",       idGuard, consultGuard, requireAction("consultation.write"), ctrl.removeConsultation);

module.exports = router;
