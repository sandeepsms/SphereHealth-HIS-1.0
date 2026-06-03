/**
 * NABHRegistersDashboard.jsx — R7bo
 *
 * Unified surveyor-facing view of the NABH compliance registers added in
 * R7bo (RBS / Emergency / Blood Transfusion). Shows today + 7-day count
 * per register and lets the user drill into the chronological log.
 *
 *   URL: /compliance/nabh-registers
 *
 * Auto-populated from existing clinical flows via nabhRegisterEmitter; this
 * page is read-only (drill into the register pages for entry). Date-range
 * filter + per-register table.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, Card, Table, EmptyRow, Badge, C,
} from "../../Components/admin-theme";
import { API_BASE_URL as API } from "../../config/api";
import { useAuth } from "../../context/AuthContext";

/* ════════════════════════════════════════════════════════════════
   R7ej — REGISTER TILES
   15 stand-alone NABH register pages that previously had their own
   sidebar entries. Collapsed here as categorized tiles to declutter
   the sidebar. Role gating on each route still applies — clicking
   a tile a user cannot access will hit the route guard.
══════════════════════════════════════════════════════════════ */
const REGISTER_CATEGORIES = [
  {
    id: "safety",
    title: "Patient Safety & Sentinel Events",
    subtitle: "High-priority surveyor questions — incidents, callbacks, complaints",
    accent: "#dc2626",
    tiles: [
      { label: "Critical Value Alerts", icon: "pi-bell",                 path: "/critical-value-alerts", nabhRef: "AAC.6", desc: "Lab callback acknowledgement log" },
      { label: "Grievance Register",    icon: "pi-comment",              path: "/grievances",            nabhRef: "PRE.6", desc: "Patient/relative complaints + resolution" },
      { label: "ADR Reports",           icon: "pi-flag",                 path: "/adr-reports",           nabhRef: "MOM.7", desc: "Adverse drug reactions reported to PvPI" },
      { label: "Food Reactions",        icon: "pi-exclamation-triangle", path: "/food-reactions",        nabhRef: "NEW",   desc: "Adverse food / diet sentinel events" },
      { label: "Sharps Injury",         icon: "pi-info-circle",          path: "/sharps-injury",         nabhRef: "HRD.8", desc: "Needle-stick + sharps exposure register" },
      { label: "Code Response Log",     icon: "pi-bolt",                 path: "/code-response",         nabhRef: "NEW",   desc: "Code blue / pink / purple / black events" },
    ],
  },
  {
    id: "outcomes",
    title: "Clinical Outcome Registers",
    subtitle: "Auto-populated from doctor orders, procedures, admissions, discharges",
    accent: "#7c3aed",
    tiles: [
      { label: "OT Register",          icon: "pi-briefcase",    path: "/compliance/nabh/ot-register",            nabhRef: "COP.10", desc: "Surgeries with surgeon / anaesthetist / start-end" },
      { label: "Anaesthesia Register", icon: "pi-shield",       path: "/compliance/nabh/asa-register",           nabhRef: "COP.13", desc: "ASA grading + anaesthesia complications" },
      { label: "Readmission Register", icon: "pi-reply",        path: "/compliance/nabh/readmission-register",   nabhRef: "COP.16", desc: "Unplanned 30-day readmissions with cause" },
      { label: "Mortality Register",   icon: "pi-times-circle", path: "/compliance/nabh/mortality-register",     nabhRef: "COP.18", desc: "All in-hospital deaths + cause + reviews" },
      { label: "Restraint Register",   icon: "pi-lock",         path: "/compliance/nabh/restraint-register",     nabhRef: "COP.17", desc: "Physical / chemical restraint episodes" },
      { label: "Antimicrobial Use",    icon: "pi-stop-circle",  path: "/compliance/nabh/antimicrobial-register", nabhRef: "MOM.7",  desc: "Antibiotic stewardship — start/stop/de-escalation" },
    ],
  },
  {
    id: "infection-facility",
    title: "Infection Control & Facilities",
    subtitle: "HIC committee + FMS committee evidence trail",
    accent: "#0d9488",
    tiles: [
      { label: "HIC.5 Infection Control", icon: "pi-shield",  path: "/compliance/hic5-infection-control", nabhRef: "HIC.5", desc: "VAP / CAUTI / CLABSI / DVT / Sepsis / SUP trend" },
      { label: "BMW Manifest",            icon: "pi-truck",   path: "/bmw-manifest",                      nabhRef: "FMS.5", desc: "Biomedical waste cart-out → vendor → PCB" },
      { label: "Fire Drill Register",     icon: "pi-shield",  path: "/fire-drills",                       nabhRef: "FMS.4", desc: "Quarterly fire drills + participation logs" },
    ],
  },
];

/* ════════════════════════════════════════════════════════════════
   R7ek — LIVE CLINICAL REGISTERS
   Seven registers auto-populated from clinical save paths (vitals,
   ER intake, transfusion, assessments). Same page renders the
   chronological log inline when a tile is clicked — no separate
   routes. Replaces the old tab-bar UX.
══════════════════════════════════════════════════════════════ */
const LIVE_REGISTERS = [
  { id: "blood-sugar",       label: "Blood Sugar (RBS)",       icon: "pi-chart-line",  nabhRef: "AAC.4",  desc: "All RBS readings — critical flagging at <70 / >300 mg/dL" },
  { id: "emergency",         label: "Emergency Register",      icon: "pi-bolt",        nabhRef: "AAC.5",  desc: "ER intake, triage, door-to-disposition time, MLC" },
  { id: "blood-transfusion", label: "Blood Transfusion",       icon: "pi-flag-fill",   nabhRef: "COP.18", desc: "Transfusions with group / units / reaction tracking" },
  { id: "pain",              label: "Pain Assessment",         icon: "pi-heart-fill",  nabhRef: "COP.6",  desc: "Pain scale + severity + intervention log" },
  { id: "fall-risk",         label: "Fall Risk (Morse)",       icon: "pi-arrow-down",  nabhRef: "COP.4",  desc: "Morse fall scale + risk tier + history" },
  { id: "pressure-ulcer",    label: "Pressure Ulcer (Braden)", icon: "pi-info-circle", nabhRef: "COP.4",  desc: "Braden score + ulcer stage + HAPU flagging" },
  { id: "dvt",               label: "DVT / VTE (Caprini)",     icon: "pi-shield",      nabhRef: "COP.4",  desc: "Caprini + IMPROVE bleed + recommended prophylaxis" },
  // R7en — ECG Register (NABH AAC.4 / IPSG.2 / COP.7)
  { id: "ecg",               label: "ECG Register",            icon: "pi-bolt",        nabhRef: "AAC.4 / COP.7", desc: "12-lead ECG findings, critical-rhythm flagging, cardiologist review" },
];
const LIVE_ACCENT = "#0891b2";

/* ════════════════════════════════════════════════════════════════
   R7gw — INCIDENT REPORTING & SURVEILLANCE REGISTERS (B9-T01..T07)
   Seven NABH-mandated registers built in sprint R7em→R7er covering
   sentinel events, near-miss tracking, RCA, medication errors,
   HAI surveillance, hand hygiene, and LAMA/DAMA. Each tile shows a
   recent row count fetched from the corresponding list endpoint
   (falls back to "—" on auth/network failure). Role-gated to
   Admin / ComplianceOfficer / MRD; the route guard still applies
   to the destination page.
══════════════════════════════════════════════════════════════ */
const INCIDENT_REGISTERS = [
  { id: "sentinel-events",  label: "Sentinel Event",       icon: "pi-exclamation-triangle", path: "/compliance/nabh-registers/sentinelevent",   apiPath: "nabh-registers/sentinel-events",    nabhRef: "PSQ.4",  desc: "Sentinel events — never-events + serious safety incidents" },
  { id: "near-miss-events", label: "Near-Miss Event",      icon: "pi-eye",                  path: "/compliance/nabh-registers/nearmissevent",   apiPath: "nabh-registers/near-miss-events",   nabhRef: "PSQ.4",  desc: "Near-miss tracking — caught-before-harm safety events" },
  { id: "rca",              label: "Root Cause Analysis",  icon: "pi-sitemap",              path: "/compliance/nabh-registers/rca",             apiPath: "rca-register",                      nabhRef: "PSQ.4",  desc: "RCA investigations linked to sentinel + near-miss events" },
  { id: "medication-error", label: "Medication Error",     icon: "pi-pause-circle",         path: "/compliance/nabh-registers/medicationerror", apiPath: "nabh-registers/medicationerror",    nabhRef: "MOM.7",  desc: "Prescribing / dispensing / administration errors" },
  { id: "hai-surveillance", label: "HAI Surveillance",     icon: "pi-search",               path: "/compliance/nabh-registers/haisurveillance", apiPath: "nabh-registers/hai-surveillance",   nabhRef: "HIC.5",  desc: "Healthcare-associated infection surveillance + device-day rates" },
  { id: "hand-hygiene",     label: "Hand Hygiene",         icon: "pi-thumbs-up",            path: "/compliance/nabh-registers/handhygiene",     apiPath: "nabh-registers/handhygiene",        nabhRef: "HIC.3",  desc: "5-moments hand-hygiene observations + compliance rate" },
  { id: "lama",             label: "LAMA / DAMA",          icon: "pi-sign-out",             path: "/compliance/nabh-registers/lama",            apiPath: "nabh-registers/lama",               nabhRef: "AAC.13", desc: "Leave Against / Discharge Against Medical Advice" },
];
const INCIDENT_ACCENT = "#b45309";

/* ════════════════════════════════════════════════════════════════
   B10-T08 — QUALITY OUTCOMES & FACILITIES REGISTERS
   Seven NABH 6th-edition registers covering antimicrobial resistance
   reporting (antibiogram), medical staff oversight, environmental /
   ESG compliance, employee wellness, patient-reported outcomes,
   facilities maintenance, and statutory regulatory compliance.
   Role-gated to Admin / ComplianceOfficer / MRD; the route guard
   still applies on each destination page.
══════════════════════════════════════════════════════════════ */
const QUALITY_FACILITIES_REGISTERS = [
  { id: "antibiogram",            label: "Antibiogram",            icon: "pi-shield",   path: "/compliance/nabh-registers/antibiogram",            nabhRef: "HIC.6",       desc: "Antimicrobial susceptibility cumulative report — organism × antibiotic %S" },
  { id: "mso-log",                label: "MSO Log",                icon: "pi-heart",    path: "/compliance/nabh-registers/mso-log",                nabhRef: "PRE.1",       desc: "Medical Superintendent rounds / decisions / disciplinary log" },
  { id: "esg-compliance",         label: "ESG Compliance",         icon: "pi-globe",    path: "/compliance/nabh-registers/esg-compliance",         nabhRef: "6th-ed Env",  desc: "Environment / Social / Governance — energy, water, waste, carbon" },
  { id: "wellness",               label: "Wellness",               icon: "pi-sun",      path: "/compliance/nabh-registers/wellness",               nabhRef: "HRM.6",       desc: "Employee wellness — screenings, vaccinations, mental-health support" },
  { id: "prom-prem",              label: "PROM/PREM",              icon: "pi-comment",  path: "/compliance/nabh-registers/prom-prem",              nabhRef: "PRE.4",       desc: "Patient-reported outcome & experience measures — survey log" },
  { id: "facilities-maintenance", label: "Facilities Maintenance", icon: "pi-wrench",   path: "/compliance/nabh-registers/facilities-maintenance", nabhRef: "FMS.5",       desc: "Preventive + breakdown maintenance for plant, HVAC, lifts, equipment" },
  { id: "statutory",              label: "Statutory Compliance",   icon: "pi-bookmark", path: "/compliance/nabh-registers/statutory",              nabhRef: "AAC.16",      desc: "Statutory licences + renewals — fire NOC, PCB, BMW, lift, NABH, etc." },
];
const QUALITY_FACILITIES_ACCENT = "#15803d";

const tileStyle = {
  display: "flex", flexDirection: "column", gap: 8,
  padding: 14, borderRadius: 10,
  border: `1px solid ${C.border}`, background: "#fff",
  cursor: "pointer", textAlign: "left",
  transition: "transform 0.1s ease, box-shadow 0.1s ease, border-color 0.1s ease",
  minHeight: 110,
};

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` },
});

const fmt = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const tdStyle = { padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12 };

const VALID_LIVE_IDS = new Set(LIVE_REGISTERS.map((r) => r.id));

export default function NABHRegistersDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasRole } = useAuth();
  // R7gw — Incident registers tile group is visible only to Admin /
  // ComplianceOfficer / MRD. Route guards still apply on click.
  const canSeeIncidents = hasRole("Admin", "ComplianceOfficer", "MRD");
  // R7ek — active = currently-expanded live register, or null if just
  // showing the tile grid. Deep-link via URL hash (#blood-sugar etc.)
  // from the Inspection Dashboard's "Open →" buttons.
  const initialHash = (location.hash || "").replace(/^#/, "");
  const [active, setActive] = useState(VALID_LIVE_IDS.has(initialHash) ? initialHash : null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(isoDaysAgo(7));
  const [endDate, setEndDate] = useState(todayISO());
  const [criticalOnly, setCriticalOnly] = useState(false);
  const tableRef = React.useRef(null);
  // R7gw — Counts for the 7 incident registers. Key = register id, value =
  // number-or-"—". Best-effort: try the dedicated /count endpoint first,
  // then fall back to the list endpoint's `count` field. Failures stay "—".
  const [incidentCounts, setIncidentCounts] = useState(
    () => Object.fromEntries(INCIDENT_REGISTERS.map((r) => [r.id, "—"])),
  );

  useEffect(() => {
    if (!canSeeIncidents) return;
    let alive = true;
    (async () => {
      const results = await Promise.all(
        INCIDENT_REGISTERS.map(async (reg) => {
          // Try /count first (preferred, cheap). Fall back to list endpoint.
          try {
            const r = await axios.get(`${API}/${reg.apiPath}/count`, authHdr());
            const c = r.data?.count ?? r.data?.data?.count;
            if (typeof c === "number") return [reg.id, c];
          } catch (_) { /* /count probably 404 — fall through */ }
          try {
            const r = await axios.get(`${API}/${reg.apiPath}?limit=1000`, authHdr());
            const c = r.data?.count ?? (Array.isArray(r.data?.data) ? r.data.data.length : null);
            return [reg.id, typeof c === "number" ? c : "—"];
          } catch (_) {
            return [reg.id, "—"];
          }
        }),
      );
      if (alive) setIncidentCounts(Object.fromEntries(results));
    })();
    return () => { alive = false; };
  }, [canSeeIncidents]);

  const fetchList = useCallback(async (registerId) => {
    if (!registerId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("startDate", startDate);
      params.set("endDate", endDate);
      params.set("limit", "200");
      if (registerId === "blood-sugar" && criticalOnly) params.set("critical", "true");
      // R7en — ECG lives on its own mount (/api/ecg-register) so the same
      // page can also drive manual entry + report/review patches. Fall back
      // to the unified /registers/nabh/* surface for every other live tile.
      if (registerId === "ecg" && criticalOnly) params.set("critical", "true");
      const baseUrl = registerId === "ecg"
        ? `${API}/ecg-register?${params}`
        : `${API}/registers/nabh/${registerId}?${params}`;
      const r = await axios.get(baseUrl, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load register");
    }
    setLoading(false);
  }, [startDate, endDate, criticalOnly]);

  useEffect(() => { if (active) fetchList(active); }, [active, fetchList]);

  // React to hash changes after mount (e.g. user navigates back from
  // another page or clicks an internal link).
  useEffect(() => {
    const h = (location.hash || "").replace(/^#/, "");
    if (VALID_LIVE_IDS.has(h) && h !== active) setActive(h);
  }, [location.hash, active]);

  // Smooth-scroll the expanded table into view when active changes.
  useEffect(() => {
    if (active && tableRef.current) {
      tableRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [active]);

  const openLiveRegister = (id) => {
    setActive(id);
    // Update URL hash without re-rendering the route — keeps deep-link parity.
    navigate(`/compliance/nabh-registers#${id}`, { replace: true });
  };
  const closeLiveRegister = () => {
    setActive(null);
    setRows([]);
    navigate(`/compliance/nabh-registers`, { replace: true });
  };

  return (
    <AdminPage>
      <Hero
        icon="pi-th-large"
        title="NABH Registers"
        subtitle="All compliance registers in one place — categorized for the surveyor visit"
        color="teal"
      />

      {/* R7ej — Categorized tile grid for the 15 stand-alone NABH register
          pages. Replaces the cluttered sidebar entries; one tile per page
          grouped by purpose. Clicking a tile navigates to the underlying
          route which has its own role guard. */}
      {REGISTER_CATEGORIES.map((cat) => (
        <Card key={cat.id} title={cat.title}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, marginTop: -4 }}>
            {cat.subtitle}
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 10,
          }}>
            {cat.tiles.map((tile) => (
              <button
                key={tile.path}
                type="button"
                onClick={() => navigate(tile.path)}
                style={tileStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
                  e.currentTarget.style.borderColor = cat.accent;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.borderColor = C.border;
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: `${cat.accent}15`, color: cat.accent,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18,
                  }}>
                    <i className={`pi ${tile.icon}`} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>
                      {tile.label}
                    </div>
                    <div style={{ marginTop: 2 }}>
                      <Badge
                        value={tile.nabhRef}
                        palette={tile.nabhRef === "NEW" ? "orange" : "blue"}
                      />
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.4 }}>
                  {tile.desc}
                </div>
                <div style={{
                  marginTop: "auto", paddingTop: 4,
                  fontSize: 11, color: cat.accent, fontWeight: 600,
                }}>
                  Open →
                </div>
              </button>
            ))}
          </div>
        </Card>
      ))}

      {/* R7gw — Incident Reporting & Surveillance tiles (B9-T01..T07).
          Role-gated to Admin / ComplianceOfficer / MRD; route guards on
          each destination still apply. Counts are best-effort live and
          fall back to "—" when an endpoint is unreachable. */}
      {canSeeIncidents && (
        <Card title="Incident Reporting & Surveillance">
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, marginTop: -4 }}>
            Patient-safety, infection-control, and discharge-risk registers added in the
            B9 sprint. Auto-populated from clinical save paths plus manual entry by
            compliance officers / IC nurses.
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 10,
          }}>
            {INCIDENT_REGISTERS.map((reg) => (
              <button
                key={reg.id}
                type="button"
                onClick={() => navigate(reg.path)}
                style={tileStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
                  e.currentTarget.style.borderColor = INCIDENT_ACCENT;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.borderColor = C.border;
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: `${INCIDENT_ACCENT}15`, color: INCIDENT_ACCENT,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18,
                  }}>
                    <i className={`pi ${reg.icon}`} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>
                      {reg.label}
                    </div>
                    <div style={{ marginTop: 2, display: "flex", gap: 6, alignItems: "center" }}>
                      <Badge value={reg.nabhRef} palette="blue" />
                      <span style={{
                        fontSize: 11, color: C.muted, fontWeight: 600,
                      }}>
                        Rows: <span style={{ color: C.text }}>{incidentCounts[reg.id]}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.4 }}>
                  {reg.desc}
                </div>
                <div style={{
                  marginTop: "auto", paddingTop: 4,
                  fontSize: 11, color: INCIDENT_ACCENT, fontWeight: 600,
                }}>
                  Open →
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* B10-T08 — Quality Outcomes & Facilities tiles (7 NABH 6th-ed registers).
          Role-gated to Admin / ComplianceOfficer / MRD; route guards on
          each destination still apply. */}
      {canSeeIncidents && (
        <Card title="Quality Outcomes & Facilities">
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, marginTop: -4 }}>
            NABH 6th-edition registers — antimicrobial stewardship, MSO oversight,
            ESG/wellness, patient-reported outcomes, facilities maintenance, and
            statutory licence tracking. Visible to compliance staff only.
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 10,
          }}>
            {QUALITY_FACILITIES_REGISTERS.map((reg) => (
              <button
                key={reg.id}
                type="button"
                onClick={() => navigate(reg.path)}
                style={tileStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
                  e.currentTarget.style.borderColor = QUALITY_FACILITIES_ACCENT;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.borderColor = C.border;
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: `${QUALITY_FACILITIES_ACCENT}15`, color: QUALITY_FACILITIES_ACCENT,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18,
                  }}>
                    <i className={`pi ${reg.icon}`} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>
                      {reg.label}
                    </div>
                    <div style={{ marginTop: 2 }}>
                      <Badge value={reg.nabhRef} palette="blue" />
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.4 }}>
                  {reg.desc}
                </div>
                <div style={{
                  marginTop: "auto", paddingTop: 4,
                  fontSize: 11, color: QUALITY_FACILITIES_ACCENT, fontWeight: 600,
                }}>
                  Open →
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* R7ek — Live Clinical Registers as tiles (replaces tab bar). */}
      <Card title="Live Clinical Registers">
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, marginTop: -4 }}>
          Auto-populated from clinical save paths (vitals, ER intake, transfusions,
          assessments). Click a tile to view that register's chronological log.
        </div>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 10,
        }}>
          {LIVE_REGISTERS.map((reg) => {
            const isActive = active === reg.id;
            return (
              <button
                key={reg.id}
                type="button"
                onClick={() => openLiveRegister(reg.id)}
                style={{
                  ...tileStyle,
                  borderColor: isActive ? LIVE_ACCENT : C.border,
                  background: isActive ? `${LIVE_ACCENT}08` : "#fff",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)";
                    e.currentTarget.style.borderColor = LIVE_ACCENT;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.borderColor = C.border;
                  }
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: `${LIVE_ACCENT}15`, color: LIVE_ACCENT,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18,
                  }}>
                    <i className={`pi ${reg.icon}`} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>
                      {reg.label}
                    </div>
                    <div style={{ marginTop: 2 }}>
                      <Badge value={reg.nabhRef} palette="blue" />
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.4 }}>
                  {reg.desc}
                </div>
                <div style={{
                  marginTop: "auto", paddingTop: 4,
                  fontSize: 11, color: LIVE_ACCENT, fontWeight: 600,
                }}>
                  {isActive ? "Viewing ↓" : "Open ↓"}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* R7ek — Expanded register table renders inline below tiles. */}
      {active && (
        <div ref={tableRef}>
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>
                {LIVE_REGISTERS.find((r) => r.id === active)?.label || active}
              </div>
              <button
                type="button"
                onClick={closeLiveRegister}
                style={{
                  padding: "4px 10px", borderRadius: 6,
                  border: `1px solid ${C.border}`, background: "#fff",
                  color: C.muted, cursor: "pointer",
                  fontSize: 11, fontWeight: 600,
                }}
              >✕ Close</button>
            </div>
          </Card>
          <Card title="Filters">
            <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
              <div>
                <label style={{ fontSize: 12, color: C.muted, display: "block" }}>From</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: C.muted, display: "block" }}>To</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }} />
              </div>
              {active === "blood-sugar" && (
                <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} />
                  Critical only (&lt;70 or &gt;300 mg/dL)
                </label>
              )}
              {active === "ecg" && (
                <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} />
                  Critical only (VT/VF/AVB-3/Asystole/STE)
                </label>
              )}
            </div>
          </Card>

          {active === "blood-sugar" && (
            <Card title={`Blood Sugar Register · ${rows.length} entries`}>
              <Table cols={["Taken At", "UHID", "Patient", "Type", "Value", "Sample", "Location", "Critical", "By"]}>
                {rows.length === 0 ? (
                  <EmptyRow span={9} text={loading ? "Loading…" : "No readings in this range"} />
                ) : rows.map((r) => (
                  <tr key={r._id}>
                    <td style={tdStyle}>{fmt(r.takenAt)}</td>
                    <td style={tdStyle}>{r.UHID}</td>
                    <td style={tdStyle}>{r.patientName}</td>
                    <td style={tdStyle}><Badge value={r.readingType} palette="muted" /></td>
                    <td style={tdStyle}><strong>{r.readingValue}</strong> {r.readingUnit}</td>
                    <td style={tdStyle}>{r.sampleType}</td>
                    <td style={tdStyle}>{r.location}</td>
                    <td style={tdStyle}>{r.criticalFlag ? <Badge value="CRITICAL" palette="red" /> : "—"}</td>
                    <td style={tdStyle}>{r.takenByName || "—"}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {active === "emergency" && (
            <Card title={`Emergency Register · ${rows.length} entries`}>
              <Table cols={["ER #", "Arrival", "UHID", "Patient", "Triage", "D→Triage", "D→Disp", "Disposition", "MLC"]}>
                {rows.length === 0 ? (
                  <EmptyRow span={9} text={loading ? "Loading…" : "No ER visits in this range"} />
                ) : rows.map((r) => (
                  <tr key={r._id}>
                    <td style={tdStyle}><strong>{r.erNumber}</strong></td>
                    <td style={tdStyle}>{fmt(r.arrivalAt)}</td>
                    <td style={tdStyle}>{r.UHID}</td>
                    <td style={tdStyle}>{r.patientName}</td>
                    <td style={tdStyle}>
                      <Badge
                        value={r.triageCategory}
                        palette={r.triageCategory === "Critical" ? "red" : r.triageCategory === "Emergency" ? "orange" : "blue"}
                      />
                    </td>
                    <td style={tdStyle}>{r.doorToTriageMinutes != null ? `${r.doorToTriageMinutes}m` : "—"}</td>
                    <td style={tdStyle}>{r.doorToDispositionMinutes != null ? `${r.doorToDispositionMinutes}m` : "—"}</td>
                    <td style={tdStyle}>{r.disposition || <Badge value="PENDING" palette="muted" />}</td>
                    <td style={tdStyle}>{r.isMLC ? <Badge value="MLC" palette="orange" /> : "—"}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {active === "blood-transfusion" && (
            <Card title={`Blood Transfusion Register · ${rows.length} entries`}>
              <Table cols={["BT #", "Ordered", "UHID", "Patient", "Group", "Units", "Status", "Started", "Reaction"]}>
                {rows.length === 0 ? (
                  <EmptyRow span={9} text={loading ? "Loading…" : "No transfusions in this range"} />
                ) : rows.map((r) => (
                  <tr key={r._id}>
                    <td style={tdStyle}><strong>{r.btNumber}</strong></td>
                    <td style={tdStyle}>{fmt(r.createdAt)}</td>
                    <td style={tdStyle}>{r.UHID}</td>
                    <td style={tdStyle}>{r.patientName}</td>
                    <td style={tdStyle}><Badge value={r.bloodGroup} palette="red" /></td>
                    <td style={tdStyle}>{r.unitsRequested}</td>
                    <td style={tdStyle}><Badge value={r.status} palette="blue" /></td>
                    <td style={tdStyle}>{fmt(r.startedAt)}</td>
                    <td style={tdStyle}>{r.reaction?.occurred ? <Badge value={r.reaction.type || "YES"} palette="red" /> : "—"}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {active === "pain" && (
            <Card title={`Pain Assessment Register · ${rows.length} entries`}>
              <Table cols={["Assessed At", "UHID", "Patient", "Score", "Severity", "Scale", "Site", "Intervention", "By"]}>
                {rows.length === 0 ? (
                  <EmptyRow span={9} text={loading ? "Loading…" : "No pain assessments in this range"} />
                ) : rows.map((r) => (
                  <tr key={r._id}>
                    <td style={tdStyle}>{fmt(r.assessedAt)}</td>
                    <td style={tdStyle}>{r.UHID}</td>
                    <td style={tdStyle}>{r.patientName}</td>
                    <td style={tdStyle}><strong>{r.painScale}</strong>/10</td>
                    <td style={tdStyle}>
                      <Badge
                        value={r.severity}
                        palette={r.severity === "Severe" ? "red" : r.severity === "Moderate" ? "orange" : r.severity === "Mild" ? "blue" : "muted"}
                      />
                    </td>
                    <td style={tdStyle}>{r.scaleUsed}</td>
                    <td style={tdStyle}>{r.site || "—"}</td>
                    <td style={tdStyle}>{r.intervention || "—"}</td>
                    <td style={tdStyle}>{r.assessedBy || "—"}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {active === "fall-risk" && (
            <Card title={`Fall Risk Register · ${rows.length} entries`}>
              <Table cols={["Assessed At", "UHID", "Patient", "Morse", "Tier", "Hx Falls", "Gait", "Aid", "By"]}>
                {rows.length === 0 ? (
                  <EmptyRow span={9} text={loading ? "Loading…" : "No fall-risk assessments in this range"} />
                ) : rows.map((r) => (
                  <tr key={r._id}>
                    <td style={tdStyle}>{fmt(r.assessedAt)}</td>
                    <td style={tdStyle}>{r.UHID}</td>
                    <td style={tdStyle}>{r.patientName}</td>
                    <td style={tdStyle}><strong>{r.morseScore}</strong></td>
                    <td style={tdStyle}>
                      <Badge
                        value={r.riskTier}
                        palette={r.riskTier === "High" ? "red" : r.riskTier === "Moderate" ? "orange" : "blue"}
                      />
                    </td>
                    <td style={tdStyle}>{r.historyOfFalling ? "Yes" : "No"}</td>
                    <td style={tdStyle}>{r.gait || "—"}</td>
                    <td style={tdStyle}>{r.ambulatoryAid || "—"}</td>
                    <td style={tdStyle}>{r.assessedBy || "—"}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {active === "pressure-ulcer" && (
            <Card title={`Pressure Ulcer Register · ${rows.length} entries`}>
              <Table cols={["Assessed At", "UHID", "Patient", "Braden", "Tier", "Ulcer", "Stage", "Site", "HAPU", "By"]}>
                {rows.length === 0 ? (
                  <EmptyRow span={10} text={loading ? "Loading…" : "No pressure-area assessments in this range"} />
                ) : rows.map((r) => (
                  <tr key={r._id}>
                    <td style={tdStyle}>{fmt(r.assessedAt)}</td>
                    <td style={tdStyle}>{r.UHID}</td>
                    <td style={tdStyle}>{r.patientName}</td>
                    <td style={tdStyle}><strong>{r.bradenScore}</strong></td>
                    <td style={tdStyle}>
                      <Badge
                        value={r.riskTier}
                        palette={r.riskTier === "Severe" ? "red" : r.riskTier === "High" ? "orange" : "blue"}
                      />
                    </td>
                    <td style={tdStyle}>{r.ulcerPresent ? "Yes" : "No"}</td>
                    <td style={tdStyle}>{r.ulcerStage || "—"}</td>
                    <td style={tdStyle}>{r.ulcerSite || "—"}</td>
                    <td style={tdStyle}>{r.sentinelFlag ? <Badge value="SENTINEL" palette="red" /> : r.hospitalAcquired ? <Badge value="HAPU" palette="orange" /> : "—"}</td>
                    <td style={tdStyle}>{r.assessedBy || "—"}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {active === "ecg" && (
            <Card title={`ECG Register · ${rows.length} entries`}>
              <div style={{ marginBottom: 8, fontSize: 12, color: C.muted }}>
                Click <a href="/compliance/nabh/ecg-register" style={{ color: "#0891b2", fontWeight: 600 }}>open the full ECG Register page</a> for manual entry, report filing, and cardiologist review.
              </div>
              <Table cols={["ECG #", "Performed", "UHID", "Patient", "Loc", "Rhythm", "HR", "Flag", "Stage", "By"]}>
                {rows.length === 0 ? (
                  <EmptyRow span={10} text={loading ? "Loading…" : "No ECGs in this range"} />
                ) : rows.map((r) => (
                  <tr key={r._id}>
                    <td style={tdStyle}><strong>{r.ecgNumber || "—"}</strong></td>
                    <td style={tdStyle}>{fmt(r.performedAt)}</td>
                    <td style={tdStyle}>{r.UHID}</td>
                    <td style={tdStyle}>{r.patientName}</td>
                    <td style={tdStyle}>{r.location}</td>
                    <td style={tdStyle}>{r.rhythm ? <Badge value={r.rhythm} palette={r.criticalFlag ? "red" : r.rhythm === "NSR" ? "green" : "orange"} /> : "—"}</td>
                    <td style={tdStyle}>{r.heartRate ?? "—"}</td>
                    <td style={tdStyle}>
                      {r.criticalFlag ? <Badge value="CRITICAL" palette="red" />
                        : r.abnormalFlag ? <Badge value="ABNORMAL" palette="orange" />
                        : <Badge value="NORMAL" palette="green" />}
                    </td>
                    <td style={tdStyle}>
                      <Badge value={r.status} palette={r.status === "Reviewed" ? "green" : r.status === "Reported" ? "blue" : "muted"} />
                    </td>
                    <td style={tdStyle}>{r.performedByName || "—"}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          {active === "dvt" && (
            <Card title={`DVT / VTE Caprini Register · ${rows.length} entries`}>
              <Table cols={["Assessed At", "UHID", "Patient", "Caprini", "Tier", "IMPROVE", "Bleed", "Prophylaxis", "Escalation", "By"]}>
                {rows.length === 0 ? (
                  <EmptyRow span={10} text={loading ? "Loading…" : "No DVT assessments in this range"} />
                ) : rows.map((r) => (
                  <tr key={r._id}>
                    <td style={tdStyle}>{fmt(r.assessedAt)}</td>
                    <td style={tdStyle}>{r.UHID}</td>
                    <td style={tdStyle}>{r.patientName}</td>
                    <td style={tdStyle}><strong>{r.capriniScore}</strong></td>
                    <td style={tdStyle}>
                      <Badge
                        value={r.capriniTier}
                        palette={
                          r.capriniTier === "Highest" ? "red" :
                          r.capriniTier === "High" ? "orange" :
                          r.capriniTier === "Moderate" ? "blue" : "muted"
                        }
                      />
                    </td>
                    <td style={tdStyle}>{r.improveScore != null ? r.improveScore : "—"}</td>
                    <td style={tdStyle}>{r.bleedingRiskFlag ? <Badge value="HIGH" palette="red" /> : (r.improveTier || "—")}</td>
                    <td style={tdStyle}>
                      <Badge
                        value={r.recommendedProphylaxis}
                        palette={r.recommendedProphylaxis === "Combined" || r.recommendedProphylaxis === "Pharmacological" ? "orange" : r.recommendedProphylaxis === "Ambulation" ? "muted" : "blue"}
                      />
                      {r.recommendedAgent ? <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{r.recommendedAgent}</div> : null}
                    </td>
                    <td style={tdStyle}>
                      {r.escalatedFlag
                        ? <Badge
                            value={r.escalationStatus || "PENDING"}
                            palette={r.escalationStatus === "ADDRESSED" ? "green" : r.escalationStatus === "OVERDUE" ? "red" : "orange"}
                          />
                        : "—"}
                    </td>
                    <td style={tdStyle}>{r.assessedBy || "—"}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      )}
    </AdminPage>
  );
}
