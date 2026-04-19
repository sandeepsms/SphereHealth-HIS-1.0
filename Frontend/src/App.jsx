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

// ── New Billing System (billing-v3) ───────────────────────────
import PatientBilling from "./Components/billing/PatientBilling";
import ServiceMasterManager from "./Components/ServiceMaster/ServiceMasterManager";
import ChargeableServices from "./pages/services/ChargeableServices";
import BillingIntelligencePage from "./pages/billing/BillingIntelligencePage";
import BillingAuditTrailPage from "./pages/billing/BillingAuditTrailPage";
import MainPage from "./pages/mainPage/MainPage";
import NursingNotes from "./pages/nursing/NursingNotes";
// import { PopupProvider } from "./Components/contextapi/ContextApi";
import UpdateVitalSheet from "./Components/vital/UpdateVitalSheet";
import VitalSheet from "./Components/vital/VitalSheet";
import VitalsView from "./Components/vital/VitalsView";
import NursingHandoverNotes from "./pages/nursing/NursingHandoverNotes";
import { AuthProvider } from "./context/AuthContext";

// Clinical pages
import OPDRegistrationPage from "./pages/registration/OPDRegistrationPage";
import NurseOPDQueuePage from "./pages/nurse/NurseOPDQueuePage";
import NursePatientPanel from "./pages/nurse/NursePatientPanel";
import DoctorOPDPanelPage from "./pages/doctor/DoctorOPDPanelPage";
import PatientHistoryPage from "./pages/patient/PatientHistoryPage";
import MARPage from "./pages/clinical/MARPage";
import DischargeSummaryPage from "./pages/clinical/DischargeSummaryPage";
import ConsentFormPage from "./pages/clinical/ConsentFormPage";
import NurseInitialAssessmentPage from "./pages/nursing/NurseInitialAssessmentPage";
import IPDAdmissionPage from "./pages/ipd/IPDAdmissionPage";
import DoctorAssessmentPage from "./pages/doctor/DoctorAssessmentPage";
import DoctorPatientPanel from "./pages/doctor/DoctorPatientPanel";
import NursingCarePlanPage from "./pages/nursing/NursingCarePlanPage";
import FallRiskAssessmentPage from "./pages/nursing/FallRiskAssessmentPage";
import PressureAreaCarePage from "./pages/nursing/PressureAreaCarePage";
import PainAssessmentPage from "./pages/nursing/PainAssessmentPage";
import NutritionalAssessmentPage from "./pages/nursing/NutritionalAssessmentPage";
import DailyNursingAssessmentPage from "./pages/nursing/DailyNursingAssessmentPage";
import PatientEducationPage from "./pages/nursing/PatientEducationPage";
import BillPrintPage from "./pages/billing/BillPrintPage";
import HospitalSettingsPage from "./pages/admin/HospitalSettingsPage";
import { HospitalSettingsProvider } from "./context/HospitalSettingsContext";


export default function App() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <AuthProvider>
    <HospitalSettingsProvider>
    <div>
      <Router>
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

            <Route
              path="/registration/:typedata/:id"
              element={<Registration />}
            />
            {/* <Route path="/registration" element={<Registration />} /> */}

            <Route path="/allpatient" element={<PatientsTable />} />

            {/* ── Doctor Prescription ──────────────────────────── */}
            <Route
              path="/doctorpre/:UHID/:TpaId?"
              element={<DoctorPrescription />}
            />
            <Route path="/doctorpre/:UHID" element={<DoctorPrescription />} />
            <Route path="/preceptionprint/:UHID" element={<DoctorPrePrint />} />

            {/* ── Doctors ──────────────────────────────────────── */}
            <Route path="/doctor/:UHID" element={<Doctor />} />
            <Route path="/doctors" element={<DoctorListPage />} />
            <Route path="/doctors/new" element={<DoctorFormPage />} />
            <Route
              path="/doctors/:doctorId/edit"
              element={<DoctorFormPage />}
            />

              {/* ── Nursing ──────────────────────────────────────────── */} 
            <Route path="/nursing-notes" element={<NursingNotes />} />
             <Route path="/nursing-handover-notes" element={<NursingHandoverNotes />} />

            {/* ── OPD ──────────────────────────────────────────── */}
            <Route path="/opd/:UHID" element={<OPDPrint />} />
            <Route path="/opd-visit" element={<OPList />} />
            <Route path="/opd/new" element={<OPDForm />} />
            <Route path="/opd/edit/:visitNumber" element={<OPDForm />} />
            <Route path="/opd/:visitNumber" element={<OPDDetails />} />

            {/* ── Emergency ─────────────────────────────────────── */}
            <Route path="/emergency" element={<Emergencylist />} />
            <Route path="/emergency/new" element={<EmergencyForm />} />
            <Route
              path="/emergency/edit/:emergencyNumber"
              element={<EmergencyForm />}
            />
            <Route
              path="/emergency/:emergencyNumber"
              element={<EmergencyDetails />}
            />

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
            <Route
              path="/hospital-charges/create"
              element={<CreateHospitalCharges />}
            />
            <Route
              path="/hospital-charges/edit/:id"
              element={<EditHospitalCharges />}
            />

            {/* ── Old Billing (existing) ────────────────────────── */}
            <Route path="/billing" element={<BillsList />} />
            <Route
              path="/billing/create/:prescriptionId"
              element={<BillGeneration />}
            />
            <Route path="/billing/view/:billId" element={<BillGeneration />} />
            <Route path="/billing/edit/:billId" element={<BillGeneration />} />
            <Route path="/bills" element={<Navigate to="/billing" replace />} />

            {/* ── New Billing System (billing-v3) ──────────────── */}

            {/* Patient Billing — UHID se bill open hoga */}
            {/* /patient-billing          → blank, UHID search bar dikhega */}
            {/* /patient-billing/:uhid    → direct UHID se bill load */}
            <Route path="/patient-billing" element={<PatientBilling />} />
            <Route path="/patient-billing/:uhid" element={<PatientBilling />} />

            {/* Service Master — admin page, sabhi hospital services manage karo */}
            <Route path="/service-master" element={<ServiceMasterManager />} />

            {/* Chargeable Services — domain-wise service management (OPD/IPD/Emergency/DayCare) */}
            <Route path="/chargeable-services" element={<ChargeableServices />} />

            {/* ── AI Billing Intelligence ─────────────────────────── */}
            <Route path="/billing-intelligence" element={<BillingIntelligencePage />} />
            <Route path="/billing-intelligence/:uhid" element={<BillingIntelligencePage />} />

            {/* ── Billing Audit Trail ──────────────────────────────── */}
            <Route path="/billing-audit-trail" element={<BillingAuditTrailPage />} />
            <Route path="/billing-audit-trail/:uhid" element={<BillingAuditTrailPage />} />
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
            <Route path="/ipd-admission" element={<IPDAdmissionPage />} />
            <Route path="/doctor-assessment" element={<DoctorAssessmentPage />} />
            <Route path="/doctor-patient-panel" element={<DoctorPatientPanel />} />
            <Route path="/nursing-care-plan" element={<NursingCarePlanPage />} />
            <Route path="/fall-risk-assessment" element={<FallRiskAssessmentPage />} />
            <Route path="/pressure-area-care" element={<PressureAreaCarePage />} />
            <Route path="/pain-assessment" element={<PainAssessmentPage />} />
            <Route path="/nutritional-assessment" element={<NutritionalAssessmentPage />} />
            <Route path="/daily-nursing-assessment" element={<DailyNursingAssessmentPage />} />
            <Route path="/patient-education" element={<PatientEducationPage />} />
            <Route path="/hospital-settings" element={<HospitalSettingsPage />} />

            {/* ── Bill Print (standalone, covers sidebar with fixed overlay) ── */}
            <Route path="/bill-print/:billId" element={<BillPrintPage />} />

            {/* ── Default & Catch-all ───────────────────────────── */}
            {/* <Route path="/" element={<Navigate to="/dashboard1" replace />} /> */}
            {/* <Route path="*" element={<Navigate to="/dashboard1" replace />} /> */}
          </Routes>
        </div>
      </Router>
    </div>
    </HospitalSettingsProvider>
    </AuthProvider>
  );
}
