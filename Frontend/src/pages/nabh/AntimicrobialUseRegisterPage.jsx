/**
 * AntimicrobialUseRegisterPage.jsx — R7bx / NABH MOM.7 (AMS)
 *
 * Surveyor-facing AMS register — every antibiotic prescription auto-
 * populated from doctor Medication orders. Row carries the WHO AWaRe
 * classification (Access / Watch / Reserve), indication type (Empirical /
 * Targeted / Prophylactic), culture-sent flag, and start / stop dates.
 *
 *   URL: /compliance/nabh/antimicrobial-register
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

const AWARE_TIERS = ["", "Access", "Watch", "Reserve"];
const INDICATIONS = ["", "Empirical", "Targeted", "Prophylactic"];
const STATUSES    = ["", "Active", "Completed", "Discontinued"];
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

export default function AntimicrobialUseRegisterPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(todayISO());
  const [search, setSearch] = useState("");
  const [aware, setAware] = useState("");
  const [indicationType, setIndicationType] = useState("");
  const [status, setStatus] = useState("");
  const [prophylacticOnly, setProphylacticOnly] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (search) params.set("search", search);
      if (aware) params.set("aware", aware);
      if (indicationType) params.set("indicationType", indicationType);
      if (status) params.set("status", status);
      if (prophylacticOnly) params.set("prophylactic", "true");
      params.set("limit", "500");
      const r = await axios.get(`${API}/registers/nabh/antimicrobial-register?${params}`, authHdr());
      setRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load AMU register");
    }
    setLoading(false);
  }, [from, to, search, aware, indicationType, status, prophylacticOnly]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const csvCols = useMemo(() => ([
    { label: "Started",       value: (r) => fmt(r.startedAt) },
    { label: "UHID",          value: (r) => r.UHID },
    { label: "Patient",       value: (r) => r.patientName },
    { label: "Age/Sex",       value: (r) => [r.age, r.sex].filter(Boolean).join("/") },
    { label: "Ward",          value: (r) => r.ward },
    { label: "Antibiotic",    value: (r) => r.antibiotic },
    { label: "Class",         value: (r) => r.antibioticClass },
    { label: "AWaRe",         value: (r) => r.watchAccessReserve },
    { label: "Dose",          value: (r) => r.dose },
    { label: "Route",         value: (r) => r.route },
    { label: "Frequency",     value: (r) => r.frequency },
    { label: "Duration",      value: (r) => r.duration },
    { label: "Indication",    value: (r) => r.indication },
    { label: "Indication Type",value: (r) => r.indicationType },
    { label: "Prophylactic",  value: (r) => r.prophylactic ? "Yes" : "No" },
    { label: "Culture Sent",  value: (r) => r.cultureSent ? "Yes" : "No" },
    { label: "Ordering Dr",   value: (r) => r.orderingDoctor },
    { label: "Status",        value: (r) => r.status },
  ]), []);

  const exportCSV = () => {
    if (!rows.length) { toast.info("No rows to export"); return; }
    downloadCSV(`Antimicrobial_Register_${from}_to_${to}.csv`, toCSV(rows, csvCols));
  };

  return (
    <AdminPage>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } @page { size: A3 landscape; margin: 10mm; } }`}</style>

      <div className="no-print">
        <Hero
          icon="pi-stop-circle"
          title="Antimicrobial Use Register"
          subtitle="NABH MOM.7 / AMS — every antibiotic prescription with WHO AWaRe tier, indication, culture status."
          color="teal"
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
                placeholder="UHID / patient / antibiotic / indication"
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6, minWidth: 260 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block" }}>AWaRe</label>
              <select value={aware} onChange={(e) => setAware(e.target.value)}
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                {AWARE_TIERS.map((t) => <option key={t} value={t}>{t || "All"}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block" }}>Indication</label>
              <select value={indicationType} onChange={(e) => setIndicationType(e.target.value)}
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                {INDICATIONS.map((t) => <option key={t} value={t}>{t || "All"}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: C.muted, display: "block" }}>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }}>
                {STATUSES.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
              </select>
            </div>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={prophylacticOnly} onChange={(e) => setProphylacticOnly(e.target.checked)} />
              Prophylactic only
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => window.print()}
                style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${C.teal}`, background: "#fff", color: C.teal, cursor: "pointer", fontWeight: 600 }}>
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

      <Card title={`Antimicrobial Use Register · ${rows.length} entries`}>
        <Table cols={["Started", "UHID", "Patient", "Antibiotic", "AWaRe", "Dose / Route / Freq", "Duration", "Indication", "Culture", "Status", "Ordering Dr"]}>
          {rows.length === 0 ? (
            <EmptyRow span={11} text={loading ? "Loading…" : "No antimicrobial orders in this range"} />
          ) : rows.map((r) => (
            <tr key={r._id}>
              <td style={tdStyle}>{fmt(r.startedAt)}</td>
              <td style={tdStyle}>{r.UHID}</td>
              <td style={tdStyle}>{r.patientName}{r.ward ? <div style={{ fontSize: 10, color: C.muted }}>{r.ward}</div> : null}</td>
              <td style={tdStyle}><strong>{r.antibiotic}</strong>{r.antibioticClass ? <div style={{ fontSize: 10, color: C.muted }}>{r.antibioticClass}</div> : null}</td>
              <td style={tdStyle}>
                {r.watchAccessReserve
                  ? <Badge value={r.watchAccessReserve}
                      palette={r.watchAccessReserve === "Reserve" ? "red" : r.watchAccessReserve === "Watch" ? "orange" : "green"} />
                  : "—"}
              </td>
              <td style={tdStyle}>{[r.dose, r.route, r.frequency].filter(Boolean).join(" · ") || "—"}</td>
              <td style={tdStyle}>{r.duration || "—"}</td>
              <td style={tdStyle}>{r.indication || "—"}{r.indicationType ? <div style={{ fontSize: 10, color: C.muted }}>{r.indicationType}{r.prophylactic ? " (PROPHYL)" : ""}</div> : null}</td>
              <td style={tdStyle}>{r.cultureSent ? <Badge value="SENT" palette={r.cultureResultPending ? "orange" : "green"} /> : "—"}</td>
              <td style={tdStyle}>
                <Badge value={r.status} palette={r.status === "Active" ? "orange" : r.status === "Completed" ? "green" : "muted"} />
              </td>
              <td style={tdStyle}>{r.orderingDoctor || "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </AdminPage>
  );
}
