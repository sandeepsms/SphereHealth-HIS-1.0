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
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, KPI, Card, Table, EmptyRow, Empty, Badge, C,
} from "../../Components/admin-theme";
import { API_BASE_URL as API } from "../../config/api";

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

const REGISTER_TABS = [
  { id: "summary", label: "Inspection Dashboard" },
  { id: "blood-sugar", label: "Blood Sugar (RBS)" },
  { id: "emergency", label: "Emergency" },
  { id: "blood-transfusion", label: "Blood Transfusion" },
  { id: "pain", label: "Pain Assessment" },
  { id: "fall-risk", label: "Fall Risk" },
  { id: "pressure-ulcer", label: "Pressure Ulcer" },
  { id: "dvt", label: "DVT / VTE (Caprini)" },
];

const tdStyle = { padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12 };

export default function NABHRegistersDashboard() {
  const navigate = useNavigate();
  const [active, setActive] = useState("summary");
  const [summary, setSummary] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(isoDaysAgo(7));
  const [endDate, setEndDate] = useState(todayISO());
  const [criticalOnly, setCriticalOnly] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/registers/nabh/dashboard-summary`, authHdr());
      setSummary(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load dashboard");
    }
    setLoading(false);
  }, []);

  const fetchList = useCallback(async (registerId) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("startDate", startDate);
      params.set("endDate", endDate);
      params.set("limit", "200");
      if (registerId === "blood-sugar" && criticalOnly) params.set("critical", "true");
      const r = await axios.get(`${API}/registers/nabh/${registerId}?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load register");
    }
    setLoading(false);
  }, [startDate, endDate, criticalOnly]);

  useEffect(() => {
    if (active === "summary") fetchSummary();
    else fetchList(active);
  }, [active, fetchSummary, fetchList]);

  const kpis = useMemo(() => {
    if (active !== "summary") return null;
    return summary.map((s) => ({
      label: s.name,
      value: s.todayCount,
      sub: `7d: ${s.sevenDayCount} · NABH ${s.nabhRef}`,
    }));
  }, [active, summary]);

  return (
    <AdminPage>
      <Hero
        icon="pi-th-large"
        title="NABH Inspection Dashboard"
        subtitle="Auto-populated compliance registers — surveyor-ready chronological logs"
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

      {/* Tab bar */}
      <Card title="Inspection Dashboard — Auto-populated Registers">
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10, marginTop: -4 }}>
          Live chronological logs auto-populated from clinical save paths (RBS readings,
          ER visits, transfusions, pain / fall / pressure-ulcer / DVT assessments).
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {REGISTER_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: `1px solid ${active === t.id ? C.teal : C.border}`,
                background: active === t.id ? C.teal : "#fff",
                color: active === t.id ? "#fff" : C.text,
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      {/* Summary view */}
      {active === "summary" && (
        <>
          {kpis && kpis.length > 0 && <KPI items={kpis} />}
          <Card title="Register Status">
            {summary.length === 0 ? (
              <Empty text={loading ? "Loading…" : "No registers configured"} />
            ) : (
              <Table cols={["Register", "NABH Ref", "Today", "Last 7d", "Last Entry", "Action"]}>
                {summary.map((r) => (
                  <tr key={r.id}>
                    <td style={tdStyle}><strong>{r.name}</strong></td>
                    <td style={tdStyle}><Badge color="blue">{r.nabhRef}</Badge></td>
                    <td style={tdStyle}><strong>{r.todayCount}</strong></td>
                    <td style={tdStyle}>{r.sevenDayCount}</td>
                    <td style={tdStyle}>{fmt(r.lastEntryAt)}</td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => setActive(r.id)}
                        style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.teal}`, background: "#fff", color: C.teal, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                      >Open →</button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}

      {/* Per-register list views */}
      {active !== "summary" && (
        <>
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
                    <td style={tdStyle}><Badge>{r.readingType}</Badge></td>
                    <td style={tdStyle}><strong>{r.readingValue}</strong> {r.readingUnit}</td>
                    <td style={tdStyle}>{r.sampleType}</td>
                    <td style={tdStyle}>{r.location}</td>
                    <td style={tdStyle}>{r.criticalFlag ? <Badge color="red">CRITICAL</Badge> : "—"}</td>
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
                      <Badge color={r.triageCategory === "Critical" ? "red" : r.triageCategory === "Emergency" ? "orange" : "blue"}>
                        {r.triageCategory}
                      </Badge>
                    </td>
                    <td style={tdStyle}>{r.doorToTriageMinutes != null ? `${r.doorToTriageMinutes}m` : "—"}</td>
                    <td style={tdStyle}>{r.doorToDispositionMinutes != null ? `${r.doorToDispositionMinutes}m` : "—"}</td>
                    <td style={tdStyle}>{r.disposition || <Badge color="muted">PENDING</Badge>}</td>
                    <td style={tdStyle}>{r.isMLC ? <Badge color="orange">MLC</Badge> : "—"}</td>
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
                    <td style={tdStyle}><Badge color="red">{r.bloodGroup}</Badge></td>
                    <td style={tdStyle}>{r.unitsRequested}</td>
                    <td style={tdStyle}><Badge>{r.status}</Badge></td>
                    <td style={tdStyle}>{fmt(r.startedAt)}</td>
                    <td style={tdStyle}>{r.reaction?.occurred ? <Badge color="red">{r.reaction.type || "YES"}</Badge> : "—"}</td>
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
                      <Badge color={r.severity === "Severe" ? "red" : r.severity === "Moderate" ? "orange" : r.severity === "Mild" ? "blue" : "muted"}>
                        {r.severity}
                      </Badge>
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
                      <Badge color={r.riskTier === "High" ? "red" : r.riskTier === "Moderate" ? "orange" : "blue"}>
                        {r.riskTier}
                      </Badge>
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
                      <Badge color={r.riskTier === "Severe" ? "red" : r.riskTier === "High" ? "orange" : "blue"}>
                        {r.riskTier}
                      </Badge>
                    </td>
                    <td style={tdStyle}>{r.ulcerPresent ? "Yes" : "No"}</td>
                    <td style={tdStyle}>{r.ulcerStage || "—"}</td>
                    <td style={tdStyle}>{r.ulcerSite || "—"}</td>
                    <td style={tdStyle}>{r.sentinelFlag ? <Badge color="red">SENTINEL</Badge> : r.hospitalAcquired ? <Badge color="orange">HAPU</Badge> : "—"}</td>
                    <td style={tdStyle}>{r.assessedBy || "—"}</td>
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
                      <Badge color={
                        r.capriniTier === "Highest" ? "red" :
                        r.capriniTier === "High" ? "orange" :
                        r.capriniTier === "Moderate" ? "blue" : "muted"
                      }>
                        {r.capriniTier}
                      </Badge>
                    </td>
                    <td style={tdStyle}>{r.improveScore != null ? r.improveScore : "—"}</td>
                    <td style={tdStyle}>{r.bleedingRiskFlag ? <Badge color="red">HIGH</Badge> : (r.improveTier || "—")}</td>
                    <td style={tdStyle}>
                      <Badge color={r.recommendedProphylaxis === "Combined" || r.recommendedProphylaxis === "Pharmacological" ? "orange" : r.recommendedProphylaxis === "Ambulation" ? "muted" : "blue"}>
                        {r.recommendedProphylaxis}
                      </Badge>
                      {r.recommendedAgent ? <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{r.recommendedAgent}</div> : null}
                    </td>
                    <td style={tdStyle}>
                      {r.escalatedFlag
                        ? <Badge color={r.escalationStatus === "ADDRESSED" ? "green" : r.escalationStatus === "OVERDUE" ? "red" : "orange"}>{r.escalationStatus || "PENDING"}</Badge>
                        : "—"}
                    </td>
                    <td style={tdStyle}>{r.assessedBy || "—"}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </>
      )}
    </AdminPage>
  );
}
