/**
 * CriticalValueAlertsPage.jsx  (R7bf-G / A5-CRIT-1 / NABH AAC.6)
 *
 * Operator dashboard for the Critical / Panic Value Alert queue.
 *
 *   URL: /critical-value-alerts
 *
 * Layout:
 *   • 3 KPIs (open / escalated / acked today)
 *   • "+ Emit Alert" button (gated on clinical.emit-critical)
 *   • Table of OPEN + ESCALATED alerts (most recent first)
 *   • Per-row Acknowledge button (gated on clinical.acknowledge-critical)
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

const KINDS = ["LAB", "VITAL", "DRUG", "IMAGING", "OTHER"];
const SEVERITIES = ["CRITICAL", "PANIC"];

const SEV_COLOR = { CRITICAL: C.red, PANIC: C.purple };
const STATUS_COLOR = { OPEN: C.red, ESCALATED: C.purple, ACK: C.green, CLOSED: C.muted };

const EMPTY_FORM = {
  kind: "LAB",
  patientUHID: "",
  patientName: "",
  valueLabel: "",
  severity: "CRITICAL",
  slaMinutes: 30,
  notes: "",
};

export default function CriticalValueAlertsPage() {
  const { user, can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showAck, setShowAck] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [ackNotes, setAckNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/critical-value-alerts/open?limit=200`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load alerts");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const ql = q.toLowerCase();
    return rows.filter((r) =>
      (r.patientUHID || "").toLowerCase().includes(ql) ||
      (r.patientName || "").toLowerCase().includes(ql) ||
      (r.valueLabel || "").toLowerCase().includes(ql),
    );
  }, [rows, q]);

  const kpis = useMemo(() => {
    const open = rows.filter((r) => r.status === "OPEN").length;
    const escalated = rows.filter((r) => r.status === "ESCALATED").length;
    return { open, escalated, total: rows.length };
  }, [rows]);

  const submit = async () => {
    if (!form.patientUHID.trim() || !form.valueLabel.trim()) {
      toast.warn("UHID + value label required");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/critical-value-alerts`, form, authHdr());
      toast.success("Alert emitted");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to emit alert");
    }
    setSaving(false);
  };

  const acknowledge = async () => {
    if (!showAck) return;
    setSaving(true);
    try {
      await axios.post(`${API}/critical-value-alerts/${showAck._id}/acknowledge`, { notes: ackNotes }, authHdr());
      toast.success("Acknowledged");
      setShowAck(null);
      setAckNotes("");
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to acknowledge");
    }
    setSaving(false);
  };

  return (
    <AdminPage>
      <Hero icon="pi-bell" color="red"
        title="Critical Value Alerts"
        subtitle="NABH AAC.6 — every panic-value lab / vital / drug-allergy / imaging red-flag must be acknowledged inside the SLA window." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Open"        value={kpis.open}      color={C.red}    icon="pi-exclamation-circle" />
        <KPI label="Escalated"   value={kpis.escalated} color={C.purple} icon="pi-bolt" />
        <KPI label="Total Queue" value={kpis.total}     color={C.blue}   icon="pi-list" />
      </div>

      <Card title="Open + Escalated Alerts" color={C.red} icon="pi-bell"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="UHID / name / value…" />
            {can("clinical.emit-critical") && (
              <PrimaryButton label="+ Emit Alert" icon="pi-plus" color={C.red}
                onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }} />
            )}
          </div>
        }>
        {filtered.length === 0 ? (
          <Empty icon="pi-check-circle" text={loading ? "Loading…" : "No open alerts. All critical values acknowledged."} />
        ) : (
          <Table cols={[
            { label: "Emitted" }, { label: "Kind" }, { label: "UHID" }, { label: "Patient" },
            { label: "Value" }, { label: "Severity" }, { label: "SLA" }, { label: "Status" }, { label: "Action" },
          ]}>
            {filtered.map((r) => (
              <tr key={r._id}>
                <td style={{ fontSize: 11.5, color: C.muted }}>{fmtDT(r.emittedAt)}</td>
                <td style={{ fontSize: 11.5 }}>{r.kind}</td>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.patientUHID}</td>
                <td style={{ fontSize: 12 }}>{r.patientName || "—"}</td>
                <td style={{ fontSize: 12, maxWidth: 240 }} title={r.valueLabel}>
                  {(r.valueLabel || "").length > 50 ? r.valueLabel.slice(0, 50) + "…" : r.valueLabel}
                </td>
                <td><Badge value={r.severity} palette={r.severity === "PANIC" ? "purple" : "red"} /></td>
                <td style={{ fontSize: 11, color: C.muted }}>{r.slaMinutes ?? 30}m</td>
                <td><Badge value={r.status} palette={r.status === "ESCALATED" ? "purple" : "red"} /></td>
                <td>
                  {can("clinical.acknowledge-critical") && (
                    <button onClick={() => { setShowAck(r); setAckNotes(""); }}
                      style={{ padding: "4px 10px", borderRadius: 4, border: `1px solid ${C.green}`,
                        background: "#fff", color: C.green, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      Acknowledge
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
          title="Emit critical-value alert"
          color={C.red}
          onSubmit={submit}
          submitting={saving}
          submitLabel="Emit">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Kind" required>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="Severity">
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Patient UHID" required>
              <input value={form.patientUHID}
                onChange={(e) => setForm({ ...form, patientUHID: e.target.value.toUpperCase() })}
                placeholder="UH00000123" />
            </Field>
            <Field label="Patient name">
              <input value={form.patientName} onChange={(e) => setForm({ ...form, patientName: e.target.value })} />
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Value label" required>
                <input value={form.valueLabel} onChange={(e) => setForm({ ...form, valueLabel: e.target.value })}
                  placeholder='e.g. "K+ 6.8 mmol/L", "SpO2 82% on RA"' />
              </Field>
            </div>
            <Field label="SLA minutes">
              <input type="number" value={form.slaMinutes}
                onChange={(e) => setForm({ ...form, slaMinutes: Number(e.target.value) || 30 })} />
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Notes">
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
          </div>
        </Modal>
      )}

      {showAck && (
        <Modal onClose={() => setShowAck(null)}
          title={`Acknowledge alert — ${showAck.valueLabel}`}
          color={C.green}
          onSubmit={acknowledge}
          submitting={saving}
          submitLabel="Acknowledge">
          <Field label="Clinical action / note (optional)">
            <textarea rows={3} value={ackNotes} onChange={(e) => setAckNotes(e.target.value)}
              placeholder="Repeat sample sent / dose corrected / patient notified…" />
          </Field>
        </Modal>
      )}
    </AdminPage>
  );
}
