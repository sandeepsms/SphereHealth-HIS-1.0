// Nurse/routes/nurseNotesRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Nurse/nurseNotesController");

router.get("/today/:ipdNo", ctrl.getTodayNotes);
router.get("/patient/:patientId", ctrl.getNotesByPatient);
router.get("/ipd/:ipdNo", ctrl.getNotesByIPD);
// Full patient nursing report (all notes + full module data, for print/PDF/insurance)
router.get("/report/:ipdNo", ctrl.getPatientReport);
router.post("/", ctrl.createNote);
// Query-param fallback: GET /nurse-notes?ipdNo=XXX (used by NursingNotesPage)
router.get("/", ctrl.getNotesByQuery);
router.get("/:id", ctrl.getNoteById);
router.put("/:id", ctrl.updateNote);
router.patch("/:id/confirm-order",    ctrl.confirmOrder);
router.patch("/:id/blood-monitoring", ctrl.addBloodMonitoring);
router.patch("/:id/blood-status",     ctrl.updateBloodStatus);
router.delete("/:id", ctrl.deleteNote);

module.exports = router;
