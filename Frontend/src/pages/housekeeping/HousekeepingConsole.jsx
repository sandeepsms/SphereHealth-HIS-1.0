/**
 * HousekeepingConsole.jsx — single-page workspace for the Housekeeping
 * role. Same shape as the Ward Boy console: 5 KPI cards on top,
 * 8 pill tabs, each tab is its own self-contained component.
 *
 * URL: /housekeeping  (query ?tab=available|mine|today|shift|spillage|
 *                              checklist|inventory|pest)
 *
 * Notes:
 *   • Shift attendance REUSES /api/ward-ops/shift/* — same backend the
 *     Ward Boy module owns. No duplicate shift tracking.
 *   • Linen + BMW supply logging REUSES /api/ward-ops/supplies — same
 *     backend; the daily-counts UI lives in the Ward Boy console.
 *     Housekeeping focuses on chemical inventory + checklists here.
 */
import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, TabStrip, KPI, Card, Table, Empty, Badge,
  PrimaryButton, Modal, Field, C,
} from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";
import {
  ShiftTab, SpillageTab, ChecklistTab, InventoryTab, PestTab,
} from "./HousekeepingConsoleTabs";

import { API_BASE_URL as API } from "../../config/api";
const authHdr = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("his_token")}` } });

const TYPE_LABEL = {
  "routine":        "Routine",
  "terminal":       "Terminal Clean",
  "spillage":       "Spillage",
  "restroom":       "Restroom",
  "public-area":    "Public Area",
  "bed-turnover":   "Bed Turnover",
  "discharge-clean":"Discharge Clean",
  "other":          "Other",
};
const TYPE_COLOR = {
  "routine":        C.blue,
  "terminal":       C.red,
  "spillage":       C.red,
  "restroom":       C.amber,
  "public-area":    C.green,
  "bed-turnover":   C.purple,
  "discharge-clean":C.teal,
  "other":          C.muted,
};
const TYPE_ICON = {
  "routine":        "pi-sparkles",
  "terminal":       "pi-shield",
  "spillage":       "pi-exclamation-triangle",
  "restroom":       "pi-home",
  "public-area":    "pi-th-large",
  "bed-turnover":   "pi-refresh",
  "discharge-clean":"pi-sign-out",
  "other":          "pi-circle",
};
const PRIORITY_COLOR = { urgent: C.red, high: C.amber, normal: C.blue, low: C.muted };

const fmtAgo = (d) => {
  if (!d) return "—";
  const mins = Math.floor((Date.now() - new Date(d)) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
};
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";

/* ──────────────────────────────────────────────────────────── */
export default function HousekeepingConsole() {
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
    try { const r = await axios.get(`${API}/housekeeping/tasks/stats`, authHdr()); setStats(r.data?.data || {}); }
    catch {}
  };
  useEffect(() => { refreshStats(); const i = setInterval(refreshStats, 30000); return () => clearInterval(i); }, []);

  return (
    <AdminPage>
      <Hero icon="pi-sparkles" color="teal"
        title="Housekeeping Console"
        subtitle="Cleaning tasks · spillage · inventory · NABH checklist · pest control" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
        <KPI label="Available"   value={stats.open ?? "—"}       color={C.amber}  icon="pi-inbox" />
        <KPI label="Assigned"    value={stats.assigned ?? "—"}   color={C.blue}   icon="pi-bookmark" />
        <KPI label="In progress" value={stats.inProgress ?? "—"} color={C.purple} icon="pi-spin pi-spinner" />
        <KPI label="My active"   value={stats.myActive ?? "—"}   color={C.teal}   icon="pi-user-edit" />
        <KPI label="Done today"  value={stats.doneToday ?? "—"}  color={C.green}  icon="pi-check-circle" />
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
          { id: "spillage",  label: "Spillage",   icon: "pi-exclamation-triangle" },
          { id: "checklist", label: "Checklist",  icon: "pi-check-square" },
          { id: "inventory", label: "Inventory",  icon: "pi-box" },
          { id: "pest",      label: "Pest Ctrl",  icon: "pi-shield" },
        ]}
      />

      <div style={{ marginTop: 16 }}>
        {tab === "available" && <AvailableTab onChange={refreshStats} />}
        {tab === "mine"      && <MyTasksTab  onChange={refreshStats} />}
        {tab === "today"     && <TodayTab />}
        {tab === "shift"     && <ShiftTab />}
        {tab === "spillage"  && <SpillageTab />}
        {tab === "checklist" && <ChecklistTab />}
        {tab === "inventory" && <InventoryTab />}
        {tab === "pest"      && <PestTab />}
      </div>
    </AdminPage>
  );
}

/* ══════════════════════════════════════════════════════════════
   AVAILABLE — open cleaning task pool
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
      const r = await axios.get(`${API}/housekeeping/tasks?${qs}`, authHdr());
      const order = { urgent: 0, high: 1, normal: 2, low: 3 };
      setRows((r.data?.data || []).sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9)));
    } catch {}
    setLoading(false);
  };
  useEffect(() => { refresh(); const i = setInterval(refresh, 30000); return () => clearInterval(i); }, [typeFilter]);

  const accept = async (t) => {
    try {
      await axios.patch(`${API}/housekeeping/tasks/${t._id}/accept`, {}, authHdr());
      toast.success(`Claimed: ${t.title}`);
      refresh(); onChange && onChange();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Already taken");
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
            <Empty icon="pi-check-circle" text="Inbox zero — koi pending task nahi hai." />
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
   MY TASKS — assigned / in-progress
══════════════════════════════════════════════════════════════ */
function MyTasksTab({ onChange }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        axios.get(`${API}/housekeeping/tasks?mine=true&status=assigned`, authHdr()).then(r => r.data?.data || []),
        axios.get(`${API}/housekeeping/tasks?mine=true&status=in-progress`, authHdr()).then(r => r.data?.data || []),
      ]);
      setRows([...b, ...a]);
    } catch {}
    setLoading(false);
  };
  useEffect(() => { refresh(); const i = setInterval(refresh, 30000); return () => clearInterval(i); }, []);

  const start = async (t) => {
    try { await axios.patch(`${API}/housekeeping/tasks/${t._id}/start`, {}, authHdr()); toast.success("Started"); refresh(); onChange && onChange(); }
    catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
  };

  return (
    <>
      <Card title={`${rows.length} task${rows.length === 1 ? "" : "s"} on your plate`} color={C.teal} icon="pi-user-edit"
        right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.teal} onClick={refresh} busy={loading} />}>
        {rows.length === 0 ? (
          <Empty icon="pi-check-circle" text="No active tasks. Pickup from Available." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
            {rows.map((t) => (
              <TaskCard key={t._id} task={t}
                mode={t.status === "assigned" ? "start" : "complete"}
                onAction={(task) => task.status === "assigned" ? start(task) : setCompleting(task)} />
            ))}
          </div>
        )}
      </Card>

      {completing && <CompleteModal task={completing} onClose={() => setCompleting(null)} onDone={() => { setCompleting(null); refresh(); onChange && onChange(); }} />}
    </>
  );
}

function CompleteModal({ task, onClose, onDone }) {
  const [notes, setNotes] = useState("");
  const [protocol, setProtocol] = useState("standard");
  const [productsRaw, setProductsRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await axios.patch(`${API}/housekeeping/tasks/${task._id}/complete`, {
        completionNotes: notes,
        protocolFollowed: protocol,
        productsUsed: productsRaw.split(",").map(s => s.trim()).filter(Boolean),
      }, authHdr());
      toast.success("Done.");
      onDone();
    } catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
    setSaving(false);
  };
  return (
    <Modal title={`Complete: ${task.title}`} icon="pi-check" color={C.green} onClose={onClose}
      submitLabel="Mark Done" submitting={saving} onSubmit={submit}>
      <div style={{ marginBottom: 12, padding: "8px 10px", background: "#f0fdf4", border: `1px solid ${C.green}40`, borderRadius: 6, fontSize: 12 }}>
        <strong>{TYPE_LABEL[task.type]}</strong>{task.area && ` · ${task.area}`}
      </div>
      <Field label="Protocol followed">
        <select value={protocol} onChange={(e) => setProtocol(e.target.value)}
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13, background: "#fff" }}>
          <option value="standard">Standard</option>
          <option value="terminal-icu">Terminal (ICU/OT)</option>
          <option value="isolation">Isolation (contagious)</option>
          <option value="spillage">Spillage (biohazard)</option>
          <option value="discharge">Discharge bed turnover</option>
        </select>
      </Field>
      <Field label="Products used (comma-sep)">
        <input value={productsRaw} onChange={(e) => setProductsRaw(e.target.value)}
          placeholder="Phenol, Bleach, Lysol…"
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 13 }} />
      </Field>
      <Field label="Notes (optional)">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          style={{ width: "100%", padding: "8px 10px", border: `1.5px solid ${C.border}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit" }} />
      </Field>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════
   TODAY
══════════════════════════════════════════════════════════════ */
function TodayTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/housekeeping/tasks?mine=true&status=done&limit=100`, authHdr());
      const today = new Date(); today.setHours(0,0,0,0);
      setRows((r.data?.data || []).filter(t => new Date(t.completedAt || t.updatedAt) >= today));
    } catch {}
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const totalMin = rows.reduce((s, t) => t.acceptedAt && t.completedAt ? s + (new Date(t.completedAt) - new Date(t.acceptedAt)) / 60000 : s, 0);

  return (
    <Card title={`Completed today · ${rows.length} task${rows.length === 1 ? "" : "s"} · ${Math.round(totalMin)} min active`}
      color={C.green} icon="pi-check-circle"
      right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.green} onClick={refresh} busy={loading} />}>
      {rows.length === 0 ? (
        <Empty icon="pi-clock" text="No completed tasks today." />
      ) : (
        <Table cols={[
          { label: "Type" }, { label: "Task" }, { label: "Area" }, { label: "Protocol" },
          { label: "Accepted" }, { label: "Done" }, { label: "Duration", align: "right" },
        ]}>
          {rows.map((t, i) => {
            const dur = (t.acceptedAt && t.completedAt) ? Math.round((new Date(t.completedAt) - new Date(t.acceptedAt)) / 60000) : null;
            return (
              <tr key={i}>
                <td><Badge value={TYPE_LABEL[t.type]} /></td>
                <td style={{ fontWeight: 700 }}>{t.title}
                  {t.completionNotes && <div style={{ fontSize: 11, color: C.muted, fontStyle: "italic" }}>{t.completionNotes}</div>}
                </td>
                <td style={{ fontSize: 12, color: C.muted }}>{t.area || "—"}</td>
                <td style={{ fontSize: 11.5 }}>{t.protocolFollowed || "—"}</td>
                <td style={{ fontSize: 11.5, color: C.muted }}>{fmtTime(t.acceptedAt)}</td>
                <td style={{ fontSize: 11.5, color: C.muted }}>{fmtTime(t.completedAt)}</td>
                <td style={{ textAlign: "right", fontWeight: 700, color: C.green }}>{dur != null ? `${dur} min` : "—"}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </Card>
  );
}

/* ── shared cards / pills ──────────────────────────── */
function TaskCard({ task, mode, onAction }) {
  const color  = TYPE_COLOR[task.type] || C.muted;
  const pColor = PRIORITY_COLOR[task.priority] || C.muted;
  const cta = mode === "claim"   ? { label: "Claim", icon: "pi-hand-pointer", color: C.green }
            : mode === "start"   ? { label: "Start", icon: "pi-play",          color: C.blue }
            :                      { label: "Done",  icon: "pi-check",         color: C.green };
  return (
    <div style={{ background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10, borderLeft: `4px solid ${color}`, boxShadow: "0 1px 3px rgba(15,23,42,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", background: color + "15", color }}>
            <i className={`pi ${TYPE_ICON[task.type] || "pi-circle"}`} style={{ fontSize: 14 }} />
          </span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, letterSpacing: ".4px", textTransform: "uppercase" }}>{TYPE_LABEL[task.type]}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text, lineHeight: 1.2 }}>{task.title}</div>
          </div>
        </div>
        <span style={{ padding: "3px 9px", borderRadius: 999, background: pColor + "15", color: pColor, fontSize: 10, fontWeight: 800, letterSpacing: ".5px" }}>
          {task.priority?.toUpperCase()}
        </span>
      </div>

      {(task.area || task.roomNumber || task.bedNumber) && (
        <div style={{ fontSize: 12, color: C.text, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <i className="pi pi-map-marker" style={{ color: C.muted, fontSize: 11 }} />
          {task.area && <span style={{ fontWeight: 700 }}>{task.area}</span>}
          {task.roomNumber && <span style={{ color: C.muted }}>· Room {task.roomNumber}</span>}
          {task.bedNumber && <span style={{ color: C.muted }}>· Bed {task.bedNumber}</span>}
        </div>
      )}

      {task.patientName && (
        <div style={{ fontSize: 12, color: C.text, display: "flex", gap: 6, alignItems: "center" }}>
          <i className="pi pi-user" style={{ color: C.muted, fontSize: 11 }} />
          <span style={{ fontWeight: 700 }}>{task.patientName}</span>
          {task.UHID && <span style={{ color: C.muted, fontSize: 11 }}>· {task.UHID}</span>}
        </div>
      )}

      {task.description && <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.4 }}>{task.description}</div>}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 8, borderTop: `1px dashed ${C.border}` }}>
        <div style={{ fontSize: 10.5, color: C.muted }}>By {task.requestedByName || "—"} · {fmtAgo(task.requestedAt)}</div>
        <button onClick={() => onAction(task)}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 7, border: `1.5px solid ${cta.color}`, background: cta.color, color: "#fff", fontWeight: 800, fontSize: 11.5, cursor: "pointer" }}>
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
      style={{ padding: "5px 12px", borderRadius: 999, border: `1.5px solid ${active ? color : C.border}`, background: active ? color + "15" : "#fff", color: active ? color : C.muted, fontWeight: 700, fontSize: 11.5, cursor: "pointer" }}>
      {label}
    </button>
  );
}
