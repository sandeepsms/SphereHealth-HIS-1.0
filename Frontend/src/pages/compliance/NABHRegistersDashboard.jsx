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
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, KPI, Card, Table, EmptyRow, Empty, Badge, C,
} from "../../Components/admin-theme";
import { API_BASE_URL as API } from "../../config/api";

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
];

const tdStyle = { padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12 };

export default function NABHRegistersDashboard() {
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

      {/* Tab bar */}
      <Card>
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
        </>
      )}
    </AdminPage>
  );
}
