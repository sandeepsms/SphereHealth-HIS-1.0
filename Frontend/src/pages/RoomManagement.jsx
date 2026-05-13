import React, { useEffect, useMemo, useRef, useState } from "react";
import { Toast } from "primereact/toast";
import { ConfirmDialog } from "primereact/confirmdialog";

import RoomForm from "../Components/room/RoomForm";
import RoomList from "../Components/room/RoomList";
import RoomVisualLayout from "../Components/room/Roomvisuallayout";
import BedSectionHeader from "../Components/bed/BedSectionHeader";
import { BmStatStrip, BmCard, BmFilter, BmEmpty } from "../Components/bed/BedPrimitives";
import { roomService } from "../Services/roomService";

const TABS = [
  { key: "table",  icon: "pi pi-table",   label: "Table View" },
  { key: "visual", icon: "pi pi-sitemap", label: "Visual Layout" },
];

const RoomManagement = () => {
  const toast = useRef(null);
  const [viewMode, setViewMode] = useState("table");
  const [showForm, setShowForm] = useState(false);
  const [selRoom, setSelRoom]   = useState(null);
  const [refresh, setRefresh]   = useState(0);
  const [filter, setFilter]     = useState("");
  const [rooms, setRooms]       = useState([]);
  const [loadingStats, setLoadingStats] = useState(false);

  /* Aggregates snapshot — keeps RoomList free to render its own
     fetch+table while the page header shows totals. */
  useEffect(() => {
    let cancelled = false;
    setLoadingStats(true);
    roomService.getAllRooms()
      .then(d => {
        if (cancelled) return;
        const arr = Array.isArray(d) ? d : d?.data || d?.rooms || [];
        setRooms(arr);
      })
      .catch(() => { if (!cancelled) setRooms([]); })
      .finally(() => { if (!cancelled) setLoadingStats(false); });
    return () => { cancelled = true; };
  }, [refresh]);

  const stats = useMemo(() => {
    const totalBeds     = rooms.reduce((s, r) => s + (Number(r.totalBeds)     || 0), 0);
    const availableBeds = rooms.reduce((s, r) => s + (Number(r.availableBeds) || 0), 0);
    const occupiedBeds  = rooms.reduce((s, r) => s + (Number(r.occupiedBeds)  || 0), 0);
    const active        = rooms.filter(r => r.isActive !== false).length;
    return [
      { key: "total",     label: "Rooms",          value: rooms.length,  icon: "pi-box",          tone: "purple" },
      { key: "active",    label: "Active",         value: active,        icon: "pi-check-circle", tone: "green"  },
      { key: "beds",      label: "Beds (sum)",     value: totalBeds,     icon: "pi-th-large",     tone: "blue"   },
      { key: "occupied",  label: "Occupied beds",  value: occupiedBeds,  icon: "pi-user",         tone: "red"    },
      { key: "available", label: "Available beds", value: availableBeds, icon: "pi-bookmark",     tone: "amber"  },
    ];
  }, [rooms]);

  const handleEdit = (room) => { setSelRoom(room); setShowForm(true); };
  const handleSave = () => {
    setShowForm(false); setSelRoom(null);
    setRefresh(r => r + 1);
    toast.current?.show({ severity: "success", summary: "Saved", detail: "Room saved", life: 2500 });
  };

  return (
    <div className="bm-page">
      <Toast ref={toast} />
      <ConfirmDialog />

      <BedSectionHeader
        title="Rooms"
        subtitle={`${rooms.length} room${rooms.length === 1 ? "" : "s"} · sit between a ward and the beds inside`}
        icon="pi-box"
        actions={
          <>
            <div className="bm-tabs" style={{ background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.3)" }}>
              {TABS.map(t => (
                <button key={t.key}
                  onClick={() => setViewMode(t.key)}
                  className={viewMode === t.key ? "active" : ""}
                  style={{
                    color: viewMode === t.key ? "#5b21b6" : "rgba(255,255,255,.92)",
                    background: viewMode === t.key ? "#fff" : "transparent",
                  }}>
                  <i className={t.icon} /> {t.label}
                </button>
              ))}
            </div>
            <button onClick={() => setRefresh(r => r + 1)}
              style={{
                background: "rgba(255,255,255,.15)", color: "#fff",
                border: "1.5px solid rgba(255,255,255,.4)",
                fontWeight: 700, borderRadius: 8, padding: "7px 14px", fontSize: 12,
                cursor: "pointer", fontFamily: "inherit",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>
              <i className={`pi ${loadingStats ? "pi-spin pi-spinner" : "pi-refresh"}`} /> Refresh
            </button>
            <button onClick={() => { setSelRoom(null); setShowForm(true); }}
              style={{
                background: "#fff", color: "#5b21b6",
                border: "none", fontWeight: 700,
                borderRadius: 8, padding: "7px 16px", fontSize: 12,
                boxShadow: "0 2px 8px rgba(0,0,0,.13)",
                cursor: "pointer", fontFamily: "inherit",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>
              <i className="pi pi-plus" /> Add Room
            </button>
          </>
        }
      />

      <BmStatStrip stats={stats} />

      {viewMode === "table" && (
        <BmCard
          title="Configured Rooms"
          icon="pi-box"
          count={rooms.length}
          action={<BmFilter value={filter} onChange={setFilter} placeholder="Search rooms by name / code / ward…" />}
        >
          <div style={{ padding: 12 }}>
            <RoomList onEdit={handleEdit} onRefresh={refresh} globalFilter={filter} />
          </div>
        </BmCard>
      )}

      {viewMode === "visual" && (
        <BmCard title="Visual Layout" icon="pi-sitemap" count={rooms.length}>
          <div style={{ padding: 12 }}>
            <RoomVisualLayout onEdit={handleEdit} onRefresh={refresh} />
          </div>
        </BmCard>
      )}

      <RoomForm
        visible={showForm}
        room={selRoom}
        onHide={() => { setShowForm(false); setSelRoom(null); }}
        onSave={handleSave}
      />
    </div>
  );
};

export default RoomManagement;
