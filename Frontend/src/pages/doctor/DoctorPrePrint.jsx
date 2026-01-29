import React, { useState, useEffect } from "react";
import logo from "../../assets/logowebsite11.png";
import { useParams } from "react-router-dom";
import "primeicons/primeicons.css";
import "../../../css/opdbill.css";
import html2pdf from "html2pdf.js";
import { prescriptionService } from "../../Services/doctor/prescriptionService";

function Preceptionbill() {
  // 🔥 FIX 1: state OBJECT hona chahiye, array nahi
  const [doctorpreceptionUHID, setDoctorpreceptionUHID] = useState([]);

  const { UHID } = useParams();

  useEffect(() => {
    if (!UHID) return;

    prescriptionService
      .getPrescriptionsByUHID(UHID)
      .then((res) => {
        console.log("API RESPONSE 👉", res.data[0]);
        setDoctorpreceptionUHID(res.data[0]);
      })
      .catch((err) => {
        console.error("Error fetching prescription:", err);
      });
  }, [UHID]);

  // 🔥 FIX 2: loading guard
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
        filename: `DoctorPrescription.pdf`,
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
      <div className="container d-flex justify-content-center my-3">
        <div
          id="print-area"
          className="bg-white px-4 py-3"
          style={{
            width: "210mm",
            minHeight: "297mm",
            fontSize: "13px",
            lineHeight: "1.4",
          }}
        >
          {/* ================= HEADER ================= */}
        <div className="row align-items-center border-bottom pb-2 mb-3 px-2">
  <div className="col-2">
    <img src={logo} alt="logo" className="img-fluid" />
  </div>

  <div className="col-6 text-center">
    <h5 className="fw-bold mb-0">SUKOON HOSPITALS</h5>
    <small className="text-muted">
      run by Spherehealth Medical Solutions Pvt. Ltd.
    </small>
  </div>

  <div
    className="col-3 small text-end"
    style={{ whiteSpace: "normal", wordBreak: "break-word" }}
  >
    <div>📞 7988807650</div>
    <div>✉ admin@sukoonhospitals.com</div>
    <div>📍 Sonipat (HR)</div>
  </div>
</div>


          {/* ================= PATIENT INFO ================= */}
          <div className="row mb-2">
            <div className="col-8">
              <div>
                <b>Patient:</b> {doctorpreceptionUHID.patientName}
              </div>
              <div>
                <b>Age:</b> {doctorpreceptionUHID.patient?.age ?? 0}
              </div>
              <div>
                <b>UHID:</b> {doctorpreceptionUHID.UHID}
              </div>
              <div>
                <b>Doctor:</b>{" "}
                {doctorpreceptionUHID.doctor?.personalInfo?.firstName}{" "} 
                {doctorpreceptionUHID.doctor?.personalInfo?.lastName}
              </div>
            </div>

            <div className="col-4 text-end">
              <div>
                <b>Date:</b>{" "}
                {new Date(doctorpreceptionUHID.createdAt).toLocaleDateString()}
              </div>
              <div>
                <b>Referred By:</b> {doctorpreceptionUHID.referredBy || "-"}
              </div>
            </div>
          </div>

          <hr className="my-2" />

          {/* ================= CLINICAL DETAILS ================= */}
          <h6 className="fw-bold border-bottom pb-1">Clinical Details</h6>
          <p className="mb-1">
            <b>Allergy:</b>{" "}
            {doctorpreceptionUHID.clinicalDetails?.historyOfAllergy}
          </p>
          <p className="mb-1">
            <b>Present Illness:</b>{" "}
            {doctorpreceptionUHID.clinicalDetails?.historyOfPresentIllness}
          </p>
          <p className="mb-2">
            <b>Examination:</b>{" "}
            {doctorpreceptionUHID.clinicalDetails?.physicalExamination}
          </p>

          {/* ================= VITALS ================= */}
          {/* <div className="row text-center border py-2 mb-3">
            <div className="col">
              <b>Weight</b>
              <br />
              {doctorpreceptionUHID.vitals?.weight}
            </div>
            <div className="col">
              <b>Temp</b>
              <br />
              {doctorpreceptionUHID.vitals?.temperature}
            </div>
            <div className="col">
              <b>BP</b>
              <br />
              {doctorpreceptionUHID.vitals?.bloodPressure}
            </div>
            <div className="col">
              <b>Pulse</b>
              <br />
              {doctorpreceptionUHID.vitals?.pulse}
            </div>
          </div> */}



          <div className="row text-center border py-2 mb-3">
  <div className="col">
    <b>Weight</b><br />
    {doctorpreceptionUHID.vitals?.weight || "-"}
  </div>

  {/* ===== TEMPERATURE ===== */}
  <div className="col">
    <b>Temp (°C)</b><br />
    <span
      className={
        doctorpreceptionUHID.vitals?.temperature > 37.2 ||
        doctorpreceptionUHID.vitals?.temperature < 36.1
          ? "text-danger fw-bold"
          : "text-success fw-bold"
      }
    >
      {doctorpreceptionUHID.vitals?.temperature || "-"}{" "}
      {doctorpreceptionUHID.vitals?.temperature > 37.2
        ? "🔺"
        : doctorpreceptionUHID.vitals?.temperature < 36.1
        ? "🔻"
        : "✔"}
    </span>
  </div>

  {/* ===== BP ===== */}
  <div className="col">
    <b>BP</b><br />
    <span
      className={
        doctorpreceptionUHID.vitals?.bloodPressure &&
        (
          Number(doctorpreceptionUHID.vitals.bloodPressure.split("/")[0]) > 140 ||
          Number(doctorpreceptionUHID.vitals.bloodPressure.split("/")[1]) > 90
        )
          ? "text-danger fw-bold"
          : "text-success fw-bold"
      }
    >
      {doctorpreceptionUHID.vitals?.bloodPressure || "-"}{" "}
      {doctorpreceptionUHID.vitals?.bloodPressure &&
      (
        Number(doctorpreceptionUHID.vitals.bloodPressure.split("/")[0]) > 140 ||
        Number(doctorpreceptionUHID.vitals.bloodPressure.split("/")[1]) > 90
      )
        ? "🔺"
        : "✔"}
    </span>
  </div>

  {/* ===== PULSE ===== */}
  <div className="col">
    <b>Pulse</b><br />
    <span
      className={
        doctorpreceptionUHID.vitals?.pulse > 100 ||
        doctorpreceptionUHID.vitals?.pulse < 60
          ? "text-danger fw-bold"
          : "text-success fw-bold"
      }
    >
      {doctorpreceptionUHID.vitals?.pulse || "-"}{" "}
      {doctorpreceptionUHID.vitals?.pulse > 100
        ? "🔺"
        : doctorpreceptionUHID.vitals?.pulse < 60
        ? "🔻"
        : "✔"}
    </span>
  </div>
</div>


          {/* ================= MEDICINES ================= */}
          <h6 className="fw-bold border-bottom pb-1">Medicines Advised</h6>
          <div className="table-responsive">
            <table className="table table-bordered table-sm text-center align-middle">
              <thead className="table-light">
                <tr>
                  <th>#</th>
                  <th>Medicine</th>
                  <th>Schedule</th>
                  <th>Instruction</th>
                  <th>Route</th>
                  <th>Days</th>
                </tr>
              </thead>
              <tbody>
                {doctorpreceptionUHID.medicines?.length > 0 ? (
                  doctorpreceptionUHID.medicines.map((med, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td className="text-start">{med.medicineName}</td>
                      <td>{med.schedule}</td>
                      <td className="text-start">{med.instruction}</td>
                      <td>{med.route}</td>
                      <td>{med.days}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="6">No medicines prescribed</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ================= ADVICE ================= */}
          <h6 className="fw-bold border-bottom pb-1 mt-3">Advice</h6>
          <p>{doctorpreceptionUHID.advice}</p>

          {/* ================= SIGNATURE ================= */}
          <div className="text-end mt-5">
            <div className="fw-bold">{doctorpreceptionUHID.doctor?.name}</div>
            <div className="small text-muted">
              {doctorpreceptionUHID.doctor?.specialization}
            </div>
          </div>
        </div>
      </div>

      <div className="container text-end mb-3">
        <button className="btn btn-primary px-4" onClick={handlePdf}>
          🖨 Print
        </button>
      </div>
    </>
  );
}

export default Preceptionbill;

// import React, { useState, useEffect } from "react";
// import logo from "../../assets/logowebsite11.png";
// import { useParams } from "react-router-dom";
// import html2pdf from "html2pdf.js";
// import { prescriptionService } from "../../Services/doctor/prescriptionService";
// import "../../../css/opdbill.css";

// function Preceptionbill() {
//   const { UHID } = useParams();
//   const [prescription, setPrescription] = useState(null);

//   // ================= FETCH DATA =================
//   useEffect(() => {
//     if (!UHID) return;

//     const fetchData = async () => {
//       try {
//         const res = await prescriptionService.getPrescriptionsByUHID(UHID);

//         console.log("API RESPONSE 👉", res.data);

//         const list = res?.data?.data || [];

//         if (list.length > 0) {
//           // 🔥 last/latest prescription
//           setPrescription(list[list.length - 1]);
//         }
//       } catch (err) {
//         console.error("Fetch error:", err);
//       }
//     };

//     fetchData();
//   }, [UHID]);

//   // ================= LOADING =================
//   if (!prescription) {
//     return <div className="p-3">Loading prescription...</div>;
//   }

//   // ================= PDF =================
//   const handlePdf = () => {
//     const element = document.getElementById("print-area");
//     if (!element) return;

//     html2pdf()
//       .from(element)
//       .set({
//         margin: 10,
//         filename: "Prescription.pdf",
//         html2canvas: { scale: 2 },
//         jsPDF: { unit: "mm", format: "a4" },
//       })
//       .save();
//   };

//   return (
//     <>
//       <div id="print-area" className="container my-4 p-4 border bg-white">
//         {/* ================= HEADER ================= */}
//         <header className="d-flex justify-content-between align-items-center mb-3">
//           <img src={logo} alt="logo" width={80} />
//           <div className="text-center">
//             <h5 className="mb-0 fw-bold">SUKOON HOSPITAL</h5>
//             <small>Spherehealth Medical Solutions Pvt Ltd</small>
//           </div>
//           <div className="text-end">
//             <small>📞 7988807650</small>
//           </div>
//         </header>

//         <hr />

//         {/* ================= PATIENT INFO ================= */}
//         <div className="row">
//           <div className="col-md-8">
//             <p><b>Patient:</b> {prescription.patientName}</p>
//             <p><b>Age:</b> {prescription.age}</p>
//             <p><b>Gender:</b> {prescription.gender}</p>
//             <p><b>UHID:</b> {prescription.UHID}</p>
//             <p>
//               <b>Doctor:</b>{" "}
//               {prescription.doctor?.personalInfo?.firstName}{" "}
//               {prescription.doctor?.personalInfo?.lastName}
//             </p>
//           </div>

//           <div className="col-md-4">
//             <p>
//               <b>Date:</b>{" "}
//               {new Date(prescription.createdAt).toLocaleDateString()}
//             </p>
//             <p><b>Referred By:</b> {prescription.referredBy || "-"}</p>
//           </div>
//         </div>

//         <hr />

//         {/* ================= CLINICAL ================= */}
//         <h6 className="fw-bold">Clinical Details</h6>
//         <p><b>Allergy:</b> {prescription.clinicalDetails?.historyOfAllergy}</p>
//         <p>
//           <b>Present Illness:</b>{" "}
//           {prescription.clinicalDetails?.historyOfPresentIllness}
//         </p>

//         <hr />

//         {/* ================= VITALS ================= */}
//         <div className="row mb-3">
//           <div className="col">Weight: {prescription.vitals?.weight}</div>
//           <div className="col">Temp: {prescription.vitals?.temperature}</div>
//           <div className="col">BP: {prescription.vitals?.bloodPressure}</div>
//           <div className="col">Pulse: {prescription.vitals?.pulse}</div>
//         </div>

//         {/* ================= MEDICINES ================= */}
//         <h6 className="fw-bold">Medicines</h6>
//         <table className="table table-bordered">
//           <thead>
//             <tr>
//               <th>#</th>
//               <th>Name</th>
//               <th>Schedule</th>
//               <th>Instruction</th>
//               <th>Route</th>
//               <th>Days</th>
//             </tr>
//           </thead>
//           <tbody>
//             {(prescription.medicines || []).length > 0 ? (
//               prescription.medicines.map((m, i) => (
//                 <tr key={i}>
//                   <td>{i + 1}</td>
//                   <td>{m.medicineName}</td>
//                   <td>{m.schedule}</td>
//                   <td>{m.instruction}</td>
//                   <td>{m.route}</td>
//                   <td>{m.days}</td>
//                 </tr>
//               ))
//             ) : (
//               <tr>
//                 <td colSpan="6" className="text-center">
//                   No medicines
//                 </td>
//               </tr>
//             )}
//           </tbody>
//         </table>

//         {/* ================= INVESTIGATIONS ================= */}
//         <h6 className="fw-bold">Investigations</h6>
//         {(prescription.investigations || []).length > 0 ? (
//           prescription.investigations.map((inv, i) => (
//             <p key={i}>• {inv.Name || inv}</p>
//           ))
//         ) : (
//           <p>No investigations</p>
//         )}

//         <hr />

//         {/* ================= ADVICE ================= */}
//         <h6 className="fw-bold">Advice</h6>
//         <p>{prescription.advice}</p>

//         {/* ================= SIGN ================= */}
//         <div className="text-end mt-4">
//           <b>
//             {prescription.doctor?.personalInfo?.firstName}{" "}
//             {prescription.doctor?.personalInfo?.lastName}
//           </b>
//           <p>{prescription.doctor?.professional?.specialization}</p>
//         </div>
//       </div>

//       <div className="container text-end">
//         <button className="btn btn-primary" onClick={handlePdf}>
//           🖨 Print
//         </button>
//       </div>
//     </>
//   );
// }

// export default Preceptionbill;
