// ============================================
// FILE: src/pages/BuildingManagement.jsx
// ============================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";

import BuildingForm from "../Components/building/BuildingForm";
import BedSectionHeader from "../Components/bed/BedSectionHeader";
import {
  BmStatStrip, BmCard, BmFilter, BmEmpty, BmPill, BmIconBtn,
  BmAvatar, BmCellStack,
} from "../Components/bed/BedPrimitives";
import { buildingService } from "../Services/buildingService";

const BuildingManagement = () => {
  const [buildings, setBuildings] = useState([]);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const toast = useRef(null);

  useEffect(() => { loadBuildings(); }, []);

  const loadBuildings = async () => {
    setLoading(true);
    try {
      const data = await buildingService.getAllBuildings();
      const arr = Array.isArray(data) ? data : data?.data || data?.buildings || [];
      setBuildings(arr);
    } catch {
      toast.current?.show({ severity: "error", summary: "Error", detail: "Failed to load buildings", life: 3000 });
    } finally { setLoading(false); }
  };

  const handleDelete = (b) => {
    confirmDialog({
      message: `Delete building "${b.buildingName}"?`,
      header: "Confirmation",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await buildingService.deleteBuilding(b._id);
          toast.current?.show({ severity: "success", summary: "Deleted", detail: `${b.buildingName} removed`, life: 2500 });
          loadBuildings();
        } catch {
          toast.current?.show({ severity: "error", summary: "Error", detail: "Failed to delete building", life: 3000 });
        }
      },
    });
  };

  const stats = useMemo(() => {
    const active = buildings.filter(b => b.isActive).length;
    const floors = buildings.reduce((s, b) => s + (Number(b.totalFloors) || 0), 0);
    return [
      { key: "total",  label: "Buildings",       value: buildings.length, icon: "pi-building",     tone: "blue"  },
      { key: "active", label: "Active",          value: active,            icon: "pi-check-circle", tone: "green" },
      { key: "floors", label: "Floors (sum)",    value: floors,            icon: "pi-arrows-v",     tone: "amber" },
    ];
  }, [buildings]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return buildings;
    return buildings.filter(b =>
      (b.buildingName || "").toLowerCase().includes(q) ||
      (b.buildingCode || "").toLowerCase().includes(q) ||
      (b.address || "").toLowerCase().includes(q)
    );
  }, [buildings, filter]);

  return (
    <div className="bm-page">
      <Toast ref={toast} />
      <ConfirmDialog />

      <BedSectionHeader
        title="Buildings"
        subtitle={`${buildings.length} building${buildings.length === 1 ? "" : "s"} · top of the location hierarchy`}
        icon="pi-building"
        actions={
          <>
            <button onClick={loadBuildings} disabled={loading}
              style={{
                background: "rgba(255,255,255,.15)", color: "#fff",
                border: "1.5px solid rgba(255,255,255,.4)",
                fontWeight: 700, borderRadius: 8, padding: "7px 14px", fontSize: 12,
                cursor: loading ? "wait" : "pointer", fontFamily: "inherit",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>
              <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} /> Refresh
            </button>
            <button onClick={() => { setSelectedBuilding(null); setShowForm(true); }}
              style={{
                background: "#fff", color: "#0e7490",
                border: "none", fontWeight: 700,
                borderRadius: 8, padding: "7px 16px", fontSize: 12,
                boxShadow: "0 2px 8px rgba(0,0,0,.13)",
                cursor: "pointer", fontFamily: "inherit",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>
              <i className="pi pi-plus" /> Add Building
            </button>
          </>
        }
      />

      <BmStatStrip stats={stats} />

      <BmCard
        title="Configured Buildings"
        icon="pi-building"
        count={filtered.length === buildings.length ? buildings.length : `${filtered.length}/${buildings.length}`}
        action={<BmFilter value={filter} onChange={setFilter} placeholder="Search by name / code / address…" />}
      >
        {loading ? (
          <BmEmpty icon="pi-spin pi-spinner" title="Loading buildings…" />
        ) : filtered.length === 0 ? (
          buildings.length === 0 ? (
            <BmEmpty
              icon="pi-building"
              title="No buildings yet"
              msg="Add your first building — every floor, ward, room and bed lives under one."
              ctaLabel="Add Building"
              ctaIcon="pi-plus"
              onCta={() => { setSelectedBuilding(null); setShowForm(true); }}
            />
          ) : (
            <BmEmpty icon="pi-search" title="No matches" msg="Try a different search term or clear the filter." />
          )
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="bm-table">
              <thead>
                <tr>
                  <th>Building</th>
                  <th>Floors · Visual</th>
                  <th>Address</th>
                  <th>Status</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => {
                  const floors = Number(b.totalFloors) || 0;
                  return (
                    <tr key={b._id}>
                      <td>
                        <BmCellStack
                          avatar={<BmAvatar icon="pi-building" tone="cyan" />}
                          title={b.buildingName}
                          sub={b.buildingCode || "—"}
                        />
                      </td>
                      <td>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <strong style={{ fontSize: 14 }}>{floors}</strong>
                          <span className="muted" style={{ fontSize: 11 }}>floor{floors === 1 ? "" : "s"}</span>
                        </div>
                        {floors > 0 && (
                          <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
                            {Array.from({ length: Math.min(floors, 12) }).map((_, i) => (
                              <span key={i} style={{
                                width: 4, height: 14, borderRadius: 1,
                                background: "linear-gradient(180deg, #06b6d4, #0e7490)",
                                opacity: 0.4 + (i / Math.min(floors, 12)) * 0.5,
                              }} />
                            ))}
                            {floors > 12 && <span className="muted" style={{ fontSize: 9, marginLeft: 4 }}>+{floors - 12}</span>}
                          </div>
                        )}
                      </td>
                      <td>
                        {b.address ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <i className="pi pi-map-marker" style={{ fontSize: 10, color: "#94a3b8" }} />
                            {b.address}
                          </span>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td>
                        {b.isActive
                          ? <BmPill tone="ok"     icon="pi-check">Active</BmPill>
                          : <BmPill tone="danger" icon="pi-times">Inactive</BmPill>}
                      </td>
                      <td className="right">
                        <div className="bm-row-actions">
                          <BmIconBtn icon="pi-pencil" variant="info"   title="Edit"
                            onClick={() => { setSelectedBuilding(b); setShowForm(true); }} />
                          <BmIconBtn icon="pi-trash"  variant="danger" title="Delete"
                            onClick={() => handleDelete(b)} />
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

      <BuildingForm
        visible={showForm}
        onHide={() => { setShowForm(false); setSelectedBuilding(null); }}
        building={selectedBuilding}
        onSave={() => {
          setShowForm(false);
          setSelectedBuilding(null);
          loadBuildings();
          toast.current?.show({ severity: "success", summary: "Saved", detail: "Building saved", life: 2500 });
        }}
      />
    </div>
  );
};

export default BuildingManagement;
