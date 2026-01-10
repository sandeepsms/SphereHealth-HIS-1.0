const express = require("express");
const router = express.Router();

// bed management
const buildingRoutes = require("./bedMgmt/buildingRoutes");
const floorRoutes = require("./bedMgmt/floorRoutes");
const wardRoutes = require("./bedMgmt/wardRoutes");
const roomRoutes = require("./bedMgmt/roomRoutes");
const bedRoutes = require("./bedMgmt/bedRoutes");
const roomCategoryRoutes = require("./bedMgmt/roomCategoryRoutes");
const serviceMasterRoutes = require("./bedMgmt/serviceMasterRoutes");

// other modules
const patientRoutes = require("./Patient/patientRoutes");
const opdRoutes = require("./patient/OPDRoutes");
const doctorRoutes = require("./Doctor/doctorRoutes");
const emergencyRoutes = require("./Patient/emergencyRoutes");
const billingRoutes = require("./Billing/billingRoutes");
const admissionRoutes = require("./patient/admissionRoutes");
const departmentRoutes = require("./Department/department");
const tpaRoutes = require("./tpa/tpaRoutes");

// routes mapping
router.use("/buildings", buildingRoutes);
router.use("/floors", floorRoutes);
router.use("/wards", wardRoutes);
router.use("/rooms", roomRoutes);
router.use("/bedss", bedRoutes);
router.use("/room-categories", roomCategoryRoutes);
router.use("/services", serviceMasterRoutes);

router.use("/patients", patientRoutes);
router.use("/opd", opdRoutes);
router.use("/emergency", emergencyRoutes);
router.use("/doctors", doctorRoutes);
router.use("/billing", billingRoutes);
router.use("/admissions", admissionRoutes);
router.use("/department", departmentRoutes);
router.use("/tpa", tpaRoutes);

module.exports = router;
