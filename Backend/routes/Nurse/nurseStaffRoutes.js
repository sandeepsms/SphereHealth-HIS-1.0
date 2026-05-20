// Nurse/routes/nurseStaffRoutes.js
//
// R7au-FIX-12/D3-HIGH: nurse-staff master CRUD gated on `users.write`
// (Admin only). Pre-R7au any authenticated user could mutate the
// nurse roster — duplicate identity surface alongside the User
// collection. Reads remain open so the duty roster can be displayed
// in ward dashboards.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Nurse/NurseStaffController");
const { requireAction } = require("../../middleware/auth");

router.post  ("/",                       requireAction("users.write"), ctrl.create);
router.get   ("/",                       ctrl.getAll);
router.get   ("/department/:deptId",     ctrl.getByDepartment);
router.get   ("/:id",                    ctrl.getById);
router.put   ("/:id",                    requireAction("users.write"), ctrl.update);
router.patch ("/:id/toggle-status",      requireAction("users.write"), ctrl.toggleStatus);
router.delete("/:id",                    requireAction("users.write"), ctrl.remove);

module.exports = router;
