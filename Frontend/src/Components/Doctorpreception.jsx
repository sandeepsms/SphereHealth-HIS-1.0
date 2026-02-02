// import { useFormik } from "formik";
// import React, { useEffect, useState } from "react";
// import logo from "../../assets/logowebsite11.png";
// import { useParams, useNavigate } from "react-router-dom";
// import { InputText } from "primereact/inputtext";
// import { InputTextarea } from "primereact/inputtextarea";
// import { Button } from "primereact/button";
// import { toast } from "react-toastify";
// import { MultiSelect } from "primereact/multiselect";
// import { Field, FieldArray, Formik, Form, getIn } from "formik";
// import * as yup from "yup";
// import patientService from "../../Services/patient/patientService";
// import { doctorService } from "../../Services/doctor/doctorService";
// import { tpaServiceService } from "../../Services/tpa/tpaServiceService";
// import { prescriptionService } from "../../Services/doctor/prescriptionService";

// function DoctorPrescription() {
//   const [uhid, setUHID] = useState(null);
//   const [currentDate] = useState(new Date());
//   const [serviceOptions, setServiceOptions] = useState([]);
//   const [selectedServices, setSelectedServices] = useState([]);
//   const [loading, setLoading] = useState(false);
//   const [doctorData, setDoctorData] = useState(null);

//   const { UHID } = useParams();
//   const navigate = useNavigate();

//   console.log("DoctorPrescription - UHID from URL:", UHID);

//   // Fetch patient data
//   useEffect(() => {
//     if (!UHID) {
//       console.error("❌ No UHID in URL!");
//       toast.error("UHID is missing!");
//       return;
//     }

//     console.log("✅ Fetching patient data for UHID:", UHID);

//     patientService
//       .getPatientByUHID(UHID)
//       .then((res) => {
//         const patientData = res.data;
//         console.log("✅ Patient Data Loaded:", patientData);

//         setUHID(patientData);

//         // Fetch TPA services if patient has TPA
//         if (patientData?.tpa?._id) {
//           console.log("TPA ID found:", patientData?.tpa?._id);
//           fetchTPAServices(patientData.tpa._id);
//         }

//         // Fetch doctor details
//         if (patientData?.doctor?._id) {
//           fetchDoctorDetails(patientData.doctor._id);
//         }
//       })
//       .catch((err) => {
//         console.error("❌ Error fetching patient:", err);
//         toast.error("Failed to load patient data");
//       });
//   }, [UHID]);

//   const fetchTPAServices = (tpaId) => {
//     console.log("Fetching TPA Services for TPA ID:", tpaId);

//     tpaServiceService
//       .getTPAServiceById(tpaId)
//       .then((res) => {
//         console.log("TPA Services Response:", res);

//         const serviceArray = res.data?.service || res.service || [];

//         const formattedOptions = serviceArray.map((item) => ({
//           label: item.Name,
//           value: item._id,
//         }));

//         console.log("Formatted Service Options:", formattedOptions);
//         setServiceOptions(formattedOptions);
//       })
//       .catch((err) => {
//         console.error("❌ Error fetching TPA services:", err);
//       });
//   };

//   const fetchDoctorDetails = (doctorId) => {
//     console.log("Fetching Doctor Details for Doctor ID:", doctorId);

//     doctorService
//       .getDoctorById(doctorId)
//       .then((res) => {
//         console.log("Doctor Data Loaded:", res.data || res);
//         setDoctorData(res.data || res);
//       })
//       .catch((err) => {
//         console.error("❌ Error fetching doctor details:", err);
//       });
//   };

//   const validationSchema = yup.object().shape({
//     provisionalDiagnosis: yup.string().required("Diagnosis is required"),
//     medicines: yup.array().of(
//       yup.object().shape({
//         medicineName: yup.string().required("Medicine name is required"),
//         schedule: yup.string(),
//         instruction: yup.string(),
//         route: yup.string(),
//         days: yup.number().typeError("Must be a number"),
//       }),
//     ),
//   });

//   const Input = ({ field, form, placeholder }) => {
//     const errorMessage = getIn(form.errors, field.name);
//     return (
//       <div className="input-wrapper">
//         <input {...field} placeholder={placeholder} className="input-box" />
//         {errorMessage && <div className="error-text">{errorMessage}</div>}
//       </div>
//     );
//   };

//   return (
//     <Formik
//       enableReinitialize
//       initialValues={{
//         // Patient Info
//         patient: uhid?._id || "",
//         UHID: uhid?.UHID || "",
//         patientName: uhid?.fullName || "",
//         age: uhid?.age || "0",
//         gender: uhid?.gender || "",
//         contactNumber: uhid?.contactNumber || "",
//         date: currentDate.toLocaleDateString(),
//         fatherName: "",
//         department: uhid?.department?.departmentName || "",
//         registrationType: uhid?.registrationType || "OPD",

//         // Doctor Info
//         doctor: uhid?.doctor?._id || "",
//         referredBy: "",

//         // Clinical Details
//         historyOfAllergy: "",
//         historyOfPresentIllness: "",
//         physicalExamination: "",

//         // Vitals
//         weight: "",
//         temperature: "",
//         bloodPressure: "",
//         pulse: "",

//         // Diagnosis & Treatment
//         provisionalDiagnosis: "",
//         medicines: [
//           {
//             medicineName: "",
//             schedule: "",
//             instruction: "",
//             route: "",
//             days: "",
//           },
//         ],

//         // Investigations
//         investigations: [],

//         // Advice
//         advice: "",
//       }}
//       validationSchema={validationSchema}
//       onSubmit={async (values, { setSubmitting }) => {
//         setLoading(true);

//         try {
//           const prescriptionData = {
//             patient: values.patient,
//             UHID: values.UHID,
//             doctor: values.doctor,
//             registrationType: values.registrationType,

//             clinicalDetails: {
//               historyOfAllergy: values.historyOfAllergy,
//               historyOfPresentIllness: values.historyOfPresentIllness,
//               physicalExamination: values.physicalExamination,
//             },

//             vitals: {
//               weight: values.weight,
//               temperature: values.temperature,
//               bloodPressure: values.bloodPressure,
//               pulse: values.pulse,
//             },

//             provisionalDiagnosis: values.provisionalDiagnosis,
//             medicines: values.medicines,
//             investigations: selectedServices,
//             advice: values.advice,
//             referredBy: values.referredBy,
//           };

//           console.log("=== PRESCRIPTION SUBMISSION DEBUG ===");
//           console.log("Submitting Prescription Data:", prescriptionData);
//           console.log("UHID Value:", values.UHID);
//           console.log("Target URL will be:", `/Preceptionbill/${values.UHID}`);

//           const response =
//             await prescriptionService.createPrescription(prescriptionData);

//           console.log("Prescription Created Successfully:", response);
//           console.log("Response Success:", response.success);
//           console.log("Response Data:", response.data);

//           toast.success(
//             response.message || "Prescription created successfully!",
//           );

//           // ✅ CRITICAL: Check UHID before navigation
//           if (!values.UHID) {
//             console.error("❌ ERROR: UHID is empty! Cannot navigate.");
//             toast.error("UHID is missing. Cannot navigate to print page.");
//             return;
//           }

//           const printUrl = `/Preceptionbill/${values.UHID}`;
//           console.log("✅ Navigating to:", printUrl);

//           // Navigate to print view after 1.5 seconds
//           setTimeout(() => {
//             console.log("🚀 Navigation executing to:", printUrl);
//             navigate(printUrl);
//           }, 1500);
//         } catch (error) {
//           console.error("❌ Error creating prescription:", error);
//           console.error("Error details:", error.response?.data);
//           toast.error(
//             error.response?.data?.message || "Failed to create prescription",
//           );
//         } finally {
//           setLoading(false);
//           setSubmitting(false);
//         }
//       }}
//     >
//       {({ values, handleChange, setFieldValue }) => (
//         <Form className="d-flex justify-content-center">
//           <div
//             className="card p-5 bg-white"
//             style={{ marginTop: "10px", maxWidth: "1200px" }}
//           >
//             {/* Header */}
//             <header
//               className="navbar p-3 rounded"
//               style={{
//                 border: "none",
//                 boxShadow: "none",
//                 justifyItems: "center",
//               }}
//             >
//               <div className="navbar-logo">
//                 <img src={logo} alt="Hospital Logo" style={{ width: "80px" }} />
//               </div>

//               <div className="navbar-center">
//                 <h1 className="hospital-name" style={{ marginLeft: "80px" }}>
//                   SUKOON HOSPITALS
//                 </h1>
//                 <p className="tagline" style={{ marginLeft: "70px" }}>
//                   run by Spherehealth Medical Solutions Pvt. Ltd.
//                 </p>
//               </div>

//               <div className="navbar-right">
//                 <p>📞 7988807650, 0130-4052310</p>
//                 <p>✉️ admin@sukoonhospitals.com</p>
//                 <p>
//                   📍 Mohalla Jatwara, Kumaro Ki Chopal ke Samne, Sonipat (HR)
//                 </p>
//               </div>
//             </header>

//             {/* Patient Information */}
//             <h5 className="p-2 rounded btn-custom text-white mb-3">
//               Patient Information Details:
//             </h5>
//             <div className="row">
//               <div className="col-md-4">
//                 <label className="form-label">Name</label>
//                 <InputText
//                   id="name"
//                   name="patientName"
//                   value={values.patientName}
//                   readOnly
//                   className="w-100 text-success fw-bold"
//                 />
//               </div>

//               <div className="col-md-4">
//                 <label className="form-label">Age</label>
//                 <InputText
//                   id="age"
//                   name="age"
//                   value={values.age}
//                   readOnly
//                   className="w-100 text-success fw-bold"
//                 />
//               </div>

//               <div className="col-md-4">
//                 <label className="form-label">Gender</label>
//                 <InputText
//                   id="gender"
//                   name="gender"
//                   value={values.gender}
//                   readOnly
//                   className="w-100 text-success fw-bold"
//                 />
//               </div>

//               <div className="col-md-4">
//                 <label className="form-label">Father/Guardian Name:</label>
//                 <InputText
//                   id="fatherName"
//                   name="fatherName"
//                   value={values.fatherName}
//                   onChange={handleChange}
//                   className="w-100"
//                 />
//               </div>

//               <div className="col-md-4">
//                 <label className="form-label">Contact Number</label>
//                 <InputText
//                   id="contactNumber"
//                   name="contactNumber"
//                   value={values.contactNumber}
//                   readOnly
//                   className="w-100 text-success fw-bold"
//                 />
//               </div>

//               <div className="col-md-4">
//                 <label className="form-label">Date</label>
//                 <InputText
//                   id="date"
//                   name="date"
//                   value={values.date}
//                   readOnly
//                   className="w-100 text-success fw-bold"
//                 />
//               </div>

//               <div className="col-md-4">
//                 <label className="form-label">UHID No:</label>
//                 <InputText
//                   id="UHID"
//                   name="UHID"
//                   value={values.UHID}
//                   readOnly
//                   className="w-100 text-success fw-bold"
//                 />
//               </div>

//               <div className="col-md-4">
//                 <label className="form-label">Department:</label>
//                 <InputText
//                   id="department"
//                   name="department"
//                   value={values.department}
//                   readOnly
//                   className="w-100 text-success fw-bold"
//                 />
//               </div>

//               <div className="col-md-4">
//                 <label className="form-label">Registration Type:</label>
//                 <InputText
//                   id="registrationType"
//                   name="registrationType"
//                   value={values.registrationType}
//                   readOnly
//                   className="w-100 text-success fw-bold"
//                 />
//               </div>

//               <div className="col-md-4">
//                 <label className="form-label">Referred By:</label>
//                 <InputText
//                   id="referredBy"
//                   name="referredBy"
//                   value={values.referredBy}
//                   onChange={handleChange}
//                   className="w-100"
//                 />
//               </div>
//             </div>

//             {/* Clinical Details */}
//             <h5 className="p-2 rounded btn-custom text-white mt-4">
//               Clinical Details:
//             </h5>
//             <div className="col-md-12">
//               <label className="form-label fw-bold">
//                 History of Any Allergy:
//               </label>
//               <InputTextarea
//                 name="historyOfAllergy"
//                 value={values.historyOfAllergy}
//                 onChange={handleChange}
//                 placeholder="Enter the History of Any Allergy"
//                 rows={3}
//                 className="w-100"
//               />
//             </div>

//             <div className="col-md-12 mt-3">
//               <label className="form-label fw-bold">
//                 History of Present Illness:
//               </label>
//               <InputTextarea
//                 name="historyOfPresentIllness"
//                 value={values.historyOfPresentIllness}
//                 onChange={handleChange}
//                 placeholder="Enter the Present Illness"
//                 rows={3}
//                 className="w-100"
//               />
//             </div>

//             <div className="col-md-12 mt-3">
//               <label className="form-label fw-bold">
//                 Physical Examination:
//               </label>
//               <InputTextarea
//                 name="physicalExamination"
//                 value={values.physicalExamination}
//                 onChange={handleChange}
//                 placeholder="Enter the Physical Examination"
//                 rows={3}
//                 className="w-100"
//               />
//             </div>

//             {/* Vitals */}
//             <h5 className="p-2 rounded btn-custom text-white mt-4">Vitals:</h5>
//             <div className="row mt-3">
//               <div className="col-md-3 d-flex justify-content-evenly align-items-center">
//                 <label htmlFor="weight">Weight:</label>
//                 <InputText
//                   id="weight"
//                   name="weight"
//                   value={values.weight}
//                   onChange={handleChange}
//                   placeholder="Kgs"
//                   style={{ width: "90px" }}
//                 />
//               </div>

//               <div className="col-md-3 d-flex justify-content-evenly align-items-center">
//                 <label htmlFor="temperature">Temp:</label>
//                 <InputText
//                   id="temperature"
//                   name="temperature"
//                   placeholder="(°F)"
//                   value={values.temperature}
//                   onChange={handleChange}
//                   style={{ width: "90px" }}
//                 />
//               </div>

//               <div className="col-md-3 d-flex justify-content-evenly align-items-center">
//                 <label htmlFor="bloodPressure">B.P:</label>
//                 <InputText
//                   id="bloodPressure"
//                   name="bloodPressure"
//                   placeholder="mmHg"
//                   value={values.bloodPressure}
//                   onChange={handleChange}
//                   style={{ width: "90px" }}
//                 />
//               </div>

//               <div className="col-md-3 d-flex justify-content-evenly align-items-center">
//                 <label htmlFor="pulse">Pulse:</label>
//                 <InputText
//                   id="pulse"
//                   name="pulse"
//                   placeholder="bpm"
//                   value={values.pulse}
//                   onChange={handleChange}
//                   style={{ width: "90px" }}
//                 />
//               </div>
//             </div>

//             {/* Plan of Care */}
//             <h5 className="p-2 rounded btn-custom text-white mt-4">
//               Plan of Care:
//             </h5>
//             <div className="mt-4">
//               <div className="col-md-12">
//                 <label className="form-label fw-bold">
//                   Provisional Diagnosis: <span className="text-danger">*</span>
//                 </label>
//                 <InputText
//                   name="provisionalDiagnosis"
//                   value={values.provisionalDiagnosis}
//                   onChange={handleChange}
//                   placeholder="Enter Diagnosis"
//                   required
//                   className="w-100"
//                 />
//               </div>

//               {/* Medicine Table */}
//               <FieldArray name="medicines">
//                 {({ remove, push }) => (
//                   <div className="mt-4">
//                     <div className="d-flex justify-content-between align-items-center mb-3">
//                       <h4>Medicine Advised</h4>
//                       <Button
//                         type="button"
//                         severity="success"
//                         onClick={() =>
//                           push({
//                             medicineName: "",
//                             schedule: "",
//                             instruction: "",
//                             route: "",
//                             days: "",
//                           })
//                         }
//                       >
//                         + Add Medicine
//                       </Button>
//                     </div>
//                     <table className="table table-bordered">
//                       <thead className="table-primary">
//                         <tr>
//                           <th>Medicine (Brand & Generic)</th>
//                           <th>Schedule</th>
//                           <th>Instruction</th>
//                           <th>Route</th>
//                           <th>Days</th>
//                           <th>Action</th>
//                         </tr>
//                       </thead>
//                       <tbody>
//                         {values.medicines.map((medicine, index) => (
//                           <tr key={index}>
//                             <td>
//                               <Field
//                                 name={`medicines[${index}].medicineName`}
//                                 component={Input}
//                                 placeholder="Enter Medicine"
//                               />
//                             </td>
//                             <td>
//                               <Field
//                                 name={`medicines[${index}].schedule`}
//                                 component={Input}
//                                 placeholder="e.g., 1-0-1"
//                               />
//                             </td>
//                             <td>
//                               <Field
//                                 name={`medicines[${index}].instruction`}
//                                 component={Input}
//                                 placeholder="Before/After food"
//                               />
//                             </td>
//                             <td>
//                               <Field
//                                 name={`medicines[${index}].route`}
//                                 component={Input}
//                                 placeholder="Oral/IV"
//                               />
//                             </td>
//                             <td>
//                               <Field
//                                 name={`medicines[${index}].days`}
//                                 component={Input}
//                                 placeholder="Days"
//                                 type="number"
//                               />
//                             </td>
//                             <td className="text-center">
//                               <Button
//                                 type="button"
//                                 icon="pi pi-trash"
//                                 severity="danger"
//                                 text
//                                 onClick={() => remove(index)}
//                               />
//                             </td>
//                           </tr>
//                         ))}
//                       </tbody>
//                     </table>
//                   </div>
//                 )}
//               </FieldArray>

//               {/* Investigation Advised */}
//               <h5 className="p-2 rounded btn-custom text-white mt-4">
//                 Investigation Advised:
//               </h5>
//               <div className="row mt-3">
//                 <div className="col-md-12">
//                   <label className="form-label fw-bold">Investigations:</label>
//                   <MultiSelect
//                     value={selectedServices}
//                     onChange={(e) => {
//                       setSelectedServices(e.value || []);
//                       setFieldValue("investigations", e.value || []);
//                     }}
//                     options={serviceOptions}
//                     optionLabel="label"
//                     optionValue="value"
//                     placeholder="Select Tests"
//                     filter
//                     className="w-100"
//                     display="chip"
//                   />
//                 </div>
//               </div>

//               {/* Advice & Follow-up */}
//               <h5 className="p-2 rounded btn-custom text-white mt-4">
//                 Advice & Follow-up:
//               </h5>
//               <div className="col-md-12 mt-3">
//                 <label className="form-label fw-bold">Advice</label>
//                 <InputTextarea
//                   name="advice"
//                   value={values.advice}
//                   onChange={handleChange}
//                   placeholder="Enter Advice and Follow-up Instructions"
//                   rows={4}
//                   className="w-100"
//                 />
//               </div>

//               {/* Doctor Details */}
//               <h5 className="p-2 rounded btn-custom text-white mt-4">
//                 Doctor Details:
//               </h5>
//               <div className="row mt-3">
//                 <div className="col-md-4">
//                   <label className="form-label fw-bold">Doctor Name:</label>
//                   <p className="text-success fw-bold">
//                     {doctorData?.personalInfo?.firstName}{" "}
//                     {doctorData?.personalInfo?.lastName}
//                   </p>
//                 </div>

//                 <div className="col-md-4">
//                   <label className="form-label fw-bold">Speciality:</label>
//                   <p className="text-success fw-bold">
//                     {doctorData?.professional?.specialization || "N/A"}
//                   </p>
//                 </div>

//                 <div className="col-md-4">
//                   <label className="form-label fw-bold">Qualifications:</label>
//                   <p className="text-success fw-bold">
//                     {doctorData?.professional?.qualification || "N/A"}
//                   </p>
//                 </div>
//               </div>

//               {/* Submit Button */}
//               <div className="text-center mt-4">
//                 <Button
//                   type="submit"
//                   label={loading ? "Generating..." : "Generate & Print"}
//                   icon={loading ? "pi pi-spin pi-spinner" : "pi pi-check"}
//                   className="btn-custom px-5 rounded"
//                   loading={loading}
//                   disabled={loading}
//                 />
//               </div>
//             </div>
//           </div>
//         </Form>
//       )}
//     </Formik>
//   );
// }

// export default DoctorPrescription;
