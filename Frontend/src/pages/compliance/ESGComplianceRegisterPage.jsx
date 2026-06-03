/**
 * ESGComplianceRegisterPage.jsx — R7gw-B10-T03 / NABH 6th-ed Environment
 *
 * Monthly Environmental, Social & Governance compliance register.
 *
 *   URL: /compliance/nabh-registers/esg-compliance
 *
 * Layout:
 *   - KPIs: rows / latest period kWh / latest CO2e / avg recycled %
 *   - Filter strip: q text + status + period + date range
 *   - Add-Report modal: period + resource use + waste + carbon + initiatives
 *   - Table: period / energy / water / diesel / waste / recycled% / CO2e /
 *     reporter / status
 *
 * Role-gated: Admin / ComplianceOfficer / FacilitiesManager (server checks
 * compliance.nabh.* tokens; frontend mirrors for UI hiding).
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

// Current period as YYYY-MM
const currentPeriod = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const STATUSES = ["Open", "InProgress", "Closed"];

const EMPTY_FORM = {
  period: currentPeriod(),
  energyKwh: "",
  waterKl: "",
  dieselLitres: "",
  medicalWasteKg: "",
  biomedicalWasteKg: "",
  recycledPct: "",
  co2eqKg: "",
  greenInitiativesText: "",
  auditFindings: "",
  reportedByEmpId: "",
  reportedByName: "",
  status: "Closed",
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default function ESGComplianceRegisterPage() {
  const { can, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPeriod, setFilterPeriod] = useState("");
  const [startDate, setStartDate] = useState(isoDaysAgo(365));
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
      if (filterPeriod) params.set("period", filterPeriod);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (q) params.set("q", q);
      params.set("limit", "300");
      const r = await axios.get(`${API}/nabh-registers/esg-compliance?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load ESG Compliance register");
    }
    setLoading(false);
  }, [filterStatus, filterPeriod, startDate, endDate, q]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── KPIs ──────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = rows.length;
    // Latest by period (rows already sorted desc by period).
    const latest = rows[0] || {};
    const latestKwh = num(latest.energyKwh);
    const latestCo2 = num(latest.co2eqKg);
    const avgRecycled = total
      ? Math.round((rows.reduce((s, r) => s + num(r.recycledPct), 0) / total) * 10) / 10
      : 0;
    return { total, latestKwh, latestCo2, avgRecycled, latestPeriod: latest.period || "—" };
  }, [rows]);

  // ── Modal create ──────────────────────────────────────────────
  const create = async () => {
    if (!form.period || !/^\d{4}-\d{2}$/.test(form.period)) {
      toast.warn("Period must be YYYY-MM");
      return;
    }
    if (!form.reportedByEmpId) {
      toast.warn("Reporter Emp ID is required");
      return;
    }
    setSaving(true);
    try {
      const initiatives = String(form.greenInitiativesText || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await axios.post(`${API}/nabh-registers/esg-compliance`, {
        period: form.period,
        energyKwh:         num(form.energyKwh),
        waterKl:           num(form.waterKl),
        dieselLitres:      num(form.dieselLitres),
        medicalWasteKg:    num(form.medicalWasteKg),
        biomedicalWasteKg: num(form.biomedicalWasteKg),
        recycledPct:       num(form.recycledPct),
        co2eqKg:           num(form.co2eqKg),
        greenInitiatives:  initiatives,
        auditFindings:     form.auditFindings || "",
        reportedByEmpId:   form.reportedByEmpId,
        reportedByName:    form.reportedByName || "",
        status:            form.status || "Closed",
      }, authHdr());
      toast.success("ESG report saved");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to save");
    }
    setSaving(false);
  };

  const openCreate = () => {
    setForm({
      ...EMPTY_FORM,
      reportedByEmpId: user?.empId || user?.employeeId || "",
      reportedByName: user?.fullName || user?.name || "",
    });
    setShowCreate(true);
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <AdminPage>
      <Hero
        icon="pi-globe"
        color="green"
        title="ESG Compliance Register"
        subtitle="NABH 6th-ed Environment chapter — monthly Environmental, Social & Governance report (energy / water / waste / carbon / initiatives)."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Months reported" value={kpis.total} color={C.blue} icon="pi-calendar" />
        <KPI label={`Energy (latest ${kpis.latestPeriod})`} value={`${kpis.latestKwh.toLocaleString()} kWh`} color={C.amber} icon="pi-bolt" />
        <KPI label={`CO2e (latest)`} value={`${kpis.latestCo2.toLocaleString()} kg`} color={C.red} icon="pi-cloud" />
        <KPI label="Avg recycled %" value={`${kpis.avgRecycled}%`} color={C.green} icon="pi-replay" />
      </div>

      {/* ── Filter strip ─────────────────────────────────────── */}
      <Card title="Filters" color={C.blue} icon="pi-filter">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Search</label>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Period / reporter / audit notes…" />
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
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Period (YYYY-MM)</label>
            <input value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)}
              placeholder="2026-05"
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12, width: 110 }} />
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
              <PrimaryButton label="+ Add Monthly Report" icon="pi-plus" color={C.green} onClick={openCreate} />
            </div>
          )}
        </div>
      </Card>

      {/* ── Table ────────────────────────────────────────────── */}
      <Card title={`ESG Compliance Register · ${rows.length} reports`} color={C.green} icon="pi-list">
        {rows.length === 0 ? (
          <Empty icon="pi-inbox" text={loading ? "Loading…" : "No ESG reports in this range. Click + Add Monthly Report to file one."} />
        ) : (
          <Table cols={[
            { label: "Period" },
            { label: "Energy (kWh)" },
            { label: "Water (kL)" },
            { label: "Diesel (L)" },
            { label: "Medical Waste (kg)" },
            { label: "BMW (kg)" },
            { label: "Recycled %" },
            { label: "CO2e (kg)" },
            { label: "Initiatives" },
            { label: "Reporter" },
            { label: "Status" },
            { label: "Filed" },
          ]}>
            {rows.map((r) => (
              <tr key={r._id}>
                <td style={{ fontSize: 12, padding: "6px 8px", fontWeight: 600 }}>{r.period || "—"}</td>
                <td style={{ fontSize: 11.5, padding: "6px 8px", textAlign: "right" }}>{num(r.energyKwh).toLocaleString()}</td>
                <td style={{ fontSize: 11.5, padding: "6px 8px", textAlign: "right" }}>{num(r.waterKl).toLocaleString()}</td>
                <td style={{ fontSize: 11.5, padding: "6px 8px", textAlign: "right" }}>{num(r.dieselLitres).toLocaleString()}</td>
                <td style={{ fontSize: 11.5, padding: "6px 8px", textAlign: "right" }}>{num(r.medicalWasteKg).toLocaleString()}</td>
                <td style={{ fontSize: 11.5, padding: "6px 8px", textAlign: "right" }}>{num(r.biomedicalWasteKg).toLocaleString()}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  <Badge value={`${num(r.recycledPct)}%`} palette={num(r.recycledPct) >= 50 ? "green" : num(r.recycledPct) >= 25 ? "amber" : "red"} />
                </td>
                <td style={{ fontSize: 11.5, padding: "6px 8px", textAlign: "right" }}>{num(r.co2eqKg).toLocaleString()}</td>
                <td style={{ fontSize: 11, padding: "6px 8px", color: C.muted, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {Array.isArray(r.greenInitiatives) && r.greenInitiatives.length ? r.greenInitiatives.join(", ") : "—"}
                </td>
                <td style={{ fontSize: 12, padding: "6px 8px" }}>
                  {r.reportedByName || "—"}
                  {r.reportedByEmpId && <div style={{ fontSize: 10, color: C.muted }}>{r.reportedByEmpId}</div>}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <Badge value={r.status} palette={r.status === "Closed" ? "green" : r.status === "InProgress" ? "amber" : "muted"} />
                </td>
                <td style={{ fontSize: 11, padding: "6px 8px" }}>{fmtDT(r.createdAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ── Entry modal ──────────────────────────────────────── */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}
          title="ESG Monthly Report"
          color={C.green}
          icon="pi-globe"
          onSubmit={create}
          submitting={saving}
          submitLabel="Save report"
          size={760}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Period (YYYY-MM)" required>
              <input value={form.period}
                onChange={(e) => setForm({ ...form, period: e.target.value })}
                placeholder="2026-05" />
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Reporter Emp ID" required>
              <input value={form.reportedByEmpId}
                onChange={(e) => setForm({ ...form, reportedByEmpId: e.target.value })}
                placeholder="EMP-001" />
            </Field>

            <Field label="Reporter Name">
              <input value={form.reportedByName}
                onChange={(e) => setForm({ ...form, reportedByName: e.target.value })}
                placeholder="Facilities Manager" />
            </Field>
            <Field label="Energy (kWh)">
              <input type="number" min="0" step="0.01" value={form.energyKwh}
                onChange={(e) => setForm({ ...form, energyKwh: e.target.value })}
                placeholder="e.g. 125000" />
            </Field>
            <Field label="Water (kL)">
              <input type="number" min="0" step="0.01" value={form.waterKl}
                onChange={(e) => setForm({ ...form, waterKl: e.target.value })}
                placeholder="e.g. 480" />
            </Field>

            <Field label="Diesel (litres)">
              <input type="number" min="0" step="0.01" value={form.dieselLitres}
                onChange={(e) => setForm({ ...form, dieselLitres: e.target.value })}
                placeholder="DG fuel" />
            </Field>
            <Field label="Medical Waste (kg)">
              <input type="number" min="0" step="0.01" value={form.medicalWasteKg}
                onChange={(e) => setForm({ ...form, medicalWasteKg: e.target.value })}
                placeholder="Total clinical" />
            </Field>
            <Field label="Biomedical Waste (kg)">
              <input type="number" min="0" step="0.01" value={form.biomedicalWasteKg}
                onChange={(e) => setForm({ ...form, biomedicalWasteKg: e.target.value })}
                placeholder="BMW (BMW Rules 2016)" />
            </Field>

            <Field label="Recycled %">
              <input type="number" min="0" max="100" step="0.1" value={form.recycledPct}
                onChange={(e) => setForm({ ...form, recycledPct: e.target.value })}
                placeholder="0-100" />
            </Field>
            <Field label="CO2-eq (kg)">
              <input type="number" min="0" step="0.01" value={form.co2eqKg}
                onChange={(e) => setForm({ ...form, co2eqKg: e.target.value })}
                placeholder="Greenhouse-gas equivalent" />
            </Field>
            <div />

            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Green Initiatives (comma-separated)">
                <input value={form.greenInitiativesText}
                  onChange={(e) => setForm({ ...form, greenInitiativesText: e.target.value })}
                  placeholder="Solar 30kW, LED retrofit, Rainwater harvesting" />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Audit Findings">
                <textarea rows={3} value={form.auditFindings}
                  onChange={(e) => setForm({ ...form, auditFindings: e.target.value })}
                  placeholder="Internal ESG-audit findings, deviations, corrective actions…" />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
