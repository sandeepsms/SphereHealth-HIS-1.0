/**
 * FoodReactionsPage.jsx  (R7bk — sidebar nav coverage)
 *
 * Adverse Food Reaction register (NABH COP.21 + FSSAI).
 *
 *   URL: /food-reactions
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const SEVERITIES = ["MILD", "MODERATE", "SEVERE", "ANAPHYLAXIS"];
const STATUSES = ["OPEN", "CLOSED", "ESCALATED"];
const OUTCOMES = ["RESOLVED", "ONGOING", "REFERRED_TO_DOC", "ESCALATED"];

const SEV_COLOR = { MILD: "blue", MODERATE: "amber", SEVERE: "red", ANAPHYLAXIS: "purple" };
const STATUS_COLOR = { OPEN: "red", CLOSED: "green", ESCALATED: "purple" };

const EMPTY_FORM = {
  patientUHID: "",
  patientName: "",
  mealItem: "",
  suspectedAllergen: "",
  reactionDescription: "",
  severity: "MILD",
  onsetMinutesAfterMeal: "",
  actionTaken: "",
  outcome: "ONGOING",
};

export default function FoodReactionsPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // R7bm-F5 — AbortController on the filter-triggered fetch so a rapid
  // status-filter toggle doesn't race responses, plus unmount cleanup.
  const abortRef = useRef(null);
  const mountedRef = useRef(true);
  const fetchList = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      params.set("limit", "200");
      const r = await axios.get(`${API}/food-reactions?${params}`, { ...authHdr(), signal: ctrl.signal });
      if (!mountedRef.current) return;
      setRows(r.data?.data || []);
    } catch (e) {
      if (e.name !== "CanceledError" && e.name !== "AbortError") {
        toast.error(e?.response?.data?.message || "Failed to load");
      }
    }
    if (mountedRef.current) setLoading(false);
  }, [filterStatus]);

  useEffect(() => {
    mountedRef.current = true;
    fetchList();
    return () => {
      mountedRef.current = false;
      if (abortRef.current) abortRef.current.abort();
      // Reset transient form state on unmount.
      setForm(EMPTY_FORM);
      setShowCreate(false);
    };
  }, [fetchList]);

  const filtered = useMemo(() => {
    if (!q) return rows;
    const ql = q.toLowerCase();
    return rows.filter(r =>
      (r.patientUHID || "").toLowerCase().includes(ql) ||
      (r.patientName || "").toLowerCase().includes(ql) ||
      (r.mealItem || "").toLowerCase().includes(ql) ||
      (r.suspectedAllergen || "").toLowerCase().includes(ql),
    );
  }, [rows, q]);

  const kpis = useMemo(() => ({
    open: rows.filter(r => r.status === "OPEN").length,
    severe: rows.filter(r => ["SEVERE", "ANAPHYLAXIS"].includes(r.severity)).length,
    total: rows.length,
  }), [rows]);

  const create = async () => {
    if (!form.patientUHID.trim() || !form.reactionDescription.trim()) {
      toast.warn("UHID + reaction description required"); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        patientUHID: form.patientUHID.toUpperCase().trim(),
        onsetMinutesAfterMeal: form.onsetMinutesAfterMeal === "" ? null : Number(form.onsetMinutesAfterMeal),
      };
      await axios.post(`${API}/food-reactions`, payload, authHdr());
      toast.success("Food reaction recorded");
      setShowCreate(false); setForm(EMPTY_FORM);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to record");
    }
    setSaving(false);
  };

  const close = async (row) => {
    if (!window.confirm(`Close case ${row._id} for ${row.patientUHID}?`)) return;
    try {
      await axios.put(`${API}/food-reactions/${row._id}/close`, {}, authHdr());
      toast.success("Closed"); fetchList();
    } catch (e) { toast.error(e?.response?.data?.message || "Failed"); }
  };

  return (
    <AdminPage>
      <Hero icon="pi-exclamation-triangle" color="red"
        title="Adverse Food Reactions"
        subtitle="NABH COP.21 — food-allergen reactions linked to kitchen indents; close-loop with dietitian." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Open" value={kpis.open}   color={C.red}    icon="pi-exclamation-circle" />
        <KPI label="Severe/Anaphylaxis" value={kpis.severe} color={C.purple} icon="pi-flag" />
        <KPI label="Total" value={kpis.total} color={C.blue}   icon="pi-list" />
      </div>

      <Card title="Reactions Register" icon="pi-table">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
          {/* R7bm-F5 — SearchInput passes the raw event; pull e.target.value. */}
          <SearchInput value={q} onChange={e => setQ(e.target.value)} placeholder="Search UHID / patient / meal / allergen…" />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          {can("quality.food-reaction.write") && (
            <PrimaryButton onClick={() => setShowCreate(true)}>+ Record Reaction</PrimaryButton>
          )}
        </div>
        {loading ? <div>Loading…</div> : filtered.length === 0 ? <Empty msg="No reactions recorded." /> : (
          <Table
            headers={["Time", "Patient", "Meal", "Allergen", "Severity", "Onset", "Status", ""]}
            rows={filtered.map(r => [
              fmtDT(r.reportedAt || r.createdAt),
              `${r.patientName || "—"} (${r.patientUHID || "—"})`,
              r.mealItem || "—",
              r.suspectedAllergen || "—",
              <Badge tone={SEV_COLOR[r.severity] || "muted"}>{r.severity}</Badge>,
              r.onsetMinutesAfterMeal != null ? `${r.onsetMinutesAfterMeal} min` : "—",
              <Badge tone={STATUS_COLOR[r.status] || "muted"}>{r.status}</Badge>,
              r.status === "OPEN" && can("quality.food-reaction.write")
                ? <PrimaryButton small onClick={() => close(r)}>Close</PrimaryButton>
                : null,
            ])}
          />
        )}
      </Card>

      {showCreate && (
        <Modal title="Record Food Reaction" onClose={() => setShowCreate(false)} size="md">
          <Field label="Patient UHID" required>
            <input value={form.patientUHID} onChange={e => setForm({...form, patientUHID: e.target.value.toUpperCase()})} />
          </Field>
          <Field label="Patient Name">
            <input value={form.patientName} onChange={e => setForm({...form, patientName: e.target.value})} />
          </Field>
          <Field label="Meal Item">
            <input value={form.mealItem} onChange={e => setForm({...form, mealItem: e.target.value})}
              placeholder="e.g. Peanut chikki" />
          </Field>
          <Field label="Suspected Allergen">
            <input value={form.suspectedAllergen} onChange={e => setForm({...form, suspectedAllergen: e.target.value})}
              placeholder="e.g. PEANUTS / TREE_NUTS" />
          </Field>
          <Field label="Reaction Description" required>
            <textarea rows={3} value={form.reactionDescription}
              onChange={e => setForm({...form, reactionDescription: e.target.value})} />
          </Field>
          <Field label="Severity" required>
            <select value={form.severity} onChange={e => setForm({...form, severity: e.target.value})}>
              {SEVERITIES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Onset (minutes after meal)">
            <input type="number" value={form.onsetMinutesAfterMeal}
              onChange={e => setForm({...form, onsetMinutesAfterMeal: e.target.value})} />
          </Field>
          <Field label="Action Taken">
            <textarea rows={2} value={form.actionTaken}
              onChange={e => setForm({...form, actionTaken: e.target.value})} />
          </Field>
          <Field label="Outcome">
            <select value={form.outcome} onChange={e => setForm({...form, outcome: e.target.value})}>
              {OUTCOMES.map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <PrimaryButton onClick={create} disabled={saving}>{saving ? "Saving…" : "Save"}</PrimaryButton>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
