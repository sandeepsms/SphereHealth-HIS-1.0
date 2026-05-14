const express = require("express");
const router = express.Router();
const doctorController = require("../../controllers/Doctor/doctorController");
const { authenticate, requireAction } = require("../../middleware/auth");

// ─── Reads — Admin / Receptionist / Doctor / Nurse (per ACTIONS) ─
router.get("/",                                requireAction("doctors.read"), doctorController.getAllDoctors);
router.get("/active",                          requireAction("doctors.read"), doctorController.getActiveDoctors);
router.get("/search",                          requireAction("doctors.read"), doctorController.searchDoctors);

// Doctor profile for the logged-in user (role=Doctor) — must remain open
// to any authenticated user; controller scopes to req.user.id.
router.get("/me",                              authenticate, doctorController.getMyDoctorProfile);

router.get("/department/:department",          requireAction("doctors.read"), doctorController.getDoctorsByDepartment);
router.get("/specialization/:specialization",  requireAction("doctors.read"), doctorController.getDoctorsBySpecialization);
router.get("/experience",                      requireAction("doctors.read"), doctorController.getDoctorsByExperience);
router.get("/dashboard/queues",                requireAction("doctors.read"), doctorController.getDashboardQueues);
router.get("/:doctorId",                       requireAction("doctors.read"), doctorController.getDoctorById);
router.get("/:doctorId/stats",                 requireAction("doctors.read"), doctorController.getDoctorStats);

// ─── Doctor-self availability (Doctor can update own state) ────
// Controller already validates that the caller owns this doctor record.
// We still let Admin pass through. No higher gate needed here.
router.patch("/:doctorId/availability",        doctorController.setAvailability);
router.post("/:doctorId/serve-next",           doctorController.serveNextToken);

// ─── Writes (master data) — Admin only ─────────────────────────
router.post("/",                               requireAction("doctors.write"), doctorController.createDoctor);
router.put("/:doctorId",                       requireAction("doctors.write"), doctorController.updateDoctor);
router.delete("/:doctorId",                    requireAction("doctors.write"), doctorController.deleteDoctor);
router.put("/:doctorId/consultation-fee",      requireAction("doctors.write"), doctorController.updateConsultationFee);

module.exports = router;
