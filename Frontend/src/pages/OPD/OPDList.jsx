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
import opdService from "../../Services/patient/opdService";

const OPDList = () => {
  const navigate = useNavigate();
  const toast = useRef(null);

  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalFilterValue, setGlobalFilterValue] = useState("");
  const [filters, setFilters] = useState({
    global: { value: null, matchMode: FilterMatchMode.CONTAINS },
  });

  useEffect(() => {
    loadOPDVisits();
  }, []);

  const loadOPDVisits = async () => {
    setLoading(true);
    try {
      const response = await opdService.getAllOPDVisits();

      // RESPONSE NORMALIZATION
      // backend shapes handle: {data: [...]}, {data: {visits: [...] }}, [...]
      let data =
        response?.data?.data ||
        response?.data?.visits ||
        response?.data ||
        response;

      if (!Array.isArray(data)) {
        // agar pagination ke sath aya ho: { visits: [...], pagination: {...} }
        if (data?.visits && Array.isArray(data.visits)) {
          data = data.visits;
        } else {
          data = [];
        }
      }

      setVisits(data);
    } catch (error) {
      console.error("Error loading OPD visits:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: error?.response?.data?.message || "Failed to load OPD visits",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const onGlobalFilterChange = (e) => {
    const value = e.target.value;
    const _filters = { ...filters };
    _filters["global"].value = value;
    setFilters(_filters);
    setGlobalFilterValue(value);
  };

  const statusTemplate = (rowData) => {
    const severityMap = {
      Active: "warning",
      Completed: "success",
      Referred: "info",
    };
    return (
      <Tag
        value={rowData.status || "Active"}
        severity={severityMap[rowData.status] || "warning"}
      />
    );
  };

  const visitTypeTemplate = (rowData) => {
    const color = {
      "First Visit": "success",
      "Follow-up": "info",
      "Routine Checkup": "warning",
    };
    return (
      <Tag
        value={rowData.visitType || "First Visit"}
        severity={color[rowData.visitType] || "success"}
      />
    );
  };

  const visitDateTemplate = (row) => {
    if (!row.visitDate) return "";
    const d = new Date(row.visitDate);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString();
  };

  const departmentTemplate = (row) => {
    // agar department populated object hai
    if (row.department && typeof row.department === "object") {
      return row.department.departmentName || row.department.departmentCode;
    }
    // agar sirf string / code hai
    return row.department || "";
  };

  const actionTemplate = (rowData) => {
    return (
      <div className="flex gap-2">
        <Button
          icon="pi pi-eye"
          rounded
          outlined
          className="p-button-sm"
          onClick={() => navigate(`/opd/${rowData.visitNumber}`)}
          tooltip="View Details"
        />
        <Button
          icon="pi pi-pencil"
          rounded
          outlined
          severity="info"
          className="p-button-sm"
          onClick={() => navigate(`/opd/edit/${rowData.visitNumber}`)}
          tooltip="Edit"
        />
      </div>
    );
  };

  const header = (
    <div className="flex justify-content-between align-items-center">
      <h2 style={{ margin: 0 }}>OPD Visits</h2>
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
          value={visits}
          loading={loading}
          header={header}
          paginator
          rows={10}
          rowsPerPageOptions={[10, 25, 50]}
          filters={filters}
          globalFilterFields={[
            "visitNumber",
            "UHID",
            "consultantName",
            "department.departmentName",
            "department.departmentCode",
            "chiefComplaint",
          ]}
          emptyMessage="No OPD visits found"
          className="p-datatable-sm"
        >
          <Column
            field="visitNumber"
            header="Visit #"
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
            field="visitDate"
            header="Visit Date"
            body={visitDateTemplate}
            sortable
            style={{ minWidth: "120px" }}
          />
          <Column
            field="visitType"
            header="Type"
            body={visitTypeTemplate}
            sortable
            style={{ minWidth: "140px" }}
          />
          <Column
            field="consultantName"
            header="Doctor"
            sortable
            style={{ minWidth: "150px" }}
          />
          <Column
            header="Department"
            body={departmentTemplate}
            sortable
            style={{ minWidth: "150px" }}
          />
          <Column
            field="chiefComplaint"
            header="Chief Complaint"
            sortable
            style={{ minWidth: "200px" }}
          />
          <Column
            field="status"
            header="Status"
            body={statusTemplate}
            sortable
            style={{ minWidth: "120px" }}
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

export default OPDList;
