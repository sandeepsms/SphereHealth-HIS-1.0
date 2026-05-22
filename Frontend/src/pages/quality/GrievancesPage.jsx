/**
 * GrievancesPage.jsx  (R7bf-G / A5-CRIT-5 / NABH PRE.6)
 *
 * Patient-grievance redressal register.
 *
 *   URL: /grievances
 *
 * Layout:
 *   • 4 KPIs (open / in-progress / escalated / closed-today)
 *   • "+ New Grievance" button
 *   • Table with ticket / complainant / category / status / age
 *   • Per-row actions (Assign / Resolve / Escalate)
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
  headers: { Authorization: `Bearer ${(sessionStorage.getItem("his_token") || localStorage.getItem("his_token"))}` },
});

const fmtDT = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const CATEGORIES = ["CLINICAL", "BILLING", "BEHAVIOUR", "FOOD", "CLEANLINESS", "OTHER"];
const STATUSES = ["OPEN", "IN_PROGRESS", "ESCALATED", "RESOLVED", "CLOSED"];
const COMPLAINANT_TYPES = ["PATIENT", "RELATIVE", "VISITOR", "VENDOR", "STAFF", "OTHER"];

const STATUS_COLOR = {
  OPEN: "red", IN_PROGRESS: "amber", ESCALATED: "purple",
  RESOLVED: "blue", CLOSED: "green",
};

const EMPTY_FORM = {
  patientUHID: "",
  complainantName: "",
  complainantContact: "",
  complainantType: "PATIENT",
  category: "CLINICAL",
  description: "",
  slaHours: 48,
};

export default function GrievancesPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [resolveRow, setResolveRow] = useState(null);
  const [assignRow, setAssignRow] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [assignName, setAssignName] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      params.set("limit", "200");
      const r = await axios.get(`${API}/grievances?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load grievances");
    }
    setLoading(false);
  }, [filterStatus]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const ql = q.toLowerCase();
    return rows.filter((r) =>
      (r.ticketNumber || "").toLowerCase().includes(ql) ||
      (r.complainantName || "").toLowerCase().includes(ql) ||
      (r.patientUHID || "").toLowerCase().includes(ql) ||
      (r.description || "").toLowerCase().includes(ql),
    );
  }, [rows, q]);

  const kpis = useMemo(() => {
    const open = rows.filter((r) => r.status === "OPEN").length;
    const inProgress = rows.filter((r) => r.status === "IN_PROGRESS").length;
    const escalated = rows.filter((r) => r.status === "ESCALATED").length;
    const resolved = rows.filter((r) => r.status === "RESOLVED" || r.status === "CLOSED").length;
    return { open, inProgress, escalated, resolved };
  }, [rows]);

  const create = async () => {
    if (!form.complainantName.trim() || !form.description.trim()) {
      toast.warn("complainantName + description required");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/grievances`, form, authHdr());
      toast.success("Grievance logged");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to create");
    }
    setSaving(false);
  };

  const assign = async () => {
    if (!assignName.trim()) { toast.warn("Assign-to required"); return; }
    setSaving(true);
    try {
      await axios.put(`${API}/grievances/${assignRow._id}/assign`, { userName: assignName }, authHdr());
      toast.success("Assigned");
      setAssignRow(null);
      setAssignName("");
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to assign");
    }
    setSaving(false);
  };

  const resolve = async () => {
    if (!resolutionNotes.trim()) { toast.warn("Resolution notes required"); return; }
    setSaving(true);
    try {
      await axios.put(`${API}/grievances/${resolveRow._id}/resolve`, { resolutionNotes }, authHdr());
      toast.success("Resolved");
      setResolveRow(null);
      setResolutionNotes("");
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to resolve");
    }
    setSaving(false);
  };

  const escalate = async (row) => {
    const reason = window.prompt("Escalation reason?");
    if (!reason) return;
    try {
      await axios.put(`${API}/grievances/${row._id}/escalate`, { reason }, authHdr());
      toast.success("Escalated");
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to escalate");
    }
  };

  return (
    <AdminPage>
      <Hero icon="pi-comment" color="amber"
        title="Patient Grievances"
        subtitle="NABH PRE.6 — every complaint logged, assigned, and resolved with SLA + satisfaction tracking." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Open"        value={kpis.open}        color={C.red}    icon="pi-exclamation-circle" />
        <KPI label="In Progress" value={kpis.inProgress}  color={C.amber}  icon="pi-spinner" />
        <KPI label="Escalated"   value={kpis.escalated}   color={C.purple} icon="pi-bolt" />
        <KPI label="Resolved/Closed" value={kpis.resolved} color={C.green} icon="pi-check-circle" />
      </div>

      <Card title="Grievance Register" color={C.amber} icon="pi-comment"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticket / name / UHID…" />
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {can("quality.grievance.write") && (
              <PrimaryButton label="+ New Grievance" icon="pi-plus" color={C.amber}
                onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }} />
            )}
          </div>
        }>
        {filtered.length === 0 ? (
          <Empty icon="pi-comment" text={loading ? "Loading…" : "No grievances on file."} />
        ) : (
          <Table cols={[
            { label: "Ticket" }, { label: "Raised" }, { label: "Complainant" }, { label: "UHID" },
            { label: "Category" }, { label: "Status" }, { label: "Assigned" }, { label: "Action" },
          ]}>
            {filtered.map((r) => (
              <tr key={r._id}>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.ticketNumber}</td>
                <td style={{ fontSize: 11.5, color: C.muted }}>{fmtDT(r.raisedAt)}</td>
                <td style={{ fontSize: 12 }}>{r.complainantName}</td>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.patientUHID || "—"}</td>
                <td style={{ fontSize: 11 }}>{r.category}</td>
                <td><Badge value={r.status} palette={STATUS_COLOR[r.status] || "muted"} /></td>
                <td style={{ fontSize: 11.5 }}>{r.assignedToName || "—"}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  {can("quality.grievance.write") && r.status !== "CLOSED" && r.status !== "RESOLVED" && (
                    <button onClick={() => { setAssignRow(r); setAssignName(""); }}
                      style={{ padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.blue}`,
                        background: "#fff", color: C.blue, fontSize: 11, cursor: "pointer" }}>
                      Assign
                    </button>
                  )}
                  {can("quality.grievance.write") && (r.status === "OPEN" || r.status === "IN_PROGRESS" || r.status === "ESCALATED") && (
                    <button onClick={() => { setResolveRow(r); setResolutionNotes(""); }}
                      style={{ padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.green}`,
                        background: "#fff", color: C.green, fontSize: 11, cursor: "pointer" }}>
                      Resolve
                    </button>
                  )}
                  {can("quality.grievance.write") && (r.status === "OPEN" || r.status === "IN_PROGRESS") && (
                    <button onClick={() => escalate(r)}
                      style={{ padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.purple}`,
                        background: "#fff", color: C.purple, fontSize: 11, cursor: "pointer" }}>
                      Escalate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}
          title="New grievance ticket"
          color={C.amber}
          onSubmit={create}
          submitting={saving}
          submitLabel="File">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Complainant name" required>
              <input value={form.complainantName} onChange={(e) => setForm({ ...form, complainantName: e.target.value })} />
            </Field>
            <Field label="Contact (phone/email)">
              <input value={form.complainantContact} onChange={(e) => setForm({ ...form, complainantContact: e.target.value })} />
            </Field>
            <Field label="Complainant type">
              <select value={form.complainantType} onChange={(e) => setForm({ ...form, complainantType: e.target.value })}>
                {COMPLAINANT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Patient UHID (if applicable)">
              <input value={form.patientUHID}
                onChange={(e) => setForm({ ...form, patientUHID: e.target.value.toUpperCase() })}
                placeholder="UH00000123 (optional)" />
            </Field>
            <Field label="Category" required>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="SLA (hours)">
              <input type="number" value={form.slaHours}
                onChange={(e) => setForm({ ...form, slaHours: Number(e.target.value) || 48 })} />
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Description" required>
                <textarea rows={3} value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Detailed complaint — what happened, when, where, with whom…" />
              </Field>
            </div>
          </div>
        </Modal>
      )}

      {assignRow && (
        <Modal onClose={() => setAssignRow(null)} title={`Assign — ${assignRow.ticketNumber}`}
          color={C.blue} onSubmit={assign} submitting={saving} submitLabel="Assign">
          <Field label="Assign to (staff name)">
            <input value={assignName} onChange={(e) => setAssignName(e.target.value)}
              placeholder="e.g. Front Desk Lead — Ms Smita" />
          </Field>
        </Modal>
      )}

      {resolveRow && (
        <Modal onClose={() => setResolveRow(null)} title={`Resolve — ${resolveRow.ticketNumber}`}
          color={C.green} onSubmit={resolve} submitting={saving} submitLabel="Resolve">
          <Field label="Resolution notes" required>
            <textarea rows={3} value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)}
              placeholder="What was done to address the complaint…" />
          </Field>
        </Modal>
      )}
    </AdminPage>
  );
}
