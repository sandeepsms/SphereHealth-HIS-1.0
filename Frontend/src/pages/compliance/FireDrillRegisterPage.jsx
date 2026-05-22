/**
 * FireDrillRegisterPage.jsx  (R7bf-G / A5-CRIT-7 / NABH FMS.4)
 *
 * Fire-drill / emergency-code register.
 *
 *   URL: /fire-drills
 *
 * Layout:
 *   • 3 KPIs (scheduled / completed-90d / overdue)
 *   • "+ Schedule Drill" button
 *   • Table with drill-number / type / scheduled / status
 *   • Per-row Complete + Cancel actions
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

const fmtD = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const TYPES = ["FIRE", "EARTHQUAKE", "BOMB_THREAT", "EVACUATION", "CODE_RED", "CODE_BLUE", "OTHER"];
const STATUSES = ["SCHEDULED", "COMPLETED", "CANCELLED"];
const STATUS_COLOR = { SCHEDULED: "blue", COMPLETED: "green", CANCELLED: "muted" };

const EMPTY_FORM = {
  scheduledDate: new Date().toISOString().slice(0, 10),
  type: "FIRE",
  area: "",
  conductedByName: "",
  participantCount: 0,
  durationMinutes: 0,
  nextDrillDue: "",
  notes: "",
};

const EMPTY_COMPLETE = {
  actualDate: new Date().toISOString().slice(0, 10),
  participantCount: 0,
  durationMinutes: 0,
  observations: "",
  deficienciesFound: "",
  correctiveActions: "",
  nextDrillDue: "",
};

export default function FireDrillRegisterPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [completeRow, setCompleteRow] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [completeForm, setCompleteForm] = useState(EMPTY_COMPLETE);
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      params.set("limit", "200");
      const r = await axios.get(`${API}/fire-drills?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load drills");
    }
    setLoading(false);
  }, [filterStatus]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const ql = q.toLowerCase();
    return rows.filter((r) =>
      (r.drillNumber || "").toLowerCase().includes(ql) ||
      (r.type || "").toLowerCase().includes(ql) ||
      (r.area || "").toLowerCase().includes(ql),
    );
  }, [rows, q]);

  const kpis = useMemo(() => {
    const now = Date.now();
    const scheduled = rows.filter((r) => r.status === "SCHEDULED").length;
    const completed90 = rows.filter((r) =>
      r.status === "COMPLETED" && r.actualDate &&
      (now - new Date(r.actualDate).getTime()) < 90 * 86400000,
    ).length;
    const overdue = rows.filter((r) =>
      r.status === "SCHEDULED" && r.scheduledDate && new Date(r.scheduledDate).getTime() < now,
    ).length;
    return { scheduled, completed90, overdue };
  }, [rows]);

  const create = async () => {
    if (!form.scheduledDate || !form.type) {
      toast.warn("Scheduled date + type required");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/fire-drills`, form, authHdr());
      toast.success("Drill scheduled");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to schedule");
    }
    setSaving(false);
  };

  const complete = async () => {
    setSaving(true);
    try {
      const body = {
        ...completeForm,
        deficienciesFound: completeForm.deficienciesFound
          ? completeForm.deficienciesFound.split("\n").map((s) => s.trim()).filter(Boolean)
          : [],
        correctiveActions: completeForm.correctiveActions
          ? completeForm.correctiveActions.split("\n").map((s) => s.trim()).filter(Boolean)
          : [],
      };
      await axios.put(`${API}/fire-drills/${completeRow._id}/complete`, body, authHdr());
      toast.success("Drill marked complete");
      setCompleteRow(null);
      setCompleteForm(EMPTY_COMPLETE);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to complete");
    }
    setSaving(false);
  };

  const cancel = async (row) => {
    const reason = window.prompt("Cancellation reason?");
    if (!reason) return;
    try {
      await axios.put(`${API}/fire-drills/${row._id}/cancel`, { reason }, authHdr());
      toast.success("Cancelled");
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to cancel");
    }
  };

  return (
    <AdminPage>
      <Hero icon="pi-fire" color="red"
        title="Fire Drill Register"
        subtitle="NABH FMS.4 — quarterly drills with observations, deficiencies, corrective actions, next-due tracking." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Scheduled"        value={kpis.scheduled}    color={C.blue}  icon="pi-calendar" />
        <KPI label="Completed (90d)"  value={kpis.completed90}  color={C.green} icon="pi-check-circle" />
        <KPI label="Overdue"          value={kpis.overdue}      color={C.red}   icon="pi-exclamation-triangle" />
      </div>

      <Card title="Drill Register" color={C.red} icon="pi-fire"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Drill # / area / type…" />
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {can("compliance.firedrill.write") && (
              <PrimaryButton label="+ Schedule Drill" icon="pi-plus" color={C.red}
                onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }} />
            )}
          </div>
        }>
        {filtered.length === 0 ? (
          <Empty icon="pi-fire" text={loading ? "Loading…" : "No drills on file."} />
        ) : (
          <Table cols={[
            { label: "Drill #" }, { label: "Scheduled" }, { label: "Actual" }, { label: "Type" },
            { label: "Area" }, { label: "Status" }, { label: "Next due" }, { label: "Action" },
          ]}>
            {filtered.map((r) => (
              <tr key={r._id}>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.drillNumber}</td>
                <td style={{ fontSize: 11.5 }}>{fmtD(r.scheduledDate)}</td>
                <td style={{ fontSize: 11.5 }}>{fmtD(r.actualDate)}</td>
                <td style={{ fontSize: 11 }}>{r.type}</td>
                <td style={{ fontSize: 11 }}>{r.area || "—"}</td>
                <td><Badge value={r.status} palette={STATUS_COLOR[r.status] || "muted"} /></td>
                <td style={{ fontSize: 11.5 }}>{fmtD(r.nextDrillDue)}</td>
                <td style={{ display: "flex", gap: 6 }}>
                  {can("compliance.firedrill.write") && r.status === "SCHEDULED" && (
                    <>
                      <button onClick={() => {
                        setCompleteRow(r);
                        setCompleteForm({
                          ...EMPTY_COMPLETE,
                          actualDate: new Date().toISOString().slice(0, 10),
                          participantCount: r.participantCount || 0,
                        });
                      }}
                        style={{ padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.green}`,
                          background: "#fff", color: C.green, fontSize: 11, cursor: "pointer" }}>
                        Complete
                      </button>
                      <button onClick={() => cancel(r)}
                        style={{ padding: "3px 8px", borderRadius: 4, border: `1px solid ${C.muted}`,
                          background: "#fff", color: C.muted, fontSize: 11, cursor: "pointer" }}>
                        Cancel
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}
          title="Schedule new drill"
          color={C.red}
          onSubmit={create}
          submitting={saving}
          submitLabel="Schedule">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Type" required>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Scheduled date" required>
              <input type="date" value={form.scheduledDate}
                onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
            </Field>
            <Field label="Area">
              <input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}
                placeholder="e.g. Block A, ICU, Full hospital" />
            </Field>
            <Field label="Conducted by">
              <input value={form.conductedByName}
                onChange={(e) => setForm({ ...form, conductedByName: e.target.value })} />
            </Field>
            <Field label="Next drill due">
              <input type="date" value={form.nextDrillDue}
                onChange={(e) => setForm({ ...form, nextDrillDue: e.target.value })} />
            </Field>
            <Field label="Expected participants">
              <input type="number" value={form.participantCount}
                onChange={(e) => setForm({ ...form, participantCount: Number(e.target.value) || 0 })} />
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Notes">
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
          </div>
        </Modal>
      )}

      {completeRow && (
        <Modal onClose={() => setCompleteRow(null)}
          title={`Complete drill — ${completeRow.drillNumber}`}
          color={C.green}
          onSubmit={complete}
          submitting={saving}
          submitLabel="Mark complete"
          size={680}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Actual date">
              <input type="date" value={completeForm.actualDate}
                onChange={(e) => setCompleteForm({ ...completeForm, actualDate: e.target.value })} />
            </Field>
            <Field label="Duration (min)">
              <input type="number" value={completeForm.durationMinutes}
                onChange={(e) => setCompleteForm({ ...completeForm, durationMinutes: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Participants">
              <input type="number" value={completeForm.participantCount}
                onChange={(e) => setCompleteForm({ ...completeForm, participantCount: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Next drill due">
              <input type="date" value={completeForm.nextDrillDue}
                onChange={(e) => setCompleteForm({ ...completeForm, nextDrillDue: e.target.value })} />
            </Field>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Observations">
                <textarea rows={2} value={completeForm.observations}
                  onChange={(e) => setCompleteForm({ ...completeForm, observations: e.target.value })} />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Deficiencies found (one per line)">
                <textarea rows={3} value={completeForm.deficienciesFound}
                  onChange={(e) => setCompleteForm({ ...completeForm, deficienciesFound: e.target.value })}
                  placeholder="Exit signage missing on 3F&#10;Fire extinguisher pressure low" />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Corrective actions (one per line)">
                <textarea rows={3} value={completeForm.correctiveActions}
                  onChange={(e) => setCompleteForm({ ...completeForm, correctiveActions: e.target.value })} />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
