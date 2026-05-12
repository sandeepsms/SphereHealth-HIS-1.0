const express = require("express");
const router = express.Router();
const userController = require("../../controllers/User/userController");

router.post("/", userController.createUser);

router.get("/", userController.getAllUsers);

router.get("/stats", userController.getUserStats);

router.get("/search", userController.searchUsers);

router.get("/doctors", userController.getAllDoctors);

router.get("/nurses", userController.getAllNurses);

router.get(
  "/doctors/specialization/:specialization",
  userController.getDoctorsBySpecialization
);

router.get("/department/:departmentId", userController.getStaffByDepartment);

router.get("/department/:departmentId/hod", userController.getHOD);

router.post("/hod/assign", userController.assignHOD);

router.get("/employee/:employeeId", userController.getUserByEmployeeId);

// `/change-password` MUST be declared BEFORE the param routes — otherwise
// Express matches `/:id` first and runs updateUser with id="change-password".
router.put("/change-password", userController.changePassword);

router.get("/:id", userController.getUserById);

router.put("/:id", userController.updateUser);

router.put("/:id/deactivate", userController.deactivateUser);

router.put("/:id/activate", userController.activateUser);

router.put("/:id/reset-password", userController.adminResetPassword);

router.patch("/:id/signature", userController.adminSetSignature);

module.exports = router;
