import React, { useState, useEffect } from "react";
import logo from "../../assets/logowebsite11.png";
import { useParams } from "react-router-dom";
import { getdoctorprecetionbyID } from "../../Services/doctor/doctorpreceptionapi";
import "primeicons/primeicons.css";
import "../../../css/opdbill.css";
import html2pdf from "html2pdf.js";

function Preceptionbill() {
  const [doctorpreceptionUHID, setDoctorpreceptionUHID] = useState(null);

  const { UHID } = useParams();
  useEffect(() => {
    if (!UHID) return;

    getdoctorprecetionbyID(UHID)
      .then((res) => {
        setDoctorpreceptionUHID(res);
        console.log("Patient dataggg:", res);
      })
      .catch((err) => {
        console.error("Error fetching patient:", err);
      });
  }, [UHID]);

  if (!doctorpreceptionUHID) {
    return <div className="p-3">Loading prescription data...</div>;
  }

  const handlePdf = () => {
    const element = document.getElementById("print-area");
    if (!element) return;

    html2pdf()
      .from(element)
      .set({
        margin: 10,
        filename: `DoctorPreception.pdf`,
        html2canvas: { scale: 2 },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .toPdf()
      .get("pdf")
      .then((pdf) => {
        const blobUrl = pdf.output("bloburl");

        const printWindow = window.open(blobUrl);
        if (!printWindow) return;

        printWindow.onload = () => {
          printWindow.focus();
          printWindow.print();
        };
      });
  };

  return (
    <>
      <div
        id="print-area"
        className="container my-4 p-4 border shadow-sm bg-white"
        style={{ width: "200" }}
      >
        {/* ✅ Header */}
        <header className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3 gap-5">
          {/* Left: Logo */}
          <div>
            <img src={logo} alt="Hospital Logo" style={{ width: "80px" }} />
          </div>

          {/* Center: Hospital Name */}
          <div
            className="text-center flex-grow-1"
            style={{ position: "relative", left: "50px" }}
          >
            <h4 className="mb-0 fw-bold">SUKOON HOSPITALS</h4>
            <small>run by Spherehealth Medical Solutions Pvt. Ltd.</small>
          </div>

          {/* Right: Contact Info */}
          <div
            className="text-end"
            style={{ fontSize: "0.85rem", marginLeft: "50px" }}
          >
            <div>📞 7988807650, 0130-4052310</div>
            <div>✉️ admin@sukoonhospitals.com</div>
            <small>
              📍Mohalla Jatwara,Kumaro Ki Chopal ke Samne,Sonipat(HR)
            </small>
          </div>
        </header>

        {/* ✅ Top Row: Patient & Invoice Info */}
        <div className="row col-md-12 d-flex">
          <div className="col-md-8 px-3">
            <p>
              <strong>Patient Name: </strong>
              {doctorpreceptionUHID.Name}
            </p>
            <p>
              <strong>Age:</strong> {doctorpreceptionUHID.Age}
            </p>
            <p>
              <strong>UHID:</strong> {doctorpreceptionUHID.UHID}
            </p>
            <p>
              <strong>Doctor Name:</strong>
              {doctorpreceptionUHID.DoctorName}
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
        <div className="row" style={{ padding: "18px" }}>
          <div
            className="col-md-12"
            style={{
              wordBreak: "break-all",
              overflowWrap: "anywhere",
              whiteSpace: "normal",
            }}
          >
            <h6 className="fw-bold text-decoration-underline ">Allergy:</h6>
            <samp
              style={{
                display: "block",
                wordBreak: "break-all",
                overflowWrap: "anywhere",
                whiteSpace: "normal",
                maxWidth: "100%",
                lineHeight: "1.5",
              }}
            >
              {" "}
              {doctorpreceptionUHID.History_of_Any_Allergy}
            </samp>
          </div>

          <div
            className="mt-2 col-md-12"
            style={{
              wordBreak: "break-all",
              overflowWrap: "anywhere",
              whiteSpace: "normal",
            }}
          >
            <h6 className="fw-bold text-decoration-underline mt-2">
              History of Present Illness
            </h6>
            <samp
              style={{
                display: "block",
                wordBreak: "break-all",
                overflowWrap: "anywhere",
                whiteSpace: "normal",
                maxWidth: "100%",
                lineHeight: "1.5",
              }}
            >
              {doctorpreceptionUHID.History_of_Present_Illness}
            </samp>
          </div>

          {/* ✅ History of Illness */}

          {/* ✅ Physical Examination */}
          <div
            className="mt-2 mb-4"
            style={{
              wordBreak: "break-all",
              overflowWrap: "anywhere",
              whiteSpace: "normal",
            }}
          >
            <h6 className="fw-bold text-decoration-underline ">
              Physical Examination:
            </h6>
            <samp
              style={{
                display: "block",
                wordBreak: "break-all",
                overflowWrap: "anywhere",
                whiteSpace: "normal",
                maxWidth: "100%",
                lineHeight: "1.5",
              }}
            >
              {" "}
              {doctorpreceptionUHID.Physical_Examination}
            </samp>
          </div>
        </div>

        <div className="row col-md-12 d-flex mb-4 ">
          <div className="col-md-3">
            {" "}
            <strong className="text-decoration-underline ">Weight:</strong>{" "}
            {doctorpreceptionUHID.weight} kgs
            {doctorpreceptionUHID.weight >= 80 && (
              <i className="pi pi-sort-amount-up text-danger fw-bold fs-5 mx-1"></i>
            )}
          </div>
          <div className="col-md-3">
            <strong className="text-decoration-underline ">Temperature:</strong>{" "}
            {doctorpreceptionUHID.Temp} °F
            {doctorpreceptionUHID.Temp >= 102 && (
              <i className="pi pi-sort-amount-up text-danger fw-bold fs-5 mx-1"></i>
            )}
          </div>
          <div className="col-md-3">
            <strong className="text-decoration-underline ">B.P:</strong>{" "}
            {doctorpreceptionUHID.BP} mmHg
            {doctorpreceptionUHID.BP >= 80 && (
              <i className="pi pi-sort-amount-up text-danger fw-bold fs-5 mx-1"></i>
            )}
          </div>
          <div className="col-md-3">
            <strong className="text-decoration-underline ">Pulse:</strong>{" "}
            {doctorpreceptionUHID.Pulse} bpm
            {doctorpreceptionUHID.Pulse >= 100 && (
              <i className="pi pi-sort-amount-up text-danger fw-bold fs-5 mx-1"></i>
            )}
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
          Thank you for visiting SUKOON HOSPITALS For emergency care, please
          contact: 📞7988307850, 0130-4052310
        </footer>
      </div>
      <div className="container text-end mb-2">
        <button className="btn btn-primary" onClick={handlePdf}>
          🖨️ Print
        </button>
      </div>
    </>
  );
}

export default Preceptionbill;
