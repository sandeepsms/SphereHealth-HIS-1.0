/**
 * RestraintRegisterPage.jsx — R7bx / NABH COP.17
 *
 * Surveyor-facing log of restraint episodes (physical / chemical / both).
 * Emitter is wired and call-ready — no clinical UI hook fires it today,
 * so this view will read empty until a restraint workflow is added. The
 * page is still shown so surveyors get the same "where to look" UX as
 * the other registers.
 *
 *   URL: /compliance/nabh/restraint-register
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, Card, Table, EmptyRow, Badge, C,
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

const RESTRAINT_TYPES = ["", "physical", "chemical", "both"];
const STATUSES        = ["", "Active", "Removed", "Cancelled"];
const tdStyle = { padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12 };

function toCSV(rows, columns) {
  const escape = (v) => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => escape(c.value(r))).join(",")).join("\n");
  return "﻿" + header + "\n" + body;
}
function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function RestraintRegisterPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [restraintType, setRestraintType] = useState("");
  const [status, setStatus] = useState("");

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (search) params.set("search", search);
      if (restraintType) params.set("restraintType", restraintType);
      if (status) params.set("status", status);
      params.set("limit", "500");
      const r = await axios.get(`${API}/registers/nabh/restraint-register?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load Restraint register");
    }
    setLoading(false);
  }, [from, to, search, restraintType, status]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const csvCols = useMemo(() => ([
    { label: "Start",          value: (r) => fmt(r.startTime) },
    { label: "End",            value: (r) => fmt(r.endTime) },
    { label: "Duration (min)", value: (r) => r.durationMinutes ?? "" },
    { label: "UHID",           value: (r) => r.UHID },
    { label: "Patient",        value: (r) => r.patientName },
    { label: "Type",           value: (r) => r.restraintType },
    { label: "Device",         value: (r) => (r.restraintDevice || []).join("; ") },
    { label: "Chemical Agent", value: (r) => r.chemicalAgent },
    { label: "Reason",         value: (r) => r.reason },
    { label: "Reason Cat.",    value: (r) => r.reasonCategory },
    { label: "Monitoring Freq",value: (r) => r.monitoringFrequency },
    { label: "Consent",        value: (r) => r.consentObtained ? "Yes" : "No" },
    { label: "Ordering Dr",    value: (r) => r.orderingDoctor },
    { label: "Applied By",     value: (r) => r.appliedBy },
    { label: "Removed By",     value: (r) => r.removedBy },
    { label: "Adverse Event",  value: (r) => r.adverseEvent ? "Yes" : "No" },
    { label: "Status",         value: (r) => r.status },
  ]), []);

  const exportCSV = () => {
    if (!rows.length) { toast.info("No rows to export"); return; }
    downloadCSV(`Restraint_Register_${from}_to_${to}.csv`, toCSV(rows, csvCols));
  };

  return (
    <AdminPage>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } @page { size: A3 landscape; margin: 10mm; } }`}</style>

      <div className="no-print">
        <Hero
          icon="pi-lock"
          title="Restraint Register"
          subtitle="NABH COP.17 — every physical / chemical restraint episode with reason, monitoring, consent, outcome."
          color="orange"
        />

        <Card title="Filters">
          <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block" }}>From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block" }}>To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block" }}>Search</label>
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="UHID / patient / doctor / reason"
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, minWidth: 240 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block" }}>Type</label>
              <select value={restraintType} onChange={(e) => setRestraintType(e.target.value)}
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                {RESTRAINT_TYPES.map((t) => <option key={t} value={t}>{t || "All"}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block" }}>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                {STATUSES.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => window.print()}
                style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${C.orange}`, background: "#fff", color: C.orange, cursor: "pointer", fontWeight: 600 }}>
                <i className="pi pi-print" style={{ marginRight: 6 }} />Print
              </button>
              <button onClick={exportCSV}
                style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${C.green}`, background: "#fff", color: C.green, cursor: "pointer", fontWeight: 600 }}>
                <i className="pi pi-download" style={{ marginRight: 6 }} />CSV
              </button>
            </div>
          </div>
        </Card>
      </div>

      <Card title={`Restraint Register · ${rows.length} entries`}>
        <Table cols={["Start", "Duration", "UHID", "Patient", "Type", "Device/Agent", "Reason", "Ordering Dr", "Consent", "Adverse", "Status"]}>
          {rows.length === 0 ? (
            <EmptyRow span={11} text={loading ? "Loading…" : "No restraint episodes in this range"} />
          ) : rows.map((r) => (
            <tr key={r._id}>
              <td style={tdStyle}>{fmt(r.startTime)}</td>
              <td style={tdStyle}>{r.durationMinutes != null ? `${r.durationMinutes} min` : "—"}</td>
              <td style={tdStyle}>{r.UHID}</td>
              <td style={tdStyle}>{r.patientName}{r.age || r.sex ? <div style={{ fontSize: 10, color: C.muted }}>{r.age}/{r.sex}</div> : null}</td>
              <td style={tdStyle}>
                <Badge value={r.restraintType} palette={r.restraintType === "chemical" ? "purple" : r.restraintType === "both" ? "red" : "orange"} />
              </td>
              <td style={tdStyle}>{r.restraintType === "physical" ? (r.restraintDevice || []).join(", ") : (r.chemicalAgent || "—")}</td>
              <td style={tdStyle}>{r.reason || "—"}{r.reasonCategory ? <div style={{ fontSize: 10, color: C.muted }}>{r.reasonCategory}</div> : null}</td>
              <td style={tdStyle}>{r.orderingDoctor || "—"}</td>
              <td style={tdStyle}>{r.consentObtained ? <Badge value="YES" palette="green" /> : <Badge value="NO" palette="red" />}</td>
              <td style={tdStyle}>{r.adverseEvent ? <Badge value="YES" palette="red" /> : "—"}</td>
              <td style={tdStyle}><Badge value={r.status} palette={r.status === "Active" ? "orange" : r.status === "Removed" ? "green" : "muted"} /></td>
            </tr>
          ))}
        </Table>
      </Card>
    </AdminPage>
  );
}
