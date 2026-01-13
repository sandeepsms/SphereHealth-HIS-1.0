const express = require("express");
const router = express.Router();

const patientController = require("../../controllers/Patient/patientController");

router.post("/", patientController.createPatient);
router.get("/", patientController.getAllPatients);
router.get("/stats", patientController.getPatientStats);
router.get("/uhid/:uhid", patientController.getPatientByUHID);
router.get("/:id", patientController.getPatientById);
router.put("/:id", patientController.updatePatient);
router.delete("/:id", patientController.deletePatient);

module.exports = router;
