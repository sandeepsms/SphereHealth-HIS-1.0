import { useFormik } from "formik";
import React, { useState } from "react";
import { toast } from "react-toastify";
import { addPatient } from "../Services/userService";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { Calendar } from "primereact/calendar";
import { InputTextarea } from "primereact/inputtextarea";
import { RadioButton } from "primereact/radiobutton";
import { Button } from "primereact/button";
import "../App.css";
import * as Yup from 'yup';

export default function Registration() {
  const [loading, setLoading] = useState(false);
  const [showbutton, setshowbutton] = useState(false);

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
      address: "",
      allergies: "",
      companion: "",
      relationship: "",
      contactno: "",
      time: "",
      date: "",
      ward: "OPD",
     
    },
   
   validationSchema:Yup.object({
     name:Yup.string()
     .required(" Please enter the Full name"),
      age:Yup.number()
     .required(" Age is required"),
      gender:Yup.string()
     .required(" Please select your gender"),
        email: Yup.string().email("Invalid email format").required("Email is required"),
      contact:Yup.number().typeError("Invalid number format")
     .required("Number is required"),

      birth:Yup.date()
     .required(" select your DOB"),

      blood:Yup.string()
     .required(" select your blood group"),
      relationship:Yup.string()
     .required("select your relationship"),
      contactno:Yup.number()
     .required("Contact is requird"),
      time:Yup.string()
    .required("Time is required"),
   
      date:Yup.date()
     .required(" Date is required"),
      ward:Yup.string()
     .required("Ward is required"),
 
   }),



    
    onSubmit: async (values, { resetForm }) => {
  console.log(values);
  
      
      try {
        setLoading(true);
        const user = await addPatient(values);
        resetForm();
        // setuhid("");
        if(showbutton){
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

console.log(formik.errors);


  

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
              <div className="marginginRight10" >
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
                 {formik.errors.ward&& <p className="text-danger">{formik.errors.ward}</p>}
            </div>
          

        </div>
         <h5 className="  p-2 rounded btn-custom text-white">
            Patients Information Details
          </h5>

        {/* Personal Information */}
        <div className="row ">
          <div className="col-lg-4">
            <label className="form-label ">Full Name</label>
            <InputText
              name="name"
              value={formik.values.name}
              onChange={formik.handleChange}
              placeholder="Enter Full Name"
             onBlur={formik.handleBlur}
              className="w-100"
            />
            {formik.errors.name&& <p className="text-danger">{formik.errors.name}</p>}
          </div>

          <div className="col-lg-4">
            <label className="form-label ">Age</label>
            <InputText
              type="number"
              name="age"
              value={formik.values.age}  
              onChange={formik.handleChange}
                onBlur={formik.handleBlur}
              placeholder="Age"
              className="w-100"
            />
             {formik.errors.age&& <p className="text-danger">{formik.errors.age}</p>}
          </div>

          <div className="col-lg-4">
            <label className="form-label ">Gender</label>
            <Dropdown
              name="gender"
              value={formik.values.gender}
              onChange={(e) => formik.setFieldValue("gender", e.value)}
              options={genderLists}
              placeholder="Select Gender"
              onBlur={formik.handleBlur}
              className="w-100"
            />
             {formik.errors.gender&& <p className="text-danger">{formik.errors.gender}</p>}
          </div>

          <div className="col-md-4">
            <label className="form-label ">Contact Number</label>
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
             {formik.errors.contact&& <p className="text-danger">{formik.errors.contact}</p>}
          </div>

          <div className="col-md-4">
            <label className="form-label ">Email</label>
            <InputText
              type="email"
              name="email"
              value={formik.values.email}
              onChange={formik.handleChange}
              placeholder="Enter Email"
              onBlur={formik.handleBlur}
              className="w-100"
            />
             {formik.errors.email&& <p className="text-danger">{formik.errors.email}</p>}
          </div>

          <div className="col-md-4">
            <label className="form-label ">Date of Birth</label>
            <Calendar
              name="birth"
              value={formik.values.birth}
              onChange={(e) => formik.setFieldValue("birth", e.value)}
              showIcon
              onBlur={formik.handleBlur}
              className="w-100 dateinput"
            />
             {formik.errors.birth&& <p className="text-danger">{formik.errors.birth}</p>}
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
            <Dropdown
              name="blood"
              value={formik.values.blood}
              options={bloodGroups}
              onChange={(e) => formik.setFieldValue("blood", e.value)}
              placeholder="Select"
              className="w-100"
              onBlur={formik.handleBlur}
            />
             {formik.errors.blood&& <p className="text-danger">{formik.errors.blood}</p>}
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
            <InputTextarea
              name="allergies"
              value={formik.values.allergies}
              onChange={formik.handleChange}
              placeholder="List any known allergies"
              rows={1}
              className="w-100 "
            />
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
              <Dropdown
                name="relationship"
                value={formik.values.relationship}
                options={relationshipOptions}
                onChange={(e) => formik.setFieldValue("relationship", e.value)}
                placeholder="Select"
                onBlur={formik.handleBlur}
                className="w-100"
              />
               {formik.errors.relationship&& <p className="text-danger">{formik.errors.relationship}</p>}
            </div>

            <div className="col-md-4">
              <label className="form-label ">Contact</label>
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
               {formik.errors.contactno&& <p className="text-danger">{formik.errors.contactno}</p>}
            </div>
          </div>
        </div>

        {/* Ward & Appointment */}
        <div className="row ">           
              {/* Date input 50% */}
              <div className="col-md-4">
                <p className="">Appointment:</p>
                <Calendar
                  name="date"
                  value={formik.values.date}
                  onChange={(e) => formik.setFieldValue("date", e.value)}
                  showIcon
                  placeholder="Select Date"
                  onBlur={formik.handleBlur}
                  className="w-100 dateinput"
                />
                 {formik.errors.date&& <p className="text-danger">{formik.errors.date}</p>}
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
                 {formik.errors.time&& <p className="text-danger">{formik.errors.time}</p>}
              </div>

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
      </form>
    </div>
  );
}
