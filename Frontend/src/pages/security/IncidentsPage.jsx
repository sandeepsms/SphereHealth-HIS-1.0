/**
 * IncidentsPage.jsx — Security incident log.
 *
 * URL: /incidents
 *
 * Layout:
 *   • 4 KPIs (open / today / critical-open / 30-day count)
 *   • "+ Report incident" button → modal form
 *   • Table of incidents with type / severity / location / status
 *   • Status row-action (Open → Investigating → Resolved / Escalated)
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
  headers: { Authorization: `Bearer ${localStorage.getItem("his_token")}` },
});

const fmtDT = (d) =>
  d ? new Date(d).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  }) : "—";

const TYPES      = ["Theft", "Trespass", "Disturbance", "Medical-Emergency", "Fire", "Vandalism", "Accident", "Other"];
const SEVERITIES = ["Low", "Medium", "High", "Critical"];
const STATUSES   = ["Open", "Investigating", "Resolved", "Escalated", "Closed"];

const SEVERITY_COLOR = {
  Low:      C.muted,
  Medium:   C.blue,
  High:     C.amber,
  Critical: C.red,
};
const STATUS_COLOR = {
  Open:           C.red,
  Investigating:  C.amber,
  Resolved:       C.green,
  Escalated:      C.purple,
  Closed:         C.muted,
};

const EMPTY_FORM = {
  type:        "Theft",
  severity:    "Medium",
  location:    "",
  occurredAt:  new Date().toISOString().slice(0, 16),
  description: "",
  actionTaken: "",
};

export default function IncidentsPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/incidents/stats`, authHdr());
      setStats(r.data?.data || null);
    } catch { /* keep previous */ }
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      params.set("limit", "100");
      const r = await axios.get(`${API}/incidents?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error("Failed to load incidents");
    }
    setLoading(false);
  }, [filterStatus]);

  useEffect(() => {
    fetchStats(); fetchList();
  }, [fetchStats, fetchList]);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const ql = q.toLowerCase();
    return rows.filter((r) =>
      (r.incidentNumber || "").toLowerCase().includes(ql) ||
      (r.location || "").toLowerCase().includes(ql) ||
      (r.description || "").toLowerCase().includes(ql),
    );
  }, [rows, q]);

  const submit = async () => {
    const missing = [];
    if (!form.location.trim()) missing.push("location");
    if (!form.description.trim()) missing.push("description");
    if (missing.length) {
      toast.warn(`Missing: ${missing.join(", ")}`);
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/incidents`, {
        ...form,
        recordedBy: user?.fullName || user?.firstName || "Security",
      }, authHdr());
      toast.success("Incident logged");
      setModalOpen(false);
      setForm(EMPTY_FORM);
      fetchStats(); fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to log incident");
    }
    setSaving(false);
  };

  const updateStatus = async (row, next) => {
    try {
      await axios.patch(`${API}/incidents/${row._id}/status`, { status: next }, authHdr());
      toast.success(`Marked ${next}`);
      fetchStats(); fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to update status");
    }
  };

  return (
    <AdminPage>
      <Hero icon="pi-exclamation-triangle" color="red"
        title="Incident Reports"
        subtitle="Theft · trespass · disturbance · fire — every campus event with audit trail." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Open"            value={stats?.openCount   ?? "—"} color={C.red}    icon="pi-exclamation-circle" />
        <KPI label="Reported today"  value={stats?.todayCount  ?? "—"} color={C.amber}  icon="pi-clock" />
        <KPI label="Critical open"   value={stats?.criticalOpen ?? "—"} color={C.purple} icon="pi-bolt" />
        <KPI label="Last 30 days"    value={stats?.last30d     ?? "—"} color={C.blue}   icon="pi-chart-line" />
      </div>

      <Card title="Incidents" color={C.red} icon="pi-shield"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="IR # / location / text…" />
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <PrimaryButton label="+ Report Incident" icon="pi-plus" color={C.red}
              onClick={() => { setForm(EMPTY_FORM); setModalOpen(true); }} />
          </div>
        }>
        {filtered.length === 0 ? (
          <Empty icon="pi-shield" text={loading ? "Loading…" : "No incidents logged."} />
        ) : (
          <Table cols={[
            { label: "IR #" }, { label: "Occurred" }, { label: "Type" },
            { label: "Severity" }, { label: "Location" }, { label: "Description" },
            { label: "Status" }, { label: "Action" },
          ]}>
            {filtered.map((r) => (
              <tr key={r._id}>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.incidentNumber}</td>
                <td style={{ fontSize: 11.5, color: C.muted }}>{fmtDT(r.occurredAt)}</td>
                <td style={{ fontSize: 12 }}>{r.type}</td>
                <td><Badge value={r.severity} color={SEVERITY_COLOR[r.severity] || C.muted} /></td>
                <td style={{ fontSize: 12 }}>{r.location}</td>
                <td style={{ fontSize: 11.5, maxWidth: 260, color: C.muted }} title={r.description}>
                  {r.description?.length > 60 ? r.description.slice(0, 60) + "…" : r.description}
                </td>
                <td><Badge value={r.status} color={STATUS_COLOR[r.status] || C.muted} /></td>
                <td>
                  <select value={r.status}
                    onChange={(e) => updateStatus(r, e.target.value)}
                    style={{ padding: "3px 6px", borderRadius: 4, border: `1px solid ${C.border}`, fontSize: 11 }}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title="Report new incident"
        right={<PrimaryButton label={saving ? "Saving…" : "Save"} icon="pi-check" color={C.red} onClick={submit} busy={saving} />}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Type" required>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Severity">
            <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Location" required>
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="e.g. Ward 3B, Pharmacy counter, Parking gate 2" />
          </Field>
          <Field label="Occurred at">
            <input type="datetime-local" value={form.occurredAt}
              onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} />
          </Field>
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Description" required>
              <textarea rows={3} value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What happened, who saw it, what you observed on arrival…" />
            </Field>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Action taken so far">
              <textarea rows={2} value={form.actionTaken}
                onChange={(e) => setForm({ ...form, actionTaken: e.target.value })}
                placeholder="Police called / fire extinguisher used / area secured…" />
            </Field>
          </div>
        </div>
      </Modal>
    </AdminPage>
  );
}
