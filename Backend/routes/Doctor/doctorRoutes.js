const express = require("express");
const router = express.Router();
const doctorController = require("../../controllers/Doctor/doctorController");
const { authenticate, requireAction } = require("../../middleware/auth");

// ─── Reads — Admin / Receptionist / Doctor / Nurse (per ACTIONS) ─
router.get("/",                                requireAction("doctors.read"), doctorController.getAllDoctors);
router.get("/active",                          requireAction("doctors.read"), doctorController.getActiveDoctors);
router.get("/search",                          requireAction("doctors.read"), doctorController.searchDoctors);

// Doctor profile for the logged-in user (role=Doctor). Controller scopes
// to req.user.id so a Doctor only gets their own row.
// R7bb-FIX-C-15/D4-MED-3: now gated on its own `doctor.self.read` action
// (Admin / Doctor) instead of borrowing the write gate. Audit-grep finds
// the read surface independently from the availability / serve-next
// write surface — they are different operations on different rows.
router.get("/me",                              authenticate, requireAction("doctor.self.read"), doctorController.getMyDoctorProfile);

router.get("/department/:department",          requireAction("doctors.read"), doctorController.getDoctorsByDepartment);
router.get("/specialization/:specialization",  requireAction("doctors.read"), doctorController.getDoctorsBySpecialization);
router.get("/experience",                      requireAction("doctors.read"), doctorController.getDoctorsByExperience);
router.get("/dashboard/queues",                requireAction("doctors.read"), doctorController.getDashboardQueues);
router.get("/:doctorId",                       requireAction("doctors.read"), doctorController.getDoctorById);
router.get("/:doctorId/stats",                 requireAction("doctors.read"), doctorController.getDoctorStats);

// ─── Doctor-self availability (Doctor can update own state) ────
// Controller already validates that the caller owns this doctor record.
// R7az-A/D9-CRIT: pre-R7az these endpoints had NO action gate — any
// authenticated user (Pharmacist, Receptionist) could flip a doctor's
// availability or skip the queue. Now gated on doctor.self.write
// (Admin/Doctor). Controller still enforces "this is my record" so a
// Doctor can't flip someone else's availability.
router.patch("/:doctorId/availability", requireAction("doctor.self.write"), doctorController.setAvailability);
router.post ("/:doctorId/serve-next",   requireAction("doctor.self.write"), doctorController.serveNextToken);

// ─── Writes (master data) — Admin only ─────────────────────────
router.post("/",                               requireAction("doctors.write"), doctorController.createDoctor);
router.put("/:doctorId",                       requireAction("doctors.write"), doctorController.updateDoctor);
router.delete("/:doctorId",                    requireAction("doctors.write"), doctorController.deleteDoctor);
router.put("/:doctorId/consultation-fee",      requireAction("doctors.write"), doctorController.updateConsultationFee);

module.exports = router;
