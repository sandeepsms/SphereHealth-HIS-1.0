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
// R7ap-F20: CashierSession backend (replaces localStorage in ShiftTab)
const cashierSessionRoutes = require("./Billing/cashierSessionRoutes");

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
const {
  authenticate,
  blockReadOnlyRoleWrites,
  blockNonClinicalForDoctorNurse,
  enforceActivePatientForClinicalWrites,
} = require("../middleware/auth");

router.use("/auth", authRoutes);

// ── Everything below requires a valid JWT ────────────────────
router.use(authenticate);

// ── R7i: Read-only role write-blocker ────────────────────────
// Defense-in-depth for the MRD role. Rejects POST/PUT/PATCH/DELETE
// for read-only roles (currently just "MRD") with a 403 before any
// downstream router can run. This protects the existing 15+ clinical
// write endpoints that don't yet have per-action gates. Mounted
// AFTER authenticate (so req.user is populated) and BEFORE every
// feature router below (so it intercepts before the controller).
// Allow-list (audit logging) lives inside the middleware itself.
router.use(blockReadOnlyRoleWrites);

// ── R7az-A/D9-HIGH: Doctor/Nurse cannot POST money ──────────
// Even with mar.write etc, a Doctor or Nurse must not be able to
// record a payment, refund, void, advance write, settlement
// adjustment, or open/close a cashier session. Reads still flow
// through so the patient header keeps showing amount due. Mounted
// after authenticate so req.user is populated and before feature
// routers so it intercepts at the gateway.
router.use(blockNonClinicalForDoctorNurse);

// ── R7az-A/D9-HIGH-10: clinical writes on discharged admissions ─
// Block POST/PUT/PATCH on doctor-notes, nurse-notes, mar, vitals,
// consent-forms, discharge-summary when the linked admission has
// status === "Discharged". Header `X-Late-Entry: true` opens a
// narrow ADDENDUM path. 409 with code PATIENT_DISCHARGED otherwise.
router.use(enforceActivePatientForClinicalWrites);

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
router.use("/cashier-sessions", cashierSessionRoutes);   // R7ap-F20

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

// Admin "Mission Control" home — aggregate hospital-wide KPIs + feed
router.use("/admin-dashboard",  require("./Admin/adminDashboardRoutes"));

// R7bf-H: reports + dashboards surface (A6-CRIT + A6-HIGH coverage).
//   /hospital-register, /refunds, /today-revenue, /day-book, /gst-monthly,
//   /patient-census, /pharmacy-revenue-trend, /doctor-performance,
//   /bed-occupancy, /lab-tat, /inventory/abc-analysis, /ar-aging,
//   /daily-collection, /diagnosis-frequency
router.use("/reports",          require("./Reports/reportsRoutes"));

// Diabetic chart — RBS readings + sliding-scale insulin per admission
router.use("/diabetic-chart",   require("./Clinical/diabeticChartRoutes"));

// Equipment inventory + homecare loan tracker + service history
router.use("/equipment",        require("./Equipment/equipmentRoutes"));

// Pharmacy — drug master, batches, GRN, dispense, sales register
router.use("/pharmacy",         require("./Pharmacy/pharmacyRoutes"));
// R7bd-E-1 / A2-MED-16 — NDPS Schedule-X register (separate from
// Schedule H). Mounted under /api/pharmacy/schedule-x so the
// pharmacist's UI lives next to the rest of the pharmacy surface.
router.use("/pharmacy/schedule-x", require("./Pharmacy/scheduleXRoutes"));
// R7bd-E-2 / A2-MED-18 — pharmacy cycle-count / stock-take ledger.
router.use("/pharmacy/stock-take", require("./Pharmacy/stockTakeRoutes"));

// Nurse → Pharmacy drug indent workflow (raise / acknowledge / release / cancel).
// Mounted as /api/indents — kept separate from /pharmacy so a nurse with
// indent.raise but no pharmacy.dispense can still POST to it.
router.use("/indents",          require("./Pharmacy/indentRoutes"));

// Dietician — diet plan templates + per-patient assessment & assigned plans
router.use("/dietitian",        require("./Clinical/dietitianRoutes"));

// Ward Boy — task board (transport / equipment / sample / errand)
router.use("/ward-tasks",       require("./Clinical/wardTaskRoutes"));

// Ward Operations — shift / equipment / supplies / code-blue / mortuary + manager
router.use("/ward-ops",         require("./Clinical/wardOpsRoutes"));

// Housekeeping — cleaning task board + spillage + inventory + checklist + pest + manager
router.use("/housekeeping",     require("./Clinical/housekeepingRoutes"));

// R7bd-E-4 / A3-HIGH-9 — Microbiology multi-step appender. MOUNTED
// BEFORE the general /lab-records router so /api/lab-records/micro/*
// resolves here (rather than 404ing in Agent C's controller).
router.use("/lab-records/micro", require("./Lab/microRoutes"));
// Lab records — manual trend sheets + imaging / micro / histopath reports
router.use("/lab-records",      require("./Clinical/labRecordsRoutes"));

// Security — gate log + incident reports
router.use("/gate-log",         require("./Security/gateLogRoutes"));
router.use("/incidents",        require("./Security/incidentReportRoutes"));

// R7bb-FIX-E-12 / D6-HIGH-2: MRD retention review + file release.
router.use("/mrd",              require("./MRD/mrdRoutes"));

// R7bf-F / A4-CRIT-4: PrintAudit register — every reprint of a
// bill/receipt/lab-report writes a row here and atomically bumps
// the source entity's printCount. The frontend uses the returned
// count to render the DUPLICATE watermark on copies 2+.
router.use("/print-audit",      require("./Print/printAuditRoutes"));

// ── R7bf-G — NABH compliance scaffolds (A5-CRIT-1/4/5/6/7) ─────
// New register surfaces for critical-value alerts (AAC.6), ADR
// reporting (MOM.7), patient grievance redressal (PRE.6), staff
// credentialing (HRD.3), and fire-drill register (FMS.4). Each
// quartet (model + service + controller + routes) lives alongside
// the existing modules; mounts here in /api so the frontend pages
// just need an axios call.
router.use("/critical-value-alerts", require("./Clinical/criticalValueAlertRoutes"));
router.use("/adr-reports",           require("./Pharmacy/adrRoutes"));
router.use("/grievances",            require("./Quality/grievanceRoutes"));
router.use("/credentials",           require("./HR/credentialRoutes"));
router.use("/fire-drills",           require("./Compliance/fireDrillRoutes"));

module.exports = router;
