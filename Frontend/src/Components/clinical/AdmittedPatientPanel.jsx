/**
 * AdmittedPatientPanel.jsx
 * Left-side panel for clinical pages showing admitted IPD / Daycare patients.
 * Collapse to icon-only mode. Click a patient to load them in the current page.
 */
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
const API_BASE_URL = API_ENDPOINTS.BASE;

const C = {
  bg: "#ffffff",
  border: "#e2e6ea",
  text: "#1a1d23",
  muted: "#6b7280",
  accent: "#7c3aed",
  accentL: "#f5f3ff",
  blue: "#1e40af",
  blueL: "#eff6ff",
  green: "#16a34a",
  greenL: "#dcfce7",
  red: "#dc2626",
  redL: "#fef2f2",
  amber: "#d97706",
  amberL: "#fffbeb",
  teal: "#0d9488",
  tealL: "#f0fdfa",
  daycare: "#d97706",
};

const TYPE_COLOR = {
  IPD:      { bg: C.accentL,  color: C.accent,  label: "IPD" },
  Daycare:  { bg: C.amberL,   color: C.daycare, label: "DAY" },
  Emergency:{ bg: C.redL,     color: C.red,      label: "EMR" },
};

const STATUS_COLOR = {
  Active:     { bg: C.greenL, color: C.green },
  Discharged: { bg: "#f1f5f9", color: C.muted },
  Transferred:{ bg: C.blueL,  color: C.blue },
};

function timeSince(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d`;
  if (h > 0) return `${h}h`;
  return "<1h";
}

function PatientCard({ adm, selected, onClick, collapsed }) {
  const typeStyle = TYPE_COLOR[adm.admissionType === "Day Care" ? "Daycare" : adm.admissionType === "Emergency" ? "Emergency" : "IPD"] || TYPE_COLOR.IPD;
  const statusStyle = STATUS_COLOR[adm.status] || STATUS_COLOR.Active;

  if (collapsed) {
    return (
      <button onClick={onClick} title={adm.patientName} style={{
        width: "100%", padding: "8px 0", border: "none", background: selected ? C.accentL : "transparent",
        cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center",
        borderLeft: selected ? `3px solid ${C.accent}` : "3px solid transparent",
        borderRadius: 0,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: typeStyle.bg, color: typeStyle.color,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, fontWeight: 800, letterSpacing: .5,
        }}>
          {(adm.patientName || "?").split(" ").map(w => w[0]).slice(0, 2).join("")}
        </div>
      </button>
    );
  }

  return (
    <button onClick={onClick} style={{
      width: "100%", padding: "10px 12px", border: "none",
      background: selected ? C.accentL : "transparent",
      cursor: "pointer", textAlign: "left",
      borderLeft: selected ? `3px solid ${C.accent}` : "3px solid transparent",
      borderBottom: `1px solid ${C.border}`,
      transition: "background .12s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div style={{ fontWeight: 700, fontSize: 12.5, color: C.text, lineHeight: 1.3, flex: 1, marginRight: 6 }}>
          {adm.patientName || "Unknown"}
        </div>
        <span style={{
          fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 4,
          background: typeStyle.bg, color: typeStyle.color, letterSpacing: .5, flexShrink: 0,
        }}>{typeStyle.label}</span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: C.accent, fontWeight: 700, fontFamily: "monospace" }}>
          {adm.bedNumber || adm.ipdNo || adm._id?.slice(-6).toUpperCase()}
        </span>
        <span style={{
          fontSize: 9, padding: "1px 5px", borderRadius: 10, fontWeight: 700,
          background: statusStyle.bg, color: statusStyle.color,
        }}>{adm.status}</span>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {adm.bedNumber && (
          <span style={{ fontSize: 10, color: C.muted, display: "flex", alignItems: "center", gap: 2 }}>
            <i className="pi pi-table" style={{ fontSize: 9 }} /> {adm.wardName || "Ward"} · {adm.bedNumber}
          </span>
        )}
        {adm.attendingDoctor && (
          <span style={{ fontSize: 10, color: C.muted, display: "flex", alignItems: "center", gap: 2 }}>
            <i className="pi pi-user" style={{ fontSize: 9 }} /> {adm.attendingDoctor.replace("Dr. ", "Dr.")}
          </span>
        )}
      </div>

      {adm.reasonForAdmission && (
        <div style={{
          fontSize: 10, color: C.muted, marginTop: 4, lineHeight: 1.3,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {adm.reasonForAdmission}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, alignItems: "center" }}>
        <span style={{ fontSize: 9, color: C.muted }}>{adm.department}</span>
        <span style={{ fontSize: 9, color: C.muted, fontStyle: "italic" }}>
          {timeSince(adm.admissionDate)} ago
        </span>
      </div>
    </button>
  );
}

export default function AdmittedPatientPanel({ onPatientSelect, selectedId, pageType }) {
  const [collapsed, setCollapsed] = useState(false);
  const [admissions, setAdmissions] = useState([]);
  const [recentDischarges, setRecentDischarges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showDischarged, setShowDischarged] = useState(false);
  const [filter, setFilter] = useState("All");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("his_token");
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const [activeRes, dischargeRes] = await Promise.allSettled([
        axios.get(`${API_BASE_URL}/admissions/active`, { headers }),
        axios.get(`${API_BASE_URL}/admissions/discharges/today`, { headers }),
      ]);
      if (activeRes.status === "fulfilled") {
        const data = activeRes.value.data;
        setAdmissions(Array.isArray(data) ? data : data?.admissions || data?.data || []);
      }
      if (dischargeRes.status === "fulfilled") {
        const data = dischargeRes.value.data;
        setRecentDischarges(Array.isArray(data) ? data : data?.admissions || data?.data || []);
      }
    } catch {
      // silently fail — panel is non-blocking
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 90 seconds
  useEffect(() => {
    const t = setInterval(load, 90000);
    return () => clearInterval(t);
  }, [load]);

  const FILTERS = ["All", "IPD", "Daycare", "Emergency"];

  const filteredAdmissions = admissions.filter(a => {
    const matchSearch = !search ||
      a.patientName?.toLowerCase().includes(search.toLowerCase()) ||
      a.bedNumber?.toLowerCase().includes(search.toLowerCase()) ||
      a.attendingDoctor?.toLowerCase().includes(search.toLowerCase()) ||
      a.UHID?.toLowerCase().includes(search.toLowerCase()) ||
      a.reasonForAdmission?.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "All" ||
      (filter === "IPD" && a.admissionType !== "Day Care" && a.admissionType !== "Emergency") ||
      (filter === "Daycare" && a.admissionType === "Day Care") ||
      (filter === "Emergency" && a.admissionType === "Emergency");
    return matchSearch && matchFilter;
  });

  const panelW = collapsed ? 56 : 272;

  return (
    <div style={{
      width: panelW, minWidth: panelW, maxWidth: panelW,
      background: C.bg, borderRight: `1.5px solid ${C.border}`,
      display: "flex", flexDirection: "column",
      height: "calc(100vh - 52px)",
      position: "sticky", top: 52, flexShrink: 0,
      transition: "width .2s, min-width .2s",
      overflowX: "hidden",
      boxShadow: "2px 0 8px rgba(0,0,0,.04)",
    }}>

      {/* Header */}
      <div style={{
        padding: collapsed ? "12px 0" : "11px 12px",
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center",
        justifyContent: collapsed ? "center" : "space-between",
        background: C.accentL, flexShrink: 0,
      }}>
        {!collapsed && (
          <div>
            <div style={{ fontWeight: 800, fontSize: 12, color: C.accent }}>Admitted Patients</div>
            <div style={{ fontSize: 10, color: C.muted }}>
              {loading ? "Loading…" : `${filteredAdmissions.length} active`}
            </div>
          </div>
        )}
        <button onClick={() => setCollapsed(c => !c)} style={{
          border: "none", background: "transparent", cursor: "pointer",
          padding: 4, borderRadius: 6, color: C.accent,
          display: "flex", alignItems: "center",
        }}>
          <i className={`pi ${collapsed ? "pi-chevron-right" : "pi-chevron-left"}`} style={{ fontSize: 12 }} />
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Search */}
          <div style={{ padding: "8px 10px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
            <div style={{ position: "relative" }}>
              <i className="pi pi-search" style={{
                position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
                fontSize: 11, color: C.muted,
              }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search name / bed / UHID…"
                style={{
                  width: "100%", padding: "6px 8px 6px 26px",
                  border: `1.5px solid ${C.border}`, borderRadius: 7,
                  fontSize: 11, color: C.text, outline: "none",
                  boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif",
                }}
              />
            </div>
          </div>

          {/* Filter tabs */}
          <div style={{
            display: "flex", borderBottom: `1px solid ${C.border}`,
            flexShrink: 0, background: "#fafafa",
          }}>
            {FILTERS.map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                flex: 1, padding: "5px 0", border: "none",
                background: "transparent", cursor: "pointer",
                fontSize: 10, fontWeight: 700, color: filter === f ? C.accent : C.muted,
                borderBottom: filter === f ? `2px solid ${C.accent}` : "2px solid transparent",
                transition: "color .12s",
              }}>{f}</button>
            ))}
          </div>
        </>
      )}

      {/* Patient list */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {loading && (
          <div style={{ padding: 20, textAlign: "center" }}>
            <div style={{
              width: 24, height: 24, border: `2px solid ${C.accent}`, borderTopColor: "transparent",
              borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto",
            }} />
            {!collapsed && <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>Loading…</div>}
          </div>
        )}

        {!loading && filteredAdmissions.length === 0 && !collapsed && (
          <div style={{ padding: 20, textAlign: "center" }}>
            <i className="pi pi-inbox" style={{ fontSize: 24, color: C.muted, display: "block", marginBottom: 8 }} />
            <div style={{ fontSize: 11, color: C.muted }}>
              {search ? "No patients match search" : "No active admissions"}
            </div>
          </div>
        )}

        {filteredAdmissions.map(adm => (
          <PatientCard
            key={adm._id}
            adm={adm}
            selected={selectedId === adm._id}
            collapsed={collapsed}
            onClick={() => onPatientSelect?.(adm)}
          />
        ))}

        {/* Recent Discharges section */}
        {!collapsed && recentDischarges.length > 0 && (
          <div>
            <button onClick={() => setShowDischarged(s => !s)} style={{
              width: "100%", padding: "8px 12px", border: "none",
              background: "#f8fafc", cursor: "pointer",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: ".5px" }}>
                TODAY'S DISCHARGES ({recentDischarges.length})
              </span>
              <i className={`pi ${showDischarged ? "pi-chevron-up" : "pi-chevron-down"}`}
                style={{ fontSize: 9, color: C.muted }} />
            </button>
            {showDischarged && recentDischarges.map(adm => (
              <PatientCard
                key={adm._id}
                adm={{ ...adm, status: "Discharged" }}
                selected={selectedId === adm._id}
                collapsed={false}
                onClick={() => onPatientSelect?.(adm)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Refresh footer */}
      {!collapsed && (
        <div style={{
          padding: "6px 12px", borderTop: `1px solid ${C.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: "#fafafa", flexShrink: 0,
        }}>
          <span style={{ fontSize: 10, color: C.muted }}>Auto-refresh 90s</span>
          <button onClick={load} style={{
            border: "none", background: "transparent", cursor: "pointer",
            fontSize: 10, color: C.accent, display: "flex", alignItems: "center", gap: 4,
            fontWeight: 600,
          }}>
            <i className="pi pi-refresh" style={{ fontSize: 10 }} /> Refresh
          </button>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
