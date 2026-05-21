const express = require("express");
const router = express.Router();
const userController = require("../../controllers/User/userController");
const { authenticate, requireAction } = require("../../middleware/auth");

/* All /users endpoints sit BELOW the global `authenticate` mount in
   routes/index.js, so req.user is always populated here. Each route
   now declares the action it requires; the central permissions map
   (Backend/config/permissions.js) decides which roles may pass.
   Today every users.* action is Admin-only, but that becomes a
   one-file change if HR/Receptionist roles ever need partial access. */

// ─── Read endpoints — Admin only ───────────────────────────────
router.get("/",                              requireAction("users.read"), userController.getAllUsers);
router.get("/stats",                         requireAction("users.read"), userController.getUserStats);
router.get("/search",                        requireAction("users.read"), userController.searchUsers);
router.get("/doctors",                       requireAction("users.read"), userController.getAllDoctors);
router.get("/nurses",                        requireAction("users.read"), userController.getAllNurses);
router.get("/doctors/specialization/:specialization", requireAction("users.read"), userController.getDoctorsBySpecialization);
router.get("/department/:departmentId",      requireAction("users.read"), userController.getStaffByDepartment);
router.get("/department/:departmentId/hod",  requireAction("users.read"), userController.getHOD);
router.get("/employee/:employeeId",          requireAction("users.read"), userController.getUserByEmployeeId);

// ─── Self-service password change (any authenticated user) ─────
// MUST be declared BEFORE the param routes — otherwise Express matches
// `/:id` first and runs updateUser with id="change-password". The
// controller reads req.user.id, so authentication is the only gate.
// R7bb-B/D4-HIGH-S1: gated on `users.change-password-self` so the audit
// map has an explicit token for the surface (the action permits every
// role, mirroring "any authenticated user" — but the explicit gate keeps
// the route grep-able alongside the other users.* permissions).
router.put("/change-password",               authenticate, requireAction("users.change-password-self"), userController.changePassword);

// ─── Read-by-id ────────────────────────────────────────────────
router.get("/:id",                           requireAction("users.read"), userController.getUserById);

// ─── Write endpoints — Admin only ──────────────────────────────
router.post("/",                             requireAction("users.write"),          userController.createUser);
router.post("/hod/assign",                   requireAction("users.write"),          userController.assignHOD);
router.put("/:id",                           requireAction("users.write"),          userController.updateUser);
router.put("/:id/deactivate",                requireAction("users.deactivate"),     userController.deactivateUser);
router.put("/:id/activate",                  requireAction("users.deactivate"),     userController.activateUser);
// R7bb-FIX-A-10/D10-CRIT-2: dedicated terminate endpoint. Gated on the
// same permission token as deactivate — both are HR write surfaces.
router.put("/:id/terminate",                 requireAction("users.deactivate"),     userController.terminateUser);
router.put("/:id/reset-password",            requireAction("users.reset-password"), userController.adminResetPassword);
router.patch("/:id/signature",               requireAction("users.signature"),      userController.adminSetSignature);

module.exports = router;
