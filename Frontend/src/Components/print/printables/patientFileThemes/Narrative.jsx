// R7ft-FIX6 Theme 1 — Narrative Letter (PAGE-MIRROR stance)
//
// Re-organises the Complete Patient File print to mirror, section-by-
// section, the Patient File PAGE (CompletePatientFilePage.jsx). The
// user's complaint: "jaise hume iss page pr jitni details patient
// file me dikh rhi hai ye sabhi Print patient file me bhi dikhai de
// wo bhi hmare selected template me" — i.e., the print must look
// like the page, in the Narrative letter style.
//
// 21 sections in order:
//   1.  Admission Summary                          [NABH AAC.1]
//   2.  Initial Assessment (Doctor + Nursing)      [NABH AAC.4 / AAC.5]
//   3.  Doctor Notes                               [NABH COP.7]
//   4.  Nurse Notes                                [NABH COP.2]
//   5.  Orders + MAR                               [NABH MOM.2 / MOM.4]
//   6.  Vital Signs Trend                          [NABH COP.3]
//   7.  Intake / Output Sheet                      [NABH COP.3]
//   8.  Procedure Notes                            [NABH COP.13]
//   9.  Investigations & Reports                   [NABH AAC.7 / AAC.8]
//   10. Consent Forms                              [NABH PRE.1]
//   11. Dietetic Care                              [NABH COP.4]
//   12. Nursing Care Plans                         [NABH COP.2]
//   13. Nursing Re-assessments                     [NABH COP.2]
//   14. Blood Transfusion                          [NABH HIC.4 / MOM.4]
//   15. Medico-Legal Records                       [NABH ROM.4]
//   16. Shift Handovers + Bed Transfers            [NABH COP.6]
//   17. Discharge Summary                          [NABH AAC.11]
//   18. Billing Summary                            [—]
//   19. Activity Log                               [NABH IMS.1]
//   20. Scoring Trends                             [NABH COP.3]
//   21. Complete Chronological Timeline            [NABH IMS.1]
//
// Hard requirements honoured:
//   * Only true booleans render (active-only rule via FlagLine).
//   * ObjectId hashes → "signed digitally" via displayActor().
//   * Risk scores → one line each (total + band only) unless
//     ?expandScores=1 in URL (RiskLine).
//   * Empty sections collapse entirely (no heading, no margin).
//   * Bold = drug names, diagnoses, key facts. Italic = clinical
//     observations, risk-band labels, "no abnormality detected".
//   * Two-level hierarchy: SectionHeader (major) vs SubHeader (minor).
//   * NABH chips right-aligned as pills.
//   * Tables (pr-table) for grid data.
//   * English only. No emojis.

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

const dayLabel = dayHeading;  // alias for clarity

/* Returns the day-of-stay number (1-based) for a given timestamp,
   anchored to admission date. Returns null if either is missing. */
const dayNumber = (eventDate, admissionDate) => {
  if (!eventDate || !admissionDate) return null;
  const a = new Date(admissionDate);
  const e = new Date(eventDate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(e.getTime())) return null;
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
const ACCENT = COL.accent;  // alias for legacy refs

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

const MiniTable = ({ headers, rows, widths }) => (
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

// Alias kept for any legacy reference inside helpers.
const Table = MiniTable;

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

const activeFlags = (obj, labelMap, opts = {}) => {
  if (!obj || typeof obj !== "object") return { active: [], total: 0 };
  const active = [];
  let total = 0;
  for (const [key, label] of Object.entries(labelMap)) {
    total += 1;
    const v = obj[key];
    if (v === true) { active.push(label); continue; }
    if (typeof v === "string") {
      const s = v.toLowerCase().trim();
      if (s === "yes" || s === "y" || s === "true" || s === "present") active.push(label);
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

const expandScoresFlag = () => {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get("expandScores") === "1";
  } catch { return false; }
};

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

const pick = (obj, ...keys) => {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== "") return v;
  }
  return null;
};

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

const buildDayIndex = (file, events) => {
  const adm = file.admission?.date;
  const dis = file.admission?.dischargeDate;
  if (!adm) return [];
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
  const cap = 30;
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

/* Safe scalar — avoids React "objects are not valid as a child" crashes
   when an IA field carries a nested object instead of a primitive. */
const scalarOrNum = (v) => (v != null && (typeof v === "number" || typeof v === "string")) ? v : null;

/* Lightweight prose summariser for free-form text fields. */
const proseLine = (label, val) => {
  if (val == null) return null;
  if (typeof val === "object") {
    const inner = Object.entries(val)
      .filter(([, v]) => v != null && v !== "" && typeof v !== "object")
      .map(([k, v]) => `${k}: ${v}`).join("; ");
    if (!inner) return null;
    return <Para><strong>{label}:</strong> {inner}.</Para>;
  }
  if (String(val).trim() === "") return null;
  return <Para><strong>{label}:</strong> {String(val).trim()}.</Para>;
};

/* =====================================================================
   9. PRIMARY THEME COMPONENT
   ===================================================================== */
const NarrativeTheme = ({ settings = {}, file, events = [], receipt = {}, viewerRole = "" }) => {
  const f = file || {};
  const pn = pronoun(f.patient?.gender);
  const subj = pn.subj;
  const subjL = subj.toLowerCase();
  const pos = pn.pos;
  const obj = pn.obj;

  /* R7gb P0-12 — PHI defence-in-depth. Roles cleared to see the
     Activity Log (which surfaces user-attribution metadata). Falls
     back to the role embedded in the receipt for older callers that
     don't pass the prop. */
  const _role = String(viewerRole || receipt?.viewerRole || "").toLowerCase();
  const canSeeActivityLog = ["admin", "mrd", "doctor", "accountant"].includes(_role);

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
  let hopiText = stripDot(f.history?.hopi || "");
  const chief = stripDot(f.history?.chief || f.ia?.nursing?.chiefComplaint || "");
  if (!hopiText) {
    const nurseChief = stripDot(f.ia?.nursing?.chiefComplaint || "");
    if (nurseChief) hopiText = nurseChief;
  }

  /* ── Discharge meds with fallback ───────────────────────────── */
  let dischargeMeds = Array.isArray(f.discharge?.medications) ? f.discharge.medications : [];
  if (!dischargeMeds.length && Array.isArray(f.medications)) {
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

  /* ── Per-day groupings — R7fy day-wise restructure ──────────── */
  const marByDay      = groupByDay(f.mar,            (m) => m.givenAt   || m.createdAt);
  const docNotesByDay = groupByDay(f.doctorNotes,    (n) => n.createdAt);
  const nurNotesByDay = groupByDay(f.nursingNotes,   (n) => n.createdAt);
  const ordersByDay   = groupByDay(f.doctorOrders,   (o) => o.orderedAt || o.createdAt);
  const handoverByDay = groupByDay(f.shiftHandovers, (h) => h.at);
  // Merge doctor + nursing notes for a given day into a single chronological
  // stream so the printout reads like a real clinical timeline (R7fy).
  const notesForDay = (dayKeyStr) => {
    const docs  = (docNotesByDay.get(dayKeyStr) || []).map((n) => ({ ...n, _kind: "doctor"  }));
    const nurs  = (nurNotesByDay.get(dayKeyStr) || []).map((n) => ({ ...n, _kind: "nursing" }));
    return [...docs, ...nurs].sort((a, b) =>
      new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
    );
  };

  /* ── Diagnosis triplet ──────────────────────────────────────── */
  const dxProv  = f.admission?.provisionalDiagnosis || f.ia?.doctor?.provisionalDiagnosis || "";
  const dxWork  = f.admission?.workingDiagnosis || f.ia?.doctor?.workingDiagnosis || "";
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

  /* ── Code Status ────────────────────────────────────────────── */
  const codeStatus = f.ia?.doctor?.codeStatus
                  || f.ia?.nursing?.codeStatus
                  || receipt.codeStatus
                  || "";

  /* ── Risk acknowledgement (flag map) ────────────────────────── */
  const riskAckLabels = {
    fallRiskExplained: "Fall risk explained",
    pressureUlcerRiskExplained: "Pressure-ulcer risk explained",
    bloodTransfusionRiskExplained: "Transfusion risk explained",
    surgeryRiskExplained: "Surgical risk explained",
    procedureRiskExplained: "Procedure risk explained",
    dnaCprDiscussed: "Code-status discussed",
  };
  const riskAck = f.ia?.doctor?.riskAcknowledgement
              || f.ia?.nursing?.riskAcknowledgement
              || receipt.riskAcknowledgement
              || null;

  /* ── Home meds ─────────────────────────────────────────────── */
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

  const morseVal   = pick(n, "fallRisk", "morseTotal", "morseScore") ?? scalarOrNum(n.morse?.total);
  const bradenVal  = pick(n, "pressureUlcer", "bradenTotal", "bradenScore") ?? scalarOrNum(n.braden?.total);
  const painVal    = pick(n, "painScore", "vasPain") ?? scalarOrNum(n.pain?.score) ?? scalarOrNum(n.pain?.total);
  const nutriVal   = pick(n, "nutritionScore", "must", "nutriRisk", "mna") ?? scalarOrNum(n.nutrition?.score) ?? scalarOrNum(n.nutri?.total);
  const vteVal     = pick(n, "vteRisk", "padua") ?? scalarOrNum(n.vte?.total) ?? scalarOrNum(d.vte?.total) ?? pick(d, "vteRisk", "padua");
  const dvtVal     = pick(n, "dvtRisk") ?? scalarOrNum(n.dvt?.total) ?? pick(d, "dvtRisk");
  const gcsVal     = pick(d, "gcs", "GCS") ?? scalarOrNum(d.gcs?.total) ?? pick(n, "gcs", "GCS");
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

  /* ── Bills fallback (canonical doesn't normalise yet) ───────── */
  const bills = Array.isArray(f.bills) ? f.bills
              : Array.isArray(receipt?.bills) ? receipt.bills : [];

  /* ── Scoring trends — derive from vitals/MAR series ─────────── */
  const painSeries = (f.vitalsTrend || [])
    .map((v) => ({ at: v.at, val: Number(v.painScore) }))
    .filter((p) => Number.isFinite(p.val));

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
        and discharge summary on file for this admission. The sections
        below mirror, in order, the Patient File page used by the
        treating team.
      </Para>

      {/* ════════════════════════════════════════════════════════════
          ENCOUNTER AT A GLANCE — compact 6-row scannable header
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
          {dxFinal && dxFinal !== dxProv ? (
            <tr>
              <td style={{ padding: "2px 6px", color: COL.muted }}>Final diagnosis</td>
              <td style={{ padding: "2px 6px", color: COL.body }}>
                <strong>{dxFinal}</strong>
                {f.admission?.icd10 ? <> · ICD-10 <em>{f.admission.icd10}{f.admission.icd10Desc ? ` (${f.admission.icd10Desc})` : ""}</em></> : null}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {/* ════════════════════════════════════════════════════════════
          ALERTS — allergies (red), isolation (amber)
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
          1. ADMISSION SUMMARY                            [NABH AAC.1]
          ════════════════════════════════════════════════════════════ */}
      {(f.admission?.date || f.admission?.consultant || f.admission?.bed) ? (
        <>
          <SectionHeader nabh="NABH AAC.1">Admission Summary</SectionHeader>
          <Para>
            {fullName} was <strong>admitted on {fmtDate(f.admission?.date, true)}</strong>
            {f.admission?.modeOfArrival ? <> via {f.admission.modeOfArrival.toLowerCase()}</> : null}
            {f.admission?.referringDoctor ? <> from <strong>{f.admission.referringDoctor}</strong></> : null}
            {f.admission?.consultant ? <> under the care of <strong>{f.admission.consultant}</strong></> : null}
            {(f.admission?.department || f.admission?.bed || f.admission?.ward) ? (
              <> (
                {[
                  f.admission?.department,
                  f.admission?.bed ? `bed ${f.admission.bed}` : null,
                  f.admission?.ward,
                ].filter(Boolean).join(", ")}
              )</>
            ) : null}.
            {f.admission?.type ? <> Admission type: <strong>{f.admission.type}</strong>.</> : null}
            {f.admission?.reasonForAdmission ? <> Reason for admission: <em>{stripDot(f.admission.reasonForAdmission)}</em>.</> : null}
          </Para>
          {(dxProv || dxWork || dxFinal) ? (
            <Para>
              {dxProv ? <>Provisional diagnosis: <strong>{dxProv}</strong>. </> : null}
              {dxWork && dxWork !== dxProv ? <>Working diagnosis: <strong>{dxWork}</strong>. </> : null}
              {dxFinal && dxFinal !== dxWork ? <>Final diagnosis: <strong>{dxFinal}</strong>. </> : null}
              {f.admission?.icd10 ? <>ICD-10: {f.admission.icd10}{f.admission.icd10Desc ? ` — ${f.admission.icd10Desc}` : ""}. </> : null}
              {f.admission?.totalDays ? <><strong>{f.admission.totalDays}-day stay</strong>.</> : null}
            </Para>
          ) : null}
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          2. INITIAL ASSESSMENT (Doctor + Nursing)        [NABH AAC.4/5]
          ════════════════════════════════════════════════════════════ */}
      {(Object.keys(d).length > 0 || Object.keys(n).length > 0
        || hopiText || chief || pastLine || famSocLine
        || examLines.length > 0 || rosLine) ? (
        <>
          <SectionHeader nabh="NABH AAC.4 / AAC.5">Initial Assessment</SectionHeader>

          {/* ── Doctor IA ───────────────────────────────────────── */}
          {(Object.keys(d).length > 0 || hopiText || chief || pastLine
            || famSocLine || examLines.length > 0 || rosLine
            || comorbidities || codeStatus || riskAck) ? (
            <>
              <SubHeader>Doctor Initial Assessment</SubHeader>
              {chief ? (
                <Para><strong>Chief complaint:</strong> {chief}.</Para>
              ) : null}
              {hopiText ? (
                <>
                  {hopiText.split(/\n+/).map((t, i) =>
                    t.trim() ? <Para key={`hopi-${i}`}>{cleanSentence(t)}</Para> : null
                  )}
                </>
              ) : null}
              {pastLine ? <Para>{pastLine}</Para> : null}
              {famSocLine ? <Para>{famSocLine}</Para> : null}
              {(f.alerts?.allergies || []).length > 0 ? (
                <Para><strong>Allergies on record:</strong> {oxford(allergies)}.</Para>
              ) : null}
              {rosLine ? (
                <Para><strong>Review of systems:</strong> {rosLine}.</Para>
              ) : null}
              {examLines.length > 0 ? (
                <>
                  {examLines.map((t, i) => <Para key={`ex-${i}`}>{t}</Para>)}
                </>
              ) : null}
              {comorbidities ? (
                <FlagLine
                  obj={comorbidities}
                  labelMap={comorbiditiesLabels}
                  label="Significant comorbidities"
                  allDescription="screened — none reported."
                />
              ) : null}
              {codeStatus ? (
                <Para><strong>Code status:</strong> <strong>{codeStatus}</strong> documented at admission.</Para>
              ) : null}
              {riskAck ? (
                <FlagLine
                  obj={riskAck}
                  labelMap={riskAckLabels}
                  label="Risk acknowledgement (explained to patient / family)"
                  allDescription="explanation not documented."
                />
              ) : null}
              {(dxProv || dxWork || dxFinal) ? (
                <Para>
                  {dxProv ? <><strong>Provisional diagnosis:</strong> {dxProv}. </> : null}
                  {dxWork && dxWork !== dxProv ? <><strong>Working diagnosis:</strong> {dxWork}. </> : null}
                  {dxFinal && dxFinal !== dxWork ? <><strong>Final diagnosis:</strong> {dxFinal}.</> : null}
                </Para>
              ) : null}
              {Object.keys(d).length > 0 ? (
                <Para style={{ color: COL.muted, fontSize: 10 }}>
                  <em>
                    Doctor IA signed by {dIASigner}
                    {dIAReg ? ` (Reg ${dIAReg})` : ""}
                    {dIAAt ? ` · ${fmtDateTime(dIAAt)}` : ""}.
                  </em>
                </Para>
              ) : null}
            </>
          ) : null}

          {/* ── Nursing IA ──────────────────────────────────────── */}
          {Object.keys(n).length > 0 ? (
            <>
              <SubHeader>Nursing Initial Assessment</SubHeader>
              {n.modeOfAdmission ? (
                <Para><strong>Mode of admission:</strong> {n.modeOfAdmission}.</Para>
              ) : null}
              {n.identification ? proseLine("Identification", n.identification) : null}
              {n.anthropometry ? proseLine("Anthropometry", n.anthropometry) : null}
              {(f.alerts?.allergies || []).length > 0 ? (
                <Para><strong>Allergies:</strong> {oxford(allergies)}.</Para>
              ) : null}
              {n.language ? <Para><strong>Preferred language:</strong> {n.language}.</Para> : null}
              {n.psychosocial ? proseLine("Psycho-social", n.psychosocial) : null}
              {n.familySupport ? proseLine("Family support", n.familySupport) : null}

              {/* Risk scores — compact one-liners */}
              {(morseVal != null || bradenVal != null || painVal != null
                || nutriVal != null || vteVal != null || dvtVal != null
                || gcsVal != null) ? (
                <>
                  <RiskLine label="Morse Fall Risk"            value={morseVal}  max={125} band={morseRisk  || morseBand(morseVal)}  sub="see expanded scoring" />
                  <RiskLine label="Braden Pressure-ulcer Risk" value={bradenVal} max={23}  band={bradenRisk || bradenBand(bradenVal)} sub="see expanded scoring" />
                  <RiskLine label="Pain (numeric rating)"      value={painVal}   max={10}  band={painBand(painVal)} />
                  <RiskLine label="Nutritional risk (MUST)"    value={nutriVal}  max={6}   band={nutriRisk  || nutritionBand(nutriVal)} />
                  <RiskLine label="DVT risk"                   value={dvtVal}    max={null} band={null} />
                  <RiskLine label="VTE risk (Padua)"           value={vteVal}    max={null} band={vteRisk} />
                  <RiskLine label="Glasgow Coma Scale"         value={gcsVal}    max={15}  band={null} />
                </>
              ) : null}

              {/* ADL (Barthel) */}
              {(() => {
                const adl = n.adl || n.barthel || {};
                const total = barthelTotal(adl);
                if (total == null) return null;
                const rows = [];
                const keys = ["feeding","bathing","grooming","dressing","bowels","bladder","toilet","transfer","mobility","stairs"];
                keys.forEach((k) => {
                  if (adl[k] != null) rows.push([k.charAt(0).toUpperCase() + k.slice(1), String(adl[k])]);
                });
                return (
                  <>
                    <SubHeader>Activities of Daily Living (Barthel)</SubHeader>
                    {rows.length > 0 ? (
                      <MiniTable headers={["Item", "Score"]} rows={rows} widths={["70%", "30%"]} />
                    ) : null}
                    <Para>
                      Barthel total <strong>{total}/100</strong>
                      {BARTHEL_TOTAL_BAND(total) ? <> — <em>{BARTHEL_TOTAL_BAND(total)}</em></> : null}.
                    </Para>
                  </>
                );
              })()}

              {/* Home medications */}
              {homeMeds.length > 0 ? (
                <>
                  <SubHeader>Home Medications</SubHeader>
                  <MiniTable
                    headers={["Drug", "Dose", "Frequency", "Duration"]}
                    rows={homeMeds.map((m) => typeof m === "string"
                      ? [<strong>{m}</strong>, "—", "—", "—"]
                      : [
                          <strong>{m.drug || m.name || "—"}</strong>,
                          m.dose || "—",
                          m.frequency || "—",
                          m.duration || m.since || "—",
                        ])}
                    widths={["40%", "20%", "20%", "20%"]}
                  />
                </>
              ) : null}

              {/* Cross-check alerts */}
              {(f.alerts?.crossCheckAlerts || []).length > 0 ? (
                <>
                  <SubHeader>Cross-check Alerts</SubHeader>
                  <MiniTable
                    headers={["Alert", "Detail"]}
                    rows={(f.alerts.crossCheckAlerts || []).map((a) => {
                      if (typeof a === "string") return [a, "—"];
                      return [a.label || a.type || "—", a.detail || a.value || "—"];
                    })}
                    widths={["35%", "65%"]}
                  />
                </>
              ) : null}

              {/* Devices in situ */}
              {devices ? (
                <FlagLine
                  obj={devices}
                  labelMap={devicesLabels}
                  label="Devices present"
                  allDescription="none in situ at admission."
                />
              ) : null}

              {/* Skin survey */}
              {skin ? (
                <FlagLine
                  obj={skin}
                  labelMap={skinLabels}
                  label="Skin findings"
                  allDescription="no abnormality detected."
                />
              ) : null}

              {/* Misc nursing IA fields — render only when present */}
              {n.educationNeeds ? proseLine("Education needs", n.educationNeeds) : null}
              {n.cognitive ? proseLine("Cognitive", n.cognitive) : null}
              {n.bowelBladder ? proseLine("Bowel / bladder", n.bowelBladder) : null}
              {n.sleep ? proseLine("Sleep pattern", n.sleep) : null}
              {n.caregiver ? proseLine("Family caregiver", n.caregiver) : null}
              {n.dischargePlanning ? proseLine("Discharge planning", n.dischargePlanning) : null}

              {carePlan ? (
                <Para><strong>Initial care plan:</strong> <em>{cleanSentence(carePlan)}</em></Para>
              ) : null}

              <Para style={{ color: COL.muted, fontSize: 10 }}>
                <em>
                  Nursing IA signed by {nIASigner}
                  {nIAAt ? ` · ${fmtDateTime(nIAAt)}` : ""}.
                </em>
              </Para>
            </>
          ) : null}
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          R7fy — DAY-WISE CLINICAL JOURNEY              [NABH COP.6/7/2]
          Per user requirement, the body now mirrors the bedside record:
          one block per calendar day with 4 sub-sections each — Notes
          (doctor + nursing interleaved chronologically), Orders raised
          that day, MAR doses given that day, and shift Handovers.
          Replaces 4 flat sections (Doctor Notes, Nurse Notes, Orders &
          MAR, Shift Handovers) which printed as horizontal lists and
          made it impossible to read the file day-by-day.
          ════════════════════════════════════════════════════════════ */}
      {(() => {
        // Build set of all keys touched by any of the 4 streams, then
        // intersect with the admission day-index so we render in
        // admission → discharge order. Use union so spontaneous events
        // (out-of-band orders) on a day before/after the index also
        // surface.
        const allKeys = new Set();
        [docNotesByDay, nurNotesByDay, ordersByDay, marByDay, handoverByDay].forEach((m) => {
          for (const k of m.keys()) allKeys.add(k);
        });
        if (allKeys.size === 0) return null;
        const indexKeys = new Set(dayIndex.map((d) => d.key));
        const orderedKeys = Array.from(allKeys).sort((a, b) => a.localeCompare(b));
        // Show all days; cap to 30 for safety (large stays).
        // R7gc — user requirement: NO truncation. Show every day with any
        // recorded activity, no matter how long the stay.
        const showKeys = orderedKeys;
        return (
          <>
            <SectionHeader nabh="NABH COP.6 / COP.7 / COP.2 / MOM.4">
              Day-wise Clinical Journey
            </SectionHeader>
            {showKeys.map((k) => {
              const notes    = notesForDay(k);
              const orders   = (ordersByDay.get(k)   || []).slice().sort((a,b) =>
                new Date(a.orderedAt || a.createdAt || 0) - new Date(b.orderedAt || b.createdAt || 0));
              const marRows  = marByDay.get(k)       || [];
              const handovrs = (handoverByDay.get(k) || []).slice().sort((a,b) =>
                new Date(a.at || 0) - new Date(b.at || 0));
              if (!notes.length && !orders.length && !marRows.length && !handovrs.length) return null;

              const dayMatch = dayIndex.find((d) => d.key === k);
              const dayLabel = dayMatch ? `Day ${dayMatch.n} — ${dayHeading(dayMatch.date)}` : dayHeading(notes[0]?.createdAt || orders[0]?.orderedAt || marRows[0]?.givenAt || k);

              // ── Day banner ──
              const banner = (
                <div key={`day-banner-${k}`} style={{
                  marginTop: 12,
                  marginBottom: 6,
                  padding: "4px 10px",
                  background: "#eff6ff",
                  borderLeft: `3px solid ${COL.head}`,
                  fontWeight: 700,
                  fontSize: 11,
                  color: COL.head,
                  letterSpacing: 0.3,
                }}>
                  {dayLabel}
                </div>
              );

              // ── Notes sub-section (doctor + nursing interleaved) ──
              const notesBlock = notes.length > 0 ? (
                <div key={`day-notes-${k}`} style={{ marginBottom: 6 }}>
                  <Para style={{ fontWeight: 700, fontSize: 9.5, color: COL.muted, textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 2px" }}>
                    Clinical Notes
                  </Para>
                  {notes.map((n, idx) => {
                    const isDoc = n._kind === "doctor";
                    const author = isDoc ? n.doctorName : n.nurseName;
                    const vit = !isDoc && n.vitals && typeof n.vitals === "object" ? vitalsSentence(n.vitals) : "";
                    return (
                      <Para key={`day-${k}-n-${idx}`} style={{
                        borderLeft: `2px solid ${isDoc ? COL.head : "#db2777"}`,
                        paddingLeft: 8,
                        marginBottom: 3,
                      }}>
                        <strong>{fmtTimeOnly(n.createdAt) || fmtDateTime(n.createdAt)}</strong>
                        {" · "}<span style={{ color: isDoc ? COL.head : "#db2777", fontWeight: 600, textTransform: "uppercase", fontSize: 9 }}>
                          {isDoc ? "DOCTOR" : "NURSING"}
                        </span>
                        {n.noteType ? <> · {n.noteType}</> : null}
                        {!isDoc && n.shift ? <> · {n.shift}</> : null}
                        {author ? <> · <em>{displayActor(author)}</em></> : null}
                        {" — "}{n.content || ""}
                        {vit ? <> <em style={{ color: COL.muted }}>· {vit.toLowerCase()}</em></> : null}
                        {/* R7gb P0-14 — NABH IMS.1 / HIC.6: late-entry
                            banner. Back-dated notes MUST be visually
                            flagged so regulators/courts can see the
                            addendum wasn't recorded at time of care. */}
                        {n.lateEntry ? (
                          <div style={{
                            marginTop: 3,
                            padding: "2px 6px",
                            background: "#fef2f2",
                            borderLeft: "3px solid #b91c1c",
                            color: "#991b1b",
                            fontSize: 9,
                            fontWeight: 600,
                          }}>
                            LATE ENTRY
                            {n.lateEntryAt ? ` · entered ${fmtDateTime(n.lateEntryAt)}` : ""}
                            {n.lateEntryReason ? ` · reason: ${n.lateEntryReason}` : ""}
                          </div>
                        ) : null}
                      </Para>
                    );
                  })}
                </div>
              ) : null;

              // ── Orders sub-section ──
              const ordersBlock = orders.length > 0 ? (
                <div key={`day-orders-${k}`} style={{ marginBottom: 6 }}>
                  <Para style={{ fontWeight: 700, fontSize: 9.5, color: COL.muted, textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 2px" }}>
                    Orders Raised
                  </Para>
                  <MiniTable
                    headers={["Time", "Type", "Order detail", "Status", "Ordered by"]}
                    rows={orders.map((o) => [
                      fmtTimeOnly(o.orderedAt || o.createdAt),
                      o.orderType || "—",
                      orderDetailLine(o),
                      o.status || "—",
                      displayActor(o.orderedBy),
                    ])}
                    widths={["10%", "14%", "48%", "12%", "16%"]}
                  />
                </div>
              ) : null;

              // ── MAR sub-section ──
              const marBlock = marRows.length > 0 ? (() => {
                const drugMap = new Map();
                marRows.forEach((m) => {
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
                  <div key={`day-mar-${k}`} style={{ marginBottom: 6 }}>
                    <Para style={{ fontWeight: 700, fontSize: 9.5, color: COL.muted, textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 2px" }}>
                      Medication Administration (MAR)
                    </Para>
                    <MiniTable
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
                  </div>
                );
              })() : null;

              // ── Handovers sub-section ──
              const handoverBlock = handovrs.length > 0 ? (
                <div key={`day-handover-${k}`} style={{ marginBottom: 6 }}>
                  <Para style={{ fontWeight: 700, fontSize: 9.5, color: COL.muted, textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 2px" }}>
                    Shift Handovers
                  </Para>
                  <MiniTable
                    headers={["Time", "Shift", "Handing", "Receiving", "Summary"]}
                    rows={handovrs.map((h) => [
                      fmtTimeOnly(h.at),
                      h.shift || "—",
                      displayActor(h.handingBy),
                      displayActor(h.receivingBy),
                      h.summary || "—",
                    ])}
                    widths={["10%", "10%", "18%", "18%", "44%"]}
                  />
                </div>
              ) : null;

              return (
                <React.Fragment key={`day-${k}`}>
                  {banner}
                  {notesBlock}
                  {ordersBlock}
                  {marBlock}
                  {handoverBlock}
                </React.Fragment>
              );
            })}
            {/* R7gc — no truncation; every day with activity prints. */}
            <span style={{display:"none"}}>{Array.from(indexKeys).length}</span>
          </>
        );
      })()}

      {/* ════════════════════════════════════════════════════════════
          6. VITAL SIGNS TREND                             [NABH COP.3]
          ════════════════════════════════════════════════════════════ */}
      {(f.vitalsTrend || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH COP.3">Vital Signs Trend</SectionHeader>
          <MiniTable
            headers={["Time", "BP", "Pulse", "Temp", "SpO₂", "RR", "Recorded by"]}
            // R7gc — user requirement: NO vitals truncation. Print every reading.
            rows={(f.vitalsTrend || []).map((v) => [
              fmtDateTime(v.at),
              v.bp || "—",
              v.pulse || "—",
              v.temp || "—",
              v.spo2 || "—",
              v.rr || "—",
              displayActor(v.recordedBy),
            ])}
            widths={["18%", "12%", "10%", "10%", "10%", "10%", "30%"]}
          />
          {/* R7gc — no truncation hint needed; we print every reading. */}
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          7. INTAKE / OUTPUT SHEET                          [NABH COP.3]
          ════════════════════════════════════════════════════════════ */}
      {(f.intakeOutput || []).length > 0 ? (() => {
        // Aggregate to daily totals.
        const byDay = new Map();
        (f.intakeOutput || []).forEach((e) => {
          const k = dayKey(e.at);
          if (!k) return;
          if (!byDay.has(k)) byDay.set(k, { in: 0, out: 0, date: e.at });
          const acc = byDay.get(k);
          const vol = Number(e.volumeML) || 0;
          if (e.direction === "IN") acc.in += vol;
          else if (e.direction === "OUT") acc.out += vol;
        });
        // R7gc — user requirement: NO I/O truncation. Show every day on file.
        const days = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        if (!days.length) return null;
        return (
          <>
            <SectionHeader nabh="NABH COP.3">Intake / Output Sheet</SectionHeader>
            <MiniTable
              headers={["Date", "Intake (mL)", "Output (mL)", "Net balance"]}
              rows={days.map(([, v]) => {
                const net = v.in - v.out;
                const netStr = `${net > 0 ? "+" : ""}${net} mL`;
                return [
                  dayHeading(v.date),
                  v.in.toString(),
                  v.out.toString(),
                  <strong style={{ color: net < 0 ? COL.abN : COL.body }}>{netStr}</strong>,
                ];
              })}
              widths={["34%", "22%", "22%", "22%"]}
            />
          </>
        );
      })() : null}

      {/* ════════════════════════════════════════════════════════════
          8. PROCEDURE NOTES                              [NABH COP.13]
          ════════════════════════════════════════════════════════════ */}
      {(f.procedures || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH COP.13">Procedure Notes</SectionHeader>
          {f.procedures.map((p, i) => (
            <Para key={`proc-${i}`}>
              <strong>{p.date ? fmtDate(p.date, true) : "—"}</strong>{" "}
              · <strong>{p.name || "—"}</strong>
              {p.surgeon ? <> — surgeon <em>{displayActor(p.surgeon)}</em></> : null}
              {p.anaesthetist ? <>, anaesthetist <em>{displayActor(p.anaesthetist)}</em></> : null}.
              {p.findings ? <> <em>Operative findings: {stripDot(p.findings)}.</em></> : null}
              {p.notes ? <> {cleanSentence(p.notes)}</> : null}
            </Para>
          ))}
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          9. INVESTIGATIONS & REPORTS               [NABH AAC.7 / AAC.8]
          ════════════════════════════════════════════════════════════ */}
      {(invs.length > 0 || (f.labReports || []).length > 0) ? (
        <>
          <SectionHeader nabh="NABH AAC.7 / AAC.8">Investigations & Reports</SectionHeader>

          {invs.length > 0 ? (
            <>
              <SubHeader>Investigations</SubHeader>
              {abnormalInvs.length > 0 ? (
                <Para>
                  Significant findings:{" "}
                  {abnormalInvs.map((iv, idx) => {
                    const sep = idx === 0
                      ? null
                      : idx === abnormalInvs.length - 1
                        ? " and "
                        : ", ";
                    return (
                      <span key={`ab-${iv.name}-${idx}`}>
                        {sep}
                        <strong>{iv.name}</strong>
                        {iv.result ? <> — {stripDot(iv.result)}</> : null}
                      </span>
                    );
                  })}.
                </Para>
              ) : null}
              {normalInvs.length > 0 ? (
                <Para>
                  <em>
                    {abnormalInvs.length > 0 ? "Other tests" : "Tests performed"}{" "}
                    — {oxford(normalInvs.map((iv) => iv.name))} — were within normal limits or unremarkable.
                  </em>
                </Para>
              ) : null}
              <MiniTable
                headers={["Test", "Ordered", "Reported", "Result"]}
                rows={invs.map((iv) => [
                  <strong>{iv.name || "—"}</strong>,
                  iv.orderedAt  ? fmtDate(iv.orderedAt)  : "—",
                  iv.reportedAt ? fmtDate(iv.reportedAt) : "—",
                  iv.result ? (isResultAbnormal(iv.result)
                    ? <span style={{ color: COL.abN, fontWeight: 600 }}>{iv.result}</span>
                    : <em>{iv.result}</em>) : "—",
                ])}
                widths={["28%", "16%", "16%", "40%"]}
              />
            </>
          ) : null}

          {(f.labReports || []).length > 0 ? (
            <>
              <SubHeader>Lab & Imaging Reports</SubHeader>
              <MiniTable
                headers={["Report", "Date", "Key findings / impression"]}
                rows={f.labReports.map((r) => [
                  <strong>{r.name || "—"}</strong>,
                  fmtDate(r.date),
                  r.impression || "—",
                ])}
                widths={["28%", "16%", "56%"]}
              />
            </>
          ) : null}
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          10. CONSENT FORMS                                [NABH PRE.1]
          ════════════════════════════════════════════════════════════ */}
      {(f.consents || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH PRE.1">Consent Forms</SectionHeader>
          <MiniTable
            headers={["Form", "Signed", "Signed by", "Witness", "Signed at"]}
            rows={f.consents.map((c) => [
              c.name || "—",
              c.signed
                ? <span style={{ color: COL.ok, fontWeight: 600 }}>Yes</span>
                : <em style={{ color: COL.abN }}>Pending — to be obtained</em>,
              displayActor(c.signedBy),
              displayActor(c.witness),
              c.signedAt ? fmtDateTime(c.signedAt) : "—",
            ])}
            widths={["32%", "12%", "20%", "20%", "16%"]}
          />
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          11. DIETETIC CARE                                [NABH COP.4]
          ════════════════════════════════════════════════════════════ */}
      {(f.dietPlans || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH COP.4">Dietetic Care</SectionHeader>
          <MiniTable
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
          12. NURSING CARE PLANS                           [NABH COP.2]
          ════════════════════════════════════════════════════════════ */}
      {(f.nursingCarePlans || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH COP.2">Nursing Care Plans</SectionHeader>
          {f.nursingCarePlans.map((p, i) => (
            <Para key={`ncp-${i}`}>
              <strong>{p.at ? fmtDate(p.at, true) : "—"}</strong>
              {p.diagnosis ? <> — diagnosis: <strong>{p.diagnosis}</strong></> : null}.
              {p.goals ? <> Goal: {stripDot(p.goals)}.</> : null}
              {p.interventions ? <> Interventions: {stripDot(p.interventions)}.</> : null}
              {p.evaluation ? <> <em>Outcome: {stripDot(p.evaluation)}.</em></> : null}
              {p.nurseName ? <> <em style={{ color: COL.muted }}>— {displayActor(p.nurseName)}</em></> : null}
            </Para>
          ))}
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          13. NURSING RE-ASSESSMENTS                       [NABH COP.2]
          ════════════════════════════════════════════════════════════ */}
      {(f.nursingAssessments || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH COP.2">Nursing Re-assessments</SectionHeader>
          {f.nursingAssessments.map((a, i) => (
            <Para key={`nra-${i}`}>
              <strong>{a.at ? fmtDateTime(a.at) : "—"}</strong>
              {a.type ? <> · {a.type}</> : null}
              {" — "}{a.content || "—"}
              {a.nurseName ? <> <em style={{ color: COL.muted }}>· {displayActor(a.nurseName)}</em></> : null}
            </Para>
          ))}
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          14. BLOOD TRANSFUSION                       [NABH HIC.4/MOM.4]
          ════════════════════════════════════════════════════════════ */}
      {(f.bloodTransfusion || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH HIC.4 / MOM.4">Blood Transfusion</SectionHeader>
          <MiniTable
            headers={["Date / Time", "Component", "Bag no", "Vol", "Pre (BP/P)", "Post (BP/P)", "Reaction", "Given by"]}
            rows={f.bloodTransfusion.map((b) => [
              fmtDateTime(b.at),
              b.component || "—",
              b.bagNumber || "—",
              b.volumeMl != null ? `${b.volumeMl} mL` : "—",
              `${b.preVitals?.bp || "—"} / ${b.preVitals?.pulse || "—"}`,
              `${b.postVitals?.bp || "—"} / ${b.postVitals?.pulse || "—"}`,
              <span style={{ color: b.reaction ? COL.abN : COL.body, fontWeight: b.reaction ? 700 : 400, fontStyle: b.reaction ? "italic" : "normal" }}>
                {b.reaction ? `Yes${b.reactionType ? ` — ${b.reactionType}` : ""}` : "No"}
              </span>,
              displayActor(b.transfusedBy),
            ])}
            widths={["14%", "12%", "10%", "8%", "12%", "12%", "14%", "18%"]}
          />
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          15. MEDICO-LEGAL RECORDS                         [NABH ROM.4]
          ════════════════════════════════════════════════════════════ */}
      {(f.mlc || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH ROM.4">Medico-legal Records</SectionHeader>
          {f.mlc.map((m, i) => (
            <Para key={`mlc-${i}`}>
              <strong>{m.at ? fmtDateTime(m.at) : "—"}</strong>
              {m.type ? <> · {m.type}</> : null}
              {m.io ? <> · IO <em>{m.io}</em></> : null}
              {m.station ? <> ({m.station})</> : null}.
              {m.brief ? <> Brief: {stripDot(m.brief)}.</> : null}
              {m.signedBy ? <> <em style={{ color: COL.muted }}>Signed by {displayActor(m.signedBy)}.</em></> : null}
            </Para>
          ))}
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          16. BED TRANSFERS                                [NABH COP.6]
          R7fy: Shift handovers moved into Day-wise Clinical Journey
          (the per-day Handovers sub-block). Bed Transfers kept here
          as they're usually 1-2 events, not shift-paced.
          ════════════════════════════════════════════════════════════ */}
      {(f.bedTransfers || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH COP.6">Bed Transfers</SectionHeader>
          <MiniTable
            headers={["Date / Time", "From", "To", "Reason", "By"]}
            rows={f.bedTransfers.map((t) => [
              fmtDateTime(t.at),
              t.fromBed || "—",
              t.toBed || "—",
              t.reason || "—",
              displayActor(t.by),
            ])}
            widths={["16%", "16%", "16%", "32%", "20%"]}
          />
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          17. DISCHARGE SUMMARY                           [NABH AAC.11]
          ════════════════════════════════════════════════════════════ */}
      {(f.admission?.dischargeDate || dischargeMeds.length > 0
        || f.discharge?.advice || f.discharge?.followUpDate
        || f.discharge?.summary) ? (
        <>
          <SectionHeader nabh="NABH AAC.11">Discharge Summary</SectionHeader>

          {f.discharge?.summary ? (
            <Para>{cleanSentence(f.discharge.summary)}</Para>
          ) : null}

          <Para>
            {fullName} was <strong>discharged</strong>
            {f.admission?.dischargeDate ? <> on <strong>{fmtDate(f.admission.dischargeDate, true)}</strong></> : null}
            {f.discharge?.condition ? <> in <strong>{f.discharge.condition.toLowerCase()}</strong> condition</> : null}.
            {dxFinal ? <> Final diagnosis: <strong>{dxFinal}</strong>{f.admission?.icd10 ? <> (ICD-10 {f.admission.icd10})</> : null}.</> : null}
          </Para>

          {dischargeMeds.length > 0 ? (
            <>
              <SubHeader>Discharge Medications</SubHeader>
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
                    <th style={{ ...CELL_TH, width: "30%" }}>Drug</th>
                    <th style={{ ...CELL_TH, width: "12%" }}>Dose</th>
                    <th style={{ ...CELL_TH, width: "12%" }}>Frequency</th>
                    <th style={{ ...CELL_TH, width: "10%" }}>Route</th>
                    <th style={{ ...CELL_TH, width: "14%" }}>Duration</th>
                    <th style={{ ...CELL_TH }}>Instructions</th>
                  </tr>
                </thead>
                <tbody>
                  {dischargeMeds.map((m, i) => {
                    const drugName = m.name || m.drug || "—";
                    const duration = m.duration
                      ? m.duration
                      : m.endDate
                        ? `Until ${fmtDate(m.endDate)}`
                        : "Continued";
                    return (
                      <tr key={`dm-${i}`} className="bill-line-row">
                        <td style={CELL_TD}>
                          <div style={{ fontWeight: 700 }}>{drugName}</div>
                          {m.generic ? (
                            <div style={{ fontSize: 9, color: COL.muted }}>{m.generic}</div>
                          ) : null}
                        </td>
                        <td style={CELL_TD}>{m.dose || "—"}</td>
                        <td style={CELL_TD}>{m.frequency || "—"}</td>
                        <td style={CELL_TD}>{m.route || "—"}</td>
                        <td style={CELL_TD}>{duration}</td>
                        <td style={CELL_TD}>
                          {(m.instructions || m.indication) ? (
                            <em>{m.instructions || m.indication}</em>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : null}

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
                <SubHeader>Advice on Discharge</SubHeader>
                <ol style={{ fontSize: 10.5, lineHeight: 1.4, color: COL.body, margin: "2px 0 6px 22px", padding: 0 }}>
                  {lines.map((t, idx) => (
                    <li key={`adv-${idx}`} style={{ marginBottom: 2 }}>{t}</li>
                  ))}
                </ol>
              </>
            );
          })()}

          {(f.discharge?.followUpDate || f.admission?.consultant) ? (
            <>
              <SubHeader>Follow-up</SubHeader>
              <Para>
                {subj} is to follow up with{" "}
                {f.admission?.consultant ? <><strong>{f.admission.consultant}</strong></> : <>the treating consultant</>}
                {" "}on{" "}
                <strong>
                  {f.discharge?.followUpDate ? fmtDate(f.discharge.followUpDate) : "the advised date"}
                </strong>. The hospital remains available round-the-clock for any
                urgent concerns. {pos.charAt(0).toUpperCase() + pos.slice(1)} general
                practitioner may be contacted in the interim.
              </Para>
            </>
          ) : null}

          <Para style={{ marginTop: 6 }}>
            <em>
              In our clinical judgment, {subjL} is <strong>fit for discharge</strong> on the
              date stated above. Ongoing care and any post-discharge
              complications should be managed in concert with the
              attending physician.
            </em>
          </Para>
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          18. BILLING SUMMARY                                     [—]
          ════════════════════════════════════════════════════════════ */}
      {bills.length > 0 ? (() => {
        let totBilled = 0, totPaid = 0, totBal = 0;
        const rows = bills.map((b) => {
          const tot  = Number(b.total ?? b.grandTotal ?? b.amount) || 0;
          const paid = Number(b.paid  ?? b.amountPaid)             || 0;
          const bal  = Number(b.balance ?? (tot - paid))           || 0;
          totBilled += tot; totPaid += paid; totBal += bal;
          return [
            b.billNo || b.invoiceNo || b.number || "—",
            b.date || b.createdAt ? fmtDate(b.date || b.createdAt) : "—",
            b.type || b.billType || "—",
            `INR ${tot.toLocaleString("en-IN")}`,
            `INR ${paid.toLocaleString("en-IN")}`,
            <strong style={{ color: bal > 0 ? COL.abN : COL.body }}>INR {bal.toLocaleString("en-IN")}</strong>,
          ];
        });
        return (
          <>
            <SectionHeader>Billing Summary</SectionHeader>
            <MiniTable
              headers={["Bill no", "Date", "Type", "Total", "Paid", "Balance"]}
              rows={rows}
              widths={["18%", "14%", "18%", "16%", "16%", "18%"]}
            />
            <Para>
              Total billed <strong>INR {totBilled.toLocaleString("en-IN")}</strong>,
              paid <strong>INR {totPaid.toLocaleString("en-IN")}</strong>,
              outstanding <strong style={{ color: totBal > 0 ? COL.abN : COL.body }}>INR {totBal.toLocaleString("en-IN")}</strong>.
            </Para>
          </>
        );
      })() : null}

      {/* ════════════════════════════════════════════════════════════
          19. ACTIVITY LOG                                 [NABH IMS.1]
          R7gb P0-12 — PHI defence-in-depth: only Admin / MRD / Doctor
          / Accountant prints expose the audit trail. Nurses,
          dieticians, lab/pharmacy roles and unauthenticated demo
          prints get the section collapsed.
          ════════════════════════════════════════════════════════════ */}
      {canSeeActivityLog && (f.activityLog || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH IMS.1">Activity Log</SectionHeader>
          <MiniTable
            headers={["Timestamp", "Actor", "Action", "Summary"]}
            // R7gc — print all audit log entries (no -20 cap).
            rows={(f.activityLog || []).map((a) => [
              fmtDateTime(a.at),
              displayActor(a.userName),
              a.action || "—",
              a.summary || a.area || "—",
            ])}
            widths={["18%", "20%", "16%", "46%"]}
          />
          {/* R7gc — full audit log, no truncation. */}
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          20. SCORING TRENDS                               [NABH COP.3]
          ════════════════════════════════════════════════════════════ */}
      {(() => {
        const lines = [];
        if (painSeries.length > 1) {
          const vals = painSeries.map((p) => p.val);
          const min = Math.min(...vals), max = Math.max(...vals);
          const peak = painSeries.find((p) => p.val === max);
          lines.push(
            <Para key="pain-trend">
              <strong>Pain scores:</strong> ranged from <strong>{min}</strong> to <strong>{max}</strong>{" "}
              over {painSeries.length} readings
              {peak?.at ? <> · peak <strong>{max}</strong> on {fmtDate(peak.at, true)}</> : null}.
            </Para>
          );
        }
        if (morseVal != null) {
          lines.push(
            <Para key="morse-trend">
              <strong>Morse Fall Risk at admission:</strong> {morseVal}/125 — <em>{morseRisk || morseBand(morseVal)}</em>.
            </Para>
          );
        }
        if (bradenVal != null) {
          lines.push(
            <Para key="braden-trend">
              <strong>Braden score at admission:</strong> {bradenVal}/23 — <em>{bradenRisk || bradenBand(bradenVal)}</em>.
            </Para>
          );
        }
        if (nutriVal != null) {
          lines.push(
            <Para key="nutri-trend">
              <strong>Nutritional risk (MUST):</strong> {nutriVal}/6 — <em>{nutriRisk || nutritionBand(nutriVal)}</em>.
            </Para>
          );
        }
        if (lines.length === 0) return null;
        return (
          <>
            <SectionHeader nabh="NABH COP.3">Scoring Trends</SectionHeader>
            {lines}
          </>
        );
      })()}

      {/* ════════════════════════════════════════════════════════════
          21. COMPLETE CHRONOLOGICAL TIMELINE              [NABH IMS.1]
          ════════════════════════════════════════════════════════════ */}
      {(events || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH IMS.1">Complete Chronological Timeline</SectionHeader>
          <MiniTable
            headers={["Timestamp", "Kind", "Actor", "Summary"]}
            rows={(events || []).slice(0, 100).map((e) => [
              fmtDateTime(e.at),
              e.kind || "—",
              displayActor(e.actor),
              e.summary || "—",
            ])}
            widths={["18%", "14%", "20%", "48%"]}
          />
          {events.length > 100 ? (
            <Para style={{ color: COL.muted, fontSize: 9 }}>
              <em>… plus {events.length - 100} more events archived.</em>
            </Para>
          ) : null}
        </>
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
