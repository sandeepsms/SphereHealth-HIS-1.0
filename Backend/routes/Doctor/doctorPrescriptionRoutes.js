const express = require("express");
const router = express.Router();
const prescriptionController = require("../../controllers/Doctor/prescriptionController");

// router.post("/", prescriptionController.createPrescription);////////////////
router.post("/uhid/:uhid", prescriptionController.createPrescription);
router.get("/checkByuhid/:uhid", prescriptionController.checkCreateOrUpdate);

router.get("/", prescriptionController.getAllPrescriptions);
router.get("/:id", prescriptionController.getPrescriptionById);
router.get("/uhid/:uhid", prescriptionController.getPrescriptionsByUHID);
router.put("/:id", prescriptionController.updatePrescription);
router.delete("/:id", prescriptionController.deletePrescription);


module.exports = router;
