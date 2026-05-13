// pages/bed/BedMonthlyReportPage.jsx
// NABH MOI.2 monthly bed-utilization report (P3 #16).
// User picks year + month, page calls GET /api/bedss/reports/monthly,
// and renders a printable summary. The "Print / PDF" button uses
// window.print() with a print-only stylesheet so the same view
// works as a paper report and a PDF (via "Save as PDF").

import React, { useEffect, useMemo, useState } from "react";
import { API_ENDPOINTS } from "../../config/api";

const fmt = (n, unit = "") => {
  if (n == null || isNaN(n)) return "—";
  return `${Number(n).toLocaleString("en-IN")}${unit}`;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const BedMonthlyReportPage = () => {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_ENDPOINTS.BEDS}/reports/monthly?year=${year}&month=${month}`)
      .then(r => r.json())
      .then(j => { if (!cancelled) {
        if (j?.success) setData(j.data);
        else setError(j?.message || "Failed to load report");
      }})
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, month]);

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, [now]);

  return (
    <div style={{ padding: "20px 28px", fontFamily: "'DM Sans', sans-serif", background: "#f8fafc", minHeight: "100vh" }}>
      {/* Print stylesheet — hides chrome on paper */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .report-paper { box-shadow: none !important; border: 0 !important; }
          @page { size: A4 portrait; margin: 14mm; }
        }
      `}</style>

      {/* Toolbar */}
      <div className="no-print" style={{
        background: "linear-gradient(135deg, #0d9488, #115e59)",
        borderRadius: 14, padding: "16px 22px", color: "white",
        display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center",
        marginBottom: 18, boxShadow: "0 6px 22px rgba(13,148,136,.25)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="pi pi-file-pdf" style={{ fontSize: 20 }} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Monthly Bed Utilization</div>
            <div style={{ fontSize: 11, opacity: .85 }}>NABH MOI.2 — bed-days, ALOS, turnover, occupancy %</div>
          </div>
        </div>

        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
          style={{ padding: "7px 12px", borderRadius: 7, border: "none", fontWeight: 700, fontSize: 13 }}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}
          style={{ padding: "7px 12px", borderRadius: 7, border: "none", fontWeight: 700, fontSize: 13 }}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <button onClick={() => window.print()}
          style={{ background: "white", color: "#0d9488", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <i className="pi pi-print" /> Print / Save as PDF
        </button>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: 60, color: "#64748b" }}>
          <i className="pi pi-spin pi-spinner" style={{ fontSize: 26 }} /> Generating report…
        </div>
      )}
      {error && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: 14, borderRadius: 10, fontSize: 12 }}>
          {error}
        </div>
      )}

      {data && !loading && (
        <div className="report-paper" style={{
          background: "white", border: "1.5px solid #e2e8f0", borderRadius: 14,
          padding: "28px 32px", boxShadow: "0 4px 18px rgba(0,0,0,.04)",
        }}>
          {/* Title block */}
          <div style={{ textAlign: "center", borderBottom: "2px solid #0f172a", paddingBottom: 14, marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: ".8px" }}>NABH MOI.2 · MANAGEMENT OF INFORMATION</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
              Monthly Bed Utilization Report
            </div>
            <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
              {data.period.monthName} {data.period.year} · {data.period.days} days · {data.totals.totalBeds} beds tracked
            </div>
          </div>

          {/* Totals grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
            <Stat label="Admissions"     value={fmt(data.totals.admissions)} />
            <Stat label="Discharges"     value={fmt(data.totals.discharges)} />
            <Stat label="Bed-Days"       value={fmt(data.totals.bedDays)} />
            <Stat label="ALOS (days)"    value={fmt(data.totals.alos)} accent="#7c3aed" />
            <Stat label="Turnover"       value={fmt(data.totals.turnover)} accent="#0d9488" />
            <Stat label="Occupancy %"    value={`${fmt(data.totals.occupancyPct)}%`} accent={data.totals.occupancyPct > 85 ? "#dc2626" : data.totals.occupancyPct > 65 ? "#d97706" : "#16a34a"} />
            <Stat label="Total Beds"     value={fmt(data.totals.totalBeds)} />
            <Stat label="Avg Stay (h)"   value={data.totals.discharges > 0 ? `${(data.totals.alos * 24).toFixed(0)}h` : "—"} />
          </div>

          {/* By Ward */}
          <h3 style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", margin: "20px 0 10px" }}>
            <i className="pi pi-building" style={{ marginRight: 8, color: "#2563eb" }} />
            Occupancy by Ward
          </h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th style={cellHead}>Ward</th>
                <th style={cellHeadRight}>Beds</th>
                <th style={cellHeadRight}>Bed-Days</th>
                <th style={cellHeadRight}>Occupancy %</th>
              </tr>
            </thead>
            <tbody>
              {data.byWard.length === 0 ? (
                <tr><td colSpan={4} style={{ ...cell, textAlign: "center", color: "#94a3b8" }}>No wards with activity</td></tr>
              ) : data.byWard.map(w => (
                <tr key={w.name}>
                  <td style={cell}>{w.name}</td>
                  <td style={cellRight}>{w.beds}</td>
                  <td style={cellRight}>{fmt(w.bedDays)}</td>
                  <td style={{ ...cellRight, fontWeight: 700, color: w.occupancyPct > 85 ? "#dc2626" : w.occupancyPct > 65 ? "#d97706" : "#16a34a" }}>
                    {fmt(w.occupancyPct)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Footer */}
          <div style={{ marginTop: 36, paddingTop: 14, borderTop: "1px dashed #cbd5e1", display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b" }}>
            <span>Generated by SphereHealth HIS · NABH 5th Edition</span>
            <span>{new Date().toLocaleString("en-IN")}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const Stat = ({ label, value, accent }) => (
  <div style={{
    background: "white", border: "1.5px solid #e2e8f0", borderRadius: 10,
    padding: "12px 14px",
  }}>
    <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 800, color: accent || "#0f172a", marginTop: 4 }}>{value}</div>
  </div>
);

const cellHead = {
  textAlign: "left",
  padding: "8px 10px",
  fontWeight: 800,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: ".5px",
  color: "#475569",
  borderBottom: "1px solid #cbd5e1",
};
const cellHeadRight = { ...cellHead, textAlign: "right" };
const cell = { padding: "8px 10px", borderBottom: "1px solid #f1f5f9", color: "#0f172a" };
const cellRight = { ...cell, textAlign: "right" };

export default BedMonthlyReportPage;
