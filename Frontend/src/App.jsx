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
// import OPDPrint from "./Components/Opdprint";
import OPDPrint from "./pages/OPD/OPDPrint";
import DoctorPrePrint from "./pages/doctor/DoctorPrePrint";
import ServiceAlldata from "./Components/ServiceAlldata";
// import Preceptionbill from "./Components/Preceptionbill";
import BedManagementSingleFile from "./Components/BedManagementSingleFile";
import DepartmentManagement from "../src/pages/Department/DepartmentManagement";

// Import Bed Management Pages
import BedManagement from "./pages/BedManagement";
import RoomManagement from "./pages/RoomManagement";
import WardManagement from "./pages/WardManagement";
import BuildingManagement from "./pages/BuildingManagement";
import FloorManagement from "./pages/FloorManagement";

import BedVisualLayout from "./Components/bed/BedVisualLayout";

// import Dashboard from "./pages/Dashboard";
import Dashboard1 from "./pages/patient/Dashboard";
// import Dashboard from "./pages/patient/Dashboard";

// Import PrimeReact CSS (for bed management pages)
import "primereact/resources/themes/lara-light-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import "primeflex/primeflex.css";

//patients
import PatientList from "./pages/patient/PatientList";
import PatientForm from "./pages/patient/PatientForm";
import PatientDetails from "./pages/patient/PatientDetails";

//opd
import OPList from "././pages/OPD/OPDList";
import OPDForm from "./pages/OPD/OPDForm";
import OPDDetails from "./pages/OPD/OPDDetails";

//emergency
import Emergencylist from "./pages/emergency/EmergencyList";
import EmergencyForm from "./pages/emergency/EmergencyForm";
import EmergencyDetails from "./pages/Emergency/EmergencyDetails";

//doctors
import DoctorFormPage from "./pages/doctor/DoctorFormPage";
import DoctorListPage from "./pages/doctor/DoctorListPage";
import DoctorForm from "./Components/doctor/DoctorForm";

import DoctorPreception from "./Components/doctor/DoctorPreception";
import ServiceAdd from "./Components/Tpa/TPAServiceManagement";

import AddTpa from "./Components/Tpa/AddTpa";

//hospital charges
import HospitalChargesList from "./pages/charges/HospitalChargesList";
import CreateHospitalCharges from "./pages/charges/CreateHospitalCharges";
import EditHospitalCharges from "./pages/charges/EditHospitalCharges";

//billing
import BillsList from "./pages/billing/BillsList";
import BillGeneration from "./pages/billing/Billgeneration";

//admissions
// import AdmissionList from "./pages/admissions/AdmissionList";
// import AdmissionFoout from "./pages/admissions/AdmissionFoout";
// import AdmissionDetails from "./pages/admissions/AdmissionDetails";

export default function App() {
  const [isOpen, setIsOpen] = useState(false);

  const toggleSidebar = () => setIsOpen(!isOpen);

  return (
    <Router>
      <Header toggleSidebar={toggleSidebar} />

      <Sidebar isOpen={isOpen} toggleSidebar={toggleSidebar} />

      <div
        className={`transition-all duration-300 ${isOpen ? "ml-64" : "ml-0"}`}
        style={{
          minHeight: "calc(100vh - 64px)",
          padding: "20px",
        }}
      >
        <Routes>
          {/* Dashboard */}
          <Route path="/dashboard1" element={<Dashboard1 />} />
          <Route path="/dash" element={<Dashboard1 />} />
          {/* ✅ Patient Registration Routes - Edit route MUST come before the base route */}
          <Route path="/registration/:id" element={<Registration />} />
          <Route path="/registration" element={<Registration />} />
          <Route path="/allpatient" element={<PatientsTable />} />
          {/* ✅ CRITICAL: Prescription routes BEFORE catch-all */}
          <Route
            path="/doctorpre/:UHID/:TpaId?"
            element={<DoctorPreception />}
          />
          <Route path="/doctorpre/:UHID" element={<DoctorPreception />} />
          <Route path="/preceptionprint/:UHID" element={<DoctorPrePrint />} />
          {/* Doctor & Medical Staff */}
          <Route path="/doctor/:UHID" element={<Doctor />} />
          <Route path="/doctors" element={<DoctorListPage />} />
          <Route path="/doctors/new" element={<DoctorFormPage />} />
          <Route path="/doctors/:doctorId/edit" element={<DoctorFormPage />} />
          <Route path="/nurse" element={<Nurse />} />
          {/* OPD */}
          <Route path="/opd/:UHID" element={<OPDPrint />} />
          <Route path="/opd" element={<OPList />} />
          <Route path="/opd/new" element={<OPDForm />} />
          <Route path="/opd/edit/:visitNumber" element={<OPDForm />} />
          <Route path="/opd/:visitNumber" element={<OPDDetails />} />
          {/* Emergency */}
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
          {/* Patients Module */}
          <Route path="/patients" element={<PatientList />} />
          <Route path="/patients/new" element={<PatientForm />} />
          <Route path="/patients/edit/:id" element={<PatientForm />} />
          <Route path="/patients/:id" element={<PatientDetails />} />
          {/* Services & TPA */}
          <Route path="/addservice" element={<ServiceAdd />} />
          <Route path="/addtpa" element={<AddTpa />} />
          <Route path="/ServiceAlldata" element={<ServiceAlldata />} />
          {/* Department */}
          <Route path="/department" element={<DepartmentManagement />} />
          {/* Bed Management */}
          <Route path="/beds" element={<BedManagement />} />
          <Route path="/bed-visual" element={<BedVisualLayout />} />
          <Route path="/rooms" element={<RoomManagement />} />
          <Route path="/wards" element={<WardManagement />} />
          <Route path="/buildings" element={<BuildingManagement />} />
          <Route path="/floors" element={<FloorManagement />} />

          {/* Hospital Charges Routes */}
          <Route path="/hospital-charges" element={<HospitalChargesList />} />
          <Route
            path="/hospital-charges/create"
            element={<CreateHospitalCharges />}
          />
          <Route
            path="/hospital-charges/edit/:id"
            element={<EditHospitalCharges />}
          />

          {/* BILLING ROUTES - NEW */}
          <Route path="/billing" element={<BillsList />} />

          <Route
            path="/billing/create/:prescriptionId"
            element={<BillGeneration />}
          />
          <Route path="/billing/view/:billId" element={<BillGeneration />} />
          <Route path="/billing/edit/:billId" element={<BillGeneration />} />
          <Route path="/bills" element={<Navigate to="/billing" replace />} />

          {/* Default & Catch-all Routes */}
          {/* <Route path="/" element={<Navigate to="/dashboard1" replace />} />
          <Route path="*" element={<Navigate to="/dashboard1" replace />} /> */}
        </Routes>
      </div>
    </Router>
  );
}
