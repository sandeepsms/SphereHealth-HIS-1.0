import React, { useEffect, useRef, useState } from "react";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Toast } from "primereact/toast";
import { ConfirmDialog } from "primereact/confirmdialog";
import { InputText } from "primereact/inputtext";

import RoomForm from "../Components/room/RoomForm";
import RoomList from "../Components/room/RoomList";
import RoomVisualLayout from "../Components/room/Roomvisuallayout";
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

      {/* ── HEADER ── */}
      <div
        style={{
          background: "linear-gradient(135deg,#0891b2 0%,#0e7490 100%)",
          borderRadius: 12,
          padding: "14px 22px",
          marginBottom: 20,
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: "0 4px 18px rgba(8,145,178,.28)",
        }}
      >
        {/* Title */}
        <h2
          style={{
            margin: 0,
            color: "#fff",
            fontSize: 20,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
          }}
        >
          <i className="pi pi-building" /> Room Management
        </h2>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            background: "rgba(255,255,255,.15)",
            borderRadius: 9,
            padding: 3,
            gap: 3,
            flexShrink: 0,
          }}
        >
          {TABS.map(({ key, icon, label }) => {
            const active = viewMode === key;
            return (
              <button
                key={key}
                onClick={() => setViewMode(key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 16px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  transition: "all .18s",
                  background: active ? "#fff" : "transparent",
                  color: active ? "#0891b2" : "rgba(255,255,255,.88)",
                  boxShadow: active ? "0 2px 8px rgba(0,0,0,.14)" : "none",
                }}
              >
                <i className={icon} style={{ fontSize: 13 }} />
                {label}
              </button>
            );
          })}
        </div>

        {/* Search + Add */}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexShrink: 0,
            flexWrap: "wrap",
          }}
        >
          {viewMode === "table" && (
            <span
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              <i
                className="pi pi-search"
                style={{
                  position: "absolute",
                  left: 10,
                  color: "rgba(255,255,255,.7)",
                  fontSize: 13,
                  zIndex: 1,
                }}
              />
              <InputText
                placeholder="Search rooms…"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                style={{
                  paddingLeft: 32,
                  width: 200,
                  background: "rgba(255,255,255,.18)",
                  border: "1px solid rgba(255,255,255,.3)",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: 13,
                }}
              />
            </span>
          )}
          <Button
            icon="pi pi-plus"
            label="Add Room"
            onClick={() => {
              setSelRoom(null);
              setShowForm(true);
            }}
            style={{
              background: "#fff",
              color: "#0891b2",
              border: "none",
              fontWeight: 700,
              borderRadius: 8,
              padding: "8px 18px",
              boxShadow: "0 2px 8px rgba(0,0,0,.13)",
              display: "inline-flex",
              alignItems: "center",
              whiteSpace: "nowrap",
              cursor: "pointer",
            }}
          />
        </div>
      </div>

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
