/**
 * RCARegisterPage.jsx — R7gw-B9-B9-T03 / NABH QPS.1 + AAC.7
 *
 * Root-Cause Analysis register — Quality / Patient-Safety committee surface.
 * Pre-populated when a sentinel event is logged (linkedSentinelId set,
 * status Initiated). QPS chair files manual entries for serious near-miss
 * or recurrent-deviation triggers.
 *
 *   URL: /compliance/nabh-registers/rca
 *
 * Layout:
 *   • Filter strip (q text, status, dateRange).
 *   • Table with key columns (initiatedAt, status, linkedSentinelId,
 *     contributing factors count, root causes count, CAPA count, closed?).
 *   • "Add Entry" → modal POST for a manual RCA.
 *   • Empty-state placeholder.
 *
 * Role-gated: Admin / Doctor / Nurse / MRD (matches compliance.read tier).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, Card, Table, EmptyRow, Badge, Modal, Field,
  PrimaryButton, SearchInput, C,
} from "../../Components/admin-theme";
import { API_BASE_URL as API } from "../../config/api";

const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` },
});

const fmt = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const STATUSES = ["", "Open", "Initiated", "InProgress", "Closed"];
const STATUS_COLOR = {
  Open: "blue",
  Initiated: "yellow",
  InProgress: "orange",
  Closed: "green",
};

const EMPTY_FORM = {
  UHID: "",
  patientName: "",
  initiatedAt: new Date().toISOString().slice(0, 16),
  initiatedByEmpId: "",
  initiatedByName: "",
  teamMembers: "",            // newline-separated → array on submit
  contributingFactors: "",    // newline-separated
  rootCauses: "",             // newline-separated
  correctiveActions: "",      // newline-separated
  preventiveActions: "",      // newline-separated
  linkedSentinelId: "",
  status: "Open",
};

const tdStyle = { padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12 };

export default function RCARegisterPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(isoDaysAgo(90));
  const [to, setTo] = useState(todayISO());
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("startDate", from);
      if (to)   params.set("endDate", to);
      if (q)    params.set("q", q);
      if (status) params.set("status", status);
      params.set("limit", "500");
      const r = await axios.get(`${API}/rca-register?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load RCA register");
    }
    setLoading(false);
  }, [from, to, q, status]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const kpis = useMemo(() => {
    const open = rows.filter((r) => r.status === "Open").length;
    const initiated = rows.filter((r) => r.status === "Initiated").length;
    const inProgress = rows.filter((r) => r.status === "InProgress").length;
    const closed = rows.filter((r) => r.status === "Closed").length;
    return { open, initiated, inProgress, closed, total: rows.length };
  }, [rows]);

  const splitLines = (s) =>
    String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);

  const create = async () => {
    if (!form.initiatedAt) {
      toast.warn("Initiated date is required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        UHID: form.UHID || "",
        patientName: form.patientName || "",
        initiatedAt: form.initiatedAt,
        initiatedByEmpId: form.initiatedByEmpId || "",
        initiatedByName: form.initiatedByName || "",
        teamMembers: splitLines(form.teamMembers),
        contributingFactors: splitLines(form.contributingFactors),
        rootCauses: splitLines(form.rootCauses),
        correctiveActions: splitLines(form.correctiveActions),
        preventiveActions: splitLines(form.preventiveActions),
        linkedSentinelId: form.linkedSentinelId || null,
        status: form.status || "Open",
        sourceType: "Manual",
      };
      await axios.post(`${API}/rca-register`, body, authHdr());
      toast.success("RCA recorded");
      setShowCreate(false);
      setForm(EMPTY_FORM);
      fetchList();
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to record RCA");
    }
    setSaving(false);
  };

  return (
    <AdminPage>
      <Hero icon="pi-search-plus" color="purple"
        title="Root Cause Analysis Register"
        subtitle="NABH QPS.1 — every sentinel event opens an RCA workflow; QPS committee files findings + CAPA." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 14 }}>
        <Card title="Open"        color={C.blue}>   <div style={{ fontSize: 24, fontWeight: 700 }}>{kpis.open}</div></Card>
        <Card title="Initiated"   color={C.yellow || "#eab308"}> <div style={{ fontSize: 24, fontWeight: 700 }}>{kpis.initiated}</div></Card>
        <Card title="In Progress" color={C.orange || "#f97316"}> <div style={{ fontSize: 24, fontWeight: 700 }}>{kpis.inProgress}</div></Card>
        <Card title="Closed"      color={C.green}>  <div style={{ fontSize: 24, fontWeight: 700 }}>{kpis.closed}</div></Card>
        <Card title="Total"       color={C.muted}>  <div style={{ fontSize: 24, fontWeight: 700 }}>{kpis.total}</div></Card>
      </div>

      <Card title="RCA Workflows" color={C.purple || "#9333ea"} icon="pi-search-plus"
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }} />
            <span style={{ fontSize: 11, color: C.muted }}>→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }} />
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="UHID / name / cause…" />
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              style={{ padding: "5px 8px", borderRadius: 5, border: `1px solid ${C.border}`, fontSize: 12 }}>
              {STATUSES.map((s) => <option key={s} value={s}>{s || "All statuses"}</option>)}
            </select>
            <PrimaryButton label="+ Add RCA" icon="pi-plus" color={C.purple || "#9333ea"}
              onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }} />
          </div>
        }>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: C.muted, fontSize: 12 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>
            <i className="pi pi-search-plus" style={{ fontSize: 22, marginBottom: 8, display: "block" }} />
            No RCA workflows on file in this window.
          </div>
        ) : (
          <Table cols={[
            { label: "Initiated" }, { label: "UHID" }, { label: "Patient" },
            { label: "Sentinel" }, { label: "Initiated By" },
            { label: "Team" }, { label: "Root Causes" }, { label: "CAPA" },
            { label: "Status" }, { label: "Closed" },
          ]}>
            {rows.map((r) => (
              <tr key={r._id}>
                <td style={tdStyle}>{fmt(r.initiatedAt)}</td>
                <td style={{ ...tdStyle, fontFamily: "monospace" }}>{r.UHID || "—"}</td>
                <td style={tdStyle}>{r.patientName || "—"}</td>
                <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 10 }}>
                  {r.linkedSentinelId ? String(r.linkedSentinelId).slice(-6) : "—"}
                </td>
                <td style={tdStyle}>
                  {[r.initiatedByName, r.initiatedByEmpId].filter(Boolean).join(" / ") || "—"}
                </td>
                <td style={tdStyle}>
                  {Array.isArray(r.teamMembers) ? r.teamMembers.length : 0}
                </td>
                <td style={tdStyle}>
                  {Array.isArray(r.rootCauses) ? r.rootCauses.length : 0}
                </td>
                <td style={tdStyle}>
                  {(Array.isArray(r.correctiveActions) ? r.correctiveActions.length : 0) +
                   (Array.isArray(r.preventiveActions) ? r.preventiveActions.length : 0)}
                </td>
                <td style={tdStyle}>
                  <Badge value={r.status} palette={STATUS_COLOR[r.status] || "muted"} />
                </td>
                <td style={tdStyle}>{fmt(r.closedAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}
          title="Open new RCA"
          color={C.purple || "#9333ea"}
          onSubmit={create}
          submitting={saving}
          submitLabel="Open RCA"
          size={760}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Initiated at" required>
              <input type="datetime-local" value={form.initiatedAt}
                onChange={(e) => setForm({ ...form, initiatedAt: e.target.value })} />
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="UHID (optional)">
              <input value={form.UHID} onChange={(e) => setForm({ ...form, UHID: e.target.value.toUpperCase() })}
                placeholder="Optional — systemic RCAs have no patient" />
            </Field>
            <Field label="Patient name (optional)">
              <input value={form.patientName}
                onChange={(e) => setForm({ ...form, patientName: e.target.value })} />
            </Field>
            <Field label="Initiated by (Emp ID)">
              <input value={form.initiatedByEmpId}
                onChange={(e) => setForm({ ...form, initiatedByEmpId: e.target.value })} />
            </Field>
            <Field label="Initiated by (Name)">
              <input value={form.initiatedByName}
                onChange={(e) => setForm({ ...form, initiatedByName: e.target.value })} />
            </Field>
            <Field label="Linked Sentinel ID (optional)">
              <input value={form.linkedSentinelId}
                onChange={(e) => setForm({ ...form, linkedSentinelId: e.target.value })}
                placeholder="ObjectId of SentinelEventRegister row" />
            </Field>
            <div />
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Team members (one per line)">
                <textarea rows={3} value={form.teamMembers}
                  onChange={(e) => setForm({ ...form, teamMembers: e.target.value })}
                  placeholder="Dr. Mehta — Chair&#10;Sister Kavita&#10;Pharmacist Ravi" />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Contributing factors (one per line)">
                <textarea rows={3} value={form.contributingFactors}
                  onChange={(e) => setForm({ ...form, contributingFactors: e.target.value })} />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Root causes (one per line)">
                <textarea rows={3} value={form.rootCauses}
                  onChange={(e) => setForm({ ...form, rootCauses: e.target.value })} />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Corrective actions (one per line)">
                <textarea rows={3} value={form.correctiveActions}
                  onChange={(e) => setForm({ ...form, correctiveActions: e.target.value })} />
              </Field>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Preventive actions (one per line)">
                <textarea rows={3} value={form.preventiveActions}
                  onChange={(e) => setForm({ ...form, preventiveActions: e.target.value })} />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </AdminPage>
  );
}
