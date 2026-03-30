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
const admissionRoutes = require("./Patient/admissionRoutes");
const doctorPrescriptionRoutes = require("./Doctor/doctorPrescriptionRoutes");

// // ── Patient History ───────────────────────────────────────────
// const patientHistoryRoutes = require("./Patient/patientHistoryRoutes"); // ✅ NEW

// ── Doctor Notes ──────────────────────────────────────────────
const doctorNotesRoutes = require("./Doctor/doctorNotesRoutes"); // ✅ NEW

// ── Nurse ─────────────────────────────────────────────────────
const nurseStaffRoutes = require("./Nurse/nurseStaffRoutes"); // ✅ NEW
const nurseNotesRoutes = require("./Nurse/nurseNotesRoutes"); // ✅ NEW

// ── Department & Support ──────────────────────────────────────
const departmentRoutes = require("./Department/department");

// ── TPA & Billing ─────────────────────────────────────────────
const tpaRoutes = require("./tpa/tpaRoutes");
const tpaServiceRoutes = require("./tpa/tpaServiceRoutes");
const TPAServicebill = require("./Billing/TPAServiceBilling");
const hospitalChargesRoutes = require("./charges/hospitalChargesRoutes");

// ── New Billing System ────────────────────────────────────────
const serviceMasterRoutes = require("./ServiceMasterRoute/serviceMasterRoutes");
const newBillingRoutes = require("./Billing/billingRoutes");

// ── Investigation ─────────────────────────────────────────────
const investigationRoutes = require("./Investigation/investigationmasterRoutes");
const investigationOrderRoutes = require("./Investigation/investigationOrderRoutes");

const vitals = require("./Vitals/vitalSheetRoutes");
const shiftHandover = require("./Nurse/shiftHandoverRoutes");

// ═════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═════════════════════════════════════════════════════════════

// ── Bed Management ────────────────────────────────────────────
router.use("/buildings", buildingRoutes);
router.use("/floors", floorRoutes);
router.use("/wards", wardRoutes);
router.use("/rooms", roomRoutes);
router.use("/bedss", bedRoutes);
router.use("/room-categories", roomCategoryRoutes);

// ── Patient & Clinical ────────────────────────────────────────
router.use("/patients", patientRoutes);
router.use("/opd", opdRoutes);
router.use("/emergency", emergencyRoutes);
router.use("/doctors", doctorRoutes);
router.use("/admissions", admissionRoutes);
router.use("/prescriptions", doctorPrescriptionRoutes);

// // ── Patient History ───────────────────────────────────────────
// router.use("/patient-history", patientHistoryRoutes); // ✅ NEW

// ── Doctor Notes ──────────────────────────────────────────────
router.use("/doctor-notes", doctorNotesRoutes); // ✅ NEW

// ── Nurse ─────────────────────────────────────────────────────
router.use("/nurse-staff", nurseStaffRoutes); // ✅ NEW
router.use("/nurse-notes", nurseNotesRoutes); // ✅ NEW

// ── Department & Support ──────────────────────────────────────
router.use("/department", departmentRoutes);

// ── TPA & Old Billing ─────────────────────────────────────────
router.use("/tpa", tpaRoutes);
router.use("/tpaservice", tpaServiceRoutes);
router.use("/servicebilldata", TPAServicebill);
router.use("/hospital-charges", hospitalChargesRoutes);

// ── New Billing System ────────────────────────────────────────
router.use("/services", serviceMasterRoutes);
router.use("/billing", newBillingRoutes);

// ── Investigation ─────────────────────────────────────────────
router.use("/investigations", investigationRoutes);
router.use("/investigation-orders", investigationOrderRoutes);

// ── Vitals ─────────────────────────────────────────────────────
router.use("/vitals", vitals);
router.use("/shift-handovers", shiftHandover);

module.exports = router;
