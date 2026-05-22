/**
 * CodeResponsePage.jsx  (R7bk — sidebar nav coverage)
 *
 * Unified Code-Response register (NABH FMS / IPSG.6).
 *
 *   URL: /code-response
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

const CODES = ["BLUE", "RED", "PINK", "GREY", "YELLOW", "WHITE", "BROWN", "BLACK"];
const OUTCOMES = ["RESOLVED", "ESCALATED", "FALSE_ALARM", "PRONOUNCED_DEAD", "TRANSFERRED"];

const CODE_LABEL = {
  BLUE: "Cardiac", RED: "Fire", PINK: "Infant abduction", GREY: "Combative",
  YELLOW: "MCI/Mass-casualty", WHITE: "Violence", BROWN: "Hazmat", BLACK: "Bomb threat",
};
const CODE_COLOR = {
  BLUE: "blue", RED: "red", PINK: "purple", GREY: "muted",
  YELLOW: "amber", WHITE: "muted", BROWN: "amber", BLACK: "purple",
};

const EMPTY_FORM = {
  code: "BLUE",
  location: "",
  patientUHID: "",
  notes: "",
};

export default function CodeResponsePage() {
  const { can, user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterCode, setFilterCode] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showResolve, setShowResolve] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [resolveOutcome, setResolveOutcome] = useState("RESOLVED");
  const [resolveNotes, setResolveNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCode) params.set("code", filterCode);
      params.set("limit", "200");
      const r = await axios.get(`${API}/code-response?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load");
    }
    setLoading(false);
  }, [filterCode]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const kpis = useMemo(() => ({
    open: rows.filter(r => !r.resolvedAt).length,
    today: rows.filter(r => {
      const d = new Date(r.alertedAt || r.createdAt);
      const t = new Date();
      return d.toDateString() === t.toDateString();
    }).length,
    total: rows.length,
  }), [rows]);

  const create = async () => {
    if (!form.location.trim()) { toast.warn("Location required"); return; }
    setSaving(true);
    try {
      await axios.post(`${API}/code-response`, {
        ...form,
        alertedByName: user?.fullName || user?.name,
      }, authHdr());
      toast.success(`Code ${form.code} recorded`);
      setShowCreate(false); setForm(EMPTY_FORM);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to record");
    }
    setSaving(false);
  };

  const resolve = async () => {
    setSaving(true);
    try {
      await axios.put(`${API}/code-response/${showResolve._id}/resolve`,
        { outcome: resolveOutcome, notes: resolveNotes }, authHdr());
      toast.success("Resolved");
      setShowResolve(null); setResolveOutcome("RESOLVED"); setResolveNotes("");
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to resolve");
    }
    setSaving(false);
  };

  return (
    <AdminPage>
      <Hero icon="pi-bolt" color="red"
        title="Code Response Register"
        subtitle="NABH FMS + IPSG.6 — unified register for code BLUE / RED / PINK / GREY / YELLOW / WHITE / BROWN / BLACK." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Open" value={kpis.open} color={C.red} icon="pi-exclamation-circle" />
        <KPI label="Today" value={kpis.today} color={C.amber} icon="pi-clock" />
        <KPI label="Total" value={kpis.total} color={C.blue} icon="pi-list" />
      </div>

      <Card title="Events" icon="pi-table">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
          <select value={filterCode} onChange={e => setFilterCode(e.target.value)}>
            <option value="">All codes</option>
            {CODES.map(c => <option key={c} value={c}>{c} — {CODE_LABEL[c]}</option>)}
          </select>
          {can("compliance.code-response.write") && (
            <PrimaryButton onClick={() => setShowCreate(true)}>+ Record Event</PrimaryButton>
          )}
        </div>
        {loading ? <div>Loading…</div> : rows.length === 0 ? <Empty msg="No code events recorded." /> : (
          <Table
            headers={["#", "Alerted", "Code", "Location", "Responders", "Duration", "Outcome", ""]}
            rows={rows.map(r => [
              r.eventNumber || "—",
              fmtDT(r.alertedAt || r.createdAt),
              <Badge tone={CODE_COLOR[r.code] || "muted"}>{r.code}</Badge>,
              r.location || "—",
              r.responders?.length || 0,
              r.durationMinutes ? `${r.durationMinutes} min` : "—",
              r.outcome
                ? <Badge tone={r.outcome === "RESOLVED" ? "green" : "amber"}>{r.outcome}</Badge>
                : <Badge tone="red">OPEN</Badge>,
              !r.resolvedAt && can("compliance.code-response.write")
                ? <PrimaryButton small onClick={() => setShowResolve(r)}>Resolve</PrimaryButton>
                : null,
            ])}
          />
        )}
      </Card>

      {showCreate && (
        <Modal title="Record Code Event" onClose={() => setShowCreate(false)} size="md">
          <Field label="Code" required>
            <select value={form.code} onChange={e => setForm({...form, code: e.target.value})}>
              {CODES.map(c => <option key={c} value={c}>{c} — {CODE_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field label="Location" required>
            <input value={form.location} onChange={e => setForm({...form, location: e.target.value})}
              placeholder="e.g. ICU Bed 4 / OPD Block / Parking Lot B" />
          </Field>
          <Field label="Patient UHID (for Blue/Pink)">
            <input value={form.patientUHID} onChange={e => setForm({...form, patientUHID: e.target.value.toUpperCase()})} />
          </Field>
          <Field label="Notes">
            <textarea rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <PrimaryButton onClick={create} disabled={saving}>{saving ? "Saving…" : "Save"}</PrimaryButton>
          </div>
        </Modal>
      )}

      {showResolve && (
        <Modal title={`Resolve ${showResolve.eventNumber}`} onClose={() => setShowResolve(null)} size="sm">
          <Field label="Outcome" required>
            <select value={resolveOutcome} onChange={e => setResolveOutcome(e.target.value)}>
              {OUTCOMES.map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Notes">
            <textarea rows={3} value={resolveNotes} onChange={e => setResolveNotes(e.target.value)} />
          </Field>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <PrimaryButton onClick={resolve} disabled={saving}>{saving ? "Saving…" : "Resolve"}</PrimaryButton>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
