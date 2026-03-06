// PatientRegistration.jsx - With Patient Search Feature
import React, { useState, useEffect, useRef } from "react";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { InputTextarea } from "primereact/inputtextarea";
import { Checkbox } from "primereact/checkbox";
import { RadioButton } from "primereact/radiobutton";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { Card } from "primereact/card";
import { ProgressSpinner } from "primereact/progressspinner";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { departmentService } from "../Services/departmentService";
import { doctorService } from "../Services/doctors/doctorService";
import { tpaService } from "../Services/tpa/tpaService";
import "primereact/resources/themes/lara-light-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import { API_ENDPOINTS } from "../config/api";
import "../../css/Radiobutton.css";

// ✅ NEW: PatientSearchBar import
import PatientSearchBar from "./Search/PatientSearchBar";

export default function PatientRegistration() {
  const toast = useRef(null);
  const navigate = useNavigate();
  const { id: patientId } = useParams();

  const [formData, setFormData] = useState({
    registrationType: "OPD",
    title: "",
    fullName: "",
    gender: "",
    dateOfBirth: null,
    maritalStatus: "",
    contactNumber: "",
    email: "",
    address: {
      completeAddress: "",
      pincode: "",
      city: "",
      state: "",
      district: "",
    },
    bloodGroup: "",
    knownAllergies: "",
    tpa: null,
    department: "",
    doctor: "",
    isMLC: false,
    mlcNumber: "",
    companionName: "",
    companionRelationship: "",
    companionContact: "",
    hasAppointment: false,
    appointmentDate: null,
    appointmentTime: null,
  });

  const [errors, setErrors] = useState({});
  const [tpaList, setTpaList] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [filteredDoctors, setFilteredDoctors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pincodeLoading, setPincodeLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);
  const [OPDprice, setOPDprice] = useState(null);

  // ✅ NEW: Search se patient select hone ka banner
  const [searchSelectedPatient, setSearchSelectedPatient] = useState(null);

// Initial data load
useEffect(() => {
  loadInitialData();
}, []);


  // Patient data load when editing
  useEffect(() => {
    if (patientId && (departments.length > 0 || doctors.length > 0)) {
      fetchPatientData(patientId);
    }
  }, [patientId, departments.length, doctors.length]);

  const loadInitialData = async () => {
    setInitialLoading(true);
    try {
      await Promise.all([fetchTPA(), fetchDepartments(), fetchDoctors()]);
    } catch (error) {
      console.error("Error loading initial data:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load initial data",
        life: 3000,
      });
    } finally {
      setInitialLoading(false);
    }
  };

  // ✅ NEW: Search se patient select hone pe form fill karo
  const handlePatientSearchSelect = (patient) => {
    setSearchSelectedPatient(patient);

    const tpaId =
      typeof patient.tpa === "object" && patient.tpa !== null
        ? patient.tpa._id
        : patient.tpa;

    const deptId =
      typeof patient.department === "object" && patient.department !== null
        ? patient.department._id
        : patient.department;

    const docId =
      typeof patient.doctor === "object" && patient.doctor !== null
        ? patient.doctor._id
        : patient.doctor;

    setFormData({
      registrationType: patient.registrationType || "OPD",
      title: patient.title || "",
      fullName: patient.fullName || "",
      gender: patient.gender || "",
      dateOfBirth: patient.dateOfBirth ? new Date(patient.dateOfBirth) : null,
      maritalStatus: patient.maritalStatus || "",
      contactNumber: patient.contactNumber || "",
      email: patient.email || "",
      age: patient.age || calculateAge(patient.dateOfBirth) || "",
      address: {
        completeAddress: patient.address?.completeAddress || "",
        pincode: patient.address?.pincode || "",
        city: patient.address?.city || "",
        state: patient.address?.state || "",
        district: patient.address?.district || "",
      },
      bloodGroup: patient.bloodGroup || "",
      knownAllergies: patient.knownAllergies || "",
      tpa: tpaId || null,
      department: deptId || "",
      doctor: docId || "",
      isMLC: patient.isMLC || false,
      mlcNumber: patient.mlcNumber || "",
      companionName: patient.companionName || "",
      companionRelationship: patient.companionRelationship || "",
      companionContact: patient.companionContact || "",
      hasAppointment: false,
      appointmentDate: null,
      appointmentTime: null,
    });

    if (tpaId) fetchOPDPrice(tpaId);

    toast.current?.show({
      severity: "info",
      summary: "Patient Found",
      detail: `${patient.fullName} (${patient.UHID}) ka data load ho gaya`,
      life: 3000,
    });
  };

  const fetchPatientData = async (id) => {
    try {
      setLoading(true);
      const response = await fetch(`${API_ENDPOINTS.PATIENTS}/${id}`);
      const data = await response.json();

      if (data.success && data.data) {
        const patientData = data.data;
        setIsEditMode(true);

        const tpaId =
          typeof patientData.tpa === "object" && patientData.tpa !== null
            ? patientData.tpa._id
            : patientData.tpa;

        const deptId =
          typeof patientData.department === "object" &&
          patientData.department !== null
            ? patientData.department._id
            : patientData.department;

        const docId =
          typeof patientData.doctor === "object" && patientData.doctor !== null
            ? patientData.doctor._id
            : patientData.doctor;

        setFormData({
          registrationType: patientData.registrationType || "OPD",
          title: patientData.title || "",
          fullName: patientData.fullName || "",
          gender: patientData.gender || "",
          dateOfBirth: patientData.dateOfBirth
            ? new Date(patientData.dateOfBirth)
            : null,
          maritalStatus: patientData.maritalStatus || "",
          contactNumber: patientData.contactNumber || "",
          email: patientData.email || "",
          age: patientData.age || calculateAge(patientData.dateOfBirth) || "",
          address: {
            completeAddress: patientData.address?.completeAddress || "",
            pincode: patientData.address?.pincode || "",
            city: patientData.address?.city || "",
            state: patientData.address?.state || "",
            district: patientData.address?.district || "",
          },
          bloodGroup: patientData.bloodGroup || "",
          knownAllergies: patientData.knownAllergies || "",
          tpa: tpaId || null,
          department: deptId || "",
          doctor: docId || "",
          isMLC: patientData.isMLC || false,
          mlcNumber: patientData.mlcNumber || "",
          companionName: patientData.companionName || "",
          companionRelationship: patientData.companionRelationship || "",
          companionContact: patientData.companionContact || "",
          hasAppointment: patientData.hasAppointment || false,
          appointmentDate: patientData.appointmentDate
            ? new Date(patientData.appointmentDate)
            : null,
          appointmentTime: patientData.appointmentTime
            ? new Date(patientData.appointmentTime)
            : null,
        });

        if (tpaId) fetchOPDPrice(tpaId);
      }
    } catch (error) {
      console.error("Error fetching patient data:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load patient data",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  // Doctor filter when department changes
  useEffect(() => {
    if (formData.department && doctors.length > 0) {
      const filtered = doctors.filter(
        (doc) => doc.department === formData.department,   
      );
      setFilteredDoctors(filtered);
      if (
        formData.doctor &&
        !filtered.find((d) => d.value === formData.doctor)       
      ) {
        setFormData((prev) => ({ ...prev, doctor: "" }));
      }
    } else {
      setFilteredDoctors([]);
    }
  }, [formData.department, doctors]);

   const fetchTPA = async () => {
    try {
      const data = await tpaService.getAllTPAs();
      if (data.success) {
        setTpaList(
          data.data.map((tpa) => ({ label: tpa.tpaName, value: tpa._id })),
        );
      } else {
        setTpaList([]);
      }
    } catch (error) {
      console.error("Error fetching TPA:", error);
      setTpaList([]);
    }
  };

  const fetchDepartments = async () => {
    try {
      const res = await departmentService.getAllDepartments();
      const deptList = Array.isArray(res) ? res : res.data || [];
      setDepartments(
        deptList
          .filter((d) => d.isActive)
          .map((d) => ({ label: d.departmentName, value: d._id })),
      );
    } catch (error) {
      console.error("Error fetching departments:", error);
      setDepartments([]);
    }
  };

  const fetchDoctors = async () => {
    try {
      const res = await doctorService.getAllDoctors();
      const doctorsList = Array.isArray(res) ? res : res.data || [];
      setDoctors(
        doctorsList
          .filter((doc) => doc.isActive)
          .map((doc) => ({
            label: `Dr. ${doc.personalInfo?.firstName || ""} ${doc.personalInfo?.lastName || ""} (${doc.professional?.specialization || ""})`,
            value: doc._id,
            department:
              typeof doc.department === "object"
                ? doc.department._id
                : doc.department,
          })),
      );
    } catch (error) {
      console.error("Error fetching doctors:", error);                                             
      setDoctors([]);
    }
  };

  function fetchOPDPrice(selectedId) {
    fetch(
      `http://localhost:5000/api/Servicebilldata/getOPDPrice?_id=${selectedId}`,
    )
      .then((res) => res.json())
      .then((data) => {
        if (data?.data?.opd_price?.[0]?.Totalamount) {
          setOPDprice(data.data.opd_price[0].Totalamount);
        } else {
          setOPDprice(null);
        }
      })
      .catch(() => setOPDprice(null));
  }

  const fetchPincodeData = async (pincode) => {
    if (pincode.length !== 6) return;
    setPincodeLoading(true);
    try {
      const response = await fetch(
        `https://api.postalpincode.in/pincode/${pincode}`,
      );
      const data = await response.json();
      if (data[0].Status === "Success" && data[0].PostOffice) {
        const postOffice = data[0].PostOffice[0];
        setFormData((prev) => ({
          ...prev,
          address: {
            ...prev.address,
            city: postOffice.District,
            state: postOffice.State,
            district: postOffice.Block || postOffice.District,
          },
        }));
        toast.current?.show({
          severity: "success",
          summary: "Success",
          detail: "Address fetched",
          life: 3000,
        });
      } else {
        toast.current?.show({
          severity: "error",
          summary: "Error",
          detail: "Invalid pincode",
          life: 3000,
        });
      }
    } catch {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to fetch address",
        life: 3000,
      });
    } finally {
      setPincodeLoading(false);
    }
  };

  const calculateAge = (dob) => {
    if (!dob) return "";
    const today = new Date();
    const birthDate = new Date(dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    )
      age--;
    return age < 0 ? "" : age;
  };

  // Static data
  const titles = [
    { label: "Mr.", value: "Mr.", gender: "Male" },
    { label: "Mrs.", value: "Mrs.", gender: "Female" },
    { label: "Miss", value: "Miss", gender: "Female" },
    { label: "Master", value: "Master", gender: "Male" },
    { label: "Baby", value: "Baby", gender: "" },
    { label: "Dr.", value: "Dr.", gender: "" },
  ];
  const genders = [
    { label: "Male", value: "Male" },
    { label: "Female", value: "Female" },
    { label: "Other", value: "Other" },
  ];
  const maritalStatuses = [
    { label: "Single", value: "Single" },
    { label: "Married", value: "Married" },
    { label: "Divorced", value: "Divorced" },
    { label: "Widowed", value: "Widowed" },
    { label: "Other", value: "Other" },
  ];
  const bloodGroups = [
    { label: "A+", value: "A+" },
    { label: "A-", value: "A-" },
    { label: "B+", value: "B+" },
    { label: "B-", value: "B-" },
    { label: "AB+", value: "AB+" },
    { label: "AB-", value: "AB-" },
    { label: "O+", value: "O+" },
    { label: "O-", value: "O-" },
    { label: "Not Known", value: "Not Known" },
  ];
  const relationships = [
    { label: "Father", value: "Father" },
    { label: "Mother", value: "Mother" },
    { label: "Spouse", value: "Spouse" },
    { label: "Son", value: "Son" },
    { label: "Daughter", value: "Daughter" },
    { label: "Brother", value: "Brother" },
    { label: "Sister", value: "Sister" },
    { label: "Friend", value: "Friend" },
    { label: "Other", value: "Other" },
  ];

  const handleInputChange = (name, value) => {
    if (name === "title") {
      const selectedTitle = titles.find((t) => t.value === value);
      if (selectedTitle?.gender) {
        setFormData((prev) => ({
          ...prev,
          title: value,
          gender: selectedTitle.gender,
        }));
      } else {
        setFormData((prev) => ({ ...prev, title: value }));
      }
    } else if (name === "dateOfBirth") {
      setFormData((prev) => ({
        ...prev,
        dateOfBirth: value,
        age: calculateAge(value),
      }));
    } else if (name.startsWith("address.")) {
      const addressField = name.split(".")[1];
      setFormData((prev) => ({
        ...prev,
        address: { ...prev.address, [addressField]: value },
      }));
      if (addressField === "pincode" && value.length === 6)
        fetchPincodeData(value);
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.title) newErrors.title = "Title is required";
    if (!formData.fullName.trim()) newErrors.fullName = "Full name is required";
    if (!formData.gender) newErrors.gender = "Gender is required";
    if (!formData.dateOfBirth)
      newErrors.dateOfBirth = "Date of birth is required";
    if (!formData.contactNumber.trim())
      newErrors.contactNumber = "Contact number is required";
    if (!formData.address.pincode.trim())
      newErrors.pincode = "Pincode is required";
    if (!formData.bloodGroup) newErrors.bloodGroup = "Blood group is required";
    if (!formData.knownAllergies.trim())
      newErrors.knownAllergies = "Known allergies field is required";
    if (!formData.department) newErrors.department = "Department is required";
    if (!formData.doctor) newErrors.doctor = "Doctor is required";
    if (formData.hasAppointment) {
      if (!formData.appointmentDate)
        newErrors.appointmentDate = "Date is required";
      if (!formData.appointmentTime)
        newErrors.appointmentTime = "Time is required";
    }
    if (formData.companionRelationship && !formData.companionContact.trim()) {
      newErrors.companionContact = "Contact is required";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      toast.current?.show({
        severity: "error",
        summary: "Validation Error",
        detail: "Please fill all required fields",
        life: 3000,
      });
      return;
    }
    setLoading(true);
    try {
      const cleanedFormData = { ...formData };
      if (!cleanedFormData.tpa) cleanedFormData.tpa = null;
      if (!cleanedFormData.email) cleanedFormData.email = null;
      if (!cleanedFormData.maritalStatus) cleanedFormData.maritalStatus = null;
      if (!cleanedFormData.mlcNumber) cleanedFormData.mlcNumber = null;

      let response;
      if (isEditMode && patientId) {
        response = await fetch(`${API_ENDPOINTS.PATIENTS}/${patientId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cleanedFormData),
        });
      } else {
        response = await fetch(API_ENDPOINTS.PATIENTS, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cleanedFormData),
        });
      }

      const data = await response.json();
      if (data.success) {
        toast.current?.show({
          severity: "success",
          summary: "Success",
          detail:
            data.message ||
            (isEditMode
              ? "Patient updated successfully"
              : "Patient registered successfully"),
          life: 3000,
        });
        setTimeout(() => navigate("/allpatient"), 2000);
      } else {
        toast.current?.show({
          severity: "error",
          summary: "Error",
          detail: data.message || "Operation failed",
          life: 3000,
        });
      }
    } catch (error) {
      console.error("Error submitting form:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Submission failed",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection:"column",
          justifyContent: "center",
          alignItems: "center",
          height: "400px",
        }}
      >
        <span
          className="loaders"
          style={{ width: "50px", height: "50px" }}
        ></span>
         <h3 className="mt-3 font-bold text-xl">Loading...</h3>
      </div>
     
    );
  }

  // Compact label style
  const lbl = {
    fontWeight: 600,
    display: "block",
    marginBottom: "3px",
    fontSize: "12px",
    color: "#374151",
  };
  const cardStyle = { marginBottom: "3px", borderRadius: "8px" };
  const sectionHead = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "8px",
    paddingBottom: "6px",
    borderBottom: "1px solid #e5e7eb",
  };
  const fieldStyle = { marginBottom: "6px" };

  return (
    <div style={{ width: "100%", padding: "4px 12px 4px 12px" }}>
      <Toast ref={toast} position="top-right" />

      {/* ── Header (Ultra Compact, Full Width) ── */}
      <Card
        className="btn-custom"
        style={{
          borderRadius: "8px",
          marginBottom: "3px",
          color: "white",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            padding: "2px 4px",
          }}
        >
          {/* Left: Branding */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              flexShrink: 0,
            }}
          >
            <i
              className="pi pi-heart-fill"
              style={{ fontSize: "14px", opacity: 0.9 }}
            />
            <div>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  lineHeight: 1.15,
                  whiteSpace: "nowrap",
                }}
              >
                Spherehealth Medical Solutions
              </div>
              <div
                style={{
                  fontSize: "10px",
                  opacity: 0.75,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                }}
              >
                {isEditMode ? "Edit Patient" : "Patient Registration"}{" "}
                &nbsp;·&nbsp; Dr. Sandeep
              </div>
            </div>
          </div>

          {/* Center: Search bar (only in add mode) — grows to fill */}
          {!isEditMode && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flex: 1,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  transform: "scale(0.88)",
                  transformOrigin: "left center",
                }}
              >
                <PatientSearchBar
                  onPatientSelect={handlePatientSearchSelect}
                  placeholder="🔍  Search existing patient by name, UHID or phone..."
                  style={{ width: "100%" }}
                />
              </div>
              {searchSelectedPatient && (
                <div
                  style={{
                    fontSize: "10px",
                    background: "rgba(255,255,255,0.22)",
                    padding: "3px 9px",
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    border: "1px solid rgba(255,255,255,0.3)",
                  }}
                >
                  <i
                    className="pi pi-check-circle"
                    style={{ color: "#90ee90", fontSize: "10px" }}
                  />
                  <span>
                    {searchSelectedPatient.fullName} (
                    {searchSelectedPatient.UHID})
                  </span>
                  <i
                    className="pi pi-times"
                    style={{ cursor: "pointer", fontSize: "9px", opacity: 0.7 }}
                    onClick={() => setSearchSelectedPatient(null)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Edit mode: Back button */}
          {isEditMode && (
            <Button
              label="Back"
              icon="pi pi-arrow-left"
              severity="secondary"
              outlined
              size="small"
              onClick={() => navigate("/allpatient")}
            />
          )}
        </div>
      </Card>

      <form onSubmit={handleSubmit}>
        {/* ── Row 1: Registration Type + TPA (side by side) ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "3px",
            marginBottom: "3px",
          }}
        >
          {/* Registration Type */}
          <Card style={cardStyle}>
            <div style={sectionHead}>
              <i
                className="pi pi-user-plus text-primary"
                style={{ fontSize: "13px" }}
              />
              <span style={{ fontWeight: 600, fontSize: "13px" }}>
                Registration Type
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
              {["OPD", "Emergency", "IPD", "Daycare", "Services"].map(
                (type) => (
                  <div
                    key={type}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    <RadioButton
                      inputId={type.toLowerCase()}
                      value={type}
                      onChange={(e) =>
                        handleInputChange("registrationType", e.value)
                      }
                      checked={formData.registrationType === type}
                    />
                    <label
                      htmlFor={type.toLowerCase()}
                      style={{ fontSize: "13px", cursor: "pointer" }}
                    >
                      {type}
                    </label>
                  </div>
                ),
              )}
            </div>
          </Card>

          {/* TPA */}
          <Card style={cardStyle}>
            <div style={sectionHead}>
              <i
                className="pi pi-shield text-primary"
                style={{ fontSize: "13px" }}
              />
              <span style={{ fontWeight: 600, fontSize: "13px" }}>
                TPA (Optional)
              </span>
              {OPDprice && (
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: "12px",
                    color: "#0d6efd",
                    fontWeight: 600,
                  }}
                >
                  OPD: ₹{OPDprice}
                </span>
              )}
            </div>
            <Dropdown
              value={formData.tpa}
              options={tpaList}
              onChange={(e) => {
                handleInputChange("tpa", e.value);
                if (e.value) fetchOPDPrice(e.value);
                else setOPDprice(null);
              }}
              placeholder={tpaList.length ? "Select TPA" : "Loading..."}
              filter
              showClear
              style={{ width: "100%" }}
            />
          </Card>
        </div>

        {/* ── Personal Details ── */}
        <Card style={cardStyle}>
          <div style={sectionHead}>
            <i
              className="pi pi-user text-primary"
              style={{ fontSize: "13px" }}
            />
            <span style={{ fontWeight: 600, fontSize: "13px" }}>
              Personal Details
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8, 1fr)",
              gap: "8px",
            }}
          >
            {/* Title */}
            <div style={{ gridColumn: "span 1", ...fieldStyle }}>
              <label style={lbl}>
                Title <span style={{ color: "red" }}>*</span>
              </label>
              <Dropdown
                value={formData.title}
                options={titles}
                onChange={(e) => handleInputChange("title", e.value)}
                placeholder="Title"
                className={errors.title ? "p-invalid" : ""}
                style={{ width: "100%" }}
              />
              {errors.title && (
                <small className="p-error">{errors.title}</small>
              )}
            </div>
            {/* Full Name */}
            <div style={{ gridColumn: "span 3", ...fieldStyle }}>
              <label style={lbl}>
                Full Name <span style={{ color: "red" }}>*</span>
              </label>
              <InputText
                value={formData.fullName}
                onChange={(e) => handleInputChange("fullName", e.target.value)}
                placeholder="Full Name"
                className={errors.fullName ? "p-invalid" : ""}
                style={{ width: "100%" }}
              />
              {errors.fullName && (
                <small className="p-error">{errors.fullName}</small>
              )}
            </div>
            {/* Gender */}
            <div style={{ gridColumn: "span 2", ...fieldStyle }}>
              <label style={lbl}>
                Gender <span style={{ color: "red" }}>*</span>
              </label>
              <Dropdown
                value={formData.gender}
                options={genders}
                onChange={(e) => handleInputChange("gender", e.value)}
                placeholder="Gender"
                className={errors.gender ? "p-invalid" : ""}
                style={{ width: "100%" }}
              />
              {errors.gender && (
                <small className="p-error">{errors.gender}</small>
              )}
            </div>
            {/* DOB */}
            <div style={{ gridColumn: "span 2", ...fieldStyle }}>
              <label style={lbl}>
                Date of Birth <span style={{ color: "red" }}>*</span>
              </label>
              <Calendar
                value={formData.dateOfBirth}
                onChange={(e) => handleInputChange("dateOfBirth", e.value)}
                dateFormat="dd/mm/yy"
                showIcon
                maxDate={new Date()}
                placeholder="DOB"
                className={errors.dateOfBirth ? "p-invalid" : ""}
                style={{ width: "100%" }}
              />
              {errors.dateOfBirth && (
                <small className="p-error">{errors.dateOfBirth}</small>
              )}
            </div>
            {/* Age */}
            <div style={{ gridColumn: "span 1", ...fieldStyle }}>
              <label style={lbl}>Age</label>
              <InputText
                value={formData.age}
                onChange={(e) => handleInputChange("age", e.target.value)}
                placeholder="Age"
                style={{ width: "100%" }}
              />
            </div>
            {/* Contact */}
            <div style={{ gridColumn: "span 2", ...fieldStyle }}>
              <label style={lbl}>
                Contact No. <span style={{ color: "red" }}>*</span>
              </label>
              <InputText
                value={formData.contactNumber}
                onChange={(e) =>
                  handleInputChange("contactNumber", e.target.value)
                }
                placeholder="Contact Number"
                maxLength={10}
                className={errors.contactNumber ? "p-invalid" : ""}
                style={{ width: "100%" }}
              />
              {errors.contactNumber && (
                <small className="p-error">{errors.contactNumber}</small>
              )}
            </div>
            {/* Email */}
            <div style={{ gridColumn: "span 3", ...fieldStyle }}>
              <label style={lbl}>Email</label>
              <InputText
                value={formData.email}
                onChange={(e) => handleInputChange("email", e.target.value)}
                type="email"
                placeholder="Email"
                style={{ width: "100%" }}
              />
            </div>
            {/* Marital Status */}
            <div style={{ gridColumn: "span 2", ...fieldStyle }}>
              <label style={lbl}>Marital Status</label>
              <Dropdown
                value={formData.maritalStatus}
                options={maritalStatuses}
                onChange={(e) => handleInputChange("maritalStatus", e.value)}
                placeholder="Status"
                style={{ width: "100%" }}
              />
            </div>
          </div>
        </Card>

        {/* ── Row 3: Address + Medical (side by side) ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "3px",
            margin: "3px 0",
          }}
        >
          {/* Address */}
          <Card style={cardStyle}>
            <div style={sectionHead}>
              <i
                className="pi pi-map-marker text-primary"
                style={{ fontSize: "13px" }}
              />
              <span style={{ fontWeight: 600, fontSize: "13px" }}>
                Address Details
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                gap: "8px",
              }}
            >
              <div style={fieldStyle}>
                <label style={lbl}>
                  Pincode <span style={{ color: "red" }}>*</span>
                </label>
                <div style={{ position: "relative" }}>
                  <InputText
                    value={formData.address.pincode}
                    onChange={(e) =>
                      handleInputChange("address.pincode", e.target.value)
                    }
                    placeholder="Pincode"
                    maxLength={6}
                    className={errors.pincode ? "p-invalid" : ""}
                    style={{ width: "100%" }}
                  />
                  {pincodeLoading && (
                    <ProgressSpinner
                      style={{
                        width: "16px",
                        height: "16px",
                        position: "absolute",
                        right: "8px",
                        top: "50%",
                        transform: "translateY(-50%)",
                      }}
                    />
                  )}
                </div>
                {errors.pincode && (
                  <small className="p-error">{errors.pincode}</small>
                )}
              </div>
              <div style={fieldStyle}>
                <label style={lbl}>City</label>
                <InputText
                  value={formData.address.city}
                  readOnly
                  placeholder="Auto"
                  style={{ width: "100%" }}
                />
              </div>
              <div style={fieldStyle}>
                <label style={lbl}>State</label>
                <InputText
                  value={formData.address.state}
                  readOnly
                  placeholder="Auto"
                  style={{ width: "100%" }}
                />
              </div>
              <div style={fieldStyle}>
                <label style={lbl}>District</label>
                <InputText
                  value={formData.address.district}
                  readOnly
                  placeholder="Auto"
                  style={{ width: "100%" }}
                />
              </div>
            </div>
            <div style={{ marginTop: "8px" }}>
              <label style={lbl}>Complete Address</label>
              <InputTextarea
                value={formData.address.completeAddress}
                onChange={(e) =>
                  handleInputChange("address.completeAddress", e.target.value)
                }
                rows={2}
                placeholder="Complete address details"
                style={{ width: "100%" }}
              />
            </div>
          </Card>

          {/* Medical */}
          <Card style={cardStyle}>
            <div style={sectionHead}>
              <i
                className="pi pi-heart text-primary"
                style={{ fontSize: "13px" }}
              />
              <span style={{ fontWeight: 600, fontSize: "13px" }}>
                Medical Details
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
              }}
            >
              <div style={fieldStyle}>
                <label style={lbl}>
                  Department <span style={{ color: "red" }}>*</span>
                </label>
                <Dropdown
                  value={formData.department}
                  options={departments}
                  onChange={(e) => handleInputChange("department", e.value)}
                  placeholder="Select Department"
                  filter
                  className={errors.department ? "p-invalid" : ""}
                  style={{ width: "100%" }}
                />
                {errors.department && (
                  <small className="p-error">{errors.department}</small>
                )}
              </div>
              <div style={fieldStyle}>
                <label style={lbl}>
                  Doctor <span style={{ color: "red" }}>*</span>
                </label>
                <Dropdown
                  value={formData.doctor}
                  options={filteredDoctors}
                  onChange={(e) => handleInputChange("doctor", e.value)}
                  placeholder={
                    formData.department ? "Select Doctor" : "Select Dept First"
                  }
                  filter
                  disabled={!formData.department}
                  className={errors.doctor ? "p-invalid" : ""}
                  style={{ width: "100%" }}
                />
                {errors.doctor && (
                  <small className="p-error">{errors.doctor}</small>
                )}
              </div>
              <div style={fieldStyle}>
                <label style={lbl}>
                  Blood Group <span style={{ color: "red" }}>*</span>
                </label>
                <Dropdown
                  value={formData.bloodGroup}
                  options={bloodGroups}
                  onChange={(e) => handleInputChange("bloodGroup", e.value)}
                  placeholder="Blood Group"
                  className={errors.bloodGroup ? "p-invalid" : ""}
                  style={{ width: "100%" }}
                />
                {errors.bloodGroup && (
                  <small className="p-error">{errors.bloodGroup}</small>
                )}
              </div>
              <div style={fieldStyle}>
                <label style={lbl}>
                  Known Allergies <span style={{ color: "red" }}>*</span>
                </label>
                <InputTextarea
                  value={formData.knownAllergies}
                  onChange={(e) =>
                    handleInputChange("knownAllergies", e.target.value)
                  }
                  rows={2}
                  placeholder="e.g. Penicillin, Dust"
                  className={errors.knownAllergies ? "p-invalid" : ""}
                  style={{ width: "100%" }}
                />
                {errors.knownAllergies && (
                  <small className="p-error">{errors.knownAllergies}</small>
                )}
              </div>
            </div>
            {/* MLC inline */}
            <div
              style={{
                marginTop: "8px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              <Checkbox
                inputId="mlc"
                checked={formData.isMLC}
                onChange={(e) => handleInputChange("isMLC", e.checked)}
              />
              <label
                htmlFor="mlc"
                style={{ fontSize: "12px", fontWeight: 600 }}
              >
                MLC Case?
              </label>
              {formData.isMLC && (
                <InputText
                  value={formData.mlcNumber}
                  onChange={(e) =>
                    handleInputChange("mlcNumber", e.target.value)
                  }
                  placeholder="MLC Number"
                  style={{ width: "160px" }}
                />
              )}
            </div>
          </Card>
        </div>

        {/* ── Row 4: Companion + Appointment (side by side) ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "3px",
            marginBottom: "4px",
          }}
        >
          {/* Companion */}
          <Card style={cardStyle}>
            <div style={sectionHead}>
              <i
                className="pi pi-users text-primary"
                style={{ fontSize: "13px" }}
              />
              <span style={{ fontWeight: 600, fontSize: "13px" }}>
                Companion Details
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: "8px",
              }}
            >
              <div style={fieldStyle}>
                <label style={lbl}>Companion Name</label>
                <InputText
                  value={formData.companionName}
                  onChange={(e) =>
                    handleInputChange("companionName", e.target.value)
                  }
                  placeholder="Name"
                  style={{ width: "100%" }}
                />
              </div>
              <div style={fieldStyle}>
                <label style={lbl}>Relationship</label>
                <Dropdown
                  value={formData.companionRelationship}
                  options={relationships}
                  onChange={(e) =>
                    handleInputChange("companionRelationship", e.value)
                  }
                  placeholder="Relation"
                  style={{ width: "100%" }}
                />
              </div>
              <div style={fieldStyle}>
                <label style={lbl}>
                  Contact{" "}
                  {formData.companionRelationship && (
                    <span style={{ color: "red" }}>*</span>
                  )}
                </label>
                <InputText
                  value={formData.companionContact}
                  onChange={(e) =>
                    handleInputChange("companionContact", e.target.value)
                  }
                  placeholder="Contact No."
                  maxLength={10}
                  className={errors.companionContact ? "p-invalid" : ""}
                  style={{ width: "100%" }}
                />
                {errors.companionContact && (
                  <small className="p-error">{errors.companionContact}</small>
                )}
              </div>
            </div>
          </Card>

          {/* Appointment */}
          <Card style={cardStyle}>
            <div style={sectionHead}>
              <i
                className="pi pi-calendar-plus text-primary"
                style={{ fontSize: "13px" }}
              />
              <span style={{ fontWeight: 600, fontSize: "13px" }}>
                Appointment Details
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "8px",
              }}
            >
              <Checkbox
                inputId="hasAppointment"
                checked={formData.hasAppointment}
                onChange={(e) => handleInputChange("hasAppointment", e.checked)}
              />
              <label
                htmlFor="hasAppointment"
                style={{ fontSize: "13px", fontWeight: 600 }}
              >
                Has Prior Appointment
              </label>
            </div>
            {formData.hasAppointment && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px",
                }}
              >
                <div style={fieldStyle}>
                  <label style={lbl}>
                    Date <span style={{ color: "red" }}>*</span>
                  </label>
                  <Calendar
                    value={formData.appointmentDate}
                    onChange={(e) =>
                      handleInputChange("appointmentDate", e.value)
                    }
                    dateFormat="dd/mm/yy"
                    showIcon
                    placeholder="Date"
                    className={errors.appointmentDate ? "p-invalid" : ""}
                    style={{ width: "100%" }}
                  />
                  {errors.appointmentDate && (
                    <small className="p-error">{errors.appointmentDate}</small>
                  )}
                </div>
                <div style={fieldStyle}>
                  <label style={lbl}>
                    Time <span style={{ color: "red" }}>*</span>
                  </label>
                  <Calendar
                    value={formData.appointmentTime}
                    onChange={(e) =>
                      handleInputChange("appointmentTime", e.value)
                    }
                    timeOnly
                    showIcon
                    placeholder="Time"
                    className={errors.appointmentTime ? "p-invalid" : ""}
                    style={{ width: "100%" }}
                  />
                  {errors.appointmentTime && (
                    <small className="p-error">{errors.appointmentTime}</small>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* ── Action Buttons ── */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            justifyContent: "center",
            paddingBottom: "12px",
          }}
        >
          <Button
            label="Cancel"
            icon="pi pi-times"
            severity="secondary"
            type="button"
            onClick={() => navigate("/allpatient")}
            outlined
          />
          <Button
            label={
              loading
                ? "Submitting..."
                : isEditMode
                  ? "Update Patient"
                  : "Register Patient"
            }
            icon={loading ? "pi pi-spin pi-spinner" : "pi pi-check"}
            severity="success"
            type="submit"
            loading={loading}
            disabled={loading}
          />
        </div>
      </form>
    </div>
  );
}
