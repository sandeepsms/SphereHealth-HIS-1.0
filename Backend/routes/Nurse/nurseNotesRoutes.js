// Nurse/routes/nurseNotesRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Nurse/nurseNotesController");
// R7q: All nurse-note WRITES gated by mar.write (Admin / Nurse). Nurse
// notes are the NABH-audit MAR records — confirm-order / blood-status /
// blood-monitoring all flow into the patient's medication-admin trail,
// so they share the same role set as the dose-administer flow.
const { requireAction } = require("../../middleware/auth");

router.get("/today/:ipdNo",                 ctrl.getTodayNotes);
router.get("/patient/:patientId",           ctrl.getNotesByPatient);
router.get("/ipd/:ipdNo",                   ctrl.getNotesByIPD);
// Full patient nursing report (all notes + full module data, for print/PDF/insurance)
router.get("/report/:ipdNo",                ctrl.getPatientReport);
router.post("/",                            requireAction("mar.write"), ctrl.createNote);
// Query-param fallback: GET /nurse-notes?ipdNo=XXX (used by NursingNotesPage)
router.get("/",                             ctrl.getNotesByQuery);
router.get("/:id",                          ctrl.getNoteById);
router.put("/:id",                          requireAction("mar.write"), ctrl.updateNote);
router.patch("/:id/confirm-order",          requireAction("mar.write"), ctrl.confirmOrder);
router.patch("/:id/blood-monitoring",       requireAction("mar.write"), ctrl.addBloodMonitoring);
router.patch("/:id/blood-status",           requireAction("mar.write"), ctrl.updateBloodStatus);
router.delete("/:id",                       requireAction("mar.write"), ctrl.deleteNote);

module.exports = router;
