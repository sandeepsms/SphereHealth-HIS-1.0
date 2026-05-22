/**
 * RadiologistConsole.jsx — Radiologist single-page workspace (stub).
 * (R7bd-E-6 / A3-HIGH-10)
 *
 * URL: /radiology-console   (query ?tab=worklist|reported|pending)
 *
 * Three pill tabs:
 *   1. Worklist        — imaging orders waiting for read
 *                        (/api/investigation-orders?status=IN_LAB&category=imaging)
 *   2. Reported        — reports written but not yet signed off
 *                        (/api/lab-records/reports?status=draft&reportType=imaging-*)
 *   3. Pending Sign-off — reports awaiting verification
 *                        (/api/lab-records/reports?status=reported&reportType=imaging-*)
 *
 * Pre-R7bd Radiologist had no dedicated console — they used the
 * shared LabResultsEntry page which conflated lab + imaging + micro
 * + histopath into one form. NABH RAD.4 wants a separate radiology
 * worklist; this is the first stub for that surface.
 *
 * All tabs read existing endpoints and shape the data client-side
 * (no new backend route is needed for this stub).
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

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
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
  { key: "worklist", label: "Worklist",        icon: "pi-list" },
  { key: "reported", label: "Reported",        icon: "pi-file-edit" },
  { key: "pending",  label: "Pending Sign-off", icon: "pi-check-square" },
];

// Imaging-only reportType filter: every reportType starting with
// "imaging-" plus the radiologist-relevant ones (ecg, echo, pft don't
// belong here — they're cardiology / pulmonary).
const IMAGING_TYPES = new Set([
  "imaging-xray", "imaging-usg", "imaging-ct", "imaging-mri",
  "imaging-mammo", "imaging-bmd", "imaging-other",
]);

export default function RadiologistConsole() {
  const [params, setParams] = useSearchParams();
  const initialTab = params.get("tab") || "worklist";
  const [tab, setTab] = useState(initialTab);
  useEffect(() => {
    if (params.get("tab") !== tab) setParams({ tab }, { replace: true });
  }, [tab]);

  const [counts, setCounts] = useState({ worklist: 0, reported: 0, pending: 0 });
  const refreshCounts = useCallback(async () => {
    try {
      const [w, r] = await Promise.all([
        axios.get(`${API}/investigation-orders?status=IN_LAB&category=imaging`, authHdr()).catch(() => null),
        axios.get(`${API}/lab-records/reports?status=draft`,                    authHdr()).catch(() => null),
      ]);
      const arr = (x) => Array.isArray(x?.data?.data) ? x.data.data
                       : Array.isArray(x?.data)       ? x.data
                       : [];
      const reports = arr(r).filter((rep) => IMAGING_TYPES.has(rep.reportType));
      const reported = reports.filter((rep) => (rep.status || "draft") === "draft").length;
      const pending  = reports.filter((rep) => rep.status === "reported").length;
      setCounts({ worklist: arr(w).length, reported, pending });
    } catch (_) { /* keep last counts */ }
  }, []);
  useEffect(() => { refreshCounts(); const id = setInterval(refreshCounts, 30000); return () => clearInterval(id); }, [refreshCounts]);

  const tabs = useMemo(() => TABS.map((t) => ({
    ...t,
    badge: counts[t.key] > 0 ? String(counts[t.key]) : null,
    badgeTone: counts[t.key] > 0 ? (t.key === "worklist" ? "warn" : "normal") : "idle",
  })), [counts]);

  return (
    <AdminPage>
      <Hero icon="pi-eye" color="blue"
        title="Radiologist Console"
        subtitle="Imaging worklist · reported (draft) · pending sign-off" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Studies to read"     value={counts.worklist} color={C.amber}  icon="pi-list" />
        <KPI label="Reports in draft"    value={counts.reported} color={C.blue}   icon="pi-file-edit" />
        <KPI label="Awaiting sign-off"   value={counts.pending}  color={C.purple} icon="pi-check-square" />
      </div>

      <TabStrip tabs={tabs} value={tab} onChange={setTab} accent={C.blue} accentL="#eff6ff" />

      {tab === "worklist" && <WorklistTab />}
      {tab === "reported" && <ReportedTab />}
      {tab === "pending"  && <PendingSignOffTab />}
    </AdminPage>
  );
}

/* ── Worklist ─────────────────────────────────────────────────── */
function WorklistTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/investigation-orders?status=IN_LAB&category=imaging`, authHdr());
      const data = Array.isArray(r.data?.data) ? r.data.data : (Array.isArray(r.data) ? r.data : []);
      setRows(data);
    } catch (e) {
      toast.error(`Worklist: ${e.response?.data?.message || e.message}`);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <Card title={`Studies awaiting read (${rows.length})`} color={C.amber} icon="pi-list"
      right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.amber} onClick={refresh} />}>
      <Table cols={["Order #", "Patient", "Study", "Ward / Bed", "Acquired", "Action"]}>
        {loading ? <EmptyRow span={6} text="Loading…" /> :
          rows.length === 0 ? <EmptyRow span={6} text="No imaging studies awaiting read." /> :
            rows.map((o, i) => (
              <tr key={o._id || i} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                <td style={{ padding: "8px 12px", fontWeight: 700 }}>{o.orderNumber || o._id?.slice?.(-6) || "—"}</td>
                <td style={{ padding: "8px 12px" }}>{o.patientName || o.UHID || "—"}</td>
                <td style={{ padding: "8px 12px" }}>{(o.items || []).map((it) => it.testName || it.investigationName).filter(Boolean).slice(0, 2).join(", ") || "—"}</td>
                <td style={{ padding: "8px 12px", color: C.muted }}>{o.wardName || o.bedNumber || "—"}</td>
                <td style={{ padding: "8px 12px", color: C.muted }}>{fmtAgo(o.collectedAt || o.updatedAt)}</td>
                <td style={{ padding: "8px 12px" }}>
                  <button onClick={() => navigate(`/lab-results?uhid=${encodeURIComponent(o.UHID || "")}&order=${o._id}&tab=reports`)}
                    style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.blue}`, background: "#eff6ff", color: C.blue, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    <i className="pi pi-pencil" style={{ fontSize: 10, marginRight: 4 }} />Report
                  </button>
                </td>
              </tr>
            ))}
      </Table>
    </Card>
  );
}

/* ── Reported (draft) ─────────────────────────────────────────── */
function ReportedTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/lab-records/reports?status=draft`, authHdr());
      const data = Array.isArray(r.data?.data) ? r.data.data : (Array.isArray(r.data) ? r.data : []);
      setRows(data.filter((rep) => IMAGING_TYPES.has(rep.reportType)));
    } catch (e) {
      toast.error(`Reports (draft): ${e.response?.data?.message || e.message}`);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <Card title={`Reports in draft (${rows.length})`} color={C.blue} icon="pi-file-edit"
      right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.blue} onClick={refresh} />}>
      <Table cols={["Date", "Patient", "Modality", "Test", "Author", "Action"]}>
        {loading ? <EmptyRow span={6} text="Loading…" /> :
          rows.length === 0 ? <EmptyRow span={6} text="No imaging reports in draft." /> :
            rows.map((rep, i) => (
              <tr key={rep._id || i} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                <td style={{ padding: "8px 12px", color: C.muted }}>{fmtDate(rep.reportDate || rep.createdAt)}</td>
                <td style={{ padding: "8px 12px" }}>{rep.patientName || rep.UHID || "—"}</td>
                <td style={{ padding: "8px 12px" }}>{(rep.reportType || "").replace("imaging-", "").toUpperCase() || "—"}</td>
                <td style={{ padding: "8px 12px" }}>{rep.testName || "—"}</td>
                <td style={{ padding: "8px 12px", color: C.muted }}>{rep.createdByName || rep.updatedByName || "—"}</td>
                <td style={{ padding: "8px 12px" }}>
                  <button onClick={() => navigate(`/lab-results?uhid=${encodeURIComponent(rep.UHID || "")}&tab=reports&report=${rep._id}`)}
                    style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.blue}`, background: "#eff6ff", color: C.blue, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    <i className="pi pi-pencil" style={{ fontSize: 10, marginRight: 4 }} />Open
                  </button>
                </td>
              </tr>
            ))}
      </Table>
    </Card>
  );
}

/* ── Pending Sign-off ────────────────────────────────────────── */
function PendingSignOffTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/lab-records/reports?status=reported`, authHdr());
      const data = Array.isArray(r.data?.data) ? r.data.data : (Array.isArray(r.data) ? r.data : []);
      setRows(data.filter((rep) => IMAGING_TYPES.has(rep.reportType)));
    } catch (e) {
      toast.error(`Pending sign-off: ${e.response?.data?.message || e.message}`);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <Card title={`Awaiting sign-off (${rows.length})`} color={C.purple} icon="pi-check-square"
      right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.purple} onClick={refresh} />}>
      <Table cols={["Date", "Patient", "Modality", "Test", "Reported by", "Action"]}>
        {loading ? <EmptyRow span={6} text="Loading…" /> :
          rows.length === 0 ? <EmptyRow span={6} text="No imaging reports awaiting sign-off." /> :
            rows.map((rep, i) => (
              <tr key={rep._id || i} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                <td style={{ padding: "8px 12px", color: C.muted }}>{fmtDate(rep.reportDate || rep.createdAt)}</td>
                <td style={{ padding: "8px 12px" }}>{rep.patientName || rep.UHID || "—"}</td>
                <td style={{ padding: "8px 12px" }}>{(rep.reportType || "").replace("imaging-", "").toUpperCase() || "—"}</td>
                <td style={{ padding: "8px 12px" }}>{rep.testName || "—"}</td>
                <td style={{ padding: "8px 12px", color: C.muted }}>{rep.createdByName || rep.updatedByName || "—"}</td>
                <td style={{ padding: "8px 12px" }}>
                  <button onClick={() => navigate(`/lab-results?uhid=${encodeURIComponent(rep.UHID || "")}&tab=reports&report=${rep._id}`)}
                    style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.green}`, background: "#dcfce7", color: C.green, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                    <i className="pi pi-check" style={{ fontSize: 10, marginRight: 4 }} />Sign
                  </button>
                </td>
              </tr>
            ))}
      </Table>
    </Card>
  );
}
