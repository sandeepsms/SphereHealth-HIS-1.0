import React, { useState, useEffect, useCallback } from "react";
import "./clinical-forms.css";
import { toast } from "react-toastify";
import { getVitalSheet, saveVitalSheet } from "../../Services/vital/vitalService";

/* ── Design tokens (matching NursingNotes) ── */
const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0", text: "#0f172a", muted: "#64748b",
  primary: "#0f766e", primaryL: "#f0fdfa",
  green: "#16a34a", greenL: "#dcfce7",
  amber: "#d97706", amberL: "#fffbeb",
  red: "#dc2626", redL: "#fef2f2",
  blue: "#1d4ed8", blueL: "#eff6ff", blueB: "#bfdbfe",
  teal: "#0d9488", tealL: "#f0fdfa",
  slate: "#1e293b",
};

/* ── Abnormal ranges ── */
const RANGES = {
  pulse:  { lo: 60,  hi: 100 },
  temp:   { lo: 97,  hi: 99.5 },
  spo2:   { lo: 95,  hi: 100 },
  rr:     { lo: 12,  hi: 20 },
  bsl:    { lo: 70,  hi: 140 },
  sbp:    { lo: 90,  hi: 140 },
  dbp:    { lo: 60,  hi: 90 },
  pain:   { lo: 0,   hi: 3 },
};

function isAbnormal(key, val) {
  if (!val || val === "") return false;
  const n = parseFloat(val);
  if (isNaN(n)) return false;
  const r = RANGES[key];
  return r ? n < r.lo || n > r.hi : false;
}

/* ── MEWS calculation ── */
function calcMEWS({ rr, spo2, temp, sbp, hr }) {
  let s = 0;
  const n = parseFloat;
  // Resp rate
  const r = n(rr);
  if (!isNaN(r)) { if (r < 9) s += 3; else if (r <= 11) s += 1; else if (r <= 20) s += 0; else if (r <= 24) s += 2; else s += 3; }
  // SpO2
  const sp = n(spo2);
  if (!isNaN(sp)) { if (sp < 85) s += 3; else if (sp < 90) s += 2; else if (sp < 94) s += 1; }
  // Temp
  const t = n(temp);
  if (!isNaN(t)) { if (t < 95) s += 2; else if (t < 96.8) s += 1; else if (t > 101.3) s += 2; else if (t > 100.4) s += 1; }
  // SBP
  const b = n(sbp);
  if (!isNaN(b)) { if (b < 70) s += 3; else if (b < 80) s += 2; else if (b < 100) s += 1; else if (b > 179) s += 3; else if (b > 159) s += 2; else if (b > 139) s += 1; }
  // HR
  const h = n(hr);
  if (!isNaN(h)) { if (h < 40) s += 3; else if (h < 50) s += 1; else if (h <= 100) s += 0; else if (h <= 110) s += 1; else if (h <= 129) s += 2; else s += 3; }
  return s;
}

function mewsBand(score) {
  if (score >= 7) return { color: C.red,   bg: "#fef2f2", label: "Critical",  icon: "pi-exclamation-circle", action: "Immediate doctor/ICU alert required" };
  if (score >= 5) return { color: C.amber, bg: "#fffbeb", label: "High Risk",  icon: "pi-exclamation-triangle", action: "Urgent medical review needed" };
  if (score >= 3) return { color: C.amber, bg: "#fffbeb", label: "Elevated",   icon: "pi-info-circle", action: "Increase monitoring frequency" };
  return             { color: C.green, bg: "#dcfce7", label: "Normal",    icon: "pi-check-circle", action: "Continue routine monitoring" };
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateTime(date, time) {
  if (!date && !time) return "—";
  return `${date || ""} ${time || ""}`.trim();
}

const DEFAULT_ENTRY = {
  time: "", bp_sys: "", bp_dia: "", pulse: "", temp: "", spo2: "", rr: "", bsl: "", gcs: "", pain: "",
  weight: "", o2Device: "None", o2Flow: "", notes: "",
};

/* ═══════════════════════════════════════════════════════
   Vital Trend Chart — inline SVG line chart
   Flattens history[] → list of points sorted by date+time,
   then draws each enabled series as a smoothed path. The
   chart auto-scales per series so heterogeneous units
   (mmHg, bpm, °F, %) all fit the same plot box.
═══════════════════════════════════════════════════════ */
const SERIES = [
  { key: "sbp",   label: "SBP",   unit: "mmHg",  color: "#dc2626", normLo: 90,  normHi: 140, vitalNames: ["BP Systolic","BP_Systolic","bp_sys"] },
  { key: "dbp",   label: "DBP",   unit: "mmHg",  color: "#f59e0b", normLo: 60,  normHi: 90,  vitalNames: ["BP Diastolic","BP_Diastolic","bp_dia"] },
  { key: "pulse", label: "Pulse", unit: "bpm",   color: "#2563eb", normLo: 60,  normHi: 100, vitalNames: ["Pulse","pulse"] },
  { key: "temp",  label: "Temp",  unit: "°F",    color: "#16a34a", normLo: 97,  normHi: 99.5, vitalNames: ["Temperature","temp"] },
  { key: "spo2",  label: "SpO₂",  unit: "%",     color: "#7c3aed", normLo: 95,  normHi: 100, vitalNames: ["SpO2","spo2"] },
  { key: "rr",    label: "RR",    unit: "/min",  color: "#0891b2", normLo: 12,  normHi: 20,  vitalNames: ["Resp Rate","rr"] },
];

function readVitalValue(valuesObj, names) {
  if (!valuesObj) return null;
  for (const n of names) {
    const v = valuesObj[n];
    if (v == null) continue;
    const num = typeof v === "object" ? Number(v.value) : Number(v);
    if (!isNaN(num)) return num;
  }
  return null;
}

function VitalTrendChart({ history, onOpenFullSheet, defaultDate }) {
  const [enabled, setEnabled] = useState({ sbp: true, dbp: true, pulse: true, temp: true, spo2: true, rr: false });
  const [scope,   setScope]   = useState("today"); // today | 3d | 7d | all

  // Flatten history → points sorted by datetime
  const points = React.useMemo(() => {
    const out = [];
    for (const sheet of (history || [])) {
      const date = sheet.date;
      for (const row of (sheet.tableData || [])) {
        const ts = `${date} ${row.time || "00:00"}`;
        const dt = new Date(`${date}T${(row.time || "00:00")}:00`);
        const p = { ts, dt, time: row.time, date };
        for (const s of SERIES) {
          p[s.key] = readVitalValue(row.values, s.vitalNames);
        }
        out.push(p);
      }
    }
    return out.sort((a, b) => a.dt - b.dt);
  }, [history]);

  // Filter by scope
  const filtered = React.useMemo(() => {
    if (!points.length) return [];
    if (scope === "all") return points;
    const now = new Date();
    let cutoff = new Date(now);
    if (scope === "today") cutoff.setHours(0, 0, 0, 0);
    else if (scope === "3d") cutoff.setDate(cutoff.getDate() - 3);
    else if (scope === "7d") cutoff.setDate(cutoff.getDate() - 7);
    return points.filter(p => p.dt >= cutoff);
  }, [points, scope]);

  // Chart geometry
  const W = 900, H = 220;
  const PAD_L = 38, PAD_R = 16, PAD_T = 14, PAD_B = 28;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  if (filtered.length === 0) {
    return (
      <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "30px 18px", textAlign: "center", color: "#64748b", fontSize: 13 }}>
        <i className="pi pi-chart-line" style={{ fontSize: 24, color: "#cbd5e1", marginBottom: 8, display: "block" }} />
        No vitals recorded yet — record one below and the trend chart will appear here.
      </div>
    );
  }

  const xFor = (i) => PAD_L + (filtered.length === 1 ? plotW / 2 : (i / (filtered.length - 1)) * plotW);

  // Per-series Y mapping (each series scales to its own normal band ±50%)
  const yFor = (s, val) => {
    if (val == null || isNaN(val)) return null;
    const range = s.normHi - s.normLo;
    const lo = s.normLo - range * 0.6;
    const hi = s.normHi + range * 0.6;
    const t = (val - lo) / (hi - lo);
    return PAD_T + (1 - Math.max(0, Math.min(1, t))) * plotH;
  };

  const buildPath = (s) => {
    const cmds = [];
    filtered.forEach((p, i) => {
      const y = yFor(s, p[s.key]);
      if (y == null) return;
      cmds.push(`${cmds.length === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${y.toFixed(1)}`);
    });
    return cmds.join(" ");
  };

  // X-axis tick labels (every Nth point so it doesn't overlap)
  const tickStride = Math.max(1, Math.ceil(filtered.length / 8));

  return (
    <div style={{ background: "#fff", border: "1.5px solid #e2e8f0", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(15,23,42,.04)" }}>
      <div style={{
        padding: "11px 16px",
        background: "linear-gradient(135deg,#eff6ff,#f0f9ff)",
        borderBottom: "1px solid #dbeafe",
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <i className="pi pi-chart-line" style={{ fontSize: 14, color: "#1d4ed8" }} />
          <span style={{ fontWeight: 800, fontSize: 13, color: "#1d4ed8" }}>Vital Trend Chart</span>
          <span style={{ fontSize: 11, color: "#64748b" }}>· {filtered.length} reading{filtered.length === 1 ? "" : "s"}</span>
        </div>

        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {[["today","Today"],["3d","3 days"],["7d","7 days"],["all","All"]].map(([k, label]) => (
            <button key={k} onClick={() => setScope(k)}
              style={{
                padding: "5px 11px", borderRadius: 6,
                background: scope === k ? "#1d4ed8" : "#fff",
                color:      scope === k ? "#fff"    : "#475569",
                border: `1px solid ${scope === k ? "#1d4ed8" : "#e2e8f0"}`,
                fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}>{label}</button>
          ))}
          {onOpenFullSheet && (
            <button onClick={onOpenFullSheet}
              style={{
                padding: "5px 12px", borderRadius: 6,
                background: "#fff", color: "#1d4ed8",
                border: "1px solid #bfdbfe", fontWeight: 700, fontSize: 11,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
              }}>
              <i className="pi pi-external-link" style={{ fontSize: 10 }} />
              Full sheet
            </button>
          )}
        </div>
      </div>

      {/* Series toggles */}
      <div style={{ padding: "8px 14px", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {SERIES.map(s => {
          const hasData = filtered.some(p => p[s.key] != null);
          const on = enabled[s.key];
          return (
            <button key={s.key}
              onClick={() => setEnabled(e => ({ ...e, [s.key]: !e[s.key] }))}
              disabled={!hasData}
              style={{
                padding: "4px 10px", borderRadius: 14,
                background: on && hasData ? s.color : "#fff",
                color:      on && hasData ? "#fff"  : (hasData ? s.color : "#cbd5e1"),
                border: `1.5px solid ${hasData ? s.color : "#e2e8f0"}`,
                fontSize: 10.5, fontWeight: 700,
                cursor: hasData ? "pointer" : "not-allowed",
                opacity: hasData ? 1 : 0.5,
                display: "inline-flex", alignItems: "center", gap: 5,
              }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: on && hasData ? "#fff" : s.color }} />
              {s.label}
              {hasData && (
                <span style={{ fontSize: 9.5, opacity: .75 }}>
                  ({filtered.filter(p => p[s.key] != null).length})
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* SVG plot */}
      <div style={{ padding: "10px 8px 0", overflowX: "auto" }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
          {/* Y-axis grid lines (4 bands) */}
          {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
            <line key={i}
              x1={PAD_L} x2={W - PAD_R}
              y1={PAD_T + t * plotH} y2={PAD_T + t * plotH}
              stroke="#f1f5f9" strokeDasharray={i === 0 || i === 4 ? "" : "3 3"}
              strokeWidth={1} />
          ))}
          {/* X-axis baseline */}
          <line x1={PAD_L} x2={W - PAD_R} y1={H - PAD_B} y2={H - PAD_B} stroke="#cbd5e1" />

          {/* Series lines + points */}
          {SERIES.filter(s => enabled[s.key]).map(s => (
            <g key={s.key}>
              <path d={buildPath(s)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {filtered.map((p, i) => {
                const y = yFor(s, p[s.key]);
                if (y == null) return null;
                const abnormal = p[s.key] < s.normLo || p[s.key] > s.normHi;
                return (
                  <g key={i}>
                    <circle cx={xFor(i)} cy={y} r={abnormal ? 4 : 2.8}
                      fill={abnormal ? "#fff" : s.color}
                      stroke={s.color} strokeWidth={abnormal ? 2 : 0}>
                      <title>{`${s.label}: ${p[s.key]} ${s.unit}\n${p.date} ${p.time}${abnormal ? "  ⚠ abnormal" : ""}`}</title>
                    </circle>
                  </g>
                );
              })}
            </g>
          ))}

          {/* X-axis labels */}
          {filtered.map((p, i) => {
            if (i % tickStride !== 0 && i !== filtered.length - 1) return null;
            const label = scope === "today" ? p.time : `${p.date.slice(5)} ${p.time}`;
            return (
              <text key={i} x={xFor(i)} y={H - PAD_B + 14}
                fontSize="9.5" fill="#64748b" textAnchor="middle">
                {label}
              </text>
            );
          })}

          {/* Y-axis legend stripe (per enabled series, normal range bar on left) */}
          {SERIES.filter(s => enabled[s.key]).map((s, i, arr) => (
            <text key={s.key}
              x={4} y={PAD_T + 12 + i * 12}
              fontSize="9" fontWeight="700" fill={s.color}>
              {s.label}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════ */
export default function IntegratedVitalsPanel({ UHID, nurseName = "", onVitalsChange }) {
  const [history,   setHistory]   = useState([]);   // all records for this UHID
  const [todayRows, setTodayRows] = useState([]);   // today's tableData rows
  const [entry,     setEntry]     = useState({ ...DEFAULT_ENTRY, time: nowTime() });
  const [saving,    setSaving]    = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [histDate,  setHistDate]  = useState(todayDate()); // date filter for history view

  // Keep a ref so field handlers always call the latest callback without stale closures
  const onVitalsChangeRef = React.useRef(onVitalsChange);
  React.useEffect(() => { onVitalsChangeRef.current = onVitalsChange; }, [onVitalsChange]);

  /* ── Fetch all vital records for this UHID ── */
  const fetchHistory = useCallback(async () => {
    if (!UHID) return;
    setLoading(true);
    try {
      const res = await getVitalSheet(UHID); // no date = get all
      if (res && Array.isArray(res.data)) {
        setHistory(res.data);
        // Flatten today's rows for quick display
        const today = todayDate();
        const todaySheet = res.data.find(s => s.date === today);
        setTodayRows(todaySheet?.tableData || []);
      } else if (res && res.tableData) {
        // single record returned
        setHistory([res]);
        setTodayRows(res.tableData || []);
      }
    } catch {
      /* silent — API may 404 on no data */
    } finally {
      setLoading(false);
    }
  }, [UHID]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // Update entry state AND notify parent synchronously from the same event handler.
  // Calling parent setters (setVitals, setMews) from a child onChange is valid React —
  // React batches all setState calls within the same event tick.
  const setE = (k, v) => {
    setEntry(p => ({ ...p, [k]: v }));
    if (onVitalsChangeRef.current) {
      const synth = { ...entry, [k]: v };
      onVitalsChangeRef.current({
        bp_sys: synth.bp_sys, bp_dia: synth.bp_dia,
        pulse: synth.pulse, temp: synth.temp,
        spo2: synth.spo2, rr: synth.rr, gcs: synth.gcs,
        bsl: synth.bsl, painScore: synth.pain,
        weight: synth.weight, o2Device: synth.o2Device, o2Flow: synth.o2Flow,
        position: "Supine",
      });
    }
  };

  /* ── Save to VitalSheet API ── */
  const handleSave = async () => {
    if (!UHID) { toast.error("No patient selected"); return; }
    if (!entry.bp_sys && !entry.pulse && !entry.temp && !entry.spo2) {
      toast.warn("Enter at least one vital (BP, Pulse, Temp, or SpO₂)");
      return;
    }

    setSaving(true);
    try {
      const dateStr = todayDate();
      const sbpVal = entry.bp_sys || "";
      const dbpVal = entry.bp_dia || "";

      // Build values object for this time-slot
      const values = {};
      if (sbpVal)     values["BP Systolic"]  = { value: Number(sbpVal),  unit: "mmHg" };
      if (dbpVal)     values["BP Diastolic"] = { value: Number(dbpVal),  unit: "mmHg" };
      if (entry.pulse) values["Pulse"]        = { value: Number(entry.pulse), unit: "bpm" };
      if (entry.temp)  values["Temperature"]  = { value: Number(entry.temp),  unit: "°F" };
      if (entry.spo2)  values["SpO2"]         = { value: Number(entry.spo2),  unit: "%" };
      if (entry.rr)    values["Resp Rate"]    = { value: Number(entry.rr),    unit: "/min" };
      if (entry.bsl)   values["BSL"]          = { value: Number(entry.bsl),   unit: "mg/dL" };
      if (entry.gcs)   values["GCS"]          = { value: entry.gcs,           unit: "score" };
      if (entry.pain)  values["Pain Score"]   = { value: Number(entry.pain),  unit: "score" };
      if (entry.weight) values["Weight"]      = { value: Number(entry.weight),unit: "kg" };

      const newRow = {
        time: entry.time || nowTime(),
        nurse: nurseName,
        notes: entry.notes,
        values,
      };

      // Merge with existing today's rows (append new row)
      const existingRows = [...todayRows];
      // Remove duplicate time if re-saving same slot
      const merged = existingRows.filter(r => r.time !== newRow.time).concat(newRow)
        .sort((a, b) => a.time.localeCompare(b.time));

      const activeVitals = [
        { name: "BP Systolic",  unit: "mmHg" },
        { name: "BP Diastolic", unit: "mmHg" },
        { name: "Pulse",        unit: "bpm"  },
        { name: "Temperature",  unit: "°F"   },
        { name: "SpO2",         unit: "%"    },
        { name: "Resp Rate",    unit: "/min" },
        { name: "BSL",          unit: "mg/dL"},
        { name: "GCS",          unit: "score"},
        { name: "Pain Score",   unit: "score"},
        { name: "Weight",       unit: "kg"   },
      ];

      const payload = {
        uhid: UHID,
        date: dateStr,
        slot: "01 Hours",
        activeVitals,
        tableData: merged,
      };

      const res = await saveVitalSheet(payload);
      if (res && res.success === false) {
        toast.error(res.message || "Failed to save vitals");
      } else {
        toast.success(`Vitals recorded at ${newRow.time}`);
        setTodayRows(merged);
        // Reset form but keep time updated
        setEntry({ ...DEFAULT_ENTRY, time: nowTime() });
        fetchHistory();
      }
    } catch (err) {
      toast.error("Error saving vitals. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  /* ── MEWS live ── */
  const sbp = entry.bp_sys || "";
  const mewsScore = calcMEWS({ rr: entry.rr, spo2: entry.spo2, temp: entry.temp, sbp, hr: entry.pulse });
  const band = mewsBand(mewsScore);
  const hasAnyVital = entry.bp_sys || entry.pulse || entry.temp || entry.spo2 || entry.rr;

  /* ── History rows for selected date ── */
  const filteredSheet = history.find(s => s.date === histDate);
  const filteredRows  = filteredSheet?.tableData || [];

  /* ── All dates with records ── */
  const recordDates = [...new Set(history.map(s => s.date))].sort().reverse();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Dynamic Vital Trend Chart ── */}
      <VitalTrendChart
        history={history}
        defaultDate={histDate}
        onOpenFullSheet={UHID ? () => { window.location.href = `/vitalSheet/${encodeURIComponent(UHID)}`; } : null}
      />

      {/* ── History Table ── */}
      <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "11px 18px", background: C.blueL, borderBottom: `1px solid ${C.blueB}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <i className="pi pi-history" style={{ fontSize: 14, color: C.blue }} />
            <span style={{ fontWeight: 700, fontSize: 13, color: C.blue }}>Previous Vital Records</span>
            {loading && <i className="pi pi-spin pi-spinner" style={{ fontSize: 12, color: C.muted }} />}
          </div>
          {/* Date selector */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>Date:</span>
            <select
              value={histDate}
              onChange={e => setHistDate(e.target.value)}
              className="his-field" style={{ width: "auto", padding: "5px 10px", fontSize: 12 }}
            >
              {recordDates.length === 0 && <option value={todayDate()}>Today</option>}
              {recordDates.map(d => (
                <option key={d} value={d}>{d === todayDate() ? `Today (${d})` : d}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto", maxHeight: 260 }}>
          {filteredRows.length === 0 ? (
            <div style={{ padding: "24px 18px", textAlign: "center", color: C.muted, fontSize: 13 }}>
              {loading ? "Loading records…" : `No vital records for ${histDate}`}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: `1px solid ${C.border}` }}>
                  {["Time","BP (mmHg)","Pulse","Temp °F","SpO₂ %","RR /min","BSL","GCS","Pain","Nurse"].map(h => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 700, color: C.muted, whiteSpace: "nowrap", textTransform: "uppercase", letterSpacing: ".5px", fontSize: 10 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...filteredRows].sort((a, b) => a.time.localeCompare(b.time)).map((row, i) => {
                  const v = row.values || {};
                  const sbpV = v["BP Systolic"]?.value  ?? v["BP_Systolic"]?.value  ?? "";
                  const dbpV = v["BP Diastolic"]?.value ?? v["BP_Diastolic"]?.value ?? "";
                  const bpStr = sbpV && dbpV ? `${sbpV}/${dbpV}` : sbpV || dbpV || "—";
                  const pulse = v["Pulse"]?.value ?? "—";
                  const temp  = v["Temperature"]?.value ?? "—";
                  const spo2  = v["SpO2"]?.value ?? "—";
                  const rr    = v["Resp Rate"]?.value ?? "—";
                  const bsl   = v["BSL"]?.value ?? "—";
                  const gcs   = v["GCS"]?.value ?? "—";
                  const pain  = v["Pain Score"]?.value ?? "—";

                  const abnColor = (key, val) => isAbnormal(key, String(val)) ? C.red : C.text;

                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 ? "#fafafa" : "white" }}>
                      <td style={{ padding: "7px 10px", fontWeight: 700, color: C.teal, whiteSpace: "nowrap" }}>{row.time}</td>
                      <td style={{ padding: "7px 10px", color: abnColor("sbp", sbpV), fontWeight: isAbnormal("sbp", String(sbpV)) ? 700 : 400 }}>{bpStr}</td>
                      <td style={{ padding: "7px 10px", color: abnColor("pulse", pulse) }}>{pulse}</td>
                      <td style={{ padding: "7px 10px", color: abnColor("temp", temp) }}>{temp}</td>
                      <td style={{ padding: "7px 10px", color: abnColor("spo2", spo2) }}>{spo2}</td>
                      <td style={{ padding: "7px 10px", color: abnColor("rr", rr) }}>{rr}</td>
                      <td style={{ padding: "7px 10px", color: abnColor("bsl", bsl) }}>{bsl}</td>
                      <td style={{ padding: "7px 10px" }}>{String(gcs)}</td>
                      <td style={{ padding: "7px 10px", color: Number(pain) >= 7 ? C.red : Number(pain) >= 4 ? C.amber : C.text }}>{String(pain)}</td>
                      <td style={{ padding: "7px 10px", color: C.muted, fontSize: 11 }}>{row.nurse || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── New Entry Form ── */}
      <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "11px 18px", background: "#ecfdf5", borderBottom: `1px solid #bbf7d0`, display: "flex", alignItems: "center", gap: 8 }}>
          <i className="pi pi-plus-circle" style={{ fontSize: 14, color: C.green }} />
          <span style={{ fontWeight: 700, fontSize: 13, color: "#065f46" }}>Record New Vitals</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted }}>Auto-saves to Vital Sheet history</span>
        </div>
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Row 1: Time + BP Systolic + BP Diastolic + Pulse + Temp */}
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label className="his-label">Time *</label>
              <input type="time" className="his-field" value={entry.time} onChange={e => setE("time", e.target.value)} />
            </div>
            <div>
              <label className="his-label">Systolic BP (mmHg)</label>
              <input type="number" className="his-field" style={{ borderColor: isAbnormal("sbp", entry.bp_sys) ? C.red : "#e2e8f0" }}
                placeholder="120" value={entry.bp_sys} onChange={e => setE("bp_sys", e.target.value)} />
            </div>
            <div>
              <label className="his-label">Diastolic BP (mmHg)</label>
              <input type="number" className="his-field" style={{ borderColor: isAbnormal("dbp", entry.bp_dia) ? C.red : "#e2e8f0" }}
                placeholder="80" value={entry.bp_dia} onChange={e => setE("bp_dia", e.target.value)} />
            </div>
            <div>
              <label className="his-label">Pulse (/min)</label>
              <input type="number" className="his-field" style={{ borderColor: isAbnormal("pulse", entry.pulse) ? C.red : "#e2e8f0" }}
                placeholder="80" value={entry.pulse} onChange={e => setE("pulse", e.target.value)} />
            </div>
            <div>
              <label className="his-label">Temperature (°F)</label>
              <input type="number" step="0.1" className="his-field" style={{ borderColor: isAbnormal("temp", entry.temp) ? C.red : "#e2e8f0" }}
                placeholder="98.6" value={entry.temp} onChange={e => setE("temp", e.target.value)} />
            </div>
          </div>

          {/* Row 2: SpO2 + RR + BSL + GCS */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label className="his-label">SpO₂ (%)</label>
              <input type="number" className="his-field" style={{ borderColor: isAbnormal("spo2", entry.spo2) ? C.red : "#e2e8f0" }}
                placeholder="98" value={entry.spo2} onChange={e => setE("spo2", e.target.value)} />
            </div>
            <div>
              <label className="his-label">Resp Rate (/min)</label>
              <input type="number" className="his-field" style={{ borderColor: isAbnormal("rr", entry.rr) ? C.red : "#e2e8f0" }}
                placeholder="16" value={entry.rr} onChange={e => setE("rr", e.target.value)} />
            </div>
            <div>
              <label className="his-label">BSL (mg/dL)</label>
              <input type="number" className="his-field" style={{ borderColor: isAbnormal("bsl", entry.bsl) ? C.red : "#e2e8f0" }}
                placeholder="110" value={entry.bsl} onChange={e => setE("bsl", e.target.value)} />
            </div>
            <div>
              <label className="his-label">GCS (E/V/M or total)</label>
              <input className="his-field" placeholder="E4V5M6 / 15" value={entry.gcs} onChange={e => setE("gcs", e.target.value)} />
            </div>
          </div>

          {/* Row 3: Pain + Weight + O2 Device + O2 Flow */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label className="his-label">Pain Score (NRS 0–10)</label>
              <input type="number" min="0" max="10"
                className="his-field" style={{ borderColor: Number(entry.pain) >= 7 ? C.red : Number(entry.pain) >= 4 ? C.amber : "#e2e8f0" }}
                placeholder="0" value={entry.pain} onChange={e => setE("pain", e.target.value)} />
            </div>
            <div>
              <label className="his-label">Weight (kg)</label>
              <input type="number" step="0.1" className="his-field" placeholder="60" value={entry.weight} onChange={e => setE("weight", e.target.value)} />
            </div>
            <div>
              <label className="his-label">O₂ Delivery Device</label>
              <select className="his-field" style={{ cursor: "pointer" }} value={entry.o2Device} onChange={e => setE("o2Device", e.target.value)}>
                {["None","Nasal Prongs","Simple Mask","Venturi Mask","NRM Mask","CPAP","BiPAP","Ventilator"].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            {entry.o2Device !== "None" && (
              <div>
                <label className="his-label">O₂ Flow (L/min)</label>
                <input type="number" className="his-field" placeholder="4" value={entry.o2Flow} onChange={e => setE("o2Flow", e.target.value)} />
              </div>
            )}
          </div>

          {/* Pain bar */}
          {entry.pain !== "" && (
            <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
              {[0,1,2,3,4,5,6,7,8,9,10].map(n => (
                <div key={n} onClick={() => setE("pain", String(n))}
                  style={{ flex: 1, height: 12, borderRadius: 3, cursor: "pointer", transition: "all .15s",
                    background: Number(entry.pain) >= n ? (n >= 7 ? C.red : n >= 4 ? C.amber : C.green) : "#e2e8f0" }}
                  title={String(n)} />
              ))}
              <span style={{ fontSize: 11, fontWeight: 700, marginLeft: 6,
                color: Number(entry.pain) >= 7 ? C.red : Number(entry.pain) >= 4 ? C.amber : C.green }}>
                {entry.pain}/10
              </span>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="his-label">Notes / Remarks</label>
            <textarea className="his-field" style={{ resize: "vertical", minHeight: 56 }}
              placeholder="Any additional observations…"
              value={entry.notes} onChange={e => setE("notes", e.target.value)} />
          </div>

          {/* ── Diabetic-chart jump-off — when BSL is captured and out of normal,
                offer a one-click trip to /diabetic-chart so the nurse can pick
                up the sliding-scale insulin recommendation without leaving the
                workflow. Threshold: <70 (hypo) or >180 (hyperglycaemia). ── */}
          {entry.bsl && UHID && (Number(entry.bsl) < 70 || Number(entry.bsl) > 180) && (
            <div style={{
              background: Number(entry.bsl) < 70 ? "#fef2f2" : "#fffbeb",
              border: `1.5px solid ${Number(entry.bsl) < 70 ? "#fecaca" : "#fde68a"}`,
              borderRadius: 8, padding: "10px 14px",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <i className={`pi ${Number(entry.bsl) < 70 ? "pi-exclamation-triangle" : "pi-bolt"}`}
                style={{ fontSize: 15, color: Number(entry.bsl) < 70 ? C.red : C.amber }} />
              <div style={{ flex: 1, fontSize: 12 }}>
                <div style={{ fontWeight: 800, color: Number(entry.bsl) < 70 ? C.red : C.amber }}>
                  {Number(entry.bsl) < 70 ? "Hypoglycaemia detected" : "Hyperglycaemia detected"} — BG {entry.bsl} mg/dL
                </div>
                <div style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>
                  Open the diabetic chart to record this slot + apply sliding-scale insulin
                </div>
              </div>
              <button
                onClick={() => { window.location.href = `/diabetic-chart?uhid=${encodeURIComponent(UHID)}`; }}
                style={{
                  padding: "8px 14px", borderRadius: 7, border: "none",
                  background: Number(entry.bsl) < 70 ? C.red : C.amber, color: "#fff",
                  fontWeight: 700, fontSize: 11, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                <i className="pi pi-external-link" style={{ fontSize: 10 }} />
                Open diabetic chart
              </button>
            </div>
          )}

          {/* MEWS Banner */}
          {hasAnyVital && (
            <div style={{ background: band.bg, border: `1.5px solid ${band.color}30`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
              <i className={`pi ${band.icon}`} style={{ fontSize: 15, color: band.color }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: band.color }}>MEWS: {mewsScore} — {band.label}</div>
                <div style={{ fontSize: 11, color: band.color + "cc" }}>{band.action}</div>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 11, color: C.muted }}>
                {entry.rr   && <span>RR: <b>{entry.rr}</b></span>}
                {entry.spo2 && <span>SpO₂: <b>{entry.spo2}%</b></span>}
                {entry.pulse&& <span>HR: <b>{entry.pulse}</b></span>}
              </div>
            </div>
          )}

          {/* Save button */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 4 }}>
            <button
              onClick={() => setEntry({ ...DEFAULT_ENTRY, time: nowTime() })}
              style={{ padding: "9px 18px", border: `1.5px solid ${C.border}`, borderRadius: 8, background: "white", cursor: "pointer", fontSize: 13, color: C.muted, fontWeight: 600 }}
            >
              Clear
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ padding: "9px 22px", border: "none", borderRadius: 8, background: saving ? C.muted : C.green, color: "white", cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 7, opacity: saving ? .7 : 1 }}
            >
              {saving ? <><i className="pi pi-spin pi-spinner" style={{ fontSize: 13 }} /> Saving…</> : <><i className="pi pi-save" style={{ fontSize: 13 }} /> Save Vital Record</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
