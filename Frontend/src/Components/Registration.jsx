import { useFormik } from "formik";
import React, { useState, useEffect } from "react";
import { toast } from "react-toastify";
import { addPatient } from "../Services/userService";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Calendar } from "primereact/calendar";
import { InputTextarea } from "primereact/inputtextarea";
import { RadioButton } from "primereact/radiobutton";
import { Button } from "primereact/button";
import { MultiSelect } from "primereact/multiselect";
import { useNavigate } from "react-router-dom";
import { TriStateCheckbox } from "primereact/tristatecheckbox";
import { Checkbox } from "primereact/checkbox";
import "../App.css";
import * as Yup from "yup";
import axios from "axios";
import { getPatientbyID } from "../Services/userService";

export default function Registration() {
  const [loading, setLoading] = useState(false);
  const [showbutton, setshowbutton] = useState(false);
  const [Alltestname, setAllTestname] = useState([]);
  const [tpaname, setTPAname] = useState([]);
  const [appointmentcheckbox, setAppointmentcheckbox] = useState(null);
  const [MLCcheckbox, setMLCcheckbox] = useState(null);
  const [OPDprice, setOPDprice] = useState();
  // const [isDisabled, setIsDisabled] = useState(true);
  const [UHID, setUHID] = useState(null);
  const [age, setAge] = useState("");

  // const labels = Alltestname.map(item => item.label);

  const navigate = useNavigate();
  // useEffect(() => {
  //   UHIDdata();
  // },[]);

  const UHIDdata = async () => {
    try {
      const res = await fetch(
        `http://localhost:5000/api/patients/getPatientsbyID/${UHID}`
      );
      if (!res.ok) {
        console.error("Network error:", res.status);
        return;
      }
      const data = await res.json(); // ✅ JSON parse karo
      console.log("API Datassssssssss:", data);
      setUHID(data.UHID); // ✅ Ab parsed data set karo
    } catch (error) {
      console.error("Error fetching UHID:", error);
    }
  };

  function fetchOPDPrice(selectedId) {
    setTPAname(selectedId);
    console.log("id", selectedId);

    fetch(
      `http://localhost:5000/api/Servicebilldata/getOPDPrice?_id=${selectedId}`
    ).then((res) => {
      res
        .json()
        .then((data) => setOPDprice(data.data.opd_price[0].Totalamount));
    });
  }

  // {Alltestname.map((val,index)=>{

  //   if(val[tpaname]===val[tpaname]){
  // return console.log("lll",val[tpaname].services)

  //   }
  // console.log("jjjj",Alltestname[index]===);

  // })}

  // const filterdata=Alltestname.filter((val)=>{
  // if(val.label===Alltestname){

  // }

  // })

  const load = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
    }, 2000);
  };

  const genderLists = [
    { label: "Male", value: "Male" },
    { label: "Female", value: "Female" },
    { label: "Other", value: "Other" },
  ];

  const maritalStatus = [
    { label: "Single", value: "Single" },
    { label: "Married", value: "Married" },
    { label: "Divorced", value: "Divorced" },
  ];

  const bloodGroups = ["A+", "B+", "AB+", "O+", "O-", "AB-", "B-"].map((b) => ({
    label: b,
    value: b,
  }));

  const relationshipOptions = [
    { label: "Parent", value: "Parent" },
    { label: "Guardian", value: "Guardian" },
    { label: "Friend", value: "Friend" },
    { label: "Sibling", value: "Sibling" },
  ];

  //   useEffect(() => {
  //   if (Alltestname && Alltestname.length > 0) {
  //     formik.setFieldValue("TPAname", Alltestname.label); // ✅ सही तरीका
  //   }
  // }, [Alltestname]);

  const formik = useFormik({
    initialValues: {
      name: "",
      email: "",
      age: "",
      gender: "",
      contact: "",
      birth: "",
      marital: "",
      city: "",
      state: "",
      blood: "",
      MLC: false,
      MLCNumber: "", 
      address: "",
      allergies: "",
      companion: "",
      relationship: "",
      contactno: "",
      time: "",
      date: "",
      ward: "OPD",
      OPDpricedata: "",
      TPAid: "",
      DoctorName: " Dr.Sandeep",
      DoctorSpecilist: "General Physician",
      DoctorDegree: "MBBS",
    },

    validationSchema: Yup.object({
      name: Yup.string().required(" Please enter the Full name"),
      age: Yup.number(),
      gender: Yup.string().required(" Please select your gender"),
      email: Yup.string()
        .email("Invalid email format")
        .required("Email is required"),
      contact: Yup.number()
        .typeError("Invalid number format")
        .required("Number is required"),

      birth: Yup.date().required(" Select your DOB"),

      blood: Yup.string().required(" Select your blood group"),
      relationship: Yup.string().required("Select your relationship"),
      contactno: Yup.number().required("Contact is requird"),
      time: Yup.string().required("Time is required"),

      date: Yup.date().required(" Date is required"),
      ward: Yup.string().required("Ward is required"),
    }),

    onSubmit: async (values, { resetForm }) => {
      values.OPDpricedata = OPDprice;
      values.TPAid = tpaname;  

      console.log("------", values);

      await UHIDdata();

      try {
        setLoading(true);
        const user = await addPatient(values);
        // resetForm();
        // setIsDisabled(false);
        // setuhid("");
        if (showbutton) {
          setshowbutton(false);
        }

        toast.success(user.data.message);
      } catch (error) {
        toast.error("Something went wrong!");
      } finally {
        setLoading(false);
      }
    },
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const AllTestdata = await axios.get(
          "http://localhost:5000/api/Servicebilldata/getAllTestNames"
        );

        console.log("API Response:", AllTestdata.data);

        let testArray = [];
        // If backend sends {data: [..]}
        if (Array.isArray(AllTestdata.data)) {
          testArray = AllTestdata.data;
        }
        // If backend sends {data: {tests: [..]}}
        else if (Array.isArray(AllTestdata.data.data)) {
          testArray = AllTestdata.data.data;
        } else {
          console.error("Unexpected API format:", AllTestdata.data);
        }

        const formattedData = testArray.map((item) => ({
          label: item.tpa_name,
          value: String(item._id),
          services: item.service,
        }));

        setAllTestname(formattedData);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    };

    fetchData();
  }, []);

  // ✅ Fixed UHID generate
  // function generateuhid() {
  //   if (!formik.values.name) {
  //     toast.error("Please enter name first!");
  //     return;
  //   }
  //   const firstname = formik.values.name.split(" ")[0]; // first word
  //   const RandomNumber = Math.floor(1000 + Math.random() * 9000);
  //   const newUHID = firstname.toUpperCase() + RandomNumber;
  //   setuhid(newUHID);

  //   // ✅ formik value update so backend gets UHID
  //   formik.setFieldValue("UHID", newUHID);

  //   // disable button
  //   setshowbutton(true);
  // }

  // 🧮 Function to calculate age or days

  const calculateAge = (date) => {
    if (!date) return "";
    const today = new Date();
    const birth = new Date(date);
    if (birth > today) return "Invalid"; // ❌ Prevent future dates

    let years = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
      years--;
    }
    return years >= 0 ? years : "";         
  };

  const handleDateChange = (e) => {
    const selectedDate = e.value;
    formik.setFieldValue("birth", selectedDate);
    const calculatedAge = calculateAge(selectedDate);
    formik.setFieldValue("age", calculatedAge);
    setAge(calculatedAge);
  };

  return (
    <div className="container-fluid">
      <form
        onSubmit={formik.handleSubmit}
        className="shadow p-4 mt-6 bg-white rounded"
      >
        <div className="row">
          <div className="col">
            <h5 className="mb-4 colortext">
              Spherehealth Patient Registration
            </h5>
          </div>
          <div className="d-flex col  justify-content-end ">
            <div className=" mx-4 mb-3">
              <Dropdown
                name="TPAname"
                value={tpaname}
                onChange={(e) => {
                  const selectedId = e.target.value;
                  formik.setFieldValue("TPAname", e.target.optionValue);
                  fetchOPDPrice(selectedId);
                }}
                options={Alltestname}
                optionLabel="label"
                optionValue="value"
                placeholder="Select your Test"
                filter
                filterDelay={400}
                className="w-full md:w-20rem"
                display="chip"
              />
            </div>

            <div className="marginginRight10">
              <RadioButton
                inputId="opd"
                name="ward"
                value="OPD"
                checked={formik.values.ward === "OPD"}
                onChange={(e) => formik.setFieldValue("ward", e.value)}
              />
              <label htmlFor="opd" className="ms-2">
                OPD
              </label>
            </div>
            <div>
              <RadioButton
                inputId="emergency"
                name="ward"
                value="Emergency"
                checked={formik.values.ward === "Emergency"}
                onBlur={formik.handleBlur}
                onChange={(e) => formik.setFieldValue("ward", e.value)}
              />
              <label htmlFor="emergency" className="ms-2">
                Emergency
              </label>
            </div>
            {formik.errors.ward && (
              <p className="text-danger">{formik.errors.ward}</p>
            )}
          </div>
        </div>
        <h5 className="  p-2 rounded btn-custom text-white">
          Patients Information Details
        </h5>

        {/* Personal Information */}
        <div className="row ">
          <div className="col-lg-4">
            <label className="form-label ">Full Name</label>{" "}
            <span className="text-danger">*</span>
            <InputText
              name="name"
              value={formik.values.name}
              onChange={formik.handleChange}
              placeholder="Enter Full Name"
              onBlur={formik.handleBlur}
              className="w-100"
            />
            {formik.errors.name && (
              <p className="text-danger">{formik.errors.name}</p>
            )}
          </div>
          <div className="col-lg-4">
            <label className="form-label ">Date of Birth</label>
            <span className="text-danger">*</span>
            {/* <Calendar
              name="birth"
              value={formik.values.birth}
              // onChange={(e) => formik.setFieldValue("birth", e.value)}
              onChange={handleDateChange}
              dateFormat="dd-mm-yy"
              showIcon
              placeholder="Select your DOB"
              className="w-100 dateinput"
            /> */}
            <Calendar
              name="birth"
              value={formik.values.birth}
              onChange={handleDateChange}
              dateFormat="dd-mm-yy"
              showIcon
              placeholder="Select your DOB"
              className="w-100 dateinput"
            />
            {formik.errors.birth && (
              <p className="text-danger">{formik.errors.birth}</p>
            )}
          </div>

          <div className="col-lg-4">
            <label className="form-label ">Gender</label>
            <span className="text-danger">*</span>
            <Dropdown
              name="gender"
              value={formik.values.gender}
              onChange={(e) => formik.setFieldValue("gender", e.value)}
              options={genderLists}
              placeholder="Select Gender"
              onBlur={formik.handleBlur}
              className="w-100"
            />
            {formik.errors.gender && (
              <p className="text-danger">{formik.errors.gender}</p>
            )}
          </div>

          <div className="col-md-4">
            <label className="form-label ">Contact Number</label>
            <span className="text-danger">*</span>
            <InputText
              name="contact"
              maxLength={10}
              keyfilter="int"
              placeholder="+91 XXXXX XXXXX"
              value={formik.values.contact}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              className="w-100"
            />
            {formik.errors.contact && (
              <p className="text-danger">{formik.errors.contact}</p>
            )}
          </div>

          <div className="col-md-4">
            <label className="form-label ">Email</label>
            <span className="text-danger">*</span>
            <InputText
              type="email"
              name="email"
              value={formik.values.email}
              onChange={formik.handleChange}
              placeholder="Enter Email"
              onBlur={formik.handleBlur}
              className="w-100"
            />
            {formik.errors.email && (
              <p className="text-danger">{formik.errors.email}</p>
            )}
          </div>

          <div className="col-md-4">
            <label className="form-label ">Age</label>
            <InputText
              type="number"
              name="age"
              value={age}
              readOnly
              //  onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              placeholder="Age"
              className="w-100"
            />
            {formik.errors.age && (
              <p className="text-danger">{formik.errors.age}</p>
            )}
          </div>

          <div className="col-md-4">
            <label className="form-label ">Marital Status</label>
            <Dropdown
              name="marital"
              value={formik.values.marital}
              options={maritalStatus}
              onChange={(e) => formik.setFieldValue("marital", e.value)}
              placeholder="Select"
              className="w-100"
            />
          </div>

          <div className="col-md-4">
            <label className="form-label ">City</label>
            <InputText
              name="city"
              value={formik.values.city}
              onChange={formik.handleChange}
              placeholder="Enter City"
              className="w-100"
            />
          </div>

          <div className="col-md-4">
            <label className="form-label ">State</label>
            <InputText
              name="state"
              value={formik.values.state}
              onChange={formik.handleChange}
              placeholder="Enter State"
              className="w-100"
            />
          </div>

          <div className="col-md-4">
            <label className="form-label ">Blood Group</label>
            <span className="text-danger">*</span>
            <Dropdown
              name="blood"
              value={formik.values.blood}
              options={bloodGroups}
              onChange={(e) => formik.setFieldValue("blood", e.value)}
              placeholder="Select"
              className="w-100"
              onBlur={formik.handleBlur}
            />
            {formik.errors.blood && (
              <p className="text-danger">{formik.errors.blood}</p>
            )}
          </div>

          <div
            className="col-md-4 "
            style={{ position: "relative", top: "20px" }}
          >
            {/* Date input 50% */}

            <div className="d-flex mt-3 gap-2">
              <p className="fw-bold">MLC:</p>         
              {/* <Checkbox
            inputId="MLC"
            name="MLC"
            value="MLC"
              // value={MLCcheckbox}
              onChange={(e) => setMLCcheckbox(e.value)}
              style={{ marginLeft: "10px", textAlign: "center" }}
            /> */}

              {/* <Checkbox
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
                      />{" "} */}

              <Checkbox
                inputId="MLC"
                name="MLC"
                checked={formik.values.MLC === true}
                onChange={(e) => {
                  formik.setFieldValue("MLC", e.checked); // ✅ true ya false set karega
                }}
              />

              {formik.values.MLC === true && (
                <div className="d-flex">
                  <InputText
                    name="MLCNumber"
                    value={formik.values.MLCNumber}
                    onChange={formik.handleChange}
                    placeholder="Enter MLC Number"
                    onBlur={formik.handleBlur}
                    style={{
                      marginLeft: "15px",
                      position: "relative",
                      bottom: "6px",
                      width: "300px",
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Address */}
        <div className="row ">
          <div className="col-md-6 ">
            <label className="form-label ">Address</label>
            <InputTextarea
              name="address"
              value={formik.values.address}
              onChange={formik.handleChange}
              placeholder="Enter complete address"
              rows={3}
              className="w-100"
            />
          </div>

          <div className="col-md-6 ">
            <label className="form-label ">Known Allergies</label>
            <span className="text-danger">*</span>
            <InputTextarea
              name="allergies"
              value={formik.values.allergies}
              onChange={formik.handleChange}
              placeholder="List any known allergies"
              rows={1}
              className="w-100 "
            />
            {formik.errors.allergies && (
              <p className="text-danger">{formik.errors.allergies}</p>
            )}
          </div>
        </div>

        {/* Companion Info */}
        <div className="mt-4">
          <h5 className="  p-2 rounded btn-custom text-white">
            Companion Information
          </h5>
          <div className="row">
            <div className="col-md-4">
              <label className="form-label ">Companion Name</label>
              <InputText
                name="companion"
                value={formik.values.companion}
                onChange={formik.handleChange}
                placeholder="Enter Name"
                className="w-100"
              />
            </div>

            <div className="col-md-4">
              <label className="form-label ">Relationship</label>
              <span className="text-danger">*</span>
              <Dropdown
                name="relationship"
                value={formik.values.relationship}
                options={relationshipOptions}
                onChange={(e) => formik.setFieldValue("relationship", e.value)}
                placeholder="Select"
                onBlur={formik.handleBlur}
                className="w-100"
              />
              {formik.errors.relationship && (
                <p className="text-danger">{formik.errors.relationship}</p>
              )}
            </div>

            <div className="col-md-4">
              <label className="form-label ">Contact</label>
              <span className="text-danger">*</span>
              <InputText
                name="contactno"
                value={formik.values.contactno}
                onChange={formik.handleChange}
                maxLength={10}
                keyfilter="int"
                placeholder="+91 XXXXX XXXXX"
                className="w-100"
                onBlur={formik.handleBlur}
              />
              {formik.errors.contactno && (
                <p className="text-danger">{formik.errors.contactno}</p>
              )}
            </div>
          </div>
        </div>

        {/* Ward & Appointment */}
        <div className="row ">
          {/* Date input 50% */}

          <div className="d-flex mt-3">
            <p className="fw-bold">Appointment:</p>
            <TriStateCheckbox
              value={appointmentcheckbox}
              onChange={(e) => setAppointmentcheckbox(e.value)}
              style={{ marginLeft: "10px", textAlign: "center" }}
            />
          </div>
          {appointmentcheckbox && (
            <div className="row">
              <div className="col-md-4 ">
                <p className="">Date:</p>
                <Calendar
                  name="date"
                  value={formik.values.date}
                  onChange={(e) => formik.setFieldValue("date", e.value)}
                  showIcon
                  placeholder="Select Date"
                  onBlur={formik.handleBlur}
                  className="w-100 dateinput"
                />
                {formik.errors.date && (
                  <p className="text-danger">{formik.errors.date}</p>
                )}
              </div>

              {/* Time input 50% */}
              <div className="col-md-4 ">
                <p className="">Time:</p>
                <Calendar
                  name="time"
                  value={formik.values.time}
                  onChange={(e) => formik.setFieldValue("time", e.value)}
                  timeOnly
                  hourFormat="12"
                  placeholder="Select Time"
                  className="w-100 dateinput"
                  showIcon
                  onBlur={formik.handleBlur}
                  icon={<i className="pi pi-clock btn-custom text-xl"></i>}
                />
                {formik.errors.time && (
                  <p className="text-danger">{formik.errors.time}</p>
                )}
              </div>
            </div>
          )}

          {/* UHID Section */}
          {/* <div>
              <div className="card flex flex-row m-3 p-2 gap-3">
                <h1 className="fs-5">UHID:</h1>
                {UHID && (
                  <span className="text-success fw-bold">{UHID}</span>
                )}
              </div>
              <button
                type="button"
                className="mx-4 btn-custom text-white p-2 rounded border"
                onClick={generateuhid}
                onBlur={formik.handleBlur}
                disabled={showbutton}
                style={{
                  cursor: showbutton ? "not-allowed" : "pointer",
                  opacity: showbutton ? 0.5 : 1 ,
                }}
              >
                Generate UHID
              </button>
               {formik.errors.UHID&& <p className="text-danger">{formik.errors.UHID}</p>}
            </div> */}
        </div>

        {/* Submit */}
        <div className="text-center mt-4">
          <Button
            type="submit"
            label="Registration"
            icon="pi pi-check"
            loading={loading}
            className="btn-custom px-5 rounded"
          />
        </div>

        <div className="d-flex justify-content-end">
          <button
            className="px-3 py-2 bg-success rounded border-0 text-white fw-bold"
            // disabled={isDisabled}
            onClick={() => navigate(`/opd/${UHID}`)}
            // style={{
            //   opacity: isDisabled ? 0.6 : 1, // disabled हो तो dim

            //   cursor: isDisabled ? "not-allowed" : "pointer",
            // }}
          >
            Print
          </button>
        </div>
      </form>
    </div>
  );
}
