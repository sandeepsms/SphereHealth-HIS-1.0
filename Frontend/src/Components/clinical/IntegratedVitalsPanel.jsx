import React, { useState, useEffect, useCallback } from "react";
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

const fld = {
  padding: "8px 11px", border: "1.5px solid #e2e8f0", borderRadius: 8,
  fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: "#0f172a",
  outline: "none", background: "white", width: "100%", boxSizing: "border-box",
};
const lbl = {
  display: "block", fontSize: 11, fontWeight: 700, color: C.muted,
  textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 4,
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
  time: "", bp: "", pulse: "", temp: "", spo2: "", rr: "", bsl: "", gcs: "", pain: "",
  weight: "", o2Device: "None", o2Flow: "", notes: "",
};

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
        bp: synth.bp, pulse: synth.pulse, temp: synth.temp,
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
    if (!entry.bp && !entry.pulse && !entry.temp && !entry.spo2) {
      toast.warn("Enter at least one vital (BP, Pulse, Temp, or SpO₂)");
      return;
    }

    setSaving(true);
    try {
      const dateStr = todayDate();
      const [sbpVal = "", dbpVal = ""] = entry.bp.split("/");

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
  const [sbp = ""] = entry.bp.split("/");
  const mewsScore = calcMEWS({ rr: entry.rr, spo2: entry.spo2, temp: entry.temp, sbp, hr: entry.pulse });
  const band = mewsBand(mewsScore);
  const hasAnyVital = entry.bp || entry.pulse || entry.temp || entry.spo2 || entry.rr;

  /* ── History rows for selected date ── */
  const filteredSheet = history.find(s => s.date === histDate);
  const filteredRows  = filteredSheet?.tableData || [];

  /* ── All dates with records ── */
  const recordDates = [...new Set(history.map(s => s.date))].sort().reverse();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

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
              style={{ ...fld, width: "auto", padding: "5px 10px", fontSize: 12 }}
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

          {/* Row 1: Time + BP + Pulse + Temp */}
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={lbl}>Time *</label>
              <input type="time" style={fld} value={entry.time} onChange={e => setE("time", e.target.value)} />
            </div>
            <div>
              <label style={lbl}>BP (Sys/Dia mmHg)</label>
              <input style={{ ...fld, borderColor: isAbnormal("sbp", entry.bp.split("/")[0]) ? C.red : "#e2e8f0" }}
                placeholder="120/80" value={entry.bp} onChange={e => setE("bp", e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Pulse (/min)</label>
              <input type="number" style={{ ...fld, borderColor: isAbnormal("pulse", entry.pulse) ? C.red : "#e2e8f0" }}
                placeholder="80" value={entry.pulse} onChange={e => setE("pulse", e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Temperature (°F)</label>
              <input type="number" step="0.1" style={{ ...fld, borderColor: isAbnormal("temp", entry.temp) ? C.red : "#e2e8f0" }}
                placeholder="98.6" value={entry.temp} onChange={e => setE("temp", e.target.value)} />
            </div>
          </div>

          {/* Row 2: SpO2 + RR + BSL + GCS */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={lbl}>SpO₂ (%)</label>
              <input type="number" style={{ ...fld, borderColor: isAbnormal("spo2", entry.spo2) ? C.red : "#e2e8f0" }}
                placeholder="98" value={entry.spo2} onChange={e => setE("spo2", e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Resp Rate (/min)</label>
              <input type="number" style={{ ...fld, borderColor: isAbnormal("rr", entry.rr) ? C.red : "#e2e8f0" }}
                placeholder="16" value={entry.rr} onChange={e => setE("rr", e.target.value)} />
            </div>
            <div>
              <label style={lbl}>BSL (mg/dL)</label>
              <input type="number" style={{ ...fld, borderColor: isAbnormal("bsl", entry.bsl) ? C.red : "#e2e8f0" }}
                placeholder="110" value={entry.bsl} onChange={e => setE("bsl", e.target.value)} />
            </div>
            <div>
              <label style={lbl}>GCS (E/V/M or total)</label>
              <input style={fld} placeholder="E4V5M6 / 15" value={entry.gcs} onChange={e => setE("gcs", e.target.value)} />
            </div>
          </div>

          {/* Row 3: Pain + Weight + O2 Device + O2 Flow */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={lbl}>Pain Score (NRS 0–10)</label>
              <input type="number" min="0" max="10"
                style={{ ...fld, borderColor: Number(entry.pain) >= 7 ? C.red : Number(entry.pain) >= 4 ? C.amber : "#e2e8f0" }}
                placeholder="0" value={entry.pain} onChange={e => setE("pain", e.target.value)} />
            </div>
            <div>
              <label style={lbl}>Weight (kg)</label>
              <input type="number" step="0.1" style={fld} placeholder="60" value={entry.weight} onChange={e => setE("weight", e.target.value)} />
            </div>
            <div>
              <label style={lbl}>O₂ Delivery Device</label>
              <select style={{ ...fld, cursor: "pointer" }} value={entry.o2Device} onChange={e => setE("o2Device", e.target.value)}>
                {["None","Nasal Prongs","Simple Mask","Venturi Mask","NRM Mask","CPAP","BiPAP","Ventilator"].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            {entry.o2Device !== "None" && (
              <div>
                <label style={lbl}>O₂ Flow (L/min)</label>
                <input type="number" style={fld} placeholder="4" value={entry.o2Flow} onChange={e => setE("o2Flow", e.target.value)} />
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
            <label style={lbl}>Notes / Remarks</label>
            <textarea style={{ ...fld, resize: "vertical", minHeight: 56 }}
              placeholder="Any additional observations…"
              value={entry.notes} onChange={e => setE("notes", e.target.value)} />
          </div>

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
