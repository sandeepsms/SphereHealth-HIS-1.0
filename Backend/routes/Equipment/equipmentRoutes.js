// R7au-FIX-12/D3-HIGH: equipment-master CRUD gated. Pre-R7au any
// authenticated user could create / assign / return / service / retire
// equipment master rows — asset register integrity at risk.
//
// R7bb-FIX-C-1/S1 (D4-CRIT): swapped the action gates from the generic
// ward.* tokens (which also drive /api/ward-tasks + /api/ward-ops) to
// new explicit equipment.* tokens (`equipment.read`, `equipment.write`).
// Role sets are identical; the rename gives audit-grep an unambiguous
// row per surface so we can pull "every change to the asset register"
// without grep'ing through ward-task transitions.
const express = require("express");
const router  = express.Router();
const ctrl    = require("../../controllers/Equipment/equipmentController");
const { requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

// Reads — broad: any ward staff member needs to find a ventilator. Not
// PHI but operational + commercial-sensitive (vendor / cost / serial
// / current-assignment). Role set: Admin / Doctor / Nurse /
// Receptionist / Ward Boy / Housekeeping.
router.get   ("/",                  requireAction("equipment.read"), ctrl.list);
router.get   ("/stats",             requireAction("equipment.read"), ctrl.stats);
router.get   ("/service-due",       requireAction("equipment.read"), ctrl.serviceDue);
router.get   ("/:id",               validateObjectIdParam("id"), requireAction("equipment.read"), ctrl.getOne);
// Writes — Admin / Ward Boy / Nurse can create / assign / return /
// service. Retire still elevated to ward.admin (Admin only).
router.post  ("/",                  requireAction("equipment.write"), ctrl.create);
router.put   ("/:id",               validateObjectIdParam("id"), requireAction("equipment.write"), ctrl.update);
router.post  ("/:id/assign",        validateObjectIdParam("id"), requireAction("equipment.write"), ctrl.assign);
router.post  ("/:id/return",        validateObjectIdParam("id"), requireAction("equipment.write"), ctrl.return);
router.post  ("/:id/service",       validateObjectIdParam("id"), requireAction("equipment.write"), ctrl.logService);
router.delete("/:id",               validateObjectIdParam("id"), requireAction("ward.admin"),      ctrl.retire);

module.exports = router;
