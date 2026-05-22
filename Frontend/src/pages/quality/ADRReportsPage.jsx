/**
 * ADRReportsPage.jsx  (R7bf-G / A5-CRIT-4 / NABH MOM.7)
 *
 * Adverse Drug Reaction (ADR) register.
 *
 *   URL: /adr-reports
 *
 * Layout:
 *   • 3 KPIs (draft / submitted / pvpi-filed)
 *   • "+ New ADR" button
 *   • Table with patient / drug / severity / status
 *   • Per-row Submit (DRAFT→SUBMITTED) + File-PvPI (SUBMITTED→PVPI_FILED)
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

const SEVERITIES = ["MILD", "MODERATE", "SEVERE", "LIFE_THREATENING", "FATAL"];
const CAUSALITIES = ["CERTAIN", "PROBABLE", "POSSIBLE", "UNLIKELY", "UNRELATED", "UNASSESSABLE"];
const OUTCOMES = ["RECOVERED", "RECOVERING", "NOT_RECOVERED", "FATAL", "UNKNOWN"];
const CHALLENGE = ["NOT_DONE", "POSITIVE", "NEGATIVE", "UNKNOWN"];
const STATUSES = ["DRAFT", "SUBMITTED", "PVPI_FILED"];

const STATUS_COLOR = { DRAFT: "muted", SUBMITTED: "amber", PVPI_FILED: "green" };
const SEV_COLOR = {
  MILD: "blue", MODERATE: "amber", SEVERE: "red", LIFE_THREATENING: "purple", FATAL: "purple",
};

const EMPTY_FORM = {
  patientUHID: "",
  patientName: "",
  suspectedDrugName: "",
  suspectedDrugDose: "",
  suspectedRoute: "",
  reactionDescription: "",
  severity: "MODERATE",
  causality: "POSSIBLE",
  dechallenge: "NOT_DONE",
  rechallenge: "NOT_DONE",
  outcome: "UNKNOWN",
  actionTaken: "",
  notes: "",
};

export default function ADRReportsPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showFilePvPI, setShowFilePvPI] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pvpiRef, setPvpiRef] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      params.set("limit", "200");
      const r = await axios.get(`${API}/adr-reports?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load ADR reports");
    }
    setLoading(false);
  }, [filterStatus]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const ql = q.toLowerCase();
    return rows.filter((r) =>
      (r.patientUHID || "").toLowerCase().includes(ql) ||
      (r.patientName || "").toLowerCase().includes(ql) ||
      (r.suspectedDrugName || "").toLowerCase().includes(ql) ||
      (r.reactionDescription || "").toLowerCase().includes(ql),
    );
  }, [rows, q]);

  const kpis = useMemo(() => {
    return {
      draft: rows.filter((r) => r.status === "DRAFT").length,
      submitted: rows.filter((r) => r.status === "SUBMITTED").length,
      pvpi: rows.filter((r) => r.status === "PVPI_FILED").length,
    };
  }, [rows]);

  const create = async () => {
    if (!form.patientUHID.trim() || !form.reactionDescription.trim()) {
      toast.warn("UHID + reaction description required");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/adr-reports`, form, authHdr());
      toast.success("ADR report created (DRAFT)");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to create");
    }
    setSaving(false);
  };

  const submit = async (row) => {
    if (!window.confirm(`Submit ADR report for ${row.patientUHID}? Once submitted it locks for routine edits.`)) return;
    try {
      await axios.put(`${API}/adr-reports/${row._id}/submit`, {}, authHdr());
      toast.success("Submitted");
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to submit");
    }
  };

  const filePvPI = async () => {
    if (!pvpiRef.trim()) { toast.warn("PvPI reference required"); return; }
    setSaving(true);
    try {
      await axios.put(`${API}/adr-reports/${showFilePvPI._id}/file-pvpi`,
        { pvpiReferenceNumber: pvpiRef.trim() }, authHdr());
      toast.success("Filed with PvPI");
      setShowFilePvPI(null);
      setPvpiRef("");
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to file PvPI");
    }
    setSaving(false);
  };

  return (
    <AdminPage>
      <Hero icon="pi-flag" color="red"
        title="Adverse Drug Reaction Reports"
        subtitle="NABH MOM.7 — captures suspected ADRs, classifies severity, files with PvPI." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Draft"      value={kpis.draft}     color={C.muted}  icon="pi-pencil" />
        <KPI label="Submitted"  value={kpis.submitted} color={C.amber}  icon="pi-send" />
        <KPI label="PvPI Filed" value={kpis.pvpi}      color={C.green}  icon="pi-check-circle" />
      </div>

      <Card title="ADR Register" color={C.red} icon="pi-flag"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="UHID / drug / reaction…" />
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {can("pharmacy.adr.write") && (
              <PrimaryButton label="+ New ADR" icon="pi-plus" color={C.red}
                onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }} />
            )}
          </div>
        }>
        {filtered.length === 0 ? (
          <Empty icon="pi-flag" text={loading ? "Loading…" : "No ADR reports on file."} />
        ) : (
          <Table cols={[
            { label: "Reported" }, { label: "UHID" }, { label: "Patient" }, { label: "Drug" },
            { label: "Severity" }, { label: "Status" }, { label: "PvPI Ref" }, { label: "Action" },
          ]}>
            {filtered.map((r) => (
              <tr key={r._id}>
                <td style={{ fontSize: 11.5, color: C.muted }}>{fmtDT(r.createdAt)}</td>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.patientUHID}</td>
                <td style={{ fontSize: 12 }}>{r.patientName || "—"}</td>
                <td style={{ fontSize: 11.5 }}>{r.suspectedDrugName || "—"}</td>
                <td><Badge value={r.severity} palette={SEV_COLOR[r.severity] || "muted"} /></td>
                <td><Badge value={r.status} palette={STATUS_COLOR[r.status] || "muted"} /></td>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.pvpiReferenceNumber || "—"}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  {can("pharmacy.adr.write") && r.status === "DRAFT" && (
                    <button onClick={() => submit(r)}
                      style={{ padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.amber}`,
                        background: "#fff", color: C.amber, fontSize: 11, cursor: "pointer" }}>
                      Submit
                    </button>
                  )}
                  {can("pharmacy.adr.write") && r.status === "SUBMITTED" && (
                    <button onClick={() => { setShowFilePvPI(r); setPvpiRef(""); }}
                      style={{ padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.green}`,
                        background: "#fff", color: C.green, fontSize: 11, cursor: "pointer" }}>
                      File PvPI
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
          title="New ADR report"
          color={C.red}
          onSubmit={create}
          submitting={saving}
          submitLabel="Create draft"
          size={680}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Patient UHID" required>
              <input value={form.patientUHID}
                onChange={(e) => setForm({ ...form, patientUHID: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Patient name">
              <input value={form.patientName} onChange={(e) => setForm({ ...form, patientName: e.target.value })} />
            </Field>
            <Field label="Suspected drug" required>
              <input value={form.suspectedDrugName}
                onChange={(e) => setForm({ ...form, suspectedDrugName: e.target.value })} />
            </Field>
            <Field label="Dose">
              <input value={form.suspectedDrugDose}
                onChange={(e) => setForm({ ...form, suspectedDrugDose: e.target.value })}
                placeholder="e.g. 500mg BD PO" />
            </Field>
            <Field label="Route">
              <input value={form.suspectedRoute}
                onChange={(e) => setForm({ ...form, suspectedRoute: e.target.value })}
                placeholder="PO / IV / IM …" />
            </Field>
            <Field label="Severity" required>
              <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Causality">
              <select value={form.causality} onChange={(e) => setForm({ ...form, causality: e.target.value })}>
                {CAUSALITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Outcome">
              <select value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
                {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Dechallenge">
              <select value={form.dechallenge} onChange={(e) => setForm({ ...form, dechallenge: e.target.value })}>
                {CHALLENGE.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Rechallenge">
              <select value={form.rechallenge} onChange={(e) => setForm({ ...form, rechallenge: e.target.value })}>
                {CHALLENGE.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Reaction description" required>
                <textarea rows={3} value={form.reactionDescription}
                  onChange={(e) => setForm({ ...form, reactionDescription: e.target.value })} />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Action taken">
                <textarea rows={2} value={form.actionTaken}
                  onChange={(e) => setForm({ ...form, actionTaken: e.target.value })}
                  placeholder="Drug withdrawn / dose reduced / antidote administered …" />
              </Field>
            </div>
          </div>
        </Modal>
      )}

      {showFilePvPI && (
        <Modal onClose={() => setShowFilePvPI(null)}
          title={`File with PvPI — ${showFilePvPI.patientUHID}`}
          color={C.green} onSubmit={filePvPI} submitting={saving} submitLabel="File">
          <Field label="PvPI reference number" required>
            <input value={pvpiRef} onChange={(e) => setPvpiRef(e.target.value)}
              placeholder="Ticket number returned by PvPI portal" />
          </Field>
        </Modal>
      )}
    </AdminPage>
  );
}
