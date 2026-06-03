/**
 * MSOLogRegisterPage.jsx — R7gw-B10-T02 / NABH PRE.1
 *
 * Medical Social Officer (MSO) session log register. MSO-facing chronological
 * record of psychosocial / financial-aid / discharge-planning / bereavement /
 * grievance / vulnerable-patient-care sessions delivered to admitted or OPD
 * patients.
 *
 *   URL: /compliance/nabh-registers/mso-log
 *
 * Layout:
 *   - KPIs (sessions / open follow-ups / resolved / escalated)
 *   - Filter strip (q + sessionType + outcome + followUpNeeded + date-range)
 *   - Table: sessionDate / UHID / sessionType / duration / concern /
 *            outcome / followUp / social worker / notes
 *   - Add-Entry modal for full session details
 *
 * Role-gated: Admin / MSO / ComplianceOfficer / Doctor / Nurse / MRD
 * (server gates via compliance.nabh.* tokens; frontend mirrors for UI hiding).
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

const fmtD = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "2-digit",
  }) : "—";

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const SESSION_TYPES = [
  "Counseling",
  "Financial-Aid",
  "Discharge-Planning",
  "Bereavement",
  "Grievance-Resolution",
  "Vulnerable-Patient-Care",
];
const SESSION_TYPE_LABEL = {
  "Counseling": "Counseling",
  "Financial-Aid": "Financial Aid",
  "Discharge-Planning": "Discharge Planning",
  "Bereavement": "Bereavement Support",
  "Grievance-Resolution": "Grievance Resolution",
  "Vulnerable-Patient-Care": "Vulnerable Patient Care",
};
const SESSION_TYPE_PALETTE = {
  "Counseling": "blue",
  "Financial-Aid": "green",
  "Discharge-Planning": "purple",
  "Bereavement": "muted",
  "Grievance-Resolution": "red",
  "Vulnerable-Patient-Care": "orange",
};
const OUTCOMES = ["Resolved", "Escalated", "Ongoing", "Referred"];
const OUTCOME_PALETTE = {
  Resolved: "green",
  Escalated: "red",
  Ongoing: "blue",
  Referred: "purple",
};
const STATUSES = ["Open", "InProgress", "Closed"];

const EMPTY_FORM = {
  UHID: "",
  patientName: "",
  admissionNumber: "",
  sessionDate: new Date().toISOString().slice(0, 16),
  sessionType: "Counseling",
  duration: 30,
  concernAddressed: "",
  outcome: "Resolved",
  followUpNeeded: false,
  followUpDate: "",
  referredTo: "",
  socialWorkerEmpId: "",
  socialWorkerName: "",
  notes: "",
  status: "Closed",
};

export default function MSOLogRegisterPage() {
  const { can, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSessionType, setFilterSessionType] = useState("");
  const [filterOutcome, setFilterOutcome] = useState("");
  const [filterFollowUp, setFilterFollowUp] = useState("");
  const [startDate, setStartDate] = useState(isoDaysAgo(30));
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
      if (filterSessionType) params.set("sessionType", filterSessionType);
      if (filterOutcome) params.set("outcome", filterOutcome);
      if (filterFollowUp) params.set("followUpNeeded", filterFollowUp);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (q) params.set("q", q);
      params.set("limit", "300");
      const r = await axios.get(`${API}/nabh-registers/mso-log?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load MSO Log register");
    }
    setLoading(false);
  }, [filterStatus, filterSessionType, filterOutcome, filterFollowUp, startDate, endDate, q]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── KPIs ──────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = rows.length;
    const openFollowUps = rows.filter((r) => r.followUpNeeded && r.status !== "Closed").length;
    const resolved = rows.filter((r) => r.outcome === "Resolved").length;
    const escalated = rows.filter((r) => r.outcome === "Escalated").length;
    return { total, openFollowUps, resolved, escalated };
  }, [rows]);

  // ── Create ────────────────────────────────────────────────────
  const create = async () => {
    if (!form.UHID) { toast.warn("UHID is required"); return; }
    if (!form.sessionType) { toast.warn("Session type is required"); return; }
    if (!form.outcome) { toast.warn("Outcome is required"); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/nabh-registers/mso-log`, {
        ...form,
        UHID: form.UHID ? form.UHID.toUpperCase() : "",
        sessionDate: form.sessionDate ? new Date(form.sessionDate).toISOString() : new Date().toISOString(),
        followUpDate: form.followUpDate ? new Date(form.followUpDate).toISOString() : null,
        duration: Number(form.duration) || 0,
      }, authHdr());
      toast.success("MSO session saved");
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
        icon="pi-users"
        color="purple"
        title="MSO Session Log Register"
        subtitle="NABH PRE.1 — Medical Social Officer sessions: counseling, financial aid, discharge planning, bereavement support, grievance resolution & vulnerable-patient care."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Sessions" value={kpis.total} color={C.purple} icon="pi-users" />
        <KPI label="Open Follow-ups" value={kpis.openFollowUps} color={C.orange} icon="pi-calendar-clock" />
        <KPI label="Resolved" value={kpis.resolved} color={C.green} icon="pi-check-circle" />
        <KPI label="Escalated" value={kpis.escalated} color={C.red} icon="pi-exclamation-triangle" />
      </div>

      {/* ── Filter strip ─────────────────────────────────────── */}
      <Card title="Filters" color={C.blue} icon="pi-filter">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Search</label>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Concern / notes / social worker / UHID…" />
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
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Session Type</label>
            <select value={filterSessionType} onChange={(e) => setFilterSessionType(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              {SESSION_TYPES.map((s) => <option key={s} value={s}>{SESSION_TYPE_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Outcome</label>
            <select value={filterOutcome} onChange={(e) => setFilterOutcome(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Follow-up</label>
            <select value={filterFollowUp} onChange={(e) => setFilterFollowUp(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              <option value="true">Needed</option>
              <option value="false">Not needed</option>
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
              <PrimaryButton label="+ Add MSO Session" icon="pi-plus" color={C.purple}
                onClick={() => {
                  setForm({
                    ...EMPTY_FORM,
                    socialWorkerEmpId: user?.empId || user?.employeeId || "",
                    socialWorkerName: user?.fullName || user?.name || "",
                  });
                  setShowCreate(true);
                }} />
            </div>
          )}
        </div>
      </Card>

      {/* ── Table ────────────────────────────────────────────── */}
      <Card title={`MSO Session Log · ${rows.length} entries`} color={C.purple} icon="pi-list">
        {rows.length === 0 ? (
          <Empty icon="pi-inbox" text={loading ? "Loading…" : "No MSO sessions in this range. Click + Add MSO Session above to record one."} />
        ) : (
          <Table cols={[
            { label: "Session Date" },
            { label: "Patient" },
            { label: "Type" },
            { label: "Duration" },
            { label: "Concern" },
            { label: "Outcome" },
            { label: "Follow-up" },
            { label: "Social Worker" },
            { label: "Notes" },
            { label: "Status" },
          ]}>
            {rows.map((r) => (
              <tr key={r._id}>
                <td style={{ fontSize: 11.5, padding: "6px 8px" }}>{fmtDT(r.sessionDate)}</td>
                <td style={{ fontSize: 12, padding: "6px 8px" }}>
                  <div style={{ fontWeight: 600 }}>{r.UHID || "—"}</div>
                  {r.patientName && <div style={{ fontSize: 11, color: C.muted }}>{r.patientName}</div>}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <Badge value={SESSION_TYPE_LABEL[r.sessionType] || r.sessionType}
                    palette={SESSION_TYPE_PALETTE[r.sessionType] || "muted"} />
                </td>
                <td style={{ fontSize: 12, padding: "6px 8px" }}>
                  {r.duration ? `${r.duration} min` : "—"}
                </td>
                <td style={{ fontSize: 11, padding: "6px 8px", color: C.muted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.concernAddressed || "—"}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <Badge value={r.outcome} palette={OUTCOME_PALETTE[r.outcome] || "muted"} />
                  {r.outcome === "Referred" && r.referredTo && (
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>→ {r.referredTo}</div>
                  )}
                </td>
                <td style={{ fontSize: 11.5, padding: "6px 8px" }}>
                  {r.followUpNeeded
                    ? <Badge value={r.followUpDate ? fmtD(r.followUpDate) : "YES"} palette="orange" />
                    : <span style={{ color: C.muted }}>—</span>}
                </td>
                <td style={{ fontSize: 12, padding: "6px 8px" }}>
                  {r.socialWorkerName || "—"}
                  {r.socialWorkerEmpId && <div style={{ fontSize: 10, color: C.muted }}>{r.socialWorkerEmpId}</div>}
                </td>
                <td style={{ fontSize: 11, padding: "6px 8px", color: C.muted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.notes || "—"}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <Badge value={r.status} palette={r.status === "Closed" ? "green" : "muted"} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ── Add-Entry Modal ──────────────────────────────────── */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}
          title="MSO Session Entry"
          color={C.purple}
          icon="pi-users"
          onSubmit={create}
          submitting={saving}
          submitLabel="Save session"
          size={720}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Patient UHID" required>
              <input value={form.UHID}
                onChange={(e) => setForm({ ...form, UHID: e.target.value.toUpperCase() })}
                placeholder="UHID000123" />
            </Field>
            <Field label="Patient Name">
              <input value={form.patientName}
                onChange={(e) => setForm({ ...form, patientName: e.target.value })}
                placeholder="As per registration" />
            </Field>
            <Field label="Admission # (if IP)">
              <input value={form.admissionNumber}
                onChange={(e) => setForm({ ...form, admissionNumber: e.target.value })}
                placeholder="IPD-2026-0001 (optional)" />
            </Field>
            <Field label="Session Date" required>
              <input type="datetime-local" value={form.sessionDate}
                onChange={(e) => setForm({ ...form, sessionDate: e.target.value })} />
            </Field>
            <Field label="Session Type" required>
              <select value={form.sessionType} onChange={(e) => setForm({ ...form, sessionType: e.target.value })}>
                {SESSION_TYPES.map((s) => <option key={s} value={s}>{SESSION_TYPE_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field label="Duration (minutes)">
              <input type="number" min={0} value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
                placeholder="30" />
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Concern Addressed">
                <textarea rows={2} value={form.concernAddressed}
                  onChange={(e) => setForm({ ...form, concernAddressed: e.target.value })}
                  placeholder="e.g. financial burden of dialysis; family unable to take patient home; bereavement counselling after sudden loss" />
              </Field>
            </div>
            <Field label="Outcome" required>
              <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
                {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Follow-up Needed?">
              <select value={form.followUpNeeded ? "true" : "false"}
                onChange={(e) => setForm({ ...form, followUpNeeded: e.target.value === "true" })}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </Field>
            {form.followUpNeeded && (
              <Field label="Follow-up Date">
                <input type="date" value={form.followUpDate}
                  onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} />
              </Field>
            )}
            {form.outcome === "Referred" && (
              <Field label="Referred To">
                <input value={form.referredTo}
                  onChange={(e) => setForm({ ...form, referredTo: e.target.value })}
                  placeholder="e.g. CMSS scheme / NGO / Psychiatry OPD" />
              </Field>
            )}
            <Field label="Social Worker Emp ID">
              <input value={form.socialWorkerEmpId}
                onChange={(e) => setForm({ ...form, socialWorkerEmpId: e.target.value })}
                placeholder="MSO-001" />
            </Field>
            <Field label="Social Worker Name">
              <input value={form.socialWorkerName}
                onChange={(e) => setForm({ ...form, socialWorkerName: e.target.value })}
                placeholder="MSO name" />
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Notes">
                <textarea rows={3} value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Action items, family response, support arranged, schemes applied for, etc." />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
