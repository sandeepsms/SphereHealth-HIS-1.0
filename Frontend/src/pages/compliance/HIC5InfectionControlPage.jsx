/**
 * HIC5InfectionControlPage.jsx — R7eg / NABH HIC.5
 *
 * IC officer's view of ICU Care Bundles compliance over time.
 * Aggregates VAP / CAUTI / CLABSI / DVT / Sepsis / SUP bundle compliance
 * from finalized ICU shift sheets and exposes the trend a NABH surveyor
 * would ask for ("show me the last 3 months of VAP compliance").
 *
 *   URL: /compliance/hic5-infection-control
 *   Permission gate: compliance.read (Admin / Doctor / Nurse / MRD)
 *
 * Data source: GET /api/clinical-audit/icu-bundles/summary
 *              GET /api/clinical-audit/icu-bundles/events (drill-down)
 *
 * Visuals:
 *   - Hero
 *   - Filters strip (from / to / groupBy)
 *   - KPI strip — six bundle cards showing current-period compliance %
 *   - Trend chart — inline SVG line/area for overall compliance over last
 *     6 periods (no Recharts dep — Frontend/package.json uses Chart.js, but
 *     a 60-line SVG is simpler and ships zero extra weight)
 *   - Compliance table — period × bundle, cells coloured by % threshold
 *   - Drill-down modal — list of underlying ClinicalAudit rows for a
 *     given (period, bundle) cell
 *   - CSV export of the table
 *   - Empty state
 *
 * Design language: admin-theme primitives (Hero / Card / KPI / Table /
 * Modal / Badge), inline styles to match the surrounding NABH register
 * pages (R1 inline-style restriction applies only to Reception).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  AdminPage, Hero, Card, KPI, Table, EmptyRow, Empty, Badge, Modal, C,
} from "../../Components/admin-theme";
import { API_BASE_URL as API } from "../../config/api";

// ─── Helpers ────────────────────────────────────────────────────────
const authHdr = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token")}` },
});

const todayISO = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }) : "—";

// ─── Bundle metadata ────────────────────────────────────────────────
// One source of truth — used to render KPIs, table columns, CSV cols,
// modal headers, and the drill-down event filter.
const BUNDLES = [
  { key: "VAP",    label: "VAP",    longLabel: "Ventilator-Associated Pneumonia",            icon: "pi-cloud",         color: C.red    },
  { key: "CAUTI",  label: "CAUTI",  longLabel: "Catheter-Associated UTI",                    icon: "pi-filter",        color: C.amber  },
  { key: "CLABSI", label: "CLABSI", longLabel: "Central Line-Associated Bloodstream Infection", icon: "pi-share-alt",  color: C.purple },
  { key: "DVT",    label: "DVT",    longLabel: "Deep Vein Thrombosis Prophylaxis",           icon: "pi-bolt",          color: C.blue   },
  { key: "SEPSIS", label: "Sepsis", longLabel: "Hour-1 Sepsis Bundle",                       icon: "pi-exclamation-triangle", color: C.orange },
  { key: "SUP",    label: "SUP",    longLabel: "Stress Ulcer Prophylaxis",                   icon: "pi-shield",        color: C.teal   },
];

// Compliance-pct → background / foreground / border. Green ≥95%,
// yellow 80–94%, red <80%. The IC officer learns to read these at a glance.
function pctTone(pct, hasData) {
  if (!hasData) return { bg: "#f1f5f9", fg: C.muted, bd: C.border, label: "—" };
  if (pct >= 95) return { bg: C.greenL,  fg: "#15803d", bd: "#86efac" };
  if (pct >= 80) return { bg: C.amberL,  fg: "#b45309", bd: "#fcd34d" };
  return                  { bg: C.redL,    fg: "#b91c1c", bd: "#fecaca" };
}

function PctBadge({ pct, total }) {
  const hasData = total > 0;
  const t = pctTone(pct, hasData);
  return (
    <span style={{
      display: "inline-block", padding: "3px 9px", borderRadius: 6,
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
      fontSize: 11, fontWeight: 800, minWidth: 56, textAlign: "center",
    }}>
      {hasData ? `${pct.toFixed(1)}%` : "—"}
    </span>
  );
}

// ─── CSV helpers (matches OTRegisterPage pattern) ──────────────────
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

// ─── Inline SVG trend chart ────────────────────────────────────────
// Lightweight area+line chart. No external dep — Recharts isn't in
// package.json (despite what the brief assumed) and Chart.js would be
// overkill for a 6-point series. ~60 lines and renders crisp at any DPR.
function TrendChart({ labels, values, color = C.teal, height = 140 }) {
  const w = 600;          // SVG viewBox width — scales via 100% CSS width
  const h = height;
  const pad = { l: 36, r: 12, t: 12, b: 22 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const n = values.length;
  if (n === 0) {
    return (
      <div style={{ padding: 24, color: C.muted, fontSize: 12, fontStyle: "italic", textAlign: "center" }}>
        No data in this range
      </div>
    );
  }

  // Y always pinned to 0–100 since this is a %
  const yMin = 0, yMax = 100;
  const xStep = n > 1 ? innerW / (n - 1) : 0;
  const yScale = (v) => pad.t + innerH * (1 - (v - yMin) / (yMax - yMin));
  const xScale = (i) => pad.l + i * xStep;

  const linePath = values.map((v, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${xScale(n - 1).toFixed(1)} ${pad.t + innerH} L${xScale(0).toFixed(1)} ${pad.t + innerH} Z`;

  // Y gridlines at 0/50/80/95/100 — same thresholds as the table colour.
  const gridY = [0, 50, 80, 95, 100];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: "block" }}>
      <defs>
        <linearGradient id="hic5TrendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor={color} stopOpacity="0.30" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Grid */}
      {gridY.map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={w - pad.r} y1={yScale(g)} y2={yScale(g)} stroke="#e2e8f0" strokeDasharray="2 3" />
          <text x={pad.l - 6} y={yScale(g) + 4} fontSize="10" textAnchor="end" fill={C.muted}>{g}</text>
        </g>
      ))}

      {/* Area + line */}
      <path d={areaPath} fill="url(#hic5TrendFill)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2" />
      {values.map((v, i) => (
        <g key={i}>
          <circle cx={xScale(i)} cy={yScale(v)} r="3.5" fill="#fff" stroke={color} strokeWidth="2" />
          <title>{labels[i]}: {v.toFixed(1)}%</title>
        </g>
      ))}

      {/* X labels */}
      {labels.map((lbl, i) => (
        <text key={i} x={xScale(i)} y={h - 6} fontSize="10" textAnchor="middle" fill={C.muted}>{lbl}</text>
      ))}
    </svg>
  );
}

// ─── Drill-down modal ──────────────────────────────────────────────
function EventsModal({ open, onClose, period, bundleKey, events, loading }) {
  if (!open) return null;
  const bundle = BUNDLES.find((b) => b.key === bundleKey);
  return (
    <Modal
      title={`${bundle ? bundle.longLabel : "ICU Bundle"} · ${period || ""}`}
      icon={bundle?.icon || "pi-list"}
      color={bundle?.color || C.teal}
      onClose={onClose}
      hideFooter
      size={780}
    >
      {loading ? (
        <Empty text="Loading audit events…" icon="pi-spin pi-spinner" />
      ) : (events.length === 0 ? (
        <Empty text="No audit events recorded for this period" />
      ) : (
        <Table cols={["When", "Event", "UHID", "Patient", "Shift", "Compliance", "Missed Items", "Actor"]} compact>
          {events.map((ev) => {
            const after = ev.after || {};
            const missed = Array.isArray(after.missed) ? after.missed.join(", ") : "—";
            const pct = after.compliancePct ?? after.overallCompliancePct;
            return (
              <tr key={ev._id}>
                <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, fontSize: 11.5 }}>{fmtDateTime(ev.createdAt)}</td>
                <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, fontSize: 11.5 }}>
                  <Badge value={ev.event.replace(/^ICU_BUNDLE_/, "").replace(/_/g, " ")} palette={ev.event.includes("NON_COMPLIANT") ? "inactive" : "approved"} />
                </td>
                <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, fontSize: 11.5 }}>{ev.UHID || "—"}</td>
                <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, fontSize: 11.5 }}>{ev.patientName || "—"}</td>
                <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, fontSize: 11.5 }}>{after.shift || "—"}</td>
                <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, fontSize: 11.5 }}>{pct != null ? `${pct}%` : "—"}</td>
                <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.red }}>{missed}</td>
                <td style={{ padding: "6px 10px", borderBottom: `1px solid ${C.border}`, fontSize: 11.5 }}>{ev.actorName || ev.actorRole || "—"}</td>
              </tr>
            );
          })}
        </Table>
      ))}
    </Modal>
  );
}

// ─── Main page ─────────────────────────────────────────────────────
export default function HIC5InfectionControlPage() {
  const [from, setFrom]       = useState(isoDaysAgo(90));
  const [to, setTo]           = useState(todayISO());
  const [groupBy, setGroupBy] = useState("month");

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  // Drill-down modal state
  const [drillOpen, setDrillOpen]   = useState(false);
  const [drillPeriod, setDrillPeriod] = useState(null);
  const [drillBundle, setDrillBundle] = useState(null);
  const [drillRows, setDrillRows]     = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to)   params.set("to", to);
      params.set("groupBy", groupBy);
      params.set("trendLen", "6");
      const r = await axios.get(`${API}/clinical-audit/icu-bundles/summary?${params}`, authHdr());
      setSummary(r.data?.data || null);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load HIC.5 summary");
      setSummary(null);
    }
    setLoading(false);
  }, [from, to, groupBy]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // Current-period KPI = last bucket in the window
  const currentBucket = useMemo(() => {
    if (!summary?.buckets?.length) return null;
    return summary.buckets[summary.buckets.length - 1];
  }, [summary]);

  // Trend chart values pulled from the trend payload (last 6 periods of overall avg)
  const trendLabels = summary?.trend?.labels || [];
  const trendValues = summary?.trend?.series?.overall || [];

  // CSV columns reflect the table — bundle %, totals, then overall.
  const csvCols = useMemo(() => {
    const cols = [{ label: "Period", value: (b) => b.period }];
    for (const bn of BUNDLES) {
      cols.push(
        { label: `${bn.label} %`,          value: (b) => b[bn.key]?.pct ?? "" },
        { label: `${bn.label} Compliant`,  value: (b) => b[bn.key]?.compliant ?? "" },
        { label: `${bn.label} Total`,      value: (b) => b[bn.key]?.total ?? "" },
      );
    }
    cols.push(
      { label: "Shifts",       value: (b) => b.overall?.shifts ?? "" },
      { label: "Overall Avg %", value: (b) => b.overall?.avgCompliancePct ?? "" },
    );
    return cols;
  }, []);

  const exportCSV = () => {
    if (!summary?.buckets?.length) { toast.info("No data to export"); return; }
    downloadCSV(`HIC5_InfectionControl_${from}_to_${to}_${groupBy}.csv`,
                toCSV(summary.buckets, csvCols));
  };

  // ─── Drill into a cell ────────────────────────────────────────
  const openDrill = useCallback(async (period, bundleKey) => {
    setDrillPeriod(period);
    setDrillBundle(bundleKey);
    setDrillOpen(true);
    setDrillLoading(true);
    setDrillRows([]);

    // Derive a per-period date range. The API treats from/to in UTC but
    // groups in IST — for period strings like "2026-04" / "2026-W18" /
    // "2026-04-15" we approximate by fanning the period into a calendar
    // window slightly bigger than the bucket, then let server-side
    // event filtering handle the rest.
    let pFrom = from, pTo = to;
    try {
      if (groupBy === "day" && /^\d{4}-\d{2}-\d{2}$/.test(period)) {
        pFrom = period; pTo = period;
      } else if (groupBy === "month" && /^\d{4}-\d{2}$/.test(period)) {
        const [yy, mm] = period.split("-").map((n) => parseInt(n, 10));
        pFrom = `${period}-01`;
        const last = new Date(yy, mm, 0).getDate();
        pTo = `${period}-${String(last).padStart(2, "0")}`;
      } else if (groupBy === "week" && /^\d{4}-W\d{2}$/.test(period)) {
        // ISO week → Monday of that week (approximate; the server filters
        // on event/bundleKey so a slightly wider window still returns
        // accurate rows for the cell).
        const [yy, wk] = period.split("-W").map((n) => parseInt(n, 10));
        const jan4 = new Date(yy, 0, 4);
        const dayOfWeek = (jan4.getDay() + 6) % 7;
        const week1Mon = new Date(jan4); week1Mon.setDate(jan4.getDate() - dayOfWeek);
        const start = new Date(week1Mon); start.setDate(week1Mon.getDate() + (wk - 1) * 7);
        const end   = new Date(start);    end.setDate(start.getDate() + 6);
        pFrom = start.toISOString().slice(0, 10);
        pTo   = end.toISOString().slice(0, 10);
      }
    } catch { /* fall back to full range */ }

    try {
      const params = new URLSearchParams();
      params.set("from", pFrom);
      params.set("to",   pTo);
      params.set("bundleKey", bundleKey.toLowerCase());
      params.set("limit", "300");
      const r = await axios.get(`${API}/clinical-audit/icu-bundles/events?${params}`, authHdr());
      setDrillRows(r.data?.data || []);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load drill-down events");
    }
    setDrillLoading(false);
  }, [from, to, groupBy]);

  const closeDrill = () => { setDrillOpen(false); setDrillRows([]); };

  // ─── Cells ────────────────────────────────────────────────────
  const tdCellStyle = { padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 12 };
  const isEmpty = !loading && (!summary?.buckets?.length);

  return (
    <AdminPage>
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } @page { size: A3 landscape; margin: 10mm; } }`}</style>

      <div className="no-print">
        <Hero
          icon="pi-shield"
          title="HIC.5 — Infection Control Register"
          subtitle="ICU Care Bundles Compliance · VAP / CAUTI / CLABSI / DVT / Sepsis / SUP"
          color="teal"
          right={
            <button
              onClick={exportCSV}
              style={{ padding: "8px 14px", borderRadius: 8, border: "1.5px solid rgba(255,255,255,.5)",
                background: "rgba(255,255,255,.18)", color: "#fff", fontWeight: 700, fontSize: 12.5,
                cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <i className="pi pi-download" style={{ fontSize: 11 }} /> Export CSV
            </button>
          }
        />

        <Card title="Filters" color={C.teal} icon="pi-filter">
          <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
            <div>
              <label style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 4 }}>From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 4 }}>To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                style={{ padding: 6, border: `1px solid ${C.border}`, borderRadius: 6 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: "uppercase", display: "block", marginBottom: 4 }}>Group By</label>
              <div style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 7, overflow: "hidden" }}>
                {["month", "week", "day"].map((g) => (
                  <button key={g}
                    onClick={() => setGroupBy(g)}
                    style={{
                      padding: "6px 14px",
                      border: "none",
                      borderRight: g !== "day" ? `1px solid ${C.border}` : "none",
                      background: groupBy === g ? C.teal : "#fff",
                      color: groupBy === g ? "#fff" : C.text,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: "pointer",
                      textTransform: "capitalize",
                    }}
                  >{g}</button>
                ))}
              </div>
            </div>
            {loading && <span style={{ color: C.muted, fontSize: 11.5 }}><i className="pi pi-spin pi-spinner" /> Loading…</span>}
          </div>
        </Card>

        {/* KPI strip — one per bundle, showing the most recent period's pct */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, margin: "12px 0" }}>
          {BUNDLES.map((bn) => {
            const cell = currentBucket?.[bn.key];
            const pct = cell?.pct;
            const total = cell?.total || 0;
            const label = total > 0 ? `${pct?.toFixed(1)}%` : "—";
            return (
              <KPI
                key={bn.key}
                label={`${bn.label} · ${bn.longLabel}`}
                value={label}
                icon={bn.icon}
                color={bn.color}
              />
            );
          })}
        </div>

        {/* Trend chart — overall compliance over last 6 periods */}
        <Card title={`Overall Compliance Trend · last ${trendLabels.length || 0} ${groupBy}${(trendLabels.length || 0) === 1 ? "" : "s"}`} color={C.teal} icon="pi-chart-line">
          <TrendChart labels={trendLabels} values={trendValues} color={C.teal} />
        </Card>

        {/* Compliance table — period × bundle */}
        <div style={{ marginTop: 12 }}>
          <Card title={`Compliance by Period · ${summary?.buckets?.length || 0} ${groupBy}${(summary?.buckets?.length || 0) === 1 ? "" : "s"}`} color={C.teal} icon="pi-table">
            <Table
              cols={["Period", ...BUNDLES.map((b) => b.label), "Shifts", "Overall %"]}
            >
              {isEmpty ? (
                <EmptyRow span={BUNDLES.length + 3} text="No finalized ICU shifts in this range" />
              ) : (
                (summary?.buckets || []).map((b) => (
                  <tr key={b.period}>
                    <td style={{ ...tdCellStyle, fontWeight: 700 }}>{b.period}</td>
                    {BUNDLES.map((bn) => {
                      const c = b[bn.key] || {};
                      return (
                        <td key={bn.key} style={tdCellStyle}>
                          <button
                            onClick={() => openDrill(b.period, bn.key)}
                            title={`${c.compliant || 0}/${c.total || 0} compliant · click for events`}
                            style={{ background: "none", border: "none", padding: 0, cursor: c.total ? "pointer" : "default" }}
                          >
                            <PctBadge pct={c.pct || 0} total={c.total || 0} />
                          </button>
                          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                            {c.compliant || 0}/{c.total || 0}
                          </div>
                        </td>
                      );
                    })}
                    <td style={tdCellStyle}>{b.overall?.shifts || 0}</td>
                    <td style={tdCellStyle}>
                      <PctBadge pct={b.overall?.avgCompliancePct || 0} total={b.overall?.shifts || 0} />
                    </td>
                  </tr>
                ))
              )}
            </Table>
          </Card>
        </div>

        <div style={{ marginTop: 12, fontSize: 11, color: C.muted, fontStyle: "italic" }}>
          Compliance band: <span style={{ color: "#15803d", fontWeight: 700 }}>green ≥95%</span>
          <span style={{ margin: "0 8px" }}>·</span>
          <span style={{ color: "#b45309", fontWeight: 700 }}>amber 80–94%</span>
          <span style={{ margin: "0 8px" }}>·</span>
          <span style={{ color: "#b91c1c", fontWeight: 700 }}>red &lt;80%</span>
          <span style={{ margin: "0 8px" }}>·</span>
          Per-bundle counts skip shifts where the bundle was marked Not Applicable.
        </div>
      </div>

      <EventsModal
        open={drillOpen}
        onClose={closeDrill}
        period={drillPeriod}
        bundleKey={drillBundle}
        events={drillRows}
        loading={drillLoading}
      />
    </AdminPage>
  );
}
