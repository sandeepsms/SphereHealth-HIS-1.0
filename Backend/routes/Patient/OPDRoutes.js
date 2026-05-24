const express = require("express");
const router = express.Router();
const opdController = require("../../controllers/Patient/OPDController");
const { attachDoctorProfile, requireAction } = require("../../middleware/auth");

// R7bb-B/D4-CRIT-S1: `attemptAuth` removed — this router sits under the
// global `authenticate` mount in routes/index.js so req.user is already
// guaranteed populated. `attachDoctorProfile` stays so OPD list endpoints
// can auto-restrict to "only this doctor's patients" when role === Doctor.
router.use(attachDoctorProfile);

// R7bb-FIX-C-1/S1 (D4-CRIT): every GET on /api/opd now requires the
// narrower `opd.read` (Admin / Doctor / Nurse / Receptionist) instead of
// the wider `patient.read` (9 roles). The OPD queue + per-visit detail
// exposes diagnosis + complaint + Rx text — Pharmacist / Lab Tech /
// Dietician / TPA / Accountant do not need to enumerate the queue. The
// narrower token also stops Ward Boy / Housekeeping / Security from
// hitting these endpoints with their valid JWTs.

// ── Specific non-param routes FIRST ──────────────────────────────
router.get("/today",        requireAction("opd.read"), opdController.getTodayVisits);
router.get("/followup-due", requireAction("opd.read"), opdController.getFollowUpDue);

// ── Filtered list routes ──────────────────────────────────────────
router.get("/department/:departmentId", requireAction("opd.read"), opdController.getVisitsByDepartment);
router.get("/doctor/:doctorId",         requireAction("opd.read"), opdController.getVisitsByDoctor);

// ── Patient history ───────────────────────────────────────────────
router.get("/patient/:patientId", requireAction("opd.read"), opdController.getPatientOPDHistory);

// ── R7cr — Pharmacy fast-lookup: today's Rx for a UHID ──────────
// Gated by `pharmacy.rx-lookup` — a SCOPED action (Admin / Doctor /
// Nurse / Receptionist / Pharmacist). Wider than `opd.read` only on
// Pharmacist so the pharmacy counter can pull today's prescribed
// medicines + diagnosis for a SPECIFIC UHID it already knows, but
// can't enumerate the full OPD queue (which would leak every
// patient's diagnosis / token / chief complaint).
router.get(
  "/uhid/:UHID/today-rx",
  requireAction("pharmacy.rx-lookup"),
  opdController.getTodayPrescriptionsByUHID,
);

// ── CRUD ─────────────────────────────────────────────────────────
// R7ab: visit creation/edit/delete now gated. Previously every
// authenticated role could create OPD visits (Pharmacist, Lab Tech, etc.)
// because only the parent /api/patients had reception.register. Adding
// visits on an existing patient bypassed that gate.
router.post("/",    requireAction("reception.register"), opdController.createOPDVisit);
router.get("/",     requireAction("opd.read"), opdController.getAllOPDVisits);
router.get("/:visitNumber",   requireAction("opd.read"), opdController.getOPDVisitById);
router.put("/:visitNumber",   requireAction("reception.register"), opdController.updateOPDVisit);
// R7bb-FIX-C-11/D2-HIGH-2: DELETE on an OPD visit record is a clinical
// deletion — only Admin and Doctor should perform it. Pre-R7bb the gate
// was `reception.register` which let any front-desk staffer wipe a visit
// record without the clinician's sign-off (clinical history loss + audit
// trail break). `opd.delete` = [Admin, Doctor].
router.delete("/:visitNumber", requireAction("opd.delete"), opdController.deleteOPDVisit);

// ── Nurse vitals & status ─────────────────────────────────────────
router.patch("/:visitNumber/vitals",  requireAction("vitals.write"),    opdController.updateVitals);
router.patch("/:visitNumber/status",  requireAction("reception.register"), opdController.updateStatus);

// ── Doctor OPD Assessment + Audit Trail ──────────────────────────
router.post("/:visitNumber/assessment",  requireAction("rx.write"), opdController.saveAssessment);
// R7cj — Append-only addendum note on a signed assessment.
// rx.write gate (Doctor/Admin) so only clinicians can write.
router.post("/:visitNumber/additional-note", requireAction("rx.write"), opdController.addAdditionalNote);
router.get ("/:visitNumber/audit-trail", requireAction("opd.read"), opdController.getOPDauditTrail);

// ── Investigations & prescriptions ───────────────────────────────
router.post("/:visitNumber/investigation",         requireAction("lab.order"), opdController.addInvestigation);
router.put("/:visitNumber/investigation/status",   requireAction("lab.result-entry"), opdController.updateInvestigationStatus);
router.post("/:visitNumber/prescription",          requireAction("rx.write"), opdController.addPrescription);
router.put("/:visitNumber/complete",               requireAction("rx.write"), opdController.completeVisit);

module.exports = router;
