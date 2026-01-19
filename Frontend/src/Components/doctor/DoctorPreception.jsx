import { useFormik } from "formik";
import React, { useEffect, useState } from "react";
import logo from "../../assets/logowebsite11.png";
import { useParams } from "react-router-dom";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { InputTextarea } from "primereact/inputtextarea";

import { getPatientbyID } from "../../Services/userService";

import { RegistrationOPD } from "../../Services/userService";
import { Button } from "primereact/button";
import { toast } from "react-toastify";
// import { getTpaId } from "../Services/TpaIdget";
import { getTpaId } from "../../Services/TpaIdget";

import { MultiSelect } from "primereact/multiselect";
import * as yup from "yup";
import { Field, FieldArray, Formik, Form, getIn } from "formik";

function DoctorPreception() {
  const [value, setValue] = useState("");
  const [selectedGender, setSelectedGender] = useState(null);
  const [uhid, setUHID] = useState(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [seviceTpaId, setServiceTpaId] = useState([]);
  const [tpaservice, setTpaservice] = useState([]);
  const [tpaId, setTpaId] = useState();

  const { UHID, TpaId } = useParams();
  console.log("ssssss---------", seviceTpaId);
console.log("000000000000-------------",uhid);

  useEffect(() => {
    if (!UHID) return console.log("boss");
    getPatientbyID(UHID) 
      .then((res) => {
        // setTpaId(res.TPAid);
        getTPAid(res.TPAid);
        setUHID(res.data);
      })
      .catch((err) => {
        console.error("Error fetching patient:", err);
      });
  }, [UHID]);

  useEffect(() => {
    if (uhid) {
      setSelectedGender(uhid.gender); // 👈 API ka gender set kar diya
    }
  }, [uhid]);

  function getTPAid(TpaId) {
    getTpaId(TpaId).then((res) => {
      const serviceArray = res?.service || [];

      const formattedOptions = serviceArray.map((item) => ({
        label: item.Name,
        value: item._id,
      }));
      setServiceTpaId(formattedOptions);
    });
  }

  // useEffect(() => {
  //   if (!TpaId) return;

  //   getTpaId(TpaId)
  //     .then((res) => {
  //       // ✅ Safely access service array
  //       const serviceArray = res?.service || [];
  //       // ✅ Map service to MultiSelect format
  //       const formattedOptions = serviceArray.map((item) => ({
  //         label: item.Name, // MultiSelect me dikhne wala text
  //         value: item._id, // Unique identifier
  //       }));
  //       setServiceTpaId(formattedOptions);
  //     })
  //     .catch((err) => console.error("Error fetching TPA service:", err));
  // }, [TpaId]);

  const validationSchema = yup.object().shape({
    User: yup.array().of(
      yup.object().shape({
        Name: yup
          .string()
          .max(15, "Max 15 chars allowed")
          .required("Enter the Name"),
        Amount: yup
          .number()
          .typeError("Amount must be a number")
          .required("Enter the Amount"),
        Discount: yup.number().typeError("Amount must be a number"),
        Totalamount: yup.number(),
      })
    ),
  });

  const genderOptions = [
    { label: "Male", value: "male" },
    { label: "Female", value: "female" },
    { label: "Other", value: "other" },
  ];

  const Input = ({ field, form, placeholder }) => {
    const errorMessage = getIn(form.errors, field.name);
    return (
      <div className="input-wrapper">
        <input {...field} placeholder={placeholder} className="input-box" />
        {errorMessage && <div className="error-text">{errorMessage}</div>}
      </div>
    );
  };
  return (
    <Formik
      enableReinitialize
      initialValues={{
        Name: uhid?.fullName || "",
        Age: uhid?.age || "0",
        Gender: uhid?.gender || "",
        Contact: uhid?.contact || "",
        Date: currentDate.toLocaleDateString(),
        UHID: uhid?.UHID || "",
        Email: uhid?.email || "",
        fathername: "",
        Department: uhid?.department.departmentName||"",
        Referred: "",
        History_of_Any_Allergy: "",
        History_of_Present_Illness: "",
        Physical_Examination: "",
        weight: "",
        Temp: "",
        BP: "",
        Pulse: "",
        Provisional_diagnosis: "",
        Investigations: "",
        Advice: "",
        User: [
          {
            Medicine: "",
            Schedule: "",
            Instruction: "",
            Route: "",
            Days: "",
          },
        ],
      }}
      onSubmit={async (values) => {
        console.log(values);

        try {
          const users = await RegistrationOPD(values);

          toast.success(users.data.message);
        } catch (error) {
          toast.error("Something went wrongs!");
          console.log(error);
        } finally {
        }
      }}
    >
      {({ values, handleChange }) => (
        <Form className="d-flex justify-content-center">
          <div className="card p-5 bg-white" style={{ marginTop: "100px" }}>
            <header
              className="navbar p-3 rounded"
              style={{
                border: "none",
                boxShadow: "none",
                justifyItems: "center",
              }}
            >
              {/* Left: Logo */}
              <div className="navbar-logo ">
                {" "}
                <img src={logo} alt="Hospital Logo" />
              </div>

              {/* Center: Hospital Name */}
              <div className="navbar-center">
                <h1 className="hospital-name " style={{ marginLeft: "80px" }}>
                  SUKOON HOSPITALS{" "}
                </h1>{" "}
                <p className="tagline" style={{ marginLeft: "70px" }}>
                  run by Spherehealth Medical Solutions Pvt. Ltd.
                </p>
              </div>
              {/* Right: Contact Info */}
              <div className="navbar-right">
                <p>📞 7988807650, 0130-4052310</p>
                <p>✉️ admin@sukoonhospitals.com</p>
                <p>
                  📍 Mohalla Jatwara, Kumaro Ki Chopal ke Samne, Sonipat (HR)
                </p>
              </div>
            </header>
            <h5 className="  p-2 rounded btn-custom text-white mb-3">
              Patients Information Details:
            </h5>
            <div className="row">
              {/* Name with FloatLabel */}

              <div className="col-md-4">
                <label className="form-label ">Name</label>
                <InputText
                  id="name"
                  name="Name"
                  value={values.Name}
                  readOnly
                  onChange={handleChange}
                  className="w-100 text-success"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">Age</label>
                <InputText
                  id="age"
                  name="Age"
                  value={values.Age}
                  readOnly
                  className="w-100 text-success"
                  onChange={handleChange}
                />
              </div>

              {/* Gender Dropdown */}
              <div className="col-md-4">
                <label className="form-label ">Gender</label>

                <InputText
                  id="gender"
                  selected
                  name="Gender"
                  value={values.Gender}
                  readOnly
                  onChange={handleChange}
                  virtualScrollerOptions={{ itemSize: 38 }}
                  placeholder="Select Gender"
                  className="w-100 fw-bold text-success"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label "> Father/Guardian Name:</label>

                <InputText
                  id="Father"
                  name="fathername"
                  value={values.fathername}
                  onChange={handleChange}
                  className="w-100"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label ">Number</label>

                <InputText
                  id="number"
                  keyfilter="num"
                  name="Contact"
                  value={values.Contact}
                  onChange={handleChange}
                  className="w-100 fw-bold text-success"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label">DOB</label>

                <InputText
                  id="dof"
                  name="Date"
                  value={values.Date}
                  readOnly
                  className="w-100 fw-bold text-success"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label ">UHID No:</label>

                <InputText
                  id="alphabetic"
                  keyfilter="alpha"
                  name="UHID"
                  value={values.UHID}
                  readOnly
                  className="w-100 fw-bold text-success"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label ">Department:</label>

                <InputText
                  id="alphabetic"
                  keyfilter="alpha"
                  name="Department"
                  value={values.Department}
                  onChange={handleChange}
                  readOnly
                  className="w-100 fw-bold text-success"
                />
              </div>

              <div className="col-md-4">
                <label className="form-label ">Referred BY:</label>

                <InputText
                  id="alphabetic"
                  keyfilter="alpha"
                  name="Referred"
                  value={values.Referred}
                  onChange={handleChange}
                  className="w-100 fw-bold text-success"
                />
              </div>
            </div>
            <h5 className="  p-2 rounded btn-custom text-white mt-4">
              Clinical Details:
            </h5>
            <div className="col-md-12 ">
              <label className="form-label fw-bold">
                History of Any Allergy:
              </label>
              <InputTextarea
                name="History_of_Any_Allergy"
                value={values.History_of_Any_Allergy}
                onChange={handleChange}
                placeholder="Enter the History of Any Allergy"
                rows={6}
                className="w-100"
                style={{ height: "90px" }}
              />
            </div>

            <div className="col-md-12 ">
              <label className="form-label fw-bold">
                History of Present Illness:
              </label>
              <InputTextarea
                name="History_of_Present_Illness"
                value={values.History_of_Present_Illness}
                onChange={handleChange}
                placeholder="Enter the Present Illness"
                rows={6}
                className="w-100"
                style={{ height: "90px" }}
              />
            </div>

            <div className="col-md-12 ">
              <label className="form-label fw-bold">
                Physical Examination:
              </label>
              <InputTextarea
                name="Physical_Examination"
                value={values.Physical_Examination}
                onChange={handleChange}
                placeholder="Enter the Physical Examination"
                rows={6}
                className="w-100"
                style={{ height: "90px" }}
              />
            </div>

            <div className="row flex mt-3  justify-content-between w-100% ">
              {/* Name with FloatLabel */}
              <h5 className="  p-2 rounded btn-custom text-white mt-4">
                Vitals:
              </h5>

              <div className="col-md-3 d-flex justify-content-evenly align-items-center">
                <label htmlFor="temp">Weight:</label>
                <InputText
                  id="name1"
                  name="weight"
                  value={values.weight}
                  onChange={handleChange}
                  placeholder="Kgs"
                  style={{ width: "90px" }}
                />
              </div>

              <div className="col-md-3 d-flex justify-content-evenly align-items-center">
                <label htmlFor="temp">Temp:</label>
                <InputText
                  id="temp"
                  name="Temp"
                  placeholder="(°F)"
                  value={values.Temp}
                  onChange={handleChange}
                  style={{ width: "90px" }}
                />
              </div>

              <div className="col-md-3 d-flex justify-content-evenly align-items-center">
                <label htmlFor="bp">B.P:</label>
                <InputText
                  id="bp"
                  name="BP"
                  placeholder="mmHg"
                  value={values.BP}
                  onChange={handleChange}
                  style={{ width: "90px" }}
                />
              </div>

              <div className="col-md-3 d-flex justify-content-evenly align-items-center">
                <label htmlFor="pulse">Pulse:</label>
                <InputText
                  id="pulse"
                  name="Pulse"
                  placeholder="bpm"
                  value={values.Pulse}
                  onChange={handleChange}
                  style={{ width: "90px" }}
                />
              </div>
            </div>
            <h5 className="  p-2 rounded btn-custom text-white mt-4">
              Plan of Care:
            </h5>
            {/* plan of care */}
            <div className="mt-4">
              <div className="col-md-12 ">
                <label className="form-label fw-bold">
                  Provisional diagnosis:
                </label>
                <InputText
                  name="Provisional_diagnosis"
                  value={values.Provisional_diagnosis}
                  onChange={handleChange}
                  placeholder="Enter Detail"
                  required
                  className="w-100"
                />
              </div>
              <FieldArray name="User">
                {({ remove, push }) => (
                  <div className="mt-4">
                    <div className="btn-row">
                      <h4 className="title">Medicine Advised</h4>

                      <Button
                        type="button"
                        severity="success"
                        onClick={() =>
                          push({
                            id: Date.now(),
                            Medicine: "",
                            Schedule: "",
                            Instruction: "",
                            Route: "",
                            Days: "",
                          })
                        }
                      >
                        + Add
                      </Button>
                    </div>
                    <table className="custom-table">
                      <thead>
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
                        {values.User.map((val, index) => (
                          <tr key={val.id}>
                            <td>
                              <Field
                                name={`User[${index}].Medicine`}
                                component={Input}
                                placeholder="Enter Medicine"
                              />
                            </td>
                            <td>
                              <Field
                                name={`User[${index}].Schedule`}
                                component={Input}
                                placeholder="Enter Schedule"
                              />
                            </td>

                            <td className="discount-cell">
                              <Field
                                name={`User[${index}].Instruction`}
                                component={Input}
                                placeholder="Instruction"
                              />
                            </td>
                            <td>
                              <Field
                                name={`User[${index}].Route`}
                                value={values.User[index].Route}
                                onChange={(e) =>
                                  setFieldValue(`User[${index}].Route`)
                                }
                                component={Input}
                                placeholder="Route"
                              />
                            </td>
                            <td>
                              <Field
                                name={`User[${index}].Days`}
                                component={Input}
                                placeholder="	Days"
                                type="number"
                              />
                            </td>
                            {/* <span className="percent-symbol">%</span> */}

                            {/* <td className="total-cell">
                          {val.Amount && val.Discount
                            ? val.Amount - (val.Amount * val.Discount) / 100
                            : val.Amount}
                        </td> */}
                            <td>
                              <a onClick={() => remove(index)}>
                                <i className="pi pi-trash text-danger"></i>
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </FieldArray>

              <h5 className="  p-2 rounded btn-custom text-white mt-4">
                Investigation Advised:
              </h5>
              <div className="row d-flex">
                <div className="col-md-3">
                  <label className="form-label fw-bold">Investigations:</label>
                </div>

                {/* <div className="col-md-6">
                 
                  <InputTextarea
                    name="Investigations"
                    value={values.Investigations}
                    onChange={handleChange}
                    placeholder="Investigations"
                    rows={6}
                    className="w-100"
                    style={{ height: "90px" }}
                  />
                </div> */}
                <div className="col-md-9 ">
                  <MultiSelect
                    value={tpaservice}
                    onChange={(e) => setTpaservice(e.value || [])}
                    options={seviceTpaId || []} // ✅ Always pass an array
                    optionLabel="label"
                    optionValue="value"
                    placeholder="Select your Test"
                    filter
                    filterDelay={400}
                    className="w-100 md:w-20rem"
                    display="chip"
                  />
                </div>
              </div>

              <h5 className="  p-2 rounded btn-custom text-white mt-4">
                Advice & Follow-up:
              </h5>
              <div className="col-md-12 ">
                <label className="form-label fw-bold">Advice</label>
                <InputTextarea
                  name="Advice"
                  value={values.Advice}
                  onChange={handleChange}
                  placeholder="Advice"
                  rows={6}
                  className="w-100"
                  style={{ height: "90px" }}
                />
              </div>

              <h5 className="  p-2 rounded btn-custom text-white mt-4">
                Doctor Details:
              </h5>
              <div className="row">
                <div className="col-md-4">
                  <label className="form-label "> Doctor Name:</label>
                  {/* <InputText
                    id="name"
                    name="Name"
                    value={values.Name}
                    readOnly
                    onChange={handleChange}
                    className="w-100 text-success"  
                  /> */}
                  <p>{uhid?.DoctorName}</p>
                </div>

                <div className="col-md-4">
                  <label className="form-label ">Speciality:</label>
                  <p>{uhid?.Speciality}</p>
                  <InputText
                    id="name"
                    name="Name"
                    value={values.Name}
                    readOnly
                    onChange={handleChange}
                    className="w-100 text-success"
                  />
                </div>

                <div className="col-md-4">
                  <label className="form-label ">Qualifications</label>
                  <InputText
                    id="name"
                    name="Name"
                    value={values.Name}
                    readOnly
                    onChange={handleChange}
                    className="w-100 text-success"
                  />
                </div>
                <div className="text-center mt-4">
                  <Button
                    type="submit"
                    label="Generate & Print"
                    className="btn-custom px-5 rounded"
                  />
                </div>
              </div>
            </div>
          </div>
        </Form>
      )}
    </Formik>
  );
}

export default DoctorPreception;
