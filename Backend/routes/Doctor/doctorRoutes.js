const express = require("express");
const router = express.Router();
const doctorController = require("../../controllers/Doctor/doctorController");

router.post("/", doctorController.createDoctor);
router.get("/", doctorController.getAllDoctors);
router.get("/active", doctorController.getActiveDoctors);
router.get("/search", doctorController.searchDoctors);
router.get("/department/:department", doctorController.getDoctorsByDepartment);
router.get(
  "/specialization/:specialization",
  doctorController.getDoctorsBySpecialization
);
router.get("/experience", doctorController.getDoctorsByExperience);

router.get("/:doctorId", doctorController.getDoctorById);
router.put("/:doctorId", doctorController.updateDoctor);
router.delete("/:doctorId", doctorController.deleteDoctor);
router.put(
  "/:doctorId/consultation-fee",
  doctorController.updateConsultationFee
);
router.get("/:doctorId/stats", doctorController.getDoctorStats);

module.exports = router;
