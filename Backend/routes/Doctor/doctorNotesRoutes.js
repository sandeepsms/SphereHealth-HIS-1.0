// Doctor/routes/doctorNotesRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Doctor/DoctorNotesController");
const { attemptAuth, requireAction } = require("../../middleware/auth");

// Soft-auth so signed-by / sign-action metadata is captured.
router.use(attemptAuth);

// R7q: doctor-orders.write gate covers writes to clinical doctor notes
// (same role set — Admin / Doctor). NABH MOI.1 requires doctor notes be
// authored only by attending clinicians.
router.get("/pending-orders/:ipdNo",  ctrl.getPendingOrders);
router.get("/patient/:patientId",     ctrl.getNotesByPatient);
router.get("/ipd/:ipdNo",             ctrl.getNotesByIPD);
router.post("/",                      requireAction("doctor-orders.write"), ctrl.createNote);
router.get("/:id",                    ctrl.getNoteById);
router.put("/:id",                    requireAction("doctor-orders.write"), ctrl.updateNote);
router.patch("/:id/sign",             requireAction("doctor-orders.write"), ctrl.signNote);
router.patch("/:id/diagnosis",        requireAction("doctor-orders.write"), ctrl.updateDiagnosis);
router.delete("/:id",                 requireAction("doctor-orders.write"), ctrl.deleteNote);

module.exports = router;
