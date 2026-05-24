/**
 * ASARegisterPage.jsx — R7bx / NABH COP.13
 *
 * Surveyor-facing chronological view of anaesthesia cases. The ASA register
 * is auto-populated when a doctor saves a procedure / preop / postop /
 * operative note carrying an ASA grade I–VI. PreOp entries are created
 * first; the matching procedure note flips the row to "Recovered".
 *
 *   URL: /compliance/nabh/asa-register
 *
 * Filters: date range, free-text search (UHID / patient / anaesthetist),
 * ASA grade, status. Print + CSV export.
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

const ASA_GRADES = ["", "I", "II", "III", "IV", "V", "VI"];
const STATUSES = ["", "PreOp", "InProgress", "Recovered", "Cancelled"];

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

export default function ASARegisterPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [asaGrade, setAsaGrade] = useState("");
  const [status, setStatus] = useState("");

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (search) params.set("search", search);
      if (asaGrade) params.set("asaGrade", asaGrade);
      if (status) params.set("status", status);
      params.set("limit", "500");
      const r = await axios.get(`${API}/registers/nabh/asa-register?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load ASA register");
    }
    setLoading(false);
  }, [from, to, search, asaGrade, status]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const csvCols = useMemo(() => ([
    { label: "Date",          value: (r) => fmt(r.occurredAt) },
    { label: "UHID",          value: (r) => r.UHID },
    { label: "Patient",       value: (r) => r.patientName },
    { label: "Age/Sex",       value: (r) => [r.age, r.sex].filter(Boolean).join("/") },
    { label: "ASA",           value: (r) => r.asaGrade + (r.emergencyModifier ? "E" : "") },
    { label: "Anaes. Type",   value: (r) => r.anaesthesiaType },
    { label: "Technique",     value: (r) => r.technique },
    { label: "Airway Plan",   value: (r) => r.airwayPlan },
    { label: "Anaesthetist",  value: (r) => r.anaesthetistName },
    { label: "Fasting (h)",   value: (r) => r.fastingHours ?? "" },
    { label: "Allergies",     value: (r) => (r.allergies || []).join("; ") },
    { label: "Comorbidities", value: (r) => (r.comorbidities || []).join("; ") },
    { label: "Recovery (min)",value: (r) => r.recoveryTimeMinutes ?? "" },
    { label: "Aldrete",       value: (r) => r.aldreteScore ?? "" },
    { label: "Complications", value: (r) => r.complications },
    { label: "Status",        value: (r) => r.status },
  ]), []);

  const exportCSV = () => {
    if (!rows.length) { toast.info("No rows to export"); return; }
    downloadCSV(`ASA_Register_${from}_to_${to}.csv`, toCSV(rows, csvCols));
  };

  return (
    <AdminPage>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } @page { size: A3 landscape; margin: 10mm; } }`}</style>

      <div className="no-print">
        <Hero
          icon="pi-shield"
          title="Anaesthesia (ASA) Register"
          subtitle="NABH COP.13 — ASA classification, anaesthetic plan, intra-op events, recovery for every procedure."
          color="purple"
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
                placeholder="UHID / patient / anaesthetist"
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, minWidth: 240 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block" }}>ASA Grade</label>
              <select value={asaGrade} onChange={(e) => setAsaGrade(e.target.value)}
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                {ASA_GRADES.map((g) => <option key={g} value={g}>{g || "Any"}</option>)}
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
                style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${C.purple}`, background: "#fff", color: C.purple, cursor: "pointer", fontWeight: 600 }}>
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

      <Card title={`ASA Register · ${rows.length} entries`}>
        <Table cols={["Date", "UHID", "Patient", "ASA", "Anaes. Type", "Airway", "Anaesthetist", "Fasting", "Recovery", "Aldrete", "Status"]}>
          {rows.length === 0 ? (
            <EmptyRow span={11} text={loading ? "Loading…" : "No anaesthesia records in this range"} />
          ) : rows.map((r) => (
            <tr key={r._id}>
              <td style={tdStyle}>{fmt(r.occurredAt)}</td>
              <td style={tdStyle}>{r.UHID}</td>
              <td style={tdStyle}>{r.patientName}{r.age || r.sex ? <div style={{ fontSize: 10, color: C.muted }}>{r.age}/{r.sex}</div> : null}</td>
              <td style={tdStyle}>
                <Badge value={`${r.asaGrade}${r.emergencyModifier ? "E" : ""}`}
                  palette={r.asaGrade === "IV" || r.asaGrade === "V" ? "red" : r.asaGrade === "III" ? "orange" : "blue"} />
              </td>
              <td style={tdStyle}>{r.anaesthesiaType || "—"}</td>
              <td style={tdStyle}>{r.airwayPlan || "—"}</td>
              <td style={tdStyle}>{r.anaesthetistName || "—"}</td>
              <td style={tdStyle}>{r.fastingHours != null ? `${r.fastingHours}h` : "—"}</td>
              <td style={tdStyle}>{r.recoveryTimeMinutes != null ? `${r.recoveryTimeMinutes} min` : "—"}</td>
              <td style={tdStyle}>{r.aldreteScore != null ? r.aldreteScore : "—"}</td>
              <td style={tdStyle}>
                <Badge value={r.status} palette={r.status === "Recovered" ? "green" : r.status === "Cancelled" ? "muted" : "blue"} />
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </AdminPage>
  );
}
