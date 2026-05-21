const express = require("express");
const router = express.Router();
const opdController = require("../../controllers/Patient/OPDController");
const { attachDoctorProfile, requireAction } = require("../../middleware/auth");

// R7bb-B/D4-CRIT-S1: `attemptAuth` removed — this router sits under the
// global `authenticate` mount in routes/index.js so req.user is already
// guaranteed populated. `attachDoctorProfile` stays so OPD list endpoints
// can auto-restrict to "only this doctor's patients" when role === Doctor.
router.use(attachDoctorProfile);

// R7bb-B/D4-CRIT-S1: every GET on /api/opd now requires `patient.read`
// (same gate as parent /api/patients). Pre-R7bb any authenticated role
// (Ward Boy, Housekeeping, Security) could pull the OPD queue / followup
// list / per-department visit roster — exposes diagnosis + complaint text.

// ── Specific non-param routes FIRST ──────────────────────────────
router.get("/today",        requireAction("patient.read"), opdController.getTodayVisits);
router.get("/followup-due", requireAction("patient.read"), opdController.getFollowUpDue);

// ── Filtered list routes ──────────────────────────────────────────
router.get("/department/:departmentId", requireAction("patient.read"), opdController.getVisitsByDepartment);
router.get("/doctor/:doctorId",         requireAction("patient.read"), opdController.getVisitsByDoctor);

// ── Patient history ───────────────────────────────────────────────
router.get("/patient/:patientId", requireAction("patient.read"), opdController.getPatientOPDHistory);

// ── CRUD ─────────────────────────────────────────────────────────
// R7ab: visit creation/edit/delete now gated. Previously every
// authenticated role could create OPD visits (Pharmacist, Lab Tech, etc.)
// because only the parent /api/patients had reception.register. Adding
// visits on an existing patient bypassed that gate.
router.post("/",    requireAction("reception.register"), opdController.createOPDVisit);
router.get("/",     requireAction("patient.read"), opdController.getAllOPDVisits);
router.get("/:visitNumber",   requireAction("patient.read"), opdController.getOPDVisitById);
router.put("/:visitNumber",   requireAction("reception.register"), opdController.updateOPDVisit);
router.delete("/:visitNumber", requireAction("reception.register"), opdController.deleteOPDVisit);

// ── Nurse vitals & status ─────────────────────────────────────────
router.patch("/:visitNumber/vitals",  requireAction("vitals.write"),    opdController.updateVitals);
router.patch("/:visitNumber/status",  requireAction("reception.register"), opdController.updateStatus);

// ── Doctor OPD Assessment + Audit Trail ──────────────────────────
router.post("/:visitNumber/assessment",  requireAction("rx.write"), opdController.saveAssessment);
router.get ("/:visitNumber/audit-trail", requireAction("patient.read"), opdController.getOPDauditTrail);

// ── Investigations & prescriptions ───────────────────────────────
router.post("/:visitNumber/investigation",         requireAction("lab.order"), opdController.addInvestigation);
router.put("/:visitNumber/investigation/status",   requireAction("lab.result-entry"), opdController.updateInvestigationStatus);
router.post("/:visitNumber/prescription",          requireAction("rx.write"), opdController.addPrescription);
router.put("/:visitNumber/complete",               requireAction("rx.write"), opdController.completeVisit);

module.exports = router;
