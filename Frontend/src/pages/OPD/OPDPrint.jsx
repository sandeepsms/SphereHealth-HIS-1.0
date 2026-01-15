import React, { useEffect, useState } from "react";
// import "../../css/opdbill.css";
import "../../../css/opdbill.css";
// import logo from "../assets/logowebsite11.png";
import logo from "../../assets/logowebsite11.png";
import { useParams } from "react-router-dom";
// import { getPatientbyID } from "../Services/userService";
import { getPatientbyID } from "../../Services/userService";
import html2pdf from "html2pdf.js";
import { Fullscreen } from "lucide-react";

const OPDPrint = () => {
  const { UHID } = useParams();
  const [patient, setPatient] = useState({});
  const today = new Date().toISOString().split("T")[0];
  console.log("--------========", patient);

  useEffect(() => {
    if (!UHID) return;
    getPatientbyID(UHID).then((res) => setPatient(res || {}));
  }, [UHID]);

  //  const handlePdf = () => {
  //   const element = document.getElementById("print-area");
  //   html2pdf()
  //     .from(element)
  //     .set({
  //       margin: 10,
  //       filename: `OPD_Bill_${patient?.UHID || "Patient"}.pdf`,
  //       html2canvas: { scale: 3 },
  //       jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
  //     })
  //     .save();
  // };

  const handlePdf = () => {
    const element = document.getElementById("print-area");
    if (!element) return;

    html2pdf()
      .from(element)
      .set({
        margin: 10,
        filename: "Registration.pdf", // required internally
        html2canvas: { scale: 2 }, // enough quality + fast
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

  const date = new Date(); // Current date

  const day = date.getDate();

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  const formattedDate = `${day} ${month} ${year}`;

  return (
    <div className="bg-light py-3">
      {/* PRINT AREA */}
      <div id="print-area" className="container opd-page bg-white p-4">
        {/* HEADER */}
        <div className="row align-items-center border-bottom pb-3 mb-3">
          <div className="col-2">
            <img src={logo} alt="logo" className="img-fluid" />
          </div>

          <div className="col-6 text-center">
            <h4 className="fw-bold mb-0">Spherehealth Medical Solutions</h4>
            <small>Mohalla Jatwara, Sonipat (HR)</small>
          </div>

          <div className="col-4 text-end small">
            <div>📞 7988307850, 0130-4052310</div>
            <div>✉️ spherehealth@sukoonhospitals.com</div>
          </div>
        </div>

        {/* PATIENT INFO */}

        <div className="border p-3 mb-3 " style={{ width: "750px" }}>
          <h6 className="fw-bold mb-3">PATIENT INFORMATION :</h6>

          <div className="row g-3 mb-2">
            <div className="col-6">
              <strong>UHID:</strong> {patient.UHID}
            </div>
            <div className="col-6">
              <strong>Name:</strong> {patient.name}
            </div>
          </div>

          <div className="row g-3 mb-2">
            <div className="col-6">
              <strong>Age / Gender:</strong> {patient.age} 77/ {patient.gender}
            </div>
            <div className="col-6">
              <strong>Mobile:</strong> {patient.contact}
            </div>
          </div>

          <div className="row g-3 mb-2">
            <div className="col-6">
              <strong>Doctor:</strong> {patient.DoctorName} (
              {patient.DoctorDegree})
            </div>
            <div className="col-6">
              <strong>Speciality:</strong> {patient.DoctorSpecilist}
            </div>
          </div>

          <div className="row g-3">
            <div className="col-6">
              <strong>Bill Date:</strong> {today}
            </div>
          </div>
        </div>

        {/* BILL TABLE */}
        <table className="table table-bordered">
          <thead className="table-light">
            <tr>
              <th>Service</th>
              <th>Amount (₹)</th>
              <th>Discount (₹)</th>
              <th>Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>OPD Consultation Charges</td>
              <td>{patient.OPDpricedata}</td>
              <td>0.00</td>
              <td>{patient.OPDpricedata}</td>
            </tr>
            <tr>
              <td colSpan="3" className="text-end fw-bold">
                Grand Total
              </td>
              <td className="fw-bold">₹ {patient.OPDpricedata}</td>
            </tr>
          </tbody>
        </table>

        {/* FOOTER */}
        <div className="text-center mt-4 border-top pt-2 small">
          <p className="mb-1">
            Thank you for visiting <strong>SUKOON HOSPITALS</strong>
          </p>
          <p className="mb-0">Emergency Contact: 📞 7988307850</p>
        </div>
      </div>
      {/* PRINT BUTTON */}z
      <div className="container text-end mb-2">
        <button className="btn btn-primary " onClick={handlePdf}>
          🖨️ Print
        </button>
      </div>
    </div>
  );
};

export default OPDPrint;
