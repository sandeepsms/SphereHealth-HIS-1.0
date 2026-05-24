/**
 * OTRegisterPage.jsx — R7bx / NABH COP.10
 *
 * Surveyor-facing chronological view of operating-theatre cases. The OT
 * register is auto-populated from doctor orders flagged `requiresOT=true`
 * and from procedure-note saves (which update the row to Completed). This
 * page is read-only — drill-into-the-source for amendments.
 *
 *   URL: /compliance/nabh/ot-register
 *
 * Filters: date range (from/to), free-text search across UHID / patient /
 * OT # / surgery / surgeon, status filter (Scheduled / Completed / etc.),
 * emergency-cases toggle. Tabular display + Print + CSV export.
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

const STATUSES = ["", "Scheduled", "InProgress", "Completed", "Cancelled"];

const tdStyle = { padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12 };

// Tiny helper — convert an array of records into CSV. Quoted, escaped, BOM
// so Excel respects UTF-8.
function toCSV(rows, columns) {
  const escape = (v) => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
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

export default function OTRegisterPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [emergencyOnly, setEmergencyOnly] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to)   params.set("to", to);
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (emergencyOnly) params.set("emergencyOnly", "true");
      params.set("limit", "500");
      const r = await axios.get(`${API}/registers/nabh/ot-register?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load OT register");
    }
    setLoading(false);
  }, [from, to, search, status, emergencyOnly]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const csvCols = useMemo(() => ([
    { label: "OT #",            value: (r) => r.otNumber },
    { label: "Scheduled",       value: (r) => fmt(r.scheduledAt) },
    { label: "Started",         value: (r) => fmt(r.startTime) },
    { label: "Ended",           value: (r) => fmt(r.endTime) },
    { label: "Duration (min)",  value: (r) => r.durationMinutes ?? "" },
    { label: "UHID",            value: (r) => r.UHID },
    { label: "Patient",         value: (r) => r.patientName },
    { label: "Age/Sex",         value: (r) => [r.age, r.sex].filter(Boolean).join("/") },
    { label: "Surgery",         value: (r) => r.surgeryName },
    { label: "Speciality",      value: (r) => r.surgicalSpeciality },
    { label: "Theatre",         value: (r) => r.otTheatre },
    { label: "Surgeon",         value: (r) => r.surgeonName },
    { label: "Anaesthetist",    value: (r) => r.anaesthetistName },
    { label: "Anaes. Type",     value: (r) => r.anaesthesiaType },
    { label: "ASA",             value: (r) => r.asaGrade },
    { label: "Emergency",       value: (r) => r.emergencyCase ? "Yes" : "No" },
    { label: "Status",          value: (r) => r.status },
    { label: "Complications",   value: (r) => r.complications },
  ]), []);

  const exportCSV = () => {
    if (!rows.length) { toast.info("No rows to export"); return; }
    downloadCSV(`OT_Register_${from}_to_${to}.csv`, toCSV(rows, csvCols));
  };

  return (
    <AdminPage>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } @page { size: A3 landscape; margin: 10mm; } }`}</style>

      <div className="no-print">
        <Hero
          icon="pi-briefcase"
          title="OT Register"
          subtitle="NABH COP.10 — chronological log of all surgical / procedural cases conducted in operating theatres."
          color="blue"
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
                placeholder="UHID / patient / OT # / surgery / surgeon"
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, minWidth: 280 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block" }}>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                {STATUSES.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
              </select>
            </div>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={emergencyOnly} onChange={(e) => setEmergencyOnly(e.target.checked)} />
              Emergency cases only
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => window.print()}
                style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${C.blue}`, background: "#fff", color: C.blue, cursor: "pointer", fontWeight: 600 }}>
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

      <Card title={`OT Register · ${rows.length} entries`}>
        <Table cols={["OT #", "Scheduled", "Duration", "UHID", "Patient", "Surgery", "Surgeon", "Anaesthetist", "ASA", "Status", "Emergency"]}>
          {rows.length === 0 ? (
            <EmptyRow span={11} text={loading ? "Loading…" : "No OT cases in this range"} />
          ) : rows.map((r) => (
            <tr key={r._id}>
              <td style={tdStyle}><strong>{r.otNumber || "—"}</strong></td>
              <td style={tdStyle}>{fmt(r.scheduledAt || r.occurredAt)}</td>
              <td style={tdStyle}>{r.durationMinutes != null ? `${r.durationMinutes} min` : "—"}</td>
              <td style={tdStyle}>{r.UHID}</td>
              <td style={tdStyle}>{r.patientName}</td>
              <td style={tdStyle}>{r.surgeryName}{r.surgicalSpeciality ? <div style={{ fontSize: 10, color: C.muted }}>{r.surgicalSpeciality}</div> : null}</td>
              <td style={tdStyle}>{r.surgeonName || "—"}</td>
              <td style={tdStyle}>{r.anaesthetistName || "—"}{r.anaesthesiaType ? <div style={{ fontSize: 10, color: C.muted }}>{r.anaesthesiaType}</div> : null}</td>
              <td style={tdStyle}>{r.asaGrade ? <Badge value={r.asaGrade} palette="blue" /> : "—"}</td>
              <td style={tdStyle}>
                <Badge value={r.status} palette={r.status === "Completed" ? "green" : r.status === "Cancelled" ? "muted" : "blue"} />
              </td>
              <td style={tdStyle}>{r.emergencyCase ? <Badge value="STAT" palette="red" /> : "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </AdminPage>
  );
}
