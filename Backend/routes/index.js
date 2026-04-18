const express = require("express");
const router = express.Router();

// ── Auth ──────────────────────────────────────────────────────
const authRoutes = require("./Auth/authRoutes");
const userRoutes = require("./User/userRoutes");

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

const admissionRoutes = require("./Patient/admissionRoutes"); // ✅ Existing admission system
const doctorPrescriptionRoutes = require("../routes/Doctor/doctorPrescriptionRoutes");

// ── Department & Support ──────────────────────────────────────
const departmentRoutes = require("./Department/department");

// ── TPA & Billing ─────────────────────────────────────────────
const tpaRoutes = require("./tpa/tpaRoutes");
const tpaServiceRoutes = require("./tpa/tpaServiceRoutes");
const TPAServicebill = require("./Billing/TPAServiceBilling");
const hospitalChargesRoutes = require("../routes/charges/hospitalChargesRoutes");

// ── New Billing System (billing-v3) ───────────────────────────

const serviceMasterRoutes = require("../routes/ServiceMasterRoute/serviceMasterRoutes");
const newBillingRoutes = require("./Billing/billingRoutes");

const investigationRoutes = require("./Investigation/Investigationmasterroutes");
const investigationOrderRoutes = require("./Investigation/investigationOrderRoutes");

const nurseRoutes=require("./Nurse/nurseNotesRoutes");
const nurseStaffRoutes = require("./Nurse/nurseStaffRoutes");
const doctorNotesRoutes = require("./Doctor/doctorNotesRoutes");
const nursingChargesRoutes = require("./nursing/nursingChargesRoutes");
const hospitalSettingsRoutes = require("../routes/hospitalSettingsRoutes");

// ── Phase 1: NABH Paperless Modules ──────────────────────────
const dischargeSummaryRoutes = require("./Clinical/dischargeSummaryRoutes");
const consentFormRoutes = require("./Clinical/consentFormRoutes");
const nursingCarePlanRoutes = require("./Nurse/nursingCarePlanRoutes");
const marRoutes = require("./Clinical/marRoutes");

// ═════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═════════════════════════════════════════════════════════════

// Auth & Users
router.use("/auth", authRoutes);
router.use("/users", userRoutes);

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
router.use("/nurse-notes",nurseRoutes);
router.use("/nurse-staff", nurseStaffRoutes);
router.use("/doctor-notes", doctorNotesRoutes);

router.use("/admissions", admissionRoutes);

router.use("/prescriptions", doctorPrescriptionRoutes);

// Department & Support
router.use("/department", departmentRoutes);

// TPA & Old Billing
router.use("/tpa", tpaRoutes);
router.use("/tpaservice", tpaServiceRoutes);
router.use("/servicebilldata", TPAServicebill);
router.use("/hospital-charges", hospitalChargesRoutes);

// New Billing System (billing-v3)
router.use("/services", serviceMasterRoutes);
router.use("/billing", newBillingRoutes);

// nursing-notes alias (NABH Initial Assessment page uses /api/nursing-notes)
router.use("/nursing-notes", nurseRoutes);

router.use("/investigations", investigationRoutes);
router.use("/investigation-orders", investigationOrderRoutes);

// Phase 1: NABH Paperless Modules
router.use("/discharge-summary", dischargeSummaryRoutes);
router.use("/consent-forms", consentFormRoutes);
router.use("/nursing-care-plans", nursingCarePlanRoutes);
router.use("/mar", marRoutes);
router.use("/nursing-charges", nursingChargesRoutes);
router.use("/hospital-settings", hospitalSettingsRoutes);

module.exports = router;
