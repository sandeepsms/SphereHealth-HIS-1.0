import React, { useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import "./App.css";
import Sidebar from "./Components/Sidebar";
import Registration from "./Components/Registration";
import Header from "./Components/Header";
import PatientsTable from "./Components/PatientsTable";
import "bootstrap/dist/css/bootstrap.css";
import Nurse from "./Components/Nurse";
import Servicebtn from "./Components/Servicebtn";
import OPDPrint from "./pages/OPD/OPDPrint";
import ServiceAlldata from "./Components/ServiceAlldata";
import DepartmentManagement from "../src/pages/Department/DepartmentManagement";

// Import Bed Management Pages
import BedManagement from "./pages/BedManagement";
import RoomManagement from "./pages/RoomManagement";
import WardManagement from "./pages/WardManagement";
import BuildingManagement from "./pages/BuildingManagement";
import FloorManagement from "./pages/FloorManagement";
import BedVisualLayout from "./Components/bed/BedVisualLayout";

import Dashboard1 from "./pages/patient/Dashboard";

// Import PrimeReact CSS
import "primereact/resources/themes/lara-light-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";

// Patients
import PatientList from "./pages/patient/PatientList";
import PatientForm from "./pages/patient/PatientForm";
import PatientDetails from "./pages/patient/PatientDetails";

// OPD
import OPList from "././pages/OPD/OPDList";
import OPDForm from "./pages/OPD/OPDForm";
import OPDDetails from "./pages/OPD/OPDDetails";

// Emergency
import Emergencylist from "./pages/emergency/EmergencyList";
import EmergencyForm from "./pages/emergency/EmergencyForm";
import EmergencyDetails from "./pages/emergency/EmergencyDetails";
import EmergencyRegistrationPage from "./pages/emergency/EmergencyRegistrationPage";
import EmergencyAssessmentPage from "./pages/emergency/EmergencyAssessmentPage";

// Doctors
import DoctorFormPage from "./pages/doctor/DoctorFormPage";
import DoctorListPage from "./pages/doctor/DoctorListPage";
import DoctorForm from "./Components/doctor/DoctorForm";


// TPA & Services
import ServiceAdd from "./Components/Tpa/TPAServiceManagement";
import AddTpa from "./Components/Tpa/AddTpa";
import AddRoomCategory from "./Components/room/AddRoomCategory";

// Hospital Charges
import HospitalChargesList from "./pages/charges/HospitalChargesList";
import CreateHospitalCharges from "./pages/charges/CreateHospitalCharges";
import EditHospitalCharges from "./pages/charges/EditHospitalCharges";

// Old Billing
import BillsList from "./pages/billing/BillsList";
import BillGeneration from "./pages/billing/Billgeneration";

// ── New Billing System (billing-v3) ───────────────────────────
import PatientBilling from "./Components/billing/PatientBilling";
import ServiceMasterManager from "./Components/ServiceMaster/ServiceMasterManager";
import ChargeableServices from "./pages/services/ChargeableServices";
import BillingIntelligencePage from "./pages/billing/BillingIntelligencePage";
import BillingAuditTrailPage from "./pages/billing/BillingAuditTrailPage";
import MainPage from "./pages/mainPage/MainPage";
import NursingNotes from "./pages/nursing/NursingNotes";
import UpdateVitalSheet from "./Components/vital/UpdateVitalSheet";
import VitalSheet from "./Components/vital/VitalSheet";
import VitalsView from "./Components/vital/VitalsView";
import NursingHandoverNotes from "./pages/nursing/NursingHandoverNotes";
import { AuthProvider, useAuth } from "./context/AuthContext";

// Clinical pages
import OPDRegistrationPage from "./pages/registration/OPDRegistrationPage";
import NurseOPDQueuePage from "./pages/nurse/NurseOPDQueuePage";
import NursePatientPanel from "./pages/nurse/NursePatientPanel";
import DoctorOPDPanelPage from "./pages/doctor/DoctorOPDPanelPage";
import PatientHistoryPage from "./pages/patient/PatientHistoryPage";
import MARPage from "./pages/clinical/MARPage";
import DischargeSummaryPage from "./pages/clinical/DischargeSummaryPage";
import ConsentFormPage from "./pages/clinical/ConsentFormPage";
import IPDInitialAssessmentPage from "./pages/clinical/IPDInitialAssessmentPage";
import NurseInitialAssessmentPage from "./pages/nursing/NurseInitialAssessmentPage";
import IPDAdmissionPage from "./pages/ipd/IPDAdmissionPage";
import DoctorAssessmentPage from "./pages/doctor/DoctorAssessmentPage";
import OPDAssessmentPage from "./pages/doctor/OPDAssessmentPage";
import DoctorPatientPanel from "./pages/doctor/DoctorPatientPanel";
import DoctorNotesPage from "./pages/doctor/DoctorNotesPage";
import NursingCarePlanPage from "./pages/nursing/NursingCarePlanPage";
import FallRiskAssessmentPage from "./pages/nursing/FallRiskAssessmentPage";
import PressureAreaCarePage from "./pages/nursing/PressureAreaCarePage";
import PainAssessmentPage from "./pages/nursing/PainAssessmentPage";
import NutritionalAssessmentPage from "./pages/nursing/NutritionalAssessmentPage";
import DailyNursingAssessmentPage from "./pages/nursing/DailyNursingAssessmentPage";
import PatientEducationPage from "./pages/nursing/PatientEducationPage";
import BillPrintPage from "./pages/billing/BillPrintPage";
import HospitalSettingsPage from "./pages/admin/HospitalSettingsPage";
import UserManagementPage from "./pages/admin/UserManagementPage";
import LoginPage from "./pages/auth/LoginPage";
import { HospitalSettingsProvider } from "./context/HospitalSettingsContext";


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

/* ── Inner app — uses hooks that require Router context ── */
function AppLayout({ collapsed, setCollapsed }) {
  const { user, loading } = useAuth();
  const location = useLocation();

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
      <Routes>
        <Route path="/bill-print/:billId" element={<BillPrintPage />} />
      </Routes>
    );
  }

  /* Login page — no header / sidebar */
  if (isLogin) {
    return (
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/mainpage" replace /> : <LoginPage />} />
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
        <Routes>
          {/* ── Dashboard ─────────────────────────────────────── */}
          <Route path="/dashboard1" element={<Dashboard1 />} />
          <Route path="/dash" element={<Dashboard1 />} />

          {/* ── Patient Registration ──────────────────────────── */}
          <Route path="/registration/:typedata" element={<Registration />} />
          <Route path="/registration/:typedata/:id" element={<Registration />} />
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
          <Route path="/opd/new" element={<OPDForm />} />
          <Route path="/opd/edit/:visitNumber" element={<OPDForm />} />
          <Route path="/opd/:visitNumber" element={<OPDDetails />} />

          {/* ── Emergency ─────────────────────────────────────── */}
          <Route path="/emergency-assessment" element={<EmergencyAssessmentPage />} />
          <Route path="/emergency-assessment/:uhid" element={<EmergencyAssessmentPage />} />
          <Route path="/emergency" element={<Emergencylist />} />
          <Route path="/emergency/register" element={<EmergencyRegistrationPage />} />
          <Route path="/emergency/new" element={<EmergencyForm />} />
          <Route path="/emergency/edit/:emergencyNumber" element={<EmergencyForm />} />
          <Route path="/emergency/:emergencyNumber" element={<EmergencyDetails />} />

          {/* ── Vitals ───────────────────────────────── */}
          <Route path="/updateVitalSheet" element={<UpdateVitalSheet />} />
          <Route path="/vitalSheet" element={<VitalSheet />} />
          <Route path="/vitalsView" element={<VitalsView />} />

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
          <Route path="/" element={<Navigate to="/mainpage" />} />
          <Route path="/mainpage" element={<MainPage />} />

          {/* ── Clinical pages ── */}
          <Route path="/opd-register" element={<OPDRegistrationPage />} />
          <Route path="/opd-queue" element={<NurseOPDQueuePage />} />
          <Route path="/nurse-patient-panel" element={<NursePatientPanel />} />
          <Route path="/doctor-opd-panel" element={<DoctorOPDPanelPage />} />
          <Route path="/patient-history" element={<PatientHistoryPage />} />
          <Route path="/mar" element={<MARPage />} />
          <Route path="/discharge-summary" element={<DischargeSummaryPage />} />
          <Route path="/consent-forms" element={<ConsentFormPage />} />
          <Route path="/nurse-initial-assessment" element={<NurseInitialAssessmentPage />} />
          <Route path="/ipd-initial-assessment" element={<IPDInitialAssessmentPage />} />
          <Route path="/ipd-admission" element={<IPDAdmissionPage />} />
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
          <Route path="*" element={<Navigate to="/mainpage" replace />} />
        </Routes>
      </div>
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
