import React, { useState, lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import "./App.css";
import "bootstrap/dist/css/bootstrap.css";

// ── Eager-loaded shell (always needed) ──────────────────────────
import Sidebar from "./Components/Sidebar";
import Header from "./Components/Header";
import { AuthProvider, useAuth, RoleGuard } from "./context/AuthContext";
import { HospitalSettingsProvider } from "./context/HospitalSettingsContext";

// PrimeReact CSS
import "primereact/resources/themes/lara-light-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";

// ── Critical paths (eager) — login + dashboard + main ───────────
import LoginPage from "./pages/auth/LoginPage";
import MainPage from "./pages/mainPage/MainPage";
import Dashboard1 from "./pages/patient/Dashboard";

// ── Lazy-loaded pages (downloaded on-demand) ────────────────────
// PatientsTable deleted 2026-05-17 — superseded by PatientLookupPage's
// "directory" view. The /allpatient route now mounts PatientLookupPage.
const Servicebtn = lazy(() => import("./Components/Servicebtn"));
const OPDPrint = lazy(() => import("./pages/OPD/OPDPrint"));
const ServiceAlldata = lazy(() => import("./Components/ServiceAlldata"));
const DepartmentManagement = lazy(() => import("../src/pages/Department/DepartmentManagement"));

// Bed Management
const BedManagement = lazy(() => import("./pages/BedManagement"));
const RoomManagement = lazy(() => import("./pages/RoomManagement"));
const WardManagement = lazy(() => import("./pages/WardManagement"));
const BuildingManagement = lazy(() => import("./pages/BuildingManagement"));
const FloorManagement = lazy(() => import("./pages/FloorManagement"));
const BedVisualLayout = lazy(() => import("./Components/bed/BedVisualLayout"));
const BedDashboard = lazy(() => import("./pages/bed/BedDashboard"));
const PrintRouterPage = lazy(() => import("./pages/print/PrintRouterPage"));
const PrintGalleryPage = lazy(() => import("./pages/print/PrintGalleryPage"));
const BedTransfersListPage = lazy(() => import("./pages/bed/BedTransfersListPage"));
const BedMonthlyReportPage = lazy(() => import("./pages/bed/BedMonthlyReportPage"));

// Patients
const PatientList = lazy(() => import("./pages/patient/PatientList"));
const PatientForm = lazy(() => import("./pages/patient/PatientForm"));
const PatientDetails = lazy(() => import("./pages/patient/PatientDetails"));

// OPD
const OPList = lazy(() => import("./pages/OPD/OPDList"));
const OPDDetails = lazy(() => import("./pages/OPD/OPDDetails"));

// Emergency
const Emergencylist = lazy(() => import("./pages/emergency/EmergencyList"));
const EmergencyDetails = lazy(() => import("./pages/emergency/EmergencyDetails"));
const EmergencyAssessmentPage = lazy(() => import("./pages/emergency/EmergencyAssessmentPage"));

// Doctors
const DoctorFormPage = lazy(() => import("./pages/doctor/DoctorFormPage"));
const DoctorListPage = lazy(() => import("./pages/doctor/DoctorListPage"));

// TPA & Services
const ServiceAdd = lazy(() => import("./Components/Tpa/TPAServiceManagement"));
const AddTpa = lazy(() => import("./Components/Tpa/AddTpa"));
const AddRoomCategory = lazy(() => import("./Components/room/AddRoomCategory"));

// Hospital Charges
const HospitalChargesList = lazy(() => import("./pages/charges/HospitalChargesList"));
const CreateHospitalCharges = lazy(() => import("./pages/charges/CreateHospitalCharges"));
const EditHospitalCharges = lazy(() => import("./pages/charges/EditHospitalCharges"));

// R7ah: BillsList, BillGeneration, PatientBilling lazy imports removed
// — their routes (/billing, /billing/create/..., /patient-billing, etc.)
// were dropped in favour of /reception-billing + /billing/ipd.

const ServiceMasterManager = lazy(() => import("./Components/ServiceMaster/ServiceMasterManager"));
// R7dp — Bulk doctor-charges editor (per-doctor OPD First / Follow-up / ER /
// MLC / IPD cross-consult). Admin + Accountant only.
const DoctorChargesPage = lazy(() => import("./pages/admin/DoctorChargesPage"));
// R7en — Per-room-category daily-charges matrix (bed rent, nursing,
// doctor visit, RMO, monitoring, dietetics, housekeeping, linen).
// Source of truth for the daily auto-billing cron. Admin + Accountant only.
const RoomChargesPage = lazy(() => import("./pages/admin/RoomChargesPage"));
const ChargeableServices = lazy(() => import("./pages/services/ChargeableServices"));
// BillingIntelligencePage removed — receptionist Billing Counter is now
// the single billing surface; AI suggestions are no longer auto-applied.
const BillingAuditTrailPage = lazy(() => import("./pages/billing/BillingAuditTrailPage"));
// IPD / Day-Care live billing ledger — admission → discharge per-charge view
// with undo (15-min) / override / cancel actions gated by role.
const IPDBillingLedger = lazy(() => import("./pages/billing/IPDBillingLedger"));
// Nurse → Pharmacy indent workflow
const IndentRaisePage     = lazy(() => import("./pages/nursing/IndentRaisePage"));
const PharmacyIndentsPage = lazy(() => import("./pages/pharmacy/PharmacyIndentsPage"));

// Vitals
const UpdateVitalSheet = lazy(() => import("./Components/vital/UpdateVitalSheet"));
const VitalSheet = lazy(() => import("./Components/vital/VitalSheet"));
const VitalsView = lazy(() => import("./Components/vital/VitalsView"));

// Nursing (heavy form pages)
const NursingNotes = lazy(() => import("./pages/nursing/NursingNotes"));
const NursingHandoverNotes = lazy(() => import("./pages/nursing/NursingHandoverNotes"));
const NurseInitialAssessmentPage = lazy(() => import("./pages/nursing/NurseInitialAssessmentPage"));
const NursingCarePlanPage = lazy(() => import("./pages/nursing/NursingCarePlanPage"));
const FallRiskAssessmentPage = lazy(() => import("./pages/nursing/FallRiskAssessmentPage"));
const PressureAreaCarePage = lazy(() => import("./pages/nursing/PressureAreaCarePage"));
const PainAssessmentPage = lazy(() => import("./pages/nursing/PainAssessmentPage"));
const NutritionalAssessmentPage = lazy(() => import("./pages/nursing/NutritionalAssessmentPage"));
const DailyNursingAssessmentPage = lazy(() => import("./pages/nursing/DailyNursingAssessmentPage"));
const PatientEducationPage = lazy(() => import("./pages/nursing/PatientEducationPage"));

// ── Reception Console (single-window registration) ──
const ReceptionConsole = lazy(() => import("./pages/reception/ReceptionConsole"));
const ReceptionDashboard = lazy(() => import("./pages/reception/ReceptionDashboard"));
const DischargeQueue        = lazy(() => import("./pages/reception/DischargeQueue"));
const VisitorPasses         = lazy(() => import("./pages/reception/VisitorPasses"));
const TPACases              = lazy(() => import("./pages/reception/TPACases"));
// R7bb-FIX-E-6 / D6-CRIT-3: Receptionist-facing cashier shift / closing
// report. Wraps the Accounts ShiftTab so a Receptionist can open + close
// their drawer without holding Admin/Accountant access to /accounts.
const ReceptionShiftReport  = lazy(() => import("./pages/reception/ReceptionShiftReport"));
const Appointments          = lazy(() => import("./pages/reception/Appointments"));
// ReceptionPatientSearch + ReceptionVisitHistory deleted 2026-05-17 —
// both superseded by PatientLookupPage. Routes /patient-search and
// /visit-history now mount the unified component.
const ReceptionOPDQueue       = lazy(() => import("./pages/reception/ReceptionOPDQueue"));
const ReceptionEmergencyCases = lazy(() => import("./pages/reception/ReceptionEmergencyCases"));
const ReceptionBedView        = lazy(() => import("./pages/reception/ReceptionBedView"));
const ReceptionBilling        = lazy(() => import("./pages/reception/ReceptionBilling"));
const AccountsConsole         = lazy(() => import("./pages/accounts/AccountsConsole"));
const DieticianConsole        = lazy(() => import("./pages/dietitian/DieticianConsole"));
const WardBoyConsole          = lazy(() => import("./pages/wardboy/WardBoyConsole"));
const WardManagerDashboard    = lazy(() => import("./pages/wardboy/WardManagerDashboard"));
const HousekeepingConsole     = lazy(() => import("./pages/housekeeping/HousekeepingConsole"));
const HousekeepingManagerDashboard = lazy(() => import("./pages/housekeeping/HousekeepingManagerDashboard"));
// R7bj-F1 — Physiotherapy module greenfield (NABH COP.20)
const PhysiotherapistConsole  = lazy(() => import("./pages/physiotherapist/PhysiotherapistConsole"));
// R7cq: KitchenConsole + ColdChainPage imports removed — modules deprecated.
// Page files deleted; routes (/kitchen, /cold-chain) also removed below.
// R7bk — Sidebar coverage stubs for backend-only modules
const FoodReactionsPage       = lazy(() => import("./pages/quality/FoodReactionsPage"));
const BmwManifestPage         = lazy(() => import("./pages/compliance/BmwManifestPage"));
const CodeResponsePage        = lazy(() => import("./pages/compliance/CodeResponsePage"));
const SharpsInjuryPage        = lazy(() => import("./pages/clinical/SharpsInjuryPage"));
const TaxReturnsPage          = lazy(() => import("./pages/accounts/TaxReturnsPage"));
const TdsCertificatesPage     = lazy(() => import("./pages/accounts/TdsCertificatesPage"));
const LabResultsEntry         = lazy(() => import("./pages/lab/LabResultsEntry"));
// R7cq: LabTechConsole + RadiologistConsole imports removed — consoles
// deprecated. Page files deleted; routes (/lab-console, /radiology-console)
// also removed below. Manual Lab Entry stays (lab + imaging are outsourced
// at this hospital so transcription is the only in-system workflow).

// Clinical pages
const NurseOPDQueuePage = lazy(() => import("./pages/nurse/NurseOPDQueuePage"));
const NursePatientPanel = lazy(() => import("./pages/nurse/NursePatientPanel"));
const DoctorOPDPanelPage = lazy(() => import("./pages/doctor/DoctorOPDPanelPage"));
// PatientHistoryPage deleted 2026-05-17 — superseded by
// PatientLookupPage's "timeline" view.
// Unified replacement for /patient-search + /visit-history + /allpatient
// + /patient-history. All four routes now mount this single component
// with a different `initialView` so the page lands on the relevant tab.
// The legacy components remain importable for the rare deep-link that
// hasn't been migrated, but the routes below point at the unified one.
const PatientLookupPage = lazy(() => import("./pages/patient/PatientLookupPage"));
const CompletePatientFilePage = lazy(() => import("./pages/patient/CompletePatientFilePage"));
// PatientHistoryViewPage — two-tab read-only view (OPD History per UHID +
// chronological IPD File per admission). Sits alongside CompletePatientFile
// and gives clinicians a quicker, more focused "what happened, in order"
// lens onto the patient. Powered by /api/patient-history/*.
const PatientHistoryViewPage = lazy(() => import("./pages/patient/PatientHistoryViewPage"));
// R7i — Medical Records Department (paperless MRD)
const MRDRecentDischargesPage = lazy(() => import("./pages/mrd/MRDRecentDischargesPage"));
const GateLogPage = lazy(() => import("./pages/security/GateLogPage"));
const IncidentsPage = lazy(() => import("./pages/security/IncidentsPage"));
// R7bf-G / A5 NABH compliance scaffolds (CRIT-1/4/5/6/7)
const CriticalValueAlertsPage = lazy(() => import("./pages/clinical/CriticalValueAlertsPage"));
const GrievancesPage = lazy(() => import("./pages/quality/GrievancesPage"));
const ADRReportsPage = lazy(() => import("./pages/quality/ADRReportsPage"));
const FireDrillRegisterPage = lazy(() => import("./pages/compliance/FireDrillRegisterPage"));
// R7bo — NABH Inspection Dashboard (RBS / Emergency / Blood Transfusion).
const NABHRegistersDashboard = lazy(() => import("./pages/compliance/NABHRegistersDashboard"));
// R7ek — Inspection Dashboard split out as its own page (was a tab inside
// NABHRegistersDashboard); shows KPI strip + register-status table.
const InspectionDashboardPage = lazy(() => import("./pages/compliance/InspectionDashboardPage"));
// R7en — ECG Register (NABH AAC.4 / IPSG.2 / COP.7). Lives under
// /compliance/nabh-registers#ecg via the consolidated landing page, but
// also gets a direct deep-link route for quick access.
const ECGRegisterPage               = lazy(() => import("./pages/compliance/ECGRegisterPage"));
// R7bx — six new surveyor-facing NABH registers (COP.10/13/16/17/18 + MOM.7).
const OTRegisterPage                = lazy(() => import("./pages/nabh/OTRegisterPage"));
const ASARegisterPage               = lazy(() => import("./pages/nabh/ASARegisterPage"));
const ReadmissionRegisterPage       = lazy(() => import("./pages/nabh/ReadmissionRegisterPage"));
const MortalityRegisterPage         = lazy(() => import("./pages/nabh/MortalityRegisterPage"));
const RestraintRegisterPage         = lazy(() => import("./pages/nabh/RestraintRegisterPage"));
const AntimicrobialUseRegisterPage  = lazy(() => import("./pages/nabh/AntimicrobialUseRegisterPage"));
// R7eg — NABH HIC.5 Infection Control register. Aggregates ICU care-bundle
// compliance (VAP / CAUTI / CLABSI / DVT / Sepsis / SUP) over time so the
// IC officer can answer surveyor questions like "VAP trend last 3 months".
const HIC5InfectionControlPage      = lazy(() => import("./pages/compliance/HIC5InfectionControlPage"));
// R7bq — DVT/VTE Caprini assessment (auto-pops DVT register).
const CapriniDVTAssessmentPage = lazy(() => import("./pages/nursing/CapriniDVTAssessmentPage"));
// R7du — Restraint Register entry page (NABH COP.17). Nurse-side write
// surface; surveyor-facing read view stays at /compliance/nabh/restraint-register.
const RestraintEntryPage = lazy(() => import("./pages/nursing/RestraintEntryPage"));
const CredentialingPage = lazy(() => import("./pages/hr/CredentialingPage"));
const MARPage = lazy(() => import("./pages/clinical/MARPage"));
const DiabeticChartPage = lazy(() => import("./pages/clinical/DiabeticChartPage"));
// R7eg — ICU Bundles of Care (VAP / CAUTI / CLABSI / DVT / Sepsis / SUP)
const ICUBundlesPage = lazy(() => import("./pages/clinical/ICUBundlesPage"));
const MaintenanceDashboardPage = lazy(() => import("./pages/maintenance/MaintenanceDashboardPage"));
const EquipmentDashboardPage   = lazy(() => import("./pages/maintenance/EquipmentDashboardPage"));
const PharmacyHomePage         = lazy(() => import("./pages/pharmacy/PharmacyHomePage"));
const DischargeSummaryPage = lazy(() => import("./pages/clinical/DischargeSummaryPage"));
const ConsentFormPage = lazy(() => import("./pages/clinical/ConsentFormPage"));
const IPDInitialAssessmentPage = lazy(() => import("./pages/clinical/IPDInitialAssessmentPage"));
const InvestigationOrders     = lazy(() => import("./Components/Investigation/InvestigationOrders"));
const InvestigationMaster     = lazy(() => import("./Components/Investigation/InvestigationMaster"));
const DoctorAssessmentPage = lazy(() => import("./pages/doctor/DoctorAssessmentPage"));
const OPDAssessmentPage = lazy(() => import("./pages/doctor/OPDAssessmentPage"));
const DoctorPatientPanel = lazy(() => import("./pages/doctor/DoctorPatientPanel"));
const DoctorNotesPage = lazy(() => import("./pages/doctor/DoctorNotesPage"));
const MLCPage = lazy(() => import("./pages/mlc/MLCPage"));

const BillPrintPage = lazy(() => import("./pages/billing/BillPrintPage"));
// R7cc — HospitalSettingsPage (the ad-hoc form) removed. HospitalConfigWizard
// is the SOLE admin entry-point for hospital config. Both pages used to share
// /api/hospital-settings; the wizard's tabs cover everything the legacy page
// did (identity, address, contact, GSTIN, bank, NABH, print footer, ops).
const HospitalConfigWizard = lazy(() => import("./pages/admin/HospitalConfigWizard"));
// R7bz — read-only System Health diagnostics page (DB / crons / errors /
// activity / integrity / server).  Admin-only.
const SystemHealthPage = lazy(() => import("./pages/admin/SystemHealthPage"));
// R7dw — NABH Signage Generator. Bilingual (English + Hindi) generator
// for all 88 NABH-mandated hospital signages. Embedded base64 logo,
// printable templates. Admin-only — used for one-off signage printing
// during accreditation prep.
const NABHSignagePage = lazy(() => import("./pages/admin/NABHSignagePage"));
const UserManagementPage = lazy(() => import("./pages/admin/UserManagementPage"));
const RolesPage          = lazy(() => import("./pages/admin/RolesPage"));
const RoleDashboardPage  = lazy(() => import("./pages/RoleDashboardPage"));
const HISAssistant = lazy(() => import("./Components/ai/HISAssistant"));


/* ── Full-page loading spinner while session restores ── */
function AppLoader() {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh",
      background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #1e3a8a 100%)",
    }}>
      <div style={{
        width: 56, height: 56, background: "#1e40af", borderRadius: 14,
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 20, boxShadow: "0 8px 32px rgba(30,64,175,.5)",
      }}>
        <span style={{ fontSize: 26, fontWeight: 900, color: "#fff" }}>S</span>
      </div>
      <i className="pi pi-spin pi-spinner" style={{ fontSize: 28, color: "#38bdf8", marginBottom: 14 }} />
      <div style={{ fontSize: 13, color: "#64748b" }}>Loading…</div>
    </div>
  );
}

/* ── Lightweight route-change spinner (used by Suspense) ── */
function RouteLoader() {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: 60, color: "#64748b",
    }}>
      <i className="pi pi-spin pi-spinner" style={{ fontSize: 24, color: "#1e40af", marginBottom: 10 }} />
      <div style={{ fontSize: 12 }}>Loading…</div>
    </div>
  );
}

/* Role-aware landing page (keep in sync with LoginPage.landingPageForRole) */
// Every role lands on `/dashboard` — a single route that renders the
// role-specific RoleDashboardPage layout. Each role sees their own
// KPIs + quick actions + module shortcuts. The dispatcher inside
// RoleDashboardPage looks at user.role and picks the right view.
const homeForRole = (role) => "/dashboard";

/* ── Inner app — uses hooks that require Router context ── */
function AppLayout({ collapsed, setCollapsed }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const homePath = homeForRole(user?.role);

  /* Show spinner during initial session restore */
  if (loading) return <AppLoader />;

  const isLogin    = location.pathname === "/login";
  const isBillPrint = location.pathname.startsWith("/bill-print/");
  const isPrintable = location.pathname.startsWith("/print/");

  /* Complete-patient-file in print mode — strip sidebar / header so the
   * popup window the Print button opens shows nothing but the clinical
   * document. Triggered by ?mode=print or ?autoprint=1 on the query
   * string. */
  const isPatientFilePrint = location.pathname.startsWith("/patient-file/") && (
    location.search.includes("mode=print") ||
    location.search.includes("autoprint=1")
  );

  /* Redirect unauthenticated users to login */
  if (!user && !isLogin) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  /* Bill print page — standalone, no chrome */
  if (isBillPrint && user) {
    return (
      <Suspense fallback={<RouteLoader />}>
        <Routes>
          <Route path="/bill-print/:billId" element={<BillPrintPage />} />
        </Routes>
      </Suspense>
    );
  }

  /* Unified /print/<slug> printables — opens in a popup window with
   * paper-size toolbar, no app chrome. Driven by PrintRouterPage which
   * dispatches to the registered printable component. */
  if (isPrintable && user) {
    return (
      <Suspense fallback={<RouteLoader />}>
        <Routes>
          <Route path="/print/:slug" element={<PrintRouterPage />} />
        </Routes>
      </Suspense>
    );
  }

  /* Patient file print mode — standalone, no chrome. Same idea as
   * /bill-print but it's the same component (CompletePatientFilePage)
   * just rendered without sidebar/header so the popup window prints
   * a clean clinical document. */
  if (isPatientFilePrint && user) {
    return (
      <Suspense fallback={<RouteLoader />}>
        <Routes>
          <Route path="/patient-file/:uhid" element={<CompletePatientFilePage />} />
        </Routes>
      </Suspense>
    );
  }

  /* Login page — no header / sidebar */
  if (isLogin) {
    return (
      <Routes>
        <Route path="/login" element={user ? <Navigate to={homePath} replace /> : <LoginPage />} />
      </Routes>
    );
  }

  /* ── Main app shell (authenticated) ── */
  return (
    <div>
      <Header />
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      <div
        className={`main-content ${collapsed ? "expanded" : ""}`}
        style={{
          marginTop: 52,
          minHeight: "calc(100vh - 52px)",
          background: "#f8fafc",
        }}
      >
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            {/* ── Dashboard ─────────────────────────────────────── */}
            <Route path="/dashboard1" element={<Dashboard1 />} />
            <Route path="/dash" element={<Dashboard1 />} />

            {/* Patient Registration moved to /reception (see below) */}
            {/* /allpatient → unified PatientLookupPage in "directory" mode.
                See PatientLookupPage docstring for the consolidation rationale. */}
            <Route path="/allpatient" element={<PatientLookupPage initialView="directory" />} />

            {/* ── Doctors ──────────────────────────────────────── */}
            {/* List visible to anyone who books / refers / staffs OPD;
                create / edit limited to Admin via doctors.write. */}
            <Route path="/doctors" element={
              <RoleGuard action="doctors.read"><DoctorListPage /></RoleGuard>
            } />
            <Route path="/doctors/new" element={
              <RoleGuard action="doctors.write"><DoctorFormPage /></RoleGuard>
            } />
            <Route path="/doctors/:doctorId/edit" element={
              <RoleGuard action="doctors.write"><DoctorFormPage /></RoleGuard>
            } />

            {/* ── Nursing ────────────────────────────────────────
                R7bb-E/D5-HIGH-2 — Wrap all nursing write surfaces in
                mar.write so non-nursing roles (Pharmacist, Lab Tech,
                Receptionist) hit a clean Access Denied instead of
                loading a page with disabled buttons everywhere. */}
            <Route path="/nursing-notes" element={
              <RoleGuard action="mar.write"><NursingNotes /></RoleGuard>
            } />
            <Route path="/nursing-handover-notes" element={
              <RoleGuard action="mar.write"><NursingHandoverNotes /></RoleGuard>
            } />

            {/* ── OPD ──────────────────────────────────────────── */}
            <Route path="/opd/:UHID" element={<OPDPrint />} />
            <Route path="/opd-visit" element={<OPList />} />
            {/* /opd/new moved to /reception (see below) */}
            <Route path="/opd/new" element={<Navigate to="/reception" replace />} />
            <Route path="/opd/edit/:visitNumber" element={<Navigate to="/reception" replace />} />
            {/* `/opd/:visitNumber` was unreachable because `/opd/:UHID` matched
                first. Use a distinct prefix so detail views actually open. */}
            <Route path="/opd-details/:visitNumber" element={<OPDDetails />} />

            {/* ── Emergency ─────────────────────────────────────── */}
            {/* R7bb-E/D5-HIGH-2 — emergency-assessment posts doctor orders,
                gate by doctor-orders.write (Admin/Doctor). */}
            <Route path="/emergency-assessment" element={
              <RoleGuard action="doctor-orders.write"><EmergencyAssessmentPage /></RoleGuard>
            } />
            <Route path="/emergency-assessment/:uhid" element={
              <RoleGuard action="doctor-orders.write"><EmergencyAssessmentPage /></RoleGuard>
            } />
            <Route path="/emergency" element={<Emergencylist />} />
            {/* R7bb-E/D5-HIGH-2 — MLC sees PHI + writes medico-legal records;
                gate by mlc.read (Admin/Doctor/Nurse). The page itself further
                gates the "issue MLR" CTA by mlc.write. */}
            <Route path="/mlc" element={
              <RoleGuard action="mlc.read"><MLCPage /></RoleGuard>
            } />
            <Route path="/mlc/:mlrNumber" element={
              <RoleGuard action="mlc.read"><MLCPage /></RoleGuard>
            } />
            {/* /emergency/register moved to /reception (see below) */}
            <Route path="/emergency/new" element={<Navigate to="/reception" replace />} />
            <Route path="/emergency/edit/:emergencyNumber" element={<Navigate to="/reception" replace />} />
            <Route path="/emergency/:emergencyNumber" element={<EmergencyDetails />} />

            {/* ── Vitals ───────────────────────────────── */}
            {/* Vital sheets use useParams() — register both with and without the
                UHID/date slots so a bare visit shows a "pick a patient" prompt. */}
            <Route path="/updateVitalSheet"            element={<UpdateVitalSheet />} />
            <Route path="/updateVitalSheet/:uhid/:date" element={<UpdateVitalSheet />} />
            <Route path="/vitalSheet"        element={<VitalSheet />} />
            <Route path="/vitalSheet/:uhid"  element={<VitalSheet />} />
            <Route path="/vitalsView"        element={<VitalsView />} />
            <Route path="/vitalsView/:uhid"  element={<VitalsView />} />

            {/* ── Patients Module ───────────────────────────────── */}
            <Route path="/patients" element={<PatientList />} />
            <Route path="/patients/new" element={<PatientForm />} />
            <Route path="/patients/edit/:id" element={<PatientForm />} />
            <Route path="/patients/:id" element={<PatientDetails />} />

            {/* ── Services & TPA ────────────────────────────────── */}
            <Route path="/addservice" element={
              <RoleGuard allow={["Admin", "TPA Coordinator", "Accountant"]}><ServiceAdd /></RoleGuard>
            } />
            <Route path="/addtpa" element={
              <RoleGuard action="tpa.pre-auth"><AddTpa /></RoleGuard>
            } />
            <Route path="/ServiceAlldata" element={
              <RoleGuard action="billing.read"><ServiceAlldata /></RoleGuard>
            } />

            {/* ── Department ──────────────────────────────────────
                Anyone may read (departments.read); writes happen inside the
                page and are gated by departments.write at the API. */}
            <Route path="/department" element={
              <RoleGuard action="departments.read"><DepartmentManagement /></RoleGuard>
            } />

            {/* ── Bed Management ────────────────────────────────── */}
            <Route path="/bed-dashboard" element={<BedDashboard />} />
            <Route path="/print-gallery" element={<PrintGalleryPage />} />
            <Route path="/bed-transfers" element={<BedTransfersListPage />} />
            <Route path="/bed-reports/monthly" element={<BedMonthlyReportPage />} />
            <Route path="/beds" element={<BedManagement />} />
            <Route path="/bed-visual" element={<BedVisualLayout />} />
            <Route path="/rooms" element={<RoomManagement />} />
            <Route path="/roomcategory" element={<AddRoomCategory />} />
            <Route path="/wards" element={<WardManagement />} />
            <Route path="/buildings" element={<BuildingManagement />} />
            <Route path="/floors" element={<FloorManagement />} />

            {/* ── Hospital Charges ──────────────────────────────── */}
            {/* TPA tariff sheets — anyone who can bill may view; only
                Admin can mutate (same gate as departments.write). */}
            <Route path="/hospital-charges" element={
              <RoleGuard action="billing.read"><HospitalChargesList /></RoleGuard>
            } />
            <Route path="/hospital-charges/create" element={
              <RoleGuard action="departments.write"><CreateHospitalCharges /></RoleGuard>
            } />
            <Route path="/hospital-charges/edit/:id" element={
              <RoleGuard action="departments.write"><EditHospitalCharges /></RoleGuard>
            } />

            {/* R7ah: routes /billing, /billing/create/..., /billing/view/...,
                /billing/edit/..., /bills, /patient-billing, /patient-billing/:uhid
                were all removed. The canonical billing surfaces are now:
                  • /reception-billing  — bill list + collection counter
                  • /billing/ipd/:admissionId — live IPD ledger
                  • /billing/ipd          — admission picker for the ledger
                Stray external links that still point at the old paths land
                on the dashboard via the catch-all route below. */}
            <Route path="/billing" element={<Navigate to="/reception-billing" replace />} />
            <Route path="/bills"   element={<Navigate to="/reception-billing" replace />} />
            <Route path="/patient-billing"       element={<Navigate to="/reception-billing" replace />} />
            <Route path="/patient-billing/:uhid" element={<Navigate to="/reception-billing" replace />} />
            <Route path="/service-master" element={
              <RoleGuard action="departments.write"><ServiceMasterManager /></RoleGuard>
            } />
            <Route path="/chargeable-services" element={
              <RoleGuard action="billing.read"><ChargeableServices /></RoleGuard>
            } />
            {/* R7dp — Per-doctor consultation-fee editor. The page itself
                gates by role (Admin / Accountant); the RoleGuard mirrors
                that so a Doctor / Receptionist hitting the URL bounces
                off here instead of loading the page and seeing it
                self-deny. */}
            <Route path="/doctor-charges" element={
              <RoleGuard allow={["Admin", "Accountant"]}><DoctorChargesPage /></RoleGuard>
            } />
            {/* R7en — Per-room-category daily-charges matrix. Mirrors
                /doctor-charges; same auth gate. The daily auto-billing
                cron sources every line item from this grid. */}
            <Route path="/room-charges" element={
              <RoleGuard allow={["Admin", "Accountant"]}><RoomChargesPage /></RoleGuard>
            } />

            {/* /billing-intelligence routes removed — receptionist Billing
                Counter at /reception-billing now handles the full flow. */}

            {/* ── Billing Audit Trail — admin only ───────────────── */}
            <Route path="/billing-audit-trail" element={
              <RoleGuard action="reports.audit"><BillingAuditTrailPage /></RoleGuard>
            } />
            <Route path="/billing-audit-trail/:uhid" element={
              <RoleGuard action="reports.audit"><BillingAuditTrailPage /></RoleGuard>
            } />

            {/* ── IPD / Day-Care Live Billing Ledger ───────────────
                The end-to-end ledger view: every auto-fired charge from
                admission to discharge with undo (15-min) / override /
                cancel actions. Read-gated by billing.read so all the
                billing-eligible roles can pull it up; the per-row
                actions are further gated server-side. */}
            <Route path="/billing/ipd/:admissionId" element={
              <RoleGuard action="billing.read"><IPDBillingLedger /></RoleGuard>
            } />
            {/* No-admission-id variant — sidebar IPD Live Ledger tile
                lands here. The component detects `!admissionId` and
                renders the admission picker (active list + UHID search)
                instead of the ledger; clicking a row redirects to
                /billing/ipd/{id}. Same RoleGuard. */}
            <Route path="/billing/ipd" element={
              <RoleGuard action="billing.read"><IPDBillingLedger /></RoleGuard>
            } />

            {/* ── Pharmacy Indent Workflow ─────────────────────────
                Nurse raises an indent from an admission; pharmacist
                sees the live queue + releases stock. Both routes are
                lazy-loaded; backend enforces the same action gates. */}
            <Route path="/nursing/indent/raise/:admissionId" element={
              <RoleGuard action="indent.raise"><IndentRaisePage /></RoleGuard>
            } />
            <Route path="/pharmacy/indents" element={
              <RoleGuard action="indent.read"><PharmacyIndentsPage /></RoleGuard>
            } />

            {/* ── Main / Default ───────────────────────────────── */}
            <Route path="/" element={<Navigate to={homePath} replace />} />
            {/* /mainpage was the original receptionist-flavoured generic
                dashboard. Now superseded by /dashboard (RoleDashboardPage,
                role-aware). Keep the route as a redirect so any stale
                bookmark / sidebar memory / external link still lands on
                the correct per-role view rather than leaking reception
                content to other roles. */}
            <Route
              path="/mainpage"
              element={
                user?.role === "Receptionist"
                  ? <Navigate to="/reception" replace />
                  : <Navigate to="/dashboard" replace />
              }
            />

            {/* ── Reception Console (single-window registration) ──
                R7bb-FIX-D-16 / D5-MED-3 — register / appointment / console
                surfaces all mutate patient + admission state via reception
                APIs, gate them by reception.register so Doctor / Nurse /
                Pharmacist / Lab Tech don't see a half-loaded form before
                the API 403s. Read-only Reception dashboard stays open. */}
            <Route path="/reception" element={<ReceptionDashboard />} />
            <Route path="/reception/register" element={
              <RoleGuard action="reception.register"><ReceptionConsole /></RoleGuard>
            } />
            <Route path="/reception-console" element={
              <RoleGuard action="reception.register"><ReceptionConsole /></RoleGuard>
            } />
            <Route path="/discharge-queue" element={
              <RoleGuard action="reception.discharge"><DischargeQueue /></RoleGuard>
            } />
            <Route path="/visitor-passes" element={
              <RoleGuard action="reception.visitor-pass"><VisitorPasses /></RoleGuard>
            } />
            <Route path="/gate-log" element={
              <RoleGuard action="security.gate-log"><GateLogPage /></RoleGuard>
            } />
            <Route path="/incidents" element={
              <RoleGuard action="security.incident-report"><IncidentsPage /></RoleGuard>
            } />
            {/* R7bf-G — NABH compliance scaffold pages (A5-CRIT-1/4/5/6/7) */}
            <Route path="/critical-value-alerts" element={
              <RoleGuard action="clinical.acknowledge-critical"><CriticalValueAlertsPage /></RoleGuard>
            } />
            <Route path="/grievances" element={
              <RoleGuard action="quality.grievance.read"><GrievancesPage /></RoleGuard>
            } />
            <Route path="/adr-reports" element={
              <RoleGuard action="pharmacy.adr.read"><ADRReportsPage /></RoleGuard>
            } />
            <Route path="/fire-drills" element={
              <RoleGuard action="compliance.firedrill.read"><FireDrillRegisterPage /></RoleGuard>
            } />
            {/* R7bo — NABH Inspection Dashboard surfaces RBS, Emergency,
                Blood Transfusion registers in a unified surveyor view. */}
            <Route path="/compliance/nabh-registers" element={
              <RoleGuard action="compliance.read"><NABHRegistersDashboard /></RoleGuard>
            } />
            {/* R7ek — Inspection Dashboard (separate page; was a tab). */}
            <Route path="/compliance/inspection-dashboard" element={
              <RoleGuard action="compliance.read"><InspectionDashboardPage /></RoleGuard>
            } />
            {/* R7bx — six surveyor-facing NABH registers, each one a
                filterable + printable + CSV-exportable chronological log.
                Auto-populated from existing clinical save paths. */}
            <Route path="/compliance/nabh/ot-register" element={
              <RoleGuard action="compliance.read"><OTRegisterPage /></RoleGuard>
            } />
            <Route path="/compliance/nabh/asa-register" element={
              <RoleGuard action="compliance.read"><ASARegisterPage /></RoleGuard>
            } />
            <Route path="/compliance/nabh/readmission-register" element={
              <RoleGuard action="compliance.read"><ReadmissionRegisterPage /></RoleGuard>
            } />
            <Route path="/compliance/nabh/mortality-register" element={
              <RoleGuard action="compliance.read"><MortalityRegisterPage /></RoleGuard>
            } />
            <Route path="/compliance/nabh/restraint-register" element={
              <RoleGuard action="compliance.read"><RestraintRegisterPage /></RoleGuard>
            } />
            <Route path="/compliance/nabh/antimicrobial-register" element={
              <RoleGuard action="compliance.read"><AntimicrobialUseRegisterPage /></RoleGuard>
            } />
            {/* R7en — ECG Register (NABH AAC.4 / IPSG.2 / COP.7). Standalone
                deep-link mount; also reachable from the consolidated NABH
                Registers landing page via #ecg hash. */}
            <Route path="/compliance/nabh/ecg-register" element={
              <RoleGuard action="compliance.read"><ECGRegisterPage /></RoleGuard>
            } />
            {/* R7eg — NABH HIC.5 Infection Control register: ICU care-bundle
                compliance aggregated over time (VAP / CAUTI / CLABSI / DVT
                / Sepsis / SUP). Backed by /api/clinical-audit/icu-bundles. */}
            <Route path="/compliance/hic5-infection-control" element={
              <RoleGuard action="compliance.read"><HIC5InfectionControlPage /></RoleGuard>
            } />
            {/* R7bq — Caprini DVT assessment. POST to /api/nursing-assessments/dvt
                auto-populates the NABH DVT register (MOM.7 + AAC.4). */}
            <Route path="/nursing/caprini-dvt" element={
              <RoleGuard action="vitals.write"><CapriniDVTAssessmentPage /></RoleGuard>
            } />
            {/* R7du — Restraint Register entry (NABH COP.17). Nurse-side
                write surface. POST to /api/restraints calls emitRestraint
                inside the backend, populating the surveyor-facing register
                read view at /compliance/nabh/restraint-register. */}
            <Route path="/nursing/restraints" element={
              <RoleGuard action="mar.write"><RestraintEntryPage /></RoleGuard>
            } />
            <Route path="/nursing/restraints/:uhid" element={
              <RoleGuard action="mar.write"><RestraintEntryPage /></RoleGuard>
            } />
            <Route path="/credentials" element={
              <RoleGuard action="hr.credential.read"><CredentialingPage /></RoleGuard>
            } />
            <Route path="/tpa-cases" element={
              <RoleGuard allow={["Admin", "TPA Coordinator", "Receptionist", "Accountant"]}><TPACases /></RoleGuard>
            } />
            {/* R7bb-FIX-E-6 / D6-CRIT-3: Receptionist closing report (cashier shift) */}
            <Route path="/reception/closing-report" element={
              <RoleGuard allow={["Admin", "Receptionist", "Accountant"]}><ReceptionShiftReport /></RoleGuard>
            } />
            {/* R7bb-FIX-D-16 / D5-MED-3 — appointment slot booking is a
                reception-only surface; gate by reception.register. */}
            <Route path="/appointments" element={
              <RoleGuard action="reception.register"><Appointments /></RoleGuard>
            } />
            {/* Receptionist-flavored versions of shared modules */}
            {/* All three legacy patient-lookup routes now mount the unified
                PatientLookupPage. /patient-search lands on the live-search
                tab (Receptionist default); /visit-history lands on the
                timeline tab (which auto-loads if ?uhid= or /:uhid is given). */}
            <Route path="/patient-search" element={<PatientLookupPage initialView="search" />} />
            <Route path="/visit-history"  element={<PatientLookupPage initialView="timeline" />} />
            <Route path="/visit-history/:uhid" element={<PatientLookupPage initialView="timeline" />} />
            <Route path="/reception-opd-queue" element={<ReceptionOPDQueue />} />
            <Route path="/reception-emergency" element={<ReceptionEmergencyCases />} />
            <Route path="/reception-beds" element={<ReceptionBedView />} />
            <Route path="/reception-billing" element={<ReceptionBilling />} />
            <Route path="/reception-billing/:uhid" element={<ReceptionBilling />} />
            {/* Legacy routes redirect to the new console */}
            <Route path="/ipd-admission" element={<Navigate to="/reception" replace />} />
            <Route path="/opd-register" element={<Navigate to="/reception" replace />} />
            <Route path="/emergency/register" element={<Navigate to="/reception" replace />} />
            <Route path="/registration/:typedata" element={<Navigate to="/reception" replace />} />
            <Route path="/registration/:typedata/:id" element={<Navigate to="/reception" replace />} />

            {/* ── Clinical pages ── */}
            <Route path="/opd-queue" element={<NurseOPDQueuePage />} />
            {/* R7bb-FIX-D-19 / D5-MED-6 — Nurse / Doctor patient panels read
                full clinical file; gate by patient-file.read. */}
            <Route path="/nurse-patient-panel" element={
              <RoleGuard action="patient-file.read"><NursePatientPanel /></RoleGuard>
            } />
            <Route path="/doctor-opd-panel" element={<DoctorOPDPanelPage />} />
            {/* Legacy clinical-history route — same destination, "timeline"
                tab. /patient-history/:uhid still works the same way thanks
                to the useSearchParams + useParams handling inside the
                unified component. */}
            <Route path="/patient-history" element={<PatientLookupPage initialView="timeline" />} />
            {/* Complete patient file — one page with every clinical record + UI audit feed. */}
            <Route path="/patient-file/:uhid" element={<CompletePatientFilePage />} />
            {/* New focused two-tab view — OPD History per UHID +
                chronological IPD File per admission. Accessible without
                a UHID for the in-page search box. */}
            <Route path="/patient-history-view"       element={<PatientHistoryViewPage />} />
            <Route path="/patient-history-view/:uhid" element={<PatientHistoryViewPage />} />
            {/* R7i: Medical Records Department — read-only archive of
                every discharged patient. Doctor/Admin/MRD only. */}
            <Route path="/medical-records/discharges" element={
              <RoleGuard action="mrd.list"><MRDRecentDischargesPage /></RoleGuard>
            } />
            <Route path="/mar" element={<MARPage />} />
            <Route path="/diabetic-chart" element={<DiabeticChartPage />} />
            {/* R7eg — ICU Bundles of Care. R7ei: gate promoted to the new
                `icu-bundle.write` action so intensivists (Doctor role) can
                chart bundles in addition to Admin/Nurse. Mirrors the
                backend route gate at /api/icu-bundles. */}
            <Route path="/icu-bundles" element={
              <RoleGuard action="icu-bundle.write"><ICUBundlesPage /></RoleGuard>
            } />
            <Route path="/maintenance"    element={<MaintenanceDashboardPage />} />
            <Route path="/equipment"      element={<EquipmentDashboardPage />} />
            <Route path="/pharmacy"       element={
              <RoleGuard allow={["Admin", "Pharmacist", "Doctor", "Accountant"]}><PharmacyHomePage /></RoleGuard>
            } />
            <Route path="/discharge-summary" element={
              <RoleGuard action="ipd.discharge-summary"><DischargeSummaryPage /></RoleGuard>
            } />
            {/* R7q: Consent capture is gated to Admin/Doctor/Nurse on
                the backend (consent.write). Add route-level guard so
                Receptionist / Pharmacist hitting the URL bounce off the
                guard instead of loading the page and seeing 403 toasts
                on every save. */}
            <Route path="/consent-forms" element={
              <RoleGuard action="consent.write"><ConsentFormPage /></RoleGuard>
            } />
            {/* R7bb-E/D5-HIGH-2 — Nursing assessment writes gated by mar.write
                (Admin/Nurse). Doctor still has POST gates server-side via the
                doctor-orders flow; assessment forms are nurse-driven. */}
            <Route path="/nurse-initial-assessment" element={
              <RoleGuard action="mar.write"><NurseInitialAssessmentPage /></RoleGuard>
            } />
            <Route path="/ipd-initial-assessment" element={
              <RoleGuard action="mar.write"><IPDInitialAssessmentPage /></RoleGuard>
            } />
            {/* Alias — many pages link to /ipd-assessment which is the same flow */}
            <Route path="/ipd-assessment" element={
              <RoleGuard action="mar.write"><IPDInitialAssessmentPage /></RoleGuard>
            } />
            <Route path="/ipd-assessment/:uhid" element={
              <RoleGuard action="mar.write"><IPDInitialAssessmentPage /></RoleGuard>
            } />

            {/* Investigation / Lab — used by Lab Tech, Radiologist, Doctor */}
            <Route path="/investigation-orders" element={
              <RoleGuard allow={["Admin", "Lab Technician", "Radiologist", "Doctor", "Nurse", "Receptionist"]}><InvestigationOrders /></RoleGuard>
            } />
            <Route path="/investigation-master" element={
              <RoleGuard allow={["Admin", "Lab Technician", "Radiologist"]}><InvestigationMaster /></RoleGuard>
            } />
            {/* R7n: Both assessment pages call POST /doctor-orders which is
                now gated to Admin/Doctor. Wrap with RoleGuard so non-doctor
                users hit a clean "access denied" instead of loading the
                page and then seeing 403 toasts on every save. */}
            <Route path="/doctor-assessment" element={
              <RoleGuard action="doctor-orders.write"><DoctorAssessmentPage /></RoleGuard>
            } />
            <Route path="/opd-assessment" element={
              <RoleGuard action="doctor-orders.write"><OPDAssessmentPage /></RoleGuard>
            } />
            {/* R7bb-FIX-D-19 / D5-MED-6 — Doctor patient panel reads full
                clinical file; gate by patient-file.read. */}
            <Route path="/doctor-patient-panel" element={
              <RoleGuard action="patient-file.read"><DoctorPatientPanel /></RoleGuard>
            } />
            <Route path="/doctor-notes" element={<DoctorNotesPage />} />
            {/* R7bb-E/D5-HIGH-2 — Nursing assessment writes gated by mar.write. */}
            <Route path="/nursing-care-plan" element={
              <RoleGuard action="mar.write"><NursingCarePlanPage /></RoleGuard>
            } />
            <Route path="/fall-risk-assessment" element={
              <RoleGuard action="mar.write"><FallRiskAssessmentPage /></RoleGuard>
            } />
            <Route path="/pressure-area-care" element={
              <RoleGuard action="mar.write"><PressureAreaCarePage /></RoleGuard>
            } />
            <Route path="/pain-assessment" element={
              <RoleGuard action="mar.write"><PainAssessmentPage /></RoleGuard>
            } />
            <Route path="/nutritional-assessment" element={
              <RoleGuard action="mar.write"><NutritionalAssessmentPage /></RoleGuard>
            } />
            <Route path="/daily-nursing-assessment" element={
              <RoleGuard action="mar.write"><DailyNursingAssessmentPage /></RoleGuard>
            } />
            <Route path="/patient-education" element={
              <RoleGuard action="mar.write"><PatientEducationPage /></RoleGuard>
            } />

            {/* ── Admin ───────────────────────────────────────────
                 Sensitive routes are wrapped in <RoleGuard> so non-admins
                 get a clean "Access denied" instead of partial UI / 401s. */}
            {/* R7bx item 7 + R7cc — Hospital Configuration Wizard is now the
                SOLE admin entry-point for hospital config (legacy
                HospitalSettingsPage removed). Single tabbed page covering
                identity, branding, tax, bank, footer, NABH, ops. The legacy
                `/hospital-settings` path redirects here so any deep-linked
                bookmarks / sidebar caches still land in the right place. */}
            <Route path="/admin/hospital-config" element={
              <RoleGuard allow={["Admin"]}><HospitalConfigWizard /></RoleGuard>
            } />
            <Route path="/hospital-settings" element={<Navigate to="/admin/hospital-config" replace />} />
            {/* R7bz — read-only System Health diagnostics. Admin-only;
                backend route also gated by users.read. */}
            <Route path="/admin/system-health" element={
              <RoleGuard allow={["Admin"]}><SystemHealthPage /></RoleGuard>
            } />
            <Route path="/admin/users" element={
              <RoleGuard allow={["Admin"]} action="users.read"><UserManagementPage /></RoleGuard>
            } />
            <Route path="/admin/roles" element={
              <RoleGuard allow={["Admin"]}><RolesPage /></RoleGuard>
            } />
            {/* R7dw — NABH Signage Generator (Admin only). 88 bilingual
                signage templates for accreditation. */}
            <Route path="/admin/nabh-signage" element={
              <RoleGuard allow={["Admin"]}><NABHSignagePage /></RoleGuard>
            } />

            {/* ── Accountant workspace — Day Book / GST / Outstanding / Refunds ─ */}
            <Route path="/accounts" element={
              <RoleGuard allow={["Admin", "Accountant"]}><AccountsConsole /></RoleGuard>
            } />

            {/* ── Dietician workspace — Patient List / Assessment / Library ─ */}
            <Route path="/dietitian" element={
              <RoleGuard action="diet.read"><DieticianConsole /></RoleGuard>
            } />

            {/* ── Ward Boy task board — Available / My Tasks / Today ─ */}
            <Route path="/ward-tasks" element={
              <RoleGuard action="ward.read"><WardBoyConsole /></RoleGuard>
            } />

            {/* ── Ward Manager KPI dashboard — Admin / Nurse-in-charge ─ */}
            <Route path="/ward-manager" element={
              <RoleGuard action="ward.manage"><WardManagerDashboard /></RoleGuard>
            } />

            {/* ── Housekeeping console — cleaning tasks + ops ── */}
            <Route path="/housekeeping" element={
              <RoleGuard action="house.read"><HousekeepingConsole /></RoleGuard>
            } />
            <Route path="/housekeeping-manager" element={
              <RoleGuard action="house.manage"><HousekeepingManagerDashboard /></RoleGuard>
            } />

            {/* ── R7bj-F1 — Physiotherapy console (NABH COP.20 rehab) ── */}
            <Route path="/physiotherapist" element={
              <RoleGuard action="physio.plan.read"><PhysiotherapistConsole /></RoleGuard>
            } />

            {/* ── R7cq: /kitchen and /cold-chain routes removed (modules
                 deprecated). Backend models survive so historical data
                 isn't lost if the modules ever return. ── */}

            {/* ── R7bk — Sidebar coverage stubs for backend-only modules ── */}
            <Route path="/food-reactions" element={
              <RoleGuard action="quality.food-reaction.read"><FoodReactionsPage /></RoleGuard>
            } />
            <Route path="/bmw-manifest" element={
              <RoleGuard action="compliance.bmw.read"><BmwManifestPage /></RoleGuard>
            } />
            <Route path="/code-response" element={
              <RoleGuard action="compliance.code-response.read"><CodeResponsePage /></RoleGuard>
            } />
            <Route path="/sharps-injury" element={
              <RoleGuard action="clinical.sharps-injury.read"><SharpsInjuryPage /></RoleGuard>
            } />
            <Route path="/tax-returns" element={
              <RoleGuard action="tax.returns.read"><TaxReturnsPage /></RoleGuard>
            } />
            <Route path="/tds" element={
              <RoleGuard action="tax.tds.read"><TdsCertificatesPage /></RoleGuard>
            } />

            {/* ── Lab Technician manual data entry (outsourced workflow) ──
                Lab + imaging are outsourced; Lab Tech transcribes the
                external reports here. Radiologist role kept in the user
                model for future in-house imaging but doesn't currently
                have its own workflow. */}
            <Route path="/lab-results" element={
              <RoleGuard action="lab.records.read"><LabResultsEntry /></RoleGuard>
            } />
            {/* ── R7cq: /lab-console + /radiology-console routes removed.
                 Manual Lab Entry above is the surviving transcription
                 path since lab/imaging is outsourced at this hospital. ── */}

            {/* ── Universal role dashboard ────────────────────────
                 Every role lands here on login. The page reads
                 the current user.role and renders the right layout. */}
            <Route path="/dashboard" element={<RoleDashboardPage />} />

            {/* ── Catch-all: redirect to dashboard ── */}
            <Route path="*" element={<Navigate to={homePath} replace />} />
          </Routes>
        </Suspense>
      </div>

      {/* ── SphereAI Floating Assistant (lazy) ── */}
      <Suspense fallback={null}>
        <HISAssistant />
      </Suspense>
    </div>
  );
}

export default function App() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AuthProvider>
      <HospitalSettingsProvider>
        <Router>
          <AppLayout collapsed={collapsed} setCollapsed={setCollapsed} />
        </Router>
      </HospitalSettingsProvider>
    </AuthProvider>
  );
}
