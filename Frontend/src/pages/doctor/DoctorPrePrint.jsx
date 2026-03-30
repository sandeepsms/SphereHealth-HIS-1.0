import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { toast } from "react-toastify";
import logo from "../../assets/BIMSLOGO.png";
import { prescriptionService } from "../../Services/doctors/prescriptionService";
import "../../../css/PrintStyles.css";
import "../../styles/pre.css";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

function DoctorPrePrint() {
  const [prescription, setPrescription] = useState(null);
  const [loading, setLoading] = useState(true);
  const { UHID } = useParams();
  const navigate = useNavigate();
  const printRef = useRef();

  useEffect(() => {
    if (!UHID) {
      toast.error("UHID not found");
      setTimeout(() => navigate(-1), 2000);
      return;
    }
    fetchPrescription();
  }, [UHID]);

  const fetchPrescription = async () => {
    try {
      setLoading(true);
      const response = await prescriptionService.getPrescriptionsByUHID(UHID);
      if (response.success) {
        const data = Array.isArray(response.data)
          ? response.data[0]
          : response.data;
        setPrescription(data || null);
      } else {
        toast.error("No prescription found for this UHID");
        setTimeout(() => navigate(-1), 2000);
      }
    } catch {
      toast.error("Failed to load prescription");
      setTimeout(() => navigate(-1), 2000);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (d) =>
    d ? new Date(d).toLocaleDateString("en-IN") : "N/A";

  const calculateAge = (dob) => {
    if (!dob) return "N/A";
    const b = new Date(dob),
      t = new Date();
    let a = t.getFullYear() - b.getFullYear();
    if (
      t.getMonth() - b.getMonth() < 0 ||
      (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())
    )
      a--;
    return a > 0 ? `${a} Years` : "N/A";
  };

  const handleDownloadPDF = async () => {
    if (!printRef.current) return;
    try {
      const canvas = await html2canvas(printRef.current, {
        scale: 3,
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/jpeg", 1.0);
      const pdf = new jsPDF("p", "mm", "a4");
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const ip = pdf.getImageProperties(imgData);
      let iw = pw,
        ih = (ip.height * pw) / ip.width;
      if (ih > ph) {
        ih = ph;
        iw = (ip.width * ih) / ip.height;
      }
      pdf.addImage(imgData, "JPEG", (pw - iw) / 2, 0, iw, ih);
      pdf.save(`Prescription_${prescription?.UHID || "Unknown"}.pdf`);
    } catch {
      toast.error("Failed to generate PDF");
    }
  };

  if (loading)
    return (
      <div
        className="d-flex justify-content-center align-items-center"
        style={{ height: "100vh" }}
      >
        <div className="text-center">
          <span
            className="loader"
            style={{ width: "50px", height: "50px" }}
          ></span>
          <h3 className="mt-3">Loading Prescription...</h3>
        </div>
      </div>
    );

  if (!prescription)
    return (
      <div
        className="d-flex justify-content-center align-items-center"
        style={{ height: "100vh" }}
      >
        <div className="text-center">
          <i
            className="pi pi-exclamation-triangle"
            style={{ fontSize: "4rem", color: "#f0ad4e" }}
          />
          <h3 className="mt-3">No Prescription Found</h3>
          <Button
            label="Go Back"
            icon="pi pi-arrow-left"
            onClick={() => navigate(-1)}
            className="mt-3"
          />
        </div>
      </div>
    );

  const patientAge =
    prescription?.patient?.age ||
    prescription?.age ||
    calculateAge(prescription?.patient?.dateOfBirth);

  const tdStyle = {
    border: "1px solid #ccc",
    padding: "3px 6px",
    fontSize: 10,
  };
  const thStyle = {
    border: "1px solid #d00000",
    padding: "5px 6px",
    fontSize: 10,
    background: "#d00000",
    color: "#fff",
    fontWeight: 700,
  };
  const infoTd = { padding: "2px 5px", fontSize: 10, lineHeight: "1.4" };
  const infoLabel = {
    ...infoTd,
    color: "#666",
    fontWeight: 600,
    whiteSpace: "nowrap",
  };
  const infoValue = { ...infoTd, fontWeight: 500 };

  return (
    <>
      {/* ── Action Buttons ── */}
      <div style={{ marginTop: "2%" }}>
        <div
          className="no-print text-center mb-3"
          style={{
            position: "sticky",
            top: 0,
            background: "white",
            zIndex: 1000,
            padding: "10px",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          }}
        >
          <Button
            label="Print Prescription"
            icon="pi pi-print"
            severity="success"
            onClick={() => window.print()}
            className="me-2"
            size="large"
          />
          <Button
            label="Download PDF"
            icon="pi pi-download"
            severity="info"
            onClick={handleDownloadPDF}
            className="me-2"
            size="large"
          />
          <Button
            label="Back to Dashboard"
            icon="pi pi-arrow-left"
            severity="secondary"
            outlined
            onClick={() => navigate("/dashboard1")}
            size="large"
          />
        </div>
      </div>

      {/* ── Prescription Page ── */}
      <div
        ref={printRef}
        id="printArea"
        className="prescription-page prescription-print-container print-container"
        style={{
          width: "210mm",
          height: "297mm",
          boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        <div className="prescription-page">
          {/* ── HEADER ── */}
          <header className="prescription-header-professional">
            <div className="header-left">
              <div className="hospital-row">
                <img src={logo} alt="Hospital Logo" className="hospital-logo" />
                <div className="hospital-text">
                  <h1 className="hospital-name">
                    Bright Institute Of Medical Sciences
                  </h1>
                </div>
              </div>
              <div className="contact-info">
                <p>📞 +91 - 7988307850</p>
                <p>✉️ query.bims@gmail.com</p>
                <p>📍 Gau Shala Road, Jatawara, Sonipat - 131001 (Haryana)</p>
              </div>
            </div>

            <div className="header-right">
              <h5 className="section-title-red">PATIENT INFORMATION</h5>
              <table
                className="info-table"
                style={{ borderCollapse: "collapse", width: "100%" }}
              >
                <tbody>
                  <tr>
                    <td style={infoLabel}>Patient Name:</td>
                    <td style={{ ...infoValue, fontWeight: "bold" }}>
                      {prescription.patient?.fullName ||
                        prescription.patientName ||
                        "N/A"}
                    </td>
                    <td style={infoLabel}>UHID:</td>
                    <td style={{ ...infoValue, fontWeight: "bold" }}>
                      {prescription.UHID || "N/A"}
                    </td>
                  </tr>
                  <tr>
                    <td style={infoLabel}>Age:</td>
                    <td style={infoValue}>{patientAge}</td>
                    <td style={infoLabel}>Gender:</td>
                    <td style={infoValue}>
                      {prescription.patient?.gender ||
                        prescription.gender ||
                        "N/A"}
                    </td>
                  </tr>
                  <tr>
                    <td style={infoLabel}>Father/Guardian:</td>
                    <td style={infoValue}>
                      {prescription.fatherName || "N/A"}
                    </td>
                    <td style={infoLabel}>Contact:</td>
                    <td style={infoValue}>
                      {prescription.patient?.contactNumber ||
                        prescription.contactNumber ||
                        "N/A"}
                    </td>
                  </tr>
                  <tr>
                    <td style={infoLabel}>Department:</td>
                    <td style={{ ...infoValue, fontWeight: "bold" }}>
                      {prescription.department || "N/A"}
                    </td>
                    <td style={infoLabel}>Date:</td>
                    <td style={infoValue}>
                      {formatDate(prescription.createdAt)}
                    </td>
                  </tr>
                  <tr>
                    <td style={infoLabel}>Referred By:</td>
                    <td style={infoValue}>
                      {prescription.patient?.referredBy ||
                        prescription.referredBy ||
                        "N/A"}
                    </td>
                    <td style={infoLabel}>Reg. Type:</td>
                    <td style={infoValue}>
                      {prescription.registrationType || "OPD"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </header>

          {/* ── CLINICAL DETAILS ── */}
          {(prescription.clinicalDetails?.historyOfAllergy ||
            prescription.clinicalDetails?.historyOfPresentIllness ||
            prescription.clinicalDetails?.physicalExamination) && (
            <section
              className="clinical-section"
              style={{ position: "relative", bottom: "25px" }}
            >
              <h5 className="section-title-red">CLINICAL DETAILS</h5>
              {prescription.clinicalDetails?.historyOfAllergy && (
                <div className="clinical-item">
                  <strong>History of Allergy:</strong>
                  <p>{prescription.clinicalDetails.historyOfAllergy}</p>
                </div>
              )}
              {prescription.clinicalDetails?.historyOfPresentIllness && (
                <div className="clinical-item">
                  <strong>History of Present Illness:</strong>
                  <p>{prescription.clinicalDetails.historyOfPresentIllness}</p>
                </div>
              )}
              {prescription.clinicalDetails?.physicalExamination && (
                <div className="clinical-item">
                  <strong>Physical Examination:</strong>
                  <p>{prescription.clinicalDetails.physicalExamination}</p>
                </div>
              )}
            </section>
          )}

          {/* ── VITALS ── */}
          {prescription.vitals &&
            Object.values(prescription.vitals).some((v) => v) && (
              <section
                className="vitals-section"
                style={{ position: "relative", bottom: "15px" }}
              >
                <h5 className="section-title-red">VITALS</h5>
                <div className="vitals-row">
                  {prescription.vitals.weight && (
                    <span className="vital-badge">
                      <strong>Weight:</strong> {prescription.vitals.weight} Kgs
                    </span>
                  )}
                  {prescription.vitals.temperature && (
                    <span className="vital-badge">
                      <strong>Temp:</strong> {prescription.vitals.temperature}°F
                    </span>
                  )}
                  {prescription.vitals.bloodPressure && (
                    <span className="vital-badge">
                      <strong>BP:</strong> {prescription.vitals.bloodPressure}{" "}
                      mmHg
                    </span>
                  )}
                  {prescription.vitals.pulse && (
                    <span className="vital-badge">
                      <strong>Pulse:</strong> {prescription.vitals.pulse} bpm
                    </span>
                  )}
                  {prescription.vitals.spo2 && (
                    <span className="vital-badge">
                      <strong>SpO2:</strong> {prescription.vitals.spo2}%
                    </span>
                  )}
                </div>
              </section>
            )}

          {/* ── DIAGNOSIS ── */}
          {prescription.provisionalDiagnosis && (
            <section className="diagnosis-section">
              <h5 className="section-title-red">PROVISIONAL DIAGNOSIS</h5>
              <div className="diagnosis-box">
                {prescription.provisionalDiagnosis}
              </div>
            </section>
          )}

          {/* ── MEDICINES ── */}
          {prescription.medicines?.length > 0 && (
            <section className="medicines-section">
              <h5 className="section-title-red">MEDICINE ADVISED</h5>
              <table className="table table-bordered border-dark medicine-table-professional">
                <thead className="table-light">
                  <tr>
                    <th
                      className="text-center"
                      style={{ width: "5%", fontSize: 10 }}
                    >
                      S.No
                    </th>
                    <th style={{ width: "25%", fontSize: 10 }}>
                      Medicine Name
                    </th>
                    <th
                      className="text-center"
                      style={{ width: "15%", fontSize: 10 }}
                    >
                      Schedule
                    </th>
                    <th style={{ width: "20%", fontSize: 10 }}>Instruction</th>
                    <th
                      className="text-center"
                      style={{ width: "15%", fontSize: 10 }}
                    >
                      Route
                    </th>
                    <th
                      className="text-center"
                      style={{ width: "15%", fontSize: 10 }}
                    >
                      Days
                    </th>
                  </tr>
                </thead>
                <tbody style={{ borderColor: "gray" }}>
                  {prescription.medicines.map((m, i) => (
                    <tr key={i} style={{ fontSize: 10 }}>
                      <td className="text-center">{i + 1}</td>
                      <td>{m.medicineName || "N/A"}</td>
                      <td className="text-center">{m.schedule || "—"}</td>
                      <td>{m.instruction || "—"}</td>
                      <td className="text-center">{m.route || "—"}</td>
                      <td className="text-center">{m.days || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* ── INVESTIGATIONS (no price) ── */}
          {prescription.investigations?.length > 0 && (
            <section className="investigations-section">
              <h5 className="section-title-red">INVESTIGATION ADVISED</h5>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "5%" }}>S.No</th>
                    <th style={{ width: "20%" }}>Code</th>
                    <th>Test Name</th>
                    <th style={{ width: "18%" }}>Performed At</th>
                  </tr>
                </thead>
                <tbody>
                  {(typeof prescription.investigations === "string"
                    ? prescription.investigations
                        .split(",")
                        .map((n) => ({ investigationName: n.trim() }))
                    : prescription.investigations
                  ).map((inv, i) => (
                    <tr key={i}>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        {i + 1}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "monospace" }}>
                        {inv.investigationCode || "—"}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>
                        {inv.investigationName ||
                          (typeof inv === "string" ? inv : "—")}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        {inv.investigationId?.performedAt ? (
                          <span
                            style={{
                              background:
                                inv.investigationId.performedAt === "EXTERNAL"
                                  ? "#fef3c7"
                                  : "#d1fae5",
                              color:
                                inv.investigationId.performedAt === "EXTERNAL"
                                  ? "#92400e"
                                  : "#065f46",
                              borderRadius: 4,
                              padding: "1px 6px",
                              fontSize: 9,
                              fontWeight: 700,
                            }}
                          >
                            {inv.investigationId.performedAt}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* ── SERVICES ── */}
          {prescription.selectedServices?.length > 0 && (
            <section className="services-section" style={{ marginBottom: 8 }}>
              <h5 className="section-title-red">SERVICES ADVISED</h5>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "5%" }}>S.No</th>
                    <th style={{ width: "20%" }}>Code</th>
                    <th>Service Name</th>
                  </tr>
                </thead>
                <tbody>
                  {prescription.selectedServices.map((s, i) => (
                    <tr key={i}>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        {i + 1}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "monospace" }}>
                        {s.serviceCode || "—"}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>
                        {s.serviceName || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* ── ADVICE ── */}
          {prescription.advice && (
            <section className="advice-section">
              <h5 className="section-title-red">ADVICE & FOLLOW-UP</h5>
              <div className="advice-box">{prescription.advice}</div>
            </section>
          )}

          {/* ── DOCTOR SIGNATURE ── */}
          <section className="doctor-signature-professional">
            <div className="header-right-section"></div>
            <div className="doctor-details-box" style={{ textAlign: "right" }}>
              <div className="signature-line"></div>
              <p className="signature-label">Doctor's Signature</p>
              <p>
                <strong>Doctor:</strong>{" "}
                {prescription.doctor?.personalInfo?.firstName || ""}{" "}
                {prescription.doctor?.personalInfo?.lastName || ""}
              </p>
              <p>
                <strong>Specialization:</strong>{" "}
                {prescription.doctor?.professional?.specialization || "N/A"}
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export default DoctorPrePrint;
