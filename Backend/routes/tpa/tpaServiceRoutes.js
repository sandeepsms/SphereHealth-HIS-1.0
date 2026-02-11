// routes/tpa/tpaServiceRoutes.js

const express = require("express");
const router = express.Router();
const tpaServiceController = require("../../controllers/tpa/TPAServicesController");

// Create TPA Service
router.post("/", tpaServiceController.createTPAService);

// Get all TPA Services
router.get("/", tpaServiceController.getAllTPAServices);

// Search TPA Services
router.get("/search", tpaServiceController.searchTPAServices);

// Get all services (flattened)
router.get("/all-services", tpaServiceController.getAllServices);

// Get services by type
router.get("/type/:serviceType", tpaServiceController.getServicesByType);

// Get TPA Service stats
router.get("/stats/:tpaId", tpaServiceController.getTPAServiceStats);

// Get TPA Service by TPA ID
router.get("/tpa/:id", tpaServiceController.getTPAServiceById);

// Get TPA Services by TPA ID (alternative)
router.get("/by-tpa/:tpaId", tpaServiceController.getTPAServicesByTPAId);

// Update TPA Service
router.put("/:id", tpaServiceController.updateTPAService);

// Delete TPA Service
router.delete("/:id", tpaServiceController.deleteTPAService);

// Add single service
router.post("/:id/add-service", tpaServiceController.addService);

// Remove service
router.delete("/:id/service/:serviceId", tpaServiceController.removeService);

// Toggle active status
router.patch("/:id/toggle-status", tpaServiceController.toggleActiveStatus);

module.exports = router;
