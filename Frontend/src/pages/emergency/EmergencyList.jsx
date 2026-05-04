import React, { useState, useEffect, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Toast } from "primereact/toast";
import { Card } from "primereact/card";
import { Tag } from "primereact/tag";
import { FilterMatchMode } from "primereact/api";
import { useNavigate } from "react-router-dom";
import emergencyService from "../../Services/patient/emergencyService";

const EmergencyList = () => {
  const navigate = useNavigate();
  const toast = useRef(null);
  const [emergencies, setEmergencies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalFilterValue, setGlobalFilterValue] = useState("");
  const [filters, setFilters] = useState({
    global: { value: null, matchMode: FilterMatchMode.CONTAINS },
  });

  useEffect(() => {
    loadEmergencies();
  }, []);

  const loadEmergencies = async () => {
    setLoading(true);
    try {
      const response = await emergencyService.getAllEmergencyVisits();
      setEmergencies(response.data.data || response.data || []);
    } catch (error) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load emergency cases",
      });
    } finally {
      setLoading(false);
    }
  };

  const onGlobalFilterChange = (e) => {
    const value = e.target.value;
    let _filters = { ...filters };
    _filters["global"].value = value;
    setFilters(_filters);
    setGlobalFilterValue(value);
  };

  const triageTemplate = (rowData) => {
    const severityMap = {
      Critical: "danger",
      Emergency: "danger",
      Urgent: "warning",
      "Semi-urgent": "info",
      "Non-urgent": "success",
    };
    return (
      <Tag
        value={rowData.triageCategory}
        severity={severityMap[rowData.triageCategory]}
      />
    );
  };

  const statusTemplate = (rowData) => {
    const severityMap = {
      Active: "danger",
      "Under Observation": "warning",
      Admitted: "info",
      Discharged: "success",
      Completed: "success",
    };
    return (
      <Tag value={rowData.status} severity={severityMap[rowData.status]} />
    );
  };

  const mlcTemplate = (rowData) => {
    return rowData.isMLC ? <Tag value="MLC" severity="danger" /> : "-";
  };

  const actionTemplate = (rowData) => {
    return (
      <div className="flex gap-2">
        <Button
          icon="pi pi-eye"
          rounded
          outlined
          className="p-button-sm"
          onClick={() => navigate(`/emergency/${rowData.emergencyNumber}`)}
          tooltip="View Details"
        />
        <Button
          icon="pi pi-pencil"
          rounded
          outlined
          severity="info"
          className="p-button-sm"
          onClick={() => navigate(`/emergency/edit/${rowData.emergencyNumber}`)}
          tooltip="Edit"
        />
      </div>
    );
  };

  const header = (
    <div className="flex justify-content-between align-items-center">
      <h2 style={{ margin: 0 }}>Emergency Cases</h2>
      <div className="flex gap-2">
        <span className="p-input-icon-left">
          <i className="pi pi-search" />
          <InputText
            value={globalFilterValue}
            onChange={onGlobalFilterChange}
            placeholder="Search..."
            style={{ width: "250px" }}
          />
        </span>
      </div>
    </div>
  );

  return (
    <div>
      <Toast ref={toast} />
      <Card>
        <DataTable
          value={emergencies}
          loading={loading}
          header={header}
          paginator
          rows={10}
          rowsPerPageOptions={[10, 25, 50]}
          filters={filters}
          globalFilterFields={[
            "emergencyNumber",
            "UHID",
            "consultantIncharge",
            "presentingComplaints",
          ]}
          emptyMessage="No emergency cases found"
          className="p-datatable-sm"
        >
          <Column
            field="emergencyNumber"
            header="ER #"
            sortable
            style={{ minWidth: "140px" }}
          />
          <Column
            field="UHID"
            header="UHID"
            sortable
            style={{ minWidth: "120px" }}
          />
          <Column
            field="arrivalDate"
            header="Arrival Time"
            body={(row) => new Date(row.arrivalDate).toLocaleString()}
            sortable
            style={{ minWidth: "160px" }}
          />
          <Column
            field="triageCategory"
            header="Triage"
            body={triageTemplate}
            sortable
            style={{ minWidth: "120px" }}
          />
          <Column
            field="arrivalMode"
            header="Arrival Mode"
            sortable
            style={{ minWidth: "120px" }}
          />
          <Column
            field="consultantIncharge"
            header="Consultant"
            sortable
            style={{ minWidth: "150px" }}
          />
          <Column
            field="presentingComplaints"
            header="Complaint"
            sortable
            style={{ minWidth: "200px" }}
          />
          <Column
            field="isMLC"
            header="MLC"
            body={mlcTemplate}
            sortable
            style={{ minWidth: "80px" }}
          />
          <Column
            field="status"
            header="Status"
            body={statusTemplate}
            sortable
            style={{ minWidth: "140px" }}
          />
          <Column
            header="Actions"
            body={actionTemplate}
            style={{ minWidth: "150px" }}
            frozen
            alignFrozen="right"
          />
        </DataTable>
      </Card>
    </div>
  );
};

export default EmergencyList;
