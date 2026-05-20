// routes/tpa/tpaServiceRoutes.js
//
// R7au-FIX-12/D3-CRIT: TPA service master CRUD gated.
// Pre-R7au any authenticated user could rewrite cashless tariffs.
// Writes → `departments.write` (Admin only by default).
// Reads → `billing.read` so cashier/TPA desk can view rates.

const express = require("express");
const router = express.Router();
const tpaServiceController = require("../../controllers/tpa/TPAServicesController");
const { requireAction } = require("../../middleware/auth");

// Create TPA Service
router.post  ("/",                                   requireAction("departments.write"), tpaServiceController.createTPAService);

// Get all TPA Services
router.get   ("/",                                   requireAction("billing.read"),      tpaServiceController.getAllTPAServices);

// Search TPA Services
router.get   ("/search",                             requireAction("billing.read"),      tpaServiceController.searchTPAServices);

// Get all services (flattened)
router.get   ("/all-services",                       requireAction("billing.read"),      tpaServiceController.getAllServices);

// Get services by type
router.get   ("/type/:serviceType",                  requireAction("billing.read"),      tpaServiceController.getServicesByType);

// Get TPA Service stats
router.get   ("/stats/:tpaId",                       requireAction("billing.read"),      tpaServiceController.getTPAServiceStats);

// Get TPA Service by TPA ID
router.get   ("/tpa/:id",                            requireAction("billing.read"),      tpaServiceController.getTPAServiceById);

// Get TPA Services by TPA ID (alternative)
router.get   ("/by-tpa/:tpaId",                      requireAction("billing.read"),      tpaServiceController.getTPAServicesByTPAId);

// Update TPA Service
router.put   ("/:id",                                requireAction("departments.write"), tpaServiceController.updateTPAService);

// Delete TPA Service
router.delete("/:id",                                requireAction("departments.write"), tpaServiceController.deleteTPAService);

// Add single service
router.post  ("/:id/add-service",                    requireAction("departments.write"), tpaServiceController.addService);

// Remove service
router.delete("/:id/service/:serviceId",             requireAction("departments.write"), tpaServiceController.removeService);

// Toggle active status
router.patch ("/:id/toggle-status",                  requireAction("departments.write"), tpaServiceController.toggleActiveStatus);

module.exports = router;
