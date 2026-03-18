import { useFormik } from "formik";
import React, { useEffect, useState } from "react";
import logo from "../../assets/BIMSLOGO.png";
import { useParams, useNavigate } from "react-router-dom";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Button } from "primereact/button";
import { toast } from "react-toastify";
import { MultiSelect } from "primereact/multiselect";
import { Field, FieldArray, Formik, Form, getIn } from "formik";
import * as yup from "yup";
import patientService from "../../Services/patient/patientService";
import { doctorService } from "../../Services/doctors/doctorService";
import { tpaServiceService } from "../../Services/tpa/tpaServiceService";
import { prescriptionService } from "../../Services/doctors/prescriptionService";
import DoctorPrePrint from "../../pages/doctor/DoctorPrePrint";
import { Dropdown } from "primereact/dropdown";

function DoctorPrescription() {
  const [uhid, setUHID] = useState(null);
  const [currentDate] = useState(new Date());
  const [serviceOptions, setServiceOptions] = useState([]);
  const [selectedServices, setSelectedServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [doctorData, setDoctorData] = useState(null);
  const [TesttotalPrice, setTestTotalPrice] = useState(0);
  const [Testprice, setTestprice] = useState();
  const [buttonmode, setButtonMode] = useState();
  const [errors, seterrors] = useState();
  const [editPrescription, setEditPrescription] = useState();
  const [PrescriptionDataforEdit, setPrescriptionDataforEdit] = useState();

  const { UHID } = useParams();
  const navigate = useNavigate();

  console.log("DoctorPrescription - UHID from URL:", UHID);

  console.log("testprice------000000", TesttotalPrice);

  // useEffect(() => {
  //   buttonmode === "CREATE"
  //     ? setEditPrescription(false)
  //     : setEditPrescription(true);
  // }, []);

  useEffect(() => {
    if (editPrescription) {
      fetchPrescriptionEditData();
    }
  }, [editPrescription]);

  useEffect(() => {
    if (UHID == null || UHID === "") return; // jab tak UHID na aaye

    const fetchPrescription = async () => {
      try {
        const responsedata =
          await prescriptionService.checkCreateOrUpdate(UHID);
        setButtonMode(responsedata.data.mode);
        fetchPrescriptionEditData();
      } catch (error) {
        console.error("Error while checking prescription", error);
      }
    };
// Fetch Pereception data for edit.............
    const fetchPrescriptionEditData = async () => {
      try {
        setLoading(true);
        const response = await prescriptionService.getPrescriptionsByUHID(UHID);
        console.log("nnnnnnnnnnccccccccccc", response);
        if (response.success) {
          const prescriptionData = Array.isArray(response.data)
            ? response.data[0]
            : response.data;
          setPrescriptionDataforEdit(prescriptionData || null);

       
        } else {
          toast.error("No prescription data found for this UHID");
        }
      } catch (error) {
        toast.error("Failed to load Edit prescription");
      } finally {
        setLoading(false);
      }
    };

    fetchPrescription();
  }, [UHID]);

  useEffect(() => {
    const total = selectedServices.reduce((sum, test) => {
      return sum + (test.price || 0);
    }, 0);

    setTestTotalPrice(total);
  }, [setSelectedServices]);

  // Fetch patient data
  useEffect(() => {
    if (!UHID) {
      console.error("❌ No UHID in URL!");
      toast.error("UHID is missing!");
      return;
    }

    console.log("✅ Fetching patient data for UHID:", UHID);

    patientService
      .getPatientByUHID(UHID)
      .then((res) => {
        const patientData = res.data;
        console.log("✅ Patient Data Loaded:", patientData);

        setUHID(patientData);

        // Fetch TPA services if patient has TPA
        if (patientData?.tpa?._id) {
          console.log("TPA ID found:", patientData?.tpa?._id);
          fetchTPAServices(patientData.tpa._id);
        }

        // Fetch doctor details
        if (patientData?.doctor?._id) {
          fetchDoctorDetails(patientData.doctor._id);
        }
      })
      .catch((err) => {
        console.error("❌ Error fetching patient:", err);
        toast.error("Failed to load patient data");
      });
  }, [UHID]);

  const fetchTPAServices = (tpaId) => {
    console.log("Fetching TPA Services for TPA ID:", tpaId);

    tpaServiceService
      .getTPAServiceById(tpaId)
      .then((res) => {
        console.log("TPA Services Response:", res);

        const serviceArray = res.data?.services || res.services || [];

        const formattedOptions = serviceArray.map((item) => ({
          // label: [item.Name,item.Totalamount],
          label: item.Name,
          value: item._id,
          price: item.Totalamount,
        }));

        console.log(
          "Formatted Service Options====================================:",
          formattedOptions,
        );
        setServiceOptions(formattedOptions);
      })
      .catch((err) => {
        console.error("❌ Error fetching TPA services:", err);
      });
  };

  const fetchDoctorDetails = (doctorId) => {
    console.log("Fetching Doctor Details for Doctor ID:", doctorId);

    doctorService
      .getDoctorById(doctorId)
      .then((res) => {
        console.log("Doctor Data Loaded:", res.data || res);
        setDoctorData(res.data || res);
      })
      .catch((err) => {
        console.error("❌ Error fetching doctor details:", err);
      });
  };

  const validationSchema = yup.object().shape({
    provisionalDiagnosis: yup.string().required("Diagnosis is required"),
    medicines: yup.array().of(
      yup.object().shape({
        medicineName: yup.string().required("Medicine name is required"),
        schedule: yup.string(),
        instruction: yup.string(),
        route: yup.string(),
        days: yup.string(),
      }),
    ),
  });

  const Input = ({ field, form, placeholder }) => {
    const errorMessage = getIn(form.errors, field.name);
    return (
      <div className="input-wrapper">
        <input {...field} placeholder={placeholder} className="input-box" />
        {errorMessage && <div className="error-text">{errorMessage}</div>}
      </div>
    );
  };

  const scheduledata = [
    { label: "1-0-0(Morning)", value: "1-0-0(Morning)" },
    { label: "1-0-0(Afternoon)", value: "1-0-0(Afternoon)" },
    { label: "1-0-0(Night)", value: "1-0-0(Night)" },
    { label: "1-1-1", value: "1-1-1" },
    { label: "OD", value: "OD" },
    { label: "BD", value: "BD" },
    { label: "TDS", value: "TDS" },
    { label: "QID", value: "QID" },
    { label: "SOS", value: "SOS" },
    { label: "STAT", value: "STAT" },
  ];

  const instructiondata = [
    { label: "Before Food", value: "Before Food" },
    { label: "After Food", value: "After Food" },
    { label: "With Food", value: "With Food" },
    { label: "Empty Stomach", value: "Empty Stomach" },
    { label: "At Bedtime", value: "At Bedtime" },
    { label: "Do Not Crush/Chew", value: "Do Not Crush/Chew" },
  ];

  const Routedata = [
    { label: "Oral", value: "Oral" },
    { label: "IV", value: "IV" },
    { label: "IM", value: "IM" },
    { label: "SC", value: "SC" },
    { label: "Topical", value: "Topical" },
    { label: "Inhalation", value: "Inhalation" },
    { label: "Sublingual", value: "Sublingual" },
    { label: "Nasal", value: "Nasal" },
  ];

  const daysdata = [
    { label: "1 Day", value: "1 Day" },
    { label: "3 Day", value: "3 Day" },
    { label: "5 Day", value: "5 Day" },
    { label: "7 Day", value: "7 Day" },
    { label: "10 Day", value: "10 Day" },
    { label: "14 Day", value: "14 Day" },
    { label: "30 Day", value: "30 Day" },
    { label: "Once Weekly", value: "Once Weekly" },
    { label: "Custom", value: "Custom" },
  ];
  return (
    <Formik
      enableReinitialize
      initialValues={{
        // Patient Info
        patient: uhid?._id || "",
        UHID: uhid?.UHID || "",
        patientName: uhid?.fullName || "",
        age: uhid?.age || "0",
        gender: uhid?.gender || "",
        contactNumber: uhid?.contactNumber || "",
        date: currentDate.toLocaleDateString(),
        fatherName: uhid?.companionName || "",
        department: uhid?.department?.departmentName || "",
        registrationType: uhid?.registrationType || "OPD",

        // Doctor Info
        doctor: uhid?.doctor?._id || "",
        referredBy: uhid?.referredBy || "Self",

        // Clinical Details
        historyOfAllergy: uhid?.knownAllergies,
        historyOfPresentIllness:
          PrescriptionDataforEdit?.clinicalDetails?.historyOfPresentIllness ||
          "",

        physicalExamination:
          PrescriptionDataforEdit?.clinicalDetails?.physicalExamination || "",

        // Vitals
        weight: PrescriptionDataforEdit?.vitals?.weight || "",

        temperature: PrescriptionDataforEdit?.vitals?.temperature || "",

        bloodPressure: PrescriptionDataforEdit?.vitals?.bloodPressure || "",

        pulse: PrescriptionDataforEdit?.vitals?.pulse || "",

        // Diagnosis & Treatment
        provisionalDiagnosis:
          PrescriptionDataforEdit?.provisionalDiagnosis || "",

        // Medicines (Array Handle Properly)
        medicines:
          PrescriptionDataforEdit?.medicines?.length > 0
            ? PrescriptionDataforEdit.medicines
            : [
                {
                  medicineName: "",
                  schedule: "",
                  instruction: "",
                  route: "",
                  days: "",
                },
              ],   
              
              

        // Investigations
        investigations: PrescriptionDataforEdit?.investigations || [],

        // Advice
        advice: PrescriptionDataforEdit?.advice || "",
      }}
      validationSchema={validationSchema}
      onSubmit={async (values, { setSubmitting }) => {
        console.log("=== PRESCRIPTION SUBMISSION STARTED ===");
        console.log("Form Values:", values);

        console.log("UHID:", values.UHID);
        console.log("Patient ID:", values.patient);
        console.log("Patient test:", values.investigations);
        // ✅ Validation before submission
        if (!values.UHID) {
          console.error("❌ UHID is missing in form values!");
          toast.error("UHID is missing. Cannot create prescription.");
          setSubmitting(false);
          return;
        }

        if (!values.patient) {
          console.error("❌ Patient ID is missing in form values!");
          toast.error("Patient ID is missing. Cannot create prescription.");
          setSubmitting(false);
          return;
        }

        setLoading(true);

        try {
          const prescriptionData = {
            patient: values.patient,
            patientName: uhid?.fullName || "",
            age: uhid?.age || "0",
            gender: uhid?.gender || "",
            contactNumber: uhid?.contactNumber || "",
            department: uhid?.department?.departmentName || "",
            doctor: uhid?.doctor?._id || "",
            UHID: values.UHID,
            // doctor: values.doctor,
            registrationType: values.registrationType,
            fatherName: uhid?.companionName || "",
            clinicalDetails: {
              historyOfAllergy: values.historyOfAllergy,
              historyOfPresentIllness: values.historyOfPresentIllness,
              physicalExamination: values.physicalExamination,
            },

            vitals: {
              weight: values.weight,
              temperature: values.temperature,
              bloodPressure: values.bloodPressure,
              pulse: values.pulse,
            },

            provisionalDiagnosis: values.provisionalDiagnosis,
            medicines: values.medicines,
            investigations: values.investigations,
            advice: values.advice,
            referredBy: values.referredBy,
          };

          console.log("Submitting Prescription Data:", prescriptionData);

          const response =
            // await prescriptionService.createPrescription(prescriptionData);
            await prescriptionService.createPrescription(
              UHID,
              prescriptionData,
            );

          console.log("✅ Prescription Created Successfully:", response);

          if (response.success) {
            toast.success(
              response.message || "Prescription created successfully!",
            );

            // ✅ Construct the print URL
            const printUrl = `/preceptionprint/${values.UHID}`;
            console.log("✅ Navigating to Print Page:", printUrl);

            // Navigate to print page after short delay
            setTimeout(() => {
              navigate(printUrl);
            }, 1000);
          } else {
            throw new Error(
              response.message || "Failed to create prescription",
            );
          }
        } catch (error) {
          console.error("❌ Error creating prescription:", error);
          console.error("Error details:", error.response?.data);
          toast.error(
            error.response?.data?.message ||
              error.message ||
              "Failed to create prescription",
          );
        } finally {
          setLoading(false);
          setSubmitting(false);
        }
      }}
    >
      {({ values, handleChange, setFieldValue }) => (
        <Form className="d-flex justify-content-center">
          <div
            className="card p-5 bg-white"
            style={{ marginTop: "10px", maxWidth: "1200px" }}
          >
            {/* Header */}
            <header
              className="navbar p-3 rounded"
              style={{
                border: "none",
                boxShadow: "none",
                justifyItems: "center",
              }}
            >
              <div className="navbar-logo">
                <img src={logo} alt="Hospital Logo" style={{ width: "80px" }} />
              </div>

              <div className="navbar-center">
                <h1 className="hospital-name" style={{ marginLeft: "80px" }}>
                  BIMS
                </h1>
                <p className="tagline" style={{ marginLeft: "70px" }}>
                  Bright Institute of Medical Sciences
                </p>
              </div>

              <div className="navbar-right">
                <p>📞 +91 - 7988307850</p>
                <p>✉️ query.bims@gmail.com</p>
                <p>📍Gau Shala Road, Jatawara, Sonipat - 131001</p>
              </div>
            </header>

            {/* Patient Information */}
            <h5 className="p-2 rounded btn-custom text-white mb-3">
              Patient Information Details:
            </h5>
            <div className="row">
              <div className="col-md-4">
                <label className="form-label">Name</label>
                <InputText
                  id="name"
                  name="patientName"
                  value={values.patientName}
                  readOnly
                  className="w-100 text-success fw-bold"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">Age</label>
                <InputText
                  id="age"
                  name="age"
                  value={values.age}
                  readOnly
                  className="w-100 text-success fw-bold"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">Gender</label>
                <InputText
                  id="gender"
                  name="gender"
                  value={values.gender}
                  readOnly
                  className="w-100 text-success fw-bold"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">Father/Guardian Name:</label>
                <InputText
                  id="fatherName"
                  name="fatherName"
                  value={values.fatherName}
                  // onChange={handleChange}
                  readOnly
                  className="w-100 text-success fw-bold"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">Contact Number</label>
                <InputText
                  id="contactNumber"
                  name="contactNumber"
                  value={values.contactNumber}
                  readOnly
                  className="w-100 text-success fw-bold"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">Date</label>
                <InputText
                  id="date"
                  name="date"
                  value={values.date}
                  readOnly
                  className="w-100 text-success fw-bold"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">UHID No:</label>
                <InputText
                  id="UHID"
                  name="UHID"
                  value={values.UHID}
                  readOnly
                  className="w-100 text-success fw-bold"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">Department:</label>
                <InputText
                  id="department"
                  name="department"
                  value={values.department}
                  readOnly
                  className="w-100 text-success fw-bold"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">Registration Type:</label>
                <InputText
                  id="registrationType"
                  name="registrationType"
                  value={values.registrationType}
                  readOnly
                  className="w-100 text-success fw-bold"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">Referred By:</label>
                <InputText
                  id="referredBy"
                  name="referredBy"
                  value={values.referredBy}
                  onChange={handleChange}
                  className="w-100"
                />
              </div>
            </div>

            {/* Clinical Details */}
            <h5 className="p-2 rounded btn-custom text-white mt-4">
              Clinical Details:
            </h5>
            <div className="col-md-12">
              <label className="form-label fw-bold">
                History of Any Allergy:
              </label>
              <InputTextarea
                name="historyOfAllergy"
                value={values.historyOfAllergy}
                onChange={handleChange}
                placeholder="Enter the History of Any Allergy"
                rows={3}
                className="w-100"
              />
            </div>

            <div className="col-md-12 mt-3">
              <label className="form-label fw-bold">
                History of Present Illness:
              </label>
              <InputTextarea
                name="historyOfPresentIllness"
                value={values.historyOfPresentIllness}
                onChange={handleChange}
                placeholder="Enter the Present Illness"
                rows={3}
                className="w-100"
              />
            </div>

            <div className="col-md-12 mt-3">
              <label className="form-label fw-bold">
                Physical Examination:
              </label>
              <InputTextarea
                name="physicalExamination"
                value={values.physicalExamination}
                onChange={handleChange}
                placeholder="Enter the Physical Examination"
                rows={3}
                className="w-100"
              />
            </div>

            {/* Vitals */}
            <h5 className="p-2 rounded btn-custom text-white mt-4">Vitals:</h5>
            <div className="row mt-3">
              <div className="col-md-3 d-flex justify-content-evenly align-items-center">
                <label htmlFor="weight">Weight:</label>
                <InputText
                  id="weight"
                  name="weight"
                  value={values.weight}
                  onChange={handleChange}
                  placeholder="Kgs"
                  style={{ width: "90px" }}
                />
              </div>

              <div className="col-md-3 d-flex justify-content-evenly align-items-center">
                <label htmlFor="temperature">Temp:</label>
                <InputText
                  id="temperature"
                  name="temperature"
                  placeholder="(°F)"
                  value={values.temperature}
                  onChange={handleChange}
                  style={{ width: "90px" }}
                />
              </div>

              <div className="col-md-3 d-flex justify-content-evenly align-items-center">
                <label htmlFor="bloodPressure">B.P:</label>
                <InputText
                  id="bloodPressure"
                  name="bloodPressure"
                  placeholder="mmHg"
                  value={values.bloodPressure}
                  onChange={handleChange}
                  style={{ width: "90px" }}
                />
              </div>

              <div className="col-md-3 d-flex justify-content-evenly align-items-center">
                <label htmlFor="pulse">Pulse:</label>
                <InputText
                  id="pulse"
                  name="pulse"
                  placeholder="bpm"
                  value={values.pulse}
                  onChange={handleChange}
                  style={{ width: "90px" }}
                />
              </div>
            </div>

            {/* Plan of Care */}
            <h5 className="p-2 rounded btn-custom text-white mt-4">
              Plan of Care:
            </h5>
            <div className="mt-4">
              <div className="col-md-12">
                <label className="form-label fw-bold">
                  Provisional Diagnosis: <span className="text-danger">*</span>
                </label>
                <InputText
                  name="provisionalDiagnosis"
                  value={values.provisionalDiagnosis}
                  onChange={handleChange}
                  placeholder="Enter Diagnosis"
                  required
                  className="w-100"
                />
              </div>

              {/* Medicine Table */}
              <FieldArray name="medicines">
                {({ remove, push }) => (
                  <div className="mt-4">
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <h4>Medicine Advised</h4>
                      <Button
                        type="button"
                        severity="success"
                        onClick={() =>
                          push({
                            medicineName: "",
                            schedule: "",
                            instruction: "",
                            route: "",
                            days: "",
                          })
                        }
                      >
                        + Add Medicine
                      </Button>
                    </div>
                    <table className="table table-bordered">
                      <thead className="table-primary">
                        <tr>
                          <th>Medicine (Brand & Generic)</th>
                          <th>Schedule</th>
                          <th>Instruction</th>
                          <th>Route</th>
                          <th>Days</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {values.medicines.map((medicine, index) => (
                          <tr key={index}>
                            <td style={{ lineHeight: "28px", width: "100%" }}>
                              <Field
                                name={`medicines[${index}].medicineName`}
                                component={Input}
                                placeholder="Enter Medicine"
                              />
                            </td>
                            <td>
                              <Dropdown
                                value={
                                  values?.medicines?.[index]?.schedule || ""
                                }
                                options={scheduledata}
                                onChange={(e) =>
                                  setFieldValue(
                                    `medicines[${index}].schedule`,
                                    e.value,
                                  )
                                }
                                placeholder="Select Schedule"
                                className={
                                  errors?.medicines?.[index]?.schedule
                                    ? "p-invalid"
                                    : ""
                                }
                                style={{ width: "100%" }}
                              />

                              {errors?.medicines?.[index]?.schedule && (
                                <small className="p-error block">
                                  {errors.medicines[index].schedule}
                                </small>
                              )}
                            </td>
                            <td>
                              <Dropdown
                                value={
                                  values?.medicines?.[index]?.instruction || ""
                                }
                                options={instructiondata}
                                onChange={(e) =>
                                  setFieldValue(
                                    `medicines[${index}].instruction`,
                                    e.value,
                                  )
                                }
                                placeholder="Select instruction"
                                className={
                                  errors?.medicines?.[index]?.instruction
                                    ? "p-invalid"
                                    : ""
                                }
                                style={{ width: "100%" }}
                              />

                              {errors?.medicines?.[index]?.instruction && (
                                <small className="p-error block">
                                  {errors.medicines[index].instruction}
                                </small>
                              )}
                            </td>
                            <td>
                              {/* <Field
                                name={`medicines[${index}].route`}
                                component={Input}
                                placeholder="Oral/IV"
                              /> */}

                              <Dropdown
                                value={values?.medicines?.[index]?.route || ""}
                                options={Routedata}
                                onChange={(e) =>
                                  setFieldValue(
                                    `medicines[${index}].route`,
                                    e.value,
                                  )
                                }
                                placeholder="Select route"
                                className={
                                  errors?.medicines?.[index]?.route
                                    ? "p-invalid"
                                    : ""
                                }
                                style={{ width: "100%" }}
                              />

                              {errors?.medicines?.[index]?.route && (
                                <small className="p-error block">
                                  {errors.medicines[index].route}
                                </small>
                              )}
                            </td>
                            <td>
                              <Dropdown
                                key={index}
                                value={values?.medicines?.[index]?.days}
                                options={daysdata}
                                optionLabel="label"
                                optionValue="value"
                                onChange={(e) =>
                                  setFieldValue(
                                    `medicines[${index}].days`,
                                    e.value,
                                  )
                                }
                                placeholder="Select days"
                                className={
                                  errors?.medicines?.[index]?.days
                                    ? "p-invalid"
                                    : ""
                                }
                                style={{ width: "100%" }}
                              />

                              {errors?.medicines?.[index]?.days && (
                                <small className="p-error block">
                                  {errors.medicines[index].days}
                                </small>
                              )}
                            </td>
                            <td className="text-center">
                              <Button
                                type="button"
                                icon="pi pi-trash"
                                severity="danger"
                                text
                                onClick={() => remove(index)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </FieldArray>

              {/* Investigation Advised */}
              <h5 className="p-2 rounded btn-custom text-white mt-4">
                Investigation Advised:
              </h5>
              <div className="row mt-3">
                <div className="col-md-12 ">
                  <label className="form-label fw-bold">Investigations:</label>
                  {/* <MultiSelect
                    value={selectedServices}
                    // value={formik.values.investigations}
                    onChange={(e) => {
                      console.log("value like========2222221111", e.value);

                      setSelectedServices(e.value || []);
                      setFieldValue("investigations", e.value || []);
                    }}
                    options={serviceOptions}
                    optionLabel="label"
                    optionValue="value"
                    placeholder="Select Tests"
                    filter
                    className="w-100"
                    display="chip"
                  /> */}

                  {/* <MultiSelect
                    value={values.investigations}
                    onChange={(e) => {
                      console.log("Selected Tests000000000000:", e.value);

                      setSelectedServices(e.value || []); // UI state
                      // setFieldValue("investigations", e.value || []); // Formik state
                      setFieldValue("investigations", [
                        {
                          investigationName: e.serviceOptions.label,
                          investigationId: e.value,
                        },
                      ]);
                    }}
                    options={serviceOptions}
                    optionLabel="label"
                    optionValue="value"
                    placeholder="Select Tests"
                    filter
                    className="w-100"
                    display="chip"
                  /> */}

                  <MultiSelect
                    value={values.investigations?.map(
                      (item) => item.investigationId,
                    )}
                    onChange={(e) => {
                      const selectedInvestigations = e.value.map((id) => {
                        const selectedService = serviceOptions.find(
                          (service) => service.value === id,
                        );

                        return {
                          investigationName: selectedService?.label || "",
                          investigationId: id,
                        };
                      });

                      setFieldValue("investigations", selectedInvestigations);
                    }}
                    options={serviceOptions}
                    optionLabel="label"
                    optionValue="value"
                    placeholder="Select Tests"
                    filter
                    className="w-100 ml-4"
                    display="chip"
                  />
                </div>
              </div>

              {/* Advice & Follow-up */}
              <h5 className="p-2 rounded btn-custom text-white mt-4">
                Advice & Follow-up:
              </h5>
              <div className="col-md-12 mt-3">
                <label className="form-label fw-bold">Advice</label>
                <InputTextarea
                  name="advice"
                  value={values.advice}
                  onChange={handleChange}
                  placeholder="Enter Advice and Follow-up Instructions"
                  rows={4}
                  className="w-100"
                />
              </div>

              {/* Doctor Details */}
              <h5 className="p-2 rounded btn-custom text-white mt-4">
                Doctor Details:
              </h5>
              <div className="row mt-3">
                <div className="col-md-4">
                  <label className="form-label fw-bold">Doctor Name:</label>
                  <p className="text-success fw-bold">
                    {doctorData?.personalInfo?.firstName}{" "}
                    {doctorData?.personalInfo?.lastName}
                  </p>
                </div>

                <div className="col-md-4">
                  <label className="form-label fw-bold">Speciality:</label>
                  <p className="text-success fw-bold">
                    {doctorData?.professional?.specialization || "N/A"}
                  </p>
                </div>

                <div className="col-md-4">
                  <label className="form-label fw-bold">Qualifications:</label>
                  <p className="text-success fw-bold">
                    {doctorData?.professional?.qualification || "N/A"}
                  </p>
                </div>
              </div>

              {/* Submit Button */}
              <div className="text-center mt-4">
                <Button
                  type="submit"
                  label={
                    buttonmode === "CREATE"
                      ? "CREATE & Print"
                      : "UPDATE & Print"
                  }
                  icon={loading ? "pi pi-spin pi-spinner" : "pi pi-check"}
                  className="btn-custom px-5 rounded"
                  loading={loading}
                  disabled={loading}
                />
              </div>
            </div>
          </div>
        </Form>
      )}
    </Formik>
  );
}

export default DoctorPrescription;
