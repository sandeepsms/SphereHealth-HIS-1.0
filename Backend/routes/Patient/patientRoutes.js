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

// Search route - GET /api/patients/search?q=rahul&limit=10
router.get("/search", patientController.searchPatients);

// Stats route
router.get("/stats", patientController.getPatientStats);

// UHID se patient dhundho
router.get("/uhid/:uhid", patientController.getPatientByUHID);

// TPA patients
router.get("/tpa/:tpaId", patientController.getPatientsByTPA);

// CRUD routes
router.get("/", patientController.getAllPatients);
router.post("/", requireAction("reception.register"), patientController.createPatient);
router.get("/:id", validateObjectIdParam("id"), patientController.getPatientById);
// PUT split into two actions in the controller. The route itself accepts any
// authenticated user; the controller redirects clinical-field edits
// (bloodGroup, knownAllergies, dateOfBirth, gender) through the
// patient.write-clinical gate and demographic edits through
// patient.write-demographics. Both branches are enforced server-side.
router.put("/:id", validateObjectIdParam("id"), patientController.updatePatient);
router.delete("/:id", validateObjectIdParam("id"), requireAction("patient.delete"), patientController.deletePatient);

module.exports = router;
