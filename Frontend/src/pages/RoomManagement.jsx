import React, { useEffect, useMemo, useRef, useState } from "react";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";

import RoomForm from "../Components/room/RoomForm";
import RoomVisualLayout from "../Components/room/Roomvisuallayout";
import BedSectionHeader from "../Components/bed/BedSectionHeader";
import {
  BmStatStrip, BmCard, BmFilter, BmEmpty, BmPill, BmIconBtn,
  BmBar, BmDots, BmAvatar, BmCellStack, BmChip,
} from "../Components/bed/BedPrimitives";
import { roomService } from "../Services/roomService";
import { bedService }  from "../Services/bedService";

const TABS = [
  { key: "table",  icon: "pi pi-table",   label: "Table" },
  { key: "cards",  icon: "pi pi-th-large",label: "Cards" },
  { key: "visual", icon: "pi pi-sitemap", label: "Visual" },
];

const STATUS_TONE = {
  Active:               "ok",
  Inactive:             "neutral",
  "Under Maintenance":  "warn",
  Blocked:              "danger",
};

const RoomManagement = () => {
  const toast = useRef(null);
  const [viewMode, setViewMode] = useState("table");
  const [showForm, setShowForm] = useState(false);
  const [selRoom, setSelRoom]   = useState(null);
  const [refresh, setRefresh]   = useState(0);
  const [filter, setFilter]     = useState("");
  const [rooms, setRooms]       = useState([]);
  const [beds, setBeds]         = useState([]);   // for live occupancy
  const [loading, setLoading]   = useState(false);

  /* Parallel fetch rooms + beds. Room.occupiedBeds in Mongo can be
     stale; we derive real per-room status from the bed list so the
     UI doesn't lie. */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      roomService.getAllRooms().catch(() => []),
      bedService.getAllBeds().catch(() => []),
    ])
      .then(([rd, bd]) => {
        if (cancelled) return;
        const roomArr = Array.isArray(rd) ? rd : rd?.data || rd?.rooms || [];
        const bedArr  = Array.isArray(bd) ? bd : bd?.data || bd?.beds  || [];
        setRooms(roomArr);
        setBeds(bedArr);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refresh]);

  /* Real per-room occupancy derived from the bed list. */
  const liveByRoom = useMemo(() => {
    const map = {};
    for (const b of beds) {
      const rid = (b.room && (b.room._id || b.room.$oid)) || b.room || b.roomId;
      const key = String(rid || "");
      if (!key) continue;
      const acc = map[key] || { total: 0, occ: 0, avail: 0 };
      acc.total += 1;
      if (b.status === "Occupied")  acc.occ   += 1;
      if (b.status === "Available") acc.avail += 1;
      map[key] = acc;
    }
    return map;
  }, [beds]);

  const liveFor = (r) => {
    const id = String(r?._id?.$oid || r?._id || "");
    return liveByRoom[id] || { total: Number(r.totalBeds) || 0, occ: 0, avail: Number(r.totalBeds) || 0 };
  };

  /* ── Aggregates ── */
  const stats = useMemo(() => {
    const totalBeds     = beds.length || rooms.reduce((s, r) => s + (Number(r.totalBeds) || 0), 0);
    const occupiedBeds  = beds.filter(b => b.status === "Occupied").length;
    const availableBeds = beds.filter(b => b.status === "Available").length;
    const active        = rooms.filter(r => r.status === "Active" || r.isActive !== false).length;
    return [
      { key: "total",     label: "Rooms",          value: rooms.length,  icon: "pi-box",          tone: "purple" },
      { key: "active",    label: "Active",         value: active,        icon: "pi-check-circle", tone: "green"  },
      { key: "beds",      label: "Beds (sum)",     value: totalBeds,     icon: "pi-th-large",     tone: "blue"   },
      { key: "occupied",  label: "Occupied beds",  value: occupiedBeds,  icon: "pi-user",         tone: "red"    },
      { key: "available", label: "Available beds", value: availableBeds, icon: "pi-bookmark",     tone: "amber"  },
    ];
  }, [rooms]);

  /* ── Filtered rows ── */
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(r =>
      (r.roomNumber || "").toLowerCase().includes(q) ||
      (r.roomName   || "").toLowerCase().includes(q) ||
      (r.roomCode   || "").toLowerCase().includes(q) ||
      (r.ward?.wardName || r.wardName || "").toLowerCase().includes(q) ||
      (r.status     || "").toLowerCase().includes(q)
    );
  }, [rooms, filter]);

  const handleSave = () => {
    setShowForm(false); setSelRoom(null);
    setRefresh(r => r + 1);
    toast.current?.show({ severity: "success", summary: "Saved", detail: "Room saved", life: 2500 });
  };

  const handleDelete = (r) => {
    confirmDialog({
      message: `Delete room "${r.roomName || r.roomNumber}"?`,
      header: "Confirmation",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await roomService.deleteRoom(r._id);
          toast.current?.show({ severity: "success", summary: "Deleted", detail: "Room removed", life: 2500 });
          setRefresh(x => x + 1);
        } catch {
          toast.current?.show({ severity: "error", summary: "Error", detail: "Failed to delete room", life: 3000 });
        }
      },
    });
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
                <button key={t.key} onClick={() => setViewMode(t.key)}
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
              <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} /> Refresh
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

      {viewMode === "visual" ? (
        <BmCard title="Visual Layout" icon="pi-sitemap" count={rooms.length}>
          <div style={{ padding: 12 }}>
            <RoomVisualLayout onEdit={(r) => { setSelRoom(r); setShowForm(true); }} onRefresh={refresh} />
          </div>
        </BmCard>
      ) : (
        <BmCard
          title="Configured Rooms"
          icon="pi-box"
          count={filtered.length === rooms.length ? rooms.length : `${filtered.length}/${rooms.length}`}
          action={<BmFilter value={filter} onChange={setFilter} placeholder="Search room name / code / ward…" />}
        >
          {loading ? (
            <BmEmpty icon="pi-spin pi-spinner" title="Loading rooms…" />
          ) : filtered.length === 0 ? (
            rooms.length === 0 ? (
              <BmEmpty icon="pi-box" title="No rooms yet"
                msg="Rooms sit between a ward and the beds inside it."
                ctaLabel="Add Room" ctaIcon="pi-plus"
                onCta={() => { setSelRoom(null); setShowForm(true); }} />
            ) : (
              <BmEmpty icon="pi-search" title="No matches" msg="Try a different search term." />
            )
          ) : viewMode === "cards" ? (
            <div style={{ padding: 14, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {filtered.map(r => {
                const live      = liveFor(r);
                const totalBeds = live.total || Number(r.totalBeds) || 0;
                const occ       = live.occ;
                const avail     = live.avail;
                return (
                  <div key={r._id} className="bm-grid-card bm-grid-card--purple">
                    <div className="bm-grid-card__head">
                      <BmAvatar icon="pi-box" tone="purple" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="bm-grid-card__title">{r.roomNumber || r.roomName}</div>
                        <div className="bm-grid-card__sub">
                          {r.ward?.wardName || r.wardName || "—"} · {r.roomCode || "—"}
                        </div>
                      </div>
                      <BmPill tone={STATUS_TONE[r.status] || "info"}>{r.status || "Active"}</BmPill>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
                      <BmBar value={occ} max={totalBeds} showLabel width={120} />
                      <span style={{ fontSize: 11, fontWeight: 800, color: "#16a34a" }}>{avail} free</span>
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <BmDots breakdown={{ occ, avail }} maxDots={20} />
                    </div>

                    <div className="bm-row-actions" style={{ justifyContent: "flex-end", marginTop: 10 }}>
                      <BmIconBtn icon="pi-pencil" variant="info"   title="Edit"
                        onClick={() => { setSelRoom(r); setShowForm(true); }} />
                      <BmIconBtn icon="pi-trash"  variant="danger" title="Delete"
                        onClick={() => handleDelete(r)} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="bm-table">
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Ward / Location</th>
                    <th>Beds</th>
                    <th>Occupancy</th>
                    <th>Status</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const live      = liveFor(r);
                    const totalBeds = live.total || Number(r.totalBeds) || 0;
                    const occ       = live.occ;
                    const avail     = live.avail;
                    return (
                      <tr key={r._id}>
                        <td>
                          <BmCellStack
                            avatar={<BmAvatar icon="pi-box" tone="purple" />}
                            title={r.roomNumber || r.roomName}
                            sub={r.roomCode || "—"}
                          />
                        </td>
                        <td>
                          <div>{r.ward?.wardName || r.wardName || "—"}</div>
                          <div className="muted">{r.floor?.floorName || r.floorName || ""}</div>
                        </td>
                        <td>
                          <BmDots breakdown={{ occ, avail }} maxDots={12} />
                          <div className="muted" style={{ marginTop: 4 }}>
                            {totalBeds} bed{totalBeds === 1 ? "" : "s"} · {avail} free
                          </div>
                        </td>
                        <td>
                          <BmBar value={occ} max={totalBeds} showLabel width={100} />
                        </td>
                        <td><BmPill tone={STATUS_TONE[r.status] || "info"}>{r.status || "Active"}</BmPill></td>
                        <td className="right">
                          <div className="bm-row-actions">
                            <BmIconBtn icon="pi-pencil" variant="info"   title="Edit"
                              onClick={() => { setSelRoom(r); setShowForm(true); }} />
                            <BmIconBtn icon="pi-trash"  variant="danger" title="Delete"
                              onClick={() => handleDelete(r)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
