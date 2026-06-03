/**
 * WellnessProgramRegisterPage.jsx — R7gw-B10-T04 / NABH HRM.6
 *
 * Staff Wellness Programme register. HR / Wellness committee-facing
 * chronological log of staff-wellness sessions — annual health checks,
 * vaccination drives, stress-management workshops, yoga / mindfulness,
 * nutrition counselling.
 *
 *   URL: /compliance/nabh-registers/wellness
 *
 * Layout:
 *   - KPIs (sessions / participants / mean feedback / completed)
 *   - Filter strip (q text + type + status + date-range)
 *   - Add-Entry form for a new session row
 *   - Table: sessionDate / programName / type / topic / facilitator /
 *            #participants / feedbackScore / status
 *
 * Role-gated: server gates by compliance.nabh.* tokens; the page mirrors
 * the write token to hide the form for read-only viewers.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, KPI, Card, Table, Empty, Badge, Modal, Field,
  PrimaryButton, SearchInput, C,
} from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";
import { API_BASE_URL as API } from "../../config/api";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` },
});

const fmtDT = (d) =>
  d ? new Date(d).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }) : "—";

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const TYPES = [
  "StaffHealth",
  "Vaccination",
  "AnnualHealthCheck",
  "StressManagement",
  "Yoga",
  "Nutrition",
  "Mindfulness",
];
const TYPE_LABEL = {
  StaffHealth: "Staff Health",
  Vaccination: "Vaccination",
  AnnualHealthCheck: "Annual Health Check",
  StressManagement: "Stress Management",
  Yoga: "Yoga",
  Nutrition: "Nutrition",
  Mindfulness: "Mindfulness",
};
const STATUSES = ["Planned", "Completed", "Cancelled"];

const EMPTY_FORM = {
  programName: "",
  type: "StaffHealth",
  sessionDate: new Date().toISOString().slice(0, 16),
  participantEmpIdsText: "",
  topic: "",
  facilitator: "",
  feedbackScore: 5,
  notes: "",
  status: "Completed",
};

export default function WellnessProgramRegisterPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [startDate, setStartDate] = useState(isoDaysAgo(180));
  const [endDate, setEndDate] = useState(todayISO());

  // Modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const canWrite = can ? can("compliance.nabh.write") : false;

  // ── Fetch list ────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterType) params.set("type", filterType);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (q) params.set("q", q);
      params.set("limit", "300");
      const r = await axios.get(`${API}/nabh-registers/wellness?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load Wellness Programme register");
    }
    setLoading(false);
  }, [filterStatus, filterType, startDate, endDate, q]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── KPIs ──────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = rows.length;
    const participants = rows.reduce((acc, r) => acc + ((r.participantEmpIds || []).length || 0), 0);
    const completed = rows.filter((r) => r.status === "Completed").length;
    const scored = rows.filter((r) => Number(r.feedbackScore) > 0);
    const meanScore = scored.length
      ? Math.round((scored.reduce((a, r) => a + Number(r.feedbackScore), 0) / scored.length) * 10) / 10
      : 0;
    return { total, participants, completed, meanScore };
  }, [rows]);

  // ── Create ────────────────────────────────────────────────────
  const create = async () => {
    if (!form.programName || !form.type || !form.sessionDate || !form.topic || !form.facilitator) {
      toast.warn("programName, type, sessionDate, topic, facilitator are all required");
      return;
    }
    setSaving(true);
    try {
      const participantEmpIds = (form.participantEmpIdsText || "")
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await axios.post(`${API}/nabh-registers/wellness`, {
        programName: form.programName,
        type: form.type,
        sessionDate: form.sessionDate ? new Date(form.sessionDate).toISOString() : new Date().toISOString(),
        participantEmpIds,
        topic: form.topic,
        facilitator: form.facilitator,
        feedbackScore: Number(form.feedbackScore) || 0,
        notes: form.notes || "",
        status: form.status || "Completed",
      }, authHdr());
      toast.success("Wellness session saved");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to save");
    }
    setSaving(false);
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <AdminPage>
      <Hero
        icon="pi-heart"
        color="green"
        title="Staff Wellness Programme Register"
        subtitle="NABH HRM.6 — Chronological log of staff wellness sessions (annual health checks, vaccination drives, stress management, yoga, nutrition, mindfulness). Tracks attendance + feedback score."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Sessions" value={kpis.total} color={C.green} icon="pi-calendar" />
        <KPI label="Total Participants" value={kpis.participants} color={C.blue} icon="pi-users" />
        <KPI label="Mean Feedback" value={`${kpis.meanScore}/5`} color={C.amber} icon="pi-star" />
        <KPI label="Completed" value={kpis.completed} color={C.green} icon="pi-check-circle" />
      </div>

      {/* ── Filter strip ─────────────────────────────────────── */}
      <Card title="Filters" color={C.blue} icon="pi-filter">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Search</label>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Programme / topic / facilitator / notes…" />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Type</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>From</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>To</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }} />
          </div>
          {canWrite && (
            <div style={{ marginLeft: "auto" }}>
              <PrimaryButton label="+ Add Wellness Session" icon="pi-plus" color={C.green}
                onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }} />
            </div>
          )}
        </div>
      </Card>

      {/* ── Table ────────────────────────────────────────────── */}
      <Card title={`Wellness Programme Register · ${rows.length} sessions`} color={C.green} icon="pi-list">
        {rows.length === 0 ? (
          <Empty icon="pi-inbox" text={loading ? "Loading…" : "No wellness sessions in this range. Click +Add to log one."} />
        ) : (
          <Table cols={[
            { label: "Session Date" },
            { label: "Programme" },
            { label: "Type" },
            { label: "Topic" },
            { label: "Facilitator" },
            { label: "Participants" },
            { label: "Feedback" },
            { label: "Status" },
            { label: "Notes" },
          ]}>
            {rows.map((r) => (
              <tr key={r._id}>
                <td style={{ fontSize: 11.5, padding: "6px 8px" }}>{fmtDT(r.sessionDate)}</td>
                <td style={{ fontSize: 12, padding: "6px 8px", fontWeight: 600 }}>{r.programName || "—"}</td>
                <td style={{ fontSize: 11, padding: "6px 8px" }}>
                  <Badge value={TYPE_LABEL[r.type] || r.type} palette="blue" />
                </td>
                <td style={{ fontSize: 12, padding: "6px 8px" }}>{r.topic || "—"}</td>
                <td style={{ fontSize: 12, padding: "6px 8px" }}>{r.facilitator || "—"}</td>
                <td style={{ fontSize: 12, padding: "6px 8px", textAlign: "center" }}>
                  <Badge value={(r.participantEmpIds || []).length} palette="muted" />
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <Badge
                    value={Number(r.feedbackScore) ? `${r.feedbackScore}/5` : "—"}
                    palette={
                      Number(r.feedbackScore) >= 4 ? "green" :
                      Number(r.feedbackScore) >= 3 ? "amber" :
                      Number(r.feedbackScore) > 0 ? "red" : "muted"
                    }
                  />
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <Badge value={r.status} palette={
                    r.status === "Completed" ? "green" :
                    r.status === "Cancelled" ? "red" : "amber"
                  } />
                </td>
                <td style={{ fontSize: 11, padding: "6px 8px", color: C.muted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.notes || "—"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ── Add-Entry modal ──────────────────────────────────── */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}
          title="Wellness Programme Session"
          color={C.green}
          icon="pi-heart"
          onSubmit={create}
          submitting={saving}
          submitLabel="Save session"
          size={720}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Programme Name" required>
              <input value={form.programName}
                onChange={(e) => setForm({ ...form, programName: e.target.value })}
                placeholder="e.g. Q2 Staff Vaccination Drive" />
            </Field>
            <Field label="Type" required>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field label="Session Date" required>
              <input type="datetime-local" value={form.sessionDate}
                onChange={(e) => setForm({ ...form, sessionDate: e.target.value })} />
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Topic" required>
              <input value={form.topic}
                onChange={(e) => setForm({ ...form, topic: e.target.value })}
                placeholder="e.g. Influenza vaccination + post-vaccination monitoring" />
            </Field>
            <Field label="Facilitator" required>
              <input value={form.facilitator}
                onChange={(e) => setForm({ ...form, facilitator: e.target.value })}
                placeholder="e.g. Dr A Sharma / HR Wellness Cell" />
            </Field>
            <Field label="Feedback Score (1-5)">
              <input type="number" min="1" max="5" step="0.1" value={form.feedbackScore}
                onChange={(e) => setForm({ ...form, feedbackScore: e.target.value })} />
            </Field>
            <div />
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Participant Emp IDs (comma / space / semicolon-separated)">
                <textarea rows={2} value={form.participantEmpIdsText}
                  onChange={(e) => setForm({ ...form, participantEmpIdsText: e.target.value })}
                  placeholder="EMP-001, EMP-002, EMP-007 …" />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Notes">
                <textarea rows={2} value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="e.g. follow-up booster scheduled in 4 weeks; 2 staff deferred for fever" />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
