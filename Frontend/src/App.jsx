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
import { AuthProvider, useAuth } from "./context/AuthContext";
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

// Clinical pages
const NurseOPDQueuePage = lazy(() => import("./pages/nurse/NurseOPDQueuePage"));
const NursePatientPanel = lazy(() => import("./pages/nurse/NursePatientPanel"));
const DoctorOPDPanelPage = lazy(() => import("./pages/doctor/DoctorOPDPanelPage"));
const PatientHistoryPage = lazy(() => import("./pages/patient/PatientHistoryPage"));
const MARPage = lazy(() => import("./pages/clinical/MARPage"));
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
const homeForRole = (role) => {
  switch (role) {
    case "Receptionist":     return "/reception";
    case "Doctor":           return "/doctor-opd-panel";
    case "Nurse":            return "/opd-queue";
    case "TPA Coordinator":  return "/tpa-cases";
    case "Pharmacist":       return "/mar";
    case "Lab Technician":   return "/investigation-orders";
    case "Radiologist":      return "/investigation-orders";
    case "Accountant":       return "/billing";
    case "Ward Boy":         return "/bed-visual";
    case "Dietician":        return "/vitalSheet";
    case "Physiotherapist":  return "/updateVitalSheet";
    default:                 return "/mainpage";
  }
};

/* ── Inner app — uses hooks that require Router context ── */
function AppLayout({ collapsed, setCollapsed }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const homePath = homeForRole(user?.role);

  /* Show spinner during initial session restore */
  if (loading) return <AppLoader />;

  const isLogin    = location.pathname === "/login";
  const isBillPrint = location.pathname.startsWith("/bill-print/");

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
            <Route path="/doctors" element={<DoctorListPage />} />
            <Route path="/doctors/new" element={<DoctorFormPage />} />
            <Route path="/doctors/:doctorId/edit" element={<DoctorFormPage />} />

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
            <Route path="/addservice" element={<ServiceAdd />} />
            <Route path="/addtpa" element={<AddTpa />} />
            <Route path="/ServiceAlldata" element={<ServiceAlldata />} />

            {/* ── Department ────────────────────────────────────── */}
            <Route path="/department" element={<DepartmentManagement />} />

            {/* ── Bed Management ────────────────────────────────── */}
            <Route path="/beds" element={<BedManagement />} />
            <Route path="/bed-visual" element={<BedVisualLayout />} />
            <Route path="/rooms" element={<RoomManagement />} />
            <Route path="/roomcategory" element={<AddRoomCategory />} />
            <Route path="/wards" element={<WardManagement />} />
            <Route path="/buildings" element={<BuildingManagement />} />
            <Route path="/floors" element={<FloorManagement />} />

            {/* ── Hospital Charges ──────────────────────────────── */}
            <Route path="/hospital-charges" element={<HospitalChargesList />} />
            <Route path="/hospital-charges/create" element={<CreateHospitalCharges />} />
            <Route path="/hospital-charges/edit/:id" element={<EditHospitalCharges />} />

            {/* ── Old Billing (existing) ────────────────────────── */}
            <Route path="/billing" element={<BillsList />} />
            <Route path="/billing/create/:prescriptionId" element={<BillGeneration />} />
            <Route path="/billing/view/:billId" element={<BillGeneration />} />
            <Route path="/billing/edit/:billId" element={<BillGeneration />} />
            <Route path="/bills" element={<Navigate to="/billing" replace />} />

            {/* ── New Billing System ──────────────── */}
            <Route path="/patient-billing" element={<PatientBilling />} />
            <Route path="/patient-billing/:uhid" element={<PatientBilling />} />
            <Route path="/service-master" element={<ServiceMasterManager />} />
            <Route path="/chargeable-services" element={<ChargeableServices />} />

            {/* ── AI Billing Intelligence ──────────────────────── */}
            <Route path="/billing-intelligence" element={<BillingIntelligencePage />} />
            <Route path="/billing-intelligence/:uhid" element={<BillingIntelligencePage />} />

            {/* ── Billing Audit Trail ──────────────────────────── */}
            <Route path="/billing-audit-trail" element={<BillingAuditTrailPage />} />
            <Route path="/billing-audit-trail/:uhid" element={<BillingAuditTrailPage />} />

            {/* ── Main / Default ───────────────────────────────── */}
            <Route path="/" element={<Navigate to={homePath} replace />} />
            <Route
              path="/mainpage"
              element={user?.role === "Receptionist" ? <Navigate to="/reception" replace /> : <MainPage />}
            />

            {/* ── Reception Console (single-window registration) ── */}
            <Route path="/reception" element={<ReceptionDashboard />} />
            <Route path="/reception/register" element={<ReceptionConsole />} />
            <Route path="/reception-console" element={<ReceptionConsole />} />
            <Route path="/discharge-queue" element={<DischargeQueue />} />
            <Route path="/visitor-passes" element={<VisitorPasses />} />
            <Route path="/tpa-cases" element={<TPACases />} />
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
            <Route path="/mar" element={<MARPage />} />
            <Route path="/discharge-summary" element={<DischargeSummaryPage />} />
            <Route path="/consent-forms" element={<ConsentFormPage />} />
            <Route path="/nurse-initial-assessment" element={<NurseInitialAssessmentPage />} />
            <Route path="/ipd-initial-assessment" element={<IPDInitialAssessmentPage />} />
            {/* Alias — many pages link to /ipd-assessment which is the same flow */}
            <Route path="/ipd-assessment" element={<IPDInitialAssessmentPage />} />
            <Route path="/ipd-assessment/:uhid" element={<IPDInitialAssessmentPage />} />

            {/* Investigation / Lab — used by Lab Tech, Radiologist, Doctor */}
            <Route path="/investigation-orders" element={<InvestigationOrders />} />
            <Route path="/investigation-master" element={<InvestigationMaster />} />
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

            {/* ── Admin ──────────────────────────────────────────── */}
            <Route path="/hospital-settings" element={<HospitalSettingsPage />} />
            <Route path="/admin/users" element={<UserManagementPage />} />

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
