/**
 * VitalsTrendModal.jsx — R7hr-158
 *
 * The Nursing Notes "Vitals Trend" tile used to navigate to /vitalsView,
 * which rendered an empty page. The user asked for a popup that
 * aggregates vitals across the surfaces where nursing staff ACTUALLY
 * chart them:
 *   • Vital Signs            (noteType: "vitals",            NABH NS.4)
 *   • Daily Assessment       (noteType: "dailyAssessment",   NABH NS.4)
 *   • MEWS Score             (noteType: "mewsScore",         NABH COP.17)
 *   • Nursing Initial        (noteType: "initialAssessment", NABH AAC.1)
 *
 * Blood Transfusion + IV Infusion charting are deliberately EXCLUDED —
 * they have their own dedicated monitoring blocks (running-bag panel +
 * intra-transfusion monitoring log).
 *
 * Each row surfaces BP / HR / RR / SpO₂ / Temp / Pain / GCS / BSL when
 * present plus the source-of-truth note type and the nurse who charted.
 */

import React, { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

const C = {
  primary: "#0891b2", primaryD: "#0e7490", primaryL: "#cffafe",
  ok: "#15803d", okL: "#dcfce7",
  warn: "#a16207", warnL: "#fef3c7",
  bad: "#b91c1c", badL: "#fee2e2",
  slate: "#475569", slateL: "#f1f5f9",
  border: "#e2e8f0", card: "#ffffff", muted: "#64748b", dark: "#0f172a",
};

// noteType → display label + tone
//
// R7hr-161-FIX-2: NurseNote.noteType uses the SHORT form names that the
// NursingNotes tile / modal id sends (saveNote L1070 `noteType: activeModal`).
// So the saved values are "vitals", "daily", "mews", "initial" — NOT the
// "dailyAssessment / mewsScore / initialAssessment" payload-key names the
// first version of this modal filtered on. With the wrong filter every
// row was dropped and the trend looked empty even when a Daily Assessment
// note had bp_sys="110" / pulse="80" saved correctly.
const SOURCE_META = {
  vitals:  { label: "Vital Signs",      short: "Vitals", icon: "❤", fg: "#be185d", bg: "#fce7f3" },
  daily:   { label: "Daily Assessment", short: "Daily",  icon: "📋", fg: "#1d4ed8", bg: "#dbeafe" },
  mews:    { label: "MEWS Score",       short: "MEWS",   icon: "🚨", fg: "#b45309", bg: "#fef3c7" },
  initial: { label: "Nursing Initial",  short: "Initial",icon: "🧾", fg: "#15803d", bg: "#dcfce7" },
};
const ALLOWED_TYPES = Object.keys(SOURCE_META);

// ── Extract vitals from one nurse-note doc — vitals live in slightly
// different keys depending on noteType. We normalise into a single row.
//
// R7hr-161-FIX: the original implementation read `note.noteDetails` which
// does NOT exist on NurseNote (the schema uses `noteData: Mixed` for the
// module-specific blob AND `vitals: NurseVitalsSchema` as a TOP-LEVEL
// sub-document for the vitals form payload). The modal therefore loaded
// every row as blank values. Now we hunt across all three known landing
// spots so vitals filed via Vital Signs / Daily Assessment / MEWS /
// Nursing Initial Assessment all surface.
//
// Known shapes:
//   • vitals            → note.vitals.{bp.systolic, bp.diastolic, pulse, temp, rr, spo2, bloodSugar}
//                         (top-level NurseVitalsSchema sub-doc — model L11-22)
//                       — AND note.painScore (top-level)
//   • dailyAssessment   → note.noteData.dailyAssessment.{bp_sys, bp_dia, pulse, temp, spo2, rr, bsl, gcs}
//   • mewsScore         → note.noteData.mewsScore.{respRate, heartRate, systolicBP, temp, ...} + total
//   • initialAssessment → note.noteData.initialAssessment.nursing.vitals.{...}
//                         (per R7hr-122 — Nurse IA vitals under nursing wrapper)
function extractVitals(note) {
  const t  = note.noteType || "";
  // R7hr-161-FIX — read from all three landing spots:
  //   nd  = legacy "noteDetails" / "moduleData" (kept for back-compat with
  //          any draft data that might have shipped under those names)
  //   nda = the canonical `noteData` Mixed bucket per NurseNotesModel L169
  //   top = the top-level vitals sub-doc + painScore (NurseVitalsSchema)
  const nd  = note.noteDetails || note.moduleData || {};
  const nda = note.noteData || {};
  // R7hr-182: some save paths nested the module payload ONE level deeper —
  // noteData.noteDetails.{dailyAssessment|mewsScore} (body shipped its own
  // noteDetails wrapper and the BASE_FIELDS sweep kept it verbatim). Without
  // unwrapping, those rows rendered all-dash even though HR/BP/Temp were
  // saved correctly. Treat it as a fourth landing spot.
  const ndd = (nda.noteDetails && typeof nda.noteDetails === "object") ? nda.noteDetails : {};
  const top = note.vitals || {};

  // Resolve the "vitals source" object — try the most specific shape
  // FIRST per noteType (short-form name per saveNote L1070), then fall
  // back to anything that walks like a vitals object.
  const v = (t === "vitals"  ? top                                          : null)
         || (t === "daily"   ? (nda?.dailyAssessment || ndd?.dailyAssessment) : null)
         || (t === "mews"    ? (nda?.mewsScore || ndd?.mewsScore)           : null)
         || (t === "initial" ? (nda?.initialAssessment?.nursing?.vitals
                              || nda?.nursing?.vitals
                              || ndd?.initialAssessment?.nursing?.vitals
                              || nda?.initialAssessment)                    : null)
         || nda?.dailyAssessment
         || nda?.mewsScore
         || ndd?.dailyAssessment
         || ndd?.mewsScore
         || nda?.initialAssessment?.nursing?.vitals
         || nd.vitals
         || nd.nursing?.vitals
         || nd.nursingNabh?.vitals
         || nd.vital_signs
         || top
         || nd;

  // BP can be flat keys (bp_sys/bp_dia for dailyAssessment + IA-vitals)
  // OR nested {bp: {systolic, diastolic}} for the top-level vitals sub-doc.
  // R7hr-182: MEWS charts systolic-only BP — scored form saves `sysBP`,
  // live UI form saves `sbp`. Append both spellings (+ their diastolic
  // twins for safety) and render "NNN (sys)" when no diastolic exists.
  const bpSys = v.bp_sys ?? v.bpSys ?? v.systolic ?? v?.bp?.systolic ?? v?.systolicBP ?? v?.sysBP ?? v?.sbp ?? "";
  const bpDia = v.bp_dia ?? v.bpDia ?? v.diastolic ?? v?.bp?.diastolic ?? v?.diastolicBP ?? v?.diaBP ?? v?.dbp ?? "";
  const bp = (bpSys && bpDia) ? `${bpSys}/${bpDia}`
           : bpSys ? `${bpSys} (sys)`
           : (v.bp && typeof v.bp === "string" ? v.bp : "")
           || v.bloodPressure || "";

  return {
    _id:     note._id,
    when:    note.noteDate || note.createdAt,
    type:    t,
    bp:      bp ? String(bp) : "",
    pulse:   v.pulse ?? v.hr ?? v.heart_rate ?? v.heartRate ?? "",
    rr:      v.rr ?? v.resp ?? v.respiratoryRate ?? v.respRate ?? "",
    spo2:    v.spo2 ?? v.spO2 ?? v.oxygenSat ?? "",
    temp:    v.temp ?? v.temperature ?? "",
    // painScore lives at the top level on Vital Signs notes (model L123)
    // but inside the vitals/daily blob for other note types.
    // R7hr-182: note.painScore is a SCHEMA DEFAULT (0) stamped on every
    // nurse note — only the Vital Signs form actually writes it. Trusting
    // it for other types painted a phantom "0/10" on every Daily/MEWS row
    // and kept vital-less narrative rows alive past the empty-row filter.
    pain:    v.painScore ?? v.pain ?? (t === "vitals" ? note.painScore : null) ?? nd.painScore ?? nda?.dailyAssessment?.painScore ?? ndd?.dailyAssessment?.painScore ?? "",
    gcs:     v.gcs ?? v.GCS ?? nd.nursing?.gcs ?? nda?.dailyAssessment?.gcs ?? ndd?.dailyAssessment?.gcs ?? "",
    bsl:     v.bsl ?? v.rbs ?? v.bloodSugar ?? "",
    mews:    nda?.mewsScore?.total ?? ndd?.mewsScore?.total ?? nd.mewsScore ?? nd.totalScore ?? v.total ?? v.mews ?? "",
    by:      note.signedByName || note.recordedBy || note.createdByName || note.createdBy || "—",
  };
}

function fmtDateTime(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return String(d); }
}

// Mark a value as out-of-range so the table cell flashes. NABH AAC.5
// trigger thresholds — keep additive (defaults are "normal").
function tone(field, val) {
  const n = Number(val);
  if (!Number.isFinite(n) || val === "" || val === null) return null;
  switch (field) {
    case "pulse":  return (n < 50  || n > 110) ? "bad" : (n < 60 || n > 100) ? "warn" : null;
    case "rr":     return (n < 8   || n > 28)  ? "bad" : (n < 12 || n > 20)  ? "warn" : null;
    case "spo2":   return (n < 90)  ? "bad" : (n < 94)  ? "warn" : null;
    // R7hr-182: temps are charted in BOTH scales (MEWS scored form saves 37 °C,
    // live form saves "98.6" °F). >45 can only be Fahrenheit — use °F bands
    // there so a normal 98.6° stops flashing red as a false escalation.
    case "temp":   return n > 45
                     ? ((n < 95 || n > 102.2) ? "bad" : (n < 96.8 || n > 100.4) ? "warn" : null)
                     : ((n < 35 || n > 39.0)  ? "bad" : (n < 36   || n > 38)    ? "warn" : null);
    case "bsl":    return (n < 60  || n > 250) ? "bad" : (n < 80 || n > 180) ? "warn" : null;
    case "pain":   return (n >= 7) ? "bad" : (n >= 4) ? "warn" : null;
    case "gcs":    return (n <= 8)  ? "bad" : (n < 13) ? "warn" : null;
    case "mews":   return (n >= 5)  ? "bad" : (n >= 3) ? "warn" : null;
    default: return null;
  }
}

function cellStyle(t) {
  if (t === "bad")  return { background: C.badL,  color: C.bad,  fontWeight: 800 };
  if (t === "warn") return { background: C.warnL, color: C.warn, fontWeight: 800 };
  return {};
}

export default function VitalsTrendModal({ uhid, ipdNo, patientName, onClose }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState(""); // "" = all

  const load = useCallback(async () => {
    if (!uhid && !ipdNo) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      // Prefer the IPD-keyed list — same endpoint Nursing Notes timeline uses.
      const url = ipdNo
        ? `${API_ENDPOINTS.BASE}/nurse-notes/ipd/${encodeURIComponent(ipdNo)}`
        : `${API_ENDPOINTS.BASE}/nurse-notes?patientUHID=${encodeURIComponent(uhid)}`;
      const { data } = await axios.get(url);
      const list = Array.isArray(data?.data) ? data.data
                : Array.isArray(data?.notes) ? data.notes
                : (Array.isArray(data) ? data : []);
      // Filter to the 4 allowed sources only.
      const filtered = list.filter(n => ALLOWED_TYPES.includes(n.noteType));
      // Skip notes that don't actually carry any vital values — saves
      // visual clutter when a Daily Assessment row was filed without
      // vitals (eg. behavioural-only update).
      // R7hr-182: compare mews/pain against "" — a charted MEWS total of 0
      // is falsy but IS data, while "" means the field was never captured.
      const mapped = filtered.map(extractVitals).filter(r =>
        r.bp || r.pulse || r.rr || r.spo2 || r.temp || r.pain !== "" || r.gcs || r.bsl || (r.mews !== "" && r.mews != null)
      );
      // newest-first chronological
      mapped.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));
      setRows(mapped);
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || "Could not load vitals trend");
    } finally { setLoading(false); }
  }, [uhid, ipdNo]);

  useEffect(() => { load(); }, [load]);

  // Close on Esc
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Per-source counts for the filter chips ─────────────────────
  const counts = useMemo(() => {
    const c = { all: rows.length };
    ALLOWED_TYPES.forEach(t => { c[t] = rows.filter(r => r.type === t).length; });
    return c;
  }, [rows]);

  const filteredRows = typeFilter ? rows.filter(r => r.type === typeFilter) : rows;

  return (
    <div
      className="hga-enter-fade"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(15,23,42,.55)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "5vh 16px", overflowY: "auto",
      }}>
      <div className="hga-pop" onClick={(e) => e.stopPropagation()} style={{
        width: "min(1100px, 100%)", background: "#fff", borderRadius: 14,
        boxShadow: "0 20px 50px rgba(0,0,0,.25)", overflow: "hidden",
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}>
        {/* Header */}
        <div style={{
          background: `linear-gradient(135deg, ${C.primary} 0%, ${C.primaryD} 100%)`,
          padding: "14px 18px", color: "#fff",
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}>
          <span style={{
            width: 38, height: 38, borderRadius: 10,
            background: "rgba(255,255,255,.18)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 18,
          }}>📈</span>
          <div style={{ flex: "1 1 auto" }}>
            <div style={{ fontSize: 16, fontWeight: 900 }}>Vitals Trend</div>
            <div style={{ fontSize: 11, opacity: .92, marginTop: 1 }}>
              Aggregated across Vital Signs · Daily Assessment · MEWS · Nursing Initial Assessment
              {patientName ? ` · ${patientName}` : ""}{uhid ? ` · UHID ${uhid}` : ""}
            </div>
          </div>
          <button onClick={onClose} title="Close (Esc)" style={{
            width: 32, height: 32, borderRadius: 8,
            background: "rgba(255,255,255,.18)",
            border: "1px solid rgba(255,255,255,.35)",
            color: "#fff", cursor: "pointer", fontSize: 16, fontWeight: 800,
          }}>×</button>
        </div>

        {/* Filter chips */}
        <div style={{
          padding: "10px 18px", borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
          background: "#fcfdff",
        }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginRight: 4 }}>
            Source
          </span>
          <button onClick={() => setTypeFilter("")} style={{
            padding: "5px 12px", borderRadius: 999,
            border: `1.5px solid ${typeFilter === "" ? C.primary : C.border}`,
            background: typeFilter === "" ? C.primary : "#fff",
            color: typeFilter === "" ? "#fff" : C.dark,
            fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            All
            <span style={{
              fontSize: 9, fontWeight: 800,
              background: typeFilter === "" ? "rgba(255,255,255,.25)" : "#f1f5f9",
              color:      typeFilter === "" ? "#fff" : C.muted,
              padding: "0 6px", borderRadius: 6, fontFamily: "'DM Mono', monospace",
            }}>{counts.all}</span>
          </button>
          {ALLOWED_TYPES.map(t => {
            const meta = SOURCE_META[t]; const active = typeFilter === t;
            return (
              <button key={t} onClick={() => setTypeFilter(t)} style={{
                padding: "5px 12px", borderRadius: 999,
                border: `1.5px solid ${active ? meta.fg : C.border}`,
                background: active ? meta.fg : "#fff",
                color: active ? "#fff" : C.dark,
                fontFamily: "inherit", fontWeight: 700, fontSize: 11, cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}>
                <span style={{ fontSize: 11 }}>{meta.icon}</span>
                {meta.short}
                <span style={{
                  fontSize: 9, fontWeight: 800,
                  background: active ? "rgba(255,255,255,.25)" : meta.bg,
                  color:      active ? "#fff" : meta.fg,
                  padding: "0 6px", borderRadius: 6, fontFamily: "'DM Mono', monospace",
                }}>{counts[t] || 0}</span>
              </button>
            );
          })}
          <span style={{ marginLeft: "auto", fontSize: 10.5, color: C.muted }}>
            Excludes blood transfusion + IV infusion charting (monitored separately)
          </span>
        </div>

        {/* Body */}
        <div style={{ maxHeight: "65vh", overflowY: "auto" }}>
          {loading && (
            <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>
              <i className="pi pi-spin pi-spinner" style={{ marginRight: 8 }} />Loading vitals…
            </div>
          )}
          {!loading && error && (
            <div style={{ padding: 24, textAlign: "center", color: C.bad, fontWeight: 700, fontSize: 12 }}>
              {error}
            </div>
          )}
          {!loading && !error && filteredRows.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>
              {rows.length === 0
                ? "No vitals charted yet. Vitals from Vital Signs / Daily Assessment / MEWS / Nursing Initial Assessment will appear here."
                : `No vitals charted under "${SOURCE_META[typeFilter]?.label || typeFilter}".`}
            </div>
          )}
          {!loading && !error && filteredRows.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{
                position: "sticky", top: 0, zIndex: 1,
                background: "#fcfdff", borderBottom: `1px solid ${C.border}`,
              }}>
                <tr style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px" }}>
                  <th style={{ padding: "9px 12px", textAlign: "left", fontWeight: 800 }}>When</th>
                  <th style={{ padding: "9px 12px", textAlign: "left", fontWeight: 800 }}>Source</th>
                  <th style={{ padding: "9px 8px",  textAlign: "center", fontWeight: 800 }}>BP</th>
                  <th style={{ padding: "9px 8px",  textAlign: "center", fontWeight: 800 }}>HR</th>
                  <th style={{ padding: "9px 8px",  textAlign: "center", fontWeight: 800 }}>RR</th>
                  <th style={{ padding: "9px 8px",  textAlign: "center", fontWeight: 800 }}>SpO₂</th>
                  <th style={{ padding: "9px 8px",  textAlign: "center", fontWeight: 800 }}>Temp</th>
                  <th style={{ padding: "9px 8px",  textAlign: "center", fontWeight: 800 }}>Pain</th>
                  <th style={{ padding: "9px 8px",  textAlign: "center", fontWeight: 800 }}>GCS</th>
                  <th style={{ padding: "9px 8px",  textAlign: "center", fontWeight: 800 }}>BSL</th>
                  <th style={{ padding: "9px 8px",  textAlign: "center", fontWeight: 800 }}>MEWS</th>
                  <th style={{ padding: "9px 12px", textAlign: "left", fontWeight: 800 }}>By</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const meta = SOURCE_META[r.type] || { label: r.type, short: r.type, icon: "📝", fg: C.slate, bg: C.slateL };
                  return (
                    <tr key={r._id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: "8px 12px", color: C.dark, fontWeight: 700, whiteSpace: "nowrap", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>
                        {fmtDateTime(r.when)}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{
                          fontSize: 10, fontWeight: 800,
                          background: meta.bg, color: meta.fg,
                          padding: "2px 8px", borderRadius: 999,
                          display: "inline-flex", alignItems: "center", gap: 5,
                        }}>
                          <span>{meta.icon}</span>{meta.short}
                        </span>
                      </td>
                      <td style={{ padding: "8px 8px", textAlign: "center", fontFamily: "'DM Mono', monospace", ...cellStyle(null) }}>
                        {r.bp || "—"}
                      </td>
                      <td style={{ padding: "8px 8px", textAlign: "center", fontFamily: "'DM Mono', monospace", ...cellStyle(tone("pulse", r.pulse)) }}>
                        {r.pulse || "—"}
                      </td>
                      <td style={{ padding: "8px 8px", textAlign: "center", fontFamily: "'DM Mono', monospace", ...cellStyle(tone("rr", r.rr)) }}>
                        {r.rr || "—"}
                      </td>
                      <td style={{ padding: "8px 8px", textAlign: "center", fontFamily: "'DM Mono', monospace", ...cellStyle(tone("spo2", r.spo2)) }}>
                        {r.spo2 ? `${r.spo2}%` : "—"}
                      </td>
                      <td style={{ padding: "8px 8px", textAlign: "center", fontFamily: "'DM Mono', monospace", ...cellStyle(tone("temp", r.temp)) }}>
                        {r.temp ? `${r.temp}°` : "—"}
                      </td>
                      <td style={{ padding: "8px 8px", textAlign: "center", fontFamily: "'DM Mono', monospace", ...cellStyle(tone("pain", r.pain)) }}>
                        {r.pain !== "" && r.pain != null ? `${r.pain}/10` : "—"}
                      </td>
                      <td style={{ padding: "8px 8px", textAlign: "center", fontFamily: "'DM Mono', monospace", ...cellStyle(tone("gcs", r.gcs)) }}>
                        {r.gcs || "—"}
                      </td>
                      <td style={{ padding: "8px 8px", textAlign: "center", fontFamily: "'DM Mono', monospace", ...cellStyle(tone("bsl", r.bsl)) }}>
                        {r.bsl ? `${r.bsl}` : "—"}
                      </td>
                      <td style={{ padding: "8px 8px", textAlign: "center", fontFamily: "'DM Mono', monospace", ...cellStyle(tone("mews", r.mews)) }}>
                        {r.mews !== "" && r.mews != null ? r.mews : "—"}
                      </td>
                      <td style={{ padding: "8px 12px", color: C.muted, fontSize: 11 }}>{r.by}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "10px 18px", borderTop: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "#fcfdff", fontSize: 11, color: C.muted, flexWrap: "wrap", gap: 8,
        }}>
          <span>
            <strong style={{ color: C.dark }}>{filteredRows.length}</strong> reading{filteredRows.length === 1 ? "" : "s"} ·
            Cells highlight when out of NABH AAC.5 escalation range.
          </span>
          <button onClick={onClose} style={{
            padding: "7px 16px", background: C.primary, color: "#fff", border: "none",
            borderRadius: 8, fontFamily: "inherit", fontWeight: 800, fontSize: 12, cursor: "pointer",
          }}>Close</button>
        </div>
      </div>
    </div>
  );
}
