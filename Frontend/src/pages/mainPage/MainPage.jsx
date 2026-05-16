import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";

const C = {
  accent: "#1e40af",
  slate:  "#1e293b",
  green:  "#16a34a",
  red:    "#dc2626",
  amber:  "#d97706",
  teal:   "#0d9488",
  purple: "#7c3aed",
  orange: "#ea580c",
  pink:   "#db2777",
  border: "#e2e6ea",
  muted:  "#6b7280",
  bg:     "#f0f2f5",
  card:   "#ffffff",
  text:   "#1a1d23",
};

/* ── KPI tiles ── */
const STATS = [
  { key: "opd",       label: "OPD Today",      icon: "pi-calendar",        color: C.teal,   bg: "#f0fdfa" },
  { key: "ipd",       label: "IPD Census",      icon: "pi-users",           color: C.accent, bg: "#eff6ff" },
  { key: "emergency", label: "Emergency",       icon: "pi-exclamation-circle", color: C.red, bg: "#fef2f2" },
  { key: "beds",      label: "Beds Available",  icon: "pi-th-large",        color: C.green,  bg: "#f0fdf4" },
  { key: "ot",        label: "OT Scheduled",    icon: "pi-clock",           color: C.purple, bg: "#f5f3ff" },
  { key: "discharge", label: "Discharges Today",icon: "pi-sign-out",        color: C.amber,  bg: "#fffbeb" },
];

/* ── All module definitions with role restrictions ── */
const ALL_MODULES = [
  // Front Desk / Receptionist
  { label: "New OPD",              icon: "pi-plus-circle",          path: "/reception",       color: C.teal,   roles: ["Admin","Receptionist"] },
  { label: "IPD Registration",     icon: "pi-user-plus",            path: "/reception",       color: C.accent, roles: ["Admin","Receptionist"] },
  { label: "Emergency",            icon: "pi-exclamation-circle",   path: "/reception", color: C.red,    roles: ["Admin","Receptionist","Nurse","Doctor"] },
  { label: "Daycare",              icon: "pi-sun",                  path: "/reception",   color: C.orange, roles: ["Admin","Receptionist"] },
  { label: "Bed Visual",           icon: "pi-th-large",             path: "/bed-visual",             color: C.purple, roles: ["Admin","Doctor","Nurse","Receptionist"] },
  { label: "Patient Billing",      icon: "pi-receipt",              path: "/patient-billing",        color: C.green,  roles: ["Admin","Receptionist","TPA Coordinator"] },
  // Doctor
  { label: "Emergency Assessment", icon: "pi-exclamation-triangle", path: "/emergency-assessment",   color: C.red,    roles: ["Admin","Doctor"] },
  { label: "IPD Initial Assessment",icon: "pi-clipboard",           path: "/ipd-assessment",         color: C.pink,   roles: ["Admin","Doctor","Nurse"] },
  { label: "IPD Daily Assessment", icon: "pi-stethoscope",          path: "/doctor-assessment",      color: C.slate,  roles: ["Admin","Doctor"] },
  { label: "Discharge Summary",    icon: "pi-file-edit",            path: "/discharge-summary",      color: C.purple, roles: ["Admin","Doctor"] },
  { label: "Consent Forms",        icon: "pi-shield",               path: "/consent-forms",          color: C.green,  roles: ["Admin","Doctor","Nurse"] },
  // Nursing
  { label: "Nursing Notes",        icon: "pi-heart",                path: "/nursing-notes",          color: C.pink,   roles: ["Admin","Nurse"] },
  { label: "Handover Notes",       icon: "pi-arrow-right-arrow-left",path: "/nursing-handover-notes",color: C.teal,   roles: ["Admin","Nurse"] },
  { label: "MAR",                  icon: "pi-list-check",           path: "/mar",                    color: C.amber,  roles: ["Admin","Nurse","Doctor"] },
  // Admin
  { label: "User Management",      icon: "pi-users",                path: "/admin/users",            color: C.purple, roles: ["Admin"] },
  { label: "IPD Admission",        icon: "pi-building",             path: "/reception",          color: C.accent, roles: ["Admin","Receptionist"] },
];

/* ── Filter modules by role ── */
const getModules = (role) => ALL_MODULES.filter(m => m.roles.includes(role));

/* ── Quick Access per role ── */
const QUICK_ACCESS_MAP = {
  Admin:            [
    { label: "New OPD",          icon: "pi-plus-circle",       path: "/reception",      color: C.teal   },
    { label: "IPD Admission",    icon: "pi-building",          path: "/reception",          color: C.accent },
    { label: "Emergency",        icon: "pi-exclamation-circle",path: "/reception", color: C.red    },
    { label: "Patient Search",   icon: "pi-search",            path: "/allpatient",             color: C.purple },
    { label: "Patient Billing",  icon: "pi-receipt",           path: "/patient-billing",        color: C.green  },
    { label: "User Management",  icon: "pi-users",             path: "/admin/users",            color: C.purple },
  ],
  Receptionist:     [
    { label: "New OPD",          icon: "pi-plus-circle",       path: "/reception",      color: C.teal   },
    { label: "IPD Admission",    icon: "pi-building",          path: "/reception",          color: C.accent },
    { label: "Emergency",        icon: "pi-exclamation-circle",path: "/reception", color: C.red    },
    { label: "Patient Search",   icon: "pi-search",            path: "/allpatient",             color: C.purple },
    { label: "Patient Billing",  icon: "pi-receipt",           path: "/patient-billing",        color: C.green  },
    { label: "Bed Layout",       icon: "pi-th-large",          path: "/bed-visual",             color: C.amber  },
  ],
  Doctor:           [
    { label: "IPD Assessment",   icon: "pi-stethoscope",       path: "/doctor-assessment",      color: C.slate  },
    { label: "Discharge Summary",icon: "pi-file-edit",         path: "/discharge-summary",      color: C.purple },
    { label: "Consent Forms",    icon: "pi-shield",            path: "/consent-forms",          color: C.green  },
    { label: "MAR",              icon: "pi-list-check",        path: "/mar",                    color: C.amber  },
    { label: "Patient Search",   icon: "pi-search",            path: "/allpatient",             color: C.accent },
  ],
  Nurse:            [
    { label: "Nursing Notes",    icon: "pi-heart",             path: "/nursing-notes",          color: C.pink   },
    { label: "MAR",              icon: "pi-list-check",        path: "/mar",                    color: C.amber  },
    { label: "Handover Notes",   icon: "pi-arrow-right-arrow-left",path: "/nursing-handover-notes",color: C.teal},
  ],
  "TPA Coordinator":[
    { label: "Patient Billing",  icon: "pi-receipt",           path: "/patient-billing",        color: C.green  },
    { label: "Bills List",       icon: "pi-list",              path: "/billing",                color: C.amber  },
    { label: "Patient Search",   icon: "pi-search",            path: "/allpatient",             color: C.purple },
    { label: "TPA Services",     icon: "pi-plus-circle",       path: "/addservice",             color: C.teal   },
  ],
  Pharmacist:       [
    { label: "Patient Search",   icon: "pi-search",            path: "/allpatient",             color: C.purple },
  ],
  Dietician:        [
    { label: "Patient Search",   icon: "pi-search",            path: "/allpatient",             color: C.purple },
    { label: "Nursing Notes",    icon: "pi-heart",             path: "/nursing-notes",          color: C.pink   },
  ],
  "Lab Technician": [
    { label: "Patient Search",   icon: "pi-search",            path: "/allpatient",             color: C.purple },
  ],
};

const isDoctor = (role) => role === "Doctor" || role === "Admin";
const isNurse  = (role) => role === "Nurse"  || role === "Admin";

export default function MainPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role || "Admin";
  const modules    = getModules(role);
  const quickAccess = QUICK_ACCESS_MAP[role] || QUICK_ACCESS_MAP["Admin"];
  const [stats, setStats] = useState({ opd: "—", ipd: "—", emergency: "—", beds: "—", ot: "—", discharge: "—" });
  const [recent, setRecent] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [qaOpen, setQaOpen] = useState(false);

  /* ── Doctor's Worklist ── */
  const [worklist, setWorklist] = useState([]);
  const [loadingWorklist, setLoadingWorklist] = useState(false);

  /* ── Load last 10 patients as recent activity ── */
  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get(API_ENDPOINTS.PATIENTS + "?limit=10&sort=-createdAt");
        const rows = (res.data?.data || res.data || []).slice(0, 10);
        setRecent(rows);
      } catch {
        setRecent([]);
      } finally {
        setLoadingRecent(false);
      }
    };
    load();
  }, []);

  /* ── Load Doctor's Worklist (today's OPD + active IPD/Emergency) ── */
  useEffect(() => {
    if (!isDoctor(user?.role)) return;
    const load = async () => {
      setLoadingWorklist(true);
      try {
        // Today's OPD/Emergency patients (registered patients)
        const ptRes = await axios.get(API_ENDPOINTS.PATIENTS + "?limit=50&sort=-createdAt");
        const allPts = (ptRes.data?.data || ptRes.data || []);
        const todayStr = new Date().toDateString();
        const todayPts = allPts.filter(p => {
          const d = p.createdAt || p.registrationDate;
          return d && new Date(d).toDateString() === todayStr;
        });

        // Active IPD admissions — hasBed=true excludes OPD / Day-Care /
        // Services stubs that also live in the Admission collection.
        let admissions = [];
        try {
          const admRes = await axios.get(API_ENDPOINTS.ADMISSIONS + "/active?hasBed=true");
          admissions = (admRes.data?.data || admRes.data || []).slice(0, 20);
        } catch { /* admissions may not exist yet */ }

        // Build unified worklist rows
        const rows = [
          ...todayPts.map(p => ({
            _id: p._id,
            uhid: p.UHID,
            name: (p.title ? p.title + " " : "") + (p.fullName || `${p.firstName || ""} ${p.lastName || ""}`).trim(),
            age: p.age,
            gender: p.gender,
            type: p.registrationType || "OPD",
            time: p.createdAt || p.registrationDate,
            status: "Pending",
          })),
          ...admissions.map(a => ({
            _id: a._id,
            uhid: a.patientUHID || a.uhid,
            name: a.patientName || a.name,
            age: a.age,
            gender: a.gender,
            type: "IPD",
            time: a.admissionDate || a.createdAt,
            ward: a.wardName || a.ward,
            bed: a.bedNumber || a.bed,
            status: "Pending",
          })),
        ].filter(r => r.uhid); // must have a UHID to be actionable

        setWorklist(rows);
      } catch {
        setWorklist([]);
      } finally {
        setLoadingWorklist(false);
      }
    };
    load();
  }, [user?.role]);

  /* ── Clock ── */
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const fmtClock = (d) =>
    d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fmtDate = (d) =>
    d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <>
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>

      {/* ── Welcome banner ── */}
      <div style={{
        background: `linear-gradient(135deg, ${C.slate} 0%, #0f172a 100%)`,
        borderRadius: 14, padding: "22px 28px", marginBottom: 20,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "relative", overflow: "hidden",
      }}>
        {/* Decorative circles */}
        <div style={{ position: "absolute", top: -40, right: 120, width: 200, height: 200,
          background: "radial-gradient(circle, rgba(56,189,248,.12), transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -30, right: -20, width: 160, height: 160,
          background: "radial-gradient(circle, rgba(30,64,175,.2), transparent 70%)", pointerEvents: "none" }} />

        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <span style={{ background: "rgba(56,189,248,.15)", border: "1px solid rgba(56,189,248,.3)",
              color: "#38bdf8", padding: "2px 10px", borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
              NABH ACCREDITED
            </span>
            <span style={{ background: "rgba(22,163,74,.15)", border: "1px solid rgba(22,163,74,.3)",
              color: "#4ade80", padding: "2px 10px", borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
              HIS v2.0
            </span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "white", lineHeight: 1.2 }}>
            Good {clock.getHours() < 12 ? "Morning" : clock.getHours() < 17 ? "Afternoon" : "Evening"}
          </div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 3 }}>
            {fmtDate(clock)} · SphereHealth Hospital Information System
          </div>
        </div>
        <div style={{ textAlign: "right", position: "relative" }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 28, fontWeight: 700, color: "white", lineHeight: 1 }}>
            {fmtClock(clock)}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Live System Clock</div>
        </div>
      </div>

      {/* ── KPI Stats strip ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginBottom: 20 }}>
        {STATS.map(s => (
          <div key={s.key} style={{
            background: s.bg, border: `1.5px solid ${s.color}22`,
            borderRadius: 12, padding: "14px 16px",
            display: "flex", flexDirection: "column", gap: 4,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                letterSpacing: ".8px", color: C.muted }}>
                {s.label}
              </span>
              <i className={`pi ${s.icon}`} style={{ fontSize: 14, color: s.color }} />
            </div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 28, fontWeight: 700,
              color: s.color, lineHeight: 1 }}>
              {stats[s.key]}
            </div>
          </div>
        ))}
      </div>

      {/* ── Quick Module Launcher ── */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        overflow: "hidden", marginBottom: 20,
      }}>
        <div style={{
          padding: "13px 20px", borderBottom: `1px solid ${C.border}`,
          background: "#f8fafc", display: "flex", alignItems: "center", gap: 8,
        }}>
          <i className="pi pi-th-large" style={{ color: C.accent, fontSize: 14 }} />
          <span style={{ fontWeight: 700, fontSize: 13 }}>Quick Actions</span>
          <span style={{ fontSize: 11, color: C.muted, marginLeft: 4 }}>— Module Launcher</span>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 10,
          }}>
            {modules.map((m, i) => (
              // FIX: duplicate-key warning — many module tiles share the same
              // path ("/reception" for OPD / IPD / Emergency / Daycare entry
              // points). Compose the key from label + index so each tile is
              // uniquely identified to React.
              <button key={`${m.label}-${i}`} onClick={() => navigate(m.path)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "12px 14px", border: `1.5px solid ${m.color}30`,
                  borderRadius: 10, background: "white", cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: 12,
                  color: C.text, textAlign: "left",
                  transition: "all .2s",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = m.color;
                  e.currentTarget.style.background = m.color + "08";
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = `0 4px 12px ${m.color}20`;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = m.color + "30";
                  e.currentTarget.style.background = "white";
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <span style={{
                  width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                  background: m.color + "15", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <i className={`pi ${m.icon}`} style={{ fontSize: 14, color: m.color }} />
                </span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Nurse Quick Links (Nurse only) ── */}
      {isNurse(user?.role) && !isDoctor(user?.role) && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
          <div style={{ padding: "13px 20px", borderBottom: `1px solid ${C.border}`, background: "#fdf2f8",
            display: "flex", alignItems: "center", gap: 8 }}>
            <i className="pi pi-heart" style={{ color: C.pink, fontSize: 14 }} />
            <span style={{ fontWeight: 700, fontSize: 13 }}>Nursing Workflow</span>
            <span style={{ fontSize: 11, color: C.muted }}>— Today's nursing tasks</span>
          </div>
          <div style={{ padding: "14px 20px", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 10 }}>
            {[
              { label: "Nursing Notes",      icon: "pi-pencil",                 path: "/nursing-notes",            color: C.pink,   desc: "All nursing assessments & notes" },
              { label: "MAR",                icon: "pi-list-check",             path: "/mar",                      color: C.amber,  desc: "Medication administration" },
              { label: "Handover Notes",     icon: "pi-arrow-right-arrow-left", path: "/nursing-handover-notes",   color: C.teal,   desc: "Shift handover documentation" },
            ].map((item, i) => (
              <button key={`${item.label}-${i}`} onClick={() => navigate(item.path)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
                  border: `1.5px solid ${item.color}25`, borderRadius: 10, background: "white",
                  cursor: "pointer", fontFamily: "'DM Sans',sans-serif", textAlign: "left", transition: "all .2s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = item.color; e.currentTarget.style.background = item.color+"08"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = item.color+"25"; e.currentTarget.style.background = "white"; e.currentTarget.style.transform = "none"; }}>
                <span style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                  background: item.color+"15", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <i className={`pi ${item.icon}`} style={{ fontSize: 15, color: item.color }} />
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: C.text }}>{item.label}</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{item.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Doctor's Worklist (Doctor / Admin only) ── */}
      {isDoctor(user?.role) && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          overflow: "hidden", marginBottom: 20,
        }}>
          <div style={{
            padding: "13px 20px", borderBottom: `1px solid ${C.border}`,
            background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <i className="pi pi-stethoscope" style={{ color: C.purple, fontSize: 14 }} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>Doctor's Worklist</span>
              <span style={{ fontSize: 11, color: C.muted }}>— Today's Pending Assessments</span>
              {worklist.length > 0 && (
                <span style={{ background: C.red + "18", color: C.red, border: `1px solid ${C.red}30`,
                  fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 10 }}>
                  {worklist.filter(r => r.status === "Pending").length} pending
                </span>
              )}
            </div>
            <button onClick={() => navigate("/doctor-assessment")}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px",
                border: `1.5px solid ${C.border}`, borderRadius: 7, background: "white",
                cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                fontSize: 12, fontWeight: 600, color: C.purple }}>
              IPD Assessment <i className="pi pi-arrow-right" style={{ fontSize: 10 }} />
            </button>
          </div>

          {loadingWorklist ? (
            <div style={{ padding: 32, textAlign: "center", color: C.muted }}>
              <i className="pi pi-spin pi-spinner" style={{ fontSize: 18, marginBottom: 6, display: "block" }} />
              <div style={{ fontSize: 12 }}>Loading worklist…</div>
            </div>
          ) : worklist.length === 0 ? (
            <div style={{ padding: 36, textAlign: "center", color: C.muted }}>
              <i className="pi pi-check-circle" style={{ fontSize: 28, marginBottom: 8, display: "block", color: "#86efac" }} />
              <div style={{ fontSize: 13, fontWeight: 600 }}>No pending assessments today</div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="his-table">
                <thead>
                  <tr>
                    {["UHID", "Patient", "Age/Gender", "Type", "Registered At", "Location", "Status", "Action"].map(h => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {worklist.map((row, i) => {
                    const typeColor = { OPD: C.teal, IPD: C.accent, Emergency: C.red, Daycare: C.amber }[row.type] || C.muted;
                    const timeStr = row.time
                      ? new Date(row.time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                      : "—";
                    return (
                      <tr key={row._id || i}>
                        <td>
                          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12,
                            fontWeight: 600, color: C.accent }}>{row.uhid || "—"}</span>
                        </td>
                        <td style={{ fontWeight: 600 }}>{row.name || "—"}</td>
                        <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                          {row.age ? `${row.age}y` : "—"} / {row.gender?.[0] || "—"}
                        </td>
                        <td>
                          <span style={{ background: typeColor + "15", color: typeColor,
                            border: `1px solid ${typeColor}30`, padding: "2px 8px",
                            borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: ".6px" }}>
                            {row.type}
                          </span>
                        </td>
                        <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{timeStr}</td>
                        <td style={{ fontSize: 12, color: C.muted }}>
                          {row.ward ? `${row.ward}${row.bed ? " · Bed " + row.bed : ""}` : "OPD"}
                        </td>
                        <td>
                          <span style={{ background: C.amberL, color: C.amber,
                            border: `1px solid ${C.amber}30`, padding: "2px 8px",
                            borderRadius: 5, fontSize: 10, fontWeight: 700 }}>
                            {row.status}
                          </span>
                        </td>
                        <td>
                          <button
                            onClick={() => {
                              if (row.type === "IPD") navigate(`/ipd-assessment/${row.uhid}`);
                              else if (row.type === "Emergency") navigate(`/emergency-assessment/${row.uhid}`);
                              else navigate(`/doctor-opd-panel`);
                            }}
                            style={{ padding: "5px 12px", borderRadius: 7, border: "none",
                              background: row.type === "IPD" ? C.accent : C.teal,
                              color: "white", cursor: "pointer",
                              fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600 }}>
                            <i className="pi pi-stethoscope" style={{ fontSize: 10, marginRight: 4 }} />
                            Assess
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Recent Registrations ── */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden",
      }}>
        <div style={{
          padding: "13px 20px", borderBottom: `1px solid ${C.border}`,
          background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i className="pi pi-users" style={{ color: C.accent, fontSize: 14 }} />
            <span style={{ fontWeight: 700, fontSize: 13 }}>Recent Registrations</span>
          </div>
          <button onClick={() => navigate("/allpatient")}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", border: `1.5px solid ${C.border}`,
              borderRadius: 7, background: "white", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: C.accent,
            }}>
            View All <i className="pi pi-arrow-right" style={{ fontSize: 10 }} />
          </button>
        </div>

        {loadingRecent ? (
          <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
            <i className="pi pi-spin pi-spinner" style={{ fontSize: 20, marginBottom: 8 }} />
            <div style={{ fontSize: 12 }}>Loading…</div>
          </div>
        ) : recent.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
            <i className="pi pi-inbox" style={{ fontSize: 28, marginBottom: 8, display: "block" }} />
            <div style={{ fontSize: 12 }}>No recent registrations</div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="his-table">
              <thead>
                <tr>
                  {["UHID", "Patient Name", "Age / Gender", "Contact", "Blood Group", "Reg Type", "Status", "Actions"].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((p, i) => {
                  const regType = p.registrationType || p.regType || "—";
                  const typeColor = {
                    OPD: C.teal, IPD: C.accent, Emergency: C.red, Daycare: C.amber, Services: C.green,
                  }[regType] || C.muted;
                  return (
                    <tr key={p._id || i}>
                      <td>
                        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 600,
                          color: C.accent }}>
                          {p.UHID || "—"}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {p.title ? `${p.title} ` : ""}{p.fullName || "—"}
                      </td>
                      <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                        {p.age ? `${p.age}y` : "—"} / {p.gender?.[0] || "—"}
                      </td>
                      <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                        {p.contactNumber || "—"}
                      </td>
                      <td>
                        {p.bloodGroup ? (
                          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700,
                            background: "#fef2f2", color: C.red, padding: "2px 8px", borderRadius: 4 }}>
                            {p.bloodGroup}
                          </span>
                        ) : "—"}
                      </td>
                      <td>
                        <span style={{ background: typeColor + "15", color: typeColor,
                          border: `1px solid ${typeColor}30`, padding: "2px 8px",
                          borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: ".6px" }}>
                          {regType}
                        </span>
                      </td>
                      <td>
                        <span className="his-badge his-status-active">Active</span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => navigate(`/patients/${p._id}`)}
                            style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`,
                              background: "white", cursor: "pointer", fontSize: 11, fontWeight: 600, color: C.accent }}>
                            <i className="pi pi-eye" style={{ fontSize: 10, marginRight: 4 }} />View
                          </button>
                          {(role === "Admin" || role === "Receptionist") && (
                            <button onClick={() => navigate(`/reception?patientId=${p._id}&visit=IPD`)}
                              style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`,
                                background: "white", cursor: "pointer", fontSize: 11, fontWeight: 600, color: C.muted }}>
                              <i className="pi pi-file-edit" style={{ fontSize: 10, marginRight: 4 }} />Edit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>

      {/* ── Floating Quick Access Button ── */}
      <div style={{ position: "fixed", bottom: 28, right: 28, zIndex: 500 }}>
        {/* Panel */}
        {qaOpen && (
          <div style={{
            position: "absolute", bottom: 64, right: 0,
            background: "white", border: "1px solid #e2e6ea", borderRadius: 16,
            boxShadow: "0 12px 40px rgba(0,0,0,.18)", width: 280,
            overflow: "hidden", animation: "qaSlide .2s ease",
          }}>
            <style>{`@keyframes qaSlide{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>
            <div style={{ padding: "12px 16px", background: C.slate, color: "white",
              display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <i className="pi pi-bolt" style={{ fontSize: 13 }} />
                <span style={{ fontSize: 13, fontWeight: 700 }}>Quick Access</span>
              </div>
              <span style={{ fontSize: 10, color: "#64748b" }}>Tell us what else to add here</span>
            </div>
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {quickAccess.map((item, i) => (
                <button key={`${item.label}-${i}`}
                  onClick={() => { navigate(item.path); setQaOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px", borderRadius: 10,
                    border: `1.5px solid ${item.color}20`,
                    background: item.color + "08", cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600,
                    color: C.text, textAlign: "left", transition: "all .15s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = item.color + "18"; e.currentTarget.style.borderColor = item.color + "50"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = item.color + "08"; e.currentTarget.style.borderColor = item.color + "20"; }}
                >
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: item.color + "20",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <i className={`pi ${item.icon}`} style={{ fontSize: 14, color: item.color }} />
                  </span>
                  {item.label}
                  <i className="pi pi-arrow-right" style={{ fontSize: 10, color: C.muted, marginLeft: "auto" }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* FAB Button */}
        <button onClick={() => setQaOpen(p => !p)}
          style={{
            width: 52, height: 52, borderRadius: "50%",
            background: qaOpen ? C.slate : C.accent,
            border: "none", color: "white", cursor: "pointer",
            boxShadow: "0 6px 20px rgba(30,64,175,.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, transition: "all .2s",
          }}>
          <i className={`pi ${qaOpen ? "pi-times" : "pi-bolt"}`} />
        </button>
      </div>
    </>
  );
}
