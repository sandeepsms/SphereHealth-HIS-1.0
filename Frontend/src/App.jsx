import React, { useState } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Sidebar from "./Components/Sidebar";
import Registration from "./Components/Registration";
import Header from "./Components/Header";
import PatientsTable from "./Components/PatientsTable";
// import "./App.css";
import "bootstrap/dist/css/bootstrap.css";
import Doctor from "./Components/Doctor";
import Nurse from "./Components/Nurse";
import Servicebtn from "./Components/Servicebtn";
import Opdprint from "./Components/Opdprint"
import Doctorpre from "./Components/Doctorpreception";
import ServiceAlldata from "./Components/ServiceAlldata";
import Preceptionbill from "./Components/Preceptionbill";
import BedManagementSingleFile from "./Components/BedManagementSingleFile"


export default function App() {
  const [isOpen, setIsOpen] = useState(false); // only one state

  const toggleSidebar = () => setIsOpen(!isOpen);
   

    
  return (
    <Router>
      {/* Header will have button to toggle sidebar */}
      <Header toggleSidebar={toggleSidebar} />

      {/* Sidebar */}
      <Sidebar isOpen={isOpen} toggleSidebar={toggleSidebar} />

      {/* Main content */}
      <div
        className={`p-4 transition-all duration-300 ${
          isOpen ? "ml-64" : "ml-0"
        }`}
      >
        <Routes>
          <Route path="/registration" element={<Registration />} />
          <Route path="/allpatient" element={<PatientsTable />} />
          <Route path="/doctor/:UHID" element={<Doctor />} />
            <Route path="/nurse" element={<Nurse />} />
             <Route path="*" element={<Servicebtn />} />
              <Route path="/opd/:UHID" element={<Opdprint/>} />
               <Route path="/doctorpre/:UHID/:TpaId?" element={<Doctorpre/>} />
                <Route path="/ServiceAlldata" element={<ServiceAlldata/>} />
                  <Route path="/Preceptionbill/:UHID" element={<Preceptionbill/>} />
                   <Route path="/BedManagementSingleFile/:UHID" element={<BedManagementSingleFile/>} />

               
               
          {/* Add more routes here */}
        </Routes>
      </div>
      
    </Router>
  );
}
