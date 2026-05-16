import { useFormik } from "formik";
import React, { useEffect, useState, useRef } from "react";
import { API_BASE_URL } from "../config/api";
import logo from "../assets/BIMSLOGO.png";
import "../../css/doctor.css";
import { InputText } from "primereact/inputtext";
import { FloatLabel } from "primereact/floatlabel";

import { InputTextarea } from "primereact/inputtextarea";
import { Slider } from "primereact/slider";
import { RadioButton } from "primereact/radiobutton";
import { TriStateCheckbox } from "primereact/tristatecheckbox";
import { getPatientbyID } from "../Services/userService";
import { Button } from "primereact/button";
import { toast } from "react-toastify";
import { Doctordetail } from "../Services/userService";
import { Checkbox } from "primereact/checkbox";
import { MultiSelect } from "primereact/multiselect";
import { useParams } from "react-router-dom";
import MLClogo from "../assets/MLC.jpg";
import Emergencylogo from "../assets/Emergency.jpg";
import axios from "axios";

// import { number } from "yup";

export default function Doctor() {
  const [value, setValue] = useState("");

  const [checkboxs, setCheckboxs] = useState(null);
  const [checkbox, pedalCheckboxs] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedPerson, setSelectedPerson] = useState([]);
  const [TpaId, setTpaId] = useState();
  const [testnames, setTestName] = useState([]);
  const [MLC, setMLC] = useState();

  const { UHID } = useParams();
  const formRef = useRef();

  const load = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
    }, 2000);
  };

  useEffect(() => {
    if (!UHID) return;
    getPatientbyID(UHID)
      .then((res) => {
        setTpaId(res.TPAid);
        setMLC(res.MLC);
        setDetail(res);
      })
      .catch((err) => {
        console.error("Error fetching patient:", err);
      });
  }, [UHID]);

  // getAPI of ALLTEST name.........
  useEffect(() => {
    const fetchData = async () => {
      try {
        const Testdata = await axios.get(
          `${API_BASE_URL}/Servicebilldata/getAllTestNames`,
        );
        const formattedData = Testdata.data.map((item) => ({
          label: item.tpa_name,
          value: String(item._id),
        }));
        setTestName(formattedData);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchData();
  }, []);

  // console.log(selectedGender);

  const formik = useFormik({
    initialValues: {
      Name: detail?.name || "",
      Age: detail?.age || "",
      Gender: detail?.gender || "",
      Contact: detail?.contact || "",
      Date: currentDate.toLocaleDateString(),
      UHID: detail?.UHID || "",
      Email: detail?.email || "",
      MLCNumber: detail?.MLCNumber || "",
      fathername: "",
      Provisional_diagnosis1: "",
      IPNO: "",
      consultant_incharge: "",
      Presenting_complaints_Duration: "",
      History_of_Any_Allergy: "",
      Current_Medication: "",
      Past_history_surgical_proceduresdress: "",
      Birth_History_Mile_Stone: "",
      Family_History_Person_History: "",
      Level_of_consciousness: "",
      Nutritional_status: "",
      weight: "",
      unit: "",
      Temp: "",
      temperatureUnit: "",
      BP: "",
      bpUnit: "",
      Pulse: "",
      pulseUnit: "",
      Pallor: "",
      Icterus: "",
      Cyanosis: "",
      Clibbing: "",
      Lymphadenopathy: "",
      PedalEdema: "",
      Painscore: 0,
      Location: "",
      RespiratorySystem: "",
      Auscultation_Breath_Sounds: "",
      Auscultation_Added_Sounds: "",
      Location_of_Findings_Lungs: "",
      Location_of_Findings_Zone: "",
      Percussion_Note: "",
      Trachea_Position: "",
      Abdomen: "",
      Tenderness: "",
      Location_of_Tenderness: "",
      Organomegaly: [],
      Bowel_Sounds: "",
      Ascites: "",
      Cardiovascular_System: "",
      Heart_Rhythm: "",
      Heart_Sounds_Added: "",
      Murmur_Timing: "",
      Murmur_Location: "",
      Murmur_Radiation: "",
      Peripheral_Edema: "",
      Jugular_Venous_Pressure: "",
      PA: "",
      Central_Nervous_System: "",
      Consciousness_Level: "",
      Motor_System_Focal_Deficit: "",
      Motor_System_Affected_Side: "",
      Tone: "",
      Reflexes_Deep_Tendon_Reflexes: "",
      Reflexes_Plantar_Reflex_Babinski: "",
      Reflexes_Side: "",
      Cranial_Nerves: "",
      Speech: "",
      Provisional_diagnosis: "",
      Treatment: "",
      Possible_risk: "",
      Training: [],
      PAdata: "",

      Restraints: "No", // Default value
      RestraintsSelected: "", // Physical / Chemical
      ChemicalComment: "",
      Investigation: "",
      Treatment_input: "",
      Diet: "",
      Hemiparesis: "",
      Hemiplegia: "",
      Paraparesis: "",
      Paraplegia: "",
      Quadriparesis: "",
      Quadriplegia: "",
    },

    enableReinitialize: true,

    onSubmit: async (values, { resetForm }) => {
      console.log("datassssssss:", values);

      try {
        setLoading(true);
        const users = await Doctordetail(values);

        resetForm();

        toast.success(users.data.message);
      } catch (error) {
        toast.error("Something went wrongs!");
        console.log(error);
      } finally {
        setLoading(false);
      }
    },
  });

  console.log(formik.values.Motor_System_Focal_Deficit);
  // console.log("rs:", formik.values.RS);
  // console.log("Cvs:", formik.values.CVS);
  // console.log("pa:", formik.values.PA);
  // console.log("cns:", formik.values.CNS);

  // console.log(formik.values.training);

  // ye function tum Doctor component ke andar hi bana do
  function getPainLabel(score) {
    switch (Number(score)) {
      case 0:
        return "No Pain";
      case 2:
        return "Mild Pain";
      case 4:
        return "Moderate Pain";
      case 6:
        return "Moderately Severe Pain";
      case 8:
        return "Severe Pain";
      case 10:
        return "Worst Pain Possible";
      default:
        return "";
    }
  }

  // const units = [
  //   { label: "kg", value: "kg" },
  //   { label: "lbs", value: "lbs" },
  //   { label: "g", value: "g" },
  // ];

  const handlePrint = () => {
    window.print(); // Browser ka print dialog khul jayega
  };

  const handleMultiSelectChange = (field, value, checked) => {
    let selected = [...formik.values[field]];
    if (checked) {
      selected.push(value);
    } else {
      selected = selected.filter((val) => val !== value);
    }
    formik.setFieldValue(field, selected);
  };

  const panelFooterTemplate = () => {
    const length = selectedPerson ? selectedPerson.length : 0;

    return (
      <div className="py-2 px-3">
        <b>{length}</b> item{length > 1 ? "s" : ""} selected.
      </div>
    );
  };

  return (
    <>
      <div className="container print-area " ref={formRef}>
        <form
          onSubmit={formik.handleSubmit}
          className="card shadow p-4 mt-6 bg-white rounded"
        >
          <header
            className="navbar px-5 mx-auto"
            style={{ border: "none", boxShadow: "none" }}
          >
            {/* Left: Logo */}
            <div className="navbar-logo">
              <img src={logo} alt="Hospital Logo" />
            </div>

            {/* Center: Hospital Name */}
            <div className="navbar-center">
              <h1 className="hospital-name">BIMS</h1>
              <p className="tagline">Bright Institute of Medical Sciences</p>
            </div>

            {/* Right: Contact Info */}
            <div className="navbar-right">
              <p>📞 +91 - 7988307850</p>
              <p>✉️ query.bims@gmail.com</p>
              <p>📍Gau Shala Road, Jatawara, Sonipat - 131001</p>
            </div>
          </header>

          <div
            className="card space-y-6 "
            style={{
              borderRadius: "initial",
              border: "none",
              boxShadow: "none",
            }}
          >
            {/* Name + Gender Row */}
            <div className="row">
              {/* Name with FloatLabel */}

              <div className="col-md-4">
                <label className="form-label ">Name</label>
                <InputText
                  id="name"
                  name="Name"
                  value={formik.values.Name}
                  readOnly
                  onChange={formik.handleChange}
                  className="w-100 text-success"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">Age</label>
                <InputText
                  id="age"
                  name="Age"
                  value={formik.values.Age}
                  readOnly
                  className="w-100 text-success"
                  onChange={formik.handleChange}
                />
              </div>

              {/* Gender Dropdown */}
              <div className="col-md-4">
                <label className="form-label ">Gender</label>

                <InputText
                  id="gender"
                  selected
                  name="Gender"
                  value={formik.values.Gender}
                  readOnly
                  onChange={formik.handleChange}
                  virtualScrollerOptions={{ itemSize: 38 }}
                  placeholder="Select Gender"
                  className="w-100 fw-bold text-success"
                />
              </div>
            </div>

            {/* Integer */}
            <div className="row flex gap-6">
              <div className="field flex-1 ">
                <label className="form-label "> Father/Guardian Name:</label>

                <InputText
                  id="Father"
                  name="fathername"
                  value={formik.values.fathername}
                  onChange={formik.handleChange}
                  className="w-100"
                />
              </div>
              <div className="field flex-1">
                <label className="form-label ">Number</label>

                <InputText
                  id="number"
                  keyfilter="num"
                  name="Contact"
                  value={formik.values.Contact}
                  onChange={formik.handleChange}
                  className="w-100 fw-bold text-success"
                />
              </div>
              <div className="field flex-1">
                <label className="form-label ">DOB</label>

                <InputText
                  id="dof"
                  name="Date"
                  value={formik.values.Date}
                  readOnly
                  className="w-100 fw-bold text-success"
                />
              </div>
            </div>

            {/* Hex, Alphabetic, Alphanumeric */}
            <div className="row flex gap-6">
              <div className="field flex-1">
                <label className="form-label ">Provisional Diagnosis:</label>

                <InputText
                  id="Provisional"
                  name="Provisional_diagnosis1"
                  value={formik.values.Provisional_diagnosis1}
                  onChange={formik.handleChange}
                  className="w-100"
                />
              </div>
              <div className="field flex-1">
                <label className="form-label ">UHID No:</label>

                <InputText
                  id="alphabetic"
                  keyfilter="alpha"
                  name="UHID"
                  value={formik.values.UHID}
                  readOnly
                  className="w-100 fw-bold text-success"
                />
              </div>
              <div className="field flex-1">
                <label className="form-label ">IP No:</label>

                <InputText
                  id="alphanumeric"
                  name="IPNO"
                  value={formik.values.IPNO}
                  onChange={formik.handleChange}
                  className="w-100"
                />
              </div>
            </div>

            {/* Positive Integer, Positive Number, Email */}
            <div className="row flex gap-6">
              <div className="field flex-1">
                <label className="form-label ">Consultant Incharge</label>

                <InputText
                  id="pint"
                  name="consultant_incharge"
                  value={formik.values.consultant_incharge}
                  onChange={formik.handleChange}
                  className="w-100"
                />
              </div>
              {/* <div className="field flex-1">
                <FloatLabel>
                  <InputText id="pnum" keyfilter="pnum" />
                  <label htmlFor="pnum">Positive Number</label>
                </FloatLabel>
              </div> */}
              <div className="field flex-1">
                <label className="form-label ">Email</label>

                <InputText
                  id="email"
                  keyfilter="email"
                  name="Email"
                  value={formik.values.Email}
                  readOnly
                  className="w-100 fw-bold text-success"
                />
              </div>

              {formik.values.MLCNumber && (
                <div className="field flex-1">
                  <label className="form-label ">MLC Number</label>

                  <InputText
                    id="MLC"
                    keyfilter="num"
                    name="MLCNumber"
                    value={formik.values.MLCNumber}
                    readOnly
                    className="w-100 fw-bold text-success"
                  />
                </div>
              )}
            </div>
            {/* history */}
            <div>
              {/* <h4 className="border p-2 text-center">History:</h4> */}
              <h5 className="mt-4 p-2 rounded btn-custom text-white text-center">
                History:
              </h5>

              <div className="row flex">
                <div className="col-md-6 ">
                  <label className="form-label fw-bold">
                    Presenting complaints & Duration:
                  </label>
                  <InputTextarea
                    name="Presenting_complaints_Duration"
                    value={formik.values.Presenting_complaints_Duration}
                    onChange={formik.handleChange}
                    placeholder="Enter the Presenting complaints & Duration"
                    rows={3}
                    className="w-100"
                  />
                </div>

                <div className="col-md-6 ">
                  <label className="form-label fw-bold">
                    History of Any Allergy:
                  </label>
                  <InputTextarea
                    name="History_of_Any_Allergy"
                    value={formik.values.History_of_Any_Allergy}
                    onChange={formik.handleChange}
                    placeholder="Enter the History of Any Allergy"
                    rows={3}
                    className="w-100"
                  />
                </div>
              </div>

              <div className="row flex">
                <div className="col-md-6 ">
                  <label className="form-label fw-bold">
                    Current Medication (if any):
                  </label>
                  <InputTextarea
                    name="Current_Medication"
                    value={formik.values.Current_Medication}
                    onChange={formik.handleChange}
                    placeholder="Enter Current_Medication"
                    rows={3}
                    className="w-100"
                  />
                </div>

                <div className="col-md-6 ">
                  <label className="form-label fw-bold">
                    Past history/surgical procedures:
                  </label>
                  <InputTextarea
                    name="Past_history_surgical_proceduresdress"
                    value={formik.values.Past_history_surgical_proceduresdress}
                    onChange={formik.handleChange}
                    placeholder="Enter Past history/surgical procedures"
                    rows={5}
                    cols={30}
                    className="w-100"
                  />
                </div>
              </div>
              <div className=" row flex">
                <div className="col-md-6 ">
                  <label className="form-label fw-bold">
                    Birth History/Mile Stone:
                  </label>
                  <InputText
                    name="Birth_History_Mile_Stone"
                    value={formik.values.Birth_History_Mile_Stone}
                    onChange={formik.handleChange}
                    placeholder="Enter details"
                    required
                    className="w-100"
                  />
                </div>

                <div className="col-md-6">
                  <label className="form-label fw-bold">
                    Family History/Personal History
                  </label>
                  <InputText
                    name="Family_History_Person_History"
                    value={formik.values.Family_History_Person_History}
                    onChange={formik.handleChange}
                    placeholder="Enter details"
                    className="w-100"
                  />
                </div>
              </div>
            </div>
            {/* ON EXAMINATION */}
            <div>
              <h5 className="mt-4 p-2 rounded btn-custom text-white text-center">
                ON EXAMINATION:
              </h5>
              <div className="row g-3 ">
                <div className=" col-md-12  ">
                  <label className="form-label fw-bold">
                    Level of consciousness:
                  </label>
                  {/* level */}
                  <div className="card flex flex-row   m-0 gap-3">
                    <div>
                      <RadioButton
                        inputId="alert"
                        name="Level_of_consciousness"
                        value="Alert & Oriented"
                        checked={
                          formik.values.Level_of_consciousness ===
                          "Alert & Oriented"
                        }
                        onChange={(e) =>
                          formik.setFieldValue(
                            "Level_of_consciousness",
                            e.value,
                          )
                        }
                      />
                      <label htmlFor="alert" className="ms-2">
                        Alert & Oriented
                      </label>
                    </div>
                    {/* input */}

                    <div>
                      <RadioButton
                        inputId="level"
                        name="Level_of_consciousness"
                        value="Confused"
                        checked={
                          formik.values.Level_of_consciousness === "Confused"
                        }
                        onChange={(e) =>
                          formik.setFieldValue(
                            "Level_of_consciousness",
                            e.value,
                          )
                        }
                      />
                      <label htmlFor="level" className="ms-2">
                        Confused
                      </label>
                    </div>

                    <div>
                      <RadioButton
                        inputId="drowsy"
                        name="Level_of_consciousness"
                        value="Drowsy"
                        checked={
                          formik.values.Level_of_consciousness === "Drowsy"
                        }
                        onChange={(e) =>
                          formik.setFieldValue(
                            "Level_of_consciousness",
                            e.value,
                          )
                        }
                      />
                      <label htmlFor="drowsy" className="ms-2">
                        Drowsy
                      </label>
                    </div>
                  </div>
                </div>
              </div>
              <div className="row g-3 ">
                <div className="col-md-12 ">
                  <label className="form-label fw-bold">
                    Nutritional status:
                  </label>
                  <div className="card  flex flex-row   m-0  gap-3">
                    <div>
                      <RadioButton
                        inputId="nuritaion"
                        name="Nutritional_status"
                        value="Well-Nourished"
                        checked={
                          formik.values.Nutritional_status === "Well-Nourished"
                        }
                        onChange={(e) =>
                          formik.setFieldValue("Nutritional_status", e.value)
                        }
                      />
                      <label htmlFor="nuritaion" className="ms-2">
                        Well-Nourished
                      </label>
                    </div>
                    {/* input */}

                    <div>
                      <RadioButton
                        inputId="mal"
                        name="Nutritional_status"
                        value="Malnourished"
                        checked={
                          formik.values.Nutritional_status === "Malnourished"
                        }
                        onChange={(e) =>
                          formik.setFieldValue("Nutritional_status", e.value)
                        }
                      />
                      <label htmlFor="mal" className="ms-2">
                        Malnourished
                      </label>
                    </div>

                    <div>
                      <RadioButton
                        inputId="cache"
                        name="Nutritional_status"
                        value="Cachectic"
                        checked={
                          formik.values.Nutritional_status === "Cachectic"
                        }
                        onChange={(e) =>
                          formik.setFieldValue("Nutritional_status", e.value)
                        }
                      />
                      <label htmlFor="cache" className="ms-2">
                        Cachectic
                      </label>
                    </div>
                  </div>
                  {/* row */}
                  <div className="row flex mt-3  justify-content-between w-100% ">
                    {/* Name with FloatLabel */}
                    <h1 className="fs-4">Vitals:</h1>

                    <div className="col-md-3 d-flex justify-content-evenly align-items-center">
                      <label htmlFor="temp">Weight:</label>
                      <InputText
                        id="name1"
                        name="weight"
                        value={formik.values.weight}
                        onChange={formik.handleChange}
                        placeholder="Kg"
                        style={{ width: "90px" }}
                      />
                    </div>

                    <div className="col-md-3 d-flex justify-content-evenly align-items-center">
                      <label htmlFor="temp">Temp:</label>
                      <InputText
                        id="temp"
                        name="Temp"
                        placeholder="(°F)/(°C)"
                        value={formik.values.Temp}
                        onChange={formik.handleChange}
                        style={{ width: "90px" }}
                      />
                    </div>

                    <div className="col-md-3 d-flex justify-content-evenly align-items-center">
                      <label htmlFor="bp">B.P:</label>
                      <InputText
                        id="bp"
                        name="BP"
                        placeholder="mmHg"
                        value={formik.values.BP}
                        onChange={formik.handleChange}
                        style={{ width: "90px" }}
                      />
                    </div>

                    <div className="col-md-3 d-flex justify-content-evenly align-items-center">
                      <label htmlFor="pulse">Pulse:</label>
                      <InputText
                        id="pulse"
                        name="Pulse"
                        placeholder="bpm"
                        value={formik.values.Pulse}
                        onChange={formik.handleChange}
                        style={{ width: "90px" }}
                      />
                    </div>
                  </div>

                  <div className="row flex mt-5 lh-lg item-center">
                    <h1 className="fs-4">Clinical Signs:</h1>
                    {/* Name with FloatLabel */}

                    <div className="col-md-4">
                      {/* <Checkbox
                          id="pallor"
                          name="Pallor"
                          value={formik.values.Pallor}
                          onChange={formik.handleChange}
                        />
                        <label htmlFor="pallor">Pallor</label> */}
                      <Checkbox
                        inputId="pallor"
                        name="Pallor"
                        value="Pallors"
                        checked={formik.values.Pallor === "Pallors"}
                        onChange={(e) => {
                          if (e.checked) {
                            formik.setFieldValue("Pallor", e.value); // ✅ sirf yahi select hoga
                          } else {
                            formik.setFieldValue("Pallor", ""); // ✅ unselect karne par empty
                          }
                        }}
                      />{" "}
                      <label htmlFor="pallor" className="ms-2">
                        Pallor
                      </label>
                    </div>

                    {/* Gender Dropdown */}
                    <div className="col-md-4">
                      {/* <FloatLabel>
                        <InputText
                          id="icterus"
                          name="Icterus"
                          value={formik.values.Icterus}
                          onChange={formik.handleChange}
                        />
                        <label htmlFor="icterus">Icterus</label>
                      </FloatLabel> */}
                      <Checkbox
                        inputId="icterus"
                        name="Icterus"
                        value="Icterus"
                        checked={formik.values.Icterus === "Icterus"}
                        onChange={(e) => {
                          if (e.checked) {
                            formik.setFieldValue("Icterus", e.value); // ✅ sirf yahi select hoga
                          } else {
                            formik.setFieldValue("Icterus", ""); // ✅ unselect karne par empty
                          }
                        }}
                      />{" "}
                      <label htmlFor="icterus" className="ms-2">
                        Icterus
                      </label>
                    </div>

                    {/* Name with FloatLabel */}
                    <div className="col-md-4">
                      {/* <FloatLabel>
                        <InputText
                          id="cyanosis"
                          name="Cyanosis"
                          value={formik.values.Cyanosis}
                          onChange={formik.handleChange}
                        />
                        <label htmlFor="cyanosis">Cyanosis</label>
                      </FloatLabel> */}
                      <Checkbox
                        inputId="cyanosis"
                        name="Cyanosis"
                        value="Cyanosis"
                        checked={formik.values.Cyanosis === "Cyanosis"}
                        onChange={(e) => {
                          if (e.checked) {
                            formik.setFieldValue("Cyanosis", e.value); // ✅ sirf yahi select hoga
                          } else {
                            formik.setFieldValue("Cyanosis", ""); // ✅ unselect karne par empty
                          }
                        }}
                      />{" "}
                      <label htmlFor="cyanosis" className="ms-2">
                        Cyanosis
                      </label>
                    </div>

                    <div className="col-md-4">
                      {/* <FloatLabel>
                        <InputText
                          id="clubbing"
                          name="Clibbing"
                          value={formik.values.Clibbing}
                          onChange={formik.handleChange}
                        />
                        <label htmlFor="clubbing">Clubbing</label>
                      </FloatLabel> */}
                      <Checkbox
                        inputId="clubbing"
                        name="Clibbing"
                        value="Clibbing"
                        checked={formik.values.Clibbing === "Clibbing"}
                        onChange={(e) => {
                          if (e.checked) {
                            formik.setFieldValue("Clibbing", e.value); // ✅ sirf yahi select hoga
                          } else {
                            formik.setFieldValue("Clibbing", ""); // ✅ unselect karne par empty
                          }
                        }}
                      />{" "}
                      <label htmlFor="clubbing" className="ms-2">
                        Clubbing
                      </label>
                    </div>

                    {/* Gender Dropdown */}
                    <div className="col-md-4">
                      {/* <FloatLabel>
                        <InputText
                          id="lymphnodes"
                          name="LymphNodes"
                          value={formik.values.LymphNodes}
                          onChange={formik.handleChange}
                        />
                        <label htmlFor="lymphnodes">Lymph nodes</label>
                      </FloatLabel> */}
                      <Checkbox
                        inputId="lymphnodes"
                        name="Lymphadenopathy"
                        value="Lymphadenopathy"
                        checked={
                          formik.values.Lymphadenopathy === "Lymphadenopathy"
                        }
                        onChange={(e) => {
                          if (e.checked) {
                            formik.setFieldValue("Lymphadenopathy", e.value); // ✅ sirf yahi select hoga
                          } else {
                            formik.setFieldValue("Lymphadenopathy", ""); // ✅ unselect karne par empty
                          }
                        }}
                      />{" "}
                      <label htmlFor="lymphnodes" className="ms-2">
                        Lymphadenopathy
                      </label>
                    </div>

                    {/* pedal */}

                    {/* <div className="card m-2"> */}
                    <div className="col-md-4  d-flex gap-2 align-items-center">
                      <TriStateCheckbox
                        value={checkbox}
                        onChange={(e) => pedalCheckboxs(e.value)}
                      />
                      <label className="fs-5 ">Pedal edema</label>
                    </div>

                    {checkbox ? (
                      <div className="card flex flex-row align-items-center gap-2 m-2">
                        <RadioButton
                          inputId="AbNormal"
                          name="PedalEdema"
                          value="+1(Mild)"
                          checked={formik.values.PedalEdema === "+1(Mild)"}
                          onChange={(e) =>
                            formik.setFieldValue("PedalEdema", e.value)
                          }
                        />
                        <label htmlFor="AbNormal" className="ms-2">
                          +1(Mild)
                        </label>
                        <RadioButton
                          inputId="AbNormal2"
                          name="PedalEdema"
                          value="+2(Moderate)"
                          checked={formik.values.PedalEdema === "+2(Moderate)"}
                          onChange={(e) =>
                            formik.setFieldValue("PedalEdema", e.value)
                          }
                        />
                        <label htmlFor="AbNormal2" className="ms-2">
                          +2(Moderate)
                        </label>
                        <RadioButton
                          inputId="AbNormal3"
                          name="PedalEdema"
                          value="+3(Servere)"
                          checked={formik.values.PedalEdema === "+3(Servere)"}
                          onChange={(e) =>
                            formik.setFieldValue("PedalEdema", e.value)
                          }
                        />
                        <label htmlFor="AbNormal3" className="ms-2">
                          +3(Servere)
                        </label>
                        <RadioButton
                          inputId="abnormal5"
                          name="PedalEdema"
                          value="+4(Pitting)"
                          checked={formik.values.PedalEdema === "+4(Pitting)"}
                          onChange={(e) =>
                            formik.setFieldValue("PedalEdema", e.value)
                          }
                        />
                        <label htmlFor="abnormal5" className="ms-2">
                          +4(Pitting)
                        </label>
                      </div>
                    ) : (
                      ""
                    )}
                  </div>

                  {/* score */}
                  <div className="m-2">
                    <h3 className="fs-5">Pain Score: {formik.values.score}</h3>
                    <div className="d-flex justify-content-between mt-2">
                      {[...Array(11)].map((_, i) => (
                        <span key={i}>{i}</span>
                      ))}
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="10"
                      name="score"
                      value={formik.values.score}
                      onChange={formik.handleChange}
                      className="form-range w-100"
                    />
                    {getPainLabel(formik.values.score)}
                  </div>
                  {formik.values.score > 0 && (
                    <div className="row">
                      <div className="col-md-12 ">
                        <label className="form-label fw-bold">Location:</label>
                        <InputTextarea
                          name="Location"
                          value={formik.values.Location}
                          onChange={formik.handleChange}
                          placeholder="Enter the location"
                          rows={3}
                          className=""
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <h4 className="mt-4 p-2 rounded btn-custom text-white text-center">
                      B.Systemic Examination:
                    </h4>

                    {/* examination */}
                    <div>
                      <h1 className="fs-5 mt-3">Respiratory System:</h1>
                      <div className="radio row col-12">
                        <div className="d-flex gap-3">
                          <div>
                            <RadioButton
                              inputId="xnormal"
                              name="RespiratorySystem"
                              value="Xnormal"
                              checked={
                                formik.values.RespiratorySystem === "Xnormal"
                              }
                              onChange={(e) =>
                                formik.setFieldValue(
                                  "RespiratorySystem",
                                  e.value,
                                )
                              }
                            />
                            <label htmlFor="xnormal" className="ms-2">
                              X Normal
                            </label>
                          </div>

                          <div className="d-flex gap-3">
                            <RadioButton
                              inputId="abnormal2"
                              name="RespiratorySystem"
                              value="Abnormal"
                              checked={
                                formik.values.RespiratorySystem === "Abnormal"
                              }
                              onChange={(e) =>
                                formik.setFieldValue(
                                  "RespiratorySystem",
                                  e.value,
                                )
                              }
                            />
                            <label htmlFor="abnormal2" className="ms-2">
                              Abnormal
                            </label>
                          </div>
                          {/* respiratory system radio function  */}
                        </div>
                        {formik.values.RespiratorySystem === "Abnormal" ? (
                          <div className="field flex-1">
                            {/* main div of respiratory */}
                            <div className="card flex flex-col gap-3 m-0 p-3 carddata">
                              <h1 className="fs-5">
                                Auscultation-Breath Sounds:
                              </h1>
                              <div>
                                <RadioButton
                                  inputId="vesicular"
                                  name="Auscultation_Breath_Sounds"
                                  value="Vesicular"
                                  checked={
                                    formik.values.Auscultation_Breath_Sounds ===
                                    "Vesicular"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Auscultation_Breath_Sounds",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="vesicular" className="ms-2">
                                  Vesicular (Normal)
                                </label>
                              </div>

                              <div>
                                <RadioButton
                                  inputId="bronchial"
                                  name="Auscultation_Breath_Sounds"
                                  value="Bronchial"
                                  checked={
                                    formik.values.Auscultation_Breath_Sounds ===
                                    "Bronchial"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Auscultation_Breath_Sounds",
                                      e.value,
                                    )
                                  }
                                />
                                <label htmlFor="bronchial" className="ms-2">
                                  Bronchial
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="harsh"
                                  name="Auscultation_Breath_Sounds"
                                  value="Harsh"
                                  checked={
                                    formik.values.Auscultation_Breath_Sounds ===
                                    "Harsh"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Auscultation_Breath_Sounds",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="harsh" className="ms-2">
                                  Harsh
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="diminished"
                                  name="Auscultation_Breath_Sounds"
                                  value="Diminished"
                                  checked={
                                    formik.values.Auscultation_Breath_Sounds ===
                                    "Diminished"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Auscultation_Breath_Sounds",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="diminished" className="ms-2">
                                  Diminished
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="absent"
                                  name="Auscultation_Breath_Sounds"
                                  value="Absent"
                                  checked={
                                    formik.values.Auscultation_Breath_Sounds ===
                                    "Absent"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Auscultation_Breath_Sounds",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="absent" className="ms-2">
                                  Absent
                                </label>
                              </div>

                              {formik.values.Auscultation_Breath_Sounds ===
                              "Vesicular" ? (
                                ""
                              ) : (
                                <>
                                  <h1 className="fs-5">
                                    Auscultation-Added Sounds:
                                  </h1>

                                  <div>
                                    <Checkbox
                                      inputId="wheeze"
                                      name="Auscultation_Added_Sounds"
                                      value="Wheeze-Expiratory"
                                      checked={
                                        formik.values
                                          .Auscultation_Added_Sounds ===
                                        "Wheeze-Expiratory"
                                      }
                                      onChange={(e) => {
                                        if (e.checked) {
                                          formik.setFieldValue(
                                            "Auscultation_Added_Sounds",
                                            e.value,
                                          ); // ✅ sirf yahi select hoga
                                        } else {
                                          formik.setFieldValue(
                                            "Auscultation_Added_Sounds",
                                            "",
                                          ); // ✅ unselect karne par empty
                                        }
                                      }}
                                    />
                                    <label htmlFor="wheeze" className="ms-2">
                                      Wheeze-Expiratory
                                    </label>
                                  </div>

                                  <div>
                                    <Checkbox
                                      inputId="Inspiratory"
                                      name="Auscultation_Added_Sounds"
                                      value="Wheeze-Inspiratory"
                                      checked={
                                        formik.values
                                          .Auscultation_Added_Sounds ===
                                        "Wheeze-Inspiratory"
                                      }
                                      onChange={(e) => {
                                        if (e.checked) {
                                          formik.setFieldValue(
                                            "Auscultation_Added_Sounds",
                                            e.value,
                                          ); // ✅ sirf yahi select hoga
                                        } else {
                                          formik.setFieldValue(
                                            "Auscultation_Added_Sounds",
                                            "",
                                          ); // ✅ unselect karne par empty
                                        }
                                      }}
                                    />
                                    <label
                                      htmlFor="Inspiratory"
                                      className="ms-2"
                                    >
                                      Wheeze-Inspiratory
                                    </label>
                                  </div>
                                  <div>
                                    <Checkbox
                                      inputId="Crepitations"
                                      name="Auscultation_Added_Sounds"
                                      value="Crepitations-Fine"
                                      checked={
                                        formik.values
                                          .Auscultation_Added_Sounds ===
                                        "Crepitations-Fine"
                                      }
                                      onChange={(e) => {
                                        if (e.checked) {
                                          formik.setFieldValue(
                                            "Auscultation_Added_Sounds",
                                            e.value,
                                          ); // ✅ sirf yahi select hoga
                                        } else {
                                          formik.setFieldValue(
                                            "Auscultation_Added_Sounds",
                                            "",
                                          ); // ✅ unselect karne par empty
                                        }
                                      }}
                                    />{" "}
                                    <label
                                      htmlFor="Crepitations"
                                      className="ms-2"
                                    >
                                      Crepitations-Fine
                                    </label>
                                  </div>
                                  <div>
                                    <Checkbox
                                      inputId="Crepitations"
                                      name="Auscultation_Added_Sounds"
                                      value="Crepitations-Coarse"
                                      checked={
                                        formik.values
                                          .Auscultation_Added_Sounds ===
                                        "Crepitations-Coarse"
                                      }
                                      onChange={(e) => {
                                        if (e.checked) {
                                          formik.setFieldValue(
                                            "Auscultation_Added_Sounds",
                                            e.value,
                                          ); // ✅ sirf yahi select hoga
                                        } else {
                                          formik.setFieldValue(
                                            "Auscultation_Added_Sounds",
                                            "",
                                          ); // ✅ unselect karne par empty
                                        }
                                      }}
                                    />{" "}
                                    <label
                                      htmlFor="Crepitations"
                                      className="ms-2"
                                    >
                                      Crepitations-Coarse
                                    </label>
                                  </div>
                                  <div>
                                    <Checkbox
                                      inputId="rhonchi"
                                      name="Auscultation_Added_Sounds"
                                      value="Rhonchi"
                                      checked={
                                        formik.values
                                          .Auscultation_Added_Sounds ===
                                        "Rhonchi"
                                      }
                                      onChange={(e) => {
                                        if (e.checked) {
                                          formik.setFieldValue(
                                            "Auscultation_Added_Sounds",
                                            e.value,
                                          ); // ✅ sirf yahi select hoga
                                        } else {
                                          formik.setFieldValue(
                                            "Auscultation_Added_Sounds",
                                            "",
                                          ); // ✅ unselect karne par empty
                                        }
                                      }}
                                    />{" "}
                                    <label htmlFor="rhonchi" className="ms-2">
                                      Rhonchi
                                    </label>
                                  </div>
                                  <div>
                                    <Checkbox
                                      inputId="Pleural"
                                      name="Auscultation_Added_Sounds"
                                      value="Pleural Rub"
                                      checked={
                                        formik.values
                                          .Auscultation_Added_Sounds ===
                                        "Pleural Rub"
                                      }
                                      onChange={(e) => {
                                        if (e.checked) {
                                          formik.setFieldValue(
                                            "Auscultation_Added_Sounds",
                                            e.value,
                                          ); // ✅ sirf yahi select hoga
                                        } else {
                                          formik.setFieldValue(
                                            "Auscultation_Added_Sounds",
                                            "",
                                          ); // ✅ unselect karne par empty
                                        }
                                      }}
                                    />{" "}
                                    <label htmlFor="Pleural" className="ms-2">
                                      Pleural Rub
                                    </label>
                                  </div>
                                  <div>
                                    <Checkbox
                                      inputId="stridor"
                                      name="Auscultation_Added_Sounds"
                                      value="Stridor"
                                      checked={
                                        formik.values
                                          .Auscultation_Added_Sounds ===
                                        "Stridor"
                                      }
                                      onChange={(e) => {
                                        if (e.checked) {
                                          formik.setFieldValue(
                                            "Auscultation_Added_Sounds",
                                            e.value,
                                          ); // ✅ sirf yahi select hoga
                                        } else {
                                          formik.setFieldValue(
                                            "Auscultation_Added_Sounds",
                                            "",
                                          ); // ✅ unselect karne par empty
                                        }
                                      }}
                                    />{" "}
                                    <label htmlFor="stridor" className="ms-2">
                                      Stridor
                                    </label>
                                  </div>
                                  <h1 className="fs-5">
                                    Location of Findings-Lungs:
                                  </h1>
                                  <div>
                                    <RadioButton
                                      inputId="right8"
                                      name="Location_of_Findings_Lungs"
                                      value="Right"
                                      checked={
                                        formik.values
                                          .Location_of_Findings_Lungs ===
                                        "Right"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Location_of_Findings_Lungs",
                                          e.value,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="right8" className="ms-2">
                                      Right
                                    </label>
                                  </div>
                                  <div>
                                    <RadioButton
                                      inputId="Left12"
                                      name="Location_of_Findings_Lungs"
                                      value="Left"
                                      checked={
                                        formik.values
                                          .Location_of_Findings_Lungs === "Left"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Location_of_Findings_Lungs",
                                          e.value,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="Left12" className="ms-2">
                                      Left
                                    </label>
                                  </div>
                                  <div>
                                    <RadioButton
                                      inputId="bilateral"
                                      name="Location_of_Findings_Lungs"
                                      value="Bilateral"
                                      checked={
                                        formik.values
                                          .Location_of_Findings_Lungs ===
                                        "Bilateral"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Location_of_Findings_Lungs",
                                          e.value,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="bilateral" className="ms-2">
                                      Bilateral
                                    </label>
                                  </div>
                                  <h1 className="fs-5">
                                    Location of Findings-Zone:
                                  </h1>
                                  <div>
                                    <RadioButton
                                      inputId="upper"
                                      name="Location_of_Findings_Zone"
                                      value="Upper"
                                      checked={
                                        formik.values
                                          .Location_of_Findings_Zone === "Upper"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Location_of_Findings_Zone",
                                          e.value,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="upper" className="ms-2">
                                      Upper
                                    </label>
                                  </div>
                                  <div>
                                    <RadioButton
                                      inputId="mid"
                                      name="Location_of_Findings_Zone"
                                      value="Mid"
                                      checked={
                                        formik.values
                                          .Location_of_Findings_Zone === "Mid"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Location_of_Findings_Zone",
                                          e.value,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="mid" className="ms-2">
                                      Mid
                                    </label>
                                  </div>
                                  <div>
                                    <RadioButton
                                      inputId="LowerBase"
                                      name="Location_of_Findings_Zone"
                                      value="Lower / Base"
                                      checked={
                                        formik.values
                                          .Location_of_Findings_Zone ===
                                        "Lower / Base"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Location_of_Findings_Zone",
                                          e.value,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="LowerBase" className="ms-2">
                                      Lower / Base
                                    </label>
                                  </div>
                                  <div>
                                    <RadioButton
                                      inputId="generalized"
                                      name="Location_of_Findings_Zone"
                                      value="Generalized"
                                      checked={
                                        formik.values
                                          .Location_of_Findings_Zone ===
                                        "Generalized"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Location_of_Findings_Zone",
                                          e.value,
                                        )
                                      }
                                    />{" "}
                                    <label
                                      htmlFor="generalized"
                                      className="ms-2"
                                    >
                                      Generalized
                                    </label>
                                  </div>
                                </>
                              )}

                              <h1 className="fs-5">Percussion Note:</h1>
                              <div>
                                <RadioButton
                                  inputId="Resonant"
                                  name="Percussion_Note"
                                  value="Resonant (Normal)"
                                  checked={
                                    formik.values.Percussion_Note ===
                                    "Resonant (Normal)"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Percussion_Note",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="Resonant" className="ms-2">
                                  Resonant (Normal)
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="dull"
                                  name="Percussion_Note"
                                  value="Dull"
                                  checked={
                                    formik.values.Percussion_Note === "Dull"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Percussion_Note",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="dull" className="ms-2">
                                  Dull
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="StonyDull"
                                  name="Percussion_Note"
                                  value="Stony Dull"
                                  checked={
                                    formik.values.Percussion_Note ===
                                    "Stony Dull"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Percussion_Note",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="StonyDull" className="ms-2">
                                  Stony Dull
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Hyper"
                                  name="Percussion_Note"
                                  value="Hyper-resonant"
                                  checked={
                                    formik.values.Percussion_Note ===
                                    "Hyper-resonant"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Percussion_Note",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="Hyper" className="ms-2">
                                  Hyper-resonant
                                </label>
                              </div>
                              <h1 className="fs-5">Trachea Position:</h1>
                              <div>
                                <RadioButton
                                  inputId="central"
                                  name="Trachea_Position"
                                  value="Central"
                                  checked={
                                    formik.values.Trachea_Position === "Central"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Trachea_Position",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="central" className="ms-2">
                                  Central
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Deviated"
                                  name="Trachea_Position"
                                  value="Deviated Right"
                                  checked={
                                    formik.values.Trachea_Position ===
                                    "Deviated Right"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Trachea_Position",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="Deviated" className="ms-2">
                                  Deviated Right
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="DeviatedLeft"
                                  name="Trachea_Position"
                                  value="Deviated Left"
                                  checked={
                                    formik.values.Trachea_Position ===
                                    "Deviated Left"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Trachea_Position",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="DeviatedLeft" className="ms-2">
                                  Deviated Left
                                </label>
                              </div>
                            </div>
                          </div>
                        ) : (
                          ""
                        )}

                        {/* next data */}
                        <div className="mt-4">
                          <h1 className="fs-5">Abdomen:</h1>
                          <div>
                            <p>Status:</p>
                            <div className="d-flex gap-3">
                              <div>
                                <RadioButton
                                  inputId="xnormal1"
                                  name="Abdomen"
                                  value="X Normal"
                                  checked={formik.values.Abdomen === "X Normal"}
                                  onChange={(e) =>
                                    formik.setFieldValue("Abdomen", e.value)
                                  }
                                />
                                <label htmlFor="xnormal1" className="ms-2">
                                  X Normal
                                </label>
                              </div>

                              <div className="d-flex gap-3">
                                <RadioButton
                                  inputId="abnormal2"
                                  name="Abdomen"
                                  value="Abnormal"
                                  checked={formik.values.Abdomen === "Abnormal"}
                                  onChange={(e) =>
                                    formik.setFieldValue("Abdomen", e.value)
                                  }
                                />
                                <label htmlFor="abnormal2" className="ms-2">
                                  Abnormal
                                </label>
                              </div>
                            </div>
                            {formik.values.Abdomen === "Abnormal" ? (
                              <div className="field flex-1 ">
                                <div className="card flex flex-col gap-3 m-0 p-3 carddata">
                                  <h1 className="fs-5">Tenderness:</h1>
                                  <div>
                                    <RadioButton
                                      inputId="None19"
                                      name="Tenderness"
                                      value="None"
                                      checked={
                                        formik.values.Tenderness === "None"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Tenderness",
                                          e.value,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="None19" className="ms-2">
                                      None
                                    </label>
                                  </div>

                                  <div className="d-flex gap-3">
                                    <RadioButton
                                      inputId="present"
                                      name="Tenderness"
                                      value="Present"
                                      checked={
                                        formik.values.Tenderness === "Present"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Tenderness",
                                          e.value,
                                        )
                                      }
                                    />
                                    <label htmlFor="present" className="ms-2">
                                      Present
                                    </label>
                                  </div>

                                  {formik.values.Tenderness === "Present" ? (
                                    <>
                                      <h1 className="fs-5">
                                        Location of Tenderness:
                                      </h1>
                                      <div>
                                        <RadioButton
                                          inputId="epigastric"
                                          name="Location_of_Tenderness"
                                          value="Epigastric"
                                          checked={
                                            formik.values
                                              .Location_of_Tenderness ===
                                            "Epigastric"
                                          }
                                          onChange={(e) =>
                                            formik.setFieldValue(
                                              "Location_of_Tenderness",
                                              e.value,
                                            )
                                          }
                                        />{" "}
                                        <label
                                          htmlFor="epigastric"
                                          className="ms-2"
                                        >
                                          Epigastric
                                        </label>
                                      </div>
                                      <div>
                                        <RadioButton
                                          inputId="RUQ"
                                          name="Location_of_Tenderness"
                                          value="Right Upper Quadrant (RUQ)"
                                          checked={
                                            formik.values
                                              .Location_of_Tenderness ===
                                            "Right Upper Quadrant (RUQ)"
                                          }
                                          onChange={(e) =>
                                            formik.setFieldValue(
                                              "Location_of_Tenderness",
                                              e.value,
                                            )
                                          }
                                        />
                                        <label htmlFor="RUQ" className="ms-2">
                                          Right Upper Quadrant (RUQ)
                                        </label>
                                      </div>
                                      <div>
                                        <RadioButton
                                          inputId="LUQ"
                                          name="Location_of_Tenderness"
                                          value="Left Upper Quadrant (LUQ)"
                                          checked={
                                            formik.values
                                              .Location_of_Tenderness ===
                                            "Left Upper Quadrant (LUQ)"
                                          }
                                          onChange={(e) =>
                                            formik.setFieldValue(
                                              "Location_of_Tenderness",
                                              e.value,
                                            )
                                          }
                                        />{" "}
                                        <label htmlFor="LUQ" className="ms-2">
                                          Left Upper Quadrant (LUQ)
                                        </label>
                                      </div>
                                      <div>
                                        <RadioButton
                                          inputId="RLQ"
                                          name="Location_of_Tenderness"
                                          value="Right Lower Quadrant (RLQ)"
                                          checked={
                                            formik.values
                                              .Location_of_Tenderness ===
                                            "Right Lower Quadrant (RLQ)"
                                          }
                                          onChange={(e) =>
                                            formik.setFieldValue(
                                              "Location_of_Tenderness",
                                              e.value,
                                            )
                                          }
                                        />{" "}
                                        <label htmlFor="RLQ" className="ms-2">
                                          Right Lower Quadrant (RLQ)
                                        </label>
                                      </div>
                                      <div>
                                        <RadioButton
                                          inputId="LLQ"
                                          name="Location_of_Tenderness"
                                          value="Left Lower Quadrant (LLQ)"
                                          checked={
                                            formik.values
                                              .Location_of_Tenderness ===
                                            "Left Lower Quadrant (LLQ)"
                                          }
                                          onChange={(e) =>
                                            formik.setFieldValue(
                                              "Location_of_Tenderness",
                                              e.value,
                                            )
                                          }
                                        />{" "}
                                        <label htmlFor="LLQ" className="ms-2">
                                          Left Lower Quadrant (LLQ)
                                        </label>
                                      </div>
                                      <div>
                                        <RadioButton
                                          inputId="periumbilical"
                                          name="Location_of_Tenderness"
                                          value="Periumbilical"
                                          checked={
                                            formik.values
                                              .Location_of_Tenderness ===
                                            "Periumbilical"
                                          }
                                          onChange={(e) =>
                                            formik.setFieldValue(
                                              "Location_of_Tenderness",
                                              e.value,
                                            )
                                          }
                                        />{" "}
                                        <label
                                          htmlFor="periumbilical"
                                          className="ms-2"
                                        >
                                          Periumbilical
                                        </label>
                                      </div>
                                      <div>
                                        <RadioButton
                                          inputId="suprapubic"
                                          name="Location_of_Tenderness"
                                          value="Suprapubic"
                                          checked={
                                            formik.values
                                              .Location_of_Tenderness ===
                                            "Suprapubic"
                                          }
                                          onChange={(e) =>
                                            formik.setFieldValue(
                                              "Location_of_Tenderness",
                                              e.value,
                                            )
                                          }
                                        />{" "}
                                        <label
                                          htmlFor="suprapubic"
                                          className="ms-2"
                                        >
                                          Suprapubic
                                        </label>
                                      </div>
                                      <div>
                                        <RadioButton
                                          inputId="DiffuseGeneralized"
                                          name="Location_of_Tenderness"
                                          value="Diffuse/Generalized"
                                          checked={
                                            formik.values
                                              .Location_of_Tenderness ===
                                            "Diffuse/Generalized"
                                          }
                                          onChange={(e) =>
                                            formik.setFieldValue(
                                              "Location_of_Tenderness",
                                              e.value,
                                            )
                                          }
                                        />{" "}
                                        <label
                                          htmlFor="DiffuseGeneralized"
                                          className="ms-2"
                                        >
                                          Diffuse/Generalized
                                        </label>
                                      </div>
                                    </>
                                  ) : (
                                    ""
                                  )}

                                  {/* Organomegaly */}
                                  <h1 className="fs-5">Organomegaly:</h1>

                                  <div>
                                    <Checkbox
                                      inputId="Hepatomegaly"
                                      name="Organomegaly"
                                      value="Hepatomegaly (Enlarged Liver)"
                                      checked={formik.values.Organomegaly.includes(
                                        "Hepatomegaly (Enlarged Liver)",
                                      )}
                                      onChange={(e) =>
                                        handleMultiSelectChange(
                                          "Organomegaly",
                                          e.value,
                                          e.checked,
                                        )
                                      }
                                    />{" "}
                                    <label
                                      htmlFor="Hepatomegaly"
                                      className="ms-2"
                                    >
                                      Hepatomegaly (Enlarged Liver)
                                    </label>
                                  </div>
                                  <div>
                                    <Checkbox
                                      inputId="LiverTenderness"
                                      name="Organomegaly"
                                      value="Liver Tenderness"
                                      checked={formik.values.Organomegaly.includes(
                                        "Liver Tenderness",
                                      )}
                                      onChange={(e) =>
                                        handleMultiSelectChange(
                                          "Organomegaly",
                                          e.value,
                                          e.checked,
                                        )
                                      }
                                    />
                                    <label
                                      htmlFor="LiverTenderness"
                                      className="ms-2"
                                    >
                                      Liver Tenderness
                                    </label>
                                  </div>
                                  <div>
                                    <Checkbox
                                      inputId="Liver Nodularity"
                                      name="Organomegaly"
                                      value="Liver Nodularity"
                                      checked={formik.values.Organomegaly.includes(
                                        "Liver Nodularity",
                                      )}
                                      onChange={(e) =>
                                        handleMultiSelectChange(
                                          "Organomegaly",
                                          e.value,
                                          e.checked,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="xnormal1" className="ms-2">
                                      Liver Nodularity
                                    </label>
                                  </div>
                                  <div>
                                    <Checkbox
                                      inputId="Splenomegaly (Enlarged Spleen)"
                                      name="Organomegaly"
                                      value="Splenomegaly (Enlarged Spleen)"
                                      checked={formik.values.Organomegaly.includes(
                                        "Splenomegaly (Enlarged Spleen)",
                                      )}
                                      onChange={(e) =>
                                        handleMultiSelectChange(
                                          "Organomegaly",
                                          e.value,
                                          e.checked,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="xnormal1" className="ms-2">
                                      Splenomegaly (Enlarged Spleen)
                                    </label>
                                  </div>
                                  <div>
                                    <Checkbox
                                      inputId="Kidney Enlargement"
                                      name="Organomegaly"
                                      value="Kidney Enlargement"
                                      checked={formik.values.Organomegaly.includes(
                                        "Kidney Enlargement",
                                      )}
                                      onChange={(e) =>
                                        handleMultiSelectChange(
                                          "Organomegaly",
                                          e.value,
                                          e.checked,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="xnormal1" className="ms-2">
                                      Kidney Enlargement
                                    </label>
                                  </div>
                                  <div>
                                    <Checkbox
                                      inputId="Palpable Mass (Other)"
                                      name="Organomegaly"
                                      value="Palpable Mass (Other)"
                                      checked={formik.values.Organomegaly.includes(
                                        "Palpable Mass (Other)",
                                      )}
                                      onChange={(e) =>
                                        handleMultiSelectChange(
                                          "Organomegaly",
                                          e.value,
                                          e.checked,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="xnormal1" className="ms-2">
                                      Palpable Mass (Other)
                                    </label>
                                  </div>

                                  {/* bowel sound */}

                                  <h1 className="fs-5">Bowel Sounds:</h1>
                                  <div>
                                    <RadioButton
                                      inputId="Normoactive"
                                      name="Bowel_Sounds"
                                      value="Normoactive"
                                      checked={
                                        formik.values.Bowel_Sounds ===
                                        "Normoactive"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Bowel_Sounds",
                                          e.value,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="xnormal1" className="ms-2">
                                      Normoactive
                                    </label>
                                  </div>
                                  <div>
                                    <RadioButton
                                      inputId="Hyperactive"
                                      name="Bowel_Sounds"
                                      value="Hyperactive"
                                      checked={
                                        formik.values.Bowel_Sounds ===
                                        "Hyperactive"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Bowel_Sounds",
                                          e.value,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="xnormal1" className="ms-2">
                                      Hyperactive
                                    </label>
                                  </div>
                                  <div>
                                    <RadioButton
                                      inputId="Hypoactive"
                                      name="Bowel_Sounds"
                                      value="Hypoactive"
                                      checked={
                                        formik.values.Bowel_Sounds ===
                                        "Hypoactive"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Bowel_Sounds",
                                          e.value,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="xnormal1" className="ms-2">
                                      Hypoactive
                                    </label>
                                  </div>
                                  <div>
                                    <RadioButton
                                      inputId="Absent"
                                      name="Bowel_Sounds"
                                      value="Absent"
                                      checked={
                                        formik.values.Bowel_Sounds === "Absent"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Bowel_Sounds",
                                          e.value,
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="xnormal1" className="ms-2">
                                      Absent
                                    </label>
                                  </div>

                                  <h1 className="fs-5">Ascites:</h1>

                                  <div className="flex gap-3">
                                    <RadioButton
                                      inputId="Absent"
                                      name="Ascites"
                                      value="Absent"
                                      checked={
                                        formik.values.Ascites === "Absent"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue("Ascites", e.value)
                                      }
                                    />{" "}
                                    <label htmlFor="xnormal1" className="ms-2">
                                      Absent
                                    </label>
                                  </div>

                                  <div>
                                    <RadioButton
                                      inputId="Present – Shifting Dullness Positive"
                                      name="Ascites"
                                      value="Present – Shifting Dullness Positive"
                                      checked={
                                        formik.values.Ascites ===
                                        "Present – Shifting Dullness Positive"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue("Ascites", e.value)
                                      }
                                    />{" "}
                                    <label htmlFor="xnormal1" className="ms-2">
                                      Present – Shifting Dullness Positive
                                    </label>
                                  </div>

                                  <div>
                                    <RadioButton
                                      inputId="Present – Fluid Thrill Positive"
                                      name="Ascites"
                                      value="Present – Fluid Thrill Positive"
                                      checked={
                                        formik.values.Ascites ===
                                        "Present – Fluid Thrill Positive"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue("Ascites", e.value)
                                      }
                                    />{" "}
                                    <label htmlFor="xnormal1" className="ms-2">
                                      Present – Fluid Thrill Positive
                                    </label>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              ""
                            )}
                          </div>
                        </div>
                        {/* Cradiovascular system */}
                        <h1 className="fs-5 mt-3 mt-4">
                          Cardiovascular System:
                        </h1>
                        <div className="d-flex gap-3">
                          <div>
                            <RadioButton
                              inputId="xNormal"
                              name="Cardiovascular_System"
                              value="Xnormal"
                              checked={
                                formik.values.Cardiovascular_System ===
                                "Xnormal"
                              }
                              onChange={(e) =>
                                formik.setFieldValue(
                                  "Cardiovascular_System",
                                  e.value,
                                )
                              }
                            />
                            <label htmlFor="xNormal3" className="ms-2">
                              X Normal
                            </label>
                          </div>
                          <div>
                            <RadioButton
                              inputId="AbNormal"
                              name="Cardiovascular_System"
                              value="Abnormal"
                              checked={
                                formik.values.Cardiovascular_System ===
                                "Abnormal"
                              }
                              onChange={(e) =>
                                formik.setFieldValue(
                                  "Cardiovascular_System",
                                  e.value,
                                )
                              }
                            />
                            <label htmlFor="abnormal4" className="ms-2">
                              Abnormal
                            </label>
                          </div>
                        </div>
                        {formik.values.Cardiovascular_System === "Abnormal" ? (
                          <div className="field flex-1">
                            <div className="card flex flex-col gap-3 m-0 p-3 carddata">
                              <h1 className="fs-5">Heart Rhythm:</h1>
                              <div>
                                <RadioButton
                                  inputId="Regular Sinus Rhythm"
                                  name="Heart_Rhythm"
                                  value="Regular Sinus Rhythm"
                                  checked={
                                    formik.values.Heart_Rhythm ===
                                    "Regular Sinus Rhythm"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Heart_Rhythm",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Regular Sinus Rhythm
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Irregularly Irregular"
                                  name="Heart_Rhythm"
                                  value="Irregularly Irregular"
                                  checked={
                                    formik.values.Heart_Rhythm ===
                                    "Irregularly Irregular"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Heart_Rhythm",
                                      e.value,
                                    )
                                  }
                                />
                                <label htmlFor="xnormal1" className="ms-2">
                                  Irregularly Irregular
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Regularly Irregular"
                                  name="Heart_Rhythm"
                                  value="Regularly Irregular"
                                  checked={
                                    formik.values.Heart_Rhythm ===
                                    "Regularly Irregular"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Heart_Rhythm",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Regularly Irregular
                                </label>
                              </div>

                              <h1 className="fs-5">Heart Sounds – Added::</h1>
                              <div>
                                <RadioButton
                                  inputId="S3 Gallop"
                                  name="Heart_Sounds_Added"
                                  value="S3 Gallop"
                                  checked={
                                    formik.values.Heart_Sounds_Added ===
                                    "S3 Gallop"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Heart_Sounds_Added",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  S3 Gallop
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="S4 Gallop"
                                  name="Heart_Sounds_Added"
                                  value="S4 Gallop"
                                  checked={
                                    formik.values.Heart_Sounds_Added ===
                                    "S4 Gallop"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Heart_Sounds_Added",
                                      e.value,
                                    )
                                  }
                                />
                                <label htmlFor="xnormal1" className="ms-2">
                                  S4 Gallop
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Murmur"
                                  name="Heart_Sounds_Added"
                                  value="Murmur"
                                  checked={
                                    formik.values.Heart_Sounds_Added ===
                                    "Murmur"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Heart_Sounds_Added",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Murmur
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Click"
                                  name="Heart_Sounds_Added"
                                  value="Click"
                                  checked={
                                    formik.values.Heart_Sounds_Added === "Click"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Heart_Sounds_Added",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Click
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Opening Snap"
                                  name="Heart_Sounds_Added"
                                  value="Opening Snap"
                                  checked={
                                    formik.values.Heart_Sounds_Added ===
                                    "Opening Snap"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Heart_Sounds_Added",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Opening Snap
                                </label>
                              </div>

                              <h1 className="fs-5">Murmur Timing:</h1>
                              <div>
                                <RadioButton
                                  inputId="Systolic"
                                  name="Murmur_Timing"
                                  value="Systolic"
                                  checked={
                                    formik.values.Murmur_Timing === "Systolic"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Murmur_Timing",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Systolic
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Diastolic"
                                  name="Murmur_Timing"
                                  value="Diastolic"
                                  checked={
                                    formik.values.Murmur_Timing === "Diastolic"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Murmur_Timing",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Diastolic
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Continuous"
                                  name="Murmur_Timing"
                                  value="Continuous"
                                  checked={
                                    formik.values.Murmur_Timing === "Continuous"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Murmur_Timing",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Continuous
                                </label>
                              </div>
                              <h1 className="fs-5">Murmur Location:</h1>
                              <div>
                                <RadioButton
                                  inputId="Aortic"
                                  name="Murmur_Location"
                                  value="Aortic"
                                  checked={
                                    formik.values.Murmur_Location === "Aortic"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Murmur_Location",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Aortic
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Mitral"
                                  name="Murmur_Location"
                                  value="Mitral"
                                  checked={
                                    formik.values.Murmur_Location === "Mitral"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Murmur_Location",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Mitral
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Tricuspid"
                                  name="Murmur_Location"
                                  value="Tricuspid"
                                  checked={
                                    formik.values.Murmur_Location ===
                                    "Tricuspid"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Murmur_Location",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Tricuspid
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Pulmonic"
                                  name="Murmur_Location"
                                  value="Pulmonic"
                                  checked={
                                    formik.values.Murmur_Location === "Pulmonic"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Murmur_Location",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Pulmonic
                                </label>
                              </div>
                              {/* <h1 className="fs-5">Murmur Radiation:</h1>
                                  <div>
                                    <RadioButton
                                      inputId="No Radiation"
                                      name="Murmur_Radiation"
                                      value="No Radiation"
                                      checked={
                                        formik.values.Murmur_Radiation ===
                                        "No Radiation"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Murmur_Radiation",
                                          e.value
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="xnormal1" className="ms-2">
                                      No Radiation
                                    </label>
                                  </div> */}
                              <div>
                                <RadioButton
                                  inputId="To Carotids"
                                  name="Murmur_Radiation"
                                  value="To Carotids"
                                  checked={
                                    formik.values.Murmur_Radiation ===
                                    "To Carotids"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Murmur_Radiation",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  To Carotids
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="To Axilla"
                                  name="Murmur_Radiation"
                                  value="To Axilla"
                                  checked={
                                    formik.values.Murmur_Radiation ===
                                    "To Axilla"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Murmur_Radiation",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  To Axilla
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="To Back"
                                  name="Murmur_Radiation"
                                  value="To Back"
                                  checked={
                                    formik.values.Murmur_Radiation === "To Back"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Murmur_Radiation",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  To Back
                                </label>
                              </div>
                              {/* <h1 className="fs-5">Peripheral Edema:</h1>
                                  <div>
                                    <RadioButton
                                      inputId="Absent"
                                      name="Peripheral_Edema"
                                      value="Absent"
                                      checked={
                                        formik.values.Peripheral_Edema ===
                                        "Absent"
                                      }
                                      onChange={(e) =>
                                        formik.setFieldValue(
                                          "Peripheral_Edema",
                                          e.value
                                        )
                                      }
                                    />{" "}
                                    <label htmlFor="xnormal1" className="ms-2">
                                      Absent
                                    </label>
                                  </div> */}
                              {/* <div>
                                <RadioButton
                                  inputId="Present – Pitting (Ankle)"
                                  name="Peripheral_Edema"
                                  value="Present – Pitting (Ankle)"
                                  checked={
                                    formik.values.Peripheral_Edema ===
                                    "Present – Pitting (Ankle)"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Peripheral_Edema",
                                      e.value
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Present – Pitting (Ankle)
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Present – Pitting (Pedal)"
                                  name="Peripheral_Edema"
                                  value="Present – Pitting (Pedal)"
                                  checked={
                                    formik.values.Peripheral_Edema ===
                                    "Present – Pitting (Pedal)"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Peripheral_Edema",
                                      e.value
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Present – Pitting (Pedal)
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Present – Generalized (Anasarca)"
                                  name="Peripheral_Edema"
                                  value="Present – Generalized (Anasarca)"
                                  checked={
                                    formik.values.Peripheral_Edema ===
                                    "Present – Generalized (Anasarca)"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Peripheral_Edema",
                                      e.value
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Present – Generalized (Anasarca)
                                </label>
                              </div> */}
                              <h1 className="fs-5">
                                Jugular Venous Pressure (JVP):
                              </h1>
                              <div>
                                <RadioButton
                                  inputId="Normal"
                                  name="Jugular_Venous_Pressure"
                                  value="Normal"
                                  checked={
                                    formik.values.Jugular_Venous_Pressure ===
                                    "Normal"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Jugular_Venous_Pressure",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Normal
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Elevated"
                                  name="Jugular_Venous_Pressure"
                                  value="Elevated"
                                  checked={
                                    formik.values.Jugular_Venous_Pressure ===
                                    "Elevated"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Jugular_Venous_Pressure",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Elevated
                                </label>
                              </div>
                              <div>
                                <RadioButton
                                  inputId="Not Assessed"
                                  name="Jugular_Venous_Pressure"
                                  value="Not Assessed"
                                  checked={
                                    formik.values.Jugular_Venous_Pressure ===
                                    "Not Assessed"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Jugular_Venous_Pressure",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="xnormal1" className="ms-2">
                                  Not Assessed
                                </label>
                              </div>
                            </div>
                          </div>
                        ) : (
                          ""
                        )}

                        {/* <h1 className="fs-5 mt-4">P/A:</h1>
                        <div className="d-flex gap-3">
                          <div>
                            <RadioButton
                              inputId="xnormal"
                              name="PA"
                              value="Xnormal"
                              checked={formik.values.PA === "Xnormal"}
                              onChange={(e) =>
                                formik.setFieldValue("PA", e.value)
                              }
                            />
                            <label htmlFor="xnormal" className="ms-2">
                              X Normal
                            </label>
                          </div>
                          <div>
                            <RadioButton
                              inputId="abnormal5"
                              name="PA"
                              value="Abnormal"
                              checked={formik.values.PA === "Abnormal"}
                              onChange={(e) =>
                                formik.setFieldValue("PA", e.value)
                              }
                            />
                            <label htmlFor="abnormal5" className="ms-2">
                              Abnormal
                            </label>
                          </div>
                        </div>
                        {formik.values.PA === "Abnormal" ? (
                          <div className="field flex-1 ">
                            <FloatLabel>
                              <InputText
                                id="abnormals"
                                name="PAdata"
                                value={formik.values.PAdata}
                                onChange={formik.handleChange}
                                className="w-100 mt-2"
                              />
                              <label htmlFor="abnormals" className="pt-1">
                                Enter detail
                              </label>
                            </FloatLabel>
                          </div>
                        ) : (
                          ""
                        )} */}

                        {/* cenetral Nervous */}

                        <h1 className="fs-5 mt-3">Central Nervous System:</h1>
                        <div className="d-flex gap-3 ">
                          <div>
                            <RadioButton
                              inputId="XNormal11"
                              name="Central_Nervous_System"
                              value="Xnormal"
                              checked={
                                formik.values.Central_Nervous_System ===
                                "Xnormal"
                              }
                              onChange={(e) =>
                                formik.setFieldValue(
                                  "Central_Nervous_System",
                                  e.value,
                                )
                              }
                            />
                            <label htmlFor="XNormal11" className="ms-2">
                              X Normal
                            </label>
                          </div>
                          {/* input */}

                          <div>
                            <RadioButton
                              inputId="abnormal54"
                              name="Central_Nervous_System"
                              value="Abnormal"
                              checked={
                                formik.values.Central_Nervous_System ===
                                "Abnormal"
                              }
                              onChange={(e) =>
                                formik.setFieldValue(
                                  "Central_Nervous_System",
                                  e.value,
                                )
                              }
                            />
                            <label htmlFor="abnormal54" className="ms-2">
                              Abnormal
                            </label>
                          </div>
                        </div>
                      </div>

                      {formik.values.Central_Nervous_System === "Abnormal" ? (
                        <div className="field flex-1 mt-3">
                          {/* main div of respiratory */}
                          <div className="card flex flex-col gap-3 m-0 p-3">
                            <h1 className="fs-5">Consciousness Level:</h1>
                            <div>
                              <RadioButton
                                inputId="Alert"
                                name="Consciousness_Level"
                                value="Alert & Oriented"
                                checked={
                                  formik.values.Consciousness_Level ===
                                  "Alert & Oriented"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Consciousness_Level",
                                    e.value,
                                  )
                                }
                              />{" "}
                              <label htmlFor="Alert" className="ms-2">
                                Alert & Oriented
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="Confused1"
                                name="Consciousness_Level"
                                value="Confused"
                                checked={
                                  formik.values.Consciousness_Level ===
                                  "Confused"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Consciousness_Level",
                                    e.value,
                                  )
                                }
                              />
                              <label htmlFor="Confused1" className="ms-2">
                                Confused
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="drowsy"
                                name="Consciousness_Level"
                                value="Drowsy"
                                checked={
                                  formik.values.Consciousness_Level === "Drowsy"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Consciousness_Level",
                                    e.value,
                                  )
                                }
                              />{" "}
                              <label htmlFor="drowsy" className="ms-2">
                                Drowsy
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="stuporous"
                                name="Consciousness_Level"
                                value="Stuporous"
                                checked={
                                  formik.values.Consciousness_Level ===
                                  "Stuporous"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Consciousness_Level",
                                    e.value,
                                  )
                                }
                              />{" "}
                              <label htmlFor="stuporous" className="ms-2">
                                Stuporous
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="unconscious"
                                name="Consciousness_Level"
                                value="Unconscious"
                                checked={
                                  formik.values.Consciousness_Level ===
                                  "Unconscious"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Consciousness_Level",
                                    e.value,
                                  )
                                }
                              />{" "}
                              <label htmlFor="unconscious" className="ms-2">
                                Unconscious
                              </label>
                            </div>

                            <h1 className="fs-5">
                              Motor System – Focal Deficit:
                            </h1>
                            <div>
                              <RadioButton
                                inputId="none1"
                                name="Motor_System_Focal_Deficit"
                                value="None"
                                checked={
                                  formik.values.Motor_System_Focal_Deficit ===
                                  "None"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Motor_System_Focal_Deficit",
                                    e.value,
                                    console.log(e.value),
                                  )
                                }
                              />
                              <label htmlFor="none1" className="ms-2">
                                None
                              </label>
                            </div>

                            <div>
                              <RadioButton
                                inputId="Hemiparesis"
                                name="Motor_System_Focal_Deficit"
                                value="Hemiparesis"
                                checked={
                                  formik.values.Motor_System_Focal_Deficit ===
                                  "Hemiparesis"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Motor_System_Focal_Deficit",
                                    e.value,
                                  )
                                }
                              />
                              <label htmlFor="Hemiparesis" className="ms-2">
                                Hemiparesis
                              </label>
                            </div>

                            {formik.values.Motor_System_Focal_Deficit ===
                              "Hemiparesis" && (
                              <div
                                className="d-flex gap-2 p-2"
                                style={{ boxShadow: "inherit" }}
                              >
                                <RadioButton
                                  inputId="left2"
                                  name="Hemiparesis"
                                  value="Left"
                                  checked={formik.values.Hemiparesis === "Left"}
                                  onChange={(e) =>
                                    formik.setFieldValue("Hemiparesis", e.value)
                                  }
                                />{" "}
                                <label htmlFor="left2" className="ms-2">
                                  Left
                                </label>
                                <RadioButton
                                  inputId="right1"
                                  name="Hemiparesis"
                                  value="Right"
                                  checked={
                                    formik.values.Hemiparesis === "Right"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue("Hemiparesis", e.value)
                                  }
                                />{" "}
                                <label htmlFor="right1" className="ms-2">
                                  Right
                                </label>
                              </div>
                            )}

                            <div>
                              <RadioButton
                                inputId="hemiplegias"
                                name="Motor_System_Focal_Deficit"
                                value="Hemiplegia"
                                checked={
                                  formik.values.Motor_System_Focal_Deficit ===
                                  "Hemiplegia"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Motor_System_Focal_Deficit",
                                    e.value,
                                  )
                                }
                              />
                              <label htmlFor="hemiplegias" className="ms-2">
                                Hemiplegia
                              </label>
                            </div>

                            {formik.values.Motor_System_Focal_Deficit ===
                              "Hemiplegia" && (
                              <div
                                className="d-flex gap-2 p-2"
                                style={{ boxShadow: "inherit" }}
                              >
                                <RadioButton
                                  inputId="left7"
                                  name="Hemiplegia"
                                  value="Left"
                                  checked={formik.values.Hemiplegia === "Left"}
                                  onChange={(e) =>
                                    formik.setFieldValue("Hemiplegia", e.value)
                                  }
                                />{" "}
                                <label htmlFor="left7" className="ms-2">
                                  Left
                                </label>
                                <RadioButton
                                  inputId="right8"
                                  name="Hemiplegia"
                                  value="Right"
                                  checked={formik.values.Hemiplegia === "Right"}
                                  onChange={(e) =>
                                    formik.setFieldValue("Hemiplegia", e.value)
                                  }
                                />{" "}
                                <label htmlFor="right8" className="ms-2">
                                  Right
                                </label>
                              </div>
                            )}

                            <div>
                              <RadioButton
                                inputId="Paraparesis"
                                name="Motor_System_Focal_Deficit"
                                value="Paraparesis"
                                checked={
                                  formik.values.Motor_System_Focal_Deficit ===
                                  "Paraparesis"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Motor_System_Focal_Deficit",
                                    e.value,
                                  )
                                }
                              />
                              <label htmlFor="Paraparesis" className="ms-2">
                                Paraparesis
                              </label>
                            </div>

                            {formik.values.Motor_System_Focal_Deficit ===
                              "Paraparesis" && (
                              <div
                                className="d-flex gap-2 p-2"
                                style={{ boxShadow: "inherit" }}
                              >
                                <RadioButton
                                  inputId="Bilaterals4"
                                  name="Paraparesis"
                                  value="Bilateral(Lower limbs)"
                                  checked={
                                    formik.values.Paraparesis ===
                                    "Bilateral(Lower limbs)"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue("Paraparesis", e.value)
                                  }
                                />{" "}
                                <label htmlFor="Bilaterals4" className="ms-2">
                                  Bilateral(Lower limbs)
                                </label>
                              </div>
                            )}

                            <div>
                              <RadioButton
                                inputId="Paraplegia"
                                name="Motor_System_Focal_Deficit"
                                value="Paraplegia"
                                checked={
                                  formik.values.Motor_System_Focal_Deficit ===
                                  "Paraplegia"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Motor_System_Focal_Deficit",
                                    e.value,
                                  )
                                }
                              />
                              <label htmlFor="Paraplegia" className="ms-2">
                                Paraplegia
                              </label>
                            </div>

                            {formik.values.Motor_System_Focal_Deficit ===
                              "Paraplegia" && (
                              <div
                                className="d-flex gap-2 p-2"
                                style={{ boxShadow: "inherit" }}
                              >
                                <RadioButton
                                  inputId="Bilaterals"
                                  name="Paraplegia"
                                  value="Bilateral(Lower limbs)"
                                  checked={
                                    formik.values.Paraplegia ===
                                    "Bilateral(Lower limbs)"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue("Paraplegia", e.value)
                                  }
                                />{" "}
                                <label htmlFor="Bilaterals" className="ms-2">
                                  Bilateral(Lower limbs)
                                </label>
                              </div>
                            )}

                            <div>
                              <RadioButton
                                inputId="Quadriparesis11"
                                name="Motor_System_Focal_Deficit"
                                value="Quadriparesis"
                                checked={
                                  formik.values.Motor_System_Focal_Deficit ===
                                  "Quadriparesis"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Motor_System_Focal_Deficit",
                                    e.value,
                                  )
                                }
                              />
                              <label htmlFor="Quadriparesis11" className="ms-2">
                                Quadripares
                              </label>
                            </div>

                            {formik.values.Motor_System_Focal_Deficit ===
                              "Quadriparesis" && (
                              <div
                                className="d-flex gap-2 p-2"
                                style={{ boxShadow: "inherit" }}
                              >
                                <RadioButton
                                  inputId="Bilaterals2"
                                  name="Quadriparesis"
                                  value="Bilateral(All 4 limbs)"
                                  checked={
                                    formik.values.Quadriparesis ===
                                    "Bilateral(All 4 limbs)"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Quadriparesis",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="Bilaterals2" className="ms-2">
                                  Bilateral(All 4 limbs)
                                </label>
                              </div>
                            )}

                            <div>
                              <RadioButton
                                inputId="quadriplegia"
                                name="Motor_System_Focal_Deficit"
                                value="Quadriplegia"
                                checked={
                                  formik.values.Motor_System_Focal_Deficit ===
                                  "Quadriplegia"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Motor_System_Focal_Deficit",
                                    e.value,
                                  )
                                }
                              />
                              <label htmlFor="quadriplegia" className="ms-2">
                                Quadriplegia
                              </label>
                            </div>

                            {formik.values.Motor_System_Focal_Deficit ===
                              "Quadriplegia" && (
                              <div
                                className="d-flex gap-2 p-2"
                                style={{ boxShadow: "inherit" }}
                              >
                                <RadioButton
                                  inputId="Bilaterals21"
                                  name="Quadriplegia"
                                  value="Bilateral(All 4 limbs)"
                                  checked={
                                    formik.values.Quadriplegia ===
                                    "Bilateral(All 4 limbs)"
                                  }
                                  onChange={(e) =>
                                    formik.setFieldValue(
                                      "Quadriplegia",
                                      e.value,
                                    )
                                  }
                                />{" "}
                                <label htmlFor="Bilaterals21" className="ms-2">
                                  Bilateral(All 4 limbs)
                                </label>
                              </div>
                            )}

                            <h1 className="fs-5">
                              Motor System – Affected Side:
                            </h1>
                            <div>
                              <RadioButton
                                inputId="Right"
                                name="Motor_System_Affected_Side"
                                value="Right"
                                checked={
                                  formik.values.Motor_System_Affected_Side ===
                                  "Right"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Motor_System_Affected_Side",
                                    e.value,
                                  )
                                }
                              />
                              <label htmlFor="Right" className="ms-2">
                                Right
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="Left21"
                                name="Motor_System_Affected_Side"
                                value="Left"
                                checked={
                                  formik.values.Motor_System_Affected_Side ===
                                  "Left"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Motor_System_Affected_Side",
                                    e.value,
                                  )
                                }
                              />
                              <label htmlFor="Left21" className="ms-2">
                                Left
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="bilateral"
                                name="Motor_System_Affected_Side"
                                value="Bilateral"
                                checked={
                                  formik.values.Motor_System_Affected_Side ===
                                  "Bilateral"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Motor_System_Affected_Side",
                                    e.value,
                                  )
                                }
                              />{" "}
                              <label htmlFor="bilateral" className="ms-2">
                                Bilateral
                              </label>
                            </div>
                            <h1 className="fs-5">Tone:</h1>
                            <div>
                              <RadioButton
                                inputId="Normal"
                                name="Tone"
                                value="Normal"
                                checked={formik.values.Tone === "Normal"}
                                onChange={(e) =>
                                  formik.setFieldValue("Tone", e.value)
                                }
                              />{" "}
                              <label htmlFor="Normal" className="ms-2">
                                Normal
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="Increased12"
                                name="Tone"
                                value="Increased (Spasticity/Rigidity)"
                                checked={
                                  formik.values.Tone ===
                                  "Increased (Spasticity/Rigidity)"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue("Tone", e.value)
                                }
                              />{" "}
                              <label htmlFor="Increased12" className="ms-2">
                                Increased (Spasticity/Rigidity)
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="Decreased"
                                name="Tone"
                                value="Decreased (Hypotonia)"
                                checked={
                                  formik.values.Tone === "Decreased (Hypotonia)"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue("Tone", e.value)
                                }
                              />{" "}
                              <label htmlFor="Decreased" className="ms-2">
                                Decreased (Hypotonia)
                              </label>
                            </div>

                            <h1 className="fs-5">
                              Reflexes – Deep Tendon Reflexes:
                            </h1>
                            <div>
                              <RadioButton
                                inputId="Normal22"
                                name="Reflexes_Deep_Tendon_Reflexes"
                                value="Normal"
                                checked={
                                  formik.values
                                    .Reflexes_Deep_Tendon_Reflexes === "Normal"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Reflexes_Deep_Tendon_Reflexes",
                                    e.value,
                                  )
                                }
                              />{" "}
                              <label htmlFor="Normal22" className="ms-2">
                                Normal
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="Hyporeflexia1"
                                name="Reflexes_Deep_Tendon_Reflexes"
                                value="Hyporeflexia"
                                checked={
                                  formik.values
                                    .Reflexes_Deep_Tendon_Reflexes ===
                                  "Hyporeflexia"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Reflexes_Deep_Tendon_Reflexes",
                                    e.value,
                                  )
                                }
                              />{" "}
                              <label htmlFor="Hyporeflexia1" className="ms-2">
                                Hyporeflexia
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="hyperreflexia"
                                name="Reflexes_Deep_Tendon_Reflexes"
                                value="Hyperreflexia"
                                checked={
                                  formik.values
                                    .Reflexes_Deep_Tendon_Reflexes ===
                                  "Hyperreflexia"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Reflexes_Deep_Tendon_Reflexes",
                                    e.value,
                                  )
                                }
                              />{" "}
                              <label htmlFor="hyperreflexia" className="ms-2">
                                Hyperreflexia
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="absent"
                                name="Reflexes_Deep_Tendon_Reflexes"
                                value="Absent"
                                checked={
                                  formik.values
                                    .Reflexes_Deep_Tendon_Reflexes === "Absent"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Reflexes_Deep_Tendon_Reflexes",
                                    e.value,
                                  )
                                }
                              />{" "}
                              <label htmlFor="absent" className="ms-2">
                                Absent
                              </label>
                            </div>
                            <h1 className="fs-5">
                              Reflexes – Plantar Reflex (Babinski):
                            </h1>

                            <div>
                              <RadioButton
                                inputId="Flexor"
                                name="Reflexes_Plantar_Reflex_Babinski"
                                value="Flexor (Normal)"
                                checked={
                                  formik.values
                                    .Reflexes_Plantar_Reflex_Babinski ===
                                  "Flexor (Normal)"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Reflexes_Plantar_Reflex_Babinski",
                                    e.value,
                                  )
                                }
                              />{" "}
                              <label htmlFor="Flexor" className="ms-2">
                                Flexor (Normal)
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="Extensor"
                                name="Reflexes_Plantar_Reflex_Babinski"
                                value="Extensor (Abnormal)"
                                checked={
                                  formik.values
                                    .Reflexes_Plantar_Reflex_Babinski ===
                                  "Extensor (Abnormal)"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Reflexes_Plantar_Reflex_Babinski",
                                    e.value,
                                  )
                                }
                              />{" "}
                              <label htmlFor="Extensor" className="ms-2">
                                Extensor (Abnormal)
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="equivocal"
                                name="Reflexes_Plantar_Reflex_Babinski"
                                value="Equivocal"
                                checked={
                                  formik.values
                                    .Reflexes_Plantar_Reflex_Babinski ===
                                  "Equivocal"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Reflexes_Plantar_Reflex_Babinski",
                                    e.value,
                                  )
                                }
                              />{" "}
                              <label htmlFor="equivocal" className="ms-2">
                                Equivocal
                              </label>
                            </div>

                            {formik.values.Reflexes_Plantar_Reflex_Babinski ===
                              "Extensor (Abnormal)" ||
                            formik.values.Reflexes_Plantar_Reflex_Babinski ===
                              "Equivocal" ? (
                              <>
                                <h1 className="fs-5">Reflexes – Side::</h1>
                                <div>
                                  <RadioButton
                                    inputId="Rights"
                                    name="Reflexes_Side"
                                    value="Right"
                                    checked={
                                      formik.values.Reflexes_Side === "Right"
                                    }
                                    onChange={(e) =>
                                      formik.setFieldValue(
                                        "Reflexes_Side",
                                        e.value,
                                      )
                                    }
                                  />{" "}
                                  <label htmlFor="Rights" className="ms-2">
                                    Right
                                  </label>
                                </div>

                                <div>
                                  <RadioButton
                                    inputId="Lefts"
                                    name="Reflexes_Side"
                                    value="Left"
                                    checked={
                                      formik.values.Reflexes_Side === "Left"
                                    }
                                    onChange={(e) =>
                                      formik.setFieldValue(
                                        "Reflexes_Side",
                                        e.value,
                                      )
                                    }
                                  />{" "}
                                  <label htmlFor="Lefts" className="ms-2">
                                    Left
                                  </label>
                                </div>

                                <div>
                                  <RadioButton
                                    inputId="bilateral"
                                    name="Reflexes_Side"
                                    value="Bilateral"
                                    checked={
                                      formik.values.Reflexes_Side ===
                                      "Bilateral"
                                    }
                                    onChange={(e) =>
                                      formik.setFieldValue(
                                        "Reflexes_Side",
                                        e.value,
                                      )
                                    }
                                  />{" "}
                                  <label htmlFor="bilateral" className="ms-2">
                                    Bilateral
                                  </label>
                                </div>
                              </>
                            ) : (
                              ""
                            )}

                            <h1 className="fs-5">Cranial Nerves:</h1>
                            <div>
                              <RadioButton
                                inputId="GrosslyIntact"
                                name="Cranial_Nerves"
                                value="Grossly Intact"
                                checked={
                                  formik.values.Cranial_Nerves ===
                                  "Grossly Intact"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Cranial_Nerves",
                                    e.value,
                                  )
                                }
                              />{" "}
                              <label htmlFor="GrosslyIntact" className="ms-2">
                                Grossly Intact
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="DeficitPresent"
                                name="Cranial_Nerves"
                                value="Deficit Present (Specify)"
                                checked={
                                  formik.values.Cranial_Nerves ===
                                  "Deficit Present (Specify)"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue(
                                    "Cranial_Nerves",
                                    e.value,
                                  )
                                }
                              />{" "}
                              <label htmlFor="DeficitPresent" className="ms-2">
                                Deficit Present (Specify)
                              </label>
                              {formik.values.Cranial_Nerves ===
                                "Deficit Present (Specify)" && (
                                <div>
                                  <textarea
                                    rows="4"
                                    cols="70"
                                    placeholder="Enter Somthing?"
                                  ></textarea>
                                </div>
                              )}
                            </div>
                            <h1 className="fs-5">Speech:</h1>
                            <div>
                              <RadioButton
                                inputId="normal"
                                name="Speech"
                                value="Normal"
                                checked={formik.values.Speech === "Normal"}
                                onChange={(e) =>
                                  formik.setFieldValue("Speech", e.value)
                                }
                              />{" "}
                              <label htmlFor="normal" className="ms-2">
                                Normal
                              </label>
                            </div>
                            <div>
                              <RadioButton
                                inputId="dysarthria"
                                name="Speech"
                                value="Dysarthria"
                                checked={formik.values.Speech === "Dysarthria"}
                                onChange={(e) =>
                                  formik.setFieldValue("Speech", e.value)
                                }
                              />{" "}
                              <label htmlFor="dysarthria" className="ms-2">
                                Dysarthria
                              </label>
                            </div>

                            <div>
                              <RadioButton
                                inputId="AphasiaExpressive11"
                                name="Speech"
                                value="Aphasia – Expressive"
                                checked={
                                  formik.values.Speech ===
                                  "Aphasia – Expressive"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue("Speech", e.value)
                                }
                              />{" "}
                              <label
                                htmlFor="AphasiaExpressive11"
                                className="ms-2"
                              >
                                Aphasia – Expressive
                              </label>
                            </div>

                            <div>
                              <RadioButton
                                inputId="AphasiaReceptive"
                                name="Speech"
                                value="Aphasia – Receptive"
                                checked={
                                  formik.values.Speech === "Aphasia – Receptive"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue("Speech", e.value)
                                }
                              />{" "}
                              <label
                                htmlFor="AphasiaReceptive"
                                className="ms-2"
                              >
                                Aphasia – Receptive
                              </label>
                            </div>

                            <div>
                              <RadioButton
                                inputId="Aphasia – Global"
                                name="Speech"
                                value="Aphasia – Global"
                                checked={
                                  formik.values.Speech === "Aphasia – Global"
                                }
                                onChange={(e) =>
                                  formik.setFieldValue("Speech", e.value)
                                }
                              />{" "}
                              <label
                                htmlFor="Aphasia – Global"
                                className="ms-2"
                              >
                                Aphasia – Global
                              </label>
                            </div>

                            {/* end of dropdown */}
                          </div>
                        </div>
                      ) : (
                        ""
                      )}
                    </div>

                    <h1 className="fs-4 mt-3">Plan of Care:</h1>
                    {/* plan of care */}
                    <div className="mt-4">
                      <div className="col-md-12 ">
                        <label className="form-label fw-bold">
                          Provisional diagnosis:
                        </label>
                        <InputText
                          name="Provisional_diagnosis"
                          value={formik.values.Provisional_diagnosis}
                          onChange={formik.handleChange}
                          placeholder="Enter Detail"
                          required
                          className="w-100"
                        />
                      </div>
                    </div>
                    {/* treatment */}
                    <div className="mt-4">
                      <h4 className="fs-5">Treatment:</h4>
                      <div className="d-flex gap-3">
                        <div>
                          <RadioButton
                            inputId="Treatment1"
                            name="Treatment"
                            value="medical"
                            checked={formik.values.Treatment === "medical"}
                            onChange={(e) =>
                              formik.setFieldValue("Treatment", e.value)
                            }
                          />
                          <label htmlFor="Treatment1" className="ms-2">
                            Medical
                          </label>
                        </div>
                        <div>
                          <RadioButton
                            inputId="surgical"
                            name="Treatment"
                            value="Surgical"
                            checked={formik.values.Treatment === "Surgical"}
                            onChange={(e) =>
                              formik.setFieldValue("Treatment", e.value)
                            }
                          />
                          <label htmlFor="surgical" className="ms-2">
                            Surgical
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="col-md-12 mt-4 ">
                      <label className="form-label fw-bold">
                        Possible risk / complication:
                      </label>
                      <InputText
                        name="Possible_risk"
                        value={formik.values.Possible_risk}
                        onChange={formik.handleChange}
                        placeholder="Enter Detail"
                        required
                        className="w-100"
                      />
                    </div>

                    <div className="mt-4">
                      <h4 className="fs-5">Training / Education to the:</h4>
                      <div className="d-flex gap-3">
                        <div>
                          <Checkbox
                            inputId="patient"
                            name="Training1"
                            value="Patient"
                            // checked={formik.values.Training === "Patient"}
                            checked={formik.values.Training.includes("Patient")}
                            // onChange={(e) =>
                            //   formik.setFieldValue("Training", e.value)
                            // }
                            onChange={(e) =>
                              handleMultiSelectChange(
                                "Training",
                                e.value,
                                e.checked,
                              )
                            }
                          />
                          <label htmlFor="Training1" className="ms-2">
                            Patient
                          </label>
                        </div>
                        <div>
                          <Checkbox
                            inputId="Training2"
                            name="Training"
                            value="Relative"
                            // checked={formik.values.Training === "Relative"}
                            checked={formik.values.Training.includes(
                              "Relative",
                            )}
                            // onChange={(e) =>
                            //   formik.setFieldValue("Training", e.value)
                            // }
                            onChange={(e) =>
                              handleMultiSelectChange(
                                "Training",
                                e.value,
                                e.checked,
                              )
                            }
                          />

                          <label htmlFor="Training2" className="ms-2">
                            Relative (Name)
                          </label>
                        </div>
                      </div>
                    </div>
                    {/* plan care */}
                    <div className="mt-4 btn-custom text-white rounded">
                      <h4 className="border p-2 text-center">
                        PLAN OF CARE{" "}
                        <span className="fs-6 text-black">
                          (To be filled by Doctor...)
                        </span>
                      </h4>
                    </div>
                    {/* Restraints */}

                    <h1 className="fs-5 mt-3">Restraints:Yes/No</h1>
                    <div className="d-flex gap-3 mt-4 align-items-center">
                      {/* ✅ Restraints = Yes */}
                      <div>
                        <RadioButton
                          inputId="restraintsYes"
                          name="Restraints"
                          value="Yes"
                          checked={formik.values.Restraints === "Yes"}
                          onChange={(e) =>
                            formik.setFieldValue("Restraints", e.value)
                          }
                        />
                        <label htmlFor="restraintsYes" className="ms-2">
                          Yes
                        </label>
                      </div>

                      {/* ✅ If Yes selected → show Physical / Chemical */}
                      {formik.values.Restraints === "Yes" && (
                        <div className="d-flex gap-3 align-items-center ms-3">
                          <div className="d-flex align-items-center gap-2">
                            <RadioButton
                              inputId="physical"
                              name="RestraintsSelected"
                              value="Physical"
                              checked={
                                formik.values.RestraintsSelected === "Physical"
                              }
                              onChange={(e) => {
                                formik.setFieldValue(
                                  "RestraintsSelected",
                                  e.value,
                                );
                                // Clear chemical comment when not Chemical
                                if (e.value !== "Chemical") {
                                  formik.setFieldValue("ChemicalComment", "");
                                }
                              }}
                            />
                            <label htmlFor="physical" className="ms-2">
                              Physical
                            </label>
                          </div>

                          <div className="d-flex align-items-center gap-2">
                            <RadioButton
                              inputId="chemical"
                              name="RestraintsSelected"
                              value="Chemical"
                              checked={
                                formik.values.RestraintsSelected === "Chemical"
                              }
                              onChange={(e) =>
                                formik.setFieldValue(
                                  "RestraintsSelected",
                                  e.value,
                                )
                              }
                            />
                            <label htmlFor="chemical" className="ms-2">
                              Chemical
                            </label>
                          </div>
                        </div>
                      )}

                      {/* ✅ Restraints = No */}
                      <div className="ms-4">
                        <RadioButton
                          inputId="restraintsNo"
                          name="Restraints"
                          value="No"
                          checked={formik.values.Restraints === "No"}
                          onChange={(e) => {
                            formik.setFieldValue("Restraints", e.value);
                            // Clear dependent fields
                            formik.setFieldValue("RestraintsSelected", "");
                            formik.setFieldValue("ChemicalComment", "");
                          }}
                        />
                        <label htmlFor="restraintsNo" className="ms-2">
                          No
                        </label>
                      </div>
                    </div>

                    {/* ✅ If Chemical selected → show comment box */}
                    {formik.values.Restraints === "Yes" &&
                      formik.values.RestraintsSelected === "Chemical" && (
                        <div className="mt-3">
                          <label
                            htmlFor="chemicalComment"
                            className="form-label"
                          >
                            Comment (for Chemical)
                          </label>
                          <InputTextarea
                            id="chemicalComment"
                            value={formik.values.ChemicalComment}
                            onChange={(e) =>
                              formik.setFieldValue(
                                "ChemicalComment",
                                e.target.value,
                              )
                            }
                            rows={3}
                            cols={50}
                            placeholder="Enter chemical restraint comment..."
                          />
                        </div>
                      )}

                    <div className="col-md-12 mt-4 ">
                      <div className="row">
                        <div className="col">
                          <label className="form-label fw-bold">
                            Investigation/Services
                          </label>
                        </div>
                        <div className="col ">
                          <MultiSelect
                            value={selectedPerson}
                            onChange={(e) => setSelectedPerson(e.value || [])}
                            options={testnames}
                            optionLabel="label"
                            optionValue="value"
                            placeholder="Select your Test"
                            filter
                            filterDelay={400}
                            // panelFooterTemplate={panelFooterTemplate}
                            className="w-full md:w-20rem"
                            display="chip"
                          />
                        </div>
                      </div>

                      <InputTextarea
                        name="Investigation"
                        value={formik.values.address}
                        onChange={formik.handleChange}
                        placeholder="Enter Investigation "
                        rows={3}
                        className="mt-3"
                      />
                    </div>

                    <div className="col-md-12 mt-2">
                      <label className="form-label fw-bold">Treatment:</label>
                      <InputTextarea
                        name="Treatment_input"
                        value={formik.values.Treatment_input}
                        onChange={formik.handleChange}
                        placeholder="Treatment information"
                        rows={3}
                        className=""
                      />
                    </div>
                    {/* dite */}

                    <h1 className="fs-5 mt-3">Diet:</h1>
                    <div className="row mt-3">
                      <div className="col d-flex gap-2 ">
                        <label htmlFor="">Normal</label>
                        <Checkbox
                          name="Diet"
                          value="Normal"
                          checked={formik.values.Diet === "Normal"}
                          onChange={(e) => {
                            if (e.checked) {
                              formik.setFieldValue("Diet", e.value); // ✅ sirf yahi select hoga
                            } else {
                              formik.setFieldValue("Diet", ""); // ✅ unselect karne par empty
                            }
                          }}
                        />
                      </div>
                      <div className=" col d-flex gap-2 ">
                        <label htmlFor="">Liguid</label>
                        <Checkbox
                          name="Diet"
                          value="Liguid"
                          checked={formik.values.Diet === "Liguid"}
                          onChange={(e) => {
                            if (e.checked) {
                              formik.setFieldValue("Diet", e.value); // ✅ sirf yahi select hoga
                            } else {
                              formik.setFieldValue("Diet", ""); // ✅ unselect karne par empty
                            }
                          }}
                        />
                      </div>
                      <div className="col d-flex gap-2  ">
                        <label htmlFor="">Semi-Solid</label>
                        <Checkbox
                          name="Diet"
                          value="Semi-Solid"
                          checked={formik.values.Diet === "Semi-Solid"}
                          onChange={(e) => {
                            if (e.checked) {
                              formik.setFieldValue("Diet", e.value); // ✅ sirf yahi select hoga
                            } else {
                              formik.setFieldValue("Diet", ""); // ✅ unselect karne par empty
                            }
                          }}
                        />
                      </div>

                      <div className="col d-flex gap-2 ">
                        <label htmlFor="">N.P.O</label>
                        <Checkbox
                          name="Diet"
                          value="N.P.O"
                          checked={formik.values.Diet === "N.P.O"}
                          onChange={(e) => {
                            if (e.checked) {
                              formik.setFieldValue("Diet", e.value); // ✅ sirf yahi select hoga
                            } else {
                              formik.setFieldValue("Diet", ""); // ✅ unselect karne par empty
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="container text-center ">
            <div class="row row-cols-1 ">
              {/* Submit */}
              <div className=" col-md-10 text-center mt-4 no-printbutton">
                <Button
                  type="submit"
                  label="Submit"
                  icon="pi pi-check"
                  loading={loading}
                  className="btn-custom px-5 rounded "
                  style={{ position: "relative", left: "27px" }}
                />
              </div>

              {/* Print Button */}
              <div className="col-md-8">
                <button
                  onClick={handlePrint}
                  className="mt-2 bg-success text-white p-2 rounded no-printbutton fw-bold btncss"
                >
                  Print Form
                </button>
              </div>
              {MLC ? (
                <div
                  className="col-md-3 MLC-image"
                  style={{ position: "relative", left: "80px", bottom: "50px" }}
                >
                  <img src={MLClogo} alt="MLC Image" />
                </div>
              ) : (
                <div
                  className="Emergency-image"
                  style={{
                    position: "relative",
                    left: "400px",
                    bottom: "90px",
                  }}
                >
                  {" "}
                  <img src={Emergencylogo} alt="Emergency Image" />
                </div>
              )}
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
