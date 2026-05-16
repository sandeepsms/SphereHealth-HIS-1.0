// Nurse/routes/nurseStaffRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/Nurse/NurseStaffController");

router.post("/", ctrl.create);
router.get("/", ctrl.getAll);
router.get("/department/:deptId", ctrl.getByDepartment);
router.get("/:id", ctrl.getById);
router.put("/:id", ctrl.update);
router.patch("/:id/toggle-status", ctrl.toggleStatus);
router.delete("/:id", ctrl.remove);

module.exports = router;
