import React, { useState, useEffect, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Toast } from "primereact/toast";
import { Card } from "primereact/card";
import { Tag } from "primereact/tag";
import { useNavigate } from "react-router-dom";
import patientService from "../../Services/patient/patientService";

const PatientList = () => {
  const navigate = useNavigate();
  const toast = useRef(null);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalFilter, setGlobalFilter] = useState("");
  const [first, setFirst] = useState(0);
  const [rows, setRows] = useState(10);

  useEffect(() => {
    loadPatients();
  }, []);

  const loadPatients = async () => {
    setLoading(true);
    try {
      const response = await patientService.getAllPatients();
      const data = response.data.data || response.data;
      setPatients(Array.isArray(data) ? data : data.patients || []);
    } catch (error) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load patients",
      });
    } finally {
      setLoading(false);
    }
  };

  const searchPatients = async (searchTerm) => {
    if (!searchTerm || searchTerm.trim() === "") {
      loadPatients();
      return;
    }

    setLoading(true);
    try {
      const response = await patientService.searchPatients(searchTerm);
      setPatients(response.data.data || []);
    } catch (error) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Search failed",
      });
    } finally {
      setLoading(false);
    }
  };

  const actionTemplate = (rowData) => {
    return (
      <div className="flex gap-2">
        <Button
          icon="pi pi-eye"
          rounded
          outlined
          className="p-button-sm"
          onClick={() => navigate(`/patients/${rowData._id}`)}
          tooltip="View Details"
        />
        <Button
          icon="pi pi-pencil"
          rounded
          outlined
          severity="info"
          className="p-button-sm"
          onClick={() => navigate(`/patients/edit/${rowData._id}`)}
          tooltip="Edit"
        />
        <Button
          icon="pi pi-clipboard"
          rounded
          outlined
          severity="success"
          className="p-button-sm"
          onClick={() => navigate(`/opd/new?patientId=${rowData._id}`)}
          tooltip="New OPD"
        />
      </div>
    );
  };

  const genderTemplate = (rowData) => {
    const color =
      rowData.gender === "Male"
        ? "info"
        : rowData.gender === "Female"
        ? "danger"
        : "warning";
    return <Tag value={rowData.gender} severity={color} />;
  };

  const bloodGroupTemplate = (rowData) => {
    return rowData.bloodGroup ? (
      <Tag value={rowData.bloodGroup} severity="danger" />
    ) : (
      "-"
    );
  };

  const header = (
    <div className="flex justify-content-between align-items-center">
      <h2 style={{ margin: 0 }}>Patients</h2>
      <div className="flex gap-2">
        <span className="p-input-icon-left">
          <i className="pi pi-search" />
          <InputText
            placeholder="Search by Name, UHID, Contact..."
            value={globalFilter}
            onChange={(e) => {
              setGlobalFilter(e.target.value);
              searchPatients(e.target.value);
            }}
            style={{ width: "300px" }}
          />
        </span>
        <Button
          label="Register New Patient"
          icon="pi pi-plus"
          onClick={() => navigate("/patients/new")}
        />
      </div>
    </div>
  );

  return (
    <div style={{ marginTop: "20px" }}>
      <Toast ref={toast} />
      <Card>
        <DataTable
          value={patients}
          loading={loading}
          header={header}
          paginator
          rows={rows}
          first={first}
          onPage={(e) => {
            setFirst(e.first);
            setRows(e.rows);
          }}
          rowsPerPageOptions={[10, 25, 50]}
          emptyMessage="No patients found"
          className="p-datatable-sm"
        >
          <Column
            field="UHID"
            header="UHID"
            sortable
            style={{ minWidth: "120px" }}
          />
          <Column
            field="fullName"
            header="Name"
            sortable
            style={{ minWidth: "200px" }}
          />
          <Column
            field="age"
            header="Age/Gender"
            body={(row) => `${row.age} / ${row.gender}`}
            sortable
            style={{ minWidth: "120px" }}
          />
          <Column
            field="gender"
            header="Gender"
            body={genderTemplate}
            sortable
            style={{ minWidth: "100px" }}
          />
          <Column
            field="bloodGroup"
            header="Blood Group"
            body={bloodGroupTemplate}
            style={{ minWidth: "120px" }}
          />
          <Column
            field="contactNumber"
            header="Contact"
            sortable
            style={{ minWidth: "140px" }}
          />
          <Column
            field="registrationDate"
            header="Registered"
            body={(row) => new Date(row.registrationDate).toLocaleDateString()}
            sortable
            style={{ minWidth: "120px" }}
          />
          <Column
            header="Actions"
            body={actionTemplate}
            style={{ minWidth: "200px" }}
            frozen
            alignFrozen="right"
          />
        </DataTable>
      </Card>
    </div>
  );
};

export default PatientList;
