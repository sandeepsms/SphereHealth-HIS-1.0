// import React, { useEffect, useState } from "react";
// import "../../../css/opdbill.css";
// import logo from "../../assets/BIMSLOGO.png";
// import { useParams } from "react-router-dom";
// import { getPatientbyID } from "../../Services/userService";
// import html2pdf from "html2pdf.js";
// import { Fullscreen } from "lucide-react";

// const OPDPrint = () => {
//   const { UHID } = useParams();
//   const [patient, setPatient] = useState({});
//   const today = new Date().toISOString().split("T")[0];

//   console.log("uhidddddd", patient);

//   useEffect(() => {
//     if (!UHID) return;
//     getPatientbyID(UHID).then((res) =>setPatient(res.data || {}));
//   }, [UHID]);


 

//   const handlePdf = () => {
//     const element = document.getElementById("print-area");
//     if (!element) return;

//     html2pdf()
//       .from(element)
//       .set({
//         margin: 10,
//         filename: "Registration.pdf", // required internally
//         html2canvas: { scale: 2 }, // enough quality + fast
//         jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
//       })
//       .toPdf()
//       .get("pdf")
//       .then((pdf) => {
//         const blobUrl = pdf.output("bloburl");

//         const printWindow = window.open(blobUrl);
//         if (!printWindow) return;

//         printWindow.onload = () => {
//           printWindow.focus();
//           printWindow.print();
//         };
//       });
//   };

//   const date = new Date(); // Current date

//   const day = date.getDate();

//   const month = String(date.getMonth() + 1).padStart(2, "0");
//   const year = date.getFullYear();

//   const formattedDate = `${day} ${month} ${year}`;

//   return (
//     <div className=" card   bg-light py-3" >
//       {/* PRINT AREA */}
//       <div id="print-area" className="container opd-page bg-white p-4">
//         {/* HEADER */}
//         <div className="row align-items-center border-bottom pb-3 mb-3">
//           <div className="col-2">
//             <img src={logo} alt="logo" className="img-fluid" />
//           </div>

//           <div className="col-6 text-center">
//             <h4 className="fw-bold mb-0">BIMS</h4>
//             <small>Bright Institute of Medical Sciences</small>
//           </div>

//           <div className="col-4 text-end small">
//             <div>📞+91 - 7988307850</div>
//             <div>✉️ query.bims@gmail.com</div>
//             <div>Gau Shala Road, Jatawara, Sonipat - 131001</div>
//           </div>
//         </div>

//         {/* PATIENT INFO */}

//         <div className="border p-3 mb-3 " style={{ width: "750px" }}>
//           <h6 className="fw-bold mb-3">PATIENT INFORMATION :</h6>

//           <div className="row g-3 mb-2">
//             <div className="col-6">
//               <strong>UHID:</strong> {patient.UHID}
//             </div>
//             <div className="col-6">
//               <strong>Name:</strong> {patient.fullName}
//             </div>
//           </div>

//           <div className="row g-3 mb-2">
//             <div className="col-6">
//               <strong>Age / Gender:</strong> {patient.age} 77/ {patient.gender}
//             </div>
//             <div className="col-6">
//               <strong>Mobile:</strong> {patient.contactNumber}
//             </div>
//           </div>

//           <div className="row g-3 mb-2">
//             <div className="col-6">
//               <strong>Doctor:</strong> {patient?.doctor?.personalInfo?.fullName}
//                {/* ( {patient.DoctorDegree}) */}
             
//             </div>
//             <div className="col-6">
//               <strong>Speciality:</strong> {patient?.department?.departmentName}
//             </div>
//           </div>

//           <div className="row g-3">
//             <div className="col-6">
//               <strong>Bill Date:</strong> {today}
//             </div>
//           </div>
//         </div>

//         {/* BILL TABLE */}
//         <table className="table table-bordered">
//           <thead className="table-light">
//             <tr>
//               <th>Service</th>
//               <th>Amount (₹)</th>
//               <th>Discount (₹)</th>
//               <th>Total (₹)</th>
//             </tr>
//           </thead>
//           <tbody>
//             <tr>
//               <td>OPD Consultation Charges</td>
//               <td>{patient.OPDpricedata}</td>
//               <td>0.00</td>
//               <td>{patient.OPDpricedata}</td>
//             </tr>
//             <tr>
//               <td colSpan="3" className="text-end fw-bold">
//                 Grand Total
//               </td>
//               <td className="fw-bold">₹ {patient.OPDpricedata}</td>
//             </tr>
//           </tbody>
//         </table>

//         {/* FOOTER */}
//         <div className="text-center mt-4 border-top pt-2 small">
//           <p className="mb-1">
//             Thank you for visiting <strong>BIMS</strong>
//           </p>
//           <p className="mb-0">Emergency Contact: 📞+91 - 7988307850</p>
//         </div>
//       </div>
//       {/* PRINT BUTTON */}
//       <div className="container text-end mb-2">
//         <button className="btn btn-primary " onClick={handlePdf}>
//           🖨️ Print
//         </button>
//       </div>
//     </div>
//   );
// };

// export default OPDPrint;



import React, { useEffect, useState } from "react";
import "../../../css/opdbill.css";
import logo from "../../assets/BIMSLOGO.png";
import { useParams } from "react-router-dom";
import { getPatientbyID } from "../../Services/userService";
import html2pdf from "html2pdf.js";

const OPDPrint = () => {
  const { UHID } = useParams();
  const [patient, setPatient] = useState({});
  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    if (!UHID) return;
    getPatientbyID(UHID).then((res) => setPatient(res.data || {}));
  }, [UHID]);

  const handlePdf = () => {
    const element = document.getElementById("print-area");
    if (!element) return;

    html2pdf()
      .from(element)
      .set({
      
        filename: "Registration.pdf",
        html2canvas: { scale: 3 },
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
    <div className="d-flex justify-content-center  py-4">
      <div style={{ width: "210mm" }}>
        {/* PRINT AREA */}
        <div
          id="print-area"
          className="bg-white p-4 mx-auto"
          style={{
            width: "210mm",
            // minHeight: "297mm",
            boxShadow: "0 0 10px rgba(0,0,0,0.1)",
            borderRadius: "8px",
          }}
        >
          {/* HEADER */}
          <div className="d-flex justify-content-between align-items-center border-bottom pb-3 mb-4">
            <div>
              <img src={logo} alt="logo" style={{ height: "70px" }} />
            </div>

            <div className="text-center">
              <h4 className="fw-bold mb-0">BIMS</h4>
              <small>Bright Institute of Medical Sciences</small>
            </div>

            <div className="text-end small">
              <div>📞 +91 - 7988307850</div>
              <div>✉️ query.bims@gmail.com</div>
              <div>Gau Shala Road, Jatawara, Sonipat - 131001</div>
            </div>
          </div>

          {/* PATIENT INFO */}
          <div className="border p-3 mb-4 rounded">
            <h6 className="fw-bold mb-3">PATIENT INFORMATION :</h6>

            <div className="row mb-2">
              <div className="col-6">
                <strong>UHID:</strong> {patient?.UHID}
              </div>
              <div className="col-6">
                <strong>Name:</strong> {patient?.fullName}
              </div>
            </div>

            <div className="row mb-2">
              <div className="col-6">
                <strong>Age / Gender:</strong> {patient?.age} /{" "}
                {patient?.gender}
              </div>
              <div className="col-6">
                <strong>Mobile:</strong> {patient?.contactNumber}
              </div>
            </div>

            <div className="row mb-2">
              <div className="col-6">
                <strong>Doctor:</strong>{" "}
                {patient?.doctor?.personalInfo?.fullName}
              </div>
              <div className="col-6">
                <strong>Speciality:</strong>{" "}
                {patient?.department?.departmentName}
              </div>
            </div>

            <div className="row">
              <div className="col-6">
                <strong>Bill Date:</strong> {today}
              </div>
            </div>
          </div>

          {/* BILL TABLE */}
          <table className="table table-bordered text-center align-middle">
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
                <td>{patient?.OPDpricedata}</td>
                <td>0.00</td>
                <td>{patient?.OPDpricedata}</td>
              </tr>
              <tr>
                <td colSpan="3" className="text-end fw-bold">
                  Grand Total
                </td>
                <td className="fw-bold fs-5">
                  ₹ {patient?.OPDpricedata}
                </td>
              </tr>
            </tbody>
          </table>

          {/* FOOTER */}
          <div className="text-center mt-5 border-top pt-3 small">
            <p className="mb-1">
              Thank you for visiting <strong>BIMS</strong>
            </p>
            <p className="mb-0">
              Emergency Contact: 📞 +91 - 7988307850
            </p>
          </div>
        </div>

        {/* PRINT BUTTON */}
        <div className="text-center mt-3" >
          <button
            className="btn btn-primary py-2 shadow-sm w-4 "
            onClick={handlePdf}
          >
            🖨️ Print
          </button>
        </div>
      </div>
    </div>
  );
};

export default OPDPrint;