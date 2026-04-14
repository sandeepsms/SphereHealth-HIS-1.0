import React, { useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import "./App.css";
import Sidebar from "./Components/Sidebar";
import Registration from "./Components/Registration";
import Header from "./Components/Header";
import PatientsTable from "./Components/PatientsTable";
import "bootstrap/dist/css/bootstrap.css";
import Doctor from "./Components/Doctor";
import Nurse from "./Components/Nurse";
import Servicebtn from "./Components/Servicebtn";
import OPDPrint from "./pages/OPD/OPDPrint";
import DoctorPrePrint from "./pages/doctor/DoctorPrePrint";
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
import PatientHistoryPage from "./pages/patient/PatientHistoryPage";

// OPD
import OPList from "././pages/OPD/OPDList";
import OPDForm from "./pages/OPD/OPDForm";
import OPDDetails from "./pages/OPD/OPDDetails";
import OPDRegistrationPage from "./pages/registration/OPDRegistrationPage";

// New clinical pages
import NurseOPDQueuePage from "./pages/nurse/NurseOPDQueuePage";
import DoctorOPDPanelPage from "./pages/doctor/DoctorOPDPanelPage";

// Emergency
import Emergencylist from "./pages/emergency/EmergencyList";
import EmergencyForm from "./pages/emergency/EmergencyForm";
import EmergencyDetails from "./pages/emergency/EmergencyDetails";

// Doctors
import DoctorFormPage from "./pages/doctor/DoctorFormPage";
import DoctorListPage from "./pages/doctor/DoctorListPage";
import DoctorForm from "./Components/doctor/DoctorForm";

import DoctorPrescription from "./Components/doctor/DoctorPreception";

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

// New Billing System
import PatientBilling from "./Components/billing/PatientBilling";
import ServiceMasterManager from "./Components/ServiceMaster/ServiceMasterManager";
import MainPage from "./pages/mainPage/MainPage";
import NursingNotes from "./pages/nursing/NursingNotes";
import UpdateVitalSheet from "./Components/vital/UpdateVitalSheet";
import VitalSheet from "./Components/vital/VitalSheet";
import VitalsView from "./Components/vital/VitalsView";
import NursingHandoverNotes from "./pages/nursing/NursingHandoverNotes";

// Phase 1: NABH Paperless Modules
import DischargeSummaryPage from "./pages/clinical/DischargeSummaryPage";
import ConsentFormPage from "./pages/clinical/ConsentFormPage";
import NursingCarePlanPage from "./pages/nursing/NursingCarePlanPage";
import MARPage from "./pages/clinical/MARPage";
import DoctorAssessmentPage from "./pages/doctor/DoctorAssessmentPage";
import OPDAssessmentPage from "./pages/doctor/OPDAssessmentPage";
import EmergencyAssessmentPage from "./pages/emergency/EmergencyAssessmentPage";
import UserManagementPage from "./pages/admin/UserManagementPage";
import IPDInitialAssessmentPage from "./pages/clinical/IPDInitialAssessmentPage";
import IPDAdmissionPage from "./pages/ipd/IPDAdmissionPage";
import NurseInitialAssessmentPage from "./pages/nursing/NurseInitialAssessmentPage";

// Auth
import LoginPage from "./pages/auth/LoginPage";
import { AuthProvider } from "./context/AuthContext";
import { PrivateRoute, RoleRoute } from "./components/auth/PrivateRoute";

/* ── Role constants ── */
const ALL_ROLES     = ["Admin","Doctor","Nurse","Receptionist","Dietician","TPA Coordinator","Pharmacist","Lab Technician"];
const ADMIN_ONLY    = ["Admin"];
const DOCTOR_ROLES  = ["Admin","Doctor"];                               // clinical doctor pages
const NURSE_ONLY    = ["Admin","Nurse"];                                // nursing-exclusive pages
const NURSE_ROLES   = ["Admin","Nurse","Doctor"];                       // MAR, vitals — both clinical
const FRONT_DESK    = ["Admin","Receptionist"];                         // registration, IPD admission, bed mgmt
const BILLING_ROLES = ["Admin","Receptionist","TPA Coordinator"];       // billing pages
const VIEW_PATIENTS = ["Admin","Doctor","Nurse","Receptionist","TPA Coordinator"]; // read-only patient access
const ALL_CLINICAL  = ["Admin","Doctor","Nurse"];                       // shared clinical pages (IPD assessment, consent, vitals view)
const TPA_ROLES     = ["Admin","TPA Coordinator"];

/* ── Shell: header + sidebar + content ── */
function AppShell({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const sidebarW = collapsed ? 64 : 258;
  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <Header />
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      <div style={{
        marginLeft: sidebarW,
        marginTop: 52,
        minHeight: "calc(100vh - 52px)",
        padding: "20px",
        background: "#f0f2f5",
        transition: "margin-left 0.25s ease",
      }}>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          {/* ── Public: Login ── */}
          <Route path="/login" element={<LoginPage />} />

          {/* ── All protected routes inside shell ── */}
          <Route path="/*" element={
            <PrivateRoute>
              <AppShellRoutes />
            </PrivateRoute>
          } />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

function AppShellRoutes() {
  const [collapsed, setCollapsed] = useState(false);
  const sidebarW = collapsed ? 64 : 258;

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      <Header />
      <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />
      <div style={{
        marginLeft: sidebarW,
        marginTop: 52,
        minHeight: "calc(100vh - 52px)",
        padding: "20px",
        background: "#f0f2f5",
        transition: "margin-left 0.25s ease",
      }}>
        <Routes>
          {/* ── Dashboard ── */}
          <Route path="/dashboard1" element={<Dashboard1 />} />
          <Route path="/dash"       element={<Dashboard1 />} />
          <Route path="/mainpage"   element={<MainPage />} />
          <Route path="/"           element={<Navigate to="/mainpage" />} />

          {/* ── IPD Admission — Front Desk only ── */}
          <Route path="/ipd-admission" element={
            <RoleRoute roles={FRONT_DESK}><IPDAdmissionPage /></RoleRoute>
          } />
          <Route path="/ipd-admission/:uhid" element={
            <RoleRoute roles={FRONT_DESK}><IPDAdmissionPage /></RoleRoute>
          } />

          {/* ── Patient Registration — Front Desk only ── */}
          <Route path="/registration/:typedata" element={
            <RoleRoute roles={FRONT_DESK}><Registration /></RoleRoute>
          } />
          <Route path="/registration/:typedata/:id" element={
            <RoleRoute roles={FRONT_DESK}><Registration /></RoleRoute>
          } />
          <Route path="/allpatient" element={
            <RoleRoute roles={VIEW_PATIENTS}><PatientsTable /></RoleRoute>
          } />

          {/* ── Doctor Prescription — Doctor only ── */}
          <Route path="/doctorpre/:UHID/:TpaId?" element={
            <RoleRoute roles={DOCTOR_ROLES}><DoctorPrescription /></RoleRoute>
          } />
          <Route path="/doctorpre/:UHID" element={
            <RoleRoute roles={DOCTOR_ROLES}><DoctorPrescription /></RoleRoute>
          } />
          <Route path="/preceptionprint/:UHID" element={
            <RoleRoute roles={DOCTOR_ROLES}><DoctorPrePrint /></RoleRoute>
          } />

          {/* ── Doctor management — Admin only ── */}
          <Route path="/doctor/:UHID" element={<RoleRoute roles={DOCTOR_ROLES}><Doctor /></RoleRoute>} />
          <Route path="/doctors"      element={<RoleRoute roles={ADMIN_ONLY}><DoctorListPage /></RoleRoute>} />
          <Route path="/doctors/new"  element={<RoleRoute roles={ADMIN_ONLY}><DoctorFormPage /></RoleRoute>} />
          <Route path="/doctors/:doctorId/edit" element={<RoleRoute roles={ADMIN_ONLY}><DoctorFormPage /></RoleRoute>} />

          {/* ── Nursing — Nurse only ── */}
          <Route path="/nursing-notes" element={
            <RoleRoute roles={NURSE_ONLY}><NursingNotes /></RoleRoute>
          } />
          <Route path="/nursing-handover-notes" element={
            <RoleRoute roles={NURSE_ONLY}><NursingHandoverNotes /></RoleRoute>
          } />
          <Route path="/nursing-care-plan" element={
            <RoleRoute roles={NURSE_ONLY}><NursingCarePlanPage /></RoleRoute>
          } />
          {/* MAR — Nurse + Doctor (both administer / review) */}
          <Route path="/mar" element={
            <RoleRoute roles={NURSE_ROLES}><MARPage /></RoleRoute>
          } />

          {/* ── OPD ── */}
          <Route path="/opd/:UHID"             element={<RoleRoute roles={DOCTOR_ROLES}><OPDPrint /></RoleRoute>} />
          <Route path="/opd-visit"             element={<RoleRoute roles={["Admin","Doctor","Receptionist"]}><OPList /></RoleRoute>} />
          <Route path="/opd/new"               element={<RoleRoute roles={FRONT_DESK}><OPDForm /></RoleRoute>} />
          <Route path="/opd/edit/:visitNumber" element={<RoleRoute roles={FRONT_DESK}><OPDForm /></RoleRoute>} />
          <Route path="/opd/:visitNumber"      element={<RoleRoute roles={["Admin","Doctor","Receptionist"]}><OPDDetails /></RoleRoute>} />

          {/* ── OPD Registration (unified UHID + revisit flow) ── */}
          <Route path="/opd-register" element={
            <RoleRoute roles={FRONT_DESK}><OPDRegistrationPage /></RoleRoute>
          } />

          {/* ── Nurse OPD Queue ── */}
          <Route path="/opd-queue" element={
            <RoleRoute roles={NURSE_ROLES}><NurseOPDQueuePage /></RoleRoute>
          } />

          {/* ── Doctor OPD Panel ── */}
          <Route path="/doctor-opd-panel" element={
            <RoleRoute roles={DOCTOR_ROLES}><DoctorOPDPanelPage /></RoleRoute>
          } />

          {/* ── Patient History ── */}
          <Route path="/patient-history" element={
            <RoleRoute roles={ALL_CLINICAL}><PatientHistoryPage /></RoleRoute>
          } />

          {/* ── Emergency ── */}
          <Route path="/emergency"                       element={<RoleRoute roles={["Admin","Doctor","Nurse","Receptionist"]}><Emergencylist /></RoleRoute>} />
          <Route path="/emergency/new"                   element={<RoleRoute roles={["Admin","Doctor","Nurse","Receptionist"]}><EmergencyForm /></RoleRoute>} />
          <Route path="/emergency/edit/:emergencyNumber" element={<RoleRoute roles={["Admin","Doctor","Nurse","Receptionist"]}><EmergencyForm /></RoleRoute>} />
          <Route path="/emergency/:emergencyNumber"      element={<RoleRoute roles={["Admin","Doctor","Nurse","Receptionist"]}><EmergencyDetails /></RoleRoute>} />

          {/* ── Vitals — Nurse updates; Doctor + Nurse view ── */}
          <Route path="/updateVitalSheet" element={
            <RoleRoute roles={NURSE_ONLY}><UpdateVitalSheet /></RoleRoute>
          } />
          <Route path="/vitalSheet"  element={<RoleRoute roles={ALL_CLINICAL}><VitalSheet /></RoleRoute>} />
          <Route path="/vitalsView"  element={<RoleRoute roles={ALL_CLINICAL}><VitalsView /></RoleRoute>} />

          {/* ── Patients Module ── */}
          <Route path="/patients"          element={<RoleRoute roles={VIEW_PATIENTS}><PatientList /></RoleRoute>} />
          <Route path="/patients/new"      element={<RoleRoute roles={FRONT_DESK}><PatientForm /></RoleRoute>} />
          <Route path="/patients/edit/:id" element={<RoleRoute roles={FRONT_DESK}><PatientForm /></RoleRoute>} />
          <Route path="/patients/:id"      element={<RoleRoute roles={VIEW_PATIENTS}><PatientDetails /></RoleRoute>} />

          {/* ── Services & TPA ── */}
          <Route path="/addservice"     element={<RoleRoute roles={TPA_ROLES}><ServiceAdd /></RoleRoute>} />
          <Route path="/addtpa"         element={<RoleRoute roles={TPA_ROLES}><AddTpa /></RoleRoute>} />
          <Route path="/ServiceAlldata" element={<RoleRoute roles={TPA_ROLES}><ServiceAlldata /></RoleRoute>} />

          {/* ── Department — Admin only ── */}
          <Route path="/department" element={<RoleRoute roles={ADMIN_ONLY}><DepartmentManagement /></RoleRoute>} />

          {/* ── Bed Management — Front Desk ── */}
          <Route path="/beds"         element={<RoleRoute roles={FRONT_DESK}><BedManagement /></RoleRoute>} />
          <Route path="/bed-visual"   element={<RoleRoute roles={ALL_CLINICAL}><BedVisualLayout /></RoleRoute>} />
          <Route path="/rooms"        element={<RoleRoute roles={FRONT_DESK}><RoomManagement /></RoleRoute>} />
          <Route path="/roomcategory" element={<RoleRoute roles={ADMIN_ONLY}><AddRoomCategory /></RoleRoute>} />
          <Route path="/wards"        element={<RoleRoute roles={FRONT_DESK}><WardManagement /></RoleRoute>} />
          <Route path="/buildings"    element={<RoleRoute roles={ADMIN_ONLY}><BuildingManagement /></RoleRoute>} />
          <Route path="/floors"       element={<RoleRoute roles={ADMIN_ONLY}><FloorManagement /></RoleRoute>} />

          {/* ── Hospital Charges — Admin only ── */}
          <Route path="/hospital-charges"          element={<RoleRoute roles={ADMIN_ONLY}><HospitalChargesList /></RoleRoute>} />
          <Route path="/hospital-charges/create"   element={<RoleRoute roles={ADMIN_ONLY}><CreateHospitalCharges /></RoleRoute>} />
          <Route path="/hospital-charges/edit/:id" element={<RoleRoute roles={ADMIN_ONLY}><EditHospitalCharges /></RoleRoute>} />

          {/* ── Billing — Billing roles ── */}
          <Route path="/billing"                        element={<RoleRoute roles={BILLING_ROLES}><BillsList /></RoleRoute>} />
          <Route path="/billing/create/:prescriptionId" element={<RoleRoute roles={BILLING_ROLES}><BillGeneration /></RoleRoute>} />
          <Route path="/billing/view/:billId"           element={<RoleRoute roles={BILLING_ROLES}><BillGeneration /></RoleRoute>} />
          <Route path="/billing/edit/:billId"           element={<RoleRoute roles={BILLING_ROLES}><BillGeneration /></RoleRoute>} />
          <Route path="/bills"                          element={<Navigate to="/billing" replace />} />
          <Route path="/patient-billing"                element={<RoleRoute roles={BILLING_ROLES}><PatientBilling /></RoleRoute>} />
          <Route path="/patient-billing/:uhid"          element={<RoleRoute roles={BILLING_ROLES}><PatientBilling /></RoleRoute>} />
          <Route path="/service-master"                 element={<RoleRoute roles={ADMIN_ONLY}><ServiceMasterManager /></RoleRoute>} />

          {/* ── NABH Clinical ── */}
          <Route path="/discharge-summary" element={
            <RoleRoute roles={DOCTOR_ROLES}><DischargeSummaryPage /></RoleRoute>
          } />
          {/* Consent Forms — Doctor + Nurse (witness role) */}
          <Route path="/consent-forms" element={
            <RoleRoute roles={ALL_CLINICAL}><ConsentFormPage /></RoleRoute>
          } />

          {/* ── Doctor Assessment — Doctor only ── */}
          <Route path="/doctor-assessment"       element={<RoleRoute roles={DOCTOR_ROLES}><DoctorAssessmentPage /></RoleRoute>} />
          <Route path="/doctor-assessment/:uhid" element={<RoleRoute roles={DOCTOR_ROLES}><DoctorAssessmentPage /></RoleRoute>} />

          {/* ── OPD Assessment — Doctor only ── */}
          <Route path="/opd-assessment"       element={<RoleRoute roles={DOCTOR_ROLES}><OPDAssessmentPage /></RoleRoute>} />
          <Route path="/opd-assessment/:uhid" element={<RoleRoute roles={DOCTOR_ROLES}><OPDAssessmentPage /></RoleRoute>} />

          {/* ── Emergency Assessment — Doctor only ── */}
          <Route path="/emergency-assessment"       element={<RoleRoute roles={DOCTOR_ROLES}><EmergencyAssessmentPage /></RoleRoute>} />
          <Route path="/emergency-assessment/:uhid" element={<RoleRoute roles={DOCTOR_ROLES}><EmergencyAssessmentPage /></RoleRoute>} />

          {/* ── Admin: User Management ── */}
          <Route path="/admin/users" element={<RoleRoute roles={ADMIN_ONLY}><UserManagementPage /></RoleRoute>} />

          {/* ── IPD Initial Assessment — Doctor + Nurse ── */}
          <Route path="/ipd-assessment"       element={<RoleRoute roles={ALL_CLINICAL}><IPDInitialAssessmentPage /></RoleRoute>} />
          <Route path="/ipd-assessment/:uhid" element={<RoleRoute roles={ALL_CLINICAL}><IPDInitialAssessmentPage /></RoleRoute>} />

          {/* ── Nurse Initial Assessment — Nurse only ── */}
          <Route path="/nurse-initial-assessment"       element={<RoleRoute roles={NURSE_ONLY}><NurseInitialAssessmentPage /></RoleRoute>} />
          <Route path="/nurse-initial-assessment/:uhid" element={<RoleRoute roles={NURSE_ONLY}><NurseInitialAssessmentPage /></RoleRoute>} />
        </Routes>
      </div>
    </div>
  );
}
