import React, { useEffect, useRef, useState } from "react";
import { Button } from "primereact/button";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { InputText } from "primereact/inputtext";
import { Toast } from "primereact/toast";

import BedForm from "../Components/bed/BedForm";
import BedBulkCreateDialog from "../Components/bed/BedBulkCreateDialog";
import BedSectionHeader from "../Components/bed/BedSectionHeader";
import {
  BmStatStrip, BmCard, BmEmpty, BmPill, BmIconBtn,
  BmAvatar, BmCellStack, BmChip,
} from "../Components/bed/BedPrimitives";
import BedStats from "../Components/bed/BedStats";
import BedVisualLayout from "../Components/bed/BedVisualLayout";
import { bedService } from "../Services/bedService";

const STATUS_AVATAR = {
  Available:   { icon: "pi-check-circle",     tone: "green"  },
  Occupied:    { icon: "pi-user",             tone: "red"    },
  Maintenance: { icon: "pi-wrench",           tone: "amber"  },
  Blocked:     { icon: "pi-ban",              tone: "slate"  },
  Reserved:    { icon: "pi-bookmark",         tone: "blue"   },
};

const STATUS_TONES = {
  Available:   "ok",
  Occupied:    "danger",
  Maintenance: "warn",
  Blocked:     "neutral",
  Reserved:    "info",
};

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

  /* ── aggregates / filtered ── */
  const bedStats = React.useMemo(() => {
    const by = (s) => beds.filter(b => b.status === s).length;
    return [
      { key: "total",       label: "Total beds",  value: beds.length,        icon: "pi-th-large",     tone: "slate"  },
      { key: "occupied",    label: "Occupied",    value: by("Occupied"),     icon: "pi-user",         tone: "red"    },
      { key: "available",   label: "Available",   value: by("Available"),    icon: "pi-check-circle", tone: "green"  },
      { key: "reserved",    label: "Reserved",    value: by("Reserved"),     icon: "pi-bookmark",     tone: "blue"   },
      { key: "maintenance", label: "Maintenance", value: by("Maintenance"),  icon: "pi-wrench",       tone: "amber"  },
      { key: "blocked",     label: "Blocked",     value: by("Blocked"),      icon: "pi-ban",          tone: "slate"  },
    ];
  }, [beds]);

  const filteredBeds = React.useMemo(() => {
    const q = (globalFilter || "").trim().toLowerCase();
    if (!q) return beds;
    return beds.filter(b =>
      (b.bedNumber || "").toLowerCase().includes(q) ||
      (b.buildingName || "").toLowerCase().includes(q) ||
      (b.wardName || "").toLowerCase().includes(q) ||
      (b.roomNumber || "").toLowerCase().includes(q) ||
      (b.status || "").toLowerCase().includes(q)
    );
  }, [beds, globalFilter]);

  /* ── view tab config ── */
  const TABS = [
    { key: "table", icon: "pi pi-table", label: "Table View" },
    { key: "visual", icon: "pi pi-th-large", label: "Visual Layout" },
    { key: "stats", icon: "pi pi-chart-bar", label: "Statistics" },
  ];

  /* ── render ── */
  return (
    <div className="bm-page">
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

      {/* Live stats strip — visible across all three views */}
      <BmStatStrip stats={bedStats} />

      {/* ══ TABLE VIEW ══════════════════════════════════════════════════ */}
      {viewMode === "table" && (
        <BmCard
          title="All Beds"
          icon="pi-list"
          count={filteredBeds.length === beds.length ? beds.length : `${filteredBeds.length}/${beds.length}`}
        >
          {loading ? (
            <BmEmpty icon="pi-spin pi-spinner" title="Loading beds…" />
          ) : filteredBeds.length === 0 ? (
            beds.length === 0 ? (
              <BmEmpty
                icon="pi-th-large"
                title="No beds yet"
                msg="Add your first bed, or use Bulk Create to add many at once."
                ctaLabel="Add New Bed"
                ctaIcon="pi-plus"
                onCta={() => { setSelectedBed(null); setShowForm(true); }}
              />
            ) : (
              <BmEmpty icon="pi-search" title="No matches" msg="Try a different search term or clear the filter." />
            )
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="bm-table">
                <thead>
                  <tr>
                    <th>Bed</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Flags &amp; Equipment</th>
                    <th>Patient</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBeds.map(r => {
                    const av = STATUS_AVATAR[r.status] || { icon: "pi-th-large", tone: "slate" };
                    const flags  = Array.isArray(r.isolationFlags) ? r.isolationFlags : [];
                    const equip  = Array.isArray(r.equipment) ? r.equipment : [];
                    const hk     = r.housekeeping?.state;
                    const hkLive = hk && hk !== "Idle";
                    return (
                      <tr key={r._id}>
                        <td>
                          <BmCellStack
                            avatar={<BmAvatar icon={av.icon} tone={av.tone} />}
                            title={r.bedNumber}
                            sub={r.precautionLevel && r.precautionLevel !== "Standard" ? `${r.precautionLevel} isolation` : ""}
                          />
                        </td>
                        <td>
                          <div>{r.buildingName || "—"} · Floor {r.floorNumber || "—"}</div>
                          <div className="muted">{r.wardName || "—"} · Room {r.roomNumber || "—"}</div>
                        </td>
                        <td><BmPill tone={STATUS_TONES[r.status] || "neutral"}>{r.status}</BmPill></td>
                        <td>
                          {(flags.length === 0 && equip.length === 0 && !hkLive) ? (
                            <span className="muted">—</span>
                          ) : (
                            <div className="bm-chip-row">
                              {flags.slice(0, 2).map((f, i) => (
                                <BmChip key={`f${i}`} icon="pi-shield">{f}</BmChip>
                              ))}
                              {flags.length > 2 && <BmChip>+{flags.length - 2}</BmChip>}
                              {hkLive && (
                                <BmChip icon={hk === "CleaningInProgress" ? "pi-spin pi-spinner" : "pi-bookmark-fill"}>
                                  {hk.replace(/([A-Z])/g, " $1").trim()}
                                </BmChip>
                              )}
                              {equip.slice(0, 2).map((e, i) => (
                                <BmChip key={`e${i}`} icon="pi-cog">{e.label || e.type}</BmChip>
                              ))}
                              {equip.length > 2 && <BmChip>+{equip.length - 2}</BmChip>}
                            </div>
                          )}
                        </td>
                        <td>
                          {r.currentAdmission?.patientId?.fullName
                            ? <span style={{ fontWeight: 600 }}>{r.currentAdmission.patientId.fullName}</span>
                            : <span className="muted">—</span>}
                        </td>
                        <td className="right">
                          <div className="bm-row-actions">
                            <BmIconBtn icon="pi-pencil" variant="info"   title="Edit"   onClick={() => handleEdit(r)} />
                            <BmIconBtn icon="pi-trash"  variant="danger" title="Delete" onClick={() => handleDelete(r)} />
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
