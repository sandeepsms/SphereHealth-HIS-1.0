import React, { useEffect, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Column } from "primereact/column";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { DataTable } from "primereact/datatable";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { Toast } from "primereact/toast";

import BedForm from "../Components/bed/BedForm";
import BedBulkCreateDialog from "../Components/bed/BedBulkCreateDialog";
import BedSectionHeader from "../Components/bed/BedSectionHeader";
import BedStats from "../Components/bed/BedStats";
import BedVisualLayout from "../Components/bed/BedVisualLayout";
import { bedService } from "../Services/bedService";

/* ─────────────────────────────────────────────── */
const BedManagement = () => {
  const toast = useRef(null);

  const [beds, setBeds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [globalFilter, setGlobalFilter] = useState("");
  const [viewMode, setViewMode] = useState("table"); // "table" | "visual" | "stats"
  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [selectedBed, setSelectedBed] = useState(null);

  useEffect(() => {
    loadBeds();
  }, []);

  /* ── data ── */
  const loadBeds = async () => {
    setLoading(true);
    try {
      const data = await bedService.getAllBeds();
      setBeds(data || []);
    } catch {
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
    setSelectedBed(bed);
    setShowForm(true);
  };
  const handleSave = async () => {
    setShowForm(false);
    setSelectedBed(null);
    await loadBeds();
  };

  const handleDelete = (bed) =>
    confirmDialog({
      message: `Delete bed ${bed.bedNumber}?`,
      header: "Confirm Delete",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await bedService.deleteBed(bed._id);
          toast.current?.show({
            severity: "success",
            summary: "Deleted",
            detail: "Bed removed",
            life: 3000,
          });
          loadBeds();
        } catch {
          toast.current?.show({
            severity: "error",
            summary: "Error",
            detail: "Delete failed",
            life: 3000,
          });
        }
      },
    });

  /* ── column templates ── */
  const statusTpl = (r) => {
    const map = {
      Available: "success",
      Occupied: "danger",
      Maintenance: "warning",
      Blocked: "secondary",
      Reserved: "info",
    };
    return <Tag value={r.status} severity={map[r.status] || "secondary"} />;
  };

  const locationTpl = (r) => (
    <div style={{ fontSize: 13, lineHeight: 1.8 }}>
      <div>
        <strong>Building:</strong> {r.buildingName || "N/A"}
      </div>
      <div>
        <strong>Floor:</strong> {r.floorNumber || "N/A"}
      </div>
      <div>
        <strong>Ward:</strong> {r.wardName || "N/A"}
      </div>
      <div>
        <strong>Room:</strong> {r.roomNumber || "N/A"}
      </div>
    </div>
  );

  const actionTpl = (r) => (
    <div style={{ display: "flex", gap: 4 }}>
      <Button
        icon="pi pi-pencil"
        className="p-button-rounded p-button-text p-button-info"
        onClick={() => handleEdit(r)}
        tooltip="Edit"
        tooltipOptions={{ position: "top" }}
      />
      <Button
        icon="pi pi-trash"
        className="p-button-rounded p-button-text p-button-danger"
        onClick={() => handleDelete(r)}
        tooltip="Delete"
        tooltipOptions={{ position: "top" }}
      />
    </div>
  );

  /* ── view tab config ── */
  const TABS = [
    { key: "table", icon: "pi pi-table", label: "Table View" },
    { key: "visual", icon: "pi pi-th-large", label: "Visual Layout" },
    { key: "stats", icon: "pi pi-chart-bar", label: "Statistics" },
  ];

  /* ── render ── */
  return (
    <div style={{ padding: 20, background: "#f1f5f9", minHeight: "100vh" }}>
      <Toast ref={toast} />
      <ConfirmDialog />

      <BedSectionHeader
        title="Manage Beds"
        subtitle="Create, edit, status — table / visual / stats views"
        icon="pi-list"
        actions={
          <>
            {/* View-mode pills */}
            <div style={{ display: "flex", background: "rgba(255,255,255,.15)", borderRadius: 9, padding: 3, gap: 3 }}>
              {TABS.map(({ key, icon, label }) => {
                const active = viewMode === key;
                return (
                  <button key={key} onClick={() => setViewMode(key)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 13px", borderRadius: 6, border: "none",
                      cursor: "pointer", fontSize: 12, fontWeight: 700,
                      background: active ? "#fff" : "transparent",
                      color: active ? "#1e293b" : "rgba(255,255,255,.9)",
                      fontFamily: "inherit",
                    }}>
                    <i className={icon} style={{ fontSize: 12 }} /> {label}
                  </button>
                );
              })}
            </div>

            {viewMode === "table" && (
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                <i className="pi pi-search" style={{ position: "absolute", left: 10, color: "rgba(255,255,255,.7)", fontSize: 12, zIndex: 1 }} />
                <InputText
                  placeholder="Search beds…"
                  value={globalFilter}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  style={{
                    paddingLeft: 30, width: 200,
                    background: "rgba(255,255,255,.18)",
                    border: "1px solid rgba(255,255,255,.3)",
                    borderRadius: 8, color: "#fff", fontSize: 12,
                  }}
                />
              </span>
            )}

            <Button icon="pi pi-clone" label="Bulk Create"
              onClick={() => setShowBulk(true)}
              style={{
                background: "rgba(255,255,255,.15)", color: "#fff",
                border: "1.5px solid rgba(255,255,255,.4)",
                fontWeight: 700, borderRadius: 8, padding: "7px 14px", fontSize: 12,
              }} />

            <Button icon="pi pi-plus" label="Add New Bed"
              onClick={() => { setSelectedBed(null); setShowForm(true); }}
              style={{
                background: "#fff", color: "#1e293b",
                border: "none", fontWeight: 700,
                borderRadius: 8, padding: "7px 16px", fontSize: 12,
                boxShadow: "0 2px 8px rgba(0,0,0,.13)",
              }} />
          </>
        }
      />

      {/* ══ TABLE VIEW ══════════════════════════════════════════════════ */}
      {viewMode === "table" && (
        <Card
          style={{ borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,.07)" }}
        >
          <DataTable
            value={beds}
            loading={loading}
            paginator
            rows={10}
            rowsPerPageOptions={[5, 10, 25, 50]}
            globalFilter={globalFilter}
            emptyMessage="No beds found. Click 'Add New Bed' to create one."
            responsiveLayout="scroll"
            stripedRows
            showGridlines
          >
            <Column
              field="bedNumber"
              header="Bed Number"
              sortable
              style={{ fontWeight: 600, minWidth: 130 }}
            />
            <Column
              header="Location"
              body={locationTpl}
              style={{ minWidth: 200 }}
            />
            <Column
              header="Status"
              body={statusTpl}
              sortable
              field="status"
              style={{ minWidth: 120 }}
            />
            <Column header="Actions" body={actionTpl} style={{ width: 100 }} />
          </DataTable>
        </Card>
      )}

      {/* ══ VISUAL LAYOUT ═══════════════════════════════════════════════ */}
      {viewMode === "visual" && <BedVisualLayout onRefreshParent={loadBeds} />}

      {/* ══ STATISTICS ══════════════════════════════════════════════════ */}
      {viewMode === "stats" && <BedStats />}

      {/* ══ FORM DIALOG ═════════════════════════════════════════════════ */}
      <BedForm
        visible={showForm}
        bed={selectedBed}
        onHide={() => {
          setShowForm(false);
          setSelectedBed(null);
        }}
        onSave={handleSave}
      />

      {/* ══ BULK CREATE DIALOG (P2 #9) ══════════════════════════════════ */}
      <BedBulkCreateDialog
        visible={showBulk}
        onHide={() => setShowBulk(false)}
        onSaved={async (count) => {
          setShowBulk(false);
          await loadBeds();
          toast.current?.show({
            severity: "success",
            summary: "Bulk create",
            detail: `${count} bed(s) created`,
            life: 3000,
          });
        }}
      />
    </div>
  );
};

export default BedManagement;
