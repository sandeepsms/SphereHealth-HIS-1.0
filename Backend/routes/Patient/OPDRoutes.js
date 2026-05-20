const express = require("express");
const router = express.Router();
const opdController = require("../../controllers/Patient/OPDController");
const { attemptAuth, attachDoctorProfile, requireAction } = require("../../middleware/auth");

// Soft-auth + doctorProfile resolver on all list/read endpoints so we can
// auto-restrict OPD visibility to "only this doctor's patients" when the
// caller is a Doctor (non-doctors keep full visibility).
router.use(attemptAuth, attachDoctorProfile);

// ── Specific non-param routes FIRST ──────────────────────────────
router.get("/today",        opdController.getTodayVisits);
router.get("/followup-due", opdController.getFollowUpDue);

// ── Filtered list routes ──────────────────────────────────────────
router.get("/department/:departmentId", opdController.getVisitsByDepartment);
router.get("/doctor/:doctorId",         opdController.getVisitsByDoctor);

// ── Patient history ───────────────────────────────────────────────
router.get("/patient/:patientId", opdController.getPatientOPDHistory);

// ── CRUD ─────────────────────────────────────────────────────────
// R7ab: visit creation/edit/delete now gated. Previously every
// authenticated role could create OPD visits (Pharmacist, Lab Tech, etc.)
// because only the parent /api/patients had reception.register. Adding
// visits on an existing patient bypassed that gate.
router.post("/",    requireAction("reception.register"), opdController.createOPDVisit);
router.get("/",     opdController.getAllOPDVisits);
router.get("/:visitNumber",   opdController.getOPDVisitById);
router.put("/:visitNumber",   requireAction("reception.register"), opdController.updateOPDVisit);
router.delete("/:visitNumber", requireAction("reception.register"), opdController.deleteOPDVisit);

// ── Nurse vitals & status ─────────────────────────────────────────
router.patch("/:visitNumber/vitals",  requireAction("vitals.write"),    opdController.updateVitals);
router.patch("/:visitNumber/status",  requireAction("reception.register"), opdController.updateStatus);

// ── Doctor OPD Assessment + Audit Trail ──────────────────────────
router.post("/:visitNumber/assessment",  requireAction("rx.write"), opdController.saveAssessment);
router.get ("/:visitNumber/audit-trail", opdController.getOPDauditTrail);

// ── Investigations & prescriptions ───────────────────────────────
router.post("/:visitNumber/investigation",         requireAction("lab.order"), opdController.addInvestigation);
router.put("/:visitNumber/investigation/status",   requireAction("lab.result-entry"), opdController.updateInvestigationStatus);
router.post("/:visitNumber/prescription",          requireAction("rx.write"), opdController.addPrescription);
router.put("/:visitNumber/complete",               requireAction("rx.write"), opdController.completeVisit);

module.exports = router;
