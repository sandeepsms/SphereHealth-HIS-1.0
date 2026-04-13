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

// OPD
import OPList from "././pages/OPD/OPDList";
import OPDForm from "./pages/OPD/OPDForm";
import OPDDetails from "./pages/OPD/OPDDetails";

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

// Auth
import LoginPage from "./pages/auth/LoginPage";
import { AuthProvider } from "./context/AuthContext";
import { PrivateRoute, RoleRoute } from "./components/auth/PrivateRoute";

/* ── Role constants ── */
const ALL_CLINICAL = ["Admin", "Doctor", "Nurse", "Receptionist", "Dietician", "TPA Coordinator"];
const DOCTOR_ROLES  = ["Admin", "Doctor"];
const NURSE_ROLES   = ["Admin", "Nurse", "Doctor"];
const BILLING_ROLES = ["Admin", "Receptionist", "TPA Coordinator"];
const ADMIN_RECEPT  = ["Admin", "Receptionist"];
const ALL_ROLES     = ["Admin", "Doctor", "Nurse", "Receptionist", "Dietician", "TPA Coordinator", "Pharmacist", "Lab Technician"];

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

          {/* ── Patient Registration — Receptionist + Admin ── */}
          <Route path="/registration/:typedata" element={
            <RoleRoute roles={ADMIN_RECEPT}><Registration /></RoleRoute>
          } />
          <Route path="/registration/:typedata/:id" element={
            <RoleRoute roles={ADMIN_RECEPT}><Registration /></RoleRoute>
          } />
          <Route path="/allpatient" element={
            <RoleRoute roles={ALL_ROLES}><PatientsTable /></RoleRoute>
          } />

          {/* ── Doctor Prescription ── */}
          <Route path="/doctorpre/:UHID/:TpaId?" element={
            <RoleRoute roles={DOCTOR_ROLES}><DoctorPrescription /></RoleRoute>
          } />
          <Route path="/doctorpre/:UHID" element={
            <RoleRoute roles={DOCTOR_ROLES}><DoctorPrescription /></RoleRoute>
          } />
          <Route path="/preceptionprint/:UHID" element={<DoctorPrePrint />} />

          {/* ── Doctor management ── */}
          <Route path="/doctor/:UHID" element={<Doctor />} />
          <Route path="/doctors"      element={<DoctorListPage />} />
          <Route path="/doctors/new"  element={
            <RoleRoute roles={["Admin"]}><DoctorFormPage /></RoleRoute>
          } />
          <Route path="/doctors/:doctorId/edit" element={
            <RoleRoute roles={["Admin"]}><DoctorFormPage /></RoleRoute>
          } />

          {/* ── Nursing — Nurse + Doctor + Admin ── */}
          <Route path="/nursing-notes" element={
            <RoleRoute roles={NURSE_ROLES}><NursingNotes /></RoleRoute>
          } />
          <Route path="/nursing-handover-notes" element={
            <RoleRoute roles={NURSE_ROLES}><NursingHandoverNotes /></RoleRoute>
          } />
          <Route path="/nursing-care-plan" element={
            <RoleRoute roles={NURSE_ROLES}><NursingCarePlanPage /></RoleRoute>
          } />
          <Route path="/mar" element={
            <RoleRoute roles={NURSE_ROLES}><MARPage /></RoleRoute>
          } />

          {/* ── OPD ── */}
          <Route path="/opd/:UHID"              element={<OPDPrint />} />
          <Route path="/opd-visit"              element={<OPList />} />
          <Route path="/opd/new"                element={
            <RoleRoute roles={ADMIN_RECEPT}><OPDForm /></RoleRoute>
          } />
          <Route path="/opd/edit/:visitNumber"  element={
            <RoleRoute roles={ADMIN_RECEPT}><OPDForm /></RoleRoute>
          } />
          <Route path="/opd/:visitNumber"       element={<OPDDetails />} />

          {/* ── Emergency ── */}
          <Route path="/emergency"                        element={<Emergencylist />} />
          <Route path="/emergency/new"                    element={<EmergencyForm />} />
          <Route path="/emergency/edit/:emergencyNumber"  element={<EmergencyForm />} />
          <Route path="/emergency/:emergencyNumber"       element={<EmergencyDetails />} />

          {/* ── Vitals — all clinical ── */}
          <Route path="/updateVitalSheet" element={
            <RoleRoute roles={NURSE_ROLES}><UpdateVitalSheet /></RoleRoute>
          } />
          <Route path="/vitalSheet" element={<VitalSheet />} />
          <Route path="/vitalsView" element={<VitalsView />} />

          {/* ── Patients Module ── */}
          <Route path="/patients"            element={<PatientList />} />
          <Route path="/patients/new"        element={<PatientForm />} />
          <Route path="/patients/edit/:id"   element={<PatientForm />} />
          <Route path="/patients/:id"        element={<PatientDetails />} />

          {/* ── Services & TPA ── */}
          <Route path="/addservice"    element={
            <RoleRoute roles={["Admin", "TPA Coordinator"]}><ServiceAdd /></RoleRoute>
          } />
          <Route path="/addtpa"        element={
            <RoleRoute roles={["Admin", "TPA Coordinator"]}><AddTpa /></RoleRoute>
          } />
          <Route path="/ServiceAlldata" element={<ServiceAlldata />} />

          {/* ── Department ── */}
          <Route path="/department" element={
            <RoleRoute roles={["Admin"]}><DepartmentManagement /></RoleRoute>
          } />

          {/* ── Bed Management — Admin + Receptionist ── */}
          <Route path="/beds"         element={<RoleRoute roles={ADMIN_RECEPT}><BedManagement /></RoleRoute>} />
          <Route path="/bed-visual"   element={<BedVisualLayout />} />
          <Route path="/rooms"        element={<RoleRoute roles={ADMIN_RECEPT}><RoomManagement /></RoleRoute>} />
          <Route path="/roomcategory" element={<RoleRoute roles={["Admin"]}><AddRoomCategory /></RoleRoute>} />
          <Route path="/wards"        element={<RoleRoute roles={ADMIN_RECEPT}><WardManagement /></RoleRoute>} />
          <Route path="/buildings"    element={<RoleRoute roles={["Admin"]}><BuildingManagement /></RoleRoute>} />
          <Route path="/floors"       element={<RoleRoute roles={["Admin"]}><FloorManagement /></RoleRoute>} />

          {/* ── Hospital Charges — Admin ── */}
          <Route path="/hospital-charges"        element={<RoleRoute roles={["Admin"]}><HospitalChargesList /></RoleRoute>} />
          <Route path="/hospital-charges/create" element={<RoleRoute roles={["Admin"]}><CreateHospitalCharges /></RoleRoute>} />
          <Route path="/hospital-charges/edit/:id" element={<RoleRoute roles={["Admin"]}><EditHospitalCharges /></RoleRoute>} />

          {/* ── Billing — Billing roles ── */}
          <Route path="/billing"                        element={<RoleRoute roles={BILLING_ROLES}><BillsList /></RoleRoute>} />
          <Route path="/billing/create/:prescriptionId" element={<RoleRoute roles={BILLING_ROLES}><BillGeneration /></RoleRoute>} />
          <Route path="/billing/view/:billId"           element={<RoleRoute roles={BILLING_ROLES}><BillGeneration /></RoleRoute>} />
          <Route path="/billing/edit/:billId"           element={<RoleRoute roles={BILLING_ROLES}><BillGeneration /></RoleRoute>} />
          <Route path="/bills"                          element={<Navigate to="/billing" replace />} />
          <Route path="/patient-billing"                element={<RoleRoute roles={BILLING_ROLES}><PatientBilling /></RoleRoute>} />
          <Route path="/patient-billing/:uhid"          element={<RoleRoute roles={BILLING_ROLES}><PatientBilling /></RoleRoute>} />
          <Route path="/service-master"                 element={<RoleRoute roles={["Admin"]}><ServiceMasterManager /></RoleRoute>} />

          {/* ── NABH Clinical ── */}
          <Route path="/discharge-summary" element={
            <RoleRoute roles={DOCTOR_ROLES}><DischargeSummaryPage /></RoleRoute>
          } />
          <Route path="/consent-forms" element={<ConsentFormPage />} />

          {/* ── Doctor Assessment ── */}
          <Route path="/doctor-assessment"       element={<RoleRoute roles={DOCTOR_ROLES}><DoctorAssessmentPage /></RoleRoute>} />
          <Route path="/doctor-assessment/:uhid" element={<RoleRoute roles={DOCTOR_ROLES}><DoctorAssessmentPage /></RoleRoute>} />

          {/* ── OPD Assessment (NABH) ── */}
          <Route path="/opd-assessment"        element={<RoleRoute roles={DOCTOR_ROLES}><OPDAssessmentPage /></RoleRoute>} />
          <Route path="/opd-assessment/:uhid"  element={<RoleRoute roles={DOCTOR_ROLES}><OPDAssessmentPage /></RoleRoute>} />

          {/* ── Emergency Assessment (NABH) ── */}
          <Route path="/emergency-assessment"        element={<RoleRoute roles={DOCTOR_ROLES}><EmergencyAssessmentPage /></RoleRoute>} />
          <Route path="/emergency-assessment/:uhid"  element={<RoleRoute roles={DOCTOR_ROLES}><EmergencyAssessmentPage /></RoleRoute>} />

          {/* ── Admin: User Management ── */}
          <Route path="/admin/users" element={<RoleRoute roles={["Admin"]}><UserManagementPage /></RoleRoute>} />

          {/* ── IPD Initial Assessment ── */}
          <Route path="/ipd-assessment"        element={<RoleRoute roles={ALL_CLINICAL}><IPDInitialAssessmentPage /></RoleRoute>} />
          <Route path="/ipd-assessment/:uhid"  element={<RoleRoute roles={ALL_CLINICAL}><IPDInitialAssessmentPage /></RoleRoute>} />
        </Routes>
      </div>
    </div>
  );
}
