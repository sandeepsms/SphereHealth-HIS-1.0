/**
 * PROMPREMRegRegisterPage.jsx — R7gw-B10-T05 / NABH PRE.4 (6th-ed)
 *
 * Patient-Reported Outcome / Experience Measure register. PRO-officer or
 * floor nurse files each survey administration: PROMIS / SF-36 / EQ-5D /
 * HCAHPS / NHS-FFT / Custom-PREM. Scores are domain → numeric (free-form).
 *
 *   URL: /compliance/nabh-registers/prom-prem
 *
 * Layout:
 *   • KPIs (administrations / discharge-context % / instrument-mix)
 *   • Filter strip (q text + instrument + dischargeContext + UHID + dates)
 *   • Add-Entry form: UHID + instrument + dates + domain scores + comments
 *   • Table: administeredAt / UHID / patient / instrument / discharge? /
 *           administered by / mean-score / comments
 *
 * Role-gated: compliance.nabh.* (Admin / Doctor / Nurse / MRD / ComplianceOfficer
 * / PRO-officer per backend permissions).
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

const INSTRUMENTS = ["PROMIS", "SF-36", "EQ-5D", "Custom-PREM", "HCAHPS", "NHS-FFT"];
const STATUSES = ["Open", "InProgress", "Closed"];

// Suggested domain templates per instrument — frontend convenience so the
// PRO officer doesn't have to type domain keys every time.
const DOMAIN_TEMPLATES = {
  "PROMIS":     ["physicalFunction", "anxiety", "depression", "fatigue", "sleep", "socialRole", "painInterference"],
  "SF-36":      ["PF", "RP", "BP", "GH", "VT", "SF", "RE", "MH"],
  "EQ-5D":      ["mobility", "selfcare", "usualActivities", "pain", "anxiety", "vas"],
  "HCAHPS":     ["nurseCommunication", "doctorCommunication", "responsiveness", "painManagement", "medicationCommunication", "dischargeInfo", "overallRating", "recommend"],
  "NHS-FFT":    ["overallRating", "recommend"],
  "Custom-PREM": ["satisfaction", "wouldRecommend", "cleanliness", "staffCourtesy"],
};

const EMPTY_FORM = {
  UHID: "",
  patientName: "",
  admissionNumber: "",
  instrument: "EQ-5D",
  administeredAt: new Date().toISOString().slice(0, 16),
  administeredByEmpId: "",
  administeredByName: "",
  scoresList: [{ domain: "mobility", value: "" }],
  comments: "",
  recommendation: "",
  dischargeContext: true,
  status: "Closed",
};

export default function PROMPREMRegRegisterPage() {
  const { can, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterInstrument, setFilterInstrument] = useState("");
  const [filterDischarge, setFilterDischarge] = useState("");
  const [filterUHID, setFilterUHID] = useState("");
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
      if (filterInstrument) params.set("instrument", filterInstrument);
      if (filterDischarge) params.set("dischargeContext", filterDischarge);
      if (filterUHID) params.set("UHID", filterUHID);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (q) params.set("q", q);
      params.set("limit", "300");
      const r = await axios.get(`${API}/nabh-registers/prom-prem?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load PROM / PREM register");
    }
    setLoading(false);
  }, [filterStatus, filterInstrument, filterDischarge, filterUHID, startDate, endDate, q]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── KPIs ──────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = rows.length;
    const atDischarge = rows.filter((r) => r.dischargeContext).length;
    const pct = total ? Math.round((atDischarge / total) * 1000) / 10 : 0;
    const instruments = new Set(rows.map((r) => r.instrument)).size;
    return { total, pct, atDischarge, instruments };
  }, [rows]);

  // ── Domain rows helpers ───────────────────────────────────────
  const setInstrumentInForm = (inst) => {
    const templ = DOMAIN_TEMPLATES[inst] || [""];
    setForm({
      ...form,
      instrument: inst,
      scoresList: templ.map((d) => ({ domain: d, value: "" })),
    });
  };
  const addScoreRow = () => setForm({ ...form, scoresList: [...form.scoresList, { domain: "", value: "" }] });
  const updScoreRow = (i, key, val) => {
    const next = form.scoresList.slice();
    next[i] = { ...next[i], [key]: val };
    setForm({ ...form, scoresList: next });
  };
  const removeScoreRow = (i) => {
    const next = form.scoresList.slice();
    next.splice(i, 1);
    setForm({ ...form, scoresList: next.length ? next : [{ domain: "", value: "" }] });
  };

  // ── Create ────────────────────────────────────────────────────
  const create = async () => {
    if (!form.UHID) { toast.warn("UHID is required"); return; }
    if (!form.instrument) { toast.warn("Instrument is required"); return; }
    if (!form.administeredAt) { toast.warn("Administered-at is required"); return; }
    setSaving(true);
    try {
      // Convert scoresList → { domain: Number } map
      const scores = {};
      for (const s of form.scoresList) {
        const k = String(s.domain || "").trim();
        if (!k) continue;
        const n = Number(s.value);
        if (Number.isFinite(n)) scores[k] = n;
      }
      await axios.post(`${API}/nabh-registers/prom-prem`, {
        UHID: form.UHID.toUpperCase(),
        patientName: form.patientName,
        admissionNumber: form.admissionNumber,
        instrument: form.instrument,
        administeredAt: form.administeredAt
          ? new Date(form.administeredAt).toISOString()
          : new Date().toISOString(),
        administeredByEmpId: form.administeredByEmpId || user?.empId || user?.employeeId || "",
        administeredByName: form.administeredByName || user?.fullName || user?.name || "",
        scores,
        comments: form.comments,
        recommendation: form.recommendation,
        dischargeContext: !!form.dischargeContext,
        status: form.status,
      }, authHdr());
      toast.success("PROM / PREM administration saved");
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
        icon="pi-comments"
        color="teal"
        title="PROM / PREM Register"
        subtitle="NABH PRE.4 (6th-ed) — Patient-reported outcome (PROMIS / SF-36 / EQ-5D) and experience (HCAHPS / NHS-FFT / Custom-PREM) survey log."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Administrations" value={kpis.total} color={C.blue} icon="pi-list" />
        <KPI label="At Discharge %" value={`${kpis.pct}%`} color={C.green} icon="pi-sign-out" />
        <KPI label="Discharge context" value={kpis.atDischarge} color={C.teal || C.blue} icon="pi-check-circle" />
        <KPI label="Instruments used" value={kpis.instruments} color={C.purple || C.blue} icon="pi-tags" />
      </div>

      {/* ── Filter strip ─────────────────────────────────────── */}
      <Card title="Filters" color={C.blue} icon="pi-filter">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Search</label>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Patient / comments / observer…" />
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
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Instrument</label>
            <select value={filterInstrument} onChange={(e) => setFilterInstrument(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              {INSTRUMENTS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Discharge context</label>
            <select value={filterDischarge} onChange={(e) => setFilterDischarge(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              <option value="true">At discharge</option>
              <option value="false">Follow-up / other</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>UHID</label>
            <input value={filterUHID} onChange={(e) => setFilterUHID(e.target.value.toUpperCase())}
              placeholder="UHID-…"
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12, width: 140 }} />
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
              <PrimaryButton label="+ Add Survey" icon="pi-plus" color={C.blue}
                onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }} />
            </div>
          )}
        </div>
      </Card>

      {/* ── Table ────────────────────────────────────────────── */}
      <Card title={`PROM / PREM Register · ${rows.length} entries`} color={C.blue} icon="pi-list">
        {rows.length === 0 ? (
          <Empty icon="pi-inbox" text={loading ? "Loading…" : "No survey administrations in this range. Add one with + Add Survey."} />
        ) : (
          <Table cols={[
            { label: "Administered" },
            { label: "UHID" },
            { label: "Patient" },
            { label: "Instrument" },
            { label: "Discharge?" },
            { label: "Administered by" },
            { label: "Scores" },
            { label: "Comments" },
            { label: "Status" },
          ]}>
            {rows.map((r) => {
              const scoreKeys = r.scores ? Object.keys(r.scores) : [];
              const scoreText = scoreKeys.length
                ? scoreKeys.slice(0, 3).map((k) => `${k}:${r.scores[k]}`).join(", ") + (scoreKeys.length > 3 ? ` +${scoreKeys.length - 3}` : "")
                : "—";
              return (
                <tr key={r._id}>
                  <td style={{ fontSize: 11.5, padding: "6px 8px" }}>{fmtDT(r.administeredAt)}</td>
                  <td style={{ fontSize: 12, padding: "6px 8px", fontFamily: "monospace" }}>{r.UHID || "—"}</td>
                  <td style={{ fontSize: 12, padding: "6px 8px" }}>{r.patientName || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <Badge value={r.instrument} palette="blue" />
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Badge value={r.dischargeContext ? "YES" : "NO"} palette={r.dischargeContext ? "green" : "muted"} />
                  </td>
                  <td style={{ fontSize: 12, padding: "6px 8px" }}>
                    {r.administeredByName || "—"}
                    {r.administeredByEmpId && <div style={{ fontSize: 10, color: C.muted }}>{r.administeredByEmpId}</div>}
                  </td>
                  <td style={{ fontSize: 11, padding: "6px 8px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {scoreText}
                  </td>
                  <td style={{ fontSize: 11, padding: "6px 8px", color: C.muted, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.comments || "—"}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Badge value={r.status} palette={r.status === "Closed" ? "green" : "muted"} />
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {/* ── Add modal ─────────────────────────────────────────── */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}
          title="PROM / PREM Survey Administration"
          color={C.blue}
          icon="pi-comments"
          onSubmit={create}
          submitting={saving}
          submitLabel="Save survey"
          size={760}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Patient UHID" required>
              <input value={form.UHID}
                onChange={(e) => setForm({ ...form, UHID: e.target.value.toUpperCase() })}
                placeholder="UHID-…" />
            </Field>
            <Field label="Patient name">
              <input value={form.patientName}
                onChange={(e) => setForm({ ...form, patientName: e.target.value })} />
            </Field>
            <Field label="Admission #">
              <input value={form.admissionNumber}
                onChange={(e) => setForm({ ...form, admissionNumber: e.target.value })}
                placeholder="IPD-…" />
            </Field>
            <Field label="Instrument" required>
              <select value={form.instrument}
                onChange={(e) => setInstrumentInForm(e.target.value)}>
                {INSTRUMENTS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="Administered at" required>
              <input type="datetime-local" value={form.administeredAt}
                onChange={(e) => setForm({ ...form, administeredAt: e.target.value })} />
            </Field>
            <Field label="Discharge context?" required>
              <select value={form.dischargeContext ? "true" : "false"}
                onChange={(e) => setForm({ ...form, dischargeContext: e.target.value === "true" })}>
                <option value="true">Yes — administered at discharge</option>
                <option value="false">No — follow-up / scheduled re-survey</option>
              </select>
            </Field>
            <Field label="Administered by — Emp ID">
              <input value={form.administeredByEmpId}
                onChange={(e) => setForm({ ...form, administeredByEmpId: e.target.value })}
                placeholder="EMP-…" />
            </Field>
            <Field label="Administered by — Name">
              <input value={form.administeredByName}
                onChange={(e) => setForm({ ...form, administeredByName: e.target.value })}
                placeholder="PRO officer / nurse name" />
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Domain scores (numeric)">
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {form.scoresList.map((s, i) => (
                    <div key={i} style={{ display: "flex", gap: 6 }}>
                      <input
                        value={s.domain}
                        onChange={(e) => updScoreRow(i, "domain", e.target.value)}
                        placeholder="Domain key (e.g. mobility)"
                        style={{ flex: 2, padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}
                      />
                      <input
                        type="number"
                        value={s.value}
                        onChange={(e) => updScoreRow(i, "value", e.target.value)}
                        placeholder="Score"
                        style={{ flex: 1, padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}
                      />
                      <button type="button" onClick={() => removeScoreRow(i)}
                        style={{ padding: "5px 10px", borderRadius: 5, border: `1px solid ${C.border}`, background: "#fff", cursor: "pointer", fontSize: 12 }}>
                        <i className="pi pi-times" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={addScoreRow}
                    style={{ alignSelf: "flex-start", padding: "5px 10px", borderRadius: 5, border: `1px dashed ${C.border}`, background: "#fafbff", cursor: "pointer", fontSize: 12 }}>
                    <i className="pi pi-plus" style={{ marginRight: 4 }} />Add domain
                  </button>
                </div>
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Patient comments">
                <textarea rows={2} value={form.comments}
                  onChange={(e) => setForm({ ...form, comments: e.target.value })}
                  placeholder="Free-text patient comment about the experience or outcome" />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Recommendation / follow-up">
                <textarea rows={2} value={form.recommendation}
                  onChange={(e) => setForm({ ...form, recommendation: e.target.value })}
                  placeholder="Staff / PRO officer recommendation (e.g. counseling referral, repeat at 30 days)" />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
