// Nurse/routes/nurseNotesRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Nurse/nurseNotesController");
// R7az-A/D1-CRIT: reads + writes both action-gated. Pre-R7az reads were
// fully open (any logged-in role could browse the NABH IPSG.6 nursing
// trail by ipd / patient / today filter). Now `nurse-notes.read`
// (Admin/Doctor/Nurse/MRD) covers every GET, and `mar.write` remains on
// every mutation.
const { requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.get("/today/:ipdNo",                 requireAction("nurse-notes.read"), ctrl.getTodayNotes);
router.get("/patient/:patientId",           requireAction("nurse-notes.read"), ctrl.getNotesByPatient);
router.get("/ipd/:ipdNo",                   requireAction("nurse-notes.read"), ctrl.getNotesByIPD);
// Full patient nursing report (all notes + full module data, for print/PDF/insurance)
router.get("/report/:ipdNo",                requireAction("nurse-notes.read"), ctrl.getPatientReport);
router.post("/",                            requireAction("mar.write"),        ctrl.createNote);
// Query-param fallback: GET /nurse-notes?ipdNo=XXX (used by NursingNotesPage)
router.get("/",                             requireAction("nurse-notes.read"), ctrl.getNotesByQuery);
router.get("/:id",                          validateObjectIdParam("id"), requireAction("nurse-notes.read"), ctrl.getNoteById);
router.put("/:id",                          validateObjectIdParam("id"), requireAction("mar.write"),        ctrl.updateNote);
router.patch("/:id/confirm-order",          validateObjectIdParam("id"), requireAction("mar.write"),        ctrl.confirmOrder);
router.patch("/:id/blood-monitoring",       validateObjectIdParam("id"), requireAction("mar.write"),        ctrl.addBloodMonitoring);
router.patch("/:id/blood-status",           validateObjectIdParam("id"), requireAction("mar.write"),        ctrl.updateBloodStatus);
router.delete("/:id",                       validateObjectIdParam("id"), requireAction("mar.write"),        ctrl.deleteNote);

module.exports = router;
