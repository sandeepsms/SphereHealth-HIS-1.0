/**
 * PhysiotherapistConsoleTabs.jsx — R7bj-F1.
 *
 * Three tabs for /physiotherapist (mounted by PhysiotherapistConsole.jsx):
 *   1. MyPatientsTab      — admissions with an Active plan or a fresh referral
 *   2. TodaysSessionsTab  — today's IST schedule + sign-off
 *   3. PlansTab           — filterable list + drill into per-plan session view
 *
 * Token: sessionStorage-only (R7bh-F9). No localStorage fallback.
 * AbortController on every fetch so a tab switch mid-flight doesn't trigger
 * a setState on an unmounted node (React 18 strict-mode safe).
 *
 * Polling: useVisiblePoll @ 30s. The poller is gated on tab visibility so
 * a hidden /physiotherapist tab doesn't keep hitting the API.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  C, Card, KPI, Table, EmptyRow, Empty, Badge, Modal, Field,
  PrimaryButton, SearchInput, RowAction,
} from "../../Components/admin-theme";
import { useVisiblePoll } from "../../utils/pollingHelpers";
import { API_BASE_URL } from "../../config/api";

const API = `${API_BASE_URL}/physio`;
const POLL_MS = 30_000;

const MODALITY_LABELS = {
  ULTRASOUND:     "Ultrasound",
  SWD:            "Short-wave Diathermy",
  TENS:           "TENS",
  IFC:            "IFC",
  HOT_PACK:       "Hot Pack",
  CRYO:           "Cryo",
  MANUAL_THERAPY: "Manual Therapy",
  EXERCISE:       "Exercise",
  MOBILIZATION:   "Mobilization",
  CHEST_PHYSIO:   "Chest Physio",
  GAIT:           "Gait Training",
  BALANCE:        "Balance Training",
  STRENGTH:       "Strength Training",
  ROM:            "Range of Motion",
};

const FREQUENCY_LABELS = {
  BD:     "Twice a day (BD)",
  OD:     "Once a day (OD)",
  "2D":   "Every 2 days",
  "3D":   "Every 3 days",
  WEEKLY: "Weekly",
  PRN:    "PRN (as needed)",
};

const STATUS_PALETTE = {
  SCHEDULED: "pending",
  COMPLETED: "active",
  MISSED:    "rejected",
  CANCELLED: "inactive",
  ACTIVE:    "active",
};

// ── sessionStorage-only auth header (R7bh-F9) ────────────────
function authHdr() {
  let token = "";
  try { token = sessionStorage.getItem("his_token") || ""; } catch { /* private mode */ }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Thin wrapper around fetch — JSON in, parsed-JSON out, throws on non-2xx
// with the server's `message` so toast.error gets the right text.
async function api(path, { method = "GET", body, signal } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...authHdr(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  let payload = null;
  try { payload = await r.json(); } catch { /* empty body */ }
  if (!r.ok || (payload && payload.success === false)) {
    const msg = payload?.message || r.statusText || "Request failed";
    const err = new Error(msg);
    err.status = r.status;
    err.code   = payload?.code;
    throw err;
  }
  return payload || {};
}

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const fmtDT   = (d) => d ? `${fmtDate(d)} ${fmtTime(d)}` : "—";

// ════════════════════════════════════════════════════════════════
// 1. MY PATIENTS
// ════════════════════════════════════════════════════════════════
export function MyPatientsTab({ onJumpToSessions }) {
  const [rows, setRows]       = useState([]);
  const [stats, setStats]     = useState({});
  const [q, setQ]             = useState("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);
  const [editingPlan, setEditingPlan] = useState(null);  // plan or null
  const [creatingFor, setCreatingFor] = useState(null);  // admission row or null

  const load = async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      const [plans, s] = await Promise.all([
        api("/plans?status=ACTIVE", { signal: abortRef.current.signal }),
        api("/stats", { signal: abortRef.current.signal }),
      ]);
      setRows(plans.data || []);
      setStats(s.data || {});
    } catch (e) {
      if (e.name !== "AbortError") toast.error(`Failed to load: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); return () => { if (abortRef.current) abortRef.current.abort(); }; }, []);
  useVisiblePoll(load, POLL_MS, []);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const ql = q.toLowerCase();
    return rows.filter((r) =>
      (r.UHID || "").toLowerCase().includes(ql) ||
      (r.patientName || "").toLowerCase().includes(ql) ||
      (r.diagnosis || "").toLowerCase().includes(ql)
    );
  }, [rows, q]);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Active Plans"      value={stats.activePlans ?? rows.length} color={C.green}  icon="pi-bookmark" />
        <KPI label="Sessions Today"    value={stats.scheduled ?? "—"}  color={C.blue}   icon="pi-calendar" />
        <KPI label="Completed Today"   value={stats.completed ?? "—"}  color={C.purple} icon="pi-check-circle" />
        <KPI label="Missed"            value={stats.missed ?? "—"}     color={C.amber}  icon="pi-clock" />
      </div>

      <Card
        title="Active physiotherapy plans"
        color={C.green}
        icon="pi-users"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="UHID, name, diagnosis…" />
            <PrimaryButton label="Refresh" icon="pi-refresh" color={C.green} onClick={load} busy={loading} />
          </div>
        }
      >
        <Table cols={["UHID", "Patient", "Diagnosis", "Modalities", "Frequency", "Progress", "Started", "Action"]}>
          {filtered.length === 0 ? (
            <EmptyRow span={8} text={loading ? "Loading plans…" : "No active plans. Create one from the IPD ledger via the doctor's order panel."} />
          ) : (
            filtered.map((p) => {
              const total = Number(p.sessionsTotal || 0);
              const done  = Number(p.sessionsCompleted || 0);
              const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <tr key={p._id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 11 }}>{p.UHID || "—"}</td>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>{p.patientName || "—"}</td>
                  <td style={{ padding: "8px 12px", color: C.muted, fontSize: 11.5 }}>{p.diagnosis || "—"}</td>
                  <td style={{ padding: "8px 12px", fontSize: 11 }}>
                    {(p.modalitySet || []).slice(0, 3).map((m) => (
                      <span key={m} style={{ display: "inline-block", padding: "1px 6px", marginRight: 3, marginBottom: 2, background: C.greenL, color: "#15803d", borderRadius: 3, fontSize: 10, fontWeight: 700 }}>{m}</span>
                    ))}
                    {(p.modalitySet || []).length > 3 && <span style={{ color: C.muted, fontSize: 10 }}>+{p.modalitySet.length - 3}</span>}
                  </td>
                  <td style={{ padding: "8px 12px" }}><Badge value={p.frequency} /></td>
                  <td style={{ padding: "8px 12px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{done} / {total}</div>
                    <div style={{ width: 80, height: 4, background: C.subtle, borderRadius: 2, overflow: "hidden", marginTop: 2 }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? C.green : C.blue }} />
                    </div>
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 11, color: C.muted }}>{fmtDate(p.createdAt)}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <RowAction icon="pi-plus" label="Session" color={C.green}
                      onClick={() => setCreatingFor({ plan: p })} />
                    <RowAction icon="pi-pencil" label="Edit" color={C.blue}
                      onClick={() => setEditingPlan(p)} />
                  </td>
                </tr>
              );
            })
          )}
        </Table>
      </Card>

      {creatingFor && (
        <SessionCreateModal
          plan={creatingFor.plan}
          onClose={() => setCreatingFor(null)}
          onSaved={() => { setCreatingFor(null); load(); onJumpToSessions && onJumpToSessions(); }}
        />
      )}
      {editingPlan && (
        <PlanEditModal
          plan={editingPlan}
          onClose={() => setEditingPlan(null)}
          onSaved={() => { setEditingPlan(null); load(); }}
        />
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// 2. TODAY'S SESSIONS
// ════════════════════════════════════════════════════════════════
export function TodaysSessionsTab() {
  const [rows, setRows]       = useState([]);
  const [stats, setStats]     = useState({});
  const [loading, setLoading] = useState(false);
  const [signingId, setSigningId] = useState(null);
  const [cancelingRow, setCancelingRow] = useState(null);
  const abortRef = useRef(null);

  const load = async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      // ISO day window in IST (UTC+5:30). Day-start in IST is the
      // previous day's 18:30 UTC; day-end is today's 18:29:59 UTC.
      const now = new Date();
      const istNow = new Date(now.getTime() + (330 * 60_000));
      const dayStart = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0));
      // shift back from "UTC-derived IST-midnight" to actual UTC instant
      const fromUTC = new Date(dayStart.getTime() - (330 * 60_000));
      const toUTC   = new Date(fromUTC.getTime() + 86_400_000 - 1);
      const [list, s] = await Promise.all([
        api(`/sessions?from=${encodeURIComponent(fromUTC.toISOString())}&to=${encodeURIComponent(toUTC.toISOString())}&limit=200`,
            { signal: abortRef.current.signal }),
        api("/stats", { signal: abortRef.current.signal }),
      ]);
      setRows(list.data || []);
      setStats(s.data || {});
    } catch (e) {
      if (e.name !== "AbortError") toast.error(`Failed to load: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); return () => { if (abortRef.current) abortRef.current.abort(); }; }, []);
  useVisiblePoll(load, POLL_MS, []);

  const signOff = async (id) => {
    setSigningId(id);
    try {
      await api(`/sessions/${id}/complete`, { method: "PUT" });
      toast.success("Session signed off — bill row queued.");
      await load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSigningId(null);
    }
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Scheduled"  value={rows.filter(r => r.status === "SCHEDULED").length} color={C.amber}  icon="pi-clock" />
        <KPI label="Completed"  value={rows.filter(r => r.status === "COMPLETED").length} color={C.green}  icon="pi-check-circle" />
        <KPI label="Missed"     value={rows.filter(r => r.status === "MISSED").length}    color={C.red}    icon="pi-times-circle" />
        <KPI label="Cancelled"  value={rows.filter(r => r.status === "CANCELLED").length} color={C.muted}  icon="pi-ban" />
      </div>

      <Card
        title={`Today (${fmtDate(new Date())})`}
        color={C.green}
        icon="pi-calendar"
        right={<PrimaryButton label="Refresh" icon="pi-refresh" color={C.green} onClick={load} busy={loading} />}
      >
        <Table cols={["Time", "UHID", "Patient", "Modality", "Duration", "Pain B/A", "Status", "Action"]}>
          {rows.length === 0 ? (
            <EmptyRow span={8} text={loading ? "Loading sessions…" : "No sessions scheduled today."} />
          ) : (
            rows.map((s) => (
              <tr key={s._id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 11 }}>{fmtTime(s.sessionDate)}</td>
                <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 11 }}>{s.UHID || "—"}</td>
                <td style={{ padding: "8px 12px", fontWeight: 600 }}>{s.patientName || "—"}</td>
                <td style={{ padding: "8px 12px", fontSize: 11 }}>{MODALITY_LABELS[s.sessionType] || s.sessionType || "—"}</td>
                <td style={{ padding: "8px 12px", fontSize: 11 }}>{s.duration_min ? `${s.duration_min} min` : "—"}</td>
                <td style={{ padding: "8px 12px", fontSize: 11 }}>
                  {s.painScoreBefore != null ? s.painScoreBefore : "—"} → {s.painScoreAfter != null ? s.painScoreAfter : "—"}
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <Badge value={s.status} palette={STATUS_PALETTE[s.status]} />
                </td>
                <td style={{ padding: "8px 12px" }}>
                  {s.status === "SCHEDULED" && (
                    <>
                      <RowAction
                        icon="pi-check"
                        label={signingId === s._id ? "…" : "Sign-off"}
                        color={C.green}
                        disabled={signingId === s._id}
                        onClick={() => signOff(s._id)}
                      />
                      <RowAction icon="pi-times" label="Cancel" color={C.red}
                        onClick={() => setCancelingRow(s)} />
                    </>
                  )}
                  {s.status === "COMPLETED" && (
                    <span style={{ fontSize: 10, color: C.muted }}>
                      signed by {s.signedByName || "—"} · {fmtTime(s.signedAt)}
                    </span>
                  )}
                </td>
              </tr>
            ))
          )}
        </Table>
      </Card>

      {cancelingRow && (
        <CancelModal
          title={`Cancel session for ${cancelingRow.patientName}`}
          onClose={() => setCancelingRow(null)}
          onConfirm={async (reason) => {
            try {
              await api(`/sessions/${cancelingRow._id}/cancel`, { method: "PUT", body: { reason } });
              toast.success("Session cancelled.");
              setCancelingRow(null);
              load();
            } catch (e) { toast.error(e.message); }
          }}
        />
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// 3. PLANS (filterable list + drill-in)
// ════════════════════════════════════════════════════════════════
export function PlansTab() {
  const [rows, setRows]       = useState([]);
  const [status, setStatus]   = useState("ACTIVE");
  const [uhid, setUhid]       = useState("");
  const [loading, setLoading] = useState(false);
  const [drillPlan, setDrillPlan] = useState(null);
  const abortRef = useRef(null);

  const load = async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (uhid.trim()) params.set("UHID", uhid.trim().toUpperCase());
      const r = await api(`/plans?${params.toString()}`, { signal: abortRef.current.signal });
      setRows(r.data || []);
    } catch (e) {
      if (e.name !== "AbortError") toast.error(`Failed to load: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); return () => { if (abortRef.current) abortRef.current.abort(); }; }, [status]);
  useVisiblePoll(load, POLL_MS, [status]);

  return (
    <>
      <Card
        title="Physiotherapy plans"
        color={C.green}
        icon="pi-list"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select className="his-field" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <input className="his-field" placeholder="UHID filter…" value={uhid}
              onChange={(e) => setUhid(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") load(); }} />
            <PrimaryButton label="Search" icon="pi-search" color={C.green} onClick={load} busy={loading} />
          </div>
        }
      >
        <Table cols={["UHID", "Patient", "Diagnosis", "Status", "Progress", "Created", "Action"]}>
          {rows.length === 0 ? (
            <EmptyRow span={7} text={loading ? "Loading…" : "No plans match the filter."} />
          ) : (
            rows.map((p) => {
              const total = Number(p.sessionsTotal || 0);
              const done  = Number(p.sessionsCompleted || 0);
              const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <tr key={p._id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 11 }}>{p.UHID || "—"}</td>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>{p.patientName || "—"}</td>
                  <td style={{ padding: "8px 12px", color: C.muted, fontSize: 11.5 }}>{p.diagnosis || "—"}</td>
                  <td style={{ padding: "8px 12px" }}><Badge value={p.status} palette={STATUS_PALETTE[p.status]} /></td>
                  <td style={{ padding: "8px 12px", fontSize: 11 }}>{done} / {total} ({pct}%)</td>
                  <td style={{ padding: "8px 12px", fontSize: 11, color: C.muted }}>{fmtDate(p.createdAt)}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <RowAction icon="pi-eye" label="Open" color={C.blue} onClick={() => setDrillPlan(p)} />
                  </td>
                </tr>
              );
            })
          )}
        </Table>
      </Card>

      {drillPlan && (
        <PlanDrillModal plan={drillPlan} onClose={() => setDrillPlan(null)} onMutate={load} />
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// Plan drill-in modal: shows the per-plan session schedule and lets
// the therapist add / sign-off / cancel session rows from a single
// view (mirror of TodaysSessionsTab but scoped to one planId).
// ════════════════════════════════════════════════════════════════
function PlanDrillModal({ plan, onClose, onMutate }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [creating, setCreating] = useState(false);
  const [signingId, setSigningId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api(`/sessions?planId=${plan._id}&limit=200`);
      setSessions(r.data || []);
    } catch (e) { toast.error(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [plan._id]);

  const signOff = async (id) => {
    setSigningId(id);
    try {
      await api(`/sessions/${id}/complete`, { method: "PUT" });
      toast.success("Session signed off.");
      await load();
      onMutate && onMutate();
    } catch (e) { toast.error(e.message); }
    setSigningId(null);
  };

  return (
    <Modal
      title={`${plan.patientName} · ${plan.diagnosis || "—"}`}
      color={C.green}
      icon="pi-bolt"
      size={920}
      hideFooter
      onClose={onClose}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
        <KPI label="Sessions" value={`${plan.sessionsCompleted}/${plan.sessionsTotal}`} color={C.green} icon="pi-bookmark" />
        <KPI label="Frequency"   value={FREQUENCY_LABELS[plan.frequency] || plan.frequency} color={C.blue}  icon="pi-clock" />
        <KPI label="Status"       value={plan.status} color={C.purple} icon="pi-info-circle" />
        <KPI label="Modalities"   value={(plan.modalitySet || []).length} color={C.amber} icon="pi-th-large" />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Sessions ({sessions.length})</div>
        <PrimaryButton label="Add session" icon="pi-plus" color={C.green}
          disabled={plan.status !== "ACTIVE"}
          onClick={() => setCreating(true)} />
      </div>

      <Table cols={["Date", "Modality", "Duration", "Pain", "Tolerance", "Fee", "Status", "Action"]} compact>
        {sessions.length === 0 ? (
          <EmptyRow span={8} text={loading ? "Loading…" : "No sessions logged yet."} />
        ) : (
          sessions.map((s) => (
            <tr key={s._id} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "7px 10px", fontSize: 11 }}>{fmtDT(s.sessionDate)}</td>
              <td style={{ padding: "7px 10px", fontSize: 11 }}>{MODALITY_LABELS[s.sessionType] || s.sessionType || "—"}</td>
              <td style={{ padding: "7px 10px", fontSize: 11 }}>{s.duration_min || "—"} min</td>
              <td style={{ padding: "7px 10px", fontSize: 11 }}>
                {s.painScoreBefore ?? "—"} → {s.painScoreAfter ?? "—"}
              </td>
              <td style={{ padding: "7px 10px", fontSize: 11 }}>{s.tolerance || "—"}</td>
              <td style={{ padding: "7px 10px", fontSize: 11, fontFamily: "monospace" }}>
                ₹{Number(s.sessionFee || 0).toFixed(2)}
              </td>
              <td style={{ padding: "7px 10px" }}><Badge value={s.status} palette={STATUS_PALETTE[s.status]} /></td>
              <td style={{ padding: "7px 10px" }}>
                {s.status === "SCHEDULED" && (
                  <RowAction icon="pi-check" label={signingId === s._id ? "…" : "Sign"} color={C.green}
                    disabled={signingId === s._id}
                    onClick={() => signOff(s._id)} />
                )}
              </td>
            </tr>
          ))
        )}
      </Table>

      {creating && (
        <SessionCreateModal
          plan={plan}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); load(); onMutate && onMutate(); }}
        />
      )}
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════
// Plan edit modal — narrow form, edits diagnosis/goals/frequency/
// modalitySet/dischargeAdvice. Status and sessionsCompleted are
// stripped server-side; sessionsTotal is editable here for ad-hoc
// extensions but capped at 60.
// ════════════════════════════════════════════════════════════════
function PlanEditModal({ plan, onClose, onSaved }) {
  const [form, setForm] = useState({
    diagnosis:        plan.diagnosis || "",
    goals:            (plan.goals || []).join("\n"),
    modalitySet:      plan.modalitySet || [],
    sessionsTotal:    plan.sessionsTotal,
    frequency:        plan.frequency,
    dischargeAdvice:  plan.dischargeAdvice || "",
  });
  const [busy, setBusy] = useState(false);

  const toggleMod = (m) => {
    setForm((f) => ({ ...f, modalitySet: f.modalitySet.includes(m) ? f.modalitySet.filter((x) => x !== m) : [...f.modalitySet, m] }));
  };

  const save = async () => {
    if (Number(form.sessionsTotal) < (plan.sessionsCompleted || 0)) {
      toast.error(`sessionsTotal cannot be less than already-completed sessions (${plan.sessionsCompleted})`);
      return;
    }
    setBusy(true);
    try {
      await api(`/plans/${plan._id}`, {
        method: "PUT",
        body: {
          diagnosis:       form.diagnosis,
          goals:           form.goals.split("\n").map(s => s.trim()).filter(Boolean),
          modalitySet:     form.modalitySet,
          sessionsTotal:   Number(form.sessionsTotal),
          frequency:       form.frequency,
          dischargeAdvice: form.dischargeAdvice,
        },
      });
      toast.success("Plan updated.");
      onSaved && onSaved();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <Modal title={`Edit plan · ${plan.patientName}`} color={C.green} icon="pi-pencil"
      size={720} submitting={busy} submitLabel="Save plan" onSubmit={save} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Diagnosis">
          <input className="his-field" value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} />
        </Field>
        <Field label="Frequency" required>
          <select className="his-field" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
            {Object.entries(FREQUENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Sessions total" required>
          <input className="his-field" type="number" min={plan.sessionsCompleted || 1} max={60}
            value={form.sessionsTotal} onChange={(e) => setForm({ ...form, sessionsTotal: e.target.value })} />
        </Field>
        <Field label="Discharge advice">
          <input className="his-field" value={form.dischargeAdvice} onChange={(e) => setForm({ ...form, dischargeAdvice: e.target.value })} />
        </Field>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label="Goals (one per line)">
            <textarea className="his-field" rows={3} value={form.goals} onChange={(e) => setForm({ ...form, goals: e.target.value })} />
          </Field>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label="Modalities">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.entries(MODALITY_LABELS).map(([k, v]) => {
                const on = form.modalitySet.includes(k);
                return (
                  <button key={k} type="button" onClick={() => toggleMod(k)}
                    style={{
                      padding: "4px 10px", borderRadius: 14, fontSize: 11, fontWeight: 700,
                      border: on ? `1.5px solid ${C.green}` : `1px solid ${C.border}`,
                      background: on ? C.greenL : "#fff", color: on ? "#15803d" : C.muted, cursor: "pointer",
                    }}>{v}</button>
                );
              })}
            </div>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════
// Session create modal — opened from MyPatientsTab or PlanDrillModal.
// Captures the per-session data (modality, duration, pain B/A,
// tolerance, fee, notes). Status defaults to SCHEDULED; a "Sign now"
// checkbox lets the therapist record + complete in one step (which
// also fires the billing trigger via PUT /sessions/:id/complete).
// ════════════════════════════════════════════════════════════════
function SessionCreateModal({ plan, onClose, onSaved }) {
  const [form, setForm] = useState({
    sessionType:    plan.modalitySet?.[0] || "",
    duration_min:   30,
    modalitiesUsed: [],
    painScoreBefore: "",
    painScoreAfter:  "",
    tolerance:      "GOOD",
    patientCompliant: true,
    notes:          "",
    sessionFee:     0,
    signNow:        false,
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        sessionType:     form.sessionType,
        duration_min:    Number(form.duration_min),
        modalitiesUsed:  form.modalitiesUsed,
        painScoreBefore: form.painScoreBefore === "" ? undefined : Number(form.painScoreBefore),
        painScoreAfter:  form.painScoreAfter === ""  ? undefined : Number(form.painScoreAfter),
        tolerance:       form.tolerance,
        patientCompliant: form.patientCompliant,
        notes:           form.notes,
        sessionFee:      Number(form.sessionFee) || 0,
      };
      const r = await api(`/plans/${plan._id}/sessions`, { method: "POST", body: payload });
      if (form.signNow && r.data?._id) {
        await api(`/sessions/${r.data._id}/complete`, { method: "PUT" });
      }
      toast.success(form.signNow ? "Session recorded & signed." : "Session scheduled.");
      onSaved && onSaved();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  const modSet = plan.modalitySet || [];

  return (
    <Modal title={`New session · ${plan.patientName}`} color={C.green} icon="pi-plus"
      size={680} submitting={busy} submitLabel={form.signNow ? "Save & sign" : "Save"}
      onSubmit={save} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Modality" required>
          <select className="his-field" value={form.sessionType} onChange={(e) => setForm({ ...form, sessionType: e.target.value })}>
            <option value="">— select —</option>
            {modSet.map((m) => <option key={m} value={m}>{MODALITY_LABELS[m] || m}</option>)}
          </select>
        </Field>
        <Field label="Duration (min)" required>
          <input className="his-field" type="number" min={5} max={120}
            value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} />
        </Field>
        <Field label="Pain before (0-10)">
          <input className="his-field" type="number" min={0} max={10}
            value={form.painScoreBefore} onChange={(e) => setForm({ ...form, painScoreBefore: e.target.value })} />
        </Field>
        <Field label="Pain after (0-10)">
          <input className="his-field" type="number" min={0} max={10}
            value={form.painScoreAfter} onChange={(e) => setForm({ ...form, painScoreAfter: e.target.value })} />
        </Field>
        <Field label="Tolerance">
          <select className="his-field" value={form.tolerance} onChange={(e) => setForm({ ...form, tolerance: e.target.value })}>
            <option value="GOOD">Good</option>
            <option value="FAIR">Fair</option>
            <option value="POOR">Poor</option>
          </select>
        </Field>
        <Field label="Session fee (₹)">
          <input className="his-field" type="number" min={0} step={0.01}
            value={form.sessionFee} onChange={(e) => setForm({ ...form, sessionFee: e.target.value })} />
        </Field>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label="Notes">
            <textarea className="his-field" rows={3} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12 }}>
            <input type="checkbox" checked={form.signNow}
              onChange={(e) => setForm({ ...form, signNow: e.target.checked })} />
            <span><strong>Sign-off immediately</strong> — records as COMPLETED and queues the bill row.</span>
          </label>
        </div>
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════
// Cancel modal — required reason field. Plan + session use the same
// component (different endpoint passed in by parent via onConfirm).
// ════════════════════════════════════════════════════════════════
function CancelModal({ title, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy]     = useState(false);
  return (
    <Modal title={title} color={C.red} icon="pi-ban"
      size={460} submitting={busy} submitLabel="Confirm cancel"
      onSubmit={async () => {
        if (!reason.trim()) { toast.error("Reason required."); return; }
        setBusy(true);
        try { await onConfirm(reason.trim()); } finally { setBusy(false); }
      }}
      onClose={onClose}>
      <Field label="Reason" required>
        <textarea className="his-field" rows={3} value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this being cancelled?" />
      </Field>
    </Modal>
  );
}
