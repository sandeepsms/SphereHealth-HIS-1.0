/**
 * DepartmentManagement.jsx — admin page for hospital departments.
 *
 * Redesigned to the latest theme: orange hero band, KPI strip,
 * primary card with table + search + add button, modal form with
 * Field primitives + Check toggles. All styling lives in the shared
 * admin-theme.jsx primitives — no inline `style` props except for
 * tiny per-row data-driven cases.
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { departmentService } from "../../Services/departmentService";
import {
  AdminPage, Hero, KPI, Card, Table, EmptyRow, RowAction, Badge,
  Modal, Field, Check, SearchInput, PrimaryButton, C,
} from "../../Components/admin-theme";
import { confirm } from "../../Components/common/ConfirmDialog";

const CATEGORIES = ["Clinical", "Surgical", "Diagnostic", "Support Services", "Emergency", "Critical Care"];
const EMPTY = {
  departmentName: "", departmentCode: "", description: "", category: "Clinical",
  opdAvailable: true, ipdAvailable: true, emergencyAvailable: false, isActive: true,
};

const DepartmentManagement = () => {
  const [rows, setRows]     = useState([]);
  const [q, setQ]           = useState("");
  const [loading, setLoad]  = useState(false);
  const [edit, setEdit]     = useState(null);   // department being edited / null
  const [adding, setAdding] = useState(false);

  useEffect(() => { load(); }, []);
  const load = async () => {
    try {
      setLoad(true);
      const r = await departmentService.getAllDepartments();
      setRows(r.data || []);
    } catch (e) { toast.error("Failed to load departments"); }
    finally { setLoad(false); }
  };

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    return rows.filter(r => rx.test(r.departmentName || "") || rx.test(r.departmentCode || "") || rx.test(r.category || ""));
  }, [rows, q]);

  // KPIs computed off the unfiltered list so the strip is stable.
  const kpis = useMemo(() => {
    const active = rows.filter(r => r.isActive).length;
    const opd = rows.filter(r => r.opdAvailable).length;
    const ipd = rows.filter(r => r.ipdAvailable).length;
    const emergency = rows.filter(r => r.emergencyAvailable).length;
    return { total: rows.length, active, opd, ipd, emergency };
  }, [rows]);

  const remove = async (dept) => {
    // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
    if (!(await confirm({
      title: "Deactivate department?",
      body: `"${dept.departmentName}" will be marked inactive and hidden from new visits and admissions. Existing records are preserved.`,
      danger: true,
      confirmLabel: "Deactivate",
    }))) return;
    try {
      await departmentService.deleteDepartment(dept._id);
      toast.success(`${dept.departmentName} deactivated`);
      load();
    } catch (e) { toast.error("Failed to deactivate"); }
  };

  return (
    <AdminPage>
      <Hero icon="pi-building" color="orange"
        title="Department Management"
        subtitle="Hospital departments, services, OPD / IPD / Emergency availability" />

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Total Departments" value={kpis.total}     color={C.orange} icon="pi-building" />
        <KPI label="Active"             value={kpis.active}    color={C.green}  icon="pi-check-circle" />
        <KPI label="OPD Available"      value={kpis.opd}       color={C.blue}   icon="pi-user" />
        <KPI label="IPD Available"      value={kpis.ipd}       color={C.amber}  icon="pi-home" />
        <KPI label="Emergency"          value={kpis.emergency} color={C.red}    icon="pi-bolt" />
      </div>

      <Card title="All Departments" color={C.orange} icon="pi-list"
        right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Search code / name / category…" />
            <PrimaryButton icon="pi-plus" label="Add Department"
              onClick={() => { setEdit({ ...EMPTY }); setAdding(true); }} />
          </div>
        }
        padding={0}>
        <Table cols={["Code", "Department", "Category", "Availability", "Status", "Action"]}>
          {loading
            ? <EmptyRow span={6} text="Loading…" />
            : filtered.length === 0
              ? <EmptyRow span={6} text={q ? `No departments match "${q}"` : "No departments yet — click Add Department to create one."} />
              : filtered.map((d, i) => (
                <tr key={d._id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                  <td style={{ padding: "9px 12px", fontFamily: "DM Mono, monospace", fontWeight: 700 }}>{d.departmentCode}</td>
                  <td style={{ padding: "9px 12px" }}>
                    <div style={{ fontWeight: 700 }}>{d.departmentName}</div>
                    {d.description && <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>{d.description}</div>}
                  </td>
                  <td style={{ padding: "9px 12px", color: C.muted }}>{d.category}</td>
                  <td style={{ padding: "9px 12px" }}>
                    <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                      {d.opdAvailable       && <Badge value="OPD"       palette="opd" />}
                      {d.ipdAvailable       && <Badge value="IPD"       palette="ipd" />}
                      {d.emergencyAvailable && <Badge value="Emergency" palette="emergency" />}
                      {!d.opdAvailable && !d.ipdAvailable && !d.emergencyAvailable && <span style={{ fontSize: 11, color: C.muted }}>—</span>}
                    </div>
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <Badge value={d.isActive ? "Active" : "Inactive"} palette={d.isActive ? "active" : "inactive"} />
                  </td>
                  <td style={{ padding: "7px 12px" }}>
                    <RowAction icon="pi-pencil" label="Edit" color={C.blue} onClick={() => setEdit({ ...d })} />
                    <RowAction icon="pi-trash"  label="Off"  color={C.red}  onClick={() => remove(d)} />
                  </td>
                </tr>
              ))}
        </Table>
      </Card>

      {edit && (
        <DepartmentModal
          dept={edit}
          isNew={adding}
          onClose={() => { setEdit(null); setAdding(false); }}
          onSaved={() => { setEdit(null); setAdding(false); load(); }} />
      )}
    </AdminPage>
  );
};

function DepartmentModal({ dept, isNew, onClose, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY, ...dept });
  const [saving, setSaving] = useState(false);
  const upd = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const submit = async () => {
    if (!form.departmentName.trim()) { toast.warn("Department name is required"); return; }
    if (!form.departmentCode.trim()) { toast.warn("Department code is required"); return; }
    setSaving(true);
    try {
      if (form._id) await departmentService.updateDepartment(form._id, form);
      else          await departmentService.createDepartment(form);
      toast.success(`${form.departmentName} ${form._id ? "updated" : "created"}`);
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <Modal
      title={isNew ? "Add New Department" : `Edit · ${form.departmentName}`}
      icon={isNew ? "pi-plus-circle" : "pi-pencil"}
      color={C.orange}
      onClose={onClose}
      onSubmit={submit}
      submitting={saving}
      submitLabel={isNew ? "Create department" : "Save changes"}
      size={620}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12, marginBottom: 12 }}>
        <Field label="Department name" required>
          <input className="his-field" value={form.departmentName} onChange={upd("departmentName")}
            placeholder="General Medicine" />
        </Field>
        <Field label="Department code" required>
          <input className="his-field" value={form.departmentCode}
            onChange={(e) => setForm(p => ({ ...p, departmentCode: e.target.value.toUpperCase() }))}
            placeholder="GMED" style={{ fontFamily: "DM Mono, monospace", letterSpacing: ".5px" }} />
        </Field>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Field label="Category">
          <select className="his-field" value={form.category} onChange={upd("category")}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Field label="Description">
          <textarea className="his-textarea" rows={3} value={form.description || ""} onChange={upd("description")}
            placeholder="Brief description of the department's scope and services." />
        </Field>
      </div>

      <div style={{ padding: "12px 14px", background: C.subtle, border: `1.5px solid ${C.border}`, borderRadius: 9 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>
          Services offered
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
          <Check label="OPD Available"        v={form.opdAvailable}       on={() => setForm(p => ({ ...p, opdAvailable: !p.opdAvailable }))} />
          <Check label="IPD Available"        v={form.ipdAvailable}       on={() => setForm(p => ({ ...p, ipdAvailable: !p.ipdAvailable }))} />
          <Check label="Emergency Available"  v={form.emergencyAvailable} on={() => setForm(p => ({ ...p, emergencyAvailable: !p.emergencyAvailable }))} />
          <Check label="Active"               v={form.isActive}           on={() => setForm(p => ({ ...p, isActive: !p.isActive }))} />
        </div>
      </div>
    </Modal>
  );
}

export default DepartmentManagement;
