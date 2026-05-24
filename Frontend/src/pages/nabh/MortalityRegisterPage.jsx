/**
 * MortalityRegisterPage.jsx — R7bx / NABH COP.18
 *
 * Surveyor-facing mortality log. Auto-populated when a discharge summary
 * is finalized with `conditionOnDischarge === "Expired"` or
 * `dischargeType === "Death"`. Row carries the Bruce category (<24h vs
 * >24h post-admission), MLC flag, post-mortem status, and certifying
 * doctor — everything an NABH surveyor expects for a mortality audit.
 *
 *   URL: /compliance/nabh/mortality-register
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

const MANNERS = ["", "Natural", "Accident", "Suicide", "Homicide", "Pending", "Unknown"];
const BRUCE   = ["", "Less24h", "More24h"];
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

export default function MortalityRegisterPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(isoDaysAgo(90));
  const [to, setTo] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [manner, setManner] = useState("");
  const [bruceCategory, setBruceCategory] = useState("");
  const [mlcOnly, setMlcOnly] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (search) params.set("search", search);
      if (manner) params.set("manner", manner);
      if (bruceCategory) params.set("bruceCategory", bruceCategory);
      if (mlcOnly) params.set("mlc", "true");
      params.set("limit", "500");
      const r = await axios.get(`${API}/registers/nabh/mortality-register?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load Mortality register");
    }
    setLoading(false);
  }, [from, to, search, manner, bruceCategory, mlcOnly]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const csvCols = useMemo(() => ([
    { label: "Mort #",         value: (r) => r.mortalityNumber },
    { label: "Date of Death",  value: (r) => fmt(r.dateOfDeath) },
    { label: "Time",           value: (r) => r.timeOfDeath },
    { label: "UHID",           value: (r) => r.UHID },
    { label: "Patient",        value: (r) => r.patientName },
    { label: "Age/Sex",        value: (r) => [r.age, r.sex].filter(Boolean).join("/") },
    { label: "Place",          value: (r) => r.placeOfDeath },
    { label: "ADM #",          value: (r) => r.admissionNumber },
    { label: "Adm→Death (h)",  value: (r) => r.admissionToDeathHours ?? "" },
    { label: "Bruce",          value: (r) => r.bruceCategory },
    { label: "Primary Cause",  value: (r) => r.primaryCause },
    { label: "Immediate Cause",value: (r) => r.immediateCauseOfDeath },
    { label: "Antecedent",     value: (r) => r.antecedentCauseOfDeath },
    { label: "Underlying",     value: (r) => r.underlyingCause },
    { label: "Manner",         value: (r) => r.manner },
    { label: "MLC",            value: (r) => r.isMLC ? "Yes" : "No" },
    { label: "MLC #",          value: (r) => r.mlcNumber },
    { label: "Post-Mortem",    value: (r) => r.postMortemDone ? "Yes" : (r.postMortemRequiredFlag ? "Required" : "No") },
    { label: "Attending Dr",   value: (r) => r.attendingDoctor },
    { label: "Certifying Dr",  value: (r) => r.certifyingDoctor },
  ]), []);

  const exportCSV = () => {
    if (!rows.length) { toast.info("No rows to export"); return; }
    downloadCSV(`Mortality_Register_${from}_to_${to}.csv`, toCSV(rows, csvCols));
  };

  return (
    <AdminPage>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } @page { size: A3 landscape; margin: 10mm; } }`}</style>

      <div className="no-print">
        <Hero
          icon="pi-times-circle"
          title="Mortality Register"
          subtitle="NABH COP.18 — every in-hospital death with cause, Bruce category, MLC status, post-mortem."
          color="pink"
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
                placeholder="UHID / patient / Mort # / cause"
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, minWidth: 260 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block" }}>Manner</label>
              <select value={manner} onChange={(e) => setManner(e.target.value)}
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                {MANNERS.map((m) => <option key={m} value={m}>{m || "All"}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block" }}>Bruce</label>
              <select value={bruceCategory} onChange={(e) => setBruceCategory(e.target.value)}
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                {BRUCE.map((b) => <option key={b} value={b}>{b || "All"}</option>)}
              </select>
            </div>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={mlcOnly} onChange={(e) => setMlcOnly(e.target.checked)} />
              MLC only
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => window.print()}
                style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${C.pink}`, background: "#fff", color: C.pink, cursor: "pointer", fontWeight: 600 }}>
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

      <Card title={`Mortality Register · ${rows.length} entries`}>
        <Table cols={["Mort #", "Date of Death", "UHID", "Patient", "Adm→Death", "Bruce", "Primary Cause", "Manner", "MLC", "PM", "Certifying Dr"]}>
          {rows.length === 0 ? (
            <EmptyRow span={11} text={loading ? "Loading…" : "No mortality records in this range"} />
          ) : rows.map((r) => (
            <tr key={r._id}>
              <td style={tdStyle}><strong>{r.mortalityNumber || "—"}</strong></td>
              <td style={tdStyle}>{fmt(r.dateOfDeath)}</td>
              <td style={tdStyle}>{r.UHID}</td>
              <td style={tdStyle}>{r.patientName}{r.age || r.sex ? <div style={{ fontSize: 10, color: C.muted }}>{r.age}/{r.sex}</div> : null}</td>
              <td style={tdStyle}>{r.admissionToDeathHours != null ? `${r.admissionToDeathHours}h` : "—"}</td>
              <td style={tdStyle}>{r.bruceCategory ? <Badge value={r.bruceCategory === "Less24h" ? "<24h" : ">24h"} palette={r.bruceCategory === "Less24h" ? "red" : "blue"} /> : "—"}</td>
              <td style={tdStyle}>{r.primaryCause || "—"}</td>
              <td style={tdStyle}><Badge value={r.manner} palette={r.manner === "Natural" ? "blue" : "orange"} /></td>
              <td style={tdStyle}>{r.isMLC ? <Badge value="MLC" palette="orange" /> : "—"}{r.mlcNumber ? <div style={{ fontSize: 10, color: C.muted }}>{r.mlcNumber}</div> : null}</td>
              <td style={tdStyle}>{r.postMortemDone ? <Badge value="DONE" palette="green" /> : r.postMortemRequiredFlag ? <Badge value="REQD" palette="orange" /> : "—"}</td>
              <td style={tdStyle}>{r.certifyingDoctor || r.attendingDoctor || "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </AdminPage>
  );
}
