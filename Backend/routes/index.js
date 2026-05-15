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
const doctorOrderRoutes = require("./Doctor/doctorOrderRoutes");
const nursingChargesRoutes = require("./nursing/nursingChargesRoutes");
const hospitalSettingsRoutes = require("../routes/hospitalSettingsRoutes");

// ── Bed Transfer Workflow ────────────────────────────────────
const bedTransferRoutes = require("./Patient/bedTransferRoutes");

// ── Phase 1: NABH Paperless Modules ──────────────────────────
const dischargeSummaryRoutes = require("./Clinical/dischargeSummaryRoutes");
const consentFormRoutes = require("./Clinical/consentFormRoutes");
const nursingCarePlanRoutes = require("./Nurse/nursingCarePlanRoutes");
const nursingAssessmentsRoutes = require("./Nurse/nursingAssessmentsRoutes");
// Path is lowercase 'ai' — uppercase 'AI' folder was a Windows
// case-insensitive duplicate that shadowed this on case-sensitive
// Linux deploys, shipping the old stub instead of the real Groq impl.
const aiRoutes = require("./ai/aiRoutes");
const marRoutes = require("./Clinical/marRoutes");
const vitalSheetRoutes = require("./Vitals/vitalSheetRoutes");

// ═════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═════════════════════════════════════════════════════════════

// ── Auth shim ────────────────────────────────────────────────
// `/auth/*` is the only public surface (login, register, forgot-password).
// Every other mount below this line gets `authenticate` as a baseline so
// no controller is reachable by anonymous traffic. Individual routes can
// still demand specific roles via `authorize(...)`.
const { authenticate } = require("../middleware/auth");

router.use("/auth", authRoutes);

// ── Everything below requires a valid JWT ────────────────────
router.use(authenticate);

// ── Patient-file activity audit (auto-capture POST/PUT/PATCH/DELETE) ─
// Mounted right after authenticate so req.user is populated and BEFORE
// any feature router so every mutating call gets a chance to be logged
// to PatientActivityLog. Failures are async + soft — they never block
// the original request.
const activityLogger = require("../services/Clinical/activityLogger");
router.use(activityLogger.middleware());

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
router.use("/doctor-orders", doctorOrderRoutes);

router.use("/admissions", admissionRoutes);
router.use("/bed-transfers", bedTransferRoutes);

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
router.use("/nursing-assessments", nursingAssessmentsRoutes);
router.use("/ai", aiRoutes);
router.use("/mar", marRoutes);
router.use("/nursing-charges", nursingChargesRoutes);
router.use("/hospital-settings", hospitalSettingsRoutes);
router.use("/vitalsheet", vitalSheetRoutes);

// ── Patient File — Complete aggregator + activity feed ───────
router.use("/patient-file",     require("./Clinical/patientFileRoutes"));

// ── Roadmap A1–A5 + D14: patient-safety gates ────────────────
router.use("/safety",           require("./Clinical/safetyRoutes"));

// ── Roadmap E20: live SSE updates ────────────────────────────
router.use("/live-updates",     require("./Clinical/liveUpdatesRoutes"));

// ── Roadmap D16: per-action 2FA (OTP gate) ───────────────────
router.use("/2fa",              require("./Clinical/twoFactorRoutes"));

// ── Roadmap A2: Medication Reconciliation (NABH MOM.4d) ──────
router.use("/med-reconciliation", require("./Clinical/medReconciliationRoutes"));

// Live presence (who's serving whom)
router.use("/presence",         require("./Presence/presenceRoutes"));
// NABH visitor management
router.use("/visitor-passes",   require("./VisitorPass/visitorPassRoutes"));
// Appointment booking (OPD slot system)
router.use("/appointments",     require("./Appointment/appointmentRoutes"));
// Medico-Legal Cases — MLC reports + auto-generated MLR numbers per doctor
router.use("/mlc",              require("./MLC/mlcRoutes"));

// Admin operational endpoints — daily accrual, etc.
router.use("/admin-ops",        require("./Admin/adminOpsRoutes"));

// Diabetic chart — RBS readings + sliding-scale insulin per admission
router.use("/diabetic-chart",   require("./Clinical/diabeticChartRoutes"));

// Equipment inventory + homecare loan tracker + service history
router.use("/equipment",        require("./Equipment/equipmentRoutes"));

// Pharmacy — drug master, batches, GRN, dispense, sales register
router.use("/pharmacy",         require("./Pharmacy/pharmacyRoutes"));

// Dietician — diet plan templates + per-patient assessment & assigned plans
router.use("/dietitian",        require("./Clinical/dietitianRoutes"));

// Ward Boy — task board (transport / equipment / sample / errand)
router.use("/ward-tasks",       require("./Clinical/wardTaskRoutes"));

// Ward Operations — shift / equipment / supplies / code-blue / mortuary + manager
router.use("/ward-ops",         require("./Clinical/wardOpsRoutes"));

module.exports = router;
