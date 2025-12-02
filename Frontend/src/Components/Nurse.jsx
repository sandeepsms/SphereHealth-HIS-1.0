import React, { useEffect, useState } from "react";
import logo from "../assets/logowebsite11.png";
import "../../css/doctor.css";
import { InputText } from "primereact/inputtext";
import { FloatLabel } from "primereact/floatlabel";
import { Dropdown } from "primereact/dropdown";
import { InputTextarea } from "primereact/inputtextarea";
import { Slider } from "primereact/slider";
import { RadioButton } from "primereact/radiobutton";
import { TriStateCheckbox } from "primereact/tristatecheckbox";
import { getPatientbyID } from "../Services/userService";
import { useFormik } from "formik";

import { useParams } from "react-router-dom";

export default function Nurse() {
  const [value, setValue] = useState("");
  const [selectedGender, setSelectedGender] = useState(null);
  const [checkboxs, setCheckboxs] = useState(null);
  const [checkbox, pedalCheckboxs] = useState(null);
  const [detail, setDetail] = useState(null);
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState("kg");

  const [temp, setTemp] = useState("");
  const [tempUnit, setTempUnit] = useState("°C");

  const [bp, setBp] = useState("");
  const [bpUnit, setBpUnit] = useState("mmHg");

  const [pulse, setPulse] = useState("");
  const [pulseUnit, setPulseUnit] = useState("bpm");

  const weightUnits = [
    { label: "kg", value: "kg" },
    { label: "lbs", value: "lbs" },
  ];
  const tempUnits = [
    { label: "°C", value: "°C" },
    { label: "°F", value: "°F" },
  ];
  const bpUnits = [{ label: "mmHg", value: "mmHg" }];
  const pulseUnits = [{ label: "bpm", value: "bpm" }];

  const { UHID } = useParams();

  useEffect(() => {
    if (!UHID) return;
    getPatientbyID(UHID)
      .then((res) => {
        setDetail(res);
        console.log("Patient data:", res);
      })
      .catch((err) => {
        console.error("Error fetching patient:", err);
      });
  }, [UHID]);

  useEffect(() => {
    if (detail) {
      setSelectedGender(detail.gender); // 👈 API ka gender set kar diya
    }
  }, [detail]);

  console.log(selectedGender);

  const genderOptions = [
    { label: "Male", value: "male" },
    { label: "Female", value: "female" },
    { label: "Other", value: "other" },
  ];

  const formik = useFormik({
    initialValues: {
      name: "",
      email: "",
      age: "",
      gender: "",
      contact: "",
      birth: "",
      martial: "",
      city: "",
      state: "",
      blood: "",
      address: "",
      allergies: "",
      companion: "",
      relationship: "",
      contactno: "",
      time: "",
      date: "",
      RS: "",
      cvs: "",
      PA: "",
      CNS: "",
      score: 0,
      treatment: "",
      training: "",
    },
  });

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

  return (
    <>
      <div className="container ">
        <header className="navbar    px-5 mx-auto">
          {/* Left: Logo */}
          <div className="navbar-logo">
            <img src={logo} alt="Hospital Logo" />
          </div>

          {/* Center: Hospital Name */}
          <div className="navbar-center">
            <h1 className="hospital-name">SUKOON HOSPITALS</h1>
            <p className="tagline">
              run by Spherehealth Medical Solutions Pvt. Ltd.
            </p>
          </div>

          {/* Right: Contact Info */}
          <div className="navbar-right">
            <p>📞 7988807650, 0130-4052310</p>
            <p>✉️ admin@sukoonhospitals.com</p>
            <p>📍 Mohalla Jatwara, Kumaro Ki Chopal ke Samne, Sonipat (HR)</p>
          </div>
        </header>

        <div className="card space-y-6">
          {/* Name + Gender Row */}
          <div className="row flex gap-6">
            {/* Name with FloatLabel */}
            <div className="field flex-1">
              <FloatLabel>
                <InputText
                  id="name"
                  value={detail?.name || ""}
                  readOnly
                  onChange={(e) => setValue(e.value)}
                  className="fw-bold text-success"
                />
                <label htmlFor="name">Name</label>
              </FloatLabel>
            </div>

            <div className="field flex-1">
              <FloatLabel>
                <InputText
                  id="age"
                  value={detail?.age || ""}
                  readOnly
                  className="fw-bold text-success"
                  onChange={(e) => setValue(e.value)}
                />
                <label htmlFor="age">Age</label>
              </FloatLabel>
            </div>

            {/* Gender Dropdown */}
            <div className="field w-1/3">
              <FloatLabel>
                <Dropdown
                  id="gender"
                  selected
                  value={selectedGender}
                  onChange={(e) => setSelectedGender(e.value)}
                  options={genderOptions}
                  virtualScrollerOptions={{ itemSize: 38 }}
                  placeholder="Select Gender"
                  className="w-full fw-bold text-success"
                />
                <label htmlFor="gender">Gender</label>
              </FloatLabel>
            </div>
          </div>

          {/* Integer */}
          <div className="row flex gap-6">
            <div className="field flex-1 ">
              <FloatLabel>
                <InputText id="integer" keyfilter="int" />
                <label htmlFor="integer" className="text-green-700">
                  Father/Guardian Name:
                </label>
              </FloatLabel>
            </div>
            <div className="field flex-1">
              <FloatLabel>
                <InputText
                  id="number"
                  keyfilter="num"
                  value={detail?.contact || ""}
                  className="fw-bold text-success"
                />
                <label htmlFor="number">Number</label>
              </FloatLabel>
            </div>
            <div className="field flex-1">
              <FloatLabel>
                <InputText id="money" keyfilter="money" />
                <label htmlFor="money">Date of Submission</label>
              </FloatLabel>
            </div>
          </div>

          {/* Hex, Alphabetic, Alphanumeric */}
          <div className="row flex gap-6">
            <div className="field flex-1">
              <FloatLabel>
                <InputText id="hex" keyfilter="hex" />
                <label htmlFor="hex">Provisional Diagnosis:</label>
              </FloatLabel>
            </div>
            <div className="field flex-1">
              <FloatLabel>
                <InputText
                  id="alphabetic"
                  keyfilter="alpha"
                  value={detail?.UHID || ""}
                  readOnly
                  className="fw-bold text-success"
                />
                <label htmlFor="alphabetic">UHID No:</label>
              </FloatLabel>
            </div>
            <div className="field flex-1">
              <FloatLabel>
                <InputText id="alphanumeric" keyfilter="alphanum" />
                <label htmlFor="alphanumeric">IP No:</label>
              </FloatLabel>
            </div>
          </div>

          {/* Positive Integer, Positive Number, Email */}
          <div className="row flex gap-6">
            <div className="field flex-1">
              <FloatLabel>
                <InputText id="pint" keyfilter="pint" />
                <label htmlFor="pint">Consultant Incharge</label>
              </FloatLabel>
            </div>
            <div className="field flex-1">
              <FloatLabel>
                <InputText id="pnum" keyfilter="pnum" />
                <label htmlFor="pnum">Positive Number</label>
              </FloatLabel>
            </div>
            <div className="field flex-1">
              <FloatLabel>
                <InputText
                  id="email"
                  keyfilter="email"
                  value={detail?.email || ""}
                  readOnly
                  className="fw-bold text-success"
                />
                <label htmlFor="email">Email</label>
              </FloatLabel>
            </div>
          </div>
          {/* history */}
          <div>
            <h4 className="border p-2 text-center">History</h4>
            <div className="row g-3 px-4">
              <div className="col-md-12 ">
                <label className="form-label fw-bold">
                  Presenting complaints & Duration:
                </label>
                <InputTextarea
                  name="address"
                  value={formik.values.address}
                  onChange={formik.handleChange}
                  placeholder="Enter complete address"
                  rows={3}
                  className=""
                />
              </div>
            </div>

            <div className="row g-3 px-4">
              <div className="col-md-12 ">
                <label className="form-label fw-bold">
                  History of Any Allergy:
                </label>
                <InputTextarea
                  name="address"
                  value={formik.values.address}
                  onChange={formik.handleChange}
                  placeholder="Enter complete address"
                  rows={3}
                  className=""
                />
              </div>
            </div>
            <div className="row g-3  px-4">
              <div className="col-md-12 ">
                <label className="form-label fw-bold">
                  Current Medication (if any):
                </label>
                <InputTextarea
                  name="address"
                  value={formik.values.address}
                  onChange={formik.handleChange}
                  placeholder="Enter complete address"
                  rows={3}
                  className=""
                />
              </div>
            </div>
            <div className="row g-3  px-4">
              <div className="col-md-12 ">
                <label className="form-label fw-bold">
                  Past history/surgical procedures:
                </label>
                <InputTextarea
                  name="address"
                  value={formik.values.address}
                  onChange={formik.handleChange}
                  placeholder="Enter complete address1"
                  rows={5}
                  cols={30}
                  className=""
                />

                <div className="row row-cols-2 row-cols-lg-3 g-2 g-lg-3 w-100 justify-content-between">
                  <div className="col-md-6 ">
                    <label className="form-label fw-bold">
                      Birth History/Mile Stone:
                    </label>
                    <InputText
                      name="name"
                      value={formik.values.name}
                      onChange={formik.handleChange}
                      placeholder="Enter Full Name"
                      required
                      className="w-100"
                    />
                  </div>

                  <div className="col-md-6">
                    <label className="form-label fw-bold">
                      Family History/Personal History
                    </label>
                    <InputText
                      type="number"
                      name="age"
                      value={formik.values.age}
                      onChange={formik.handleChange}
                      placeholder="Age"
                      className="w-100"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* ON EXAMINATION */}
          <div>
            <h4 className="border p-2 text-center">ON EXAMINATION</h4>

            <div className="row g-3  px-4">
              <div className=" col-md-12  ">
                <label className="form-label fw-bold">
                  Level of consciousness:
                </label>
                {/* level */}
                <div className="card flex flex-row   m-0 gap-3">
                  <div>
                    <RadioButton
                      inputId="XNormal"
                      name="CNS"
                      value="Xnormal"
                      checked={formik.values.CNS === "Xnormal"}
                      onChange={(e) => formik.setFieldValue("CNS", e.value)}
                    />
                    <label htmlFor="xnormal6" className="ms-2">
                      Alert & Oriented
                    </label>
                  </div>
                  {/* input */}

                  <div>
                    <RadioButton
                      inputId="abnormal"
                      name="CNS"
                      value="Abnormal"
                      checked={formik.values.CNS === "Abnormal"}
                      onChange={(e) => formik.setFieldValue("CNS", e.value)}
                    />
                    <label htmlFor="abnormal7" className="ms-2">
                      Confused
                    </label>
                  </div>

                  <div>
                    <RadioButton
                      inputId="abnormal"
                      name="CNS"
                      value="Abnormal"
                      checked={formik.values.CNS === "Abnormal"}
                      onChange={(e) => formik.setFieldValue("CNS", e.value)}
                    />
                    <label htmlFor="abnormal7" className="ms-2">
                      Drowsy
                    </label>
                  </div>
                </div>
              </div>
            </div>
            <div className="row g-3  px-4">
              <div className="col-md-12 ">
                <label className="form-label fw-bold">
                  Nutritional status:
                </label>
                <div className="card  flex flex-row   m-0  gap-3">
                  <div>
                    <RadioButton
                      inputId="XNormal"
                      name="CNS"
                      value="Xnormal"
                      checked={formik.values.CNS === "Xnormal"}
                      onChange={(e) => formik.setFieldValue("CNS", e.value)}
                    />
                    <label htmlFor="xnormal6" className="ms-2">
                      Well-Nourished
                    </label>
                  </div>
                  {/* input */}

                  <div>
                    <RadioButton
                      inputId="abnormal"
                      name="CNS"
                      value="Abnormal"
                      checked={formik.values.CNS === "Abnormal"}
                      onChange={(e) => formik.setFieldValue("CNS", e.value)}
                    />
                    <label htmlFor="abnormal7" className="ms-2">
                      Malnourished
                    </label>
                  </div>

                  <div>
                    <RadioButton
                      inputId="abnormal"
                      name="CNS"
                      value="Abnormal"
                      checked={formik.values.CNS === "Abnormal"}
                      onChange={(e) => formik.setFieldValue("CNS", e.value)}
                    />
                    <label htmlFor="abnormal7" className="ms-2">
                      Cachectic
                    </label>
                  </div>
                </div>
                {/* row */}
                <div className="row flex mt-5 gap-3">
                  <h1 className="fs-4">Vitals:</h1>

                  {/* Weight */}
                  <div className="field flex-1 d-flex align-items-center gap-2">
                    <FloatLabel>
                      <InputText
                        id="weight"
                        value={weight}
                        onChange={(e) => setWeight(e.target.value)}
                        style={{ width: "120px" }}
                      />
                      <label htmlFor="weight">Weight</label>
                      <Dropdown
                        value={weightUnit}
                        options={weightUnits}
                        onChange={(e) => setWeightUnit(e.value)}
                        style={{ width: "80px" }}
                      />
                    </FloatLabel>
                  </div>

                  {/* Temperature */}
                  <div className="field flex-1 d-flex align-items-center gap-2">
                    <FloatLabel>
                      <InputText
                        id="temp"
                        value={temp}
                        onChange={(e) => setTemp(e.target.value)}
                        style={{ width: "120px" }}
                      />
                      <label htmlFor="temp">Temp</label>
                      <Dropdown
                        value={tempUnit}
                        options={tempUnits}
                        onChange={(e) => setTempUnit(e.value)}
                      />
                    </FloatLabel>
                  </div>

                  {/* Blood Pressure */}
                  <div className="field flex-1 d-flex align-items-center gap-2">
                    <FloatLabel>
                      <InputText
                        id="bp"
                        value={bp}
                        onChange={(e) => setBp(e.target.value)}
                        style={{ width: "120px" }}
                      />
                      <label htmlFor="bp">B.P</label>
                      <Dropdown
                        value={bpUnit}
                        options={bpUnits}
                        onChange={(e) => setBpUnit(e.value)}
                      />
                    </FloatLabel>
                  </div>

                  {/* Pulse */}
                  <div className="field flex-1 d-flex align-items-center gap-2">
                    <FloatLabel>
                      <InputText
                        id="pulse"
                        value={pulse}
                        onChange={(e) => setPulse(e.target.value)}
                        style={{ width: "80px" }}
                      />
                      <label htmlFor="pulse">Pulse</label>
                      <Dropdown
                        value={pulseUnit}
                        options={pulseUnits}
                        onChange={(e) => setPulseUnit(e.value)}
                      />
                    </FloatLabel>
                  </div>
                </div>
               
                <div className="row flex gap-6 mt-5">
                  <h1 className="fs-4">Clinical Signs:</h1>
                  {/* Name with FloatLabel */}

                  <div className="field flex-1">
                    <FloatLabel>
                      <InputText
                        id="age"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      />
                      <label htmlFor="age">Pallor</label>
                    </FloatLabel>
                  </div>

                  {/* Gender Dropdown */}
                  <div className="field flex-1">
                    <FloatLabel>
                      <InputText
                        id="age"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      />
                      <label htmlFor="age">Icterus</label>
                    </FloatLabel>
                  </div>
                </div>
                <div className="row flex gap-6 mt-5">
                  {/* Name with FloatLabel */}
                  <div className="field flex-1">
                    <FloatLabel>
                      <InputText
                        id="name"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      />
                      <label htmlFor="name">Cyanosis</label>
                    </FloatLabel>
                  </div>

                  <div className="field flex-1">
                    <FloatLabel>
                      <InputText
                        id="age"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      />
                      <label htmlFor="age">Clubbing</label>
                    </FloatLabel>
                  </div>

                  {/* Gender Dropdown */}
                  <div className="field flex-1">
                    <FloatLabel>
                      <InputText
                        id="age"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      />
                      <label htmlFor="age">Lymph nodes</label>
                    </FloatLabel>
                  </div>

                  {/* pedal */}
                  <div>
                    <div className="card flex flex-row align-items-center gap-2 m-2">
                      <h1 className="fs-4">Pedal edema:</h1>
                      <TriStateCheckbox
                        value={checkbox}
                        onChange={(e) => pedalCheckboxs(e.value)}
                      />
                    </div>

                    {checkbox ? (
                      <div className="card flex flex-row gap-2 m-0">
                        <RadioButton
                          inputId="AbNormal"
                          name="PA"
                          value="Abnormal"
                          checked={formik.values.PA === "Abnormal"}
                          onChange={(e) => formik.setFieldValue("PA", e.value)}
                        />
                        <label htmlFor="abnormal5" className="ms-2">
                          +1(Mild)
                        </label>

                        <RadioButton
                          inputId="AbNormal"
                          name="PA"
                          value="Abnormal"
                          checked={formik.values.PA === "Abnormal"}
                          onChange={(e) => formik.setFieldValue("PA", e.value)}
                        />
                        <label htmlFor="abnormal5" className="ms-2">
                          +2(Moderate)
                        </label>

                        <RadioButton
                          inputId="AbNormal"
                          name="PA"
                          value="Abnormal"
                          checked={formik.values.PA === "Abnormal"}
                          onChange={(e) => formik.setFieldValue("PA", e.value)}
                        />
                        <label htmlFor="abnormal5" className="ms-2">
                          +3(Servere)
                        </label>

                        <RadioButton
                          inputId="AbNormal"
                          name="PA"
                          value="Abnormal"
                          checked={formik.values.PA === "Abnormal"}
                          onChange={(e) => formik.setFieldValue("PA", e.value)}
                        />
                        <label htmlFor="abnormal5" className="ms-2">
                          +4(Pitting)
                        </label>
                      </div>
                    ) : (
                      ""
                    )}
                  </div>
                </div>
                {/* score */}
                <div className="p-4">
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
                <div className="row g-3  px-4">
                  <div className="col-md-12 ">
                    <label className="form-label fw-bold">Location:</label>
                    <InputTextarea
                      name="address"
                      value={formik.values.address}
                      onChange={formik.handleChange}
                      placeholder="Enter complete address"
                      rows={3}
                      className=""
                    />
                  </div>
                </div>
                <div>
                  <h4>B.Systemic Examination:</h4>

                  {/* examination */}
                  <div>
                    <h1 className="fs-5 mt-3">Respiratory System:</h1>
                    <div className="radio row col-12">
                      <div className="d-flex gap-3">
                        <div>
                          <RadioButton
                            inputId="xnormal"
                            name="RS"
                            value="Xnormal"
                            checked={formik.values.RS === "Xnormal"}
                            onChange={(e) =>
                              formik.setFieldValue("RS", e.value)
                            }
                          />
                          <label htmlFor="xnormal1" className="ms-2">
                            X Normal
                          </label>
                        </div>
                        <div>
                          <RadioButton
                            inputId="abnormal"
                            name="RS"
                            value="Abnormal"
                            checked={formik.values.RS === "Abnormal"}
                            onChange={(e) =>
                              formik.setFieldValue("RS", e.value)
                            }
                          />
                          <label htmlFor="abnormal2" className="ms-2">
                            Abnormal
                          </label>
                          {formik.values.RS === "Abnormal" ? (
                            <div className="field flex-1">
                              <FloatLabel>
                                {/* dropdownradio */}
                               <div>
                                 <RadioButton
                            inputId="xnormal"
                            name="RS"
                            value="Xnormal"
                            checked={formik.values.RS === "Xnormal"}
                            onChange={(e) =>
                              formik.setFieldValue("RS", e.value)
                            }
                          />

                           <RadioButton
                            inputId="xnormal"
                            name="RS"
                            value="Xnormal"
                            checked={formik.values.RS === "Xnormal"}
                            onChange={(e) =>
                              formik.setFieldValue("RS", e.value)
                            }
                          />

                           <RadioButton
                            inputId="xnormal"
                            name="RS"
                            value="Xnormal"
                            checked={formik.values.RS === "Xnormal"}
                            onChange={(e) =>
                              formik.setFieldValue("RS", e.value)
                            }
                          />

                           <RadioButton
                            inputId="xnormal"
                            name="RS"
                            value="Xnormal"
                            checked={formik.values.RS === "Xnormal"}
                            onChange={(e) =>
                              formik.setFieldValue("RS", e.value)
                            }
                          />
                               </div>

                                <label htmlFor="age">Age</label>
                              </FloatLabel>
                            </div>
                          ) : (
                            ""
                          )}
                        </div>
                      </div>

                      <h1 className="fs-5 mt-3">Cardiovascular System:</h1>
                      <div className="d-flex gap-3">
                        <div>
                          <RadioButton
                            inputId="xNormal"
                            name="CVS"
                            value="Xnormal"
                            checked={formik.values.CVS === "Xnormal"}
                            onChange={(e) =>
                              formik.setFieldValue("CVS", e.value)
                            }
                          />
                          <label htmlFor="xNormal3" className="ms-2">
                            X Normal
                          </label>
                        </div>
                        <div>
                          <RadioButton
                            inputId="AbNormal"
                            name="CVS"
                            value="Abnormal"
                            checked={formik.values.CVS === "Abnormal"}
                            onChange={(e) =>
                              formik.setFieldValue("CVS", e.value)
                            }
                          />
                          <label htmlFor="abnormal4" className="ms-2">
                            Abnormal
                          </label>
                          {formik.values.CVS === "Abnormal" ? (
                            <div className="field flex-1">
                              <FloatLabel>
                                <InputText
                                  id="age"
                                  value={value}
                                  onChange={(e) => setValue(e.value)}
                                />
                                <label htmlFor="age">Age</label>
                              </FloatLabel>
                            </div>
                          ) : (
                            ""
                          )}
                        </div>
                      </div>
                      <h1 className="fs-5 mt-3">P/A:</h1>
                      <div className="d-flex gap-3">
                        <div>
                          <RadioButton
                            inputId="XNormal"
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
                            inputId="AbNormal"
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
                          {formik.values.PA === "Abnormal" ? (
                            <div className="field flex-1">
                              <FloatLabel>
                                <InputText
                                  id="age"
                                  value={value}
                                  onChange={(e) => setValue(e.value)}
                                />
                                <label htmlFor="age">Age</label>
                              </FloatLabel>
                            </div>
                          ) : (
                            ""
                          )}
                        </div>
                      </div>
                      <h1 className="fs-5 mt-3">Central Nervous System:</h1>
                      <div className="d-flex gap-3 ">
                        <div>
                          <RadioButton
                            inputId="XNormal"
                            name="CNS"
                            value="Xnormal"
                            checked={formik.values.CNS === "Xnormal"}
                            onChange={(e) =>
                              formik.setFieldValue("CNS", e.value)
                            }
                          />
                          <label htmlFor="xnormal6" className="ms-2">
                            X Normal
                          </label>
                        </div>
                        {/* input */}

                        <div>
                          <RadioButton
                            inputId="abnormal"
                            name="CNS"
                            value="Abnormal"
                            checked={formik.values.CNS === "Abnormal"}
                            onChange={(e) =>
                              formik.setFieldValue("CNS", e.value)
                            }
                          />
                          <label htmlFor="abnormal7" className="ms-2">
                            Abnormal
                          </label>
                        </div>
                        {formik.values.CNS === "Abnormal" ? (
                          <div className="field flex-1">
                            <FloatLabel>
                              <InputText
                                id="age"
                                value={value}
                                onChange={(e) => setValue(e.value)}
                              />
                              <label htmlFor="age">Age</label>
                            </FloatLabel>
                          </div>
                        ) : (
                          ""
                        )}
                      </div>
                    </div>
                  </div>

                  <h1 className="fs-4">Plan of Care:</h1>
                  {/* plan of care */}
                  <div className="mt-4">
                    <div className="col-md-6 ">
                      <label className="form-label fw-bold">
                        Provisional diagnosis:
                      </label>
                      <InputText
                        name="name"
                        value={formik.values.name}
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
                          inputId="Medical"
                          name="treatment"
                          value="medical"
                          checked={formik.values.treatment === "medical"}
                          onChange={(e) =>
                            formik.setFieldValue("treatment", e.value)
                          }
                        />
                        <label htmlFor="Treatment1" className="ms-2">
                          Medical
                        </label>
                      </div>
                      <div>
                        <RadioButton
                          inputId="surgical"
                          name="treatment"
                          value="Surgical"
                          checked={formik.values.treatment === "Surgical"}
                          onChange={(e) =>
                            formik.setFieldValue("treatment", e.value)
                          }
                        />
                        <label htmlFor="Surgical1" className="ms-2">
                          Surgical
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="col-md-6 mt-4 ">
                    <label className="form-label fw-bold">
                      Possible risk / complication:
                    </label>
                    <InputText
                      name="name"
                      value={formik.values.name}
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
                        <RadioButton
                          inputId="patient"
                          name="training"
                          value="Patient"
                          checked={formik.values.training === "Patient"}
                          onChange={(e) =>
                            formik.setFieldValue("training", e.value)
                          }
                        />
                        <label htmlFor="Training1" className="ms-2">
                          Patient
                        </label>
                      </div>
                      <div>
                        <RadioButton
                          inputId="relative"
                          name="training"
                          value="Relative"
                          checked={formik.values.training === "Relative"}
                          onChange={(e) =>
                            formik.setFieldValue("training", e.value)
                          }
                        />
                        <label htmlFor="Training2" className="ms-2">
                          Relative (Name)
                        </label>
                      </div>
                    </div>
                  </div>
                  {/* plan care */}
                  <div className="mt-4">
                    <h4 className="border p-2 text-center">
                      PLAN OF CARE{" "}
                      <span className="fs-6 text-danger">
                        (To be filled by Doctor...)
                      </span>
                    </h4>
                  </div>
                  {/* Restraints */}

                  <h1 className="fs-5 mt-3">Restraints:Yes/No</h1>
                  <div className="d-flex gap-3 mt-4 ">
                    <div>
                      <RadioButton
                        inputId="XNormal"
                        name="CNS"
                        value="Xnormal"
                        checked={formik.values.CNS === "Xnormal"}
                        onChange={(e) => formik.setFieldValue("CNS", e.value)}
                      />
                      <label htmlFor="xnormal6" className="ms-2">
                        Yes
                      </label>
                    </div>

                    {/* input */}

                    <div>
                      <RadioButton
                        inputId="abnormal"
                        name="CNS"
                        value="Abnormal"
                        checked={formik.values.CNS === "Abnormal"}
                        onChange={(e) => formik.setFieldValue("CNS", e.value)}
                      />
                      <label htmlFor="abnormal7" className="ms-2">
                        No
                      </label>
                    </div>
                    {formik.values.CNS === "Abnormal" ? (
                      <div className="field flex-1">
                        <FloatLabel>
                          <InputText
                            id="age"
                            value={value}
                            onChange={(e) => setValue(e.value)}
                          />
                          <label htmlFor="age">Reasions</label>
                        </FloatLabel>
                      </div>
                    ) : (
                      ""
                    )}
                  </div>

                  <div className="col-md-12 mt-4">
                    <label className="form-label fw-bold">Investigation:</label>
                    <InputTextarea
                      name="address"
                      value={formik.values.address}
                      onChange={formik.handleChange}
                      placeholder="Enter complete address"
                      rows={3}
                      className=""
                    />
                  </div>
                  <div className="col-md-12 mt-2">
                    <label className="form-label fw-bold">Treatment:</label>
                    <InputTextarea
                      name="address"
                      value={formik.values.address}
                      onChange={formik.handleChange}
                      placeholder="Enter complete address"
                      rows={3}
                      className=""
                    />
                  </div>
                  {/* dite */}
                  <h1 className="fs-5">Diet:</h1>
                  <div className="card flex flex-row ">
                    <div className="flex flex-row ">
                      <label htmlFor="">Normal</label>
                      <TriStateCheckbox
                        value={checkboxs}
                        onChange={(e) => setCheckboxs(e.value)}
                      />
                    </div>
                    <div className="flex flex-row ">
                      <label htmlFor="">Normal</label>
                      <TriStateCheckbox
                        value={checkboxs}
                        onChange={(e) => setCheckboxs(e.value)}
                      />
                    </div>
                    <div className="flex flex-row ">
                      <label htmlFor="">Normal</label>
                      <TriStateCheckbox
                        value={checkboxs}
                        onChange={(e) => setCheckboxs(e.value)}
                      />
                    </div>
                    <div className="flex flex-row ">
                      <label htmlFor="">Normal</label>
                      <TriStateCheckbox
                        value={checkboxs}
                        onChange={(e) => setCheckboxs(e.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
