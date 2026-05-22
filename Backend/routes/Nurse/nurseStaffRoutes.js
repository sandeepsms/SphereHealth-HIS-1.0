// Nurse/routes/nurseStaffRoutes.js
//
// R7au-FIX-12/D3-HIGH: nurse-staff master CRUD gated on `users.write`
// (Admin only). Pre-R7au any authenticated user could mutate the
// nurse roster — duplicate identity surface alongside the User
// collection.
//
// R7bb-FIX-C-1/S1 (D4): reads now gated too. The duty roster is read
// from ward dashboards by Admin / Doctor / Nurse / Receptionist
// (charge nurse + bed-board users need to know which nurse is on the
// floor). Same audience as `ipd.read`.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Nurse/NurseStaffController");
const { requireAction } = require("../../middleware/auth");
// R7bm-F9: 400 on a malformed :id before findById throws CastError -> 500.
const { validateObjectIdParam } = require("../../utils/queryGuards");

router.post  ("/",                       requireAction("users.write"), ctrl.create);
router.get   ("/",                       requireAction("ipd.read"),    ctrl.getAll);
router.get   ("/department/:deptId",     requireAction("ipd.read"),    ctrl.getByDepartment);
router.get   ("/:id",                    requireAction("ipd.read"),    ctrl.getById);
router.put   ("/:id",                    requireAction("users.write"), ctrl.update);
router.patch ("/:id/toggle-status",      requireAction("users.write"), ctrl.toggleStatus);
router.delete("/:id",                    validateObjectIdParam("id"), requireAction("users.write"), ctrl.remove);

module.exports = router;
