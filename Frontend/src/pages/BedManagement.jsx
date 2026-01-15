import React, { useEffect, useRef, useState } from "react";
import { Card } from "primereact/card";
import { Button } from "primereact/button";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";

import BedForm from "../components/bed/BedForm";
import BedStats from "../components/bed/BedStats";

import BedVisualLayout from "../components/bed/BedVisualLayout";


import { bedService } from "../services/bedService";

const BedManagement = () => {
  const toast = useRef(null);

  const [beds, setBeds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalFilter, setGlobalFilter] = useState("");
  const [viewMode, setViewMode] = useState("table");
  const [showForm, setShowForm] = useState(false);
  const [selectedBed, setSelectedBed] = useState(null);

  useEffect(() => {
    loadBeds();
  }, []);

  const loadBeds = async () => {
    setLoading(true);
    try {
      console.log("Loading beds...");
      const data = await bedService.getAllBeds();
      console.log("Beds loaded successfully:", data);
      console.log("Number of beds:", data.length);
      setBeds(data || []);
    } catch (error) {
      console.error("Error loading beds:", error);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load beds",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (bed) => {
    console.log("Editing bed:", bed);
    setSelectedBed(bed);
    setShowForm(true);
  };

  const handleDelete = (bed) => {
    confirmDialog({
      message: `Delete bed ${bed.bedNumber}?`,
      header: "Confirmation",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await bedService.deleteBed(bed._id);
          toast.current?.show({
            severity: "success",
            summary: "Deleted",
            detail: "Bed removed successfully",
            life: 3000,
          });
          loadBeds(); // Reload data
        } catch (error) {
          console.error("Error deleting bed:", error);
          toast.current?.show({
            severity: "error",
            summary: "Error",
            detail: "Delete failed",
            life: 3000,
          });
        }
      },
    });
  };

  const handleSave = async () => {
    console.log("=== HANDLE SAVE CALLED ===");

    // Close form first
    setShowForm(false);
    setSelectedBed(null);

    // Show success message
    toast.current?.show({
      severity: "success",
      summary: "Success",
      detail: "Bed saved successfully",
      life: 3000,
    });

    // Reload beds data
    console.log("Reloading beds after save...");
    await loadBeds();
    console.log("Beds reloaded");
  };

  /* ===================== Templates ===================== */

  const statusTemplate = (row) => {
    const map = {
      Available: "success",
      Occupied: "danger",
      Maintenance: "warning",
      Blocked: "secondary",
      Reserved: "info",
    };
    return <Tag value={row.status} severity={map[row.status] || "secondary"} />;
  };

  const pricingTemplate = (row) => `₹${row?.pricing?.perBedDailyRate || 0}`;

  const locationTemplate = (row) => (
    <div style={{ fontSize: "12px" }}>
      <div>
        <strong>Building:</strong> {row.buildingName || "N/A"}
      </div>
      <div>
        <strong>Floor:</strong> {row.floorNumber || "N/A"}
      </div>
      <div>
        <strong>Ward:</strong> {row.wardName || "N/A"}
      </div>
      <div>
        <strong>Room:</strong> {row.roomNumber || "N/A"}
      </div>
    </div>
  );

  const actionTemplate = (row) => (
    <div style={{ display: "flex", gap: "5px" }}>
      <Button
        icon="pi pi-pencil"
        className="p-button-rounded p-button-text p-button-info"
        onClick={() => handleEdit(row)}
        tooltip="Edit"
      />
      <Button
        icon="pi pi-trash"
        className="p-button-rounded p-button-text p-button-danger"
        onClick={() => handleDelete(row)}
        tooltip="Delete"
      />
    </div>
  );

  /* ===================== RENDER ===================== */

  return (
    <div style={{ padding: "20px" }}>
      <Toast ref={toast} />
      <ConfirmDialog />

      {/* HEADER */}
      <Card style={{ marginBottom: "20px" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "15px",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2
            style={{
              margin: 0,
              color: "#1e293b",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <i className="pi pi-th-large"></i>
            Bed Management
          </h2>

          <div style={{ display: "flex", gap: "10px" }}>
            <Button
              icon="pi pi-table"
              label="Table View"
              onClick={() => setViewMode("table")}
              style={{
                fontWeight: "bold",
                backgroundColor:
                  viewMode === "table" ? "#0891b2" : "transparent",
                color: viewMode === "table" ? "white" : "#0891b2",
                border: `2px solid #0891b2`,
              }}
            />
            <Button
              icon="pi pi-th-large"
              label="Visual Layout"
              onClick={() => setViewMode("visual")}
              style={{
                fontWeight: "bold",
                backgroundColor:
                  viewMode === "visual" ? "#0891b2" : "transparent",
                color: viewMode === "visual" ? "white" : "#0891b2",
                border: `2px solid #0891b2`,
              }}
            />
            <Button
              icon="pi pi-chart-bar"
              label="Statistics"
              onClick={() => setViewMode("stats")}
              style={{
                fontWeight: "bold",
                backgroundColor:
                  viewMode === "stats" ? "#f59e0b" : "transparent",
                color: viewMode === "stats" ? "white" : "#f59e0b",
                border: `2px solid #f59e0b`,
              }}
            />
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {viewMode === "table" && (
              <span className="p-input-icon-left">
                <i className="pi pi-search" />
                <InputText
                  placeholder="Search beds..."
                  value={globalFilter}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  style={{ width: "250px" }}
                />
              </span>
            )}

            <Button
              icon="pi pi-plus"
              label="Add New Bed"
              onClick={() => {
                console.log("Add New Bed clicked");
                setSelectedBed(null);
                setShowForm(true);
              }}
              style={{
                fontWeight: "bold",
                backgroundColor: "#0891b2",
                border: "none",
                color: "white",
              }}
            />
          </div>
        </div>
      </Card>

      {/* Table View */}
      {viewMode === "table" && (
        <Card title="All Beds">
          <DataTable
            value={beds}
            loading={loading}
            paginator
            rows={10}
            rowsPerPageOptions={[5, 10, 25, 50]}
            globalFilter={globalFilter}
            emptyMessage="No Beds Found. Click 'Add New Bed' To Create One."
            responsiveLayout="scroll"
            stripedRows
            showGridlines
          >
            <Column
              field="bedNumber"
              header="Bed Number"
              sortable
              style={{ fontWeight: "bold" }}
            />
            <Column header="Location" body={locationTemplate} />
            <Column
              header="Status"
              body={statusTemplate}
              sortable
              field="status"
            />
            <Column header="Daily Rate" body={pricingTemplate} sortable />
            <Column
              header="Actions"
              body={actionTemplate}
              style={{ width: "120px" }}
            />
          </DataTable>
        </Card>
      )}

      {/* Visual Layout */}
      {viewMode === "visual" && (
        <div>
          <BedVisualLayout onBedClick={handleEdit} />
        </div>
      )}

      {/* Statistics */}
      {viewMode === "stats" && (
        <div>
          <BedStats />
        </div>
      )}

      {/* Bed Form */}
      <BedForm
        visible={showForm}
        bed={selectedBed}
        onHide={() => {
          console.log("Form hidden");
          setShowForm(false);
          setSelectedBed(null);
        }}
        onSave={handleSave}
      />
    </div>
  );
};

export default BedManagement;
