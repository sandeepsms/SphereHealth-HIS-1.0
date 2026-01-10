// src/pages/doctor/DoctorFormPage.jsx
import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Toast } from "primereact/toast";
import { Card } from "primereact/card";
import DoctorForm from "../../components/doctor/DoctorForm";
import { doctorService } from "../../Services/Doctor/doctorService";

const DoctorFormPage = () => {
  const navigate = useNavigate();
  const { doctorId } = useParams();
  const toast = useRef(null);

  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialValues, setInitialValues] = useState(null);

  const isEditMode = Boolean(doctorId);

  useEffect(() => {
    if (isEditMode) {
      loadDoctor();
    }
  }, [doctorId]);

  const loadDoctor = async () => {
    try {
      setLoading(true);
      const response = await doctorService.getDoctorById(doctorId);
      console.log("📄 Doctor response:", response);

      const doctor = response.data || response;
      console.log("👨‍⚕️ Doctor data:", doctor);
      console.log("🏥 Department data:", doctor.department);

      // ⭐ Make sure department is just the ID string
      const formattedDoctor = {
        ...doctor,
        department:
          typeof doctor.department === "object"
            ? doctor.department._id
            : doctor.department,
      };

      console.log("📝 Formatted for form:", formattedDoctor);
      setInitialValues(formattedDoctor);
    } catch (error) {
      console.error("Failed to load doctor:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load doctor details",
        life: 3000,
      });
      navigate("/doctors");
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = async (formData) => {
    console.log("🎯 Form submitted with data:", formData);

    // User cancelled
    if (!formData) {
      navigate("/doctors");
      return;
    }

    try {
      setSubmitting(true);

      if (isEditMode) {
        await doctorService.updateDoctor(doctorId, formData);

        toast.current.show({
          severity: "success",
          summary: "Success",
          detail: "Doctor updated successfully",
          life: 3000,
        });
      } else {
        await doctorService.createDoctor(formData);

        toast.current.show({
          severity: "success",
          summary: "Success",
          detail: "Doctor created successfully",
          life: 3000,
        });
      }

      console.log("✅ Doctor saved successfully!");

      // Wait for toast to show, then redirect
      setTimeout(() => {
        navigate("/doctors");
      }, 1500);
    } catch (error) {
      console.error("❌ Failed to save doctor:", error);

      // Extract user-friendly error message
      let errorMessage = "Failed to save doctor";

      if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.data?.errors) {
        // Multiple validation errors
        errorMessage = error.response.data.errors.join(", ");
      } else if (error.message) {
        errorMessage = error.message;
      }

      // ⭐ Show detailed error toast
      toast.current.show({
        severity: "error",
        summary: "Error",
        detail: errorMessage,
        life: 5000, // Show longer for error messages
      });

      setSubmitting(false);
    }
  };

  return (
    <div className="p-4">
      <Toast ref={toast} position="top-right" />

      <div className="max-w-6xl mx-auto">
        <Card
          title={isEditMode ? "Edit Doctor" : "Add New Doctor"}
          className="shadow-lg"
        >
          {loading ? (
            <div className="p-4 text-center">
              <i
                className="pi pi-spin pi-spinner"
                style={{ fontSize: "2rem" }}
              />
              <p className="mt-2">Loading doctor details...</p>
            </div>
          ) : (
            <DoctorForm
              initialValues={initialValues}
              onSubmit={handleFormSubmit}
              submitting={submitting}
            />
          )}
        </Card>
      </div>
    </div>
  );
};

export default DoctorFormPage;
