import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { toast } from "react-toastify";
import logo from "../../assets/logowebsite11.png";
import { prescriptionService } from "../../Services/doctor/prescriptionService";
import "../../styles/PrintStyles.css";

function DoctorPrePrint() {
  const [prescription, setPrescription] = useState(null);
  const [loading, setLoading] = useState(true);
  const { UHID } = useParams();
  const navigate = useNavigate();
  const printRef = useRef();

  useEffect(() => {
    console.log("=== DoctorPrePrint Component Loaded ===");
    console.log("UHID from URL:", UHID);

    if (!UHID) {
      console.error("❌ UHID not found in URL");
      toast.error("UHID not found");
      setTimeout(() => navigate(-1), 2000);
      return;
    }

    fetchPrescription();
  }, [UHID]);

  const fetchPrescription = async () => {
    try {
      setLoading(true);
      console.log("🔄 Fetching prescription for UHID:", UHID);

      const response = await prescriptionService.getPrescriptionsByUHID(UHID);

      console.log("📋 Prescription API Response:", response);

      if (response.success) {
        const prescriptionData = Array.isArray(response.data)
          ? response.data[0]
          : response.data;

        console.log("✅ Prescription Data:", prescriptionData);

        if (prescriptionData) {
          setPrescription(prescriptionData);
        } else {
          console.error("❌ No prescription data found");
          toast.error("No prescription found for this UHID");
          setTimeout(() => navigate(-1), 2000);
        }
      } else {
        console.error("❌ API returned success: false");
        toast.error("No prescription found for this UHID");
        setTimeout(() => navigate(-1), 2000);
      }
    } catch (error) {
      console.error("❌ Error fetching prescription:", error);
      console.error("Error details:", error.response?.data);
      toast.error("Failed to load prescription");
      setTimeout(() => navigate(-1), 2000);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-IN");
  };

  // ✅ Calculate age from date of birth
  const calculateAge = (dateOfBirth) => {
    if (!dateOfBirth) return "N/A";

    try {
      const dob = new Date(dateOfBirth);
      const today = new Date();

      let age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();

      // Adjust age if birthday hasn't occurred this year
      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < dob.getDate())
      ) {
        age--;
      }

      return age > 0 ? `${age} Years` : "N/A";
    } catch (error) {
      console.error("Error calculating age:", error);
      return "N/A";
    }
  };

  if (loading) {
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
  }

  if (!prescription) {
    return (
      <div
        className="d-flex justify-content-center align-items-center"
        style={{ height: "100vh" }}
      >
        <div className="text-center">
          <i
            className="pi pi-exclamation-triangle"
            style={{ fontSize: "4rem", color: "#f0ad4e" }}
          ></i>
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
  }

  console.log("🖨️ Rendering prescription:", prescription);

  // Get age - try multiple sources
  const patientAge =
    prescription.patient?.age ||
    prescription.age ||
    calculateAge(prescription.patient?.dateOfBirth);

  return (
    <>
      {/* Print Button - Hidden on print */}
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
          onClick={handlePrint}
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

      {/* Printable Content */}
      <div ref={printRef} className="prescription-print-container">
        <div className="prescription-page">
          {/* Professional Header with Red Design */}
          <header className="prescription-header-professional">
            <div className="header-left-section">
              <div className="logo-section">
                <img src={logo} alt="Hospital Logo" className="hospital-logo" />
              </div>
            </div>

            <div className="header-center-section">
              <h1 className="hospital-name-main">SUKOON HOSPITALS</h1>
              <p className="hospital-subtitle">
                run by Spherehealth Medical Solutions Pvt. Ltd.
              </p>
            </div>

            <div className="header-right-section">
              <div className="contact-info">
                <p>
                  <strong>📞</strong> 7988807650, 0130-4052310
                </p>
                <p>
                  <strong>✉️</strong> admin@sukoonhospitals.com
                </p>
                <p>
                  <strong>📍</strong> Mohalla Jatwara, Kumaro Ki Chopal,
                  <br />
                  Sonipat (Haryana)
                </p>
              </div>
            </div>
          </header>

          <div className="red-divider"></div>

          {/* Patient Information - Compact Table Format */}
          <section className="patient-info-compact">
            <h5 className="section-title-red">PATIENT INFORMATION</h5>
            <table className="info-table">
              <tbody>
                <tr>
                  <td className="label-cell">Patient Name:</td>
                  <td className="value-cell">
                    {prescription.patient?.fullName ||
                      prescription.patientName ||
                      "N/A"}
                  </td>
                  <td className="label-cell">UHID:</td>
                  <td className="value-cell">{prescription.UHID || "N/A"}</td>
                </tr>
                <tr>
                  <td className="label-cell">Age:</td>
                  <td className="value-cell">{patientAge}</td>
                  <td className="label-cell">Gender:</td>
                  <td className="value-cell">
                    {prescription.patient?.gender ||
                      prescription.gender ||
                      "N/A"}
                  </td>
                </tr>
                <tr>
                  <td className="label-cell">Father/Guardian:</td>
                  <td className="value-cell">
                    {prescription.fatherName || "N/A"}
                  </td>
                  <td className="label-cell">Contact:</td>
                  <td className="value-cell">
                    {prescription.patient?.contactNumber ||
                      prescription.contactNumber ||
                      "N/A"}
                  </td>
                </tr>
                <tr>
                  <td className="label-cell">Department:</td>
                  <td className="value-cell">
                    {prescription.patient?.department?.departmentName ||
                      prescription.department?.departmentName ||
                      prescription.department ||
                      "N/A"}
                  </td>
                  <td className="label-cell">Date:</td>
                  <td className="value-cell">
                    {formatDate(prescription.createdAt)}
                  </td>
                </tr>
                <tr>
                  <td className="label-cell">Type:</td>
                  <td className="value-cell">
                    {prescription.registrationType || "OPD"}
                  </td>
                  {prescription.referredBy && (
                    <>
                      <td className="label-cell">Referred By:</td>
                      <td className="value-cell">{prescription.referredBy}</td>
                    </>
                  )}
                </tr>
              </tbody>
            </table>
          </section>

          {/* Clinical Details */}
          {(prescription.clinicalDetails?.historyOfAllergy ||
            prescription.clinicalDetails?.historyOfPresentIllness ||
            prescription.clinicalDetails?.physicalExamination) && (
            <section className="clinical-section">
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

          {/* Vitals - Compact Format */}
          {prescription.vitals &&
            Object.values(prescription.vitals).some((val) => val) && (
              <section className="vitals-section">
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
                </div>
              </section>
            )}

          {/* Diagnosis */}
          {prescription.provisionalDiagnosis && (
            <section className="diagnosis-section">
              <h5 className="section-title-red">PROVISIONAL DIAGNOSIS</h5>
              <div className="diagnosis-box">
                {prescription.provisionalDiagnosis}
              </div>
            </section>
          )}

          {/* Medicines */}
          {prescription.medicines && prescription.medicines.length > 0 && (
            <section className="medicines-section">
              <h5 className="section-title-red">MEDICINE ADVISED</h5>
              <table className="medicine-table-professional">
                <thead>
                  <tr>
                    <th style={{ width: "5%" }}>S.No</th>
                    <th style={{ width: "30%" }}>Medicine Name</th>
                    <th style={{ width: "15%" }}>Schedule</th>
                    <th style={{ width: "20%" }}>Instruction</th>
                    <th style={{ width: "15%" }}>Route</th>
                    <th style={{ width: "15%" }}>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {prescription.medicines.map((medicine, index) => (
                    <tr key={index}>
                      <td className="text-center">{index + 1}</td>
                      <td>{medicine.medicineName || "N/A"}</td>
                      <td className="text-center">
                        {medicine.schedule || "-"}
                      </td>
                      <td>{medicine.instruction || "-"}</td>
                      <td className="text-center">{medicine.route || "-"}</td>
                      <td className="text-center">{medicine.days || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Investigations */}
          {prescription.investigations &&
            prescription.investigations.length > 0 && (
              <section className="investigations-section">
                <h5 className="section-title-red">INVESTIGATION ADVISED</h5>
                <div className="investigations-grid">
                  {prescription.investigations.map((investigation, index) => (
                    <div key={index} className="investigation-badge">
                      ✓{" "}
                      {investigation.Name ||
                        investigation.label ||
                        investigation}
                    </div>
                  ))}
                </div>
              </section>
            )}

          {/* Advice */}
          {prescription.advice && (
            <section className="advice-section">
              <h5 className="section-title-red">ADVICE & FOLLOW-UP</h5>
              <div className="advice-box">{prescription.advice}</div>
            </section>
          )}

          {/* Doctor Signature - Professional Format */}
          <section className="doctor-signature-professional">
            <div className="doctor-details-box">
              <p>
                <strong>Doctor:</strong> Dr.{" "}
                {prescription.doctor?.personalInfo?.firstName || ""}{" "}
                {prescription.doctor?.personalInfo?.lastName || ""}
              </p>
              <p>
                <strong>Specialization:</strong>{" "}
                {prescription.doctor?.professional?.specialization || "N/A"}
              </p>
              {/* <p>
                <strong>Qualification:</strong>{" "}
                {prescription.doctor?.professional?.qualification || "N/A"}
              </p> */}
              {/* <p>
                <strong>Reg. No:</strong>{" "}
                {prescription.doctor?.professional?.registrationNumber || "N/A"}
              </p> */}
            </div>
            <div className="signature-box">
              <div className="signature-line"></div>
              <p className="signature-label">Doctor's Signature</p>
            </div>
          </section>

          {/* Footer */}
          <footer className="prescription-footer-professional">
            <div className="footer-divider"></div>
            <p className="footer-text">
              This is a computer-generated prescription. For any queries, please
              contact the hospital.
            </p>
            <p className="footer-date">
              Date: {formatDate(prescription.createdAt)}
            </p>
          </footer>
        </div>
      </div>
    </>
  );
}

export default DoctorPrePrint;
