// ============================================
// FILE: src/pages/BuildingManagement.jsx
// ============================================
import React, { useState, useEffect } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { Card } from "primereact/card";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import BuildingForm from "../Components/building/BuildingForm";
import BedSectionHeader from "../Components/bed/BedSectionHeader";
import { buildingService } from "../Services/buildingService";

const BuildingManagement = () => {
  const [buildings, setBuildings] = useState([]);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [globalFilter, setGlobalFilter] = useState("");
  const toast = React.useRef(null);

  useEffect(() => {
    loadBuildings();
  }, []);

  const loadBuildings = async () => {
    setLoading(true);
    try {
      const data = await buildingService.getAllBuildings();
      setBuildings(data);
    } catch (error) {
      toast.current.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load buildings",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (building) => {
    setSelectedBuilding(building);
    setShowForm(true);
  };

  const handleDelete = (building) => {
    confirmDialog({
      message: `Are you sure you want to delete building ${building.buildingName}?`,
      header: "Confirmation",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await buildingService.deleteBuilding(building._id);
          toast.current.show({
            severity: "success",
            summary: "Success",
            detail: "Building deleted successfully",
          });
          loadBuildings();
        } catch (error) {
          toast.current.show({
            severity: "error",
            summary: "Error",
            detail: "Failed to delete building",
          });
        }
      },
    });
  };

  const statusBodyTemplate = (rowData) => {
    return (
      <Tag
        value={rowData.isActive ? "Active" : "Inactive"}
        severity={rowData.isActive ? "success" : "danger"}
      />
    );
  };

  const actionBodyTemplate = (rowData) => {
    return (
      <div className="flex gap-2">
        <Button
          icon="pi pi-pencil"
          className="p-button-rounded p-button-success"
          onClick={() => handleEdit(rowData)}
        />
        <Button
          icon="pi pi-trash"
          className="p-button-rounded p-button-danger"
          onClick={() => handleDelete(rowData)}
        />
      </div>
    );
  };

  const header = (
    <div className="flex flex-wrap gap-2 align-items-center justify-content-between">
      <span className="p-input-icon-left">
        <i className="pi pi-search" />
        <InputText
          type="search"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search buildings..."
        />
      </span>
    </div>
  );

  return (
    <div style={{ padding: 20, background: "#f1f5f9", minHeight: "100vh" }}>
      <Toast ref={toast} />
      <ConfirmDialog />

      <BedSectionHeader
        title="Buildings"
        subtitle={`${buildings.length} building${buildings.length === 1 ? "" : "s"} configured · top of the hierarchy`}
        icon="pi-building"
        actions={
          <Button icon="pi pi-plus" label="Add Building"
            onClick={() => { setSelectedBuilding(null); setShowForm(true); }}
            style={{
              background: "#fff", color: "#0e7490",
              border: "none", fontWeight: 700,
              borderRadius: 8, padding: "7px 16px", fontSize: 12,
              boxShadow: "0 2px 8px rgba(0,0,0,.13)",
            }} />
        }
      />

      <Card>
        <DataTable
          value={buildings}
          paginator
          rows={10}
          loading={loading}
          globalFilter={globalFilter}
          header={header}
          emptyMessage="No buildings found"
          responsiveLayout="scroll"
        >
          <Column field="buildingName" header="Building Name" sortable />
          <Column field="buildingCode" header="Building Code" sortable />
          <Column field="totalFloors" header="Total Floors" sortable />
          <Column field="address" header="Address" />
          <Column header="Status" body={statusBodyTemplate} sortable />
          <Column header="Actions" body={actionBodyTemplate} />
        </DataTable>
      </Card>

      <BuildingForm
        visible={showForm}
        onHide={() => setShowForm(false)}
        building={selectedBuilding}
        onSave={() => {
          loadBuildings();
          toast.current.show({
            severity: "success",
            summary: "Success",
            detail: "Building saved successfully",
          });
        }}
      />
    </div>
  );
};

export default BuildingManagement;
