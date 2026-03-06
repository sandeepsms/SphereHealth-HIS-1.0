// routes/Patient/patientRoutes.js
const express = require("express");
const router = express.Router();
const patientController = require("../../controllers/Patient/patientController");

// ✅ IMPORTANT: /search route ko specific routes se PEHLE rakhna zaroori hai
// warna /:id usse capture kar lega

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
router.post("/", patientController.createPatient);
router.get("/:id", patientController.getPatientById);
router.put("/:id", patientController.updatePatient);
router.delete("/:id", patientController.deletePatient);

module.exports = router;
