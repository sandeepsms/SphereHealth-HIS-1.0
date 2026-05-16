import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Button } from "primereact/button";
import { Toast } from "primereact/toast";
import { InputTextarea } from "primereact/inputtextarea";
import patientService from "../../Services/patient/patientService";

const PatientForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const toast = useRef(null);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    fullName: "",
    fatherName: "",
    dateOfBirth: null,
    gender: "",
    maritalStatus: "",
    contactNumber: "",
    alternateContact: "",
    email: "",
    bloodGroup: "",
    address: {
      street: "",
      city: "",
      state: "",
      pincode: "",
      completeAddress: "",
    },
    emergencyContact: {
      name: "",
      relationship: "",
      phone: "",
    },
    knownAllergies: "",
    chronicConditions: "",
    currentMedications: "",
    pastSurgicalHistory: "",
  });

  const genderOptions = [
    { label: "Male", value: "Male" },
    { label: "Female", value: "Female" },
    { label: "Other", value: "Other" },
  ];

  const maritalStatusOptions = [
    { label: "Single", value: "Single" },
    { label: "Married", value: "Married" },
    { label: "Divorced", value: "Divorced" },
    { label: "Widowed", value: "Widowed" },
    { label: "Other", value: "Other" },
  ];

  const bloodGroupOptions = [
    "A+",
    "A-",
    "B+",
    "B-",
    "AB+",
    "AB-",
    "O+",
    "O-",
  ].map((bg) => ({ label: bg, value: bg }));

  useEffect(() => {
    if (id) {
      loadPatient();
    }
  }, [id]);

  const loadPatient = async () => {
    try {
      const response = await patientService.getPatientById(id);
      const patient = response.data.data || response.data;
      setFormData({
        ...patient,
        dateOfBirth: patient.dateOfBirth ? new Date(patient.dateOfBirth) : null,
        knownAllergies: patient.knownAllergies?.join(", ") || "",
        chronicConditions: patient.chronicConditions?.join(", ") || "",
        currentMedications: patient.currentMedications?.join(", ") || "",
        address: patient.address || {
          street: "",
          city: "",
          state: "",
          pincode: "",
          completeAddress: "",
        },
        emergencyContact: patient.emergencyContact || {
          name: "",
          relationship: "",
          phone: "",
        },
      });
    } catch (error) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load patient",
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Pre-submit validation so the user gets a single clear message and the
    // server doesn't have to fail the request with a 400 + Mongoose error
    // map. Backend still validates — this is just for fast feedback.
    const requiredFields = [
      ["fullName",      "Full name"],
      ["gender",        "Gender"],
      ["contactNumber", "Contact number"],
    ];
    const missing = requiredFields.filter(([k]) => !String(formData[k] || "").trim());
    if (missing.length) {
      toast.current?.show({
        severity: "warn",
        summary: "Missing required fields",
        detail: missing.map(([, label]) => label).join(", "),
        life: 4000,
      });
      return;
    }

    const phoneOk = /^\d{10,15}$/.test(String(formData.contactNumber).replace(/\D/g, ""));
    if (!phoneOk) {
      toast.current?.show({
        severity: "warn",
        summary: "Invalid contact number",
        detail: "Enter a 10–15 digit phone number.",
        life: 4000,
      });
      return;
    }

    setLoading(true);

    const submitData = {
      ...formData,
      knownAllergies: formData.knownAllergies
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      chronicConditions: formData.chronicConditions
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      currentMedications: formData.currentMedications
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };

    try {
      if (id) {
        await patientService.updatePatient(id, submitData);
        toast.current?.show({
          severity: "success",
          summary: "Success",
          detail: "Patient updated successfully",
        });
      } else {
        await patientService.createPatient(submitData);
        toast.current?.show({
          severity: "success",
          summary: "Success",
          detail: "Patient registered successfully",
        });
      }
      setTimeout(() => navigate("/patients"), 1500);
    } catch (error) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: error.response?.data?.message || "Operation failed",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: "20px", padding: "0 1rem" }}>
      <Toast ref={toast} />
      <Card
        title={
          <div
            style={{ fontSize: "24px", fontWeight: "600", color: "#17a2b8" }}
          >
            {id ? "Edit Patient" : "Register New Patient"}
          </div>
        }
      >
        <form onSubmit={handleSubmit}>
          <div className="grid">
            {/* Basic Info */}
            <div className="col-12">
              <h3 className="text-primary">Basic Information</h3>
            </div>

            <div className="col-12 md:col-6">
              <label className="block mb-2">Full Name *</label>
              <InputText
                value={formData.fullName}
                onChange={(e) =>
                  setFormData({ ...formData, fullName: e.target.value })
                }
                required
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-6">
              <label className="block mb-2">Father's Name</label>
              <InputText
                value={formData.fatherName}
                onChange={(e) =>
                  setFormData({ ...formData, fatherName: e.target.value })
                }
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2">Date of Birth *</label>
              <Calendar
                value={formData.dateOfBirth}
                onChange={(e) =>
                  setFormData({ ...formData, dateOfBirth: e.value })
                }
                required
                dateFormat="dd/mm/yy"
                showIcon
                className="w-full"
                maxDate={new Date()}
              />
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2">Gender *</label>
              <Dropdown
                value={formData.gender}
                options={genderOptions}
                onChange={(e) => setFormData({ ...formData, gender: e.value })}
                required
                placeholder="Select"
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2">Marital Status</label>
              <Dropdown
                value={formData.maritalStatus}
                options={maritalStatusOptions}
                onChange={(e) =>
                  setFormData({ ...formData, maritalStatus: e.value })
                }
                placeholder="Select"
                className="w-full"
              />
            </div>

            {/* Contact Info */}
            <div className="col-12 mt-3">
              <h3 className="text-primary">Contact Information</h3>
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2">Contact Number *</label>
              <InputText
                value={formData.contactNumber}
                onChange={(e) =>
                  setFormData({ ...formData, contactNumber: e.target.value })
                }
                required
                className="w-full"
                keyfilter="pint"
                maxLength={10}
              />
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2">Alternate Contact</label>
              <InputText
                value={formData.alternateContact}
                onChange={(e) =>
                  setFormData({ ...formData, alternateContact: e.target.value })
                }
                className="w-full"
                keyfilter="pint"
                maxLength={10}
              />
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2">Email</label>
              <InputText
                type="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                className="w-full"
              />
            </div>

            <div className="col-12">
              <label className="block mb-2">Complete Address</label>
              <InputTextarea
                value={formData.address.completeAddress}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    address: {
                      ...formData.address,
                      completeAddress: e.target.value,
                    },
                  })
                }
                rows={2}
                className="w-full"
              />
            </div>

            {/* Emergency Contact */}
            <div className="col-12 mt-3">
              <h3 className="text-primary">Emergency Contact</h3>
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2">Contact Name</label>
              <InputText
                value={formData.emergencyContact.name}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    emergencyContact: {
                      ...formData.emergencyContact,
                      name: e.target.value,
                    },
                  })
                }
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2">Relationship</label>
              <InputText
                value={formData.emergencyContact.relationship}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    emergencyContact: {
                      ...formData.emergencyContact,
                      relationship: e.target.value,
                    },
                  })
                }
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2">Phone</label>
              <InputText
                value={formData.emergencyContact.phone}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    emergencyContact: {
                      ...formData.emergencyContact,
                      phone: e.target.value,
                    },
                  })
                }
                className="w-full"
                keyfilter="pint"
                maxLength={10}
              />
            </div>

            {/* Medical Info */}
            <div className="col-12 mt-3">
              <h3 className="text-primary">Medical Information</h3>
            </div>

            <div className="col-12 md:col-4">
              <label className="block mb-2">Blood Group</label>
              <Dropdown
                value={formData.bloodGroup}
                options={bloodGroupOptions}
                onChange={(e) =>
                  setFormData({ ...formData, bloodGroup: e.value })
                }
                placeholder="Select"
                className="w-full"
              />
            </div>

            <div className="col-12 md:col-8">
              <label className="block mb-2">
                Known Allergies (comma separated)
              </label>
              <InputText
                value={formData.knownAllergies}
                onChange={(e) =>
                  setFormData({ ...formData, knownAllergies: e.target.value })
                }
                placeholder="e.g. Penicillin, Dust, Pollen"
                className="w-full"
              />
            </div>

            <div className="col-12">
              <label className="block mb-2">
                Chronic Conditions (comma separated)
              </label>
              <InputText
                value={formData.chronicConditions}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    chronicConditions: e.target.value,
                  })
                }
                placeholder="e.g. Diabetes, Hypertension"
                className="w-full"
              />
            </div>

            <div className="col-12">
              <label className="block mb-2">
                Current Medications (comma separated)
              </label>
              <InputTextarea
                value={formData.currentMedications}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    currentMedications: e.target.value,
                  })
                }
                rows={2}
                className="w-full"
              />
            </div>

            <div className="col-12">
              <label className="block mb-2">Past Surgical History</label>
              <InputTextarea
                value={formData.pastSurgicalHistory}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    pastSurgicalHistory: e.target.value,
                  })
                }
                rows={2}
                className="w-full"
              />
            </div>

            {/* Buttons */}
            <div className="col-12 mt-4">
              <div className="flex gap-2">
                <Button
                  label="Cancel"
                  icon="pi pi-times"
                  severity="secondary"
                  onClick={() => navigate("/patients")}
                  type="button"
                />
                <Button
                  label={id ? "Update" : "Register"}
                  icon="pi pi-check"
                  loading={loading}
                  type="submit"
                />
              </div>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default PatientForm;
