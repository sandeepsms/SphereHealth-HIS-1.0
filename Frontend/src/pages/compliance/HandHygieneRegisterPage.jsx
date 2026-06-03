/**
 * HandHygieneRegisterPage.jsx — R7gw-B9-B9-T06 / NABH HIC.3
 *
 * Hand Hygiene Compliance register. IC officer / surveyor-facing chronological
 * observation log of WHO 5-Moments hand-hygiene events (HCW × moment × ward).
 *
 *   URL: /compliance/nabh-registers/handhygiene
 *
 * Layout:
 *   • KPIs (observations / compliance % / non-compliant)
 *   • Filter strip (q text + status + ward + role + moment + date-range)
 *   • Quick-Entry tap-to-record bar (mobile-friendly): role + moment +
 *     complied → POST
 *   • Table: observed-at / ward / observer / role / moment / complied /
 *     technique / notes
 *   • Add-Entry modal for richer entries (notes + UHID + technique)
 *
 * Role-gated: Admin / Doctor / Nurse / MRD / ComplianceOfficer (server gates
 * by compliance.nabh.* tokens; frontend mirrors for UI hiding).
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

const ROLES = ["Doctor", "Nurse", "Allied", "Visitor"];
const MOMENTS = [
  "BeforeTouchPatient",
  "BeforeCleanProcedure",
  "AfterBodyFluid",
  "AfterTouchPatient",
  "AfterTouchSurroundings",
];
const MOMENT_LABEL = {
  BeforeTouchPatient: "M1 · Before Patient",
  BeforeCleanProcedure: "M2 · Before Clean",
  AfterBodyFluid: "M3 · After Body Fluid",
  AfterTouchPatient: "M4 · After Patient",
  AfterTouchSurroundings: "M5 · After Surroundings",
};
const TECHNIQUES = ["Rub", "Wash", "Skip", "NotDone"];
const STATUSES = ["Open", "InProgress", "Closed"];

const EMPTY_FORM = {
  UHID: "",
  patientName: "",
  observedAt: new Date().toISOString().slice(0, 16),
  observedByEmpId: "",
  observedByName: "",
  ward: "",
  role: "Nurse",
  moment: "BeforeTouchPatient",
  complied: true,
  technique: "Rub",
  notes: "",
  status: "Closed",
};

export default function HandHygieneRegisterPage() {
  const { can, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterMoment, setFilterMoment] = useState("");
  const [filterWard, setFilterWard] = useState("");
  const [startDate, setStartDate] = useState(isoDaysAgo(30));
  const [endDate, setEndDate] = useState(todayISO());

  // Quick-entry bar
  const [quickRole, setQuickRole] = useState("Nurse");
  const [quickMoment, setQuickMoment] = useState("BeforeTouchPatient");
  const [quickWard, setQuickWard] = useState("");

  // Modal (richer entry)
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
      if (filterRole) params.set("role", filterRole);
      if (filterMoment) params.set("moment", filterMoment);
      if (filterWard) params.set("ward", filterWard);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (q) params.set("q", q);
      params.set("limit", "300");
      const r = await axios.get(`${API}/nabh-registers/handhygiene?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load Hand Hygiene register");
    }
    setLoading(false);
  }, [filterStatus, filterRole, filterMoment, filterWard, startDate, endDate, q]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── KPIs ──────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = rows.length;
    const complied = rows.filter((r) => r.complied).length;
    const pct = total ? Math.round((complied / total) * 1000) / 10 : 0;
    const nonComplied = total - complied;
    return { total, pct, nonComplied };
  }, [rows]);

  // ── Quick tap-to-record (one-tap event) ───────────────────────
  const quickRecord = async (complied) => {
    if (!canWrite) { toast.warn("No permission to record observations"); return; }
    try {
      await axios.post(`${API}/nabh-registers/handhygiene`, {
        observedAt: new Date().toISOString(),
        observedByEmpId: user?.empId || user?.employeeId || "",
        observedByName: user?.fullName || user?.name || "",
        ward: quickWard,
        role: quickRole,
        moment: quickMoment,
        complied: !!complied,
        technique: complied ? "Rub" : "NotDone",
      }, authHdr());
      toast.success(`Recorded · ${quickRole} · ${MOMENT_LABEL[quickMoment]} · ${complied ? "COMPLIED" : "MISSED"}`);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to record");
    }
  };

  // ── Full-form modal create ────────────────────────────────────
  const create = async () => {
    if (!form.role || !form.moment) { toast.warn("Role and moment are required"); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/nabh-registers/handhygiene`, {
        ...form,
        observedAt: form.observedAt ? new Date(form.observedAt).toISOString() : new Date().toISOString(),
        UHID: form.UHID ? form.UHID.toUpperCase() : "",
      }, authHdr());
      toast.success("Observation saved");
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
        icon="pi-shield"
        color="blue"
        title="Hand Hygiene Register"
        subtitle="NABH HIC.3 — WHO 5-Moments observation log. Tap to record one event; filter by ward / role / moment for compliance %."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Observations" value={kpis.total} color={C.blue} icon="pi-eye" />
        <KPI label="Compliance %" value={`${kpis.pct}%`} color={C.green} icon="pi-check-circle" />
        <KPI label="Non-compliant" value={kpis.nonComplied} color={C.red} icon="pi-times-circle" />
      </div>

      {/* ── Filter strip ─────────────────────────────────────── */}
      <Card title="Filters" color={C.blue} icon="pi-filter">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Search</label>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ward / observer / notes / UHID…" />
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
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Ward</label>
            <input value={filterWard} onChange={(e) => setFilterWard(e.target.value)}
              placeholder="ICU / Med-1…"
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12, width: 140 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Role</label>
            <select value={filterRole} onChange={(e) => setFilterRole(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Moment</label>
            <select value={filterMoment} onChange={(e) => setFilterMoment(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              {MOMENTS.map((m) => <option key={m} value={m}>{MOMENT_LABEL[m]}</option>)}
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
        </div>
      </Card>

      {/* ── Quick tap-to-record (mobile-friendly) ─────────────── */}
      {canWrite && (
        <Card title="Quick Record" color={C.green} icon="pi-bolt">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
            <div>
              <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Role</label>
              <select value={quickRole} onChange={(e) => setQuickRole(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 13 }}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Moment</label>
              <select value={quickMoment} onChange={(e) => setQuickMoment(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 13 }}>
                {MOMENTS.map((m) => <option key={m} value={m}>{MOMENT_LABEL[m]}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Ward</label>
              <input value={quickWard} onChange={(e) => setQuickWard(e.target.value)}
                placeholder="ICU / Med-1…"
                style={{ padding: "6px 10px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 13, width: 140 }} />
            </div>
            <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
              <button
                type="button"
                onClick={() => quickRecord(true)}
                style={{
                  padding: "8px 18px", borderRadius: 6, border: `1px solid ${C.green}`,
                  background: C.green, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13,
                }}
              >
                <i className="pi pi-check" style={{ marginRight: 6 }} />Complied
              </button>
              <button
                type="button"
                onClick={() => quickRecord(false)}
                style={{
                  padding: "8px 18px", borderRadius: 6, border: `1px solid ${C.red}`,
                  background: C.red, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13,
                }}
              >
                <i className="pi pi-times" style={{ marginRight: 6 }} />Missed
              </button>
              <PrimaryButton label="+ Add Detailed Entry" icon="pi-plus" color={C.blue}
                onClick={() => { setForm({ ...EMPTY_FORM, role: quickRole, moment: quickMoment, ward: quickWard }); setShowCreate(true); }} />
            </div>
          </div>
        </Card>
      )}

      {/* ── Table ────────────────────────────────────────────── */}
      <Card title={`Hand Hygiene Register · ${rows.length} entries`} color={C.blue} icon="pi-list">
        {rows.length === 0 ? (
          <Empty icon="pi-inbox" text={loading ? "Loading…" : "No observations in this range. Record one with Quick Record above."} />
        ) : (
          <Table cols={[
            { label: "Observed" },
            { label: "Ward" },
            { label: "Observer" },
            { label: "Role" },
            { label: "Moment" },
            { label: "Complied" },
            { label: "Technique" },
            { label: "Notes" },
            { label: "Status" },
          ]}>
            {rows.map((r) => (
              <tr key={r._id}>
                <td style={{ fontSize: 11.5, padding: "6px 8px" }}>{fmtDT(r.observedAt)}</td>
                <td style={{ fontSize: 12, padding: "6px 8px" }}>{r.ward || "—"}</td>
                <td style={{ fontSize: 12, padding: "6px 8px" }}>
                  {r.observedByName || "—"}
                  {r.observedByEmpId && <div style={{ fontSize: 10, color: C.muted }}>{r.observedByEmpId}</div>}
                </td>
                <td style={{ fontSize: 12, padding: "6px 8px" }}>
                  <Badge value={r.role} palette={r.role === "Doctor" ? "blue" : r.role === "Nurse" ? "green" : "muted"} />
                </td>
                <td style={{ fontSize: 11, padding: "6px 8px" }}>{MOMENT_LABEL[r.moment] || r.moment}</td>
                <td style={{ padding: "6px 8px" }}>
                  <Badge value={r.complied ? "YES" : "NO"} palette={r.complied ? "green" : "red"} />
                </td>
                <td style={{ fontSize: 11, padding: "6px 8px" }}>
                  <Badge value={r.technique} palette={r.technique === "Rub" || r.technique === "Wash" ? "blue" : "muted"} />
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

      {/* ── Detailed entry modal ──────────────────────────────── */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}
          title="Hand Hygiene Observation"
          color={C.blue}
          icon="pi-shield"
          onSubmit={create}
          submitting={saving}
          submitLabel="Save observation"
          size={680}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Observed at" required>
              <input type="datetime-local" value={form.observedAt}
                onChange={(e) => setForm({ ...form, observedAt: e.target.value })} />
            </Field>
            <Field label="Ward">
              <input value={form.ward} onChange={(e) => setForm({ ...form, ward: e.target.value })}
                placeholder="ICU / Med-1 / OT-2" />
            </Field>
            <Field label="Observer Emp ID">
              <input value={form.observedByEmpId} onChange={(e) => setForm({ ...form, observedByEmpId: e.target.value })}
                placeholder="EMP-001" />
            </Field>
            <Field label="Observer Name">
              <input value={form.observedByName} onChange={(e) => setForm({ ...form, observedByName: e.target.value })}
                placeholder="IC Officer name" />
            </Field>
            <Field label="HCW Role" required>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="WHO Moment" required>
              <select value={form.moment} onChange={(e) => setForm({ ...form, moment: e.target.value })}>
                {MOMENTS.map((m) => <option key={m} value={m}>{MOMENT_LABEL[m]}</option>)}
              </select>
            </Field>
            <Field label="Complied?" required>
              <select value={form.complied ? "true" : "false"}
                onChange={(e) => setForm({ ...form, complied: e.target.value === "true" })}>
                <option value="true">Yes — performed hand hygiene</option>
                <option value="false">No — missed / skipped</option>
              </select>
            </Field>
            <Field label="Technique">
              <select value={form.technique} onChange={(e) => setForm({ ...form, technique: e.target.value })}>
                {TECHNIQUES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Patient UHID (optional)">
              <input value={form.UHID}
                onChange={(e) => setForm({ ...form, UHID: e.target.value.toUpperCase() })}
                placeholder="Only if linked to a specific patient" />
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Notes">
                <textarea rows={2} value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="e.g. observed during isolation-case audit; HCW reminded about M3" />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
