import React, { useEffect, useMemo, useRef, useState } from "react";
import { Toast } from "primereact/toast";

import FloorList from "../Components/floor/FloorList";
import FloorForm from "../Components/floor/FloorForm";
import BedSectionHeader from "../Components/bed/BedSectionHeader";
import {
  BmStatStrip, BmCard, BmFilter, BmEmpty, BmPill, BmIconBtn,
  BmAvatar, BmChip,
} from "../Components/bed/BedPrimitives";
import { floorService } from "../Services/floorService";
import { confirm } from "../Components/common/ConfirmDialog";

const TABS = [
  { key: "list", icon: "pi pi-list",     label: "List" },
  { key: "card", icon: "pi pi-th-large", label: "Cards" },
];

const FloorManagement = () => {
  const toast = useRef(null);
  const [floors, setFloors] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedFloor, setSelectedFloor] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView]    = useState("list");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const loadFloors = async () => {
    setLoading(true);
    try {
      const data = await floorService.getAllFloors();
      const arr = Array.isArray(data) ? data : data?.data || data?.floors || [];
      setFloors(arr);
    } catch {
      toast.current?.show({ severity: "error", summary: "Error", detail: "Failed to load floors", life: 3000 });
    } finally { setLoading(false); }
  };

  useEffect(() => { loadFloors(); }, [refreshKey]);

  const handleEdit = (floor) => { setSelectedFloor(floor); setShowForm(true); };
  const handleAdd  = () => { setSelectedFloor(null); setShowForm(true); };
  const handleDelete = async (floor) => {
    // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
    if (!(await confirm({
      title: "Delete floor?",
      body: `Floor "${floor.floorName || floor.floorNumber}" will be removed. Any wards/rooms beneath it must be reassigned first.`,
      danger: true,
      confirmLabel: "Delete",
    }))) return;
    try {
      await floorService.deleteFloor(floor._id);
      toast.current?.show({ severity: "success", summary: "Deleted", detail: "Floor removed", life: 2500 });
      loadFloors();
    } catch {
      toast.current?.show({ severity: "error", summary: "Error", detail: "Failed to delete floor", life: 3000 });
    }
  };

  const stats = useMemo(() => {
    const active = floors.filter(f => f.isActive !== false).length;
    const buildings = new Set(floors.map(f => f.building?._id || f.building).filter(Boolean));
    return [
      { key: "total",     label: "Floors",        value: floors.length,   icon: "pi-arrows-v",     tone: "amber"  },
      { key: "active",    label: "Active",        value: active,          icon: "pi-check-circle", tone: "green"  },
      { key: "buildings", label: "Across",        value: buildings.size,  icon: "pi-building",     tone: "blue"   },
    ];
  }, [floors]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return floors;
    return floors.filter(f =>
      (f.floorName || "").toLowerCase().includes(q) ||
      String(f.floorNumber || "").toLowerCase().includes(q) ||
      (f.building?.buildingName || f.buildingName || "").toLowerCase().includes(q)
    );
  }, [floors, filter]);

  return (
    <div className="bm-page">
      <Toast ref={toast} />

      <BedSectionHeader
        title="Floors"
        subtitle={`${floors.length} floor${floors.length === 1 ? "" : "s"} configured across ${stats[2].value} building${stats[2].value === 1 ? "" : "s"}`}
        icon="pi-arrows-v"
        actions={
          <>
            <div className="bm-tabs" style={{ background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.3)" }}>
              {TABS.map(t => (
                <button key={t.key} onClick={() => setView(t.key)}
                  className={view === t.key ? "active" : ""}
                  style={{
                    color: view === t.key ? "#9a3412" : "rgba(255,255,255,.92)",
                    background: view === t.key ? "#fff" : "transparent",
                  }}>
                  <i className={t.icon} /> {t.label}
                </button>
              ))}
            </div>
            <button onClick={loadFloors}
              style={{
                background: "rgba(255,255,255,.15)", color: "#fff",
                border: "1.5px solid rgba(255,255,255,.4)",
                fontWeight: 700, borderRadius: 8, padding: "7px 14px", fontSize: 12,
                cursor: "pointer", fontFamily: "inherit",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>
              <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} /> Refresh
            </button>
            <button onClick={handleAdd}
              style={{
                background: "#fff", color: "#9a3412",
                border: "none", fontWeight: 700,
                borderRadius: 8, padding: "7px 16px", fontSize: 12,
                boxShadow: "0 2px 8px rgba(0,0,0,.13)",
                cursor: "pointer", fontFamily: "inherit",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>
              <i className="pi pi-plus" /> Add Floor
            </button>
          </>
        }
      />

      <BmStatStrip stats={stats} />

      <BmCard
        title={view === "list" ? "Configured Floors" : "Floors — Card View"}
        icon={view === "list" ? "pi-list" : "pi-th-large"}
        count={filtered.length === floors.length ? floors.length : `${filtered.length}/${floors.length}`}
        action={<BmFilter value={filter} onChange={setFilter} placeholder="Search by name / number / building…" />}
      >
        {loading ? (
          <BmEmpty icon="pi-spin pi-spinner" title="Loading floors…" />
        ) : filtered.length === 0 ? (
          floors.length === 0 ? (
            <BmEmpty
              icon="pi-arrows-v"
              title="No floors yet"
              msg="Floors live under a building and host wards on top of them."
              ctaLabel="Add First Floor"
              ctaIcon="pi-plus"
              onCta={handleAdd}
            />
          ) : (
            <BmEmpty icon="pi-search" title="No matches" msg="Try a different search term." />
          )
        ) : view === "list" ? (
          /* Reuse the existing FloorList behavior — it owns its
             own fetch + table. We pass the filter through if the
             component supports it; otherwise it ignores. */
          <div style={{ padding: 12 }}>
            <FloorList onEdit={handleEdit} onRefresh={refreshKey} globalFilter={filter} />
          </div>
        ) : (
          <div style={{ padding: 14, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
            {filtered.map(f => {
              const totalWards = Number(f.totalWards || f.wardCount) || 0;
              const totalRooms = Number(f.totalRooms || f.roomCount) || 0;
              return (
                <div key={f._id} className="bm-grid-card bm-grid-card--orange">
                  <div className="bm-grid-card__head">
                    <BmAvatar
                      icon="pi-arrows-v"
                      tone="orange"
                      label={String(f.floorNumber || "?")}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="bm-grid-card__title">
                        {f.floorName || `Floor ${f.floorNumber}`}
                      </div>
                      <div className="bm-grid-card__sub">
                        <i className="pi pi-building" style={{ fontSize: 10, marginRight: 4 }} />
                        {f.building?.buildingName || f.buildingName || "—"}
                      </div>
                    </div>
                    <BmPill tone={f.isActive === false ? "danger" : "ok"}>
                      {f.isActive === false ? "Inactive" : "Active"}
                    </BmPill>
                  </div>

                  {(totalWards > 0 || totalRooms > 0 || f.description) && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #e2e8f0" }}>
                      {(totalWards > 0 || totalRooms > 0) && (
                        <div className="bm-chip-row" style={{ marginBottom: f.description ? 6 : 0 }}>
                          {totalWards > 0 && <BmChip icon="pi-home">{totalWards} ward{totalWards === 1 ? "" : "s"}</BmChip>}
                          {totalRooms > 0 && <BmChip icon="pi-box">{totalRooms} room{totalRooms === 1 ? "" : "s"}</BmChip>}
                        </div>
                      )}
                      {f.description && (
                        <div style={{ fontSize: 10.5, color: "#64748b", lineHeight: 1.4 }}>
                          {f.description.length > 70 ? f.description.slice(0, 70) + "…" : f.description}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="bm-row-actions" style={{ justifyContent: "flex-end", marginTop: 10 }}>
                    <BmIconBtn icon="pi-pencil" variant="info"   title="Edit"   onClick={() => handleEdit(f)} />
                    <BmIconBtn icon="pi-trash"  variant="danger" title="Delete" onClick={() => handleDelete(f)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </BmCard>

      <FloorForm
        visible={showForm}
        onHide={() => { setShowForm(false); setSelectedFloor(null); }}
        floor={selectedFloor}
        onSave={() => {
          setShowForm(false);
          setSelectedFloor(null);
          setRefreshKey(k => k + 1);
          toast.current?.show({ severity: "success", summary: "Saved", detail: "Floor saved", life: 2500 });
        }}
      />
    </div>
  );
};

export default FloorManagement;
