// PatientRegistration.jsx - Fixed Version
import React, { useState, useEffect, useRef } from "react";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { InputTextarea } from "primereact/inputtextarea";
import { Checkbox } from "primereact/checkbox";
import { RadioButton } from "primereact/radiobutton";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { ProgressSpinner } from "primereact/progressspinner";
import { Card } from "primereact/card";
import { Divider } from "primereact/divider";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { departmentService } from "../Services/departmentService";
import { doctorService } from "../Services/doctor/doctorService";
import { tpaService } from "../Services/tpa/tpaService";
import "primereact/resources/themes/lara-light-blue/theme.css";
import "primereact/resources/primereact.min.css";
import "primeicons/primeicons.css";
import { API_ENDPOINTS } from "../config/api";
import "../../css/Radiobutton.css";

export default function PatientRegistration() {
  const toast = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { id: patientId } = useParams(); // URL से patient ID लेना

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
  const [OPDprice, setOPDprice] = useState();

  function fetchOPDPrice(selectedId) {
    console.log("Fetching OPD Price for TPA ID:", selectedId);
    fetch(
      `http://localhost:5000/api/Servicebilldata/getOPDPrice?_id=${selectedId}`,
    )
      .then((res) => res.json())
      .then((data) => {
        if (data?.data?.opd_price?.[0]?.Totalamount) {
          setOPDprice(data.data.opd_price[0].Totalamount);
        }
      })
      .catch((error) => {
        console.error("Error fetching OPD price:", error);
      });
  }

  // Initial data load
  useEffect(() => {
    loadInitialData();
  }, []);

  // Patient data load करना जब departments और doctors load हो जाएं
  useEffect(() => {
    if (patientId && departments.length > 0 && doctors.length > 0) {
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

  const fetchPatientData = async (id) => {
    try {
      setLoading(true);
      const response = await fetch(`${API_ENDPOINTS.PATIENTS}/${id}`);
      const data = await response.json();

      if (data.success && data.data) {
        const patientData = data.data;
        setIsEditMode(true);

        // TPA ID extract करना
        const tpaId =
          typeof patientData.tpa === "object" && patientData.tpa !== null
            ? patientData.tpa._id
            : patientData.tpa;

        // Department ID extract करना
        const deptId =
          typeof patientData.department === "object" &&
          patientData.department !== null
            ? patientData.department._id
            : patientData.department;

        // Doctor ID extract करना
        const docId =
          typeof patientData.doctor === "object" && patientData.doctor !== null
            ? patientData.doctor._id
            : patientData.doctor;

        console.log("Patient Data Loaded:", {
          tpaId,
          deptId,
          docId,
          fullData: patientData,
        });

        // Form data set करना
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

        // TPA के लिए OPD price fetch करना
        if (tpaId) {
          fetchOPDPrice(tpaId);
        }
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

  useEffect(() => {
    if (formData.department && doctors.length > 0) {
      const filtered = doctors.filter(
        (doc) => doc.department === formData.department,
      );
      setFilteredDoctors(filtered);

      // अगर selected doctor current department में नहीं है तो clear करें
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
      const data = await tpaService.getActiveTPAs();
      if (data.success) {
        const formattedTPA = data.data.map((tpa) => ({
          label: tpa.tpaName,
          value: tpa._id,
        }));
        setTpaList(formattedTPA);
      } else {
        console.error("No TPA data received:", data);
        setTpaList([]);
      }
    } catch (error) {
      console.error("Error fetching TPA:", error);
      toast.current?.show({
        severity: "warn",
        summary: "Warning",
        detail: "TPA data unavailable",
        life: 3000,
      });
      setTpaList([]);
    }
  };

  const fetchDepartments = async () => {
    try {
      const res = await departmentService.getAllDepartments();
      const deptList = Array.isArray(res) ? res : res.data || [];
      const formattedDepts = deptList
        .filter((dept) => dept.isActive)
        .map((dept) => ({
          label: dept.departmentName,
          value: dept._id,
        }));
      setDepartments(formattedDepts);
    } catch (error) {
      console.error("Error fetching departments:", error);
      setDepartments([]);
    }
  };

  const fetchDoctors = async () => {
    try {
      const res = await doctorService.getAllDoctors();
      const doctorsList = Array.isArray(res) ? res : res.data || [];
      const allDoctors = doctorsList
        .filter((doc) => doc.isActive)
        .map((doc) => ({
          label: `Dr. ${doc.personalInfo?.firstName || ""} ${
            doc.personalInfo?.lastName || ""
          } (${doc.professional?.specialization || ""})`,
          value: doc._id,
          department:
            typeof doc.department === "object"
              ? doc.department._id
              : doc.department,
        }));
      setDoctors(allDoctors);
    } catch (error) {
      console.error("Error fetching doctors:", error);
      setDoctors([]);
    }
  };

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
          detail: "Address details fetched successfully",
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
    } catch (error) {
      console.error("Error fetching pincode data:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to fetch address details",
        life: 3000,
      });
    } finally {
      setPincodeLoading(false);
    }
  };

  // Static data arrays
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
      if (selectedTitle && selectedTitle.gender) {
        setFormData((prev) => ({
          ...prev,
          title: value,
          gender: selectedTitle.gender,
        }));
      } else {
        setFormData((prev) => ({ ...prev, title: value }));
      }
    } else if (name.startsWith("address.")) {
      const addressField = name.split(".")[1];
      setFormData((prev) => ({
        ...prev,
        address: {
          ...prev.address,
          [addressField]: value,
        },
      }));

      if (addressField === "pincode" && value.length === 6) {
        fetchPincodeData(value);
      }
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }

    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
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

      if (!cleanedFormData.tpa) {
        cleanedFormData.tpa = null;
      }

      if (!cleanedFormData.email) {
        cleanedFormData.email = null;
      }

      if (!cleanedFormData.maritalStatus) {
        cleanedFormData.maritalStatus = null;
      }

      if (!cleanedFormData.mlcNumber) {
        cleanedFormData.mlcNumber = null;
      }

      let response;
      if (isEditMode && patientId) {
        // Update existing patient
        response = await fetch(`${API_ENDPOINTS.PATIENTS}/${patientId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(cleanedFormData),
        });
      } else {
        // Create new patient
        response = await fetch(API_ENDPOINTS.PATIENTS, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
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
        setTimeout(() => {
          navigate("/allpatient");
        }, 2000);
      } else {
        toast.current?.show({
          severity: "error",
          summary: "Error",
          detail:
            data.message ||
            (isEditMode
              ? "Failed to update patient"
              : "Failed to register patient"),
          life: 3000,
        });
      }
    } catch (error) {
      console.error("Error submitting form:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: isEditMode
          ? "Failed to update patient"
          : "Failed to register patient",
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
          justifyContent: "center",
          alignItems: "center",
          height: "400px",
        }}
      >
        <span
          className="loader"
          style={{ width: "50px", height: "50px" }}
        ></span>
      </div>
    );
  }

  return (
    <div className="p-4" style={{ maxWidth: "1400px", margin: "0 auto" }}>
      <Toast ref={toast} position="top-right" />

      {/* Header Card */}
      <Card
        className="mb-5 btn-custom"
        style={{
          color: "white",
        }}
      >
        <div className="flex justify-content-between align-items-center">
          <div>
            <h1 className="m-0 text-2xl font-bold">
              Spherehealth Medical Solutions
            </h1>
            <p className="m-0 mt-1 opacity-90">
              {isEditMode
                ? "Edit Patient Details"
                : "Patient Registration Portal"}
            </p>
            <small>Dr. Sandeep</small>
          </div>
          {isEditMode && (
            <Button
              label="Back to Patients"
              icon="pi pi-arrow-left"
              severity="secondary"
              outlined
              onClick={() => navigate("/allpatient")}
            />
          )}
        </div>
      </Card>

      <form onSubmit={handleSubmit}>
        {/* Registration Type */}
        <Card className="mb-4">
          <div className="flex align-items-center gap-3 mb-3">
            <i className="pi pi-user-plus text-primary mr-2"></i>
            <h3 className="m-0 font-semibold text-xl">Registration Details</h3>
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="flex align-items-center gap-2">
              <RadioButton
                inputId="opd"
                value="OPD"
                onChange={(e) => handleInputChange("registrationType", e.value)}
                checked={formData.registrationType === "OPD"}
                className="opd-radio"
              />
              <label htmlFor="opd" className="font-medium">
                OPD
              </label>
            </div>
            <div className="flex align-items-center gap-2">
              <RadioButton
                inputId="emergency"
                value="Emergency"
                onChange={(e) => handleInputChange("registrationType", e.value)}
                checked={formData.registrationType === "Emergency"}
              />
              <label htmlFor="emergency" className="font-medium">
                Emergency
              </label>
            </div>
            <div className="flex align-items-center gap-2">
              <RadioButton
                inputId="ipd"
                value="IPD"
                onChange={(e) => handleInputChange("registrationType", e.value)}
                checked={formData.registrationType === "IPD"}
              />
              <label htmlFor="ipd" className="font-medium">
                IPD
              </label>
            </div>
          </div>
        </Card>

        {/* TPA Section */}
        <Card className="mb-4">
          <div className="p-field p-col-12">
            <label className="font-semibold block mb-2">TPA (Optional)</label>
            <Dropdown
              value={formData.tpa}
              options={tpaList}
              onChange={(e) => {
                const selectedId = e.value;
                handleInputChange("tpa", selectedId);
                if (selectedId) {
                  fetchOPDPrice(selectedId);
                }
              }}
              placeholder={tpaList.length ? "Select TPA" : "Loading..."}
              filter
              showClear
              className={errors.tpa ? "p-invalid" : ""}
              style={{ width: "100%" }}
            />
            {tpaList.length === 0 && !initialLoading && (
              <small className="text-500 block mt-1">No TPA available</small>
            )}
            {OPDprice && (
              <small className="text-primary block mt-2">
                OPD Price: ₹{OPDprice}
              </small>
            )}
          </div>
        </Card>

        {/* Personal Details */}
        <Card className="mb-4">
          <div className="flex align-items-center gap-3 mb-4">
            <i className="pi pi-user text-primary"></i>
            <h3 className="m-0 font-semibold text-xl">Personal Details</h3>
          </div>

          <div className="grid">
            <div className="field col-12 md:col-4">
              <label className="font-semibold block mb-2">
                Title <span className="text-red-500">*</span>
              </label>
              <Dropdown
                value={formData.title}
                options={titles}
                onChange={(e) => handleInputChange("title", e.value)}
                placeholder="Select Title"
                className={errors.title ? "p-invalid" : ""}
                style={{ width: "100%" }}
              />
              {errors.title && (
                <small className="p-error block">{errors.title}</small>
              )}
            </div>

            <div className="field col-12 md:col-4">
              <label className="font-semibold block mb-2">
                Full Name <span className="text-red-500">*</span>
              </label>
              <InputText
                value={formData.fullName}
                onChange={(e) => handleInputChange("fullName", e.target.value)}
                placeholder="Enter Full Name"
                className={errors.fullName ? "p-invalid" : ""}
              />
              {errors.fullName && (
                <small className="p-error block">{errors.fullName}</small>
              )}
            </div>

            <div className="field col-12 md:col-4">
              <label className="font-semibold block mb-2">
                Gender <span className="text-red-500">*</span>
              </label>
              <Dropdown
                value={formData.gender}
                options={genders}
                onChange={(e) => handleInputChange("gender", e.value)}
                placeholder="Select Gender"
                className={errors.gender ? "p-invalid" : ""}
                style={{ width: "100%" }}
              />
              {errors.gender && (
                <small className="p-error block">{errors.gender}</small>
              )}
            </div>

            <div className="field col-12 md:col-4">
              <label className="font-semibold block mb-2">
                Date of Birth <span className="text-red-500">*</span>
              </label>
              <Calendar
                value={formData.dateOfBirth}
                onChange={(e) => handleInputChange("dateOfBirth", e.value)}
                dateFormat="dd/mm/yy"
                showIcon
                maxDate={new Date()}
                placeholder="Select DOB"
                className={errors.dateOfBirth ? "p-invalid" : ""}
                style={{ width: "100%" }}
              />
              {errors.dateOfBirth && (
                <small className="p-error block">{errors.dateOfBirth}</small>
              )}
            </div>

            <div className="field col-12 md:col-4">
              <label className="font-semibold block mb-2">
                Contact Number <span className="text-red-500">*</span>
              </label>
              <InputText
                value={formData.contactNumber}
                onChange={(e) =>
                  handleInputChange("contactNumber", e.target.value)
                }
                placeholder="Enter Contact Number"
                maxLength={10}
                className={errors.contactNumber ? "p-invalid" : ""}
              />
              {errors.contactNumber && (
                <small className="p-error block">{errors.contactNumber}</small>
              )}
            </div>

            <div className="field col-12 md:col-4">
              <label className="font-semibold block mb-2">Marital Status</label>
              <Dropdown
                value={formData.maritalStatus}
                options={maritalStatuses}
                onChange={(e) => handleInputChange("maritalStatus", e.value)}
                placeholder="Select Status"
                style={{ width: "100%" }}
              />
            </div>

            <div className="field col-12 md:col-4">
              <label className="font-semibold block mb-2">Email</label>
              <InputText
                value={formData.email}
                onChange={(e) => handleInputChange("email", e.target.value)}
                type="email"
                placeholder="Enter Email"
              />
            </div>
          </div>
        </Card>

        {/* Address Section */}
        <Card className="mb-4">
          <div className="flex align-items-center gap-3 mb-4">
            <i className="pi pi-map-marker text-primary"></i>
            <h3 className="m-0 font-semibold text-xl">Address Details</h3>
          </div>

          <div className="grid">
            <div className="field col-12 md:col-3">
              <label className="font-semibold block mb-2">
                Pincode <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <InputText
                  value={formData.address.pincode}
                  onChange={(e) =>
                    handleInputChange("address.pincode", e.target.value)
                  }
                  placeholder="Enter 6 digit pincode"
                  maxLength={6}
                  className={errors.pincode ? "p-invalid" : ""}
                />
                {pincodeLoading && (
                  <ProgressSpinner
                    style={{
                      width: "20px",
                      height: "20px",
                      position: "absolute",
                      right: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                    }}
                  />
                )}
              </div>
              {errors.pincode && (
                <small className="p-error block">{errors.pincode}</small>
              )}
            </div>

            <div className="field col-12 md:col-3">
              <label className="font-semibold block mb-2">City</label>
              <InputText
                value={formData.address.city}
                readOnly
                placeholder="Auto-filled"
              />
            </div>

            <div className="field col-12 md:col-3">
              <label className="font-semibold block mb-2">State</label>
              <InputText
                value={formData.address.state}
                readOnly
                placeholder="Auto-filled"
              />
            </div>

            <div className="field col-12 md:col-3">
              <label className="font-semibold block mb-2">District</label>
              <InputText
                value={formData.address.district}
                readOnly
                placeholder="Auto-filled"
              />
            </div>

            <div className="field col-12">
              <label className="font-semibold block mb-2">
                Complete Address
              </label>
              <InputTextarea
                value={formData.address.completeAddress}
                onChange={(e) =>
                  handleInputChange("address.completeAddress", e.target.value)
                }
                rows={3}
                placeholder="Enter complete address details"
              />
            </div>
          </div>
        </Card>

        {/* Medical Details */}
        <Card className="mb-4">
          <div className="flex align-items-center gap-3 mb-4">
            <i className="pi pi-heart text-primary"></i>
            <h3 className="m-0 font-semibold text-xl">Medical Details</h3>
          </div>

          <div className="grid">
            <div className="field col-12 md:col-6">
              <label className="font-semibold block mb-2">
                Department <span className="text-red-500">*</span>
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
                <small className="p-error block">{errors.department}</small>
              )}
            </div>

            <div className="field col-12 md:col-6">
              <label className="font-semibold block mb-2">
                Doctor <span className="text-red-500">*</span>
              </label>
              <Dropdown
                value={formData.doctor}
                options={filteredDoctors}
                onChange={(e) => handleInputChange("doctor", e.value)}
                placeholder={
                  formData.department
                    ? "Select Doctor"
                    : "Select Department First"
                }
                filter
                disabled={!formData.department}
                className={errors.doctor ? "p-invalid" : ""}
                style={{ width: "100%" }}
              />
              {errors.doctor && (
                <small className="p-error block">{errors.doctor}</small>
              )}
            </div>

            <div className="field col-12 md:col-6">
              <label className="font-semibold block mb-2">
                Blood Group <span className="text-red-500">*</span>
              </label>
              <Dropdown
                value={formData.bloodGroup}
                options={bloodGroups}
                onChange={(e) => handleInputChange("bloodGroup", e.value)}
                placeholder="Select Blood Group"
                className={errors.bloodGroup ? "p-invalid" : ""}
                style={{ width: "100%" }}
              />
              {errors.bloodGroup && (
                <small className="p-error block">{errors.bloodGroup}</small>
              )}
            </div>

            <div className="field col-12 md:col-6">
              <label className="font-semibold block mb-2">
                Known Allergies <span className="text-red-500">*</span>
              </label>
              <InputTextarea
                value={formData.knownAllergies}
                onChange={(e) =>
                  handleInputChange("knownAllergies", e.target.value)
                }
                rows={3}
                placeholder="List any known allergies (e.g., Penicillin, Dust, etc.)"
                className={errors.knownAllergies ? "p-invalid" : ""}
              />
              {errors.knownAllergies && (
                <small className="p-error block">{errors.knownAllergies}</small>
              )}
            </div>
          </div>

          {/* MLC Section */}
          <Divider className="my-4">
            <span className="p-tag p-tag-info btn-custom">MLC Case</span>
          </Divider>
          <div className="flex align-items-center gap-2 mb-3">
            <Checkbox
              inputId="mlc"
              checked={formData.isMLC}
              onChange={(e) => handleInputChange("isMLC", e.checked)}
            />
            <label htmlFor="mlc" className="font-medium">
              Is this an MLC case?
            </label>
          </div>
          {formData.isMLC && (
            <div className="field col-12 md:col-6">
              <label className="font-semibold block mb-2">MLC Number</label>
              <InputText
                value={formData.mlcNumber}
                onChange={(e) => handleInputChange("mlcNumber", e.target.value)}
                placeholder="Enter MLC Number"
              />
            </div>
          )}
        </Card>

        {/* Companion Details */}
        <Card className="mb-4">
          <div className="flex align-items-center gap-3 mb-4">
            <i className="pi pi-users text-primary"></i>
            <h3 className="m-0 font-semibold text-xl">Companion Details</h3>
          </div>

          <div className="grid">
            <div className="field col-12 md:col-4">
              <label className="font-semibold block mb-2">Companion Name</label>
              <InputText
                value={formData.companionName}
                onChange={(e) =>
                  handleInputChange("companionName", e.target.value)
                }
                placeholder="Enter Companion Name"
              />
            </div>

            <div className="field col-12 md:col-4">
              <label className="font-semibold block mb-2">Relationship</label>
              <Dropdown
                value={formData.companionRelationship}
                options={relationships}
                onChange={(e) =>
                  handleInputChange("companionRelationship", e.value)
                }
                placeholder="Select Relationship"
                style={{ width: "100%" }}
              />
            </div>

            <div className="field col-12 md:col-4">
              <label className="font-semibold block mb-2">
                Contact Number{" "}
                {formData.companionRelationship && (
                  <span className="text-red-500">*</span>
                )}
              </label>
              <InputText
                value={formData.companionContact}
                onChange={(e) =>
                  handleInputChange("companionContact", e.target.value)
                }
                placeholder="Enter Contact Number"
                maxLength={10}
                className={errors.companionContact ? "p-invalid" : ""}
              />
              {errors.companionContact && (
                <small className="p-error block">
                  {errors.companionContact}
                </small>
              )}
            </div>
          </div>
        </Card>

        {/* Appointment Details */}
        <Card className="mb-5">
          <div className="flex align-items-center gap-3 mb-4">
            <i className="pi pi-calendar-plus text-primary"></i>
            <h3 className="m-0 font-semibold text-xl">Appointment Details</h3>
          </div>

          <div className="flex align-items-center gap-2 mb-4">
            <Checkbox
              inputId="hasAppointment"
              checked={formData.hasAppointment}
              onChange={(e) => handleInputChange("hasAppointment", e.checked)}
            />
            <label htmlFor="hasAppointment" className="font-medium">
              Has Prior Appointment
            </label>
          </div>

          {formData.hasAppointment && (
            <div className="grid">
              <div className="field col-12 md:col-6">
                <label className="font-semibold block mb-2">
                  Appointment Date <span className="text-red-500">*</span>
                </label>
                <Calendar
                  value={formData.appointmentDate}
                  onChange={(e) =>
                    handleInputChange("appointmentDate", e.value)
                  }
                  dateFormat="dd/mm/yy"
                  showIcon
                  placeholder="Select Date"
                  className={errors.appointmentDate ? "p-invalid" : ""}
                  style={{ width: "100%" }}
                />
                {errors.appointmentDate && (
                  <small className="p-error block">
                    {errors.appointmentDate}
                  </small>
                )}
              </div>

              <div className="field col-12 md:col-6">
                <label className="font-semibold block mb-2">
                  Appointment Time <span className="text-red-500">*</span>
                </label>
                <Calendar
                  value={formData.appointmentTime}
                  onChange={(e) =>
                    handleInputChange("appointmentTime", e.value)
                  }
                  timeOnly
                  showIcon
                  placeholder="Select Time"
                  className={errors.appointmentTime ? "p-invalid" : ""}
                  style={{ width: "100%" }}
                />
                {errors.appointmentTime && (
                  <small className="p-error block">
                    {errors.appointmentTime}
                  </small>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-content-center">
          <Button
            label="Cancel"
            icon="pi pi-times"
            severity="secondary"
            type="button"
            onClick={() => navigate("/allpatient")}
            className="p-button-outlined text-white"
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
