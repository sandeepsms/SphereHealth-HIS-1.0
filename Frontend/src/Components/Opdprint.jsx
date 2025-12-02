// import { useFormik } from "formik";
// import React, { useState } from 'react'

// import logo from "../assets/logowebsite11.png";

// function Opdprint() {
//  const [currentDate, setCurrentDate] = useState(new Date());

//   return (
//    <>

//  <div className='container card  ' style={{marginTop:"100px", padding:"0px"}}>

//     <header className="navbar p-3 rounded" style={{border:"none",boxShadow:"none"}}>
//                {/* Left: Logo */}
//                <div className="navbar-logo">
//                  <img src={logo} alt="Hospital Logo" />
//                </div>

//                {/* Center: Hospital Name */}
//                <div className="navbar-center">
//                  <h1 className="hospital-name">SUKOON HOSPITALS</h1>
//                  <p className="tagline">
//                    run by Spherehealth Medical Solutions Pvt. Ltd.
//                  </p>
//                </div>

//                {/* Right: Contact Info */}
//                <div className="navbar-right"   >
//                  <p>📞 7988807650, 0130-4052310</p>
//                  <p>✉️ admin@sukoonhospitals.com</p>
//                  <p>📍 Mohalla Jatwara, Kumaro Ki Chopal ke Samne, Sonipat (HR)</p>
//                </div>
//              </header>

// <div className="row px-5 d-flex justify-contend-spacebetween" style={{}}>
//     <div className="col-md-6" style={{flexDirection:"column"}}>
// <h6 htmlFor="">Name</h6>
// <h6 htmlFor="">Name</h6>
// <h6 htmlFor="">Name</h6>
// <h6 htmlFor="">Name</h6>
//     </div>
//     <div className="col-md-6">
// <h6 htmlFor="">Name</h6>
// <h6 htmlFor="">Name</h6>
// <h6 htmlFor="">Name</h6>
// <h6 htmlFor="">Name</h6>
//     </div>
// </div>

//  </div>

//    </>
//   )
// }

// export default Opdprint

import React, { useState, useEffect } from "react";
import "../../css/opdbill.css";
import logo from "../assets/logowebsite11.png";
import { useParams } from "react-router-dom";
import { getPatientbyID } from "../Services/userService";

const Opdprint = () => {
  //   const handlePrint = () => {
  //     window.print();
  //   };
  const [UHIDdetail, setUHIDDetail] = useState([]);
  const [date, setdate] = useState(new Date());
  const [datess, setdatess] = useState();
  console.log("dddddddmmmmmmmm", datess);

  console.log("bossssss", UHIDdetail);

  // setDateByBac(new Date(UHIDdetail.date).toISOString().split("T")[0]);

  // const formatDate = (isoDate) => {
  //   const date = new Date(isoDate);
  //   return date.toLocaleDateString("en-GB", {
  //     day: "2-digit",
  //     month: "2-digit",
  //     year: "2-digit",
  //   });
  // };

  // const formattedDate = formatDate(UHIDdetail.date);
  // setdatess(formattedDate);

  const { UHID } = useParams();

  useEffect(() => {
    if (!UHID) return;
    getPatientbyID(UHID)
      .then((res) => {
        if (res?.date) {
          const formattedDate = new Date(res.date).toISOString().split("T")[0];
          setdatess(formattedDate);
        } else {
          console.warn("res.date is missing or invalid:", res?.date);
        }

        setUHIDDetail(res);

        console.log("Patient datassssssssss:", res);
      })
      .catch((err) => {
        console.error("Error fetching patient:", err);
      });
  }, [UHID]);

  return (
    <div className="opd-bill-container" style={{ marginTop: "100px" }}>
      <div className="container">
        <div className="header ">
          {/* <div className="hospital-name">CITY GENERAL HOSPITAL</div>
          <div className="hospital-address">123 Medical Center Drive, Health City, HC 12345 | Phone: (123) 456-7890</div> */}

          <header
            className="navbar p-3 rounded "
            style={{
              border: "none",
              boxShadow: "none",
              justifyItems: "center",
            }}
          >
            {/* Left: Logo */}
            <div className="navbar-logo " >
              {" "}
              <img src={logo} alt="Hospital Logo" />
            </div>

            {/* Center: Hospital Name */}
            <div className="navbar-center">
              <h1 className="hospital-name " style={{ marginLeft: "80px" }}>
                Spherehealth Medical Solutions
              </h1>{" "}
              {/* <p className="tagline" style={{ marginLeft: "70px" }}>
                run by Spherehealth Medical Solutions Pvt. Ltd.
              </p> */}
            </div>
            {/* Right: Contact Info */}
            <div className="navbar-right">
              <p>📞 7988307850, 0130-4052310</p>
              <p>✉️ spherehealth@sukoonhospitals.com</p>
              <p>📍 Mohalla Jatwara, Kumaro Ki Chopal ke Samne, Sonipat (HR)</p>
            </div>
          </header>
        </div>

        {/* <div className="barcode p-0 ">
          Date:{" "}
          <span className="highlight">{date.toISOString().split("T")[0]}</span>
        </div> */}

        <div className="section">
          <div className="section-title ">PATIENT INFORMATION</div>
          <div className="patient-info">
            <div className="info-item">
              <span className="label">Patient UHID:</span>
              <span>{UHIDdetail.UHID}</span>
            </div>
            <div className="info-item">
                <span className="label">Doctor:</span>
              <span>{UHIDdetail.DoctorName} ({UHIDdetail.DoctorDegree})</span>
              </div>

           
            <div className="info-item">
              <span className="label">Name:</span>
              <span>{UHIDdetail.name}</span>
            </div>

            <div className="info-item">
              <span className="label">Speciality</span>
              <span>{UHIDdetail.DoctorSpecilist}</span>
            </div>

            <div className="info-item">
              <span className="label">Age/Sex:</span>
              <span>{UHIDdetail.age}</span>/ <span>{UHIDdetail.gender}</span>
            </div>
            <div className="info-item">
              <span className="label">Bill No:</span>
              <span>NA</span>
            </div>
              <div className="info-item">
              <span className="label">Phone:</span>
              <span>{UHIDdetail.contact}</span>
            </div>
              
            <div className="info-item">
                <span className="label">Bill Date:</span>
          <span className="">{date.toISOString().split("T")[0]}</span>
              </div>
          </div>
        </div>

        {/* <div className="section">
          <div className="section-title">DOCTOR & DEPARTMENT</div>
          <div className="doctor-details">
            <div className="doctor-info">
              <div className="info-item">
                <span className="label">Doctor:</span>
              <span>{UHIDdetail.DoctorName}</span>
              </div>
              <div className="info-item">
                <span className="label">Department:</span>
              <span>{UHIDdetail.DoctorSpecilist}</span>
              </div>
            </div>
            <div className="doctor-info">
              <div className="info-item">
                <span className="label">OPD Time:</span>
                <span>10:30 AM</span>
              </div>
              <div className="info-item">
                <span className="label">Token No:</span>
                <span>C-15</span>
              </div>
            </div>
          </div>
        </div> */}

        <div className="section">
          <table className="bill-table">
            <thead>
              <tr>
                <th>Service Description</th>
                <th>Amount (₹)</th>
                <th>Discount (₹)</th>
                <th>Total ()</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>OPD Charges</td>
                <td>{UHIDdetail.OPDpricedata}</td>
                <td>0.0</td>
                <td>{UHIDdetail.OPDpricedata}</td>
              </tr>

              {/* <tr>
                <td>X-Ray Chest</td>
                <td>60.00</td>
                <td>6.00</td>
                <td>54.00</td>
              </tr> */}
              <tr>
                <td>
                  {" "}
                  <span className="highlight">Paid</span>
                </td>
                <td
                  colSpan="2"
                  style={{ textAlign: "right", fontWeight: "bold" }}
                >
                  Grand Total:
                </td>
                <td>{UHIDdetail.OPDpricedata} ₹</td>
              </tr>
            </tbody>
          </table>

          <div className="payment-info">
            {/* <div className="info-item">
              <span className="label">Payment Mode:</span>
              <span>Credit Card</span>
            </div> */}
            {/* <div className="info-item">
              <span className="label">Payment Status:</span>
           
            </div> */}
            {/* <div className="info-item">
              <span className="label">Transaction ID:</span>
              <span>TXN-789456123</span>
            </div> */}
            {/* <div className="info-item">
              <span className="label">Card Type:</span>
              <span>VISA **** **** **** 1234</span>
            </div> */}
          </div>
        </div>

        {/* <div className="section">
          <div className="section-title">VITAL SIGNS</div>
          <div className="vitals">
            <div className="vital-item">
              <span className="label">BP:</span>
              <span>120/80 mmHg</span>
            </div>
            <div className="vital-item">
              <span className="label">Pulse:</span>
              <span>72 bpm</span>
            </div>
            <div className="vital-item">
              <span className="label">Temp:</span>
              <span>98.6°F</span>
            </div>
            <div className="vital-item">
              <span className="label">Weight:</span>
              <span>82 kg</span>
            </div>
            <div className="vital-item">
              <span className="label">Height:</span>
              <span>178 cm</span>
            </div>
            <div className="vital-item">
              <span className="label">BMI:</span>
              <span>25.9</span>
            </div>
          </div>
        </div> */}
        {/* 
        <div className="section">
          <div className="section-title">NEXT APPOINTMENT</div>
          <p>
            Follow-up in 4 weeks (September 12, 2023) for review of
            investigation results and blood pressure control.
          </p>
        </div> */}

        <div className="footer mt-0">
          <p>Thank you for visiting SUKOON HOSPITALS</p>
          <p>For emergency care, please contact: 📞7988807650, 0130-4052310</p>
        </div>
      </div>

      {/* <button className="print-btn" onClick={handlePrint}>
        Print OPD Bill
      </button> */}
    </div>
  );
};
export default Opdprint;
