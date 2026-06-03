const express = require("express");
const router = express.Router();
const departmentController = require("../../controllers/Department/department");
const { requireAction } = require("../../middleware/auth");
const { validateObjectIdParam } = require("../../utils/queryGuards");

// ─── Reads — many roles (sidebar, doctor picker, etc. need this) ─
router.get("/",                       requireAction("departments.read"), departmentController.getAllDepartments);
router.get("/stats",                  requireAction("departments.read"), departmentController.getDepartmentStats);
router.get("/search",                 requireAction("departments.read"), departmentController.searchDepartments);
router.get("/active",                 requireAction("departments.read"), departmentController.getActiveDepartments);
router.get("/opd",                    requireAction("departments.read"), departmentController.getOPDDepartments);
router.get("/ipd",                    requireAction("departments.read"), departmentController.getIPDDepartments);
router.get("/emergency",              requireAction("departments.read"), departmentController.getEmergencyDepartments);
router.get("/category/:category",     requireAction("departments.read"), departmentController.getDepartmentsByCategory);
router.get("/code/:code",             requireAction("departments.read"), departmentController.getDepartmentByCode);
router.get("/:id",                    validateObjectIdParam("id"), requireAction("departments.read"), departmentController.getDepartmentById);

// ─── Writes — Admin only ─────────────────────────────────────
router.post("/",                      requireAction("departments.write"), departmentController.createDepartment);
router.put("/:id",                    validateObjectIdParam("id"), requireAction("departments.write"), departmentController.updateDepartment);
router.delete("/:id",                 validateObjectIdParam("id"), requireAction("departments.write"), departmentController.deleteDepartment);
router.post("/:id/hod",               validateObjectIdParam("id"), requireAction("departments.write"), departmentController.assignHOD);
router.delete("/:id/hod",             validateObjectIdParam("id"), requireAction("departments.write"), departmentController.removeHOD);

module.exports = router;
