const express = require("express");
const router = express.Router();

// ── Bed Management ────────────────────────────────────────────
const buildingRoutes = require("./bedMgmt/buildingRoutes");
const floorRoutes = require("./bedMgmt/floorRoutes");
const wardRoutes = require("./bedMgmt/wardRoutes");
const roomRoutes = require("./bedMgmt/roomRoutes");
const bedRoutes = require("./bedMgmt/bedRoutes");
const roomCategoryRoutes = require("./bedMgmt/roomCategoryRoutes");

// ── Patient & Clinical ────────────────────────────────────────
const patientRoutes = require("./Patient/patientRoutes");
const opdRoutes = require("./Patient/OPDRoutes");
const doctorRoutes = require("./Doctor/doctorRoutes");
const emergencyRoutes = require("./Patient/emergencyRoutes");
<<<<<<< HEAD
const admissionRoutes = require("./Patient/admissionRoutes");
=======
const admissionRoutes = require("./Patient/admissionRoutes"); // ✅ Existing admission system
>>>>>>> temp-fix
const doctorPrescriptionRoutes = require("../routes/Doctor/doctorPrescriptionRoutes");

// ── Department & Support ──────────────────────────────────────
const departmentRoutes = require("./Department/department");

// ── TPA & Billing ─────────────────────────────────────────────
const tpaRoutes = require("./tpa/tpaRoutes");
const tpaServiceRoutes = require("./tpa/tpaServiceRoutes");
const TPAServicebill = require("./Billing/TPAServiceBilling");
const hospitalChargesRoutes = require("../routes/charges/hospitalChargesRoutes");

// ── New Billing System (billing-v3) ───────────────────────────
<<<<<<< HEAD
const serviceMasterRoutes = require("../routes/ServiceMasterRoute/serviceMasterRoutes");
const newBillingRoutes = require("./Billing/billingRoutes");
=======
const serviceMasterRoutes = require("../routes/ServiceMasterRoute/serviceMasterRoutes"); // Service catalog + pricing
const newBillingRoutes = require("./Billing/billingRoutes"); // Bills, payments, TPA claims
>>>>>>> temp-fix

// ═════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═════════════════════════════════════════════════════════════

// Bed Management
router.use("/buildings", buildingRoutes);
router.use("/floors", floorRoutes);
router.use("/wards", wardRoutes);
router.use("/rooms", roomRoutes);
router.use("/bedss", bedRoutes);
router.use("/room-categories", roomCategoryRoutes);

// Patient & Clinical
router.use("/patients", patientRoutes);
router.use("/opd", opdRoutes);
router.use("/emergency", emergencyRoutes);
router.use("/doctors", doctorRoutes);
<<<<<<< HEAD
router.use("/admissions", admissionRoutes);
=======
router.use("/admissions", admissionRoutes); // ✅ Existing admission system — unchanged
>>>>>>> temp-fix
router.use("/prescriptions", doctorPrescriptionRoutes);

// Department & Support
router.use("/department", departmentRoutes);

// TPA & Old Billing
router.use("/tpa", tpaRoutes);
router.use("/tpaservice", tpaServiceRoutes);
router.use("/servicebilldata", TPAServicebill);
router.use("/hospital-charges", hospitalChargesRoutes);

// New Billing System (billing-v3)
<<<<<<< HEAD
router.use("/services", serviceMasterRoutes); // GET /api/services, POST /api/services/seed
router.use("/billing", newBillingRoutes); // GET /api/billing/uhid/:UHID, POST /api/billing/create
=======
router.use("/services", serviceMasterRoutes);
router.use("/billing", newBillingRoutes);
>>>>>>> temp-fix

module.exports = router;
