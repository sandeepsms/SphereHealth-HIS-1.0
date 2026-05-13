import React, { useEffect, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Toast } from "primereact/toast";
import { ConfirmDialog } from "primereact/confirmdialog";
import { InputText } from "primereact/inputtext";

import RoomForm from "../Components/room/RoomForm";
import RoomList from "../Components/room/RoomList";
import RoomVisualLayout from "../Components/room/Roomvisuallayout";
import BedSectionHeader from "../Components/bed/BedSectionHeader";
import { roomService } from "../Services/roomService";

const TABS = [
  { key: "table", icon: "pi pi-table", label: "Table View" },
  { key: "visual", icon: "pi pi-sitemap", label: "Visual Layout" },
];

const RoomManagement = () => {
  const toast = useRef(null);
  const [viewMode, setViewMode] = useState("table");
  const [showForm, setShowForm] = useState(false);
  const [selRoom, setSelRoom] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [globalFilter, setGlobalFilter] = useState("");

  const handleEdit = (room) => {
    setSelRoom(room);
    setShowForm(true);
  };
  const handleSave = () => {
    setShowForm(false);
    setSelRoom(null);
    setRefresh((r) => r + 1);
    toast.current?.show({
      severity: "success",
      summary: "Success",
      detail: "Room saved successfully",
      life: 3000,
    });
  };

  return (
    <div style={{ padding: 20, background: "#f1f5f9", minHeight: "100vh" }}>
      <Toast ref={toast} />
      <ConfirmDialog />

      <BedSectionHeader
        title="Rooms"
        subtitle="Configure rooms under each ward — table / visual views"
        icon="pi-box"
        actions={
          <>
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
                      color: active ? "#5b21b6" : "rgba(255,255,255,.9)",
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
                <InputText placeholder="Search rooms…" value={globalFilter}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  style={{
                    paddingLeft: 30, width: 190,
                    background: "rgba(255,255,255,.18)",
                    border: "1px solid rgba(255,255,255,.3)",
                    borderRadius: 8, color: "#fff", fontSize: 12,
                  }} />
              </span>
            )}

            <Button icon="pi pi-plus" label="Add Room"
              onClick={() => { setSelRoom(null); setShowForm(true); }}
              style={{
                background: "#fff", color: "#5b21b6",
                border: "none", fontWeight: 700,
                borderRadius: 8, padding: "7px 16px", fontSize: 12,
                boxShadow: "0 2px 8px rgba(0,0,0,.13)",
              }} />
          </>
        }
      />

      {/* ── TABLE VIEW ── */}
      {viewMode === "table" && (
        <Card
          style={{ borderRadius: 12, boxShadow: "0 2px 12px rgba(0,0,0,.07)" }}
        >
          <RoomList
            onEdit={handleEdit}
            onRefresh={refresh}
            globalFilter={globalFilter}
          />
        </Card>
      )}

      {/* ── VISUAL LAYOUT ── */}
      {viewMode === "visual" && (
        <RoomVisualLayout onEdit={handleEdit} onRefresh={refresh} />
      )}

      {/* ── FORM DIALOG ── */}
      <RoomForm
        visible={showForm}
        room={selRoom}
        onHide={() => {
          setShowForm(false);
          setSelRoom(null);
        }}
        onSave={handleSave}
      />
    </div>
  );
};

export default RoomManagement;
