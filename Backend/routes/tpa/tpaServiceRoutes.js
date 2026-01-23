// routes/tpa/tpaServiceRoutes.js
const express = require("express");
const router = express.Router();
const {
  createTPAService,
  getAllTPAServices,
  getTPAServiceById,
  getTPAServicesByTPAId,
  updateTPAService,
  deleteTPAService,
  addService,
  removeService,
  toggleActiveStatus,
} = require("../../controllers/tpa/TPAServicesController");

// Create TPA Service (with tests)
router.post("/", createTPAService);

// Get all TPA Services
router.get("/", getAllTPAServices);

// Get TPA Service by ID
router.get("/:id", getTPAServiceById);

// Get TPA Services by TPA ID
router.get("/tpa/:tpaId", getTPAServicesByTPAId);

// Update TPA Service
router.put("/:id", updateTPAService);

// Delete TPA Service
router.delete("/:id", deleteTPAService);

// Add single test to TPA Service
router.post("/:id/service", addService);

// Remove single test from TPA Service
router.delete("/:id/service/:serviceId", removeService);

// Toggle active status
router.patch("/:id/toggle-status", toggleActiveStatus);

module.exports = router;
