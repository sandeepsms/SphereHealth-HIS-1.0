import React, { useEffect, useMemo, useRef, useState } from "react";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";

import WardForm from "../Components/ward/WardForm";
import BedSectionHeader from "../Components/bed/BedSectionHeader";
import {
  BmStatStrip, BmCard, BmFilter, BmEmpty, BmPill, BmIconBtn,
  BmBar, BmAvatar, BmCellStack, BmChip,
} from "../Components/bed/BedPrimitives";
import { wardService } from "../Services/wardService";

/* ── Ward type → icon + avatar tone ── */
const WARD_TYPE_ICON = {
  General:    { icon: "pi-home",         tone: "blue"   },
  ICU:        { icon: "pi-heart-fill",   tone: "red"    },
  NICU:       { icon: "pi-heart",        tone: "pink"   },
  CCU:        { icon: "pi-heart-fill",   tone: "red"    },
  Emergency:  { icon: "pi-bolt",         tone: "amber"  },
  Pediatric:  { icon: "pi-users",        tone: "orange" },
  Maternity:  { icon: "pi-heart",        tone: "pink"   },
  Surgical:   { icon: "pi-bookmark",     tone: "purple" },
  Isolation:  { icon: "pi-shield",       tone: "red"    },
  HDU:        { icon: "pi-chart-line",   tone: "amber"  },
  Private:    { icon: "pi-star",         tone: "amber"  },
  "Day Care": { icon: "pi-sun",          tone: "teal"   },
};

const WardManagement = () => {
  const [wards, setWards] = useState([]);
  const [selectedWard, setSelectedWard] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const toast = useRef(null);

  useEffect(() => { loadWards(); }, []);

  const loadWards = async () => {
    setLoading(true);
    try {
      const data = await wardService.getAllWards();
      let wardsArray = [];
      if (Array.isArray(data)) wardsArray = data;
      else if (data && Array.isArray(data.data))  wardsArray = data.data;
      else if (data && Array.isArray(data.wards)) wardsArray = data.wards;

      const mappedWards = wardsArray.map((ward) => ({
        ...ward,
        buildingName: ward.building?.buildingName || ward.buildingName || "—",
        floorName:    ward.floor?.floorName       || ward.floorName     || "—",
        floorNumber:  ward.floor?.floorNumber     || ward.floorNumber   || "—",
      }));
      setWards(mappedWards);
    } catch (error) {
      setWards([]);
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: error.response?.data?.message || "Failed to load wards",
        life: 3000,
      });
    } finally {
      setLoading(false);
    }
  };

  /* ── Aggregates for the stat strip ── */
  const stats = useMemo(() => {
    const active = wards.filter(w => w.isActive).length;
    const totalRooms = wards.reduce((s, w) => s + (Number(w.totalRooms) || 0), 0);
    const totalBeds  = wards.reduce((s, w) => s + (Number(w.totalBeds)  || 0), 0);
    const types = new Set(wards.map(w => w.wardType).filter(Boolean));
    return [
      { key: "wards",  label: "Total wards",      value: wards.length, icon: "pi-home",      tone: "blue"  },
      { key: "active", label: "Active",           value: active,        icon: "pi-check-circle", tone: "green" },
      { key: "rooms",  label: "Rooms (sum)",      value: totalRooms,    icon: "pi-box",       tone: "purple" },
      { key: "beds",   label: "Beds (sum)",       value: totalBeds,     icon: "pi-th-large",  tone: "amber" },
      { key: "types",  label: "Ward types",       value: types.size,    icon: "pi-tag",       tone: "slate" },
    ];
  }, [wards]);

  /* ── Filtered rows ── */
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return wards;
    return wards.filter(w =>
      (w.wardName || "").toLowerCase().includes(q) ||
      (w.wardCode || "").toLowerCase().includes(q) ||
      (w.wardType || "").toLowerCase().includes(q) ||
      (w.buildingName || "").toLowerCase().includes(q) ||
      String(w.floorNumber || "").toLowerCase().includes(q)
    );
  }, [wards, filter]);

  const handleDelete = (ward) => {
    confirmDialog({
      message: `Are you sure you want to delete ward "${ward.wardName}"?`,
      header: "Confirmation",
      icon: "pi pi-exclamation-triangle",
      accept: async () => {
        try {
          await wardService.deleteWard(ward._id);
          toast.current?.show({ severity: "success", summary: "Deleted", detail: `Ward ${ward.wardName} removed`, life: 3000 });
          loadWards();
        } catch {
          toast.current?.show({ severity: "error", summary: "Error", detail: "Failed to delete ward", life: 3000 });
        }
      },
    });
  };

  const handleSave = () => {
    setShowForm(false);
    setSelectedWard(null);
    loadWards();
    toast.current?.show({ severity: "success", summary: "Saved", detail: "Ward saved", life: 2500 });
  };

  return (
    <div className="bm-page">
      <Toast ref={toast} />
      <ConfirmDialog />

      <BedSectionHeader
        title="Wards"
        subtitle={`${wards.length} ward${wards.length === 1 ? "" : "s"} configured · NABH COP.2 location hierarchy`}
        icon="pi-home"
        actions={
          <>
            <button onClick={loadWards} disabled={loading}
              style={{
                background: "rgba(255,255,255,.15)", color: "#fff",
                border: "1.5px solid rgba(255,255,255,.4)",
                fontWeight: 700, borderRadius: 8, padding: "7px 14px", fontSize: 12,
                cursor: loading ? "wait" : "pointer", fontFamily: "inherit",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>
              <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} /> Refresh
            </button>
            <button onClick={() => { setSelectedWard(null); setShowForm(true); }}
              style={{
                background: "#fff", color: "#1e40af",
                border: "none", fontWeight: 700,
                borderRadius: 8, padding: "7px 16px", fontSize: 12,
                boxShadow: "0 2px 8px rgba(0,0,0,.13)",
                cursor: "pointer", fontFamily: "inherit",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>
              <i className="pi pi-plus" /> Add Ward
            </button>
          </>
        }
      />

      <BmStatStrip stats={stats} />

      <BmCard
        title="Configured Wards"
        icon="pi-home"
        count={filtered.length === wards.length ? wards.length : `${filtered.length}/${wards.length}`}
        action={<BmFilter value={filter} onChange={setFilter} placeholder="Search wards by name / code / type / building…" />}
      >
        {loading ? (
          <BmEmpty icon="pi-spin pi-spinner" title="Loading wards…" />
        ) : filtered.length === 0 ? (
          wards.length === 0 ? (
            <BmEmpty
              icon="pi-inbox"
              title="No wards yet"
              msg="Wards group rooms under a floor. Add your first ward to get started."
              ctaLabel="Add Ward"
              ctaIcon="pi-plus"
              onCta={() => { setSelectedWard(null); setShowForm(true); }}
            />
          ) : (
            <BmEmpty icon="pi-search" title="No matches" msg="Try a different search term or clear the filter." />
          )
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="bm-table">
              <thead>
                <tr>
                  <th>Ward</th>
                  <th>Type</th>
                  <th>Location</th>
                  <th className="right">Rooms</th>
                  <th>Beds · Occupancy</th>
                  <th>Facilities</th>
                  <th>Status</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(w => {
                  const meta = WARD_TYPE_ICON[w.wardType] || { icon: "pi-home", tone: "blue" };
                  const totalBeds = Number(w.totalBeds) || 0;
                  const occBeds   = Number(w.occupiedBeds) || 0;
                  const facilities = Array.isArray(w.facilities) ? w.facilities : [];
                  return (
                    <tr key={w._id}>
                      <td>
                        <BmCellStack
                          avatar={<BmAvatar icon={meta.icon} tone={meta.tone} />}
                          title={w.wardName}
                          sub={w.wardCode || "—"}
                        />
                      </td>
                      <td>
                        {w.wardType
                          ? <BmPill tone={w.wardType === "Emergency" || w.wardType === "ICU" || w.wardType === "Isolation" ? "danger" : "info"}>{w.wardType}</BmPill>
                          : <span className="muted">—</span>}
                      </td>
                      <td>
                        <div>{w.buildingName}</div>
                        <div className="muted">Floor {w.floorNumber}</div>
                      </td>
                      <td className="right">
                        <strong>{w.totalRooms ?? 0}</strong>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <strong>{totalBeds}</strong>
                          <span className="muted" style={{ fontSize: 11 }}>
                            bed{totalBeds === 1 ? "" : "s"}
                          </span>
                          {totalBeds > 0 && occBeds > 0 && (
                            <BmBar value={occBeds} max={totalBeds} width={70} showLabel={false} />
                          )}
                        </div>
                        {Number(w.dailyCharge) > 0 && (
                          <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>
                            ₹{Number(w.dailyCharge).toLocaleString("en-IN")}/day
                          </div>
                        )}
                      </td>
                      <td>
                        {facilities.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          <div className="bm-chip-row">
                            {facilities.slice(0, 2).map((f, i) => <BmChip key={i}>{f}</BmChip>)}
                            {facilities.length > 2 && <BmChip>+{facilities.length - 2}</BmChip>}
                          </div>
                        )}
                      </td>
                      <td>
                        {w.isActive
                          ? <BmPill tone="ok"     icon="pi-check">Active</BmPill>
                          : <BmPill tone="danger" icon="pi-times">Inactive</BmPill>}
                      </td>
                      <td className="right">
                        <div className="bm-row-actions">
                          <BmIconBtn icon="pi-pencil" variant="info"   title="Edit"
                            onClick={() => { setSelectedWard(w); setShowForm(true); }} />
                          <BmIconBtn icon="pi-trash"  variant="danger" title="Delete"
                            onClick={() => handleDelete(w)} />
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

      <WardForm
        visible={showForm}
        onHide={() => { setShowForm(false); setSelectedWard(null); }}
        ward={selectedWard}
        onSave={handleSave}
      />
    </div>
  );
};

export default WardManagement;
