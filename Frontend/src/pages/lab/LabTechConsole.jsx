/**
 * LabTechConsole.jsx — Lab Technician multi-tab workspace.
 * (R7bd-E-5 / A3-MED-18)
 *
 * URL: /lab-console   (query ?tab=samples|results|qc|today)
 *
 * Four tabs:
 *   1. Sample Queue        — orders pending collection
 *                            (/api/investigation-orders?status=PENDING_COLLECTION)
 *   2. Result-Entry Queue  — collected but not-yet-entered samples
 *                            (/api/investigation-orders?status=IN_LAB)
 *   3. QC Log              — QC entries from /api/lab-records/qc
 *   4. Day Worksheet       — orders assigned today (any status, today's date)
 *
 * Pre-R7bd Lab Tech had a single LabResultsEntry page that conflated
 * trend-sheet entry with imaging/micro entry but had NO sample-tracking
 * surface — collection requests piled up in the doctor's order list
 * with no Lab-Tech-owned queue. This console gives them the 4 work
 * states (waiting to collect, waiting to enter, QC, today's workload)
 * the NABH POE.5 SOP expects.
 *
 * Each tab is a small <table> backed by an existing endpoint. Rows are
 * read-only here — entry happens on the LabResultsEntry page (linked
 * via row action).
 */
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, TabStrip, Card, Table, EmptyRow, Badge,
  PrimaryButton, KPI, C,
} from "../../Components/admin-theme";

import { API_BASE_URL as API } from "../../config/api";
const authHdr = () => ({
  headers: {
    Authorization: `Bearer ${(sessionStorage.getItem("his_token"))}`,
  },
});

const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";
const fmtAgo  = (d) => {
  if (!d) return "—";
  const mins = Math.floor((Date.now() - new Date(d)) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins} m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} h`;
  return `${Math.floor(hrs / 24)} d`;
};

const TABS = [
  { key: "samples", label: "Sample Queue",       icon: "pi-tag" },
  { key: "results", label: "Result-Entry Queue", icon: "pi-pencil" },
  { key: "qc",      label: "QC Log",             icon: "pi-shield" },
  { key: "today",   label: "Day Worksheet",      icon: "pi-calendar" },
];

export default function LabTechConsole() {
  const [params, setParams] = useSearchParams();
  const initialTab = params.get("tab") || "samples";
  const [tab, setTab] = useState(initialTab);

  // Keep the URL in sync with the selected tab so refresh / share-link
  // lands on the same view (mirrors WardBoyConsole + AccountsConsole).
  useEffect(() => {
    if (params.get("tab") !== tab) {
      setParams({ tab }, { replace: true });
    }
  }, [tab]);

  // Live counts — drive both the KPI strip and the tab badges so a Lab
  // Tech on another tab still sees "10 samples waiting" pulsing.
  const [counts, setCounts] = useState({ samples: 0, results: 0, qc: 0, today: 0 });
  const refreshCounts = useCallback(async () => {
    try {
      const [s, r, q, t] = await Promise.all([
        axios.get(`${API}/investigation-orders?status=PENDING_COLLECTION`, authHdr()).catch(() => null),
        axios.get(`${API}/investigation-orders?status=IN_LAB`,             authHdr()).catch(() => null),
        axios.get(`${API}/lab-records/qc`,                                 authHdr()).catch(() => null),
        axios.get(`${API}/investigation-orders?dateFrom=${new Date().toISOString().slice(0,10)}`, authHdr()).catch(() => null),
      ]);
      const len = (x) => Array.isArray(x?.data?.data) ? x.data.data.length
                       : Array.isArray(x?.data)       ? x.data.length
                       : 0;
      setCounts({ samples: len(s), results: len(r), qc: len(q), today: len(t) });
    } catch (_) { /* leave last-known counts */ }
  }, []);
  useEffect(() => { refreshCounts(); const id = setInterval(refreshCounts, 30000); return () => clearInterval(id); }, [refreshCounts]);

  const tabs = useMemo(() => TABS.map((t) => ({
    ...t,
    badge: counts[t.key] > 0 ? String(counts[t.key]) : null,
    badgeTone: counts[t.key] > 0 ? (t.key === "samples" ? "warn" : "normal") : "idle",
  })), [counts]);

  return (
    <AdminPage>
      <Hero icon="pi-flask" color="blue"
        title="Lab Technician Console"
        subtitle="Samples awaiting collection · result entry queue · QC log · today's worksheet" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Awaiting collection"  value={counts.samples} color={C.amber}  icon="pi-tag" />
        <KPI label="To enter"             value={counts.results} color={C.blue}   icon="pi-pencil" />
        <KPI label="QC entries"           value={counts.qc}      color={C.purple} icon="pi-shield" />
        <KPI label="Orders today"         value={counts.today}   color={C.green}  icon="pi-calendar" />
      </div>

      <TabStrip tabs={tabs} value={tab} onChange={setTab} accent={C.blue} accentL="#eff6ff" />

      {tab === "samples" && <SampleQueueTab />}
      {tab === "results" && <ResultEntryQueueTab />}
      {tab === "qc"      && <QcLogTab />}
      {tab === "today"   && <DayWorksheetTab />}
    </AdminPage>
  );
}

/* ── Sample Queue tab ───────────────────────────────────────── */
function SampleQueueTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/investigation-orders?status=PENDING_COLLECTION`, authHdr());
      const data = Array.isArray(r.data?.data) ? r.data.data : (Array.isArray(r.data) ? r.data : []);
      setRows(data);
    } catch (e) {
      toast.error(`Sample queue: ${e.response?.data?.message || e.message}`);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <Card title={`Samples awaiting collection (${rows.length})`} color={C.amber} icon="pi-tag"
      right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.amber} onClick={refresh} />}>
      <Table cols={["Order #", "Patient", "Test", "Ward / Bed", "Ordered", "Action"]}>
        {loading ? <EmptyRow span={6} text="Loading…" /> :
          rows.length === 0 ? <EmptyRow span={6} text="No samples awaiting collection." /> :
            rows.map((o, i) => (
              <tr key={o._id || i} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                <td style={{ padding: "8px 12px", fontWeight: 700 }}>{o.orderNumber || o._id?.slice?.(-6) || "—"}</td>
                <td style={{ padding: "8px 12px" }}>{o.patientName || o.UHID || "—"}</td>
                <td style={{ padding: "8px 12px" }}>{(o.items || []).map((it) => it.testName || it.investigationName).filter(Boolean).slice(0, 2).join(", ") || "—"}</td>
                <td style={{ padding: "8px 12px", color: C.muted }}>{o.wardName || o.bedNumber || "—"}</td>
                <td style={{ padding: "8px 12px", color: C.muted }}>{fmtAgo(o.createdAt || o.orderedAt)}</td>
                <td style={{ padding: "8px 12px" }}>
                  <button onClick={() => navigate(`/investigation-orders?id=${o._id}`)}
                    style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.blue}`, background: "#eff6ff", color: C.blue, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    <i className="pi pi-arrow-right" style={{ fontSize: 10, marginRight: 4 }} />Collect
                  </button>
                </td>
              </tr>
            ))}
      </Table>
    </Card>
  );
}

/* ── Result-Entry Queue tab ─────────────────────────────────── */
function ResultEntryQueueTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/investigation-orders?status=IN_LAB`, authHdr());
      const data = Array.isArray(r.data?.data) ? r.data.data : (Array.isArray(r.data) ? r.data : []);
      setRows(data);
    } catch (e) {
      toast.error(`Result queue: ${e.response?.data?.message || e.message}`);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <Card title={`Samples awaiting result entry (${rows.length})`} color={C.blue} icon="pi-pencil"
      right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.blue} onClick={refresh} />}>
      <Table cols={["Order #", "Patient", "Test", "Collected", "Action"]}>
        {loading ? <EmptyRow span={5} text="Loading…" /> :
          rows.length === 0 ? <EmptyRow span={5} text="No samples waiting for result entry." /> :
            rows.map((o, i) => (
              <tr key={o._id || i} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                <td style={{ padding: "8px 12px", fontWeight: 700 }}>{o.orderNumber || o._id?.slice?.(-6) || "—"}</td>
                <td style={{ padding: "8px 12px" }}>{o.patientName || o.UHID || "—"}</td>
                <td style={{ padding: "8px 12px" }}>{(o.items || []).map((it) => it.testName || it.investigationName).filter(Boolean).slice(0, 2).join(", ") || "—"}</td>
                <td style={{ padding: "8px 12px", color: C.muted }}>{fmtAgo(o.collectedAt || o.updatedAt)}</td>
                <td style={{ padding: "8px 12px" }}>
                  <button onClick={() => navigate(`/lab-results?uhid=${encodeURIComponent(o.UHID || "")}&order=${o._id}`)}
                    style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.green}`, background: "#dcfce7", color: C.green, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    <i className="pi pi-pencil" style={{ fontSize: 10, marginRight: 4 }} />Enter
                  </button>
                </td>
              </tr>
            ))}
      </Table>
    </Card>
  );
}

/* ── QC Log tab ──────────────────────────────────────────────── */
function QcLogTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/lab-records/qc`, authHdr());
      const data = Array.isArray(r.data?.data) ? r.data.data : (Array.isArray(r.data) ? r.data : []);
      setRows(data);
    } catch (e) {
      toast.error(`QC log: ${e.response?.data?.message || e.message}`);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <Card title={`Quality control log (${rows.length})`} color={C.purple} icon="pi-shield"
      right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.purple} onClick={refresh} />}>
      <Table cols={["Date", "Analyte / Instrument", "Level", "Result", "Status", "By"]}>
        {loading ? <EmptyRow span={6} text="Loading…" /> :
          rows.length === 0 ? <EmptyRow span={6} text="No QC entries yet. Use the QC form on the Manual Lab Entry page." /> :
            rows.slice(0, 100).map((q, i) => (
              <tr key={q._id || i} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                <td style={{ padding: "8px 12px", color: C.muted }}>{fmtDate(q.runDate || q.createdAt)} {fmtTime(q.runDate || q.createdAt)}</td>
                <td style={{ padding: "8px 12px" }}>{q.analyte || "—"}{q.instrument ? ` · ${q.instrument}` : ""}</td>
                <td style={{ padding: "8px 12px" }}>{q.level || q.controlLevel || "—"}</td>
                <td style={{ padding: "8px 12px" }}>{q.result ?? "—"}{q.unit ? ` ${q.unit}` : ""}</td>
                <td style={{ padding: "8px 12px" }}>
                  <Badge value={q.status || (q.passed === false ? "FAIL" : "PASS")}
                    palette={q.status === "FAIL" || q.passed === false ? "red" : "green"} />
                </td>
                <td style={{ padding: "8px 12px", color: C.muted }}>{q.runBy || q.createdByName || "—"}</td>
              </tr>
            ))}
      </Table>
    </Card>
  );
}

/* ── Day Worksheet tab ───────────────────────────────────────── */
function DayWorksheetTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    try {
      const r = await axios.get(`${API}/investigation-orders?dateFrom=${today}`, authHdr());
      const data = Array.isArray(r.data?.data) ? r.data.data : (Array.isArray(r.data) ? r.data : []);
      setRows(data);
    } catch (e) {
      toast.error(`Day worksheet: ${e.response?.data?.message || e.message}`);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <Card title={`Today's worksheet (${rows.length})`} color={C.green} icon="pi-calendar"
      right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.green} onClick={refresh} />}>
      <Table cols={["Order #", "Patient", "Test", "Status", "Ordered", "Updated"]}>
        {loading ? <EmptyRow span={6} text="Loading…" /> :
          rows.length === 0 ? <EmptyRow span={6} text="No orders yet today." /> :
            rows.map((o, i) => (
              <tr key={o._id || i} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                <td style={{ padding: "8px 12px", fontWeight: 700 }}>{o.orderNumber || o._id?.slice?.(-6) || "—"}</td>
                <td style={{ padding: "8px 12px" }}>{o.patientName || o.UHID || "—"}</td>
                <td style={{ padding: "8px 12px" }}>{(o.items || []).map((it) => it.testName || it.investigationName).filter(Boolean).slice(0, 2).join(", ") || "—"}</td>
                <td style={{ padding: "8px 12px" }}>
                  <Badge value={o.status || "—"} palette={
                    o.status === "DISPATCHED" ? "green" :
                      o.status === "PENDING_COLLECTION" ? "amber" :
                        o.status === "IN_LAB" ? "blue" : "slate"
                  } />
                </td>
                <td style={{ padding: "8px 12px", color: C.muted }}>{fmtTime(o.createdAt || o.orderedAt)}</td>
                <td style={{ padding: "8px 12px", color: C.muted }}>{fmtAgo(o.updatedAt)}</td>
              </tr>
            ))}
      </Table>
    </Card>
  );
}
