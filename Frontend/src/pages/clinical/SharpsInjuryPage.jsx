/**
 * SharpsInjuryPage.jsx  (R7bk — sidebar nav coverage)
 *
 * Sharps Injury / needle-stick register (NABH HIC.6 + HRD.8).
 *
 *   URL: /sharps-injury
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
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token") || ""}` },
});

const fmtDT = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }) : "—";

const DEVICES = ["HOLLOW_BORE_NEEDLE", "SOLID_NEEDLE", "SCALPEL", "LANCET", "GLASS", "OTHER"];
const STATUSES = ["OPEN", "UNDER_FOLLOWUP", "CLOSED"];
const STATUS_COLOR = { OPEN: "red", UNDER_FOLLOWUP: "amber", CLOSED: "green" };

const EMPTY_FORM = {
  injuryDate: new Date().toISOString().slice(0, 16),
  injuryLocation: "",
  injuryDescription: "",
  device: "HOLLOW_BORE_NEEDLE",
  sourcePatientKnown: false,
  sourcePatientUHID: "",
  pepOffered: false,
};

export default function SharpsInjuryPage() {
  const { can, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      params.set("limit", "200");
      const r = await axios.get(`${API}/sharps-injury?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load");
    }
    setLoading(false);
  }, [filterStatus]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const kpis = useMemo(() => ({
    open: rows.filter(r => r.status === "OPEN").length,
    followup: rows.filter(r => r.status === "UNDER_FOLLOWUP").length,
    closed: rows.filter(r => r.status === "CLOSED").length,
  }), [rows]);

  const create = async () => {
    if (!form.injuryDescription.trim()) { toast.warn("Description required"); return; }
    setSaving(true);
    try {
      const payload = {
        injuryDate: form.injuryDate,
        injuryLocation: form.injuryLocation,
        injuryDescription: form.injuryDescription,
        device: form.device,
        source: {
          type: form.sourcePatientKnown ? "KNOWN" : "UNKNOWN",
          patientUHID: form.sourcePatientKnown ? form.sourcePatientUHID.toUpperCase() : "",
        },
        pepStatus: { offered: form.pepOffered },
      };
      await axios.post(`${API}/sharps-injury`, payload, authHdr());
      toast.success("Sharps injury reported");
      setShowCreate(false); setForm(EMPTY_FORM);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed");
    }
    setSaving(false);
  };

  return (
    <AdminPage>
      <Hero icon="pi-info-circle" color="amber"
        title="Sharps Injury Register"
        subtitle="NABH HIC.6 + HRD.8 — needle-stick / sharps injury, PEP decision, follow-up serology." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Open" value={kpis.open} color={C.red} icon="pi-exclamation-circle" />
        <KPI label="Under follow-up" value={kpis.followup} color={C.amber} icon="pi-clock" />
        <KPI label="Closed" value={kpis.closed} color={C.green} icon="pi-check-circle" />
      </div>

      <Card title="Sharps Injury Register" icon="pi-table">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          {can("clinical.sharps-injury.write") && (
            <PrimaryButton onClick={() => setShowCreate(true)}>+ Report Injury</PrimaryButton>
          )}
        </div>
        {loading ? <div>Loading…</div> : rows.length === 0 ? <Empty msg="No sharps injuries recorded." /> : (
          <Table
            headers={["#", "Date", "Staff", "Device", "Location", "Source", "PEP", "Status"]}
            rows={rows.map(r => [
              r.incidentNumber || "—",
              fmtDT(r.injuryDate || r.createdAt),
              `${r.injuredByName || "—"} (${r.injuredByRole || "—"})`,
              r.device || "—",
              r.injuryLocation || "—",
              r.source?.type || "—",
              r.pepStatus?.offered ? <Badge tone="green">Offered</Badge> : <Badge tone="muted">No</Badge>,
              <Badge tone={STATUS_COLOR[r.status] || "muted"}>{r.status || "OPEN"}</Badge>,
            ])}
          />
        )}
      </Card>

      {showCreate && (
        <Modal title="Report Sharps Injury" onClose={() => setShowCreate(false)} size="md">
          <Field label="Injury Date/Time" required>
            <input type="datetime-local" value={form.injuryDate}
              onChange={e => setForm({...form, injuryDate: e.target.value})} />
          </Field>
          <Field label="Location" required>
            <input value={form.injuryLocation} onChange={e => setForm({...form, injuryLocation: e.target.value})}
              placeholder="e.g. ICU bedside, OT-2" />
          </Field>
          <Field label="Device" required>
            <select value={form.device} onChange={e => setForm({...form, device: e.target.value})}>
              {DEVICES.map(d => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Description" required>
            <textarea rows={3} value={form.injuryDescription}
              onChange={e => setForm({...form, injuryDescription: e.target.value})} />
          </Field>
          <Field label="">
            <label>
              <input type="checkbox" checked={form.sourcePatientKnown}
                onChange={e => setForm({...form, sourcePatientKnown: e.target.checked})} />
              {" "}Source patient known
            </label>
          </Field>
          {form.sourcePatientKnown && (
            <Field label="Source Patient UHID">
              <input value={form.sourcePatientUHID}
                onChange={e => setForm({...form, sourcePatientUHID: e.target.value.toUpperCase()})} />
            </Field>
          )}
          <Field label="">
            <label>
              <input type="checkbox" checked={form.pepOffered}
                onChange={e => setForm({...form, pepOffered: e.target.checked})} />
              {" "}PEP (post-exposure prophylaxis) offered
            </label>
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <PrimaryButton onClick={create} disabled={saving}>{saving ? "Saving…" : "Report"}</PrimaryButton>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
