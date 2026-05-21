// R7au-FIX-12/D3-HIGH: equipment-master CRUD gated. Pre-R7au any
// authenticated user could create / assign / return / service / retire
// equipment master rows — asset register integrity at risk. Writes
// require `ward.equipment` (Admin / Nurse / Ward Boy / Housekeeping);
// retire elevated to `ward.admin` (Admin only).
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Equipment/equipmentController");
const { requireAction } = require("../../middleware/auth");

// R7bb-B/D4-HIGH-S1: reads now gated on `ward.read` (Admin / Ward Boy /
// Nurse / Doctor / Housekeeping). Pre-R7bb any authenticated role could
// pull the full asset register — vendor / cost / serial / current-
// assignment data. Not PHI but operational + commercial-sensitive.
router.get   ("/",                  requireAction("ward.read"), ctrl.list);
router.get   ("/stats",             requireAction("ward.read"), ctrl.stats);
router.get   ("/service-due",       requireAction("ward.read"), ctrl.serviceDue);
router.get   ("/:id",               requireAction("ward.read"), ctrl.getOne);
router.post  ("/",                  requireAction("ward.equipment"), ctrl.create);
router.put   ("/:id",               requireAction("ward.equipment"), ctrl.update);
router.post  ("/:id/assign",        requireAction("ward.equipment"), ctrl.assign);
router.post  ("/:id/return",        requireAction("ward.equipment"), ctrl.return);
router.post  ("/:id/service",       requireAction("ward.equipment"), ctrl.logService);
router.delete("/:id",               requireAction("ward.admin"),     ctrl.retire);

module.exports = router;
