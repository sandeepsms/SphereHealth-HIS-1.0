/**
 * WardBoyConsole.jsx — Ward Boy single-page workspace.
 *
 * URL: /ward-tasks   (query ?tab=available|mine|today)
 *
 * Three pill tabs:
 *   1. Available  — open tasks the ward boy can claim (priority-sorted)
 *   2. My Tasks   — assigned + in-progress tasks for me, with start/complete
 *                   actions
 *   3. Today      — my completed tasks since 00:00 — for shift review
 *
 * Backend: /api/ward-tasks/* — gated by ward.read / ward.fulfill.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, TabStrip, KPI, Card, Table, Empty, Badge,
  PrimaryButton, Modal, Field, C,
} from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";
import { ShiftTab, EquipmentTab, SuppliesTab, CodeBlueTab, MortuaryTab } from "./WardBoyConsoleTabs";

import { API_BASE_URL as API } from "../../config/api";
const authHdr = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("his_token")}` } });

const TYPE_LABEL = {
  transport: "Transport",
  equipment: "Equipment",
  sample:    "Sample / Report",
  errand:    "Errand",
  linen:     "Linen / BMW",
  bmw:       "BMW",
  other:     "Other",
};
const TYPE_ICON = {
  transport: "pi-arrow-right-arrow-left",
  equipment: "pi-cog",
  sample:    "pi-flask",
  errand:    "pi-shopping-bag",
  linen:     "pi-inbox",
  bmw:       "pi-trash",
  other:     "pi-circle",
};
const TYPE_COLOR = {
  transport: C.blue,
  equipment: C.purple,
  sample:    C.teal,
  errand:    C.amber,
  linen:     C.green,
  bmw:       C.red,
  other:     C.muted,
};
const PRIORITY_COLOR = {
  urgent: C.red,
  high:   C.amber,
  normal: C.blue,
  low:    C.muted,
};

const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtAgo  = (d) => {
  if (!d) return "—";
  const mins = Math.floor((Date.now() - new Date(d)) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
};

/* ──────────────────────────────────────────────────────────── */
export default function WardBoyConsole() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "available");
  useEffect(() => {
    if (params.get("tab") !== tab) setParams({ tab }, { replace: true });
  }, [tab]);
  useEffect(() => {
    const t = params.get("tab") || "available";
    if (t !== tab) setTab(t);
  }, [params]);

  const [stats, setStats] = useState({});
  const refreshStats = async () => {
    try { const r = await axios.get(`${API}/ward-tasks/stats`, authHdr()); setStats(r.data?.data || {}); }
    catch {}
  };
  useEffect(() => { refreshStats(); const i = setInterval(refreshStats, 30000); return () => clearInterval(i); }, []);

  return (
    <AdminPage>
      <Hero icon="pi-user" color="teal"
        title="Ward Boy Console"
        subtitle="Live task board — transport · equipment · samples · errands" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
        <KPI label="Available now"  value={stats.open ?? "—"}       color={C.amber}  icon="pi-inbox" />
        <KPI label="Assigned"       value={stats.assigned ?? "—"}   color={C.blue}   icon="pi-bookmark" />
        <KPI label="In progress"    value={stats.inProgress ?? "—"} color={C.purple} icon="pi-spin pi-spinner" />
        <KPI label="My active"      value={stats.myActive ?? "—"}   color={C.teal}   icon="pi-user-edit" />
        <KPI label="Done today"     value={stats.doneToday ?? "—"}  color={C.green}  icon="pi-check-circle" />
      </div>

      <TabStrip
        value={tab}
        onChange={setTab}
        accent={C.teal}
        accentL="#f0fdfa"
        tabs={[
          { id: "available", label: "Available",  icon: "pi-inbox",         badge: stats.open },
          { id: "mine",      label: "My Tasks",   icon: "pi-user-edit",     badge: stats.myActive },
          { id: "today",     label: "Today",      icon: "pi-check-circle",  badge: stats.doneToday },
          { id: "shift",     label: "Shift",      icon: "pi-clock" },
          { id: "equipment", label: "Equipment",  icon: "pi-cog" },
          { id: "supplies",  label: "Supplies",   icon: "pi-inbox" },
          { id: "code-blue", label: "Code Blue",  icon: "pi-bolt" },
          { id: "mortuary",  label: "Mortuary",   icon: "pi-shield" },
        ]}
      />

      <div style={{ marginTop: 16 }}>
        {tab === "available" && <AvailableTab onChange={refreshStats} />}
        {tab === "mine"      && <MyTasksTab  onChange={refreshStats} />}
        {tab === "today"     && <TodayTab />}
        {tab === "shift"     && <ShiftTab />}
        {tab === "equipment" && <EquipmentTab />}
        {tab === "supplies"  && <SuppliesTab />}
        {tab === "code-blue" && <CodeBlueTab />}
        {tab === "mortuary"  && <MortuaryTab />}
      </div>
    </AdminPage>
  );
}

/* ══════════════════════════════════════════════════════════════
   AVAILABLE — open pool, any ward boy can claim
══════════════════════════════════════════════════════════════ */
function AvailableTab({ onChange }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ status: "open" });
      if (typeFilter) qs.set("type", typeFilter);
      const r = await axios.get(`${API}/ward-tasks?${qs}`, authHdr());
      // Priority-sort: urgent first
      const order = { urgent: 0, high: 1, normal: 2, low: 3 };
      const sorted = (r.data?.data || []).sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
      setRows(sorted);
    } catch (e) {}
    setLoading(false);
  };
  useEffect(() => { refresh(); const i = setInterval(refresh, 30000); return () => clearInterval(i); }, [typeFilter]);

  const accept = async (t) => {
    try {
      await axios.patch(`${API}/ward-tasks/${t._id}/accept`, {}, authHdr());
      toast.success(`Claimed: ${t.title}`);
      refresh(); onChange && onChange();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not claim — task may be already taken.");
      refresh();
    }
  };

  return (
    <>
      <Card title="Filter by type" color={C.amber} icon="pi-filter"
        right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.amber} onClick={refresh} busy={loading} />}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <FilterPill label="All" value="" current={typeFilter} setCurrent={setTypeFilter} color={C.muted} />
          {Object.entries(TYPE_LABEL).map(([k, lbl]) => (
            <FilterPill key={k} label={lbl} value={k} current={typeFilter} setCurrent={setTypeFilter} color={TYPE_COLOR[k]} />
          ))}
        </div>
      </Card>

      <div style={{ marginTop: 12 }}>
        {rows.length === 0 ? (
          <Card title={loading ? "Loading…" : "No open tasks"} color={C.muted} icon="pi-inbox">
            <Empty icon="pi-check-circle" text="Inbox zero — koi pending task nahi hai. Aap rest le sakte ho." />
          </Card>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
            {rows.map((t) => <TaskCard key={t._id} task={t} mode="claim" onAction={accept} />)}
          </div>
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   MY TASKS — assigned + in-progress (start / complete)
══════════════════════════════════════════════════════════════ */
function MyTasksTab({ onChange }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(null);  // task currently in completion modal

  const refresh = async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        axios.get(`${API}/ward-tasks?mine=true&status=assigned`,    authHdr()).then(r => r.data?.data || []),
        axios.get(`${API}/ward-tasks?mine=true&status=in-progress`, authHdr()).then(r => r.data?.data || []),
      ]);
      setRows([...b, ...a]);  // in-progress first
    } catch (e) {}
    setLoading(false);
  };
  useEffect(() => { refresh(); const i = setInterval(refresh, 30000); return () => clearInterval(i); }, []);

  const start = async (t) => {
    try {
      await axios.patch(`${API}/ward-tasks/${t._id}/start`, {}, authHdr());
      toast.success(`Started: ${t.title}`);
      refresh(); onChange && onChange();
    } catch (e) { toast.error(e?.response?.data?.message || "Could not start"); }
  };

  return (
    <>
      <Card title={`${rows.length} task${rows.length === 1 ? "" : "s"} on your plate`} color={C.teal} icon="pi-user-edit"
        right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.teal} onClick={refresh} busy={loading} />}>
        {rows.length === 0 ? (
          <Empty icon="pi-check-circle" text="No active tasks. Head to Available to claim one." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
            {rows.map((t) => (
              <TaskCard key={t._id} task={t}
                mode={t.status === "assigned" ? "start" : "complete"}
                onAction={(task) => {
                  if (task.status === "assigned") start(task);
                  else setCompleting(task);
                }} />
            ))}
          </div>
        )}
      </Card>

      {completing && (
        <CompleteModal task={completing}
          onClose={() => setCompleting(null)}
          onDone={() => { setCompleting(null); refresh(); onChange && onChange(); }} />
      )}
    </>
  );
}

function CompleteModal({ task, onClose, onDone }) {
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const complete = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API}/ward-tasks/${task._id}/complete`, { completionNotes: notes }, authHdr());
      toast.success("Task completed.");
      onDone && onDone();
    } catch (e) { toast.error(e?.response?.data?.message || "Could not complete"); }
    setSaving(false);
  };
  return (
    <Modal title={`Complete: ${task.title}`} icon="pi-check" color={C.green} onClose={onClose}
      submitLabel="Mark Done" submitting={saving} onSubmit={complete}>
      <div style={{ marginBottom: 10, padding: "8px 10px", background: "#f0fdf4", border: `1px solid ${C.green}40`, borderRadius: 6, fontSize: 12, color: C.text }}>
        <strong>{TYPE_LABEL[task.type]}</strong>{" "}
        {task.fromLocation && <span style={{ color: C.muted }}>· from {task.fromLocation}</span>}
        {task.toLocation && <span style={{ color: C.muted }}> · to {task.toLocation}</span>}
        {task.patientName && <div style={{ marginTop: 4 }}><strong>Patient:</strong> {task.patientName} ({task.UHID})</div>}
      </div>
      <Field label="Completion notes (optional)">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          placeholder="e.g. Patient handed over to OT staff. Wheelchair returned to ward."
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} />
      </Field>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════
   TODAY — my completed tasks since 00:00 (shift review)
══════════════════════════════════════════════════════════════ */
function TodayTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/ward-tasks?mine=true&status=done&limit=100`, authHdr());
      const today = new Date(); today.setHours(0,0,0,0);
      setRows((r.data?.data || []).filter(t => new Date(t.completedAt || t.updatedAt) >= today));
    } catch (e) {}
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const totalMin = useMemo(() => rows.reduce((s, t) => {
    if (!t.acceptedAt || !t.completedAt) return s;
    return s + (new Date(t.completedAt) - new Date(t.acceptedAt)) / 60000;
  }, 0), [rows]);

  return (
    <Card title={`Completed today · ${rows.length} task${rows.length === 1 ? "" : "s"} · ${Math.round(totalMin)} min active time`}
      color={C.green} icon="pi-check-circle"
      right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.green} onClick={refresh} busy={loading} />}>
      {rows.length === 0 ? (
        <Empty icon="pi-clock" text="No completed tasks yet today. Pickup something from Available to get started." />
      ) : (
        <Table cols={[
          { label: "Type" }, { label: "Task" }, { label: "Patient" },
          { label: "Route" }, { label: "Accepted" }, { label: "Completed" }, { label: "Duration" },
        ]}>
          {rows.map((t, i) => {
            const dur = (t.acceptedAt && t.completedAt) ? Math.round((new Date(t.completedAt) - new Date(t.acceptedAt)) / 60000) : null;
            return (
              <tr key={i}>
                <td><Badge value={TYPE_LABEL[t.type] || t.type} /></td>
                <td style={{ fontWeight: 700 }}>
                  {t.title}
                  {t.completionNotes && <div style={{ fontSize: 11, color: C.muted, fontStyle: "italic", marginTop: 2 }}>{t.completionNotes}</div>}
                </td>
                <td style={{ fontSize: 12 }}>{t.patientName || "—"}{t.UHID && <div style={{ color: C.muted, fontSize: 11 }}>{t.UHID}</div>}</td>
                <td style={{ fontSize: 12, color: C.muted }}>{t.fromLocation || "—"} → {t.toLocation || "—"}</td>
                <td style={{ fontSize: 11.5, color: C.muted }}>{fmtTime(t.acceptedAt)}</td>
                <td style={{ fontSize: 11.5, color: C.muted }}>{fmtTime(t.completedAt)}</td>
                <td style={{ fontWeight: 700, color: C.green }}>{dur != null ? `${dur} min` : "—"}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════
   Reusable task card
══════════════════════════════════════════════════════════════ */
function TaskCard({ task, mode, onAction }) {
  const color  = TYPE_COLOR[task.type] || C.muted;
  const pColor = PRIORITY_COLOR[task.priority] || C.muted;
  const cta = mode === "claim"   ? { label: "Claim", icon: "pi-hand-pointer", color: C.green }
            : mode === "start"   ? { label: "Start", icon: "pi-play",          color: C.blue }
            :                      { label: "Done",  icon: "pi-check",         color: C.green };
  return (
    <div style={{
      background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 12,
      padding: 14, display: "flex", flexDirection: "column", gap: 10,
      borderLeft: `4px solid ${color}`,
      boxShadow: "0 1px 3px rgba(15,23,42,.05)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 30, height: 30, borderRadius: 8,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: color + "15", color,
          }}><i className={`pi ${TYPE_ICON[task.type] || "pi-circle"}`} style={{ fontSize: 14 }} /></span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: ".4px", textTransform: "uppercase" }}>
              {TYPE_LABEL[task.type] || task.type}
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text, lineHeight: 1.2 }}>{task.title}</div>
          </div>
        </div>
        <span style={{ padding: "3px 9px", borderRadius: 999, background: pColor + "15", color: pColor, fontSize: 10, fontWeight: 800, letterSpacing: ".5px", whiteSpace: "nowrap" }}>
          {task.priority?.toUpperCase()}
        </span>
      </div>

      {(task.fromLocation || task.toLocation) && (
        <div style={{ fontSize: 12, color: C.text, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <i className="pi pi-map-marker" style={{ color: C.muted, fontSize: 11 }} />
          {task.fromLocation && <span style={{ fontWeight: 700 }}>{task.fromLocation}</span>}
          {task.fromLocation && task.toLocation && <span style={{ color: C.muted }}>→</span>}
          {task.toLocation && <span style={{ fontWeight: 700 }}>{task.toLocation}</span>}
        </div>
      )}

      {task.patientName && (
        <div style={{ fontSize: 12, color: C.text, display: "flex", gap: 6, alignItems: "center" }}>
          <i className="pi pi-user" style={{ color: C.muted, fontSize: 11 }} />
          <span style={{ fontWeight: 700 }}>{task.patientName}</span>
          {task.UHID && <span style={{ color: C.muted, fontSize: 11 }}>· {task.UHID}</span>}
        </div>
      )}

      {task.description && (
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.4 }}>{task.description}</div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 8, borderTop: `1px dashed ${C.border}` }}>
        <div style={{ fontSize: 10.5, color: C.muted }}>
          By {task.requestedByName || "—"} · {fmtAgo(task.requestedAt)}
        </div>
        <button onClick={() => onAction(task)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "6px 12px", borderRadius: 7,
            border: `1.5px solid ${cta.color}`, background: cta.color, color: "#fff",
            fontWeight: 800, fontSize: 11.5, cursor: "pointer",
          }}>
          <i className={`pi ${cta.icon}`} style={{ fontSize: 11 }} />{cta.label}
        </button>
      </div>
    </div>
  );
}

function FilterPill({ label, value, current, setCurrent, color }) {
  const active = value === current;
  return (
    <button onClick={() => setCurrent(active ? "" : value)}
      style={{
        padding: "5px 12px", borderRadius: 999,
        border: `1.5px solid ${active ? color : C.border}`,
        background: active ? color + "15" : "#fff",
        color: active ? color : C.muted,
        fontWeight: 700, fontSize: 11.5, cursor: "pointer",
      }}>{label}</button>
  );
}
