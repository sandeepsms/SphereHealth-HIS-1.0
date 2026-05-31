// R7fu Theme 1 — Narrative Letter (DAY-FIRST stance)
//
// Re-organises the whole patient file around DAYS of stay rather than
// 25 flat sections. A consultant handover letter at heart, but the
// "Course of Stay" *is* the spine: Day 1 is the admission package
// (IA, first orders, first notes), Day 2 is the next clinical day,
// and so on. Discharge gets its own block at the tail. Everything
// that was a stand-alone section pre-R7fu (Doctor IA, Doctor Orders,
// MAR, Vitals trend, Notes, Consents) gets folded into the day it
// belongs to, with one rule: a fact appears ONCE.
//
// Why day-first:
//   • A doctor reading a stranger's IPD file reconstructs the
//     timeline in their head anyway. Print the timeline directly.
//   • Eliminates the dedupe problem — Brief, IA, Course no longer
//     restate the same chief-complaint line.
//   • False-flag dumps and rubric sub-scores collapse to a single
//     line each, freeing two pages on a typical admission.
//
// Layout:
//   1. Salutation
//   2. ENCOUNTER AT A GLANCE         — 8 hard facts, no prose
//   3. ALLERGY / ISOLATION ALERTS    — red + amber callouts
//   4. ADMISSION SNAPSHOT (Day 1)    — HOPI, exam, vitals, dx,
//                                       Doctor IA + Nursing IA folded
//                                       in as annotations, home meds,
//                                       risk scores, care plan
//   5. DAY 2, DAY 3 …                — clinical decisions of that
//                                       day, drug starts/stops,
//                                       observations, vitals trend
//                                       snapshot, notes prose, MAR
//                                       compact
//   6. INVESTIGATIONS                — abnormal first, then table
//   7. PROCEDURES / OT / TRANSFUSION — if any
//   8. CONSENTS                      — table
//   9. DISCHARGE BLOCK (last day)    — fitness, final dx, condition,
//                                       discharge meds table, advice
//                                       list, follow-up
//   10. Closing
//
// Hard requirements honoured:
//   * Only true booleans render (active-only rule).
//   * ObjectId hashes → "signed digitally".
//   * Risk scores → one line each (total + band only) unless
//     ?expandScores=1 in URL.
//   * Empty groups disappear entirely (no heading, no margin).
//   * Bold = key fact a doctor would underline. Italic = clinical
//     quote / "no abnormality detected".
//   * Two-level hierarchy: major section vs minor sub-heading.
//   * NABH chips right-aligned as pills.
//   * Receipt fallbacks: nurse chief → HOPI; f.medications → discharge
//     meds when discharge meds empty.
//   * English only. No emojis. Authoritative referring-physician tone.

import React from "react";
import PrintShell from "@/templates/PrintShell";
import { fmtDate, fmtTime, fmtDayMonth, pronoun } from "./normalizeData";

/* =====================================================================
   1. PROSE HELPERS (kept compatible with pre-R7fu Narrative)
   ===================================================================== */

const cleanSentence = (s) => {
  if (!s) return "";
  let out = String(s).replace(/\s+/g, " ").trim();
  if (!out) return "";
  if (!/[.!?]$/.test(out)) out += ".";
  return out[0].toUpperCase() + out.slice(1);
};

const oxford = (arr) => {
  const a = (arr || []).filter(Boolean).map((x) => String(x).trim());
  if (a.length === 0) return "";
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
};

const ageGenderPhrase = (age, gender) => {
  const g = String(gender || "").toLowerCase();
  const word = g.startsWith("f") ? "female"
             : g.startsWith("m") ? "male"
             : "patient";
  if (age && Number(age) > 0) return `${age}-year-old ${word}`;
  return word;
};

const honorific = (gender, fallback = "") => {
  const g = String(gender || "").toLowerCase();
  if (g.startsWith("f")) return "Ms.";
  if (g.startsWith("m")) return "Mr.";
  return fallback;
};

const fullNameWithHonorific = (name, gender) => {
  if (!name) return "the patient";
  const n = String(name).trim();
  if (/^(mr|mrs|ms|miss|dr|master|baby)\.?\s/i.test(n)) return n;
  const h = honorific(gender);
  return h ? `${h} ${n}` : n;
};

const stripDot = (s) => String(s || "").replace(/\.$/, "").trim();

/* ObjectId detector — anything 24 hex chars long shows as "signed
   digitally" so we never leak raw _id strings on the printout. */
const OBJECT_ID_RX = /^[0-9a-f]{24}$/i;
const isObjectId = (v) =>
  typeof v === "string" && OBJECT_ID_RX.test(v.trim());

const displayActor = (v, fallback = "signed digitally") => {
  if (v == null || v === "") return fallback;
  if (isObjectId(String(v))) return fallback;
  return String(v).trim();
};

/* Lab abnormality heuristics — same as pre-R7fu Narrative. */
const ABNORMAL_RX = /(hypo|hyper|deficien|elev(?:ated)?|low\b|high\b|↑|↓|positive|growth|raised|reduced|deranged|mild|moderate|severe)/i;
const NEGATIVE_RX = /(no growth|no\b.*pathogen|negative|nil|wnl|within normal|normal)/i;
const isResultAbnormal = (resultText) => {
  if (!resultText) return false;
  if (NEGATIVE_RX.test(resultText) && !ABNORMAL_RX.test(resultText)) return false;
  return ABNORMAL_RX.test(resultText);
};

const vitalsSentence = (v) => {
  if (!v || typeof v !== "object") return "";
  const bits = [];
  if (v.bp)    bits.push(`BP ${v.bp}`);
  if (v.pulse) bits.push(`pulse ${v.pulse}/min`);
  if (v.temp)  bits.push(`temperature ${v.temp}°F`);
  if (v.spo2)  bits.push(`SpO₂ ${v.spo2}%`);
  if (v.rr)    bits.push(`respiratory rate ${v.rr}/min`);
  if (!bits.length) return "";
  return `Admission vitals: ${oxford(bits)}.`;
};

const allergyLine = (a) => {
  if (!a) return "";
  if (typeof a === "string") return a;
  const agent = a.allergen || a.agent || a.name || "";
  const reaction = a.reaction || a.severity || "";
  return reaction ? `${agent} (${reaction})` : agent;
};

/* =====================================================================
   2. DATE / DAY HELPERS
   ===================================================================== */

const fmtDateTime = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(d); }
};

const fmtTimeOnly = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch { return String(d); }
};

const dayKey = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toISOString().slice(0, 10); // YYYY-MM-DD — stable sortable key
  } catch { return ""; }
};

const dayHeading = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", weekday: "short",
    });
  } catch { return String(d); }
};

/* Returns the day-of-stay number (1-based) for a given timestamp,
   anchored to admission date. Returns null if either is missing. */
const dayNumber = (eventDate, admissionDate) => {
  if (!eventDate || !admissionDate) return null;
  const a = new Date(admissionDate);
  const e = new Date(eventDate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(e.getTime())) return null;
  // Anchor on calendar dates (ignore time-of-day) so a 23:00 admission
  // and a 06:00 next-morning event count as Day 1 → Day 2 not Day 1 → Day 1.
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const end   = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  return Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
};

/* =====================================================================
   3. STYLE TOKENS — two-level hierarchy, tight whitespace
   ===================================================================== */

const COL = {
  ink:     "#0f172a",  // major heading / bold
  body:    "#1f2937",  // running text
  muted:   "#475569",  // sub-heading / minor labels
  faded:   "#94a3b8",  // chips, decorative
  accent:  "#1e3a8a",  // KEY-fact bold tint
  rule:    "#0f172a",  // section rule
  pillBg:  "#f1f5f9",
  pillTxt: "#475569",
  zebra:   "#fafbfd",
  abN:     "#b91c1c",  // abnormal red
  ok:      "#15803d",
};

const SH = {                       // section header (major, 12pt)
  fontFamily: "'DM Sans', Georgia, serif",
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: "0.6px",
  textTransform: "uppercase",
  color: COL.ink,
  borderBottom: `1px solid ${COL.rule}`,
  paddingBottom: 2,
  marginTop: 12,
  marginBottom: 6,
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 8,
};

const SUB = {                      // minor sub-heading (10pt small-caps)
  fontFamily: "'DM Sans', Georgia, serif",
  fontWeight: 600,
  fontSize: 10,
  letterSpacing: "0.5px",
  textTransform: "uppercase",
  color: COL.muted,
  margin: "8px 0 3px",
};

const DAY_LABEL = {                // "Day 1 (12 Apr · Wed)"
  fontFamily: "'DM Sans', Georgia, serif",
  fontWeight: 800,
  fontSize: 11,
  letterSpacing: "0.4px",
  color: COL.ink,
  background: COL.pillBg,
  padding: "3px 8px",
  borderRadius: 4,
  display: "inline-block",
  marginTop: 10,
  marginBottom: 4,
};

const PARA = {
  fontSize: 11,
  lineHeight: 1.4,
  color: COL.body,
  textAlign: "justify",
  margin: "0 0 5px 0",
};

const PILL = {
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: "0.4px",
  color: COL.pillTxt,
  background: COL.pillBg,
  padding: "1px 6px",
  borderRadius: 999,
};

const CELL_TH = {
  borderBottom: `1px solid #cbd5e1`,
  textAlign: "left",
  padding: "3px 5px",
  fontSize: 9,
  fontWeight: 700,
  color: COL.ink,
  background: COL.pillBg,
};
const CELL_TD = {
  borderBottom: `1px solid #e2e8f0`,
  padding: "3px 5px",
  fontSize: 9,
  color: COL.body,
  verticalAlign: "top",
};

/* =====================================================================
   4. PRIMITIVE COMPONENTS
   ===================================================================== */

const SectionHeader = ({ children, nabh }) => (
  <div style={SH} className="pr-section__title">
    <span>{children}</span>
    {nabh ? <span style={PILL}>{nabh}</span> : null}
  </div>
);

const SubHeader = ({ children }) => (
  <div style={SUB}>{children}</div>
);

const Para = ({ children, style }) => (
  <p style={{ ...PARA, ...(style || {}) }}>{children}</p>
);

const DayLabel = ({ n, date, totalDays }) => (
  <div style={DAY_LABEL}>
    Day {n}{totalDays ? `/${totalDays}` : ""} — {dayHeading(date)}
  </div>
);

const Table = ({ headers, rows, widths }) => (
  <table
    className="pr-table"
    style={{
      width: "100%",
      borderCollapse: "collapse",
      marginBottom: 6,
      fontSize: 9,
      pageBreakInside: "auto",
    }}
  >
    <thead>
      <tr>
        {headers.map((h, i) => (
          <th key={`th-${i}`} style={{ ...CELL_TH, width: widths?.[i] || "auto" }}>{h}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((cells, ri) => (
        <tr key={`tr-${ri}`} className="bill-line-row">
          {cells.map((c, ci) => (
            <td key={`td-${ri}-${ci}`} style={CELL_TD}>{c == null || c === "" ? "—" : c}</td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

const Callout = ({ tone = "red", title, children }) => {
  const palette = tone === "amber"
    ? { border: "#ca8a04", bg: "#fef9c3", text: "#713f12" }
    : { border: "#b91c1c", bg: "#fef2f2", text: "#7f1d1d" };
  return (
    <div
      style={{
        border: `1.5px solid ${palette.border}`,
        background: palette.bg,
        padding: "6px 12px",
        borderRadius: 4,
        margin: "8px 0 6px",
        color: palette.text,
        fontSize: 11,
        lineHeight: 1.4,
        pageBreakInside: "avoid",
      }}
    >
      {title ? (
        <div
          style={{
            fontWeight: 800,
            letterSpacing: "0.8px",
            textTransform: "uppercase",
            fontSize: 10.5,
            marginBottom: 2,
          }}
        >
          {title}
        </div>
      ) : null}
      <div>{children}</div>
    </div>
  );
};

/* =====================================================================
   5. ACTIVE-ONLY rule — boolean flag printers
   ===================================================================== */

/* Given an object whose values are mostly booleans (comorbidities,
   devices, code-status), render only the TRUE ones in bold; the
   rest collapses to a single muted "All other items: not applicable"
   sentence. NEVER prints "false". */
const activeFlags = (obj, labelMap, opts = {}) => {
  if (!obj || typeof obj !== "object") return { active: [], total: 0 };
  const active = [];
  let total = 0;
  for (const [key, label] of Object.entries(labelMap)) {
    total += 1;
    const v = obj[key];
    // truthy means: boolean true, "yes"/"y"/"true"/"present" string,
    // non-zero number. Anything else is treated as absent.
    if (v === true) { active.push(label); continue; }
    if (typeof v === "string") {
      const s = v.toLowerCase().trim();
      if (s === "yes" || s === "y" || s === "true" || s === "present") active.push(label);
      // (ignore "no"/"false"/"absent"/empty)
    } else if (typeof v === "number" && v !== 0 && !Number.isNaN(v)) {
      active.push(label);
    }
  }
  return { active, total, hasNegatives: !opts.silentNegatives && active.length < total };
};

const FlagLine = ({ obj, labelMap, label, allDescription }) => {
  const { active, total, hasNegatives } = activeFlags(obj, labelMap);
  if (active.length === 0 && total === 0) return null;
  if (active.length === 0) {
    return (
      <Para>
        <strong>{label}:</strong>{" "}
        <em style={{ color: COL.muted }}>{allDescription || "none on record."}</em>
      </Para>
    );
  }
  return (
    <Para>
      <strong>{label}:</strong>{" "}
      {active.map((a, i) => (
        <span key={`flg-${i}`}>
          <strong>{a}</strong>{i < active.length - 1 ? ", " : ""}
        </span>
      ))}
      {hasNegatives ? (
        <em style={{ color: COL.muted }}> · other items in the panel were marked negative.</em>
      ) : null}
    </Para>
  );
};

/* =====================================================================
   6. COMPACT RISK SCORE LINE
   ===================================================================== */

/* One-liner risk score: "Morse Fall Risk: 0/125 — *No risk*"
   When ?expandScores=1 the sub-scores get appended in mute.        */
const expandScoresFlag = () => {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get("expandScores") === "1";
  } catch { return false; }
};

/* riskBand("Morse Fall Risk", 0, 125, "No risk") */
const RiskLine = ({ label, value, max, band, sub }) => {
  if (value == null || value === "") return null;
  return (
    <Para style={{ marginBottom: 2 }}>
      <strong>{label}:</strong> {value}{max != null ? `/${max}` : ""}
      {band ? <> — <em>{band}</em></> : null}
      {expandScoresFlag() && sub ? (
        <span style={{ color: COL.muted }}> ({sub})</span>
      ) : null}
    </Para>
  );
};

/* Pick the first score value from a list of common aliases. */
const pick = (obj, ...keys) => {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== "") return v;
  }
  return null;
};

/* Best-effort band classifier when the backend didn't ship one. */
const morseBand = (v) => {
  const n = Number(v); if (!Number.isFinite(n)) return null;
  if (n === 0) return "No risk";
  if (n <= 24) return "Low risk";
  if (n <= 50) return "Moderate risk";
  return "High risk";
};
const bradenBand = (v) => {
  const n = Number(v); if (!Number.isFinite(n)) return null;
  if (n >= 19) return "No risk";
  if (n >= 15) return "Mild risk";
  if (n >= 13) return "Moderate risk";
  if (n >= 10) return "High risk";
  return "Severe risk";
};
const painBand = (v) => {
  const n = Number(v); if (!Number.isFinite(n)) return null;
  if (n === 0) return "No pain";
  if (n <= 3) return "Mild";
  if (n <= 6) return "Moderate";
  return "Severe";
};
const nutritionBand = (v) => {
  const n = Number(v); if (!Number.isFinite(n)) return null;
  if (n === 0) return "Low risk";
  if (n === 1) return "Medium risk";
  return "High risk";
};

/* =====================================================================
   7. GROUPING UTILITIES
   ===================================================================== */

/* Group an array of rows into Map<dayKey, items[]> using a getter
   for each row's timestamp. Days the patient isn't on the ward
   never enter the map. */
const groupByDay = (rows, getAt) => {
  const map = new Map();
  (rows || []).forEach((r) => {
    const at = getAt ? getAt(r) : r.at;
    const k = dayKey(at);
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  return map;
};

/* Build the canonical day index — every dayKey from admission date
   through discharge date (or last clinical event). Each entry has
   { n, date, key } so day-bucketed sections can look up labels
   without recomputing day-numbers everywhere. */
const buildDayIndex = (file, events) => {
  const adm = file.admission?.date;
  const dis = file.admission?.dischargeDate;
  if (!adm) return [];
  // Find latest date among admission, discharge, and any event.
  let last = dis || adm;
  (events || []).forEach((e) => {
    if (e.at && (new Date(e.at).getTime() > new Date(last).getTime())) last = e.at;
  });
  const a = new Date(adm);
  const startUtc = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const l = new Date(last);
  const endUtc = new Date(l.getFullYear(), l.getMonth(), l.getDate());
  const days = [];
  let cursor = startUtc.getTime();
  let n = 1;
  const cap = 30; // safety: 30-day max enumeration
  while (cursor <= endUtc.getTime() && n <= cap) {
    const d = new Date(cursor);
    days.push({ n, date: d, key: dayKey(d) });
    cursor += 86_400_000;
    n += 1;
  }
  return days;
};

/* =====================================================================
   8. ADL / BARTHEL helper
   ===================================================================== */

const BARTHEL_TOTAL_BAND = (total) => {
  const n = Number(total); if (!Number.isFinite(n)) return null;
  if (n >= 80) return "Independent";
  if (n >= 60) return "Mildly dependent";
  if (n >= 40) return "Moderately dependent";
  if (n >= 20) return "Severely dependent";
  return "Totally dependent";
};

const barthelTotal = (adl) => {
  if (!adl || typeof adl !== "object") return null;
  if (adl.total != null) return Number(adl.total);
  const keys = ["feeding","bathing","grooming","dressing","bowels","bladder","toilet","transfer","mobility","stairs"];
  let sum = 0; let any = false;
  for (const k of keys) {
    const v = Number(adl[k]);
    if (Number.isFinite(v)) { sum += v; any = true; }
  }
  return any ? sum : null;
};

/* =====================================================================
   9. PRIMARY THEME COMPONENT
   ===================================================================== */
const NarrativeTheme = ({ settings = {}, file, events = [], receipt = {} }) => {
  const f = file || {};
  const pn = pronoun(f.patient?.gender);
  const subj = pn.subj;
  const subjL = subj.toLowerCase();
  const pos = pn.pos;
  const obj = pn.obj;

  /* ── patient strip ──────────────────────────────────────────── */
  const genderAge = [
    f.patient?.age ? `${f.patient.age} yrs` : null,
    f.patient?.gender || null,
  ].filter(Boolean).join(" · ");

  const patientLeft = [
    { label: "Patient",     value: f.patient?.fullName || "—" },
    { label: "UHID",        value: f.meta?.uhid || "—" },
    { label: "IPD No",      value: f.meta?.ipdNo || "—" },
    { label: "Age / Sex",   value: genderAge || "—" },
    { label: "Blood Group", value: f.patient?.bloodGroup || "—" },
    { label: "Contact",     value: f.patient?.mobile || "—" },
  ];
  const patientRight = [
    { label: "Admitted",       value: fmtDate(f.admission?.date, true) },
    { label: "Discharged",     value: fmtDate(f.admission?.dischargeDate, true) },
    { label: "Length of Stay", value: f.admission?.totalDays != null ? `${f.admission.totalDays} day(s)` : "—" },
    { label: "Consultant",     value: f.admission?.consultant || "—" },
    { label: "Bed / Ward",     value: [f.admission?.bed, f.admission?.ward].filter(Boolean).join(" · ") || "—" },
    { label: "Department",     value: f.admission?.department || "—" },
  ];

  const signatures = {
    type: "single",
    centre: {
      name: displayActor(f.signatures?.consultant || f.admission?.consultant, ""),
      role: "Consultant in charge",
      reg: displayActor(f.ia?.doctor?.signedByReg, ""),
    },
  };

  /* ── derived names ──────────────────────────────────────────── */
  const fullName = fullNameWithHonorific(f.patient?.fullName, f.patient?.gender);
  const ageGender = ageGenderPhrase(f.patient?.age, f.patient?.gender);

  /* ── HOPI with fallback to nurse chief-complaint ──────────── */
  // Rule L: if doctor HOPI is missing, promote nurse chiefComplaint.
  let hopiText = stripDot(f.history?.hopi || "");
  const chief = stripDot(f.history?.chief || f.ia?.nursing?.chiefComplaint || "");
  if (!hopiText) {
    const nurseChief = stripDot(f.ia?.nursing?.chiefComplaint || "");
    if (nurseChief) hopiText = nurseChief;
  }

  /* ── Discharge meds with fallback (Rule M) ──────────────────── */
  let dischargeMeds = Array.isArray(f.discharge?.medications) ? f.discharge.medications : [];
  if (!dischargeMeds.length && Array.isArray(f.medications)) {
    // Fallback: medications active at discharge time
    const disAt = f.admission?.dischargeDate ? new Date(f.admission.dischargeDate).getTime() : null;
    const fallback = f.medications.filter((m) => {
      if (!m.endDate && !m.startDate) return false;
      const startOk = m.startDate ? new Date(m.startDate).getTime() <= (disAt || Infinity) : true;
      const endOk   = m.endDate   ? new Date(m.endDate).getTime()   >= (disAt || 0)        : true;
      return startOk && endOk;
    }).map((m) => ({
      name: m.drug || "",
      generic: m.generic || "",
      dose: m.dose || "",
      route: m.route || "",
      frequency: m.frequency || "",
      duration: m.endDate ? `Until ${fmtDate(m.endDate)}` : "Continued",
      instructions: m.indication || "",
    }));
    if (fallback.length) dischargeMeds = fallback;
  }

  /* ── Build day index from admission → discharge ────────────── */
  const dayIndex = buildDayIndex(f, events);
  const totalDays = f.admission?.totalDays || dayIndex.length;

  /* ── Index events by day ────────────────────────────────────── */
  // Track which structured rows have been pulled into a day so we
  // don't double-render them when the "leftover" tables run later.
  const eventsByDay = new Map();
  (events || []).forEach((e) => {
    const k = dayKey(e.at);
    if (!k) return;
    if (!eventsByDay.has(k)) eventsByDay.set(k, []);
    eventsByDay.get(k).push(e);
  });

  /* ── Index doctor/nursing notes by day ──────────────────────── */
  const doctorNotesByDay = groupByDay(f.doctorNotes, (n) => n.createdAt);
  const nursingNotesByDay = groupByDay(f.nursingNotes, (n) => n.createdAt);

  /* ── Index orders, MAR, vitals, I/O by day ──────────────────── */
  const ordersByDay = groupByDay(f.doctorOrders, (o) => o.orderedAt);
  const marByDay    = groupByDay(f.mar,          (m) => m.givenAt || m.createdAt);
  const vitalsByDay = groupByDay(f.vitalsTrend,  (v) => v.at);
  const ioByDay     = groupByDay(f.intakeOutput, (io) => io.at);
  const handoversByDay = groupByDay(f.shiftHandovers, (h) => h.at);
  const transfusionByDay = groupByDay(f.bloodTransfusion, (b) => b.at);
  const bedTransfersByDay = groupByDay(f.bedTransfers, (t) => t.at);

  /* ── Procedures and consents — typically Day 1 but day-indexed ── */
  const proceduresByDay = groupByDay(f.procedures, (p) => p.date);
  const consentsByDay = groupByDay(f.consents, (c) => c.signedAt);

  /* ── Diagnosis triplet ──────────────────────────────────────── */
  const dxProv = f.admission?.provisionalDiagnosis || f.ia?.doctor?.provisionalDiagnosis || "";
  const dxWork = f.admission?.workingDiagnosis || f.ia?.doctor?.workingDiagnosis || "";
  const dxFinal = f.admission?.finalDiagnosis || f.ia?.doctor?.finalDiagnosis || "";

  /* ── Investigations split ───────────────────────────────────── */
  const invs = (f.investigations || []).filter((i) => i.name);
  const abnormalInvs = invs.filter((i) => isResultAbnormal(i.result));
  const normalInvs   = invs.filter((i) => !isResultAbnormal(i.result));

  /* ── Allergies + isolation ──────────────────────────────────── */
  const allergies = (f.alerts?.allergies || []).map(allergyLine).filter(Boolean);
  const isolationFlags = (f.alerts?.isolationFlags || []).filter(Boolean);

  /* ── Comorbidities flag map (active-only) ───────────────────── */
  const comorbiditiesLabels = {
    diabetes: "Diabetes mellitus",
    hypertension: "Hypertension",
    cad: "Coronary artery disease",
    ihd: "Ischaemic heart disease",
    copd: "COPD",
    asthma: "Asthma",
    ckd: "Chronic kidney disease",
    cld: "Chronic liver disease",
    stroke: "Prior CVA / stroke",
    cancer: "Active malignancy",
    tb: "Tuberculosis",
    hiv: "HIV",
    hepb: "Hepatitis B",
    hepc: "Hepatitis C",
    thyroid: "Thyroid disorder",
    epilepsy: "Epilepsy",
    psych: "Psychiatric illness",
  };
  const comorbidities = f.ia?.doctor?.comorbidities
                     || f.ia?.nursing?.comorbidities
                     || receipt.comorbidities
                     || null;

  /* ── Devices flag map (active-only) ─────────────────────────── */
  const devicesLabels = {
    ivCannula: "IV cannula",
    centralLine: "Central line",
    urinaryCatheter: "Urinary catheter",
    foleys: "Foley's catheter",
    rylesTube: "Ryle's tube",
    ngTube: "NG tube",
    et: "ET tube",
    tracheostomy: "Tracheostomy",
    chestDrain: "Chest drain",
    drain: "Surgical drain",
    pacemaker: "Pacemaker",
    ostomy: "Ostomy",
  };
  const devices = f.ia?.nursing?.devices
               || f.ia?.doctor?.devices
               || receipt.devices
               || null;

  /* ── Skin / pressure-area flag map ──────────────────────────── */
  const skinLabels = {
    intact: "Intact",
    dry: "Dry",
    pruritic: "Pruritic",
    pressureUlcer: "Pressure ulcer present",
    rash: "Rash",
    bruises: "Bruises",
    abrasions: "Abrasions",
    surgicalWound: "Surgical wound",
    dressing: "Dressing in situ",
  };
  const skin = f.ia?.nursing?.skin
            || f.ia?.doctor?.skin
            || receipt.skin
            || null;

  /* ── Code Status (single field, not flags) ─────────────────── */
  const codeStatus = f.ia?.doctor?.codeStatus
                  || f.ia?.nursing?.codeStatus
                  || receipt.codeStatus
                  || "";

  /* ── Home meds (already in f.history.homeMeds) ─────────────── */
  const homeMeds = Array.isArray(f.history?.homeMeds) ? f.history.homeMeds : [];

  /* ── Care plan (text or list) ───────────────────────────────── */
  const carePlan = f.ia?.nursing?.carePlan
                || f.ia?.doctor?.plan
                || f.ia?.doctor?.managementPlan
                || receipt.carePlan
                || "";

  /* ── Risk scores extraction ─────────────────────────────────── */
  const n = f.ia?.nursing || {};
  const d = f.ia?.doctor || {};

  // R7ft-FIX4-PATCH — pick() previously listed bare object names ("morse",
  // "braden", "pain", "nutri", "vte", "dvt") in the alias list. When R7fc
  // saves the nurse IA, those keys are NESTED OBJECTS like
  // { scores:{…}, total:0, risk:"No Risk" } — pick() returned the OBJECT
  // which then crashed React with "Objects are not valid as a React child
  // (found: object with keys {scores, total, risk})". Now we look for the
  // scalar fields first and explicitly drill into .total / .score / .risk
  // for the nested shapes, never the bare object.
  const scalarOrNum = (v) => (v != null && (typeof v === "number" || typeof v === "string")) ? v : null;
  const morseVal   = pick(n, "fallRisk", "morseTotal", "morseScore") ?? scalarOrNum(n.morse?.total);
  const bradenVal  = pick(n, "pressureUlcer", "bradenTotal", "bradenScore") ?? scalarOrNum(n.braden?.total);
  const painVal    = pick(n, "painScore", "vasPain") ?? scalarOrNum(n.pain?.score) ?? scalarOrNum(n.pain?.total);
  const nutriVal   = pick(n, "nutritionScore", "must", "nutriRisk", "mna") ?? scalarOrNum(n.nutrition?.score) ?? scalarOrNum(n.nutri?.total);
  const vteVal     = pick(n, "vteRisk", "padua") ?? scalarOrNum(n.vte?.total) ?? scalarOrNum(d.vte?.total) ?? pick(d, "vteRisk", "padua");
  const dvtVal     = pick(n, "dvtRisk") ?? scalarOrNum(n.dvt?.total) ?? pick(d, "dvtRisk");
  const gcsVal     = pick(d, "gcs", "GCS") ?? scalarOrNum(d.gcs?.total) ?? pick(n, "gcs", "GCS");
  // Risk-band strings (override the heuristic banders when the IA carries
  // an explicit `.risk` label like "No Risk" / "Lowest Risk").
  const morseRisk  = (typeof n.morse?.risk === "string") ? n.morse.risk : null;
  const bradenRisk = (typeof n.braden?.risk === "string") ? n.braden.risk : null;
  const nutriRisk  = (typeof n.nutri?.risk === "string") ? n.nutri.risk : (typeof n.nutrition?.risk === "string" ? n.nutrition.risk : null);
  const vteRisk    = (typeof n.vte?.risk === "string") ? n.vte.risk : null;

  /* ── Doctor / Nursing IA actor lines ────────────────────────── */
  const dIASigner = displayActor(d.signedByName || d.signedBy, "signed digitally");
  const dIAReg    = displayActor(d.signedByReg || d.mciRegNo, "");
  const dIAAt     = d.signedAt || d.assessmentDate;
  const nIASigner = displayActor(n.nurseName || n.signedByName || n.signedBy, "signed digitally");
  const nIAAt     = n.signedAt || n.submittedAt;

  /* ── Past history + family + social one-liner ───────────────── */
  const pastLine = (() => {
    const bits = [];
    if (f.history?.medical)  bits.push(`past medical history is significant for ${stripDot(f.history.medical)}`);
    if (f.history?.surgical) bits.push(`past surgical history includes ${stripDot(f.history.surgical)}`);
    return bits.length ? cleanSentence(bits.join("; ")) : "";
  })();

  const famSocLine = (() => {
    const bits = [];
    if (f.history?.family) bits.push(`family history: ${stripDot(f.history.family)}`);
    if (f.history?.social) bits.push(`social history: ${stripDot(f.history.social)}`);
    return bits.length ? cleanSentence(bits.join(". ")) : "";
  })();

  /* ── Exam paragraphs ────────────────────────────────────────── */
  const examLines = [];
  if (f.exam?.generalExam) examLines.push(cleanSentence(`On general examination ${stripDot(f.exam.generalExam)}`));
  if (f.exam?.systemicExam) examLines.push(cleanSentence(`On systemic examination ${stripDot(f.exam.systemicExam)}`));
  const vSent = vitalsSentence(f.vitals?.onAdmission);
  if (vSent) examLines.push(vSent);

  /* ── ROS one-liner ─────────────────────────────────────────── */
  const rosLine = (() => {
    const ros = f.exam?.ros || {};
    if (!ros || typeof ros !== "object") return "";
    const order = [
      ["cvs", "CVS"], ["rs", "RS"], ["git", "GIT"], ["gut", "GUT"],
      ["cns", "CNS"], ["msk", "MSK"], ["skin", "Skin"], ["heent", "HEENT"],
      ["endo", "Endocrine"], ["psych", "Psych"],
    ];
    const bits = order
      .map(([k, label]) => (ros[k] ? `${label}: ${String(ros[k]).trim()}` : ""))
      .filter(Boolean);
    return bits.join("; ");
  })();

  /* ── Helper to compose drug name from a doctor-order row ──── */
  const orderDetailLine = (o) => {
    const det = [o.displayName, o.dose, o.route, o.frequency].filter(Boolean).join(" · ");
    return det || "—";
  };

  /* ── Course-of-stay event summariser per day. Returns a single
        natural-language sentence weaving the day's clinical events,
        drug starts/stops, lab reports, etc. */
  const courseSentenceForDay = (k) => {
    const dayEvents = eventsByDay.get(k) || [];
    // Filter out per-day repetitive kinds we render in tables (lab-order
    // and lab-report show up in the Investigations section instead).
    const KEEP = new Set(["doctor-note", "med-start", "med-stop", "procedure", "ia-doctor", "ia-nursing", "lab-report", "admission", "discharge"]);
    const bits = dayEvents.filter((e) => KEEP.has(e.kind)).map((e) => {
      if (e.kind === "doctor-note" && e.detail) return stripDot(e.detail);
      return stripDot(e.summary || "");
    }).filter(Boolean);
    if (!bits.length) return "";
    return cleanSentence(bits.join(". "));
  };

  /* ── Helpers for Day 1 callouts: did doctor IA get signed? ─── */
  const day1Key = dayIndex[0]?.key || "";
  const lastDayKey = dayIndex[dayIndex.length - 1]?.key || "";

  /* ====================================================================
     CHILDREN
     ==================================================================== */
  return (
    <PrintShell
      hospital={settings}
      docTitle="Complete Patient File"
      docSubtitle="Confidential medical record — full chronological account of the in-patient stay"
      patient={{ left: patientLeft, right: patientRight }}
      signatures={signatures}
      banners={{ emergency24x7: true }}
      meta={{
        docNumber: f.meta?.ipdNo || "",
        pageOf: "",
        printedAt: f.meta?.printedAt
          ? new Date(f.meta.printedAt).toISOString()
          : new Date().toISOString(),
      }}
    >
      {/* Opening salutation */}
      <p
        style={{
          fontSize: 11,
          fontStyle: "italic",
          color: COL.muted,
          marginTop: 4,
          marginBottom: 8,
        }}
      >
        {f.admission?.referringDoctor
          ? `Dear ${f.admission.referringDoctor},`
          : "Dear Colleague,"}
      </p>

      <Para>
        This is the <strong>complete patient file</strong> for {fullName} —
        a full chronological record of the in-patient stay, including the
        Doctor and Nursing Initial Assessments, every progress note,
        treatment order, medication administration, vital sign reading,
        intake / output entry, investigation, lab report, consent, dietetic
        plan, ICU care-bundle compliance, blood transfusion, bed transfer
        and discharge summary on file for this admission. Each day section
        bundles the clinical decisions, drugs started or stopped, and
        observations recorded on that day; discrete cross-day data is
        tabled at the end.
      </Para>

      {/* ════════════════════════════════════════════════════════════
          1. ENCOUNTER AT A GLANCE — eight hard facts, no prose.
          ════════════════════════════════════════════════════════════ */}
      <SectionHeader>Encounter at a Glance</SectionHeader>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, marginBottom: 4 }}>
        <tbody>
          <tr>
            <td style={{ width: "22%", padding: "2px 6px", color: COL.muted }}>Patient</td>
            <td style={{ padding: "2px 6px", color: COL.body }}>
              <strong>{fullName}</strong>, {ageGender}
              {f.patient?.bloodGroup ? <>, blood group <strong>{f.patient.bloodGroup}</strong></> : null}.
            </td>
          </tr>
          <tr>
            <td style={{ padding: "2px 6px", color: COL.muted }}>Admission</td>
            <td style={{ padding: "2px 6px", color: COL.body }}>
              {fmtDate(f.admission?.date, true)}
              {f.admission?.type ? <> via <strong>{f.admission.type}</strong></> : null}
              {f.admission?.modeOfArrival ? <> ({f.admission.modeOfArrival})</> : null}
              {f.admission?.referringDoctor ? <>, referred by {f.admission.referringDoctor}</> : null}.
            </td>
          </tr>
          <tr>
            <td style={{ padding: "2px 6px", color: COL.muted }}>Discharge</td>
            <td style={{ padding: "2px 6px", color: COL.body }}>
              {f.admission?.dischargeDate ? fmtDate(f.admission.dischargeDate, true) : "—"}
              {f.admission?.totalDays ? <> · stay <strong>{f.admission.totalDays} day(s)</strong></> : null}
              {f.discharge?.condition ? <> · condition at discharge <strong>{f.discharge.condition}</strong></> : null}.
            </td>
          </tr>
          <tr>
            <td style={{ padding: "2px 6px", color: COL.muted }}>Consultant</td>
            <td style={{ padding: "2px 6px", color: COL.body }}>
              <strong>{f.admission?.consultant || "—"}</strong>
              {f.admission?.department ? <>, {f.admission.department}</> : null}
              {f.admission?.bed ? <> · bed {f.admission.bed}</> : null}
              {f.admission?.ward ? <> · {f.admission.ward}</> : null}.
            </td>
          </tr>
          {dxProv ? (
            <tr>
              <td style={{ padding: "2px 6px", color: COL.muted }}>Provisional</td>
              <td style={{ padding: "2px 6px", color: COL.body }}><strong>{dxProv}</strong></td>
            </tr>
          ) : null}
          {dxWork && dxWork !== dxProv ? (
            <tr>
              <td style={{ padding: "2px 6px", color: COL.muted }}>Working</td>
              <td style={{ padding: "2px 6px", color: COL.body }}><strong>{dxWork}</strong></td>
            </tr>
          ) : null}
          {dxFinal && dxFinal !== dxWork ? (
            <tr>
              <td style={{ padding: "2px 6px", color: COL.muted }}>Final diagnosis</td>
              <td style={{ padding: "2px 6px", color: COL.body }}>
                <strong>{dxFinal}</strong>
                {f.admission?.icd10 ? <> · ICD-10 <em>{f.admission.icd10}{f.admission.icd10Desc ? ` (${f.admission.icd10Desc})` : ""}</em></> : null}
              </td>
            </tr>
          ) : null}
          {chief ? (
            <tr>
              <td style={{ padding: "2px 6px", color: COL.muted }}>Chief complaint</td>
              <td style={{ padding: "2px 6px", color: COL.body }}>{chief}.</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {/* ════════════════════════════════════════════════════════════
          2. ALERTS — allergies (red), isolation (amber)
          ════════════════════════════════════════════════════════════ */}
      {allergies.length > 0 && (
        <Callout tone="red" title="Allergy alert">
          <strong>{oxford(allergies)}.</strong>{" "}
          Avoid the noted agents and verify any prescribed substitutes
          against this list.
        </Callout>
      )}
      {isolationFlags.length > 0 && (
        <Callout tone="amber" title="Isolation precautions">
          <strong>{oxford(isolationFlags)}.</strong> Universal and
          contact precautions to be observed by all care providers.
        </Callout>
      )}

      {/* ════════════════════════════════════════════════════════════
          3. CLINICAL TIMELINE — Day-by-day account
          ════════════════════════════════════════════════════════════ */}
      <SectionHeader>Clinical Timeline — Day by Day</SectionHeader>

      {dayIndex.length === 0 ? (
        <Para style={{ color: COL.muted, fontStyle: "italic" }}>
          Admission date is missing; chronological day buckets could
          not be constructed.
        </Para>
      ) : null}

      {dayIndex.map((day) => {
        const k = day.key;
        const isDay1 = k === day1Key;
        const isLastDay = k === lastDayKey;
        const dayDocNotes = doctorNotesByDay.get(k) || [];
        const dayNurseNotes = nursingNotesByDay.get(k) || [];
        const dayOrders = ordersByDay.get(k) || [];
        const dayMar = marByDay.get(k) || [];
        const dayVitals = vitalsByDay.get(k) || [];
        const dayIO = ioByDay.get(k) || [];
        const dayHandovers = handoversByDay.get(k) || [];
        const dayTransfusion = transfusionByDay.get(k) || [];
        const dayBedTransfers = bedTransfersByDay.get(k) || [];
        const dayProcedures = proceduresByDay.get(k) || [];
        const dayConsents = consentsByDay.get(k) || [];
        const courseSent = courseSentenceForDay(k);

        // Decide whether this day has ANY content. If it doesn't AND
        // it isn't Day 1 / last day, skip entirely.
        const hasAny = (
          isDay1 ||
          isLastDay ||
          dayDocNotes.length ||
          dayNurseNotes.length ||
          dayOrders.length ||
          dayMar.length ||
          dayVitals.length ||
          dayIO.length ||
          dayHandovers.length ||
          dayTransfusion.length ||
          dayBedTransfers.length ||
          dayProcedures.length ||
          dayConsents.length ||
          !!courseSent
        );
        if (!hasAny) return null;

        return (
          <div key={`day-${k}`} className="pr-section" style={{ pageBreakInside: "auto" }}>
            <DayLabel n={day.n} date={day.date} totalDays={totalDays} />

            {/* ───── DAY 1: Admission narrative + IA folded in ───── */}
            {isDay1 ? (
              <>
                {/* Day-1 opening line */}
                <Para>
                  {fullName} was <strong>admitted</strong> on{" "}
                  <strong>{fmtDate(f.admission?.date, true)}</strong>
                  {f.admission?.modeOfArrival ? <> via {f.admission.modeOfArrival.toLowerCase()}</> : null}
                  {f.admission?.consultant ? <> under the care of <strong>{f.admission.consultant}</strong></> : null}
                  {f.admission?.bed ? <> to bed {f.admission.bed}</> : null}
                  {f.admission?.ward ? <>, {f.admission.ward}</> : null}.
                  {chief ? <> Chief complaints at presentation were <strong>{chief}</strong>.</> : null}
                </Para>

                {/* HOPI */}
                {hopiText ? (
                  <>
                    <SubHeader>History of Presenting Illness</SubHeader>
                    {hopiText.split(/\n+/).map((t, i) =>
                      t.trim() ? <Para key={`hopi-${i}`}>{cleanSentence(t)}</Para> : null
                    )}
                  </>
                ) : null}

                {/* Past, family, social */}
                {(pastLine || famSocLine) ? (
                  <>
                    <SubHeader>Past · Family · Social History</SubHeader>
                    {pastLine ? <Para>{pastLine}</Para> : null}
                    {famSocLine ? <Para>{famSocLine}</Para> : null}
                  </>
                ) : null}

                {/* Home medications */}
                {homeMeds.length > 0 ? (
                  <>
                    <SubHeader>Home Medications</SubHeader>
                    <Para>
                      {subj} reports being on{" "}
                      <strong>
                        {oxford(homeMeds.map((m) =>
                          typeof m === "string" ? m
                            : [m.drug || m.name, m.dose, m.frequency].filter(Boolean).join(" ")))}
                      </strong>{" "}
                      at home.
                    </Para>
                  </>
                ) : null}

                {/* Examination & vitals */}
                {examLines.length > 0 ? (
                  <>
                    <SubHeader>Examination on Admission</SubHeader>
                    {examLines.map((t, i) => <Para key={`ex-${i}`}>{t}</Para>)}
                    {rosLine ? <Para><strong>Review of systems:</strong> {rosLine}.</Para> : null}
                  </>
                ) : null}

                {/* Comorbidities — active only (active-only rule) */}
                {comorbidities ? (
                  <>
                    <SubHeader>Comorbidities</SubHeader>
                    <FlagLine
                      obj={comorbidities}
                      labelMap={comorbiditiesLabels}
                      label="Significant comorbidities"
                      allDescription="screened — none reported."
                    />
                  </>
                ) : null}

                {/* Devices on admission */}
                {devices ? (
                  <>
                    <SubHeader>Devices in situ</SubHeader>
                    <FlagLine
                      obj={devices}
                      labelMap={devicesLabels}
                      label="Devices present"
                      allDescription="none in situ at admission."
                    />
                  </>
                ) : null}

                {/* Skin */}
                {skin ? (
                  <>
                    <SubHeader>Skin / pressure-area survey</SubHeader>
                    <FlagLine
                      obj={skin}
                      labelMap={skinLabels}
                      label="Skin findings"
                      allDescription="no abnormality detected."
                    />
                  </>
                ) : null}

                {/* Risk scores — compact one-liners */}
                {(morseVal != null || bradenVal != null || painVal != null || nutriVal != null || vteVal != null || dvtVal != null || gcsVal != null) ? (
                  <>
                    <SubHeader>Risk-screening Scores</SubHeader>
                    <RiskLine label="Morse Fall Risk" value={morseVal} max={125} band={morseRisk || morseBand(morseVal)} sub="see expanded scoring" />
                    <RiskLine label="Braden Pressure-ulcer Risk" value={bradenVal} max={23} band={bradenRisk || bradenBand(bradenVal)} sub="see expanded scoring" />
                    <RiskLine label="Pain (numeric rating)" value={painVal} max={10} band={painBand(painVal)} />
                    <RiskLine label="Nutritional risk (MUST)" value={nutriVal} max={6} band={nutriRisk || nutritionBand(nutriVal)} />
                    <RiskLine label="DVT risk" value={dvtVal} max={null} band={null} />
                    <RiskLine label="VTE risk (Padua)" value={vteVal} max={null} band={vteRisk} />
                    <RiskLine label="Glasgow Coma Scale" value={gcsVal} max={15} band={null} />
                  </>
                ) : null}

                {/* ADL (Barthel) — table only when at least one item recorded */}
                {(() => {
                  const adl = n.adl || n.barthel || {};
                  const total = barthelTotal(adl);
                  if (total == null) return null;
                  return (
                    <>
                      <SubHeader>Activities of Daily Living (Barthel)</SubHeader>
                      <Para>
                        Barthel total <strong>{total}/100</strong>
                        {BARTHEL_TOTAL_BAND(total) ? <> — <em>{BARTHEL_TOTAL_BAND(total)}</em></> : null}.
                      </Para>
                    </>
                  );
                })()}

                {/* Code status */}
                {codeStatus ? (
                  <>
                    <SubHeader>Code status</SubHeader>
                    <Para><strong>{codeStatus}</strong> documented at admission.</Para>
                  </>
                ) : null}

                {/* Care plan */}
                {carePlan ? (
                  <>
                    <SubHeader>Initial care plan</SubHeader>
                    <Para>{cleanSentence(carePlan)}</Para>
                  </>
                ) : null}

                {/* Working diagnosis at admission */}
                {(dxProv || dxWork) ? (
                  <Para>
                    {dxProv ? <><strong>Provisional diagnosis:</strong> {dxProv}.</> : null}
                    {dxWork && dxWork !== dxProv ? <> <strong>Working diagnosis:</strong> {dxWork}.</> : null}
                  </Para>
                ) : null}

                {/* IA actors / signatures — minor */}
                {Object.keys(d).length > 0 ? (
                  <Para style={{ color: COL.muted, fontSize: 10, marginBottom: 2 }}>
                    <em>
                      Doctor initial assessment signed by {dIASigner}
                      {dIAReg ? ` (Reg ${dIAReg})` : ""}
                      {dIAAt ? ` · ${fmtDateTime(dIAAt)}` : ""}.
                    </em>
                  </Para>
                ) : null}
                {Object.keys(n).length > 0 ? (
                  <Para style={{ color: COL.muted, fontSize: 10, marginBottom: 4 }}>
                    <em>
                      Nursing initial assessment signed by {nIASigner}
                      {nIAAt ? ` · ${fmtDateTime(nIAAt)}` : ""}.
                    </em>
                  </Para>
                ) : null}
              </>
            ) : null}

            {/* ───── Procedures performed today ───── */}
            {dayProcedures.length > 0 ? (
              <>
                <SubHeader>Procedures performed</SubHeader>
                {dayProcedures.map((p, i) => (
                  <Para key={`proc-${k}-${i}`}>
                    <strong>{p.name}</strong>
                    {p.surgeon ? <> by <strong>{displayActor(p.surgeon)}</strong></> : null}
                    {p.anaesthetist ? <> (anaesthetist: {displayActor(p.anaesthetist)})</> : null}.
                    {p.findings ? <> <em>Operative findings: {stripDot(p.findings)}.</em></> : null}
                    {p.notes ? <> {cleanSentence(p.notes)}</> : null}
                  </Para>
                ))}
              </>
            ) : null}

            {/* ───── Transfusion today ───── */}
            {dayTransfusion.length > 0 ? (
              <>
                <SubHeader>Blood transfusion</SubHeader>
                <Table
                  headers={["Time", "Component", "Bag", "Vol", "Pre BP/P", "Post BP/P", "Reaction", "Tx by"]}
                  rows={dayTransfusion.map((b) => [
                    fmtTimeOnly(b.at),
                    b.component || "—",
                    b.bagNumber || "—",
                    b.volumeMl != null ? `${b.volumeMl} mL` : "—",
                    `${b.preVitals?.bp || "—"} / ${b.preVitals?.pulse || "—"}`,
                    `${b.postVitals?.bp || "—"} / ${b.postVitals?.pulse || "—"}`,
                    <span style={{ color: b.reaction ? COL.abN : COL.body, fontWeight: b.reaction ? 700 : 400 }}>
                      {b.reaction ? `Yes${b.reactionType ? ` — ${b.reactionType}` : ""}` : "No"}
                    </span>,
                    displayActor(b.transfusedBy),
                  ])}
                  widths={["10%", "12%", "10%", "8%", "12%", "12%", "16%", "20%"]}
                />
              </>
            ) : null}

            {/* ───── Consents signed today ───── */}
            {dayConsents.length > 0 ? (
              <>
                <SubHeader>Consents signed</SubHeader>
                <Table
                  headers={["Form", "Signed by", "Witness", "Time"]}
                  rows={dayConsents.map((c) => [
                    c.name || "—",
                    displayActor(c.signedBy),
                    displayActor(c.witness),
                    c.signedAt ? fmtTimeOnly(c.signedAt) : "—",
                  ])}
                  widths={["44%", "22%", "20%", "14%"]}
                />
              </>
            ) : null}

            {/* ───── Bed transfers today ───── */}
            {dayBedTransfers.length > 0 ? (
              <>
                <SubHeader>Bed transfers</SubHeader>
                {dayBedTransfers.map((t, i) => (
                  <Para key={`bt-${k}-${i}`}>
                    Moved from <strong>{t.fromBed || "—"}</strong> to{" "}
                    <strong>{t.toBed || "—"}</strong>
                    {t.reason ? <> — {t.reason.toLowerCase()}</> : null}
                    {t.by ? <> by {displayActor(t.by)}</> : null} at {fmtTimeOnly(t.at)}.
                  </Para>
                ))}
              </>
            ) : null}

            {/* ───── Course narrative for the day (event prose) ───── */}
            {courseSent && !isDay1 ? (
              <>
                <SubHeader>Clinical events</SubHeader>
                <Para>{courseSent}</Para>
              </>
            ) : null}
            {courseSent && isDay1 ? (
              // For Day 1, only print the course sentence if it adds
              // *new* information not already in the admission line.
              <Para style={{ marginTop: 4 }}>{courseSent}</Para>
            ) : null}

            {/* ───── Doctor notes today (verbatim, bold header) ───── */}
            {dayDocNotes.length > 0 ? (
              <>
                <SubHeader>Doctor's notes</SubHeader>
                {dayDocNotes.map((dn, i) => (
                  <Para key={`dn-${k}-${i}`}>
                    <strong>
                      {fmtTimeOnly(dn.createdAt)} · {dn.noteType || "Progress"}
                      {dn.doctorName ? ` · ${displayActor(dn.doctorName)}` : ""}:
                    </strong>{" "}
                    {dn.content}
                  </Para>
                ))}
              </>
            ) : null}

            {/* ───── Doctor orders today (compact table) ───── */}
            {dayOrders.length > 0 ? (
              <>
                <SubHeader>Orders placed</SubHeader>
                <Table
                  headers={["Time", "Type", "Order", "Status", "By"]}
                  rows={dayOrders.map((o) => [
                    fmtTimeOnly(o.orderedAt),
                    o.orderType || "—",
                    orderDetailLine(o),
                    o.status || "—",
                    displayActor(o.orderedBy),
                  ])}
                  widths={["10%", "14%", "48%", "12%", "16%"]}
                />
              </>
            ) : null}

            {/* ───── Nursing notes today ───── */}
            {dayNurseNotes.length > 0 ? (
              <>
                <SubHeader>Nursing notes</SubHeader>
                {dayNurseNotes.map((nn, i) => (
                  <Para key={`nn-${k}-${i}`}>
                    <strong>
                      {fmtTimeOnly(nn.createdAt)}
                      {nn.shift ? ` · ${nn.shift} shift` : ""}
                      {nn.nurseName ? ` · ${displayActor(nn.nurseName)}` : ""}:
                    </strong>{" "}
                    {nn.content}
                  </Para>
                ))}
              </>
            ) : null}

            {/* ───── Shift handovers today ───── */}
            {dayHandovers.length > 0 ? (
              <>
                <SubHeader>Shift handovers</SubHeader>
                <Table
                  headers={["Shift", "Handing", "Receiving", "Summary"]}
                  rows={dayHandovers.map((h) => [
                    h.shift || "—",
                    displayActor(h.handingBy),
                    displayActor(h.receivingBy),
                    h.summary || "—",
                  ])}
                  widths={["10%", "18%", "18%", "54%"]}
                />
              </>
            ) : null}

            {/* ───── Vitals readings today (compact) ───── */}
            {dayVitals.length > 0 ? (
              <>
                <SubHeader>Vitals — readings today</SubHeader>
                <Table
                  headers={["Time", "BP", "Pulse", "Temp", "SpO₂", "RR", "By"]}
                  rows={dayVitals.slice(0, 8).map((v) => [
                    fmtTimeOnly(v.at),
                    v.bp || "—",
                    v.pulse || "—",
                    v.temp || "—",
                    v.spo2 || "—",
                    v.rr || "—",
                    displayActor(v.recordedBy),
                  ])}
                  widths={["12%", "14%", "11%", "11%", "11%", "11%", "30%"]}
                />
                {dayVitals.length > 8 ? (
                  <Para style={{ color: COL.muted, fontSize: 9, marginTop: -3 }}>
                    <em>{dayVitals.length - 8} additional reading(s) on file.</em>
                  </Para>
                ) : null}
              </>
            ) : null}

            {/* ───── I/O totals today (single row) ───── */}
            {dayIO.length > 0 ? (() => {
              const inTotal  = dayIO.filter((e) => e.direction === "IN").reduce((s, e) => s + (Number(e.volumeML) || 0), 0);
              const outTotal = dayIO.filter((e) => e.direction === "OUT").reduce((s, e) => s + (Number(e.volumeML) || 0), 0);
              const net = inTotal - outTotal;
              const netStr = `${net > 0 ? "+" : ""}${net} mL`;
              return (
                <Para>
                  <strong>I/O:</strong>{" "}
                  intake <strong>{inTotal} mL</strong>,{" "}
                  output <strong>{outTotal} mL</strong>,{" "}
                  net balance <strong>{netStr}</strong>.
                </Para>
              );
            })() : null}

            {/* ───── MAR — compact summary per drug ───── */}
            {dayMar.length > 0 ? (() => {
              const drugMap = new Map();
              dayMar.forEach((m) => {
                const key = `${m.drug}|${m.dose}|${m.route}|${m.frequency}`;
                if (!drugMap.has(key)) {
                  drugMap.set(key, {
                    drug: m.drug, dose: m.dose, route: m.route, frequency: m.frequency,
                    times: [], by: new Set(),
                  });
                }
                const entry = drugMap.get(key);
                if (m.givenAt) entry.times.push(fmtTimeOnly(m.givenAt));
                if (m.givenBy) entry.by.add(displayActor(m.givenBy));
              });
              return (
                <>
                  <SubHeader>Medication administration record</SubHeader>
                  <Table
                    headers={["Drug", "Dose", "Route", "Freq", "Times given", "By"]}
                    rows={Array.from(drugMap.values()).map((e) => [
                      <strong>{e.drug || "—"}</strong>,
                      e.dose || "—",
                      e.route || "—",
                      e.frequency || "—",
                      e.times.join(", ") || "—",
                      Array.from(e.by).join(", ") || "—",
                    ])}
                    widths={["28%", "10%", "10%", "12%", "26%", "14%"]}
                  />
                </>
              );
            })() : null}

            {/* ───── Last day: discharge marker (full discharge block
                    rendered later, this is just an anchor sentence). ── */}
            {isLastDay && f.admission?.dischargeDate ? (
              <Para style={{ marginTop: 6 }}>
                <strong>Discharged</strong> on{" "}
                <strong>{fmtDate(f.admission.dischargeDate, true)}</strong>
                {f.discharge?.condition ? <> in <strong>{f.discharge.condition.toLowerCase()}</strong> condition</> : null}.
                See discharge block below for medications, advice and
                follow-up.
              </Para>
            ) : null}
          </div>
        );
      })}

      {/* ════════════════════════════════════════════════════════════
          4. INVESTIGATIONS — abnormal first, then table
          ════════════════════════════════════════════════════════════ */}
      {invs.length > 0 ? (
        <>
          <SectionHeader nabh="NABH AAC.7">Investigations</SectionHeader>
          {abnormalInvs.length > 0 ? (
            <Para>
              Significant findings:{" "}
              {abnormalInvs.map((i, idx) => {
                const sep = idx === 0
                  ? null
                  : idx === abnormalInvs.length - 1
                    ? " and "
                    : ", ";
                return (
                  <span key={`ab-${i.name}-${idx}`}>
                    {sep}
                    <strong>{i.name}</strong>
                    {i.result ? <> — {stripDot(i.result)}</> : null}
                  </span>
                );
              })}.
            </Para>
          ) : null}
          {normalInvs.length > 0 ? (
            <Para>
              <em>
                {abnormalInvs.length > 0 ? "Other tests" : "Tests performed"}{" "}
                — {oxford(normalInvs.map((i) => i.name))} — were within normal limits or unremarkable.
              </em>
            </Para>
          ) : null}
          <Table
            headers={["Test", "Ordered", "Reported", "Result"]}
            rows={invs.map((i) => [
              <strong>{i.name || "—"}</strong>,
              i.orderedAt ? fmtDate(i.orderedAt) : "—",
              i.reportedAt ? fmtDate(i.reportedAt) : "—",
              i.result ? (isResultAbnormal(i.result)
                ? <span style={{ color: COL.abN, fontWeight: 600 }}>{i.result}</span>
                : <span><em>{i.result}</em></span>) : "—",
            ])}
            widths={["28%", "16%", "16%", "40%"]}
          />
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          5. LAB REPORTS (if backend ships separate radiology / lab
          report objects with an `impression`)
          ════════════════════════════════════════════════════════════ */}
      {(f.labReports || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH AAC.8">Lab & Imaging Reports</SectionHeader>
          <Table
            headers={["Report", "Type", "Date", "Impression"]}
            rows={f.labReports.map((r) => [
              <strong>{r.name || "—"}</strong>,
              r.reportType || "—",
              fmtDate(r.date),
              r.impression || "—",
            ])}
            widths={["26%", "14%", "16%", "44%"]}
          />
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          6. DIET PLANS (if any)
          ════════════════════════════════════════════════════════════ */}
      {(f.dietPlans || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH COP.4">Dietetic Care</SectionHeader>
          <Table
            headers={["Date", "Diet", "Kcal", "Restrictions", "Assigned by"]}
            rows={f.dietPlans.map((dp) => [
              fmtDate(dp.at),
              dp.templateName || "—",
              dp.targetCalories != null ? `${dp.targetCalories} kcal` : "—",
              dp.restrictions || "—",
              displayActor(dp.assignedBy),
            ])}
            widths={["16%", "26%", "12%", "26%", "20%"]}
          />
          {f.dietPlans.filter((dp) => dp.notes).map((dp, i) => (
            <Para key={`dnote-${i}`} style={{ color: COL.muted, fontSize: 10 }}>
              <em>{dp.templateName || "Diet"} ({fmtDate(dp.at)}): {dp.notes}</em>
            </Para>
          ))}
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          7. ICU CARE BUNDLES — only if any data
          ════════════════════════════════════════════════════════════ */}
      {(f.icuBundles || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH HIC.6 / IPSG.6">ICU Care-bundle Compliance</SectionHeader>
          <Table
            headers={["Date", "Shift", "VAP", "CAUTI", "CLABSI", "DVT", "Sepsis", "SUP", "Overall"]}
            rows={(f.icuBundles || []).map((b) => [
              b.date || "—",
              b.shift || "—",
              b.vapPct != null ? `${b.vapPct}%` : "—",
              b.cautiPct != null ? `${b.cautiPct}%` : "—",
              b.clabsiPct != null ? `${b.clabsiPct}%` : "—",
              b.dvtPct != null ? `${b.dvtPct}%` : "—",
              b.sepsisPct != null ? `${b.sepsisPct}%` : "—",
              b.supPct != null ? `${b.supPct}%` : "—",
              b.overallPct != null
                ? <span style={{ color: b.overallPct >= 80 ? COL.ok : COL.abN, fontWeight: 600 }}>{b.overallPct}%</span>
                : "—",
            ])}
            widths={["12%", "10%", "10%", "10%", "10%", "10%", "10%", "10%", "18%"]}
          />
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          8. MLC / MEDICO-LEGAL (rare; render only if present)
          ════════════════════════════════════════════════════════════ */}
      {(f.mlc || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH ROM.4">Medico-legal Entries</SectionHeader>
          <Table
            headers={["Date", "Type", "Brief", "IO / Station", "Signed by"]}
            rows={f.mlc.map((m) => [
              fmtDateTime(m.at),
              m.type || "—",
              m.brief || "—",
              [m.io, m.station].filter(Boolean).join(" · ") || "—",
              displayActor(m.signedBy),
            ])}
            widths={["16%", "12%", "36%", "22%", "14%"]}
          />
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          9. DISCHARGE BLOCK
          ════════════════════════════════════════════════════════════ */}
      {(f.admission?.dischargeDate || dischargeMeds.length > 0 || f.discharge?.advice || f.discharge?.followUpDate) ? (
        <div className="pr-page-break" style={{ pageBreakBefore: "auto" }}>
          <SectionHeader nabh="NABH AAC.11">Discharge</SectionHeader>

          {/* Discharge narrative block (1-2 short paragraphs) */}
          {f.discharge?.summary ? (
            <Para>{cleanSentence(f.discharge.summary)}</Para>
          ) : null}

          <Para>
            {fullName} was <strong>discharged</strong>
            {f.admission?.dischargeDate ? <> on <strong>{fmtDate(f.admission.dischargeDate, true)}</strong></> : null}
            {f.discharge?.condition ? <> in <strong>{f.discharge.condition.toLowerCase()}</strong> condition</> : null}.
            {dxFinal ? <> Final diagnosis: <strong>{dxFinal}</strong>{f.admission?.icd10 ? <> (ICD-10 {f.admission.icd10})</> : null}.</> : null}
          </Para>

          {/* Discharge medications (tight chemist-photocopy table) */}
          {dischargeMeds.length > 0 ? (
            <>
              <SubHeader>Medications on discharge</SubHeader>
              <table
                className="pr-table"
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  marginTop: 2,
                  fontSize: 10,
                  pageBreakInside: "avoid",
                }}
              >
                <thead>
                  <tr>
                    <th style={{ ...CELL_TH, width: "32%" }}>Drug</th>
                    <th style={{ ...CELL_TH, width: "32%" }}>Dose · Route · Frequency</th>
                    <th style={{ ...CELL_TH }}>Duration / Instructions</th>
                  </tr>
                </thead>
                <tbody>
                  {dischargeMeds.map((m, i) => {
                    const drugName = m.name || m.drug || "—";
                    const doseLine = [m.dose, m.route, m.frequency].filter(Boolean).join(" · ");
                    const duration = m.duration
                      ? m.duration
                      : m.endDate
                        ? `Until ${fmtDate(m.endDate)}`
                        : m.indication
                          ? m.indication
                          : "Continued";
                    return (
                      <tr key={`dm-${i}`} className="bill-line-row">
                        <td style={CELL_TD}>
                          <div style={{ fontWeight: 700 }}>{drugName}</div>
                          {m.generic ? (
                            <div style={{ fontSize: 9, color: COL.muted }}>{m.generic}</div>
                          ) : null}
                        </td>
                        <td style={CELL_TD}>{doseLine || "—"}</td>
                        <td style={CELL_TD}>
                          <div>{duration}</div>
                          {(m.instructions || m.indication) && duration !== (m.instructions || m.indication) ? (
                            <div style={{ fontSize: 9, color: COL.muted }}>
                              <em>{m.instructions || m.indication}</em>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : null}

          {/* Advice — ordered list with key phrases bolded */}
          {(() => {
            const a = f.discharge?.advice;
            if (!a) return null;
            const lines = String(a)
              .split(/\n+|(?:^|\s)\d+[\.)]\s+/)
              .map((s) => s.trim())
              .filter(Boolean);
            if (!lines.length) return null;
            return (
              <>
                <SubHeader>Advice on discharge</SubHeader>
                <ol style={{ fontSize: 10.5, lineHeight: 1.4, color: COL.body, margin: "2px 0 6px 22px", padding: 0 }}>
                  {lines.map((t, i) => (
                    <li key={`adv-${i}`} style={{ marginBottom: 2 }}>{t}</li>
                  ))}
                </ol>
              </>
            );
          })()}

          {/* Follow-up */}
          {(f.discharge?.followUpDate || f.admission?.consultant) ? (
            <>
              <SubHeader>Follow-up</SubHeader>
              <Para>
                Review in the out-patient department on{" "}
                <strong>
                  {f.discharge?.followUpDate ? fmtDate(f.discharge.followUpDate) : "the advised date"}
                </strong>
                {f.admission?.consultant ? <> with <strong>{f.admission.consultant}</strong></> : null}.{" "}
                The hospital remains available round-the-clock for any
                urgent concerns. {pos.charAt(0).toUpperCase() + pos.slice(1)} general
                practitioner may be contacted in the interim.
              </Para>
            </>
          ) : null}

          {/* Discharge fitness statement */}
          <Para style={{ marginTop: 6 }}>
            <em>
              In our clinical judgment, {subjL} is <strong>fit for discharge</strong> on the
              date stated above. Ongoing care and any post-discharge
              complications should be managed in concert with the
              attending physician.
            </em>
          </Para>
        </div>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          Closing salutation
          ════════════════════════════════════════════════════════════ */}
      <p
        style={{
          fontSize: 11,
          fontStyle: "italic",
          color: COL.muted,
          margin: "12px 0 4px",
        }}
      >
        Thank you for entrusting {obj || "the patient"} to our care. We
        remain available for any clarification regarding this admission.
      </p>
    </PrintShell>
  );
};

export default NarrativeTheme;
