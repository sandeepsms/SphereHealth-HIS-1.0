const express = require("express");
const router = express.Router();
const opdController = require("../../controllers/Patient/OPDController");

// ── Specific non-param routes FIRST ──────────────────────────────
router.get("/today",        opdController.getTodayVisits);
router.get("/followup-due", opdController.getFollowUpDue);

// ── Filtered list routes ──────────────────────────────────────────
router.get("/department/:departmentId", opdController.getVisitsByDepartment);
router.get("/doctor/:doctorId",         opdController.getVisitsByDoctor);

// ── Patient history ───────────────────────────────────────────────
router.get("/patient/:patientId", opdController.getPatientOPDHistory);

// ── CRUD ─────────────────────────────────────────────────────────
router.post("/",    opdController.createOPDVisit);
router.get("/",     opdController.getAllOPDVisits);
router.get("/:visitNumber",   opdController.getOPDVisitById);
router.put("/:visitNumber",   opdController.updateOPDVisit);
router.delete("/:visitNumber", opdController.deleteOPDVisit);

// ── Nurse vitals & status ─────────────────────────────────────────
router.patch("/:visitNumber/vitals",  opdController.updateVitals);
router.patch("/:visitNumber/status",  opdController.updateStatus);

// ── Doctor OPD Assessment + Audit Trail ──────────────────────────
router.post("/:visitNumber/assessment",  opdController.saveAssessment);
router.get ("/:visitNumber/audit-trail", opdController.getOPDauditTrail);

// ── Investigations & prescriptions ───────────────────────────────
router.post("/:visitNumber/investigation",         opdController.addInvestigation);
router.put("/:visitNumber/investigation/status",   opdController.updateInvestigationStatus);
router.post("/:visitNumber/prescription",          opdController.addPrescription);
router.put("/:visitNumber/complete",               opdController.completeVisit);

module.exports = router;
