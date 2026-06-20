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
// R7hr-113 — Paperless PROM/PREM survey routes (gates discharge finalize)
const promPremSurveyRoutes = require("./Clinical/promPremSurveyRoutes");
const nursingCarePlanRoutes = require("./Nurse/nursingCarePlanRoutes");
const nursingAssessmentsRoutes = require("./Nurse/nursingAssessmentsRoutes");
const assessmentComplianceRoutes = require("./Compliance/assessmentComplianceRoutes");
// Path is lowercase 'ai' — uppercase 'AI' folder was a Windows
// case-insensitive duplicate that shadowed this on case-sensitive
// Linux deploys, shipping the old stub instead of the real Groq impl.
const aiRoutes = require("./ai/aiRoutes");
const marRoutes = require("./Clinical/marRoutes");
const vitalSheetRoutes = require("./Vitals/vitalSheetRoutes");
const intakeOutputRoutes = require("./Clinical/intakeOutputRoutes"); // R7bq-3 — I/O ledger

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
  requirePasswordRotated,
  blockReadOnlyRoleWrites,
  blockNonClinicalForDoctorNurse,
  enforceActivePatientForClinicalWrites,
} = require("../middleware/auth");

router.use("/auth", authRoutes);

// ── R7bz — Client-error reports (anonymous-allowed, rate-limited) ──
// MUST mount BEFORE the global `authenticate` below, because React
// ErrorBoundaries often fire BEFORE auth resolves (login page crash,
// expired-token redirect mid-render, axios interceptor throw). The route
// uses `attemptAuth` internally to capture user identity when available
// but never rejects anonymous POSTs. POST is rate-limited per IP via
// clientErrorRateLimit. The two GET endpoints inside still gate
// themselves with requireAction("users.read") + attemptAuth chain, so
// they don't actually leak data to anonymous callers — they just don't
// hit the global JWT wall.
const { clientErrorRateLimit } = require("../middleware/rateLimitAuth");
router.use("/client-errors",    clientErrorRateLimit, require("./Admin/clientErrorRoutes"));

// ── R7dn: Pincode lookup (anonymous-allowed, rate-limited) ──
// Just postal data, not PHI. Mounted ABOVE the global authenticate
// gate so the reception registration form can fetch it before the
// receptionist has even saved the draft. Rate-limited at the route
// layer (60 lookups/min/IP).
router.use("/pincode", require("./Common/pincodeRoutes"));

// R7fs: hospital-settings GET is PUBLIC (login page + first-paint
// sidebar/header need hospital name+logo BEFORE the JWT exists).
// The route file scopes auth itself: GET = open, PUT = local
// authenticate + requireAction("settings.write").
router.use("/hospital-settings", hospitalSettingsRoutes);

// ── Everything below requires a valid JWT ────────────────────
router.use(authenticate);

// ── R7gw-B1-T07: forced password-rotation gate ───────────────
// authenticate() above already loads req.user.mustChangePassword from a
// fresh DB read (defense-in-depth). This mount turns that flag into actual
// enforcement: any POST/PUT/PATCH/DELETE from a user with the flag set
// returns 403 PASSWORD_RESET_REQUIRED. GETs and the /auth/change-password
// + /auth/password endpoints stay open so the lockout has an exit ramp.
router.use(requirePasswordRotated);

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
// R7hr-113 — Paperless PROM/PREM surveys. Discharge finalize gate consults
// /api/prom-prem-surveys?admissionId=X to confirm one signed PROM + one
// signed PREM exist before allowing the discharge to lock.
router.use("/prom-prem-surveys", promPremSurveyRoutes);
// R7fu — Medical Certificate surface (12 cert types: fitness, sick-leave,
// discharge-fitness, disability, vaccination, pre-employment, insurance-claim,
// sterilization, bedridden, medico-legal, cause-of-death, birth-notification).
router.use("/medical-certificates", require("./Clinical/medicalCertificateRoutes"));
router.use("/nursing-care-plans", nursingCarePlanRoutes);
router.use("/nursing-assessments", nursingAssessmentsRoutes);
// R7bn-5 / D6-fix: twice-daily compliance read API (used by the
// Nursing/Doctor Notes header to render OVERDUE / DUE_SOON badges).
router.use("/compliance", assessmentComplianceRoutes);
router.use("/ai", aiRoutes);
router.use("/mar", marRoutes);
router.use("/intake-output", intakeOutputRoutes); // R7bq-3 — fluid I/O ledger
router.use("/nursing-charges", nursingChargesRoutes);
// R7fs: hospital-settings now mounted above the global authenticate
// (see line ~107). Do NOT re-mount here — double mount would shadow
// the public GET with another authenticated copy.
router.use("/vitalsheet", vitalSheetRoutes);

// ── Patient File — Complete aggregator + activity feed ───────
router.use("/patient-file",     require("./Clinical/patientFileRoutes"));

// ── Patient History — chronological per-UHID OPD history +
// per-admission IPD file (ASC, day-grouped). Read-only views the
// new PatientHistoryViewPage at /patient-history-view/:uhid uses.
// Does NOT replace /patient-file/* (that surface still backs the
// existing CompletePatientFilePage).
router.use("/patient-history",  require("./Clinical/patientHistoryRoutes"));

// ── R7hr-229: admission-wide investigations aggregator (day-wise + trend
//    paragraph) for the discharge summary + Dr/Nurse "Investigations" tab.
router.use("/admission-investigations", require("./Clinical/admissionInvestigationsRoutes"));

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

// R7bz — Admin System Health diagnostics (DB stats, cron lock status,
// recent client errors, activity, integrity invariants). Read-only
// endpoint, admin-only. Backs Frontend/src/pages/admin/SystemHealthPage.jsx.
router.use("/admin",            require("./Admin/systemHealthRoutes"));

// R7en — Per-room-category daily-charges matrix. Mirrors R7dp's
// DoctorCharges pattern (one row per category, eight line items,
// half-day proration rule). The daily auto-billing cron resolves
// against this matrix instead of the legacy ServiceMaster BED-* /
// NURSING-* rows. Reads gated on billing.read, writes on doctors.write.
router.use("/admin/room-charges", require("./Admin/roomCategoryChargesRoutes"));

// (client-errors is mounted ABOVE the global authenticate — see top of file)

// R7bf-H: reports + dashboards surface (A6-CRIT + A6-HIGH coverage).
//   /hospital-register, /refunds, /today-revenue, /day-book, /gst-monthly,
//   /patient-census, /pharmacy-revenue-trend, /doctor-performance,
//   /bed-occupancy, /lab-tat, /inventory/abc-analysis, /ar-aging,
//   /daily-collection, /diagnosis-frequency
router.use("/reports",          require("./Reports/reportsRoutes"));

// Diabetic chart — RBS readings + sliding-scale insulin per admission
router.use("/diabetic-chart",   require("./Clinical/diabeticChartRoutes"));

// R7eg — ICU Bundles of Care (VAP / CAUTI / CLABSI / DVT / Sepsis / SUP).
// One sheet per (admissionId, date, shift). Auto-feeds the NABH HIC.5
// Infection-Control register via ClinicalAudit emit on finalize.
router.use("/icu-bundles",      require("./Clinical/icuBundleRoutes"));

// R7hr-184 — Invasive-device registry (intubation / catheter / cannula /
// lines). Doctor+Nurse place/change/remove with timestamps; drives ICU
// bundle applicability (no ET tube → VAP N/A, no Foley → CAUTI N/A).
router.use("/patient-devices",  require("./Clinical/patientDeviceRoutes"));

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
// R7bo — NABH compliance registers (RBS / Emergency / Blood Transfusion).
// Surveyors ask for these as chronological audit-grade logs; the registers
// are auto-populated from existing clinical flows via nabhRegisterEmitter.
router.use("/registers/nabh",        require("./Compliance/nabhRegisterRoutes"));
// R7gw-B9-T01 — NABH sentinel-event register (AAC.7 + MOM.4). Auto-emitted
// from HAPU stage III+ and fall-with-major-injury; manual entries allowed.
try {
  // eslint-disable-next-line global-require
  router.use("/nabh-registers/sentinel-events", require("./Compliance/nabhRegisters/sentineleventRegisterRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] sentinel-events mount failed:", e.message);
  }
}
// R7gw-B9-B9-T06 — NABH Hand Hygiene Compliance register (HIC.3). IC-officer
// driven observation log (WHO 5-Moments × role × technique). Manual-entry only.
try {
  // eslint-disable-next-line global-require
  router.use("/nabh-registers/handhygiene", require("./Compliance/nabhRegisters/handhygieneRegisterRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] handhygiene mount failed:", e.message);
  }
}
// R7gw-B9-T02 — NABH Near-Miss Event register (QPS.5). Manual-entry log
// of intercepted wrong-meds, prevented falls, caught equipment failures
// etc. Powers the QPS Committee's safety-culture trend chart.
try {
  // eslint-disable-next-line global-require
  router.use("/nabh-registers/near-miss-events", require("./Compliance/nabhRegisters/nearmisseventRegisterRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] near-miss-events mount failed:", e.message);
  }
}
// R7gw-B9-T04 — NABH Medication Error register (MOM.4). Auto-emit from
// MAR.administrationRecord.nurseError=true; severity E-I additionally
// chains to emitSentinelEvent. Manual entries allowed for compliance officer.
try {
  // eslint-disable-next-line global-require
  router.use("/nabh-registers/medicationerror", require("./Compliance/nabhRegisters/medicationerrorRegisterRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] medicationerror mount failed:", e.message);
  }
}
// R7gw-B9-B9-T07 — NABH LAMA / DAMA register (AAC.4). Auto-emit when a
// discharge is finalised with disposition === "LAMA"; manual POST for
// Compliance / MRD backfill.
try {
  // eslint-disable-next-line global-require
  router.use("/nabh-registers/lama", require("./Compliance/nabhRegisters/lamaRegisterRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] lama mount failed:", e.message);
  }
}
// R7gw-B9-B9-T03 — NABH Root Cause Analysis register (QPS.1 + AAC.7).
// Auto-pre-created from emitSentinelEvent (linkedSentinelId set, status
// Initiated). QPS chair / Quality Committee can POST a manual RCA for
// serious near-miss or recurrent-deviation triggers.
try {
  // eslint-disable-next-line global-require
  router.use("/rca-register", require("./Compliance/nabhRegisters/rcaRegisterRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] rca-register mount failed:", e.message);
  }
}
// R7gw-B9-T05 — NABH HAI Surveillance register (HIC.4). Auto-emitted from
// the ICU-bundle finalize path when CAUTI compliance <100, Foley dwell>3d
// and a positive UTI culture is present; manual POST for SSI / CDI /
// MRSA-bacteremia events surfaced from the lab feed.
try {
  // eslint-disable-next-line global-require
  router.use("/nabh-registers/hai-surveillance", require("./Compliance/nabhRegisters/haisurveillanceRegisterRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] hai-surveillance mount failed:", e.message);
  }
}
// R7gw-B10-T06 — NABH Facilities & Equipment Maintenance Log (FMS.5).
// Engineering / Biomedical / Facilities staff log PPM jobs, corrective
// tickets and AMC visits across BMS / Generator / Fire / Lift / Biomedical
// / HVAC / MedGas / UPS / Steam-Boiler. Manual entry only.
try {
  // eslint-disable-next-line global-require
  router.use("/nabh-registers/facilities-maintenance", require("./Compliance/nabhRegisters/facilities-maintenanceRegisterRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] facilities-maintenance mount failed:", e.message);
  }
}
// R7gw-B10-T02 — NABH MSO Session Log register (PRE.1). Manual-entry log
// of Medical Social Officer sessions (counseling / financial-aid /
// discharge-planning / bereavement / grievance / vulnerable-patient care).
try {
  // eslint-disable-next-line global-require
  router.use("/nabh-registers/mso-log", require("./Compliance/nabhRegisters/mso-logRegisterRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] mso-log mount failed:", e.message);
  }
}
// R7gw-B10-T07 — NABH Statutory Compliance register (AAC.16). Manual register
// of statutory licences (Hospital / Pharmacy / BloodBank / Fire-NOC /
// PCB-Consent / BMW-Authorisation / Atomic-Energy / PNDT / CTL / PRA /
// Drug-Licence / Lift-Inspection) with issue + expiry + renewal status.
try {
  // eslint-disable-next-line global-require
  router.use("/nabh-registers/statutory", require("./Compliance/nabhRegisters/statutoryRegisterRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] statutory mount failed:", e.message);
  }
}
// R7gw-B10-T03 — NABH ESG Compliance register (6th-ed Environment). Monthly
// facility Environmental / Social / Governance report — energy / water /
// diesel / waste / carbon-equivalent + green-initiatives + audit findings.
try {
  // eslint-disable-next-line global-require
  router.use("/nabh-registers/esg-compliance", require("./Compliance/nabhRegisters/esg-complianceRegisterRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] esg-compliance mount failed:", e.message);
  }
}
// R7gw-B10-T01 — NABH Antibiogram register (HIC.6). Periodic facility-level
// cumulative susceptibility report (organism × ward × sample-type × period)
// derived from microbiology isolates; powers the AMSC's empiric first-/
// second-line recommendation tables. Manual-entry by AMSC / IC officer.
try {
  // eslint-disable-next-line global-require
  router.use("/nabh-registers/antibiogram", require("./Compliance/nabhRegisters/antibiogramRegisterRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] antibiogram mount failed:", e.message);
  }
}
// R7gw-B10-T04 — NABH Staff Wellness Programme register (HRM.6). Manual
// register of staff-wellness sessions — annual health checks, vaccination
// drives, stress-management workshops, yoga / mindfulness, nutrition. HR /
// Wellness committee files each session row from the page UI.
try {
  // eslint-disable-next-line global-require
  router.use("/nabh-registers/wellness", require("./Compliance/nabhRegisters/wellnessRegisterRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] wellness mount failed:", e.message);
  }
}
// R7gw-B10-T05 — NABH PROM / PREM register (PRE.4 6th-ed). PRO officer
// or floor nurse files each survey administration (PROMIS / SF-36 / EQ-5D /
// HCAHPS / NHS-FFT / Custom-PREM) with domain scores + comments. Defaults
// to dischargeContext=true; can be flagged false for follow-up visits.
try {
  // eslint-disable-next-line global-require
  router.use("/nabh-registers/prom-prem", require("./Compliance/nabhRegisters/prom-premRegisterRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] prom-prem mount failed:", e.message);
  }
}
// R7en — ECG Register (NABH AAC.4 + IPSG.2 + COP.7). Manual + auto-emit
// from DoctorOrder (Investigation/ECG). Surveyor reads via dashboard-summary
// above; this mount is the write surface (entry + report + cardio review).
router.use("/ecg-register",          require("./Compliance/ecgRegisterRoutes"));
// R7du — Restraint Register write surface (NABH COP.17). Surveyor reads
// are served by /registers/nabh/restraint-register above; this surface
// is the nurse-side write path (POST + remove + monitor).
router.use("/restraints",            require("./Compliance/restraintRoutes"));
// R7eg — Clinical-audit roll-ups (NABH HIC.5 ICU bundle compliance, etc.).
// Aggregates ICUBundle + ClinicalAudit collections for the IC officer's
// register page (HIC5InfectionControlPage). Read-only, gated compliance.read.
router.use("/clinical-audit",        require("./Compliance/clinicalAuditRoutes"));

// ── R7bh-F6 — Accountant regulatory ────────────────────────────
// GSTR-1/3B exporter + Form 16A workflow. Both gated by tax.returns.*
// / tax.tds.* in Backend/config/permissions.js (Admin + Accountant).
router.use("/tax-returns", require("./Tax/taxReturnRoutes"));
router.use("/tds",         require("./Tax/tdsRoutes"));

// ── R7bh-F5 — Pharmacy cold-chain (file owned by F5) ───────────
// Mount only if the file exists so a partial F5 deploy doesn't crash
// boot here. If F5 ships the route file later, this picks it up on
// next restart.
try {
  // eslint-disable-next-line global-require
  router.use("/cold-chain", require("./Pharmacy/coldChainRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] cold-chain mount failed:", e.message);
  }
}

// ── R7bj — new module mounts (F1/F2/F6) ───────────────────────────
// Wired centrally by F10 with the try/catch fallback pattern so any
// module shipping partial files (route file present, controller still
// stubbed; or vice versa) doesn't crash boot. The catch only swallows
// the "module not found" case — a real implementation bug (syntax /
// require-chain explosion) still surfaces in the console.

// R7bj-F1 — physiotherapy plan + session register.
try {
  // eslint-disable-next-line global-require
  router.use("/physio", require("./Clinical/physioRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] physio mount failed:", e.message);
  }
}

// R7bj-F2 — kitchen indent (nurse → kitchen meal request workflow).
try {
  // eslint-disable-next-line global-require
  router.use("/kitchen-indent", require("./Pharmacy/kitchenIndentRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] kitchen-indent mount failed:", e.message);
  }
}

// R7bj-F2 — adverse food reactions register. Route file may not yet
// exist (F2 split deliverable); try/catch keeps boot clean either way.
try {
  // eslint-disable-next-line global-require
  router.use("/food-reactions", require("./Clinical/adverseFoodReactionRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] food-reactions mount failed:", e.message);
  }
}

// R7bj-F6 — biomedical waste transport manifest (NABH FMS / BMWM 2016).
try {
  // eslint-disable-next-line global-require
  router.use("/bmw-manifest", require("./Compliance/bmwManifestRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] bmw-manifest mount failed:", e.message);
  }
}

// R7bj-F6 — code response / rapid-response event log.
try {
  // eslint-disable-next-line global-require
  router.use("/code-response", require("./Compliance/codeResponseRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] code-response mount failed:", e.message);
  }
}

// R7bj-F6 — sharps-injury register (HCW needle-stick reporting).
try {
  // eslint-disable-next-line global-require
  router.use("/sharps-injury", require("./Clinical/sharpsInjuryRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] sharps-injury mount failed:", e.message);
  }
}

// NABH COP.10 — Procedure notes (post-op completion for OT-bound orders).
// Saving a note transitions the linked OTRegister row Scheduled → Completed
// so surveyors get evidence (actual procedure, complications, blood loss,
// specimens) for every completed surgery. Wrapped in try/catch to match the
// surrounding pattern — keeps boot clean even if a partial deploy lands.
try {
  // eslint-disable-next-line global-require
  router.use("/procedure-notes", require("./Clinical/procedureNoteRoutes"));
} catch (e) {
  if (!/Cannot find module/i.test(e.message || "")) {
    console.warn("[routes] procedure-notes mount failed:", e.message);
  }
}

module.exports = router;
