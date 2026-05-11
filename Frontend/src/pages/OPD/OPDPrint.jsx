import React, { useEffect, useState } from "react";
import "../../../css/opdbill.css";
import logo from "../../assets/BIMSLOGO.png";
import { useParams } from "react-router-dom";
import { getPatientbyID } from "../../Services/userService";
import html2pdf from "html2pdf.js";
import { Fullscreen } from "lucide-react";

const OPDPrint = () => {
  const { UHID } = useParams();
  const [patient, setPatient] = useState({});
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    if (!UHID) return;
    // userService returns { success, data: <patient> }. Unwrap to the patient itself
    // (with a fallback for older response shapes).
    getPatientbyID(UHID).then((res) => setPatient(res?.data || res || {}));
  }, [UHID]);

  // Patient model uses fullName / contactNumber / doctor (ObjectId, populated).
  // Old code referenced patient.name, patient.contact, patient.DoctorName, etc.,
  // which never existed — derive the right values here so the receipt renders.
  const patientName = patient.fullName || patient.name || "—";
  const patientPhone = patient.contactNumber || patient.contact || "—";
  const doctorObj = (patient.doctor && typeof patient.doctor === "object") ? patient.doctor : null;
  const doctorName = doctorObj?.personalInfo?.fullName || doctorObj?.fullName || patient.DoctorName || "—";
  const doctorSpec = doctorObj?.professional?.specialization || patient.DoctorSpecilist || "—";
  const doctorDeg  = doctorObj?.professional?.qualification || patient.DoctorDegree || "";
  const consultFee = patient.OPDpricedata || doctorObj?.professional?.consultationFee || 0;

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
            <h4 className="fw-bold mb-0">BIMS</h4>
            <small>Bright Institute of Medical Sciences</small>
          </div>

          <div className="col-4 text-end small">
            <div>📞+91 - 7988307850</div>
            <div>✉️ query.bims@gmail.com</div>
            <div>Gau Shala Road, Jatawara, Sonipat - 131001</div>
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
              <strong>Name:</strong> {patientName}
            </div>
          </div>

          <div className="row g-3 mb-2">
            <div className="col-6">
              <strong>Age / Gender:</strong> {patient.age ?? "—"} / {patient.gender || "—"}
            </div>
            <div className="col-6">
              <strong>Mobile:</strong> {patientPhone}
            </div>
          </div>

          <div className="row g-3 mb-2">
            <div className="col-6">
              <strong>Doctor:</strong> {doctorName}{doctorDeg ? ` (${doctorDeg})` : ""}
            </div>
            <div className="col-6">
              <strong>Speciality:</strong> {doctorSpec}
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
              <td>{consultFee}</td>
              <td>0.00</td>
              <td>{consultFee}</td>
            </tr>
            <tr>
              <td colSpan="3" className="text-end fw-bold">
                Grand Total
              </td>
              <td className="fw-bold">₹ {consultFee}</td>
            </tr>
          </tbody>
        </table>

        {/* FOOTER */}
        <div className="text-center mt-4 border-top pt-2 small">
          <p className="mb-1">
            Thank you for visiting <strong>BIMS</strong>
          </p>
          <p className="mb-0">Emergency Contact: 📞+91 - 7988307850</p>
        </div>
      </div>
      {/* PRINT BUTTON */}
      <div className="container text-end mb-2">
        <button className="btn btn-primary " onClick={handlePdf}>
          🖨️ Print
        </button>
      </div>
    </div>
  );
};

export default OPDPrint;
