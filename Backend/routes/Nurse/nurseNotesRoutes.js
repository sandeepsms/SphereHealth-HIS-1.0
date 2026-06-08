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
// R7hr-156 — GET /report/:ipdNo removed. The Patient File / Complete File
// print endpoint serves the same insurance / NABH audit need from a single
// source of truth; the parallel "Print / PDF Report" surface in Nursing
// Notes (and its controller method getPatientReport) were retired.
router.post("/",                            requireAction("mar.write"),        ctrl.createNote);
// Query-param fallback: GET /nurse-notes?ipdNo=XXX (used by NursingNotesPage)
router.get("/",                             requireAction("nurse-notes.read"), ctrl.getNotesByQuery);
router.get("/:id",                          validateObjectIdParam("id"), requireAction("nurse-notes.read"), ctrl.getNoteById);
router.put("/:id",                          validateObjectIdParam("id"), requireAction("mar.write"),        ctrl.updateNote);
router.patch("/:id/confirm-order",          validateObjectIdParam("id"), requireAction("mar.write"),        ctrl.confirmOrder);
router.patch("/:id/blood-monitoring",       validateObjectIdParam("id"), requireAction("mar.write"),        ctrl.addBloodMonitoring);
router.patch("/:id/blood-status",           validateObjectIdParam("id"), requireAction("mar.write"),        ctrl.updateBloodStatus);
// R7hr-72-A2 — post-submission amendment (NABH HIC.7). Guarded by the
// dedicated nurse.write action (Admin + Nurse only) — author + admin
// override is enforced inside the service. Discharged-admission write
// gate is already covered by the existing POST /\/nurse-notes(\/|$|\?)/
// rule in middleware/auth.js.
router.post("/:id/amend",                   validateObjectIdParam("id"), requireAction("nurse.write"),      ctrl.amendNote);
router.delete("/:id",                       validateObjectIdParam("id"), requireAction("mar.write"),        ctrl.deleteNote);

module.exports = router;
