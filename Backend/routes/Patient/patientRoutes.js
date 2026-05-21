// routes/Patient/patientRoutes.js
const express = require("express");
const router = express.Router();
const patientController = require("../../controllers/Patient/patientController");
const { authenticate, requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

// ✅ IMPORTANT: /search route ko specific routes se PEHLE rakhna zaroori hai
// warna /:id usse capture kar lega

// Note: this entire router is mounted behind the global `authenticate`
// middleware in Backend/routes/index.js, so req.user is always present
// when these handlers run.

// R7bb-B/D4-CRIT-S1: every GET on /api/patients now requires `patient.read`
// (mirror of frontend gate). Pre-R7bb any authenticated user — Pharmacist /
// Ward Boy / Housekeeping / Security — could pull the full patient list or
// any UHID demographics + clinical fields.

// Search route - GET /api/patients/search?q=rahul&limit=10
router.get("/search", requireAction("patient.read"), patientController.searchPatients);

// Stats route
router.get("/stats", requireAction("patient.read"), patientController.getPatientStats);

// UHID se patient dhundho
router.get("/uhid/:uhid", requireAction("patient.read"), patientController.getPatientByUHID);

// TPA patients
router.get("/tpa/:tpaId", requireAction("patient.read"), patientController.getPatientsByTPA);

// CRUD routes
router.get("/", requireAction("patient.read"), patientController.getAllPatients);
router.post("/", requireAction("reception.register"), patientController.createPatient);
router.get("/:id", validateObjectIdParam("id"), requireAction("patient.read"), patientController.getPatientById);
// PUT split into two actions in the controller. The route itself accepts any
// authenticated user; the controller redirects clinical-field edits
// (bloodGroup, knownAllergies, dateOfBirth, gender) through the
// patient.write-clinical gate and demographic edits through
// patient.write-demographics. Both branches are enforced server-side.
router.put("/:id", validateObjectIdParam("id"), patientController.updatePatient);
router.delete("/:id", validateObjectIdParam("id"), requireAction("patient.delete"), patientController.deletePatient);

module.exports = router;
