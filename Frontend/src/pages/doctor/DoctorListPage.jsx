// src/pages/doctor/DoctorListPage.jsx
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Tag } from "primereact/tag";
import { doctorService } from "../../Services/Doctor/doctorService";

const DoctorListPage = () => {
  const navigate = useNavigate();
  const toast = useRef(null);

  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [globalFilter, setGlobalFilter] = useState("");

  useEffect(() => {
    loadDoctors();
  }, []);

  const loadDoctors = async () => {
    try {
      setLoading(true);
      const data = await doctorService.getAllDoctors();
      console.log("📋 Doctors loaded:", data);
      setDoctors(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("❌ Failed to load doctors:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load doctors",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (doctorId) => {
    confirmDialog({
      message: "Are you sure you want to delete this doctor?",
      header: "Delete Confirmation",
      icon: "pi pi-exclamation-triangle",
      acceptClassName: "p-button-danger",
      accept: async () => {
        try {
          await doctorService.deleteDoctor(doctorId);
          toast.current?.show({
            severity: "success",
            summary: "Success",
            detail: "Doctor deleted successfully",
            life: 3000,
          });
          loadDoctors();
        } catch (error) {
          console.error("Failed to delete doctor:", error);
          toast.current?.show({
            severity: "error",
            summary: "Error",
            detail: "Failed to delete doctor",
            life: 3000,
          });
        }
      },
    });
  };

  const nameTemplate = (rowData) => {
    const fullName = `${rowData.personalInfo?.firstName || ""} ${
      rowData.personalInfo?.lastName || ""
    }`.trim();
    return fullName || "N/A";
  };

  const contactTemplate = (rowData) => {
    return (
      <div>
        <div>{rowData.contact?.mobileNumber || "N/A"}</div>
        <small className="text-gray-500">{rowData.contact?.email}</small>
      </div>
    );
  };

  const departmentTemplate = (rowData) => {
    return rowData.department?.departmentName || "N/A";
  };

  const specializationTemplate = (rowData) => {
    return rowData.professional?.specialization || "N/A";
  };

  const statusTemplate = (rowData) => {
    return (
      <Tag
        value={rowData.isActive ? "Active" : "Inactive"}
        severity={rowData.isActive ? "success" : "danger"}
      />
    );
  };

  const actionTemplate = (rowData) => {
    return (
      <div className="flex gap-2">
        <Button
          icon="pi pi-pencil"
          rounded
          text
          severity="info"
          onClick={() => navigate(`/doctors/${rowData._id}/edit`)}
          tooltip="Edit"
          style={{
            borderColor: "#blue",
            color: "#fff",
          }}
        />
        <Button
          icon="pi pi-trash"
          rounded
          text
          severity="danger"
          onClick={() => handleDelete(rowData._id)}
          tooltip="Delete"
        />
      </div>
    );
  };

  const header = (
    <div className="flex justify-content-between align-items-center">
      <h2 className="m-0">Doctor Management</h2>
      <div className="flex gap-2">
        <span className="p-input-icon-left">
          <i className="pi pi-search " />
          <InputText
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Search doctors..."
            className="pl-6"
          />
        </span>
        <Button
          label="Add Doctor"
          icon="pi pi-plus"
          onClick={() => navigate("/doctors/new")}
        />
      </div>
    </div>
  );

  return (
    <div className="p-4">
      <Toast ref={toast} />
      <ConfirmDialog />

      <DataTable
        value={doctors}
        loading={loading}
        header={header}
        globalFilter={globalFilter}
        emptyMessage="No doctors found"
        paginator
        rows={10}
        rowsPerPageOptions={[10, 25, 50]}
        tableStyle={{ minWidth: "60rem" }}
      >
        <Column field="doctorId" header="Doctor ID" sortable />
        <Column header="Name" body={nameTemplate} sortable />
        <Column header="Contact" body={contactTemplate} />
        <Column header="Department" body={departmentTemplate} sortable />
        <Column
          header="Specialization"
          body={specializationTemplate}
          sortable
        />
        <Column
          field="professional.experience"
          header="Experience"
          sortable
          body={(row) => `${row.professional?.experience || 0} years`}
        />
        <Column header="Status" body={statusTemplate} sortable />
        <Column header="Actions" body={actionTemplate} />
      </DataTable>
    </div>
  );
};

export default DoctorListPage;
