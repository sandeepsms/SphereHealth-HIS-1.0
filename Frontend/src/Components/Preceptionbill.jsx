import React, { useState, useEffect } from "react";
import logo from "../assets/logowebsite11.png";
import { useParams } from "react-router-dom";
import { getdoctorprecetionbyID } from "../Services/doctorpreceptionapi";

function Preceptionbill() {
  const [doctorpreceptionUHID, setDoctorpreceptionUHID] = useState(null);

  const { UHID } = useParams();
  useEffect(() => {
    if (!UHID) return; // Agar UHID nahi mila to call mat karo

    getdoctorprecetionbyID(UHID)
      .then((res) => {
        setDoctorpreceptionUHID(res); // ✅ API data state me store
        console.log("Patient dataggg:", res);
      })
      .catch((err) => {
        console.error("Error fetching patient:", err);
      });
  }, [UHID]);

  // 🟢 Loading / Error Handling
  if (!doctorpreceptionUHID) {
    return <div className="p-3">Loading prescription data...</div>;
  }
  return (
    <div className="container my-4 p-4 border shadow-sm bg-white" style={{ width: "60%" }}>
      {/* ✅ Header */}
      <header className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
        {/* Left: Logo */}
        <div>
          <img src={logo} alt="Hospital Logo" style={{ width: "80px" }} />
        </div>

        {/* Center: Hospital Name */}
        <div className="text-center flex-grow-1">
          <h4 className="mb-0 fw-bold">SUKOON HOSPITALS</h4>
          <small>run by Spherehealth Medical Solutions Pvt. Ltd.</small>
        </div>

        {/* Right: Contact Info */}
        <div className="text-end" style={{ fontSize: "0.85rem" }}>
          <div>📞 7988807650, 0130-4052310</div>
          <div>✉️ admin@sukoonhospitals.com</div>
          <div>📍 Mohalla Jatwara, Kumaro Ki Chopal ke Samne, Sonipat (HR)</div>
        </div>
      </header>

      {/* ✅ Top Row: Patient & Invoice Info */}
      <div className="row col-md-12 d-flex">
        <div className="col-md-8 px-3">
          <p>
            <strong>Patient Name:</strong>
            {doctorpreceptionUHID.Name}
          </p>
          <p>
            <strong>Age:</strong> {doctorpreceptionUHID.Age}
          </p>
          <p>
            <strong>UHID:</strong> {doctorpreceptionUHID.UHID}
          </p>
          <p>
            <strong>Doctor Name:</strong>{doctorpreceptionUHID.DoctorName}
          </p>
          <p>
            <strong>Department:</strong> {doctorpreceptionUHID.Department}
          </p>
        </div>
        <div className="col-md-4">
          <p>
            <strong>Date:</strong> {doctorpreceptionUHID.Date}
          </p>

          <p>
            <strong>Referred By:</strong> {doctorpreceptionUHID.Referred}
          </p>
          <p>
            <strong>Speciality:</strong> ENT Specialist
          </p>
        </div>
      </div>

      <hr />

      {/* ✅ Allergy */}
      <div className="row">
        <div className="col-md-12">
          <h6 className="fw-bold text-decoration-underline ">Allergy:</h6>
          <samp> {doctorpreceptionUHID.History_of_Any_Allergy}</samp>
        </div>

        <div className="mt-2 col-md-12">
          <h6 className="fw-bold text-decoration-underline mt-2">
            History of Present Illness
          </h6>
          <samp>{doctorpreceptionUHID.History_of_Present_Illness}</samp>
        </div>
      </div>

      {/* ✅ History of Illness */}

      {/* ✅ Physical Examination */}
      <div className="mt-2 mb-4">
        <h6 className="fw-bold text-decoration-underline ">
          Physical Examination:
        </h6>
         <samp> {doctorpreceptionUHID.Physical_Examination
}</samp>
      </div>

      <div className="row mb-4">
        <div className="col-sm-3">
          {" "}
          <strong className="text-decoration-underline ">Weight:</strong>{" "}
          {doctorpreceptionUHID.weight} kgs
        </div>
        <div className="col-sm-3">
          <strong className="text-decoration-underline ">Temperature:</strong>{" "}
          {doctorpreceptionUHID.Temp} °F
        </div>
        <div className="col-sm-3">
          <strong className="text-decoration-underline ">B.P:</strong>{" "}
          {doctorpreceptionUHID.BP} mmHg
        </div>
        <div className="col-sm-3">
          <strong className="text-decoration-underline ">Pulse:</strong>{" "}
          {doctorpreceptionUHID.Pulse} bpm
        </div>
      </div>

      {/* ✅ Medicine Table */}
      <h6 className="fw-bold">Medicine Advised</h6>
      <table className="table table-bordered text-center align-middle">
        <thead className="table-light">
          <tr>
            <th>S.No</th>
            <th>Medicine</th>
            <th>Schedule</th>
            <th>Instruction</th>
            <th>Route</th>
            <th>Days</th>
          </tr>
        </thead>
        <tbody>
          {doctorpreceptionUHID.User.map((val, index) => (
            <tr key={val._id || index}>
              <td>{index + 1}</td>
              <td>{val.Medicine}</td>
              <td>{val.Schedule}</td>
              <td>{val.Instruction}</td>
              <td>{val.Route}</td>
              <td>{val.Days}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ✅ Advice */}
      <div className="mb-4">
        <h6 className="fw-bold text-decoration-underline ">Advice</h6>
        <samp className="">{doctorpreceptionUHID.Advice}</samp>
      </div>

      {/* ✅ Signature */}
      <div className="text-end">
        <p className="fw-bold mb-0">{doctorpreceptionUHID.DoctorName}</p>
        <p className="mb-0">{doctorpreceptionUHID.DoctorSpecilist}</p>
        <p className="mb-0">{doctorpreceptionUHID.DoctorDegree}</p>
        <p>State Registration No.: 53221</p>
      </div>

      {/* ✅ Footer */}
      {/* <footer className="text-center mt-4 text-muted small">
        Max Super Speciality Hospital, Shalimar Bagh | Max Healthcare Institute
        Ltd.
      </footer> */}
       <footer className="">
          Thank you for visiting SUKOON HOSPITALS
          For emergency care, please contact: 📞7988307850, 0130-4052310
        </footer>
    </div>
  );
}

export default Preceptionbill;
