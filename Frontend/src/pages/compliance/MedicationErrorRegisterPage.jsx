/**
 * MedicationErrorRegisterPage.jsx — R7gw-B9-T04 / NABH MOM.4
 *
 * Surveyor + compliance-officer facing chronological view of every
 * medication error captured in the facility (NCC-MERP A-I). Auto-populated
 * from MAR.administrationRecord.nurseError=true; manual entries allowed
 * for the compliance officer.
 *
 *   URL: /compliance/nabh-registers/medicationerror
 *
 * Severity E-I auto-emits a Sentinel Event in the backend chain.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, Card, Table, Empty, Badge, Modal, Field,
  PrimaryButton, SearchInput, KPI, C,
} from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";
import { API_BASE_URL as API } from "../../config/api";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` },
});

const fmt = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const ERROR_PHASES = ["Prescribing", "Transcribing", "Dispensing", "Administering", "Monitoring"];
const SEVERITIES = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
const HARMS = ["None", "Minor", "Major", "Death"];
const STATUSES = ["Open", "InProgress", "Closed"];

// NCC-MERP brief reference, shown in the entry form to help the reporter pick
const SEVERITY_HINT = {
  A: "Circumstances/events that have capacity to cause error",
  B: "Error occurred but did not reach the patient",
  C: "Error reached patient but did not cause harm",
  D: "Error reached patient, required monitoring/intervention to confirm no harm",
  E: "Error caused temporary harm, required intervention",
  F: "Error caused temporary harm, required initial or prolonged hospitalisation",
  G: "Error caused permanent harm",
  H: "Error required intervention to sustain life",
  I: "Error contributed to or resulted in patient death",
};

const SEVERITY_PALETTE = (s) => {
  if (["A", "B"].includes(s)) return "muted";
  if (["C", "D"].includes(s)) return "blue";
  if (["E", "F"].includes(s)) return "orange";
  return "red"; // G/H/I
};

const STATUS_PALETTE = { Open: "red", InProgress: "orange", Closed: "green" };

const EMPTY_FORM = {
  UHID: "",
  patientName: "",
  admissionId: "",
  admissionNumber: "",
  errorPhase: "Administering",
  medicationName: "",
  expectedDose: "",
  actualDose: "",
  expectedRoute: "",
  actualRoute: "",
  severityNCC: "C",
  actionTakenImmediate: "",
  patientHarm: "None",
  reportedByEmpId: "",
  reportedByName: "",
};

export default function MedicationErrorRegisterPage() {
  const { can, user } = useAuth() || {};
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [startDate, setStartDate] = useState(isoDaysAgo(30));
  const [endDate, setEndDate] = useState(todayISO());
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterSeverity) params.set("severity", filterSeverity);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (q) params.set("q", q);
      params.set("limit", "200");
      const r = await axios.get(`${API}/nabh-registers/medicationerror?${params.toString()}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load medication errors");
    }
    setLoading(false);
  }, [filterStatus, filterSeverity, startDate, endDate, q]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const kpis = useMemo(() => {
    const total = rows.length;
    const sentinel = rows.filter((r) => r.sentinelFlag).length;
    const open = rows.filter((r) => r.status === "Open").length;
    const harmful = rows.filter((r) => ["Minor", "Major", "Death"].includes(r.patientHarm)).length;
    return { total, sentinel, open, harmful };
  }, [rows]);

  const submitEntry = async () => {
    if (!form.UHID || !form.errorPhase || !form.severityNCC) {
      toast.warn("UHID, error phase and severity are required");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/nabh-registers/medicationerror`, {
        UHID: form.UHID.toUpperCase().trim(),
        patientName: form.patientName,
        admissionId: form.admissionId || undefined,
        admissionNumber: form.admissionNumber,
        errorPhase: form.errorPhase,
        medicationName: form.medicationName,
        expectedDose: form.expectedDose,
        actualDose: form.actualDose,
        expectedRoute: form.expectedRoute,
        actualRoute: form.actualRoute,
        severityNCC: form.severityNCC,
        actionTakenImmediate: form.actionTakenImmediate,
        patientHarm: form.patientHarm,
        reportedByEmpId: form.reportedByEmpId || user?.empId,
        reportedByName: form.reportedByName || user?.fullName || user?.name,
        sourceType: "Manual",
      }, authHdr());
      toast.success("Medication error recorded");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to record entry");
    }
    setSaving(false);
  };

  const canWrite = (can && can("mar.write")) || false;

  return (
    <AdminPage>
      <Hero
        icon="pi-exclamation-circle"
        title="Medication Error Register"
        subtitle="NABH MOM.4 — NCC-MERP-classified medication errors with phase, dose mismatch, route mismatch, harm class. Severity E-I auto-escalates to Sentinel."
        color="red"
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Total"             value={kpis.total}     color={C.blue}   icon="pi-list" />
        <KPI label="Open"              value={kpis.open}      color={C.red}    icon="pi-exclamation-triangle" />
        <KPI label="Patient harm"      value={kpis.harmful}   color={C.orange || "#ea580c"} icon="pi-heart-fill" />
        <KPI label="Sentinel events"   value={kpis.sentinel}  color={C.red}    icon="pi-flag" />
      </div>

      <Card title="Filters">
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>From</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, width: 160 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>To</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, width: 160 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Severity</label>
            <select value={filterSeverity} onChange={(e) => setFilterSeverity(e.target.value)}
              style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, width: 110 }}>
              <option value="">All</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>NCC {s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, width: 140 }}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Drug / patient / cause…" />
          <div style={{ marginLeft: "auto" }}>
            {canWrite && (
              <PrimaryButton label="+ Add Entry" icon="pi-plus" color={C.red}
                onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }} />
            )}
          </div>
        </div>
      </Card>

      <Card title={`Medication Errors · ${rows.length} entries`}>
        {rows.length === 0 ? (
          <Empty icon="pi-shield" text={loading ? "Loading…" : "No medication errors on file for this range."} />
        ) : (
          <Table cols={[
            { label: "Reported" }, { label: "UHID" }, { label: "Patient" },
            { label: "Phase" }, { label: "Drug" }, { label: "Expected → Actual" },
            { label: "Severity" }, { label: "Harm" }, { label: "Status" }, { label: "Reporter" },
          ]}>
            {rows.map((r) => (
              <tr key={r._id} style={{ verticalAlign: "top" }}>
                <td style={{ fontSize: 11.5 }}>{fmt(r.reportedAt)}</td>
                <td style={{ fontSize: 11.5, fontFamily: "monospace" }}>{r.UHID}</td>
                <td style={{ fontSize: 12 }}>{r.patientName || "—"}</td>
                <td style={{ fontSize: 11.5 }}>{r.errorPhase}</td>
                <td style={{ fontSize: 11.5 }}>{r.medicationName || "—"}</td>
                <td style={{ fontSize: 11 }}>
                  <div>{r.expectedDose || "—"} {r.expectedRoute ? `· ${r.expectedRoute}` : ""}</div>
                  <div style={{ color: "#dc2626" }}>{r.actualDose || "—"} {r.actualRoute ? `· ${r.actualRoute}` : ""}</div>
                </td>
                <td>
                  <Badge value={`NCC ${r.severityNCC}`} palette={SEVERITY_PALETTE(r.severityNCC)} />
                  {r.sentinelFlag && (
                    <div style={{ marginTop: 4 }}>
                      <Badge value="SENTINEL" palette="red" />
                    </div>
                  )}
                </td>
                <td style={{ fontSize: 11.5 }}>{r.patientHarm}</td>
                <td><Badge value={r.status} palette={STATUS_PALETTE[r.status] || "muted"} /></td>
                <td style={{ fontSize: 11 }}>
                  {r.reportedByName || "—"}
                  {r.reportedByEmpId ? <div style={{ color: C.muted }}>{r.reportedByEmpId}</div> : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {showCreate && (
        <Modal title="Record Medication Error" onClose={() => setShowCreate(false)} width={760}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="UHID *">
              <input value={form.UHID} onChange={(e) => setForm({ ...form, UHID: e.target.value.toUpperCase() })}
                placeholder="UHID000001" />
            </Field>
            <Field label="Patient name">
              <input value={form.patientName} onChange={(e) => setForm({ ...form, patientName: e.target.value })} />
            </Field>
            <Field label="Error phase *">
              <select value={form.errorPhase} onChange={(e) => setForm({ ...form, errorPhase: e.target.value })}>
                {ERROR_PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Medication">
              <input value={form.medicationName} onChange={(e) => setForm({ ...form, medicationName: e.target.value })}
                placeholder="Drug name / brand" />
            </Field>
            <Field label="Expected dose">
              <input value={form.expectedDose} onChange={(e) => setForm({ ...form, expectedDose: e.target.value })}
                placeholder="e.g. 500 mg" />
            </Field>
            <Field label="Actual dose">
              <input value={form.actualDose} onChange={(e) => setForm({ ...form, actualDose: e.target.value })}
                placeholder="e.g. 1000 mg" />
            </Field>
            <Field label="Expected route">
              <input value={form.expectedRoute} onChange={(e) => setForm({ ...form, expectedRoute: e.target.value })}
                placeholder="e.g. IV, PO, IM" />
            </Field>
            <Field label="Actual route">
              <input value={form.actualRoute} onChange={(e) => setForm({ ...form, actualRoute: e.target.value })} />
            </Field>
            <Field label="Severity (NCC-MERP) *">
              <select value={form.severityNCC} onChange={(e) => setForm({ ...form, severityNCC: e.target.value })}>
                {SEVERITIES.map((s) => <option key={s} value={s}>NCC {s} — {SEVERITY_HINT[s]}</option>)}
              </select>
            </Field>
            <Field label="Patient harm">
              <select value={form.patientHarm} onChange={(e) => setForm({ ...form, patientHarm: e.target.value })}>
                {HARMS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Immediate action taken">
                <textarea value={form.actionTakenImmediate}
                  onChange={(e) => setForm({ ...form, actionTakenImmediate: e.target.value })}
                  rows={3}
                  placeholder="What did the team do at the bedside / immediately?"
                  style={{ width: "100%", padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontFamily: "inherit", resize: "vertical" }} />
              </Field>
            </div>
            <Field label="Reporter Emp ID">
              <input value={form.reportedByEmpId}
                onChange={(e) => setForm({ ...form, reportedByEmpId: e.target.value })}
                placeholder="EMP-001" />
            </Field>
            <Field label="Reporter name">
              <input value={form.reportedByName}
                onChange={(e) => setForm({ ...form, reportedByName: e.target.value })} />
            </Field>
          </div>

          {["E", "F", "G", "H", "I"].includes(form.severityNCC) && (
            <div style={{
              marginTop: 12, padding: "8px 12px", borderRadius: 6,
              background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: 12,
            }}>
              <i className="pi pi-flag" style={{ marginRight: 6 }} />
              Severity {form.severityNCC} will auto-emit a Sentinel Event row for RCA.
            </div>
          )}

          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => setShowCreate(false)} disabled={saving}
              style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", color: C.muted, cursor: "pointer", fontWeight: 600 }}>
              Cancel
            </button>
            <PrimaryButton label={saving ? "Saving…" : "Record Error"} icon="pi-save"
              color={C.red} onClick={submitEntry} disabled={saving} />
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
