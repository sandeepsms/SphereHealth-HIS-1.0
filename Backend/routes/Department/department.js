const express = require("express");
const router = express.Router();
const departmentController = require("../../controllers/Department/department");

// Basic CRUD operations
router.post("/", departmentController.createDepartment);
router.get("/", departmentController.getAllDepartments);
router.get("/stats", departmentController.getDepartmentStats);
router.get("/search", departmentController.searchDepartments);
router.get("/active", departmentController.getActiveDepartments);
router.get("/opd", departmentController.getOPDDepartments);
router.get("/ipd", departmentController.getIPDDepartments);
router.get("/emergency", departmentController.getEmergencyDepartments);
router.get(
  "/category/:category",
  departmentController.getDepartmentsByCategory
);
router.get("/code/:code", departmentController.getDepartmentByCode);
router.get("/:id", departmentController.getDepartmentById);
router.put("/:id", departmentController.updateDepartment);
router.delete("/:id", departmentController.deleteDepartment);

// HOD management
router.post("/:id/hod", departmentController.assignHOD);
router.delete("/:id/hod", departmentController.removeHOD);

module.exports = router;
