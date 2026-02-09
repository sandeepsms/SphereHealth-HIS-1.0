const express = require("express");
const router = express.Router();

const hospitalChargesController = require("../../controllers/charges/hospitalChargesController");

// Create hospital charges
router.post("/create", hospitalChargesController.createHospitalCharges);

// Get all hospital charges (search, isActive supported)
router.get("/", hospitalChargesController.getAllHospitalCharges);

router.get("/document/:id", hospitalChargesController.getHospitalChargesById); // PEHLE
router.get("/tpa/:tpaId", hospitalChargesController.getHospitalChargesByTPA);

// Update hospital charges
router.put("/:id", hospitalChargesController.updateHospitalCharges);

// Delete hospital charges
router.delete("/:id", hospitalChargesController.deleteHospitalCharges);

// Toggle active / inactive
router.patch(
  "/:id/toggle-status",
  hospitalChargesController.toggleActiveStatus,
);

module.exports = router;
