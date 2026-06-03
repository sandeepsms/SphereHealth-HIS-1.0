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
const { validateObjectIdParam } = require("../../utils/queryGuards");

// B7-T03: ObjectId param guards — reject malformed :id / :tpaId / :serviceId
// at the edge so controllers don't blow up with CastError → 500.
const vId        = validateObjectIdParam("id");
const vTpaId     = validateObjectIdParam("tpaId");
const vServiceId = validateObjectIdParam("serviceId");

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
router.get   ("/stats/:tpaId",                       vTpaId, requireAction("billing.read"),      tpaServiceController.getTPAServiceStats);

// Get TPA Service by TPA ID
router.get   ("/tpa/:id",                            vId, requireAction("billing.read"),      tpaServiceController.getTPAServiceById);

// Get TPA Services by TPA ID (alternative)
router.get   ("/by-tpa/:tpaId",                      vTpaId, requireAction("billing.read"),      tpaServiceController.getTPAServicesByTPAId);

// Update TPA Service
router.put   ("/:id",                                vId, requireAction("departments.write"), tpaServiceController.updateTPAService);

// Delete TPA Service
router.delete("/:id",                                vId, requireAction("departments.write"), tpaServiceController.deleteTPAService);

// Add single service
router.post  ("/:id/add-service",                    vId, requireAction("departments.write"), tpaServiceController.addService);

// Remove service
router.delete("/:id/service/:serviceId",             vId, vServiceId, requireAction("departments.write"), tpaServiceController.removeService);

// Toggle active status
router.patch ("/:id/toggle-status",                  vId, requireAction("departments.write"), tpaServiceController.toggleActiveStatus);

module.exports = router;
