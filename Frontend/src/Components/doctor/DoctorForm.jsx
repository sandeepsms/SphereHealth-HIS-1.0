// src/components/doctor/DoctorForm.jsx
import { useEffect, useState } from "react";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Button } from "primereact/button";
import { InputNumber } from "primereact/inputnumber";
import { departmentService } from "../../Services/departmentService";
import { Message } from "primereact/message";

const genderOptions = [
  { label: "Male", value: "Male" },
  { label: "Female", value: "Female" },
  { label: "Other", value: "Other" },
];

const specializationOptions = [
  "General Physician",
  "Cardiologist",
  "Neurologist",
  "Orthopedic",
  "Pediatrician",
  "Gynecologist",
  "Dermatologist",
  "ENT Specialist",
  "Ophthalmologist",
  "Psychiatrist",
  "Surgeon",
  "Anesthesiologist",
  "Radiologist",
  "Pathologist",
  "Emergency Medicine",
  "Other",
].map((s) => ({ label: s, value: s }));

const DoctorForm = ({ initialValues, onSubmit, submitting = false }) => {
  const [form, setForm] = useState(
    initialValues || {
      personalInfo: { firstName: "", lastName: "", gender: "" },
      contact: { mobileNumber: "", email: "" },
      professional: {
        specialization: "",
        experience: 0,
        registrationNumber: "",
      },
      department: "",
      consultationFee: { opd: 0, emergency: 0 },
    }
  );
  const [departments, setDepartments] = useState([]);
  const [loadingDepts, setLoadingDepts] = useState(true);
  const [deptError, setDeptError] = useState(null);

  // Update form when initialValues change
  useEffect(() => {
    if (initialValues) {
      console.log("🔄 Setting initial values:", initialValues);
      setForm(initialValues);
    }
  }, [initialValues]);

  const loadDepartments = async () => {
    try {
      setLoadingDepts(true);
      setDeptError(null);

      const res = await departmentService.getAllDepartments();

      let deptList = [];
      if (Array.isArray(res)) {
        deptList = res;
      } else if (res.data && Array.isArray(res.data)) {
        deptList = res.data;
      } else if (res.departments && Array.isArray(res.departments)) {
        deptList = res.departments;
      }

      if (deptList.length === 0) {
        setDeptError("No departments found. Please create departments first.");
      }

      setDepartments(deptList);
    } catch (error) {
      console.error("❌ Department load error:", error);
      setDeptError(error.message || "Failed to load departments");
    } finally {
      setLoadingDepts(false);
    }
  };

  useEffect(() => {
    loadDepartments();
  }, []);

  const updateField = (path, value) => {
    setForm((prev) => {
      const next = structuredClone(prev);
      let ref = next;
      const parts = path.split(".");
      for (let i = 0; i < parts.length - 1; i++) {
        ref = ref[parts[i]];
      }
      ref[parts[parts.length - 1]] = value;
      return next;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(form);
  };

  const deptOptions = departments.map((d) => ({
    label: d.departmentName || d.name || "Unnamed",
    value: d._id,
  }));

  return (
    <form onSubmit={handleSubmit}>
      {deptError && (
        <Message severity="warn" text={deptError} className="mb-3 w-full" />
      )}

      {/* Personal Info */}
      <div className="grid">
        <div className="col-12 md:col-6 mb-3">
          <span className="p-float-label">
            <InputText
              id="firstName"
              value={form.personalInfo.firstName}
              onChange={(e) =>
                updateField("personalInfo.firstName", e.target.value)
              }
              className="w-full"
              required
            />
            <label htmlFor="firstName">First Name *</label>
          </span>
        </div>

        <div className="col-12 md:col-6 mb-3">
          <span className="p-float-label">
            <InputText
              id="lastName"
              value={form.personalInfo.lastName}
              onChange={(e) =>
                updateField("personalInfo.lastName", e.target.value)
              }
              className="w-full"
              required
            />
            <label htmlFor="lastName">Last Name *</label>
          </span>
        </div>
      </div>

      {/* Contact Info */}
      <div className="grid">
        <div className="col-12 md:col-4 mb-3">
          <span className="p-float-label">
            <Dropdown
              inputId="gender"
              value={form.personalInfo.gender}
              options={genderOptions}
              onChange={(e) => updateField("personalInfo.gender", e.value)}
              className="w-full"
              required
            />
            <label htmlFor="gender">Gender *</label>
          </span>
        </div>

        <div className="col-12 md:col-4 mb-3">
          <span className="p-float-label">
            <InputText
              id="mobile"
              value={form.contact.mobileNumber}
              onChange={(e) =>
                updateField("contact.mobileNumber", e.target.value)
              }
              maxLength={10}
              className="w-full"
              required
            />
            <label htmlFor="mobile">Mobile Number *</label>
          </span>
        </div>

        <div className="col-12 md:col-4 mb-3">
          <span className="p-float-label">
            <InputText
              id="email"
              type="email"
              value={form.contact.email}
              onChange={(e) => updateField("contact.email", e.target.value)}
              className="w-full"
              required
            />
            <label htmlFor="email">Email *</label>
          </span>
        </div>
      </div>

      {/* Professional Info */}
      <div className="grid">
        <div className="col-12 md:col-4 mb-3">
          <span className="p-float-label">
            <Dropdown
              inputId="specialization"
              value={form.professional.specialization}
              options={specializationOptions}
              onChange={(e) =>
                updateField("professional.specialization", e.value)
              }
              filter
              className="w-full"
              required
            />
            <label htmlFor="specialization">Specialization *</label>
          </span>
        </div>

        <div className="col-12 md:col-4 mb-3">
          <span className="p-float-label">
            <InputNumber
              inputId="experience"
              value={form.professional.experience}
              onValueChange={(e) =>
                updateField("professional.experience", e.value || 0)
              }
              min={0}
              className="w-full"
            />
            <label htmlFor="experience">Experience (Years)</label>
          </span>
        </div>

        <div className="col-12 md:col-4 mb-3">
          <span className="p-float-label">
            <InputText
              id="regNo"
              value={form.professional.registrationNumber}
              onChange={(e) =>
                updateField("professional.registrationNumber", e.target.value)
              }
              className="w-full"
              required
            />
            <label htmlFor="regNo">Registration No. *</label>
          </span>
        </div>
      </div>

      {/* Department + Fees */}
      <div className="grid">
        <div className="col-12 md:col-4 mb-3">
          <span className="p-float-label">
            <Dropdown
              inputId="department"
              value={form.department}
              options={deptOptions}
              onChange={(e) => updateField("department", e.value)}
              filter
              disabled={loadingDepts || departments.length === 0}
              className="w-full"
              required
            />
            <label htmlFor="department">Department *</label>
          </span>
          {departments.length === 0 && !loadingDepts && (
            <small className="text-red-500 block mt-1">
              No departments available.
            </small>
          )}
        </div>

        <div className="col-12 md:col-4 mb-3">
          <span className="p-float-label">
            <InputNumber
              inputId="opdFee"
              value={form.consultationFee.opd}
              onValueChange={(e) =>
                updateField("consultationFee.opd", e.value || 0)
              }
              min={0}
              mode="currency"
              currency="INR"
              locale="en-IN"
              className="w-full"
            />
            <label htmlFor="opdFee">OPD Fee</label>
          </span>
        </div>

        <div className="col-12 md:col-4 mb-3">
          <span className="p-float-label">
            <InputNumber
              inputId="emergencyFee"
              value={form.consultationFee.emergency}
              onValueChange={(e) =>
                updateField("consultationFee.emergency", e.value || 0)
              }
              min={0}
              mode="currency"
              currency="INR"
              locale="en-IN"
              className="w-full"
            />
            <label htmlFor="emergencyFee">Emergency Fee</label>
          </span>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex justify-content-end gap-2 mt-3">
        <Button
          type="button"
          label="Cancel"
          severity="secondary"
          outlined
          onClick={() => onSubmit(null)}
          disabled={submitting}
        />
        <Button
          type="submit"
          label="Save"
          icon="pi pi-check"
          loading={submitting}
          disabled={loadingDepts || departments.length === 0}
        />
      </div>
    </form>
  );
};

export default DoctorForm;
