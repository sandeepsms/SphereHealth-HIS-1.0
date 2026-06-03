/**
 * FacilitiesMaintenanceLogRegisterPage.jsx — R7gw-B10-T06 / NABH FMS.5
 *
 * Facilities & Equipment Maintenance Log register. Engineering / Biomedical
 * / Facilities team-facing chronological log of PPM (planned-preventive),
 * Corrective, AMC and Breakdown jobs for plant equipment NABH cares about
 * under FMS.5 (BMS / DG-set / Fire-system / Lift / Biomedical / HVAC /
 * MedGas / UPS / Steam-boiler).
 *
 *   URL: /compliance/nabh-registers/facilities-maintenance
 *
 * Layout:
 *   • KPIs (total jobs / overdue / done this period)
 *   • Filter strip (q text + status + equipmentType + jobType + date-range)
 *   • Add-Entry modal (equipmentType, equipmentId, scheduledAt, performedAt,
 *     performedByEmpId, findings, correctiveAction, nextDueDate, status)
 *   • Table: scheduled / equipment / location / job / status / performed by
 *
 * Role-gated: Admin / Engineering / Biomedical / Facilities / ComplianceOfficer
 * (server gates by compliance.nabh.* tokens; frontend mirrors for UI hiding).
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

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "2-digit",
  }) : "—";

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const isoDaysAhead = (n) => {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const EQUIPMENT_TYPES = [
  "BMS", "Generator", "Fire-System", "Lift", "Biomedical",
  "HVAC", "MedGas", "UPS", "Steam-Boiler",
];
const EQUIPMENT_LABEL = {
  "BMS":          "BMS",
  "Generator":    "Generator (DG)",
  "Fire-System":  "Fire System",
  "Lift":         "Lift / Elevator",
  "Biomedical":   "Biomedical Eq.",
  "HVAC":         "HVAC / AHU",
  "MedGas":       "Medical-Gas",
  "UPS":          "UPS / Inverter",
  "Steam-Boiler": "Steam Boiler",
};
const JOB_TYPES = ["PPM", "Corrective", "Calibration", "AMC", "Breakdown", "Inspection"];
const STATUSES = ["Scheduled", "Done", "Overdue", "Cancelled"];

const EMPTY_FORM = {
  equipmentType: "Biomedical",
  equipmentId: "",
  equipmentName: "",
  location: "",
  scheduledAt: new Date().toISOString().slice(0, 16),
  performedAt: "",
  performedByEmpId: "",
  performedByName: "",
  vendor: "",
  amcContractRef: "",
  jobType: "PPM",
  findings: "",
  correctiveAction: "",
  partsReplaced: "",
  downtimeMinutes: 0,
  nextDueDate: "",
  status: "Scheduled",
};

const isOverdueRow = (r) =>
  r && r.nextDueDate &&
  !["Done", "Cancelled"].includes(r.status) &&
  new Date(r.nextDueDate) < new Date();

export default function FacilitiesMaintenanceLogRegisterPage() {
  const { can, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterEqType, setFilterEqType] = useState("");
  const [filterJobType, setFilterJobType] = useState("");
  const [filterOverdueOnly, setFilterOverdueOnly] = useState(false);
  const [startDate, setStartDate] = useState(isoDaysAgo(60));
  const [endDate, setEndDate] = useState(isoDaysAhead(60));

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
      if (filterEqType) params.set("equipmentType", filterEqType);
      if (filterJobType) params.set("jobType", filterJobType);
      if (filterOverdueOnly) params.set("overdueOnly", "true");
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (q) params.set("q", q);
      params.set("limit", "300");
      const r = await axios.get(`${API}/nabh-registers/facilities-maintenance?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load Facilities Maintenance register");
    }
    setLoading(false);
  }, [filterStatus, filterEqType, filterJobType, filterOverdueOnly, startDate, endDate, q]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // ── KPIs ──────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total = rows.length;
    const done = rows.filter((r) => r.status === "Done").length;
    const overdue = rows.filter(isOverdueRow).length;
    const scheduled = rows.filter((r) => r.status === "Scheduled").length;
    return { total, done, overdue, scheduled };
  }, [rows]);

  // ── Create ────────────────────────────────────────────────────
  const create = async () => {
    if (!form.equipmentType || !form.equipmentId) {
      toast.warn("Equipment type and ID are required"); return;
    }
    if (!form.scheduledAt) {
      toast.warn("Scheduled-at is required"); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        performedAt: form.performedAt ? new Date(form.performedAt).toISOString() : null,
        nextDueDate: form.nextDueDate ? new Date(form.nextDueDate).toISOString() : null,
        downtimeMinutes: Number(form.downtimeMinutes) || 0,
        performedByEmpId: form.performedByEmpId || user?.empId || user?.employeeId || "",
        performedByName:  form.performedByName  || user?.fullName || user?.name || "",
      };
      await axios.post(`${API}/nabh-registers/facilities-maintenance`, payload, authHdr());
      toast.success("Maintenance log saved");
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
        icon="pi-wrench"
        color="orange"
        title="Facilities & Equipment Maintenance Log"
        subtitle="NABH FMS.5 — PPM / Corrective / AMC log for BMS, DG-set, Fire, Lift, Biomedical, HVAC, Medical-Gas, UPS, Steam-Boiler."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Jobs in range" value={kpis.total} color={C.blue} icon="pi-list" />
        <KPI label="Done" value={kpis.done} color={C.green} icon="pi-check-circle" />
        <KPI label="Scheduled" value={kpis.scheduled} color={C.amber || C.orange || C.yellow} icon="pi-calendar" />
        <KPI label="Overdue" value={kpis.overdue} color={C.red} icon="pi-exclamation-triangle" />
      </div>

      {/* ── Filter strip ─────────────────────────────────────── */}
      <Card title="Filters" color={C.blue} icon="pi-filter">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Search</label>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Eq ID / location / vendor / findings…" />
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
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Equipment</label>
            <select value={filterEqType} onChange={(e) => setFilterEqType(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              {EQUIPMENT_TYPES.map((t) => <option key={t} value={t}>{EQUIPMENT_LABEL[t]}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>Job</label>
            <select value={filterJobType} onChange={(e) => setFilterJobType(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All</option>
              {JOB_TYPES.map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>From (sched)</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.muted, display: "block", marginBottom: 2 }}>To (sched)</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14 }}>
            <input type="checkbox" id="fOverdue" checked={filterOverdueOnly}
              onChange={(e) => setFilterOverdueOnly(e.target.checked)} />
            <label htmlFor="fOverdue" style={{ fontSize: 12 }}>Overdue only</label>
          </div>
          {canWrite && (
            <div style={{ marginLeft: "auto" }}>
              <PrimaryButton label="+ Add Maintenance Job" icon="pi-plus" color={C.blue}
                onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }} />
            </div>
          )}
        </div>
      </Card>

      {/* ── Table ────────────────────────────────────────────── */}
      <Card title={`Facilities Maintenance Log · ${rows.length} entries`} color={C.blue} icon="pi-list">
        {rows.length === 0 ? (
          <Empty icon="pi-inbox" text={loading ? "Loading…" : "No jobs in this range. Add one with the button above."} />
        ) : (
          <Table cols={[
            { label: "Scheduled" },
            { label: "Equipment" },
            { label: "Eq ID / Location" },
            { label: "Job" },
            { label: "Performed" },
            { label: "Performed by" },
            { label: "Next Due" },
            { label: "Status" },
          ]}>
            {rows.map((r) => {
              const overdue = isOverdueRow(r);
              return (
                <tr key={r._id}>
                  <td style={{ fontSize: 11.5, padding: "6px 8px" }}>{fmtDT(r.scheduledAt)}</td>
                  <td style={{ fontSize: 12, padding: "6px 8px" }}>
                    <Badge value={EQUIPMENT_LABEL[r.equipmentType] || r.equipmentType} palette="blue" />
                  </td>
                  <td style={{ fontSize: 12, padding: "6px 8px" }}>
                    <div style={{ fontWeight: 600 }}>{r.equipmentId || "—"}</div>
                    {r.equipmentName && <div style={{ fontSize: 11, color: C.muted }}>{r.equipmentName}</div>}
                    {r.location && <div style={{ fontSize: 10.5, color: C.muted }}>{r.location}</div>}
                  </td>
                  <td style={{ fontSize: 11, padding: "6px 8px" }}>
                    <Badge value={r.jobType || "PPM"}
                      palette={r.jobType === "Breakdown" || r.jobType === "Corrective" ? "red" : "muted"} />
                  </td>
                  <td style={{ fontSize: 11, padding: "6px 8px" }}>{fmtDT(r.performedAt)}</td>
                  <td style={{ fontSize: 12, padding: "6px 8px" }}>
                    {r.performedByName || r.vendor || "—"}
                    {r.performedByEmpId && <div style={{ fontSize: 10, color: C.muted }}>{r.performedByEmpId}</div>}
                    {r.vendor && r.performedByName && <div style={{ fontSize: 10, color: C.muted }}>{r.vendor}</div>}
                  </td>
                  <td style={{ fontSize: 11.5, padding: "6px 8px", color: overdue ? C.red : undefined, fontWeight: overdue ? 700 : 400 }}>
                    {fmtDate(r.nextDueDate)}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <Badge value={overdue ? "OVERDUE" : r.status}
                      palette={
                        overdue ? "red"
                        : r.status === "Done" ? "green"
                        : r.status === "Cancelled" ? "muted"
                        : "blue"
                      } />
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
          title="Add Maintenance Job"
          color={C.blue}
          icon="pi-wrench"
          onSubmit={create}
          submitting={saving}
          submitLabel="Save job"
          size={780}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Equipment Type" required>
              <select value={form.equipmentType}
                onChange={(e) => setForm({ ...form, equipmentType: e.target.value })}>
                {EQUIPMENT_TYPES.map((t) => <option key={t} value={t}>{EQUIPMENT_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field label="Equipment ID / Asset Tag" required>
              <input value={form.equipmentId}
                onChange={(e) => setForm({ ...form, equipmentId: e.target.value })}
                placeholder="DG-01 / VENT-005 / LIFT-2" />
            </Field>
            <Field label="Equipment Name">
              <input value={form.equipmentName}
                onChange={(e) => setForm({ ...form, equipmentName: e.target.value })}
                placeholder="Cummins 500 KVA / Drager V300" />
            </Field>
            <Field label="Location">
              <input value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Plant-room / ICU / Block-B 3F" />
            </Field>
            <Field label="Job Type">
              <select value={form.jobType}
                onChange={(e) => setForm({ ...form, jobType: e.target.value })}>
                {JOB_TYPES.map((j) => <option key={j} value={j}>{j}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Scheduled At" required>
              <input type="datetime-local" value={form.scheduledAt}
                onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
            </Field>
            <Field label="Performed At">
              <input type="datetime-local" value={form.performedAt}
                onChange={(e) => setForm({ ...form, performedAt: e.target.value })} />
            </Field>
            <Field label="Performed By Emp ID">
              <input value={form.performedByEmpId}
                onChange={(e) => setForm({ ...form, performedByEmpId: e.target.value })}
                placeholder="EMP-001" />
            </Field>
            <Field label="Performed By Name">
              <input value={form.performedByName}
                onChange={(e) => setForm({ ...form, performedByName: e.target.value })}
                placeholder="Engineer / Technician name" />
            </Field>
            <Field label="Vendor (AMC)">
              <input value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                placeholder="OEM / AMC vendor name" />
            </Field>
            <Field label="AMC Contract Ref">
              <input value={form.amcContractRef}
                onChange={(e) => setForm({ ...form, amcContractRef: e.target.value })}
                placeholder="PO no. / contract ref" />
            </Field>
            <Field label="Next Due Date">
              <input type="date" value={form.nextDueDate}
                onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })} />
            </Field>
            <Field label="Downtime (min)">
              <input type="number" min={0} value={form.downtimeMinutes}
                onChange={(e) => setForm({ ...form, downtimeMinutes: e.target.value })} />
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Findings">
                <textarea rows={2} value={form.findings}
                  onChange={(e) => setForm({ ...form, findings: e.target.value })}
                  placeholder="What was found during inspection / breakdown" />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Corrective Action">
                <textarea rows={2} value={form.correctiveAction}
                  onChange={(e) => setForm({ ...form, correctiveAction: e.target.value })}
                  placeholder="What was done to restore / prevent recurrence" />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Parts Replaced">
                <textarea rows={2} value={form.partsReplaced}
                  onChange={(e) => setForm({ ...form, partsReplaced: e.target.value })}
                  placeholder="Item / qty / batch no." />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
