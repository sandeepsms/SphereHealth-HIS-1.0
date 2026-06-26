/**
 * AdmittedPatientPanel.jsx  v3.0
 * World-class patient selector sidebar for all clinical pages.
 *
 * Features
 * ─────────
 * • Collapsible 52 px icon-rail with tooltip popover
 * • Gradient deep-navy header with live count badge
 * • Horizontal type tabs: All / IPD / Day Care / Emergency
 * • Debounced live search with clear button
 * • Shimmer skeleton loading state
 * • Rich patient cards: gradient avatar, day-of-stay badge, allergy
 *   alert, status pulse dot, bed/ward/dept chips, doctor, reason
 * • Today's Discharges expandable section
 * • Auto-refresh every 90 s with last-updated indicator
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

const API = API_ENDPOINTS.BASE;

/* ═══════════════════════  DESIGN TOKENS  ═══════════════════════ */
const T = {
  /* neutrals */
  bg:       "#ffffff",
  surface:  "#f8fafc",
  border:   "#e2e8f0",
  text:     "#0f172a",
  muted:    "#64748b",
  faint:    "#94a3b8",
  /* brand */
  navy:     "#0f172a",
  navyMid:  "#1e293b",
  purple:   "#7c3aed",
  purpleL:  "#f5f3ff",
  purpleB:  "#ddd6fe",
  /* status */
  green:    "#16a34a",
  greenL:   "#dcfce7",
  greenB:   "#bbf7d0",
  amber:    "#d97706",
  amberL:   "#fffbeb",
  amberB:   "#fde68a",
  orange:   "#ea580c",
  orangeL:  "#fff7ed",
  red:      "#dc2626",
  redL:     "#fef2f2",
  redB:     "#fecaca",
  blue:     "#4f46e5",
  blueL:    "#eef2ff",
  blueB:    "#c7d2fe",
};

/* ═══════════════════════  TYPE CONFIG  ═════════════════════════ */
const TYPES = [
  { key: "All",       label: "All",       icon: "pi-th-large",          color: T.purple  },
  { key: "IPD",       label: "IPD",       icon: "pi-building",          color: T.blue    },
  { key: "Daycare",   label: "Day Care",  icon: "pi-sun",               color: T.amber   },
  { key: "Emergency", label: "Emergency", icon: "pi-bolt",              color: T.red     },
];

function typeOf(adm) {
  const t = adm.admissionType || "";
  if (t === "Emergency")          return "Emergency";
  if (t === "Day Care" || t === "Daycare" || t === "DayCare") return "Daycare";
  return "IPD";
}

/* ═══════════════════════  HELPERS  ═════════════════════════════ */
function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000));
}

function timeSince(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(h / 24);
  if (d > 0)  return `${d}d ago`;
  if (h > 0)  return `${h}h ago`;
  if (m > 0)  return `${m}m ago`;
  return "just now";
}

function initials(name = "") {
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() || "").slice(0, 2).join("");
}

/** Stable gradient per patient name */
const GRADIENTS = [
  ["#6366f1","#8b5cf6"],  // indigo→violet
  ["#0ea5e9","#6366f1"],  // sky→indigo
  ["#14b8a6","#0ea5e9"],  // teal→sky
  ["#f59e0b","#ef4444"],  // amber→red
  ["#10b981","#14b8a6"],  // emerald→teal
  ["#ec4899","#8b5cf6"],  // pink→violet
  ["#f97316","#f59e0b"],  // orange→amber
  ["#6366f1","#06b6d4"],  // blue→cyan
];
function avatarGradient(name = "") {
  const code = name.charCodeAt(0) || 65;
  const [a, b] = GRADIENTS[code % GRADIENTS.length];
  return `linear-gradient(135deg,${a},${b})`;
}

/** Day-of-stay badge colour */
function dayBadgeStyle(days) {
  if (days === null) return { bg: "#f1f5f9", color: T.muted };
  if (days <= 3)  return { bg: T.greenL,  color: T.green };
  if (days <= 7)  return { bg: T.amberL,  color: T.amber };
  if (days <= 14) return { bg: T.orangeL, color: T.orange };
  return            { bg: T.redL,    color: T.red };
}

/* ═══════════════════════  SKELETON CARD  ══════════════════════ */
function SkeletonCard() {
  return (
    <div style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}` }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#e2e8f0", flexShrink: 0 }} className="shimmer" />
        <div style={{ flex: 1 }}>
          <div style={{ height: 11, borderRadius: 5, background: "#e2e8f0", width: "65%", marginBottom: 7 }} className="shimmer" />
          <div style={{ height: 9, borderRadius: 5, background: "#e2e8f0", width: "45%" }} className="shimmer" />
        </div>
        <div style={{ width: 28, height: 18, borderRadius: 6, background: "#e2e8f0" }} className="shimmer" />
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <div style={{ height: 18, borderRadius: 6, background: "#e2e8f0", width: 54 }} className="shimmer" />
        <div style={{ height: 18, borderRadius: 6, background: "#e2e8f0", width: 72 }} className="shimmer" />
      </div>
    </div>
  );
}

/* ═══════════════════════  PATIENT CARD  ═══════════════════════ */
function PatientCard({ adm, selected, onClick, collapsed }) {
  const [hovered,   setHovered]   = useState(false);
  const [tooltipPos, setTooltipPos] = useState(null);
  const btnRef = useRef(null);
  const type    = typeOf(adm);
  const days    = daysSince(adm.admissionDate);
  const dStyle  = dayBadgeStyle(days);
  const name    = adm.patientName || "Unknown";
  const uhid    = adm.UHID || adm.uhid || "—";
  const bed     = adm.bedId?.bedNumber || adm.bedNumber || "";
  const ward    = adm.wardId?.wardName || adm.wardName || "";
  const dept    = adm.department || "";
  const doctor  = adm.attendingDoctor || "";
  const reason  = adm.reasonForAdmission || adm.provisionalDiagnosis || "";
  const allergy = adm.allergies || adm.knownAllergies || "";
  const isActive = (adm.status || "Active").toLowerCase() === "active";

  // Initial-assessment status — drives the NEW! badge for fresh admissions
  const doctorAssessed = adm.initialAssessment?.doctorCompleted === true;
  const nurseAssessed  = adm.initialAssessment?.nurseCompleted  === true;
  const assessmentPending = !doctorAssessed || !nurseAssessed;
  // Show NEW only for IPD/DC/ER admissions less than 24h old AND not fully assessed
  const isFreshAdmission = days !== null && days < 1 && assessmentPending;

  const typeConf = TYPES.find(t => t.key === type) || TYPES[1];

  /* ── Collapsed (icon-only) ── */
  if (collapsed) {
    return (
      <div style={{ position: "relative" }}>
        <button
          ref={btnRef}
          onClick={onClick}
          onMouseEnter={() => {
            setHovered(true);
            if (btnRef.current) {
              const r = btnRef.current.getBoundingClientRect();
              setTooltipPos({ top: r.top + r.height / 2, left: r.right + 8 });
            }
          }}
          onMouseLeave={() => { setHovered(false); setTooltipPos(null); }}
          style={{
            width: "100%", height: 52, border: "none",
            background: selected ? T.purpleL : hovered ? "#f8fafc" : "transparent",
            cursor: "pointer",
            display: "flex", justifyContent: "center", alignItems: "center",
            borderLeft: selected ? `3px solid ${T.purple}` : "3px solid transparent",
            transition: "all .15s",
            position: "relative",
          }}
        >
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: selected ? T.purple : avatarGradient(name),
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 800, color: "#fff", letterSpacing: .5,
            boxShadow: selected ? `0 0 0 3px ${T.purpleB}` : "none",
            transition: "all .15s",
          }}>
            {initials(name)}
          </div>
          {allergy && (
            <div style={{
              position: "absolute", top: 8, right: 8,
              width: 8, height: 8, borderRadius: "50%",
              background: T.red,
            }} />
          )}
        </button>
        {/* Tooltip — fixed position so it escapes overflow:hidden */}
        {hovered && tooltipPos && (
          <div style={{
            position: "fixed",
            top: tooltipPos.top,
            left: tooltipPos.left,
            transform: "translateY(-50%)",
            zIndex: 9999,
            background: T.navy,
            color: "#fff",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 12,
            fontFamily: "'DM Sans',sans-serif",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            boxShadow: "0 8px 24px rgba(0,0,0,.3)",
          }}>
            <div style={{ fontWeight: 700 }}>{name}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,.6)", marginTop: 2 }}>
              {uhid} {bed ? `· 🛏 ${bed}` : ""}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── Full card ── */
  const active = selected || hovered;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%", padding: "12px 14px", border: "none",
        background: selected ? T.purpleL : hovered ? "#fafbff" : T.bg,
        cursor: "pointer", textAlign: "left",
        borderLeft: `3px solid ${selected ? T.purple : hovered ? "#c4b5fd" : "transparent"}`,
        borderBottom: `1px solid ${T.border}`,
        transition: "all .15s",
        display: "block",
        fontFamily: "'DM Sans',sans-serif",
      }}
    >
      {/* Row 1: Avatar + Name + Type badge */}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        {/* Avatar */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: selected ? T.purple : avatarGradient(name),
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 800, color: "#fff",
            boxShadow: selected ? `0 0 0 3px ${T.purpleB}` : "0 2px 6px rgba(0,0,0,.12)",
            transition: "all .15s", flexShrink: 0,
          }}>
            {initials(name)}
          </div>
          {/* Status dot */}
          <div style={{
            position: "absolute", bottom: 0, right: 0,
            width: 10, height: 10, borderRadius: "50%",
            background: isActive ? T.green : T.muted,
            border: "2px solid #fff",
            boxShadow: isActive ? `0 0 0 2px ${T.greenB}` : "none",
          }} />
        </div>

        {/* Name + UHID */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontWeight: 700, fontSize: 13,
            color: selected ? T.purple : T.text,
            lineHeight: 1.3,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            transition: "color .15s",
          }}>{name}</div>
          <div style={{
            fontSize: 11, color: T.muted, marginTop: 1,
            fontFamily: "'DM Mono', 'Courier New', monospace",
            letterSpacing: "-.3px",
          }}>{uhid}</div>
        </div>

        {/* Type + Day badge stack */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          {isFreshAdmission && (
            <span title="New admission - Initial Assessment pending" style={{
              fontSize: 9, fontWeight: 900, padding: "2px 7px", borderRadius: 4,
              background: "linear-gradient(135deg, #dc2626, #f97316)",
              color: "#fff",
              letterSpacing: ".5px", textTransform: "uppercase",
              boxShadow: "0 0 0 2px rgba(220, 38, 38, .15)",
              animation: "pulseNew 1.5s ease-in-out infinite",
            }}>NEW</span>
          )}
          <span style={{
            fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4,
            background: typeConf.color + "18", color: typeConf.color,
            letterSpacing: ".5px", textTransform: "uppercase",
          }}>{typeConf.label}</span>
          {days !== null && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
              background: dStyle.bg, color: dStyle.color,
            }}>D{days + 1}</span>
          )}
        </div>
      </div>

      {/* Row 2: Chips (bed / ward / dept) */}
      {(bed || ward || dept) && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
          {bed && (
            <Chip icon="pi-table" text={`Bed ${bed}`} color={selected ? T.purple : T.blue} active={selected} />
          )}
          {ward && (
            <Chip icon="pi-building" text={ward} color={T.muted} />
          )}
          {dept && (
            <Chip icon="pi-sitemap" text={dept} color={T.muted} />
          )}
        </div>
      )}

      {/* Row 3: Doctor + Allergy */}
      {(doctor || allergy) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 7, gap: 6 }}>
          {doctor && (
            <span style={{
              fontSize: 10, color: T.muted, display: "flex", alignItems: "center", gap: 4,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
            }}>
              <i className="pi pi-user-md" style={{ fontSize: 9, color: T.faint, flexShrink: 0 }} />
              {doctor.replace(/^Dr\.?\s*/i, "Dr. ")}
            </span>
          )}
          {allergy && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
              background: T.redL, color: T.red, display: "flex", alignItems: "center", gap: 3,
              flexShrink: 0,
            }}>
              <i className="pi pi-exclamation-triangle" style={{ fontSize: 8 }} /> ALLERGY
            </span>
          )}
        </div>
      )}

      {/* Row 4: Reason + time */}
      {reason && (
        <div style={{
          fontSize: 10, color: T.faint, marginTop: 6, lineHeight: 1.4,
          overflow: "hidden", textOverflow: "ellipsis",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>{reason}</div>
      )}

      <div style={{ marginTop: 6, fontSize: 9, color: T.faint, textAlign: "right" }}>
        {timeSince(adm.admissionDate)}
      </div>
    </button>
  );
}

function Chip({ icon, text, color, active }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      fontSize: 10, padding: "2px 7px", borderRadius: 5,
      background: active ? color + "18" : "#f1f5f9",
      color: active ? color : T.muted,
      fontWeight: 500,
    }}>
      <i className={`pi ${icon}`} style={{ fontSize: 8 }} />
      {text}
    </span>
  );
}

/* ═══════════════════════  EMPTY STATE  ════════════════════════ */
function EmptyState({ search }) {
  return (
    <div style={{ padding: "32px 16px", textAlign: "center" }}>
      <div style={{
        width: 48, height: 48, borderRadius: 14,
        background: "linear-gradient(135deg,#f1f5f9,#e2e8f0)",
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 12px",
      }}>
        <i className="pi pi-users" style={{ fontSize: 20, color: T.faint }} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.muted, marginBottom: 4 }}>
        {search ? "No results found" : "No active patients"}
      </div>
      <div style={{ fontSize: 11, color: T.faint, lineHeight: 1.5 }}>
        {search
          ? `No patient matches "${search}"`
          : "Active IPD admissions will appear here"}
      </div>
    </div>
  );
}

/* ═══════════════════════  MAIN COMPONENT  ═════════════════════ */
export default function AdmittedPatientPanel({ onPatientSelect, selectedId, pageType, stickyTop = 52 }) {
  const [collapsed,       setCollapsed]       = useState(false);
  const [admissions,      setAdmissions]      = useState([]);
  const [discharges,      setDischarges]      = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [search,          setSearch]          = useState("");
  const [activeType,      setActiveType]      = useState("All");
  const [showDischarged,  setShowDischarged]  = useState(false);
  const [lastRefresh,     setLastRefresh]     = useState(null);
  const [refreshing,      setRefreshing]      = useState(false);
  const searchRef = useRef(null);

  /* ── Data fetch ── */
  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      else         setRefreshing(true);
      const token   = (sessionStorage.getItem("his_token"));
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const [activeRes, discRes] = await Promise.allSettled([
        // IPD-only — this panel is literally "Admitted patients", so
        // we must exclude OPD / Day-Care / Services rows that live
        // in the Admission collection without a bed.
        axios.get(`${API}/admissions/active?hasBed=true`,           { headers }),
        axios.get(`${API}/admissions/discharges/today`, { headers }),
      ]);
      if (activeRes.status === "fulfilled") {
        const d = activeRes.value.data;
        setAdmissions(Array.isArray(d) ? d : d?.admissions || d?.data || []);
      }
      if (discRes.status === "fulfilled") {
        const d = discRes.value.data;
        setDischarges(Array.isArray(d) ? d : d?.admissions || d?.data || []);
      }
      setLastRefresh(new Date());
    } catch { /* non-blocking */ }
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Poll every 30s (was 90s) so newly-admitted patients appear in the
    // doctor/nurse panel within seconds of reception completing admission.
    const t = setInterval(() => load(true), 30000);
    return () => clearInterval(t);
  }, [load]);

  // Refresh immediately when the window regains focus (e.g. user switched
  // tabs to reception, admitted a patient, then came back).
  useEffect(() => {
    const onFocus = () => load(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  /* ── Keyboard shortcut: / or Ctrl+K focuses search ── */
  useEffect(() => {
    const handler = (e) => {
      if ((e.key === "/" || (e.ctrlKey && e.key === "k")) && !collapsed) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [collapsed]);

  /* ── Filter ── */
  const filtered = admissions.filter(a => {
    const matchType = activeType === "All" || typeOf(a) === activeType;
    const s = search.trim().toLowerCase();
    const matchSearch = !s ||
      (a.patientName || "").toLowerCase().includes(s) ||
      (a.UHID || "").toLowerCase().includes(s) ||
      (a.bedNumber || "").toLowerCase().includes(s) ||
      (a.attendingDoctor || "").toLowerCase().includes(s) ||
      (a.department || "").toLowerCase().includes(s) ||
      (a.wardName || "").toLowerCase().includes(s);
    return matchType && matchSearch;
  })
  // Sort: NEW admissions (Initial Assessment pending, <24h old) first,
  // then by most-recent admission date.
  .sort((a, b) => {
    const aNew = (() => {
      const d = daysSince(a.admissionDate);
      const pending = !(a.initialAssessment?.doctorCompleted && a.initialAssessment?.nurseCompleted);
      return d !== null && d < 1 && pending ? 1 : 0;
    })();
    const bNew = (() => {
      const d = daysSince(b.admissionDate);
      const pending = !(b.initialAssessment?.doctorCompleted && b.initialAssessment?.nurseCompleted);
      return d !== null && d < 1 && pending ? 1 : 0;
    })();
    if (aNew !== bNew) return bNew - aNew;
    return new Date(b.admissionDate || 0) - new Date(a.admissionDate || 0);
  });

  /* Count per type */
  const counts = {
    All:       admissions.length,
    IPD:       admissions.filter(a => typeOf(a) === "IPD").length,
    Daycare:   admissions.filter(a => typeOf(a) === "Daycare").length,
    Emergency: admissions.filter(a => typeOf(a) === "Emergency").length,
  };

  /* Count new admissions (< 24h old) pending Initial Assessment */
  const newAdmissionsCount = admissions.filter(a => {
    const d = daysSince(a.admissionDate);
    const pending = !(a.initialAssessment?.doctorCompleted && a.initialAssessment?.nurseCompleted);
    return d !== null && d < 1 && pending;
  }).length;

  const W = collapsed ? 56 : 280;

  return (
    <>
      {/* ── Global styles ── */}
      <style>{`
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes shimmer {
          0%   { background-position: -400px 0 }
          100% { background-position:  400px 0 }
        }
        .shimmer {
          background: linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);
          background-size: 800px 100%;
          animation: shimmer 1.4s infinite;
        }
        .adm-panel-list::-webkit-scrollbar { width: 4px; }
        .adm-panel-list::-webkit-scrollbar-track { background: transparent; }
        .adm-panel-list::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        .adm-panel-list::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
      `}</style>

      <div style={{
        width: W, minWidth: W, maxWidth: W,
        background: T.bg,
        borderRight: `1px solid ${T.border}`,
        display: "flex", flexDirection: "column",
        height: `calc(100vh - ${stickyTop}px)`,
        position: "sticky", top: stickyTop,
        flexShrink: 0,
        transition: "width .22s cubic-bezier(.4,0,.2,1), min-width .22s cubic-bezier(.4,0,.2,1)",
        overflowX: "hidden",
        zIndex: 40,
        boxShadow: "2px 0 12px rgba(0,0,0,.05)",
      }}>

        {/* ══════════════  HEADER  ══════════════ */}
        <div style={{
          background: `linear-gradient(135deg, ${T.navy} 0%, ${T.navyMid} 100%)`,
          padding: collapsed ? "14px 0" : "14px 14px 10px",
          flexShrink: 0,
          display: "flex",
          flexDirection: collapsed ? "column" : "row",
          alignItems: collapsed ? "center" : "flex-start",
          justifyContent: collapsed ? "center" : "space-between",
          gap: collapsed ? 10 : 0,
        }}>
          {/* Title block */}
          {!collapsed && (
            <div style={{ flex: 1 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 2,
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: "rgba(255,255,255,.12)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <i className="pi pi-users" style={{ fontSize: 13, color: "#fff" }} />
                </div>
                <span style={{ fontWeight: 800, fontSize: 13, color: "#fff", letterSpacing: "-.2px" }}>
                  Admitted Patients
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 36 }}>
                {loading ? (
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,.5)" }}>Loading…</span>
                ) : (
                  <>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: 10, fontWeight: 700,
                      background: T.green,
                      color: "#fff",
                      padding: "1px 7px", borderRadius: 10,
                    }}>
                      <span style={{
                        width: 5, height: 5, borderRadius: "50%",
                        background: "#fff",
                        animation: "pulse 2s infinite",
                        display: "inline-block",
                      }} />
                      {counts.All} active
                    </span>
                    {refreshing && (
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,.4)" }}>
                        <i className="pi pi-spin pi-refresh" style={{ fontSize: 9 }} />
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? "Expand panel" : "Collapse panel"}
            style={{
              width: 28, height: 28, border: "none",
              background: "rgba(255,255,255,.12)",
              borderRadius: 8, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "rgba(255,255,255,.8)",
              transition: "background .15s",
              flexShrink: 0,
            }}
          >
            <i className={`pi ${collapsed ? "pi-chevron-right" : "pi-chevron-left"}`} style={{ fontSize: 11 }} />
          </button>

          {/* Collapsed: show count bubble */}
          {collapsed && !loading && (
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: T.green,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 800, color: "#fff",
            }}>
              {counts.All}
            </div>
          )}
        </div>

        {/* ══════════════  SEARCH + TABS (expanded only)  ══════════════ */}
        {!collapsed && (
          <>
            {/* Search bar */}
            <div style={{
              padding: "10px 12px 8px",
              borderBottom: `1px solid ${T.border}`,
              flexShrink: 0,
              background: "#fafbfc",
            }}>
              <div style={{ position: "relative" }}>
                <i className="pi pi-search" style={{
                  position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
                  fontSize: 11, color: T.faint, pointerEvents: "none",
                }} />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search name, UHID, bed…"
                  style={{
                    width: "100%", padding: "8px 32px 8px 30px",
                    border: `1.5px solid ${search ? T.purple : T.border}`,
                    borderRadius: 8, fontSize: 12,
                    color: T.text, outline: "none",
                    boxSizing: "border-box",
                    fontFamily: "'DM Sans', sans-serif",
                    background: search ? T.purpleL : "#fff",
                    transition: "all .15s",
                  }}
                />
                {search ? (
                  <button
                    onClick={() => setSearch("")}
                    style={{
                      position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                      border: "none", background: "none", cursor: "pointer",
                      color: T.muted, padding: 2, display: "flex", alignItems: "center",
                    }}
                  >
                    <i className="pi pi-times-circle" style={{ fontSize: 12 }} />
                  </button>
                ) : (
                  <span style={{
                    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                    fontSize: 9, color: T.faint, background: "#f1f5f9",
                    padding: "1px 5px", borderRadius: 4, fontFamily: "monospace", pointerEvents: "none",
                  }}>/</span>
                )}
              </div>
            </div>

            {/* Type tabs */}
            <div style={{
              display: "flex", flexShrink: 0,
              borderBottom: `1px solid ${T.border}`,
              background: "#fafbfc",
              padding: "0 4px",
            }}>
              {TYPES.map(t => {
                const active = activeType === t.key;
                const cnt = counts[t.key];
                return (
                  <button
                    key={t.key}
                    onClick={() => setActiveType(t.key)}
                    style={{
                      flex: 1, padding: "7px 2px", border: "none",
                      background: "transparent", cursor: "pointer",
                      fontSize: 10, fontWeight: active ? 700 : 500,
                      color: active ? t.color : T.muted,
                      borderBottom: `2px solid ${active ? t.color : "transparent"}`,
                      transition: "all .15s",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                      fontFamily: "'DM Sans',sans-serif",
                    }}
                  >
                    <span style={{ position: "relative" }}>
                      <i className={`pi ${t.icon}`} style={{ fontSize: 12 }} />
                      {cnt > 0 && (
                        <span style={{
                          position: "absolute", top: -5, right: -8,
                          background: active ? t.color : "#cbd5e1",
                          color: active ? "#fff" : T.muted,
                          fontSize: 8, fontWeight: 800,
                          minWidth: 14, height: 14, borderRadius: 7,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          padding: "0 3px",
                          transition: "all .15s",
                        }}>{cnt}</span>
                      )}
                    </span>
                    <span style={{ fontSize: 9 }}>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ══════════════  NEW-ADMISSION BANNER  ══════════════ */}
        {!collapsed && newAdmissionsCount > 0 && (
          <div style={{
            margin: "8px 10px 0",
            padding: "8px 12px",
            borderRadius: 8,
            background: "linear-gradient(135deg, #fef2f2, #fff7ed)",
            border: "1.5px solid #fca5a5",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: "50%",
              background: "linear-gradient(135deg, #dc2626, #f97316)",
              color: "#fff", fontSize: 11, fontWeight: 900,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
              animation: "pulseNew 1.5s ease-in-out infinite",
            }}>{newAdmissionsCount}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#991b1b", letterSpacing: ".2px" }}>
                NEW ADMISSION{newAdmissionsCount > 1 ? "S" : ""}
              </div>
              <div style={{ fontSize: 10, color: "#9a3412" }}>
                Initial Assessment pending
              </div>
            </div>
          </div>
        )}

        {/* ══════════════  PATIENT LIST  ══════════════ */}
        <div className="adm-panel-list" style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>

          {/* Loading skeletons */}
          {loading && (
            <div>
              {[1,2,3,4].map(i => <SkeletonCard key={i} />)}
            </div>
          )}

          {/* Empty state */}
          {!loading && filtered.length === 0 && !collapsed && (
            <EmptyState search={search} />
          )}

          {/* Patient cards */}
          {!loading && filtered.map(adm => (
            <PatientCard
              key={adm._id}
              adm={adm}
              selected={selectedId === adm._id}
              collapsed={collapsed}
              onClick={() => onPatientSelect?.(adm)}
            />
          ))}

          {/* Discharges section */}
          {!collapsed && !loading && discharges.length > 0 && (
            <div>
              <button
                onClick={() => setShowDischarged(s => !s)}
                style={{
                  width: "100%", padding: "8px 14px", border: "none",
                  background: "#f8fafc", cursor: "pointer",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  borderTop: `1px solid ${T.border}`,
                  borderBottom: showDischarged ? `1px solid ${T.border}` : "none",
                  fontFamily: "'DM Sans',sans-serif",
                }}
              >
                <span style={{
                  fontSize: 10, fontWeight: 700, color: T.muted,
                  letterSpacing: ".5px", textTransform: "uppercase",
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                  <i className="pi pi-sign-out" style={{ fontSize: 9 }} />
                  Today's Discharges
                  <span style={{
                    background: "#e2e8f0", color: T.muted,
                    fontSize: 9, fontWeight: 700,
                    padding: "1px 6px", borderRadius: 8,
                  }}>{discharges.length}</span>
                </span>
                <i
                  className={`pi ${showDischarged ? "pi-chevron-up" : "pi-chevron-down"}`}
                  style={{ fontSize: 9, color: T.faint }}
                />
              </button>
              {showDischarged && discharges.map(adm => (
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

        {/* ══════════════  FOOTER  ══════════════ */}
        {!collapsed && (
          <div style={{
            padding: "7px 12px",
            borderTop: `1px solid ${T.border}`,
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: "#fafbfc", flexShrink: 0,
          }}>
            <span style={{ fontSize: 10, color: T.faint }}>
              {lastRefresh
                ? `Updated ${lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : "Auto-refresh 90s"}
            </span>
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              style={{
                border: "none", background: "none", cursor: refreshing ? "default" : "pointer",
                fontSize: 10, color: refreshing ? T.faint : T.purple,
                display: "flex", alignItems: "center", gap: 4,
                fontWeight: 600, fontFamily: "'DM Sans',sans-serif",
                opacity: refreshing ? .6 : 1,
              }}
            >
              <i className={`pi ${refreshing ? "pi-spin pi-refresh" : "pi-refresh"}`} style={{ fontSize: 10 }} />
              Refresh
            </button>
          </div>
        )}
      </div>
    </>
  );
}
