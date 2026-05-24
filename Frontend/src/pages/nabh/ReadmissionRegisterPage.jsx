/**
 * ReadmissionRegisterPage.jsx — R7bx / NABH COP.16
 *
 * Surveyor-facing view of unplanned readmissions within the configured
 * window (default 30 days). Auto-populated when a new admission is created
 * for a UHID whose previous discharge falls inside the window. Rows where
 * the diagnosis matches the prior admission carry a "Same Dx" flag —
 * NABH treats these as quality-of-care indicators.
 *
 *   URL: /compliance/nabh/readmission-register
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
const fmtD = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const TYPES = ["", "Unplanned", "Planned", "Elective"];
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

export default function ReadmissionRegisterPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(isoDaysAgo(90));
  const [to, setTo] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [readmissionType, setReadmissionType] = useState("");
  const [sameDiagnosis, setSameDiagnosis] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (search) params.set("search", search);
      if (readmissionType) params.set("readmissionType", readmissionType);
      if (sameDiagnosis) params.set("sameDiagnosis", "true");
      params.set("limit", "500");
      const r = await axios.get(`${API}/registers/nabh/readmission-register?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load Readmission register");
    }
    setLoading(false);
  }, [from, to, search, readmissionType, sameDiagnosis]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const csvCols = useMemo(() => ([
    { label: "Current ADM #",  value: (r) => r.currentAdmissionNumber },
    { label: "Current Date",   value: (r) => fmt(r.currentAdmissionDate) },
    { label: "UHID",           value: (r) => r.UHID },
    { label: "Patient",        value: (r) => r.patientName },
    { label: "Age/Sex",        value: (r) => [r.age, r.sex].filter(Boolean).join("/") },
    { label: "Current Dx",     value: (r) => r.currentDiagnosis },
    { label: "Current Dept",   value: (r) => r.currentDepartment },
    { label: "Attending Dr",   value: (r) => r.currentAttendingDoctor },
    { label: "Prev ADM #",     value: (r) => r.previousAdmissionNumber },
    { label: "Prev Discharge", value: (r) => fmtD(r.previousDischargeDate) },
    { label: "Prev Dx",        value: (r) => r.previousDiagnosis },
    { label: "Prev Discharge Type", value: (r) => r.previousDischargeType },
    { label: "Days Since",     value: (r) => r.daysSinceDischarge },
    { label: "Type",           value: (r) => r.readmissionType },
    { label: "Same Dx",        value: (r) => r.sameDiagnosis ? "Yes" : "No" },
    { label: "Status",         value: (r) => r.status },
  ]), []);

  const exportCSV = () => {
    if (!rows.length) { toast.info("No rows to export"); return; }
    downloadCSV(`Readmission_Register_${from}_to_${to}.csv`, toCSV(rows, csvCols));
  };

  return (
    <AdminPage>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } @page { size: A3 landscape; margin: 10mm; } }`}</style>

      <div className="no-print">
        <Hero
          icon="pi-reply"
          title="Readmission Register"
          subtitle="NABH COP.16 — patients readmitted within 30 days of prior discharge. Same-diagnosis cases flagged."
          color="amber"
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
                placeholder="UHID / patient / ADM # / diagnosis"
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, minWidth: 260 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block" }}>Type</label>
              <select value={readmissionType} onChange={(e) => setReadmissionType(e.target.value)}
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                {TYPES.map((t) => <option key={t} value={t}>{t || "All"}</option>)}
              </select>
            </div>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={sameDiagnosis} onChange={(e) => setSameDiagnosis(e.target.checked)} />
              Same diagnosis only
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => window.print()}
                style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${C.amber}`, background: "#fff", color: C.amber, cursor: "pointer", fontWeight: 600 }}>
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

      <Card title={`Readmission Register · ${rows.length} entries`}>
        <Table cols={["Current ADM", "Date", "UHID", "Patient", "Current Dx", "Prev ADM", "Prev Discharge", "Days", "Type", "Same Dx", "Status"]}>
          {rows.length === 0 ? (
            <EmptyRow span={11} text={loading ? "Loading…" : "No readmissions in this range"} />
          ) : rows.map((r) => (
            <tr key={r._id}>
              <td style={tdStyle}><strong>{r.currentAdmissionNumber || "—"}</strong></td>
              <td style={tdStyle}>{fmt(r.currentAdmissionDate)}</td>
              <td style={tdStyle}>{r.UHID}</td>
              <td style={tdStyle}>{r.patientName}{r.age || r.sex ? <div style={{ fontSize: 10, color: C.muted }}>{r.age}/{r.sex}</div> : null}</td>
              <td style={tdStyle}>{r.currentDiagnosis || "—"}{r.currentDepartment ? <div style={{ fontSize: 10, color: C.muted }}>{r.currentDepartment}</div> : null}</td>
              <td style={tdStyle}>{r.previousAdmissionNumber || "—"}</td>
              <td style={tdStyle}>{fmtD(r.previousDischargeDate)}{r.previousDischargeType ? <div style={{ fontSize: 10, color: C.muted }}>{r.previousDischargeType}</div> : null}</td>
              <td style={tdStyle}>
                <Badge value={`${r.daysSinceDischarge}d`} palette={r.daysSinceDischarge <= 7 ? "red" : r.daysSinceDischarge <= 14 ? "orange" : "blue"} />
              </td>
              <td style={tdStyle}>
                <Badge value={r.readmissionType} palette={r.readmissionType === "Unplanned" ? "orange" : "blue"} />
              </td>
              <td style={tdStyle}>{r.sameDiagnosis ? <Badge value="YES" palette="red" /> : "—"}</td>
              <td style={tdStyle}><Badge value={r.status} palette={r.status === "Closed" ? "green" : "blue"} /></td>
            </tr>
          ))}
        </Table>
      </Card>
    </AdminPage>
  );
}
