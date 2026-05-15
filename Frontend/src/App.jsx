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
const PatientsTable = lazy(() => import("./Components/PatientsTable"));
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

// Old Billing
const BillsList = lazy(() => import("./pages/billing/BillsList"));
const BillGeneration = lazy(() => import("./pages/billing/Billgeneration"));

// New Billing System
const PatientBilling = lazy(() => import("./Components/billing/PatientBilling"));
const ServiceMasterManager = lazy(() => import("./Components/ServiceMaster/ServiceMasterManager"));
const ChargeableServices = lazy(() => import("./pages/services/ChargeableServices"));
const BillingIntelligencePage = lazy(() => import("./pages/billing/BillingIntelligencePage"));
const BillingAuditTrailPage = lazy(() => import("./pages/billing/BillingAuditTrailPage"));

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
const Appointments          = lazy(() => import("./pages/reception/Appointments"));
const ReceptionPatientSearch  = lazy(() => import("./pages/reception/ReceptionPatientSearch"));
const ReceptionVisitHistory   = lazy(() => import("./pages/reception/ReceptionVisitHistory"));
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
const LabResultsEntry         = lazy(() => import("./pages/lab/LabResultsEntry"));

// Clinical pages
const NurseOPDQueuePage = lazy(() => import("./pages/nurse/NurseOPDQueuePage"));
const NursePatientPanel = lazy(() => import("./pages/nurse/NursePatientPanel"));
const DoctorOPDPanelPage = lazy(() => import("./pages/doctor/DoctorOPDPanelPage"));
const PatientHistoryPage = lazy(() => import("./pages/patient/PatientHistoryPage"));
const CompletePatientFilePage = lazy(() => import("./pages/patient/CompletePatientFilePage"));
const MARPage = lazy(() => import("./pages/clinical/MARPage"));
const DiabeticChartPage = lazy(() => import("./pages/clinical/DiabeticChartPage"));
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
const HospitalSettingsPage = lazy(() => import("./pages/admin/HospitalSettingsPage"));
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
      <div style={{ fontSize: 13, color: "#64748b" }}>Loading SphereHealth HIS…</div>
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
            <Route path="/allpatient" element={<PatientsTable />} />

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

            {/* ── Nursing ──────────────────────────────────────── */}
            <Route path="/nursing-notes" element={<NursingNotes />} />
            <Route path="/nursing-handover-notes" element={<NursingHandoverNotes />} />

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
            <Route path="/emergency-assessment" element={<EmergencyAssessmentPage />} />
            <Route path="/emergency-assessment/:uhid" element={<EmergencyAssessmentPage />} />
            <Route path="/emergency" element={<Emergencylist />} />
            {/* Medico-Legal Cases — doctors land here to record/issue MLR-stamped reports */}
            <Route path="/mlc" element={<MLCPage />} />
            <Route path="/mlc/:mlrNumber" element={<MLCPage />} />
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

            {/* ── Old Billing (existing) ──────────────────────────
                Anyone who can read billing (Admin, Accountant, Receptionist,
                TPA Coordinator) may view. Refunds inside the page are gated
                separately by billing.refund on the API. */}
            <Route path="/billing" element={
              <RoleGuard action="billing.read"><BillsList /></RoleGuard>
            } />
            <Route path="/billing/create/:prescriptionId" element={
              <RoleGuard action="billing.write"><BillGeneration /></RoleGuard>
            } />
            <Route path="/billing/view/:billId" element={
              <RoleGuard action="billing.read"><BillGeneration /></RoleGuard>
            } />
            <Route path="/billing/edit/:billId" element={
              <RoleGuard action="billing.write"><BillGeneration /></RoleGuard>
            } />
            <Route path="/bills" element={<Navigate to="/billing" replace />} />

            {/* ── New Billing System ──────────────── */}
            <Route path="/patient-billing" element={
              <RoleGuard action="billing.read"><PatientBilling /></RoleGuard>
            } />
            <Route path="/patient-billing/:uhid" element={
              <RoleGuard action="billing.read"><PatientBilling /></RoleGuard>
            } />
            <Route path="/service-master" element={
              <RoleGuard action="departments.write"><ServiceMasterManager /></RoleGuard>
            } />
            <Route path="/chargeable-services" element={
              <RoleGuard action="billing.read"><ChargeableServices /></RoleGuard>
            } />

            {/* ── AI Billing Intelligence — admin/accountant only ── */}
            <Route path="/billing-intelligence" element={
              <RoleGuard action="reports.financial"><BillingIntelligencePage /></RoleGuard>
            } />
            <Route path="/billing-intelligence/:uhid" element={
              <RoleGuard action="reports.financial"><BillingIntelligencePage /></RoleGuard>
            } />

            {/* ── Billing Audit Trail — admin only ───────────────── */}
            <Route path="/billing-audit-trail" element={
              <RoleGuard action="reports.audit"><BillingAuditTrailPage /></RoleGuard>
            } />
            <Route path="/billing-audit-trail/:uhid" element={
              <RoleGuard action="reports.audit"><BillingAuditTrailPage /></RoleGuard>
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

            {/* ── Reception Console (single-window registration) ── */}
            <Route path="/reception" element={<ReceptionDashboard />} />
            <Route path="/reception/register" element={<ReceptionConsole />} />
            <Route path="/reception-console" element={<ReceptionConsole />} />
            <Route path="/discharge-queue" element={
              <RoleGuard action="reception.discharge"><DischargeQueue /></RoleGuard>
            } />
            <Route path="/visitor-passes" element={
              <RoleGuard action="reception.visitor-pass"><VisitorPasses /></RoleGuard>
            } />
            <Route path="/tpa-cases" element={
              <RoleGuard allow={["Admin", "TPA Coordinator", "Receptionist", "Accountant"]}><TPACases /></RoleGuard>
            } />
            <Route path="/appointments" element={<Appointments />} />
            {/* Receptionist-flavored versions of shared modules */}
            <Route path="/patient-search" element={<ReceptionPatientSearch />} />
            <Route path="/visit-history" element={<ReceptionVisitHistory />} />
            <Route path="/visit-history/:uhid" element={<ReceptionVisitHistory />} />
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
            <Route path="/nurse-patient-panel" element={<NursePatientPanel />} />
            <Route path="/doctor-opd-panel" element={<DoctorOPDPanelPage />} />
            <Route path="/patient-history" element={<PatientHistoryPage />} />
            {/* Complete patient file — one page with every clinical record + UI audit feed. */}
            <Route path="/patient-file/:uhid" element={<CompletePatientFilePage />} />
            <Route path="/mar" element={<MARPage />} />
            <Route path="/diabetic-chart" element={<DiabeticChartPage />} />
            <Route path="/maintenance"    element={<MaintenanceDashboardPage />} />
            <Route path="/equipment"      element={<EquipmentDashboardPage />} />
            <Route path="/pharmacy"       element={
              <RoleGuard allow={["Admin", "Pharmacist", "Doctor", "Accountant"]}><PharmacyHomePage /></RoleGuard>
            } />
            <Route path="/discharge-summary" element={
              <RoleGuard action="ipd.discharge-summary"><DischargeSummaryPage /></RoleGuard>
            } />
            <Route path="/consent-forms" element={<ConsentFormPage />} />
            <Route path="/nurse-initial-assessment" element={<NurseInitialAssessmentPage />} />
            <Route path="/ipd-initial-assessment" element={<IPDInitialAssessmentPage />} />
            {/* Alias — many pages link to /ipd-assessment which is the same flow */}
            <Route path="/ipd-assessment" element={<IPDInitialAssessmentPage />} />
            <Route path="/ipd-assessment/:uhid" element={<IPDInitialAssessmentPage />} />

            {/* Investigation / Lab — used by Lab Tech, Radiologist, Doctor */}
            <Route path="/investigation-orders" element={
              <RoleGuard allow={["Admin", "Lab Technician", "Radiologist", "Doctor", "Nurse", "Receptionist"]}><InvestigationOrders /></RoleGuard>
            } />
            <Route path="/investigation-master" element={
              <RoleGuard allow={["Admin", "Lab Technician", "Radiologist"]}><InvestigationMaster /></RoleGuard>
            } />
            <Route path="/doctor-assessment" element={<DoctorAssessmentPage />} />
            <Route path="/opd-assessment" element={<OPDAssessmentPage />} />
            <Route path="/doctor-patient-panel" element={<DoctorPatientPanel />} />
            <Route path="/doctor-notes" element={<DoctorNotesPage />} />
            <Route path="/nursing-care-plan" element={<NursingCarePlanPage />} />
            <Route path="/fall-risk-assessment" element={<FallRiskAssessmentPage />} />
            <Route path="/pressure-area-care" element={<PressureAreaCarePage />} />
            <Route path="/pain-assessment" element={<PainAssessmentPage />} />
            <Route path="/nutritional-assessment" element={<NutritionalAssessmentPage />} />
            <Route path="/daily-nursing-assessment" element={<DailyNursingAssessmentPage />} />
            <Route path="/patient-education" element={<PatientEducationPage />} />

            {/* ── Admin ───────────────────────────────────────────
                 Sensitive routes are wrapped in <RoleGuard> so non-admins
                 get a clean "Access denied" instead of partial UI / 401s. */}
            <Route path="/hospital-settings" element={
              <RoleGuard allow={["Admin"]}><HospitalSettingsPage /></RoleGuard>
            } />
            <Route path="/admin/users" element={
              <RoleGuard allow={["Admin"]} action="users.read"><UserManagementPage /></RoleGuard>
            } />
            <Route path="/admin/roles" element={
              <RoleGuard allow={["Admin"]}><RolesPage /></RoleGuard>
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

            {/* ── Lab Tech / Radiologist manual data entry ── */}
            <Route path="/lab-results" element={
              <RoleGuard action="lab.records.read"><LabResultsEntry /></RoleGuard>
            } />

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
