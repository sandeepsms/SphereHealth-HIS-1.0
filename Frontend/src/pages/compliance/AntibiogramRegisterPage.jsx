/**
 * AntibiogramRegisterPage.jsx — R7gw-B10-T01 / NABH HIC.6
 *
 * Antibiogram register. AMSC-facing periodic cumulative susceptibility
 * report — one row per (organism × period × ward × sampleType) cohort
 * with a sensitivityProfile Map (antibiotic → S | I | R) plus first-/
 * second-line empiric recommendations.
 *
 *   URL: /compliance/nabh-registers/antibiogram
 *
 * Layout:
 *   • KPIs (rows / unique organisms / resistant-flagged)
 *   • Filter strip (q + organism + ward + period + sampleType + date-range)
 *   • Table: period / organism / ward / sample / isolates / 1st-line /
 *     2nd-line / status
 *   • Add-Entry modal with antibiotic-row editor for the sensitivityProfile
 *
 * Role-gated: Admin / Doctor / Nurse / MRD / ComplianceOfficer (server
 * gates by compliance.nabh.*; frontend mirrors for UI hiding).
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

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "2-digit",
  }) : "—";

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const SAMPLE_TYPES = ["Blood", "Urine", "Sputum", "Wound", "CSF", "Stool", "Other"];
const STATUSES = ["Open", "InProgress", "Closed"];
const SIR_VALUES = ["S", "I", "R"];

const EMPTY_FORM = {
  organism: "",
  isolatedAt: new Date().toISOString().slice(0, 10),
  ward: "",
  sampleType: "Blood",
  period: new Date().toISOString().slice(0, 7),   // YYYY-MM
  totalIsolates: 1,
  recommendedFirstLineStr: "",
  recommendedSecondLineStr: "",
  sensitivityRows: [{ antibiotic: "", sir: "S" }],
  notes: "",
  status: "Closed",
};

const splitCsv = (s) => String(s || "")
  .split(/[,\n;]/)
  .map((x) => x.trim())
  .filter(Boolean);

const sirBadge = (v) =>
  v === "S" ? "green" : v === "R" ? "red" : v === "I" ? "amber" : "muted";

export default function AntibiogramRegisterPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterOrganism, setFilterOrganism] = useState("");
  const [filterWard, setFilterWard] = useState("");
  const [filterPeriod, setFilterPeriod] = useState("");
  const [filterSampleType, setFilterSampleType] = useState("");
  const [startDate, setStartDate] = useState(isoDaysAgo(120));
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
      if (filterOrganism) params.set("organism", filterOrganism);
      if (filterWard) params.set("ward", filterWard);
      if (filterPeriod) params.set("period", filterPeriod);
      if (filterSampleType) params.set("sampleType", filterSampleType);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (q) params.set("q", q);
      params.set("limit", "300");
      const r = await axios.get(`${API}/nabh-registers/antibiogram?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load Antibiogram register");
    }
    setLoading(false);
  }, [filterStatus, filterOrganism, filterWard, filterPeriod, filterSampleType, startDate, endDate, q]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── KPIs ──────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = rows.length;
    const organisms = new Set(rows.map((r) => r.organism).filter(Boolean));
    let withR = 0;
    for (const r of rows) {
      const prof = r.sensitivityProfile || {};
      if (Object.values(prof).some((v) => v === "R")) withR += 1;
    }
    return { total, uniqueOrganisms: organisms.size, withR };
  }, [rows]);

  // ── Modal helpers ─────────────────────────────────────────────
  const addRowRow = () => {
    setForm((f) => ({ ...f, sensitivityRows: [...f.sensitivityRows, { antibiotic: "", sir: "S" }] }));
  };
  const updateRowRow = (i, patch) => {
    setForm((f) => ({
      ...f,
      sensitivityRows: f.sensitivityRows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    }));
  };
  const removeRowRow = (i) => {
    setForm((f) => ({
      ...f,
      sensitivityRows: f.sensitivityRows.length > 1
        ? f.sensitivityRows.filter((_, idx) => idx !== i)
        : f.sensitivityRows,
    }));
  };

  // ── Submit ────────────────────────────────────────────────────
  const create = async () => {
    if (!form.organism.trim()) { toast.warn("Organism is required"); return; }
    setSaving(true);
    try {
      const profile = {};
      for (const r of form.sensitivityRows) {
        if (r.antibiotic && r.antibiotic.trim()) {
          profile[r.antibiotic.trim()] = r.sir || "S";
        }
      }
      await axios.post(`${API}/nabh-registers/antibiogram`, {
        organism: form.organism.trim(),
        isolatedAt: form.isolatedAt ? new Date(form.isolatedAt).toISOString() : null,
        ward: form.ward,
        sampleType: form.sampleType,
        period: form.period,
        totalIsolates: Number(form.totalIsolates) || 0,
        sensitivityProfile: profile,
        recommendedFirstLine: splitCsv(form.recommendedFirstLineStr),
        recommendedSecondLine: splitCsv(form.recommendedSecondLineStr),
        notes: form.notes,
        status: form.status,
      }, authHdr());
      toast.success("Antibiogram row saved");
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
        icon="pi-chart-bar"
        color="blue"
        title="Antibiogram Register"
        subtitle="NABH HIC.6 — periodic cumulative susceptibility per organism × ward × sample × period; underpins AMSC first-line / second-line empiric recommendations."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Rows" value={kpis.total} color={C.blue} icon="pi-list" />
        <KPI label="Unique organisms" value={kpis.uniqueOrganisms} color={C.green} icon="pi-bug" />
        <KPI label="With resistant flag" value={kpis.withR} color={C.red} icon="pi-exclamation-triangle" />
      </div>

      {/* ── Filter strip ─────────────────────────────────────── */}
      <Card title="Filters" color={C.blue} icon="pi-filter">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Search</label>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Organism / ward / period / notes…" />
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
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Organism</label>
            <input value={filterOrganism} onChange={(e) => setFilterOrganism(e.target.value)}
              placeholder="E. coli / K. pneumoniae…"
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12, width: 160 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Ward</label>
            <input value={filterWard} onChange={(e) => setFilterWard(e.target.value)}
              placeholder="ICU / Med-1…"
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12, width: 140 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Period</label>
            <input value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)}
              placeholder="2026-06 / 2026-Q2"
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12, width: 130 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Sample</label>
            <select value={filterSampleType} onChange={(e) => setFilterSampleType(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              {SAMPLE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
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
              <PrimaryButton label="+ Add Antibiogram Row" icon="pi-plus" color={C.blue}
                onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }} />
            </div>
          )}
        </div>
      </Card>

      {/* ── Table ────────────────────────────────────────────── */}
      <Card title={`Antibiogram Register · ${rows.length} rows`} color={C.blue} icon="pi-list">
        {rows.length === 0 ? (
          <Empty icon="pi-inbox" text={loading ? "Loading…" : "No antibiogram rows in this range. Add one with the button above."} />
        ) : (
          <Table cols={[
            { label: "Period" },
            { label: "Isolated" },
            { label: "Organism" },
            { label: "Ward" },
            { label: "Sample" },
            { label: "Isolates" },
            { label: "Sensitivity (top)" },
            { label: "1st-line" },
            { label: "2nd-line" },
            { label: "Status" },
          ]}>
            {rows.map((r) => {
              const prof = r.sensitivityProfile || {};
              const entries = Object.entries(prof);
              const preview = entries.slice(0, 4);
              return (
                <tr key={r._id}>
                  <td style={{ fontSize: 11.5, padding: "6px 8px" }}>{r.period || "—"}</td>
                  <td style={{ fontSize: 11, padding: "6px 8px" }}>{fmtDate(r.isolatedAt)}</td>
                  <td style={{ fontSize: 12, padding: "6px 8px", fontStyle: "italic" }}>{r.organism}</td>
                  <td style={{ fontSize: 12, padding: "6px 8px" }}>{r.ward || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <Badge value={r.sampleType} palette="blue" />
                  </td>
                  <td style={{ fontSize: 12, padding: "6px 8px", textAlign: "right" }}>{r.totalIsolates || 0}</td>
                  <td style={{ padding: "6px 8px" }}>
                    {preview.length === 0 ? (
                      <span style={{ color: C.muted, fontSize: 11 }}>—</span>
                    ) : (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {preview.map(([abx, sir]) => (
                          <Badge key={abx} value={`${abx}:${sir}`} palette={sirBadge(sir)} />
                        ))}
                        {entries.length > 4 && (
                          <span style={{ fontSize: 10, color: C.muted }}>+{entries.length - 4}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 11, padding: "6px 8px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {(r.recommendedFirstLine || []).join(", ") || "—"}
                  </td>
                  <td style={{ fontSize: 11, padding: "6px 8px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {(r.recommendedSecondLine || []).join(", ") || "—"}
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

      {/* ── Detailed entry modal ──────────────────────────────── */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}
          title="Antibiogram Row"
          color={C.blue}
          icon="pi-chart-bar"
          onSubmit={create}
          submitting={saving}
          submitLabel="Save row"
          size={760}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Organism" required>
              <input value={form.organism}
                onChange={(e) => setForm({ ...form, organism: e.target.value })}
                placeholder="E. coli / K. pneumoniae / S. aureus…" />
            </Field>
            <Field label="Period">
              <input value={form.period}
                onChange={(e) => setForm({ ...form, period: e.target.value })}
                placeholder="2026-06 or 2026-Q2" />
            </Field>
            <Field label="Isolated at">
              <input type="date" value={form.isolatedAt}
                onChange={(e) => setForm({ ...form, isolatedAt: e.target.value })} />
            </Field>
            <Field label="Ward">
              <input value={form.ward}
                onChange={(e) => setForm({ ...form, ward: e.target.value })}
                placeholder="ICU / Med-1 / OPD" />
            </Field>
            <Field label="Sample type">
              <select value={form.sampleType}
                onChange={(e) => setForm({ ...form, sampleType: e.target.value })}>
                {SAMPLE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Total isolates">
              <input type="number" min="0" value={form.totalIsolates}
                onChange={(e) => setForm({ ...form, totalIsolates: e.target.value })} />
            </Field>
            <Field label="1st-line (comma-separated)">
              <input value={form.recommendedFirstLineStr}
                onChange={(e) => setForm({ ...form, recommendedFirstLineStr: e.target.value })}
                placeholder="Ceftriaxone, Amoxicillin-Clav" />
            </Field>
            <Field label="2nd-line (comma-separated)">
              <input value={form.recommendedSecondLineStr}
                onChange={(e) => setForm({ ...form, recommendedSecondLineStr: e.target.value })}
                placeholder="Meropenem, Piperacillin-Tazobactam" />
            </Field>
            <Field label="Status">
              <select value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Notes">
                <textarea rows={2} value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="e.g. cohort n=42; ESBL prevalence 38%; carbapenem reserved for febrile neutropenia" />
              </Field>
            </div>
          </div>

          {/* Sensitivity profile editor */}
          <div style={{ marginTop: 14, padding: 10, border: `1px dashed ${C.border}`, borderRadius: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>Sensitivity Profile (antibiotic → S / I / R)</strong>
              <button type="button" onClick={addRowRow}
                style={{ padding: "4px 10px", borderRadius: 5, border: `1px solid ${C.blue}`,
                         background: "#fff", color: C.blue, cursor: "pointer", fontSize: 12 }}>
                <i className="pi pi-plus" style={{ marginRight: 4 }} />Add antibiotic
              </button>
            </div>
            {form.sensitivityRows.map((r, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 120px 40px", gap: 8, marginBottom: 6 }}>
                <input value={r.antibiotic}
                  onChange={(e) => updateRowRow(i, { antibiotic: e.target.value })}
                  placeholder="Antibiotic (e.g. Ceftriaxone)"
                  style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }} />
                <select value={r.sir} onChange={(e) => updateRowRow(i, { sir: e.target.value })}
                  style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
                  {SIR_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <button type="button" onClick={() => removeRowRow(i)}
                  disabled={form.sensitivityRows.length <= 1}
                  style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`,
                           background: "#fff", color: C.red, cursor: form.sensitivityRows.length <= 1 ? "not-allowed" : "pointer", fontSize: 11 }}>
                  <i className="pi pi-trash" />
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
