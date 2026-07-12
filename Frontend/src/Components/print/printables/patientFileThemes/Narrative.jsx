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
// R7gd — embed identical per-type cards (the ones used in individual note
// print) inside the Complete File day-wise Clinical Journey so the
// Death MCCD, ICU bundle, Procedure WHO Timeout, Pre-op Checklist,
// Vitals/IV/Pain/Wound/Braden/MEWS etc. all show the same structured
// layout the user saw in the standalone printouts.
import { buildDoctorNoteCardHtml } from "@/pages/doctor/buildDoctorNoteCardHtml";
import { buildNurseNoteCardHtml }  from "@/pages/nursing/printNurseNote";
// Shared, comprehensive PROSE Initial-Assessment renderer — the SAME renderer
// the individual IA print uses — so the IA reads identically on both surfaces.
import { buildInitialAssessmentHtml } from "./buildInitialAssessmentHtml";
// /uploads signature images are JWT-gated — the inline-to-data-URL hook
// (builder HTML) fetches them through axios with the Bearer token; a plain
// <img src="/uploads/…"> would 401.
import { useInlinedUploadsHtml } from "@/utils/secureUploads";
// R7hr(THEME-REG): coverage/register row logic now shared across all 5
// themes from registerRows.js — one source of truth for field names.
import { COVERAGE_BLOCKS, COVERAGE_ORDER, REGISTER_META, REGISTER_HEADERS, REGISTER_WIDTHS, registerRow } from "./registerRows";
// R7hr(DOCS-FULL): full standalone-level discharge summary in the file.
import FullDischargeSection from "./FullDischargeSection";
// R7hr(DOCS-FULL 2/6): NABL results tables + full diagnostic reports.
import { FullLabTrends, FullDiagnosticReports } from "./FullLabSection";

/* R7gd note-card embed wrapped in a component so the JWT-gated /uploads
   signature inlining hook can run per-card (hooks can't live in a .map). */
function EmbeddedNoteCard({ note }) {
  const isDoc = note._kind === "doctor";
  // R7hu — mirror the timeline + panel: hide the "nursing intake / cross-
  // disciplinary" tail on a DOCTOR Initial Assessment card so the note renders
  // identically on all three surfaces. Was `buildDoctorNoteCardHtml(note)` with
  // no opts (default false → the block showed only in the Complete File print).
  const isDoctorIA = note.noteType === "initial" || note.noteType === "initialAssessment";
  // R7hu — the Complete File print renders every note in the PROSE variant
  // (flowing bold-label lines like the Doctor Initial Assessment narrative), so
  // the whole printed file reads in one consistent design. The Doctor Notes
  // timeline + patient panel pass no `prose`, so they keep the card design.
  const raw = isDoc
    ? buildDoctorNoteCardHtml(note, { prose: true, hideNursingExtras: isDoctorIA })
    : buildNurseNoteCardHtml(note, { prose: true });
  const html = useInlinedUploadsHtml(raw);
  return (
    <div
      style={{ marginBottom: 6 }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

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

// Temperature arrives as °F from most capture forms (NurseInitialAssessment,
// NursingNotes vitals, IPD IA) and as °C from a few (MEWS, daily toggle) — and
// no unit is stored with the value. Infer by magnitude: a body temperature
// ≥ 45 is Fahrenheit (normal 97–99), below that Celsius (normal 36–38). This
// prints "98.6°F" and "37.0°C" correctly instead of the old fixed label that
// turned a real 98.6°F reading into a lethal-looking "98.6°C".
const fmtTemp = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return v == null ? "" : String(v);
  return `${v}°${n >= 45 ? "F" : "C"}`;
};
// ── MAR (medication administration) timing helpers ──────────────────────────
// Scheduled slot "HH:MM" → minutes-of-day, for ordering a drug's doses. Non-
// clock slots ("Continuous"/"Immediate"/"") sort ahead of timed ones.
const _schedMin = (a) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(a?.schedTime || "");
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const g = a?.givenAt ? new Date(a.givenAt) : null;
  return g && !isNaN(g.getTime()) ? g.getHours() * 60 + g.getMinutes() : -1;
};
const _fmtDelay = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
};
// Was a dose given on time? Compare givenAt to its HH:MM scheduled slot on the
// same day: within 30 min → on time; later → late; earlier → early. Returns
// null when the slot isn't a clock time (Continuous/Immediate) or givenAt is
// absent, so "timely diya ya nahi" only shows where it's meaningful.
const _doseTiming = (a) => {
  if (!a?.givenAt || !/^\d{1,2}:\d{2}/.test(a.schedTime || "")) return null;
  const g = new Date(a.givenAt);
  if (isNaN(g.getTime())) return null;
  const [h, m] = a.schedTime.split(":").map(Number);
  const sched = new Date(g); sched.setHours(h, m, 0, 0);
  const diff = Math.round((g - sched) / 60000);
  if (Math.abs(diff) <= 30) return { label: "on time", color: "#15803d" };
  return diff > 0 ? { label: `late ${_fmtDelay(diff)}`, color: "#b45309" }
                  : { label: `early ${_fmtDelay(-diff)}`, color: "#b45309" };
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
  accent:  "#3730a3",  // KEY-fact bold tint
  head:    "#3730a3",  // Day banner + IA signer pill (R7gu / R7gt)
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

const _cellEmpty = (c) => c == null || c === "" || c === "—";
const MiniTable = ({ headers, rows, widths }) => {
  const keep = headers.map((_, ci) => ci === 0 || rows.some((cells) => !_cellEmpty(cells[ci])));
  const H = headers.filter((_, i) => keep[i]);
  const W = widths ? widths.filter((_, i) => keep[i]) : null;
  const R = rows.map((cells) => cells.filter((_, i) => keep[i]));
  return (
    <table
      className="pr-table"
      style={{ width: "100%", borderCollapse: "collapse", marginBottom: 6, fontSize: 9, pageBreakInside: "auto" }}
    >
      <thead>
        <tr>
          {H.map((h, i) => (
            <th key={`th-${i}`} style={{ ...CELL_TH, width: W?.[i] || "auto" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {R.map((cells, ri) => (
          <tr key={`tr-${ri}`} className="bill-line-row">
            {cells.map((c, ci) => (
              <td key={`td-${ri}-${ci}`} style={CELL_TD}>{_cellEmpty(c) ? "—" : c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

// Alias kept for any legacy reference inside helpers.
const Table = MiniTable;

/* ── R7hr — full-coverage record renderers ─────────────────────────────
   Config-driven so every remaining captured collection reaches the file
   with minimal code. Each entry: how to read a row into table cells.
   A block renders only when it has ≥1 row (self-eliding).            */
function CoverageRecords({ file }) {
  const blocks = COVERAGE_BLOCKS
    .slice()
    .sort((a, b) => {
      const ia = COVERAGE_ORDER.indexOf(a.key), ib = COVERAGE_ORDER.indexOf(b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map((b) => ({ b, rows: Array.isArray(file?.[b.key]) ? file[b.key] : [] }))
    .filter(({ rows }) => rows.length > 0);
  if (blocks.length === 0) return null;
  return (
    <>
      {blocks.map(({ b, rows }) => (
        <React.Fragment key={b.key}>
          <SectionHeader nabh={b.nabh || undefined}>{b.title}</SectionHeader>
          <MiniTable headers={b.headers} widths={b.widths} rows={rows.map((x) => b.row(x))} />
        </React.Fragment>
      ))}
    </>
  );
}


function ComplianceRegisters({ registers }) {
  const reg = registers || {};
  const present = Object.keys(REGISTER_META).filter((k) => Array.isArray(reg[k]) && reg[k].length > 0);
  if (present.length === 0) return null;
  return (
    <>
      <SectionHeader nabh="NABH">Safety &amp; Compliance Registers</SectionHeader>
      {present.map((k) => {
        const meta = REGISTER_META[k];
        return (
          <React.Fragment key={k}>
            <SubHeader>{meta.title}{meta.nabh ? ` · ${meta.nabh}` : ""}</SubHeader>
            <MiniTable
              headers={REGISTER_HEADERS}
              widths={REGISTER_WIDTHS}
              rows={reg[k].map(registerRow)}
            />
          </React.Fragment>
        );
      })}
    </>
  );
}

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

/* Safe scalar — avoids React "objects are not valid as a child" crashes
   when an IA field carries a nested object instead of a primitive. Still used
   by the risk-score extraction (morseVal / bradenVal / …) below. */
const scalarOrNum = (v) => (v != null && (typeof v === "number" || typeof v === "string")) ? v : null;

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
  // R7gf — Use CLINICAL date (n.noteDate / shift time) as primary day
  // key, falling back to createdAt only when noteDate is missing.
  // Late-entry notes recorded on 31 May but documenting a 30 May
  // clinical event must appear under the 30 May day-block, not the
  // 31 May save-date block. Same rule for nursing notes whose shift
  // time is the truthful clinical date.
  const marByDay      = groupByDay(f.mar,            (m) => m.givenAt   || m.createdAt);
  const docNotesByDay = groupByDay(f.doctorNotes,    (n) => n.noteDate || n.visitDate || n.createdAt);
  const nurNotesByDay = groupByDay(f.nursingNotes,   (n) => n.noteDate || n.createdAt);
  const ordersByDay   = groupByDay(f.doctorOrders,   (o) => o.orderedAt || o.createdAt);
  const handoverByDay = groupByDay(f.shiftHandovers, (h) => h.at);
  // R7hu — per-day MAR: explode every order's administrationRecord and bucket
  // each dose by its scheduled (or given) DAY, then by drug — so the day-wise
  // chart shows one row per medicine with THAT day's doses (scheduled → given
  // · by whom · on-time), instead of repeating the whole order under the day
  // it was written. A drug running TDS is a single row with three dose lines.
  const medsByDay = (() => {
    const map = new Map(); // dayKey -> Map<drugKey, { o, doses[] }>
    (f.doctorOrders || []).forEach((o) => {
      (Array.isArray(o.admin) ? o.admin : []).forEach((a) => {
        // Bucket by the day the dose was actually GIVEN (the truthful clinical
        // day); fall back to the scheduled day for a dose that was never given
        // (missed / pending), so those still surface on their chart day.
        const when = a.givenAt || a.schedDate;
        const dk = when ? dayKey(when) : null;
        if (!dk) return;
        if (!map.has(dk)) map.set(dk, new Map());
        const day = map.get(dk);
        const key = `${o.displayName}|${o.dose}|${o.route}|${o.frequency}|${o.orderType}`;
        if (!day.has(key)) day.set(key, { o, doses: [] });
        day.get(key).doses.push(a);
      });
    });
    map.forEach((day) => day.forEach((e) => e.doses.sort((x, y) => _schedMin(x) - _schedMin(y))));
    return map;
  })();
  /* R7gt — Extend the day-wise journey to absorb the remaining time-
     stamped streams the user expects to read day-by-day: vital signs,
     intake/output, investigations, blood transfusion, nursing care
     plans, nursing reassessments, consents (per-day signing), ICU
     bundles, bed transfers, MLC entries. Each stream gets its own
     by-day map; the day loop below renders whichever ones have rows. */
  const vitalsByDay   = groupByDay(f.vitalsTrend || [], (v) => v.at || v.recordedAt || v.createdAt);
  const ioByDay       = groupByDay(f.intakeOutput || [], (r) => r.at || r.recordedAt || r.createdAt);
  const invsByDay     = groupByDay((f.investigations || []).filter((i) => i.name),
                                   (i) => i.reportedAt || i.orderedAt || i.createdAt);
  const bloodByDay    = groupByDay(f.bloodTransfusion || [], (b) => b.at || b.startedAt || b.createdAt);
  const carePlanByDay = groupByDay(f.nursingCarePlans || [], (p) => p.at || p.assessmentDate || p.createdAt);
  const nurAssByDay   = groupByDay(f.nursingAssessments || [], (a) => a.at || a.assessmentDate || a.createdAt);
  const consentByDay  = groupByDay(f.consents || [], (c) => c.signedAt || c.createdAt);
  const icuByDay      = groupByDay(f.icuBundles || [], (b) => b.at || b.date || b.bundleDate || b.createdAt);
  const xferByDay     = groupByDay(f.bedTransfers || [], (t) => t.transferredAt || t.at || t.createdAt);
  const mlcByDay      = groupByDay(f.mlc || [], (m) => m.at || m.incidentDate || m.createdAt);
  // Merge doctor + nursing notes for a given day into a single chronological
  // stream so the printout reads like a real clinical timeline (R7fy).
  // R7gf — Sort within a day by clinical timestamp (noteDate), not the
  // save timestamp, so 8 am notes appear before 8 pm notes regardless
  // of which one was filed first.
  const notesForDay = (dayKeyStr) => {
    // R7hu — Initial Assessments (doctor + nurse) render in their own dedicated
    // prose sections above the journey, so drop them here to avoid printing the
    // IA twice (once in its section, once in the day-wise stream).
    const _isIA = (n) => n.noteType === "initial" || n.noteType === "initialAssessment";
    const docs  = (docNotesByDay.get(dayKeyStr) || []).filter((n) => !_isIA(n)).map((n) => ({ ...n, _kind: "doctor"  }));
    // R7hu — vitals are entered in the hourly Vital Chart (VitalSheet); the day
    // renders that as a full hourly grid below (vitalsBlock). So when this day
    // HAS a grid, drop the redundant single-snapshot "Vital Signs" note card —
    // the user's "vitals aise show he nhi honge". A day with a vitals note but
    // no grid still shows the note (fallback), so nothing is ever lost.
    const hasVitalGrid = (vitalsByDay.get(dayKeyStr) || []).length > 0;
    const nurs  = (nurNotesByDay.get(dayKeyStr) || [])
      .filter((n) => !(hasVitalGrid && n.noteType === "vitals"))
      .map((n) => ({ ...n, _kind: "nursing" }));
    return [...docs, ...nurs].sort((a, b) =>
      new Date(a.noteDate || a.createdAt || 0).getTime()
      - new Date(b.noteDate || b.createdAt || 0).getTime()
    );
  };

  /* ── Diagnosis triplet ──────────────────────────────────────── */
  const dxProv  = stripDot(f.admission?.provisionalDiagnosis || f.ia?.doctor?.provisionalDiagnosis || "");
  const dxWork  = stripDot(f.admission?.workingDiagnosis || f.ia?.doctor?.workingDiagnosis || "");
  const dxFinal = stripDot(f.admission?.finalDiagnosis || f.ia?.doctor?.finalDiagnosis || "");

  /* ── Investigations split ───────────────────────────────────── */
  const invs = (f.investigations || []).filter((i) => i.name);
  const abnormalInvs = invs.filter((i) => isResultAbnormal(i.result));
  const normalInvs   = invs.filter((i) => !isResultAbnormal(i.result));

  /* ── Allergies + isolation ──────────────────────────────────── */
  const allergies = (f.alerts?.allergies || []).map(allergyLine).filter(Boolean);
  const isolationFlags = (f.alerts?.isolationFlags || []).filter(Boolean);

  // Comorbidities / devices / skin / code-status / risk-acknowledgement / care
  // plan derivations were removed here — the shared Initial-Assessment renderer
  // (buildInitialAssessmentHtml) now normalises those from the canonical `ia`
  // shape built by the adapter below.

  /* ── Home meds (still consumed by the IA adapter below) ─────── */
  const homeMeds = Array.isArray(f.history?.homeMeds) ? f.history.homeMeds
                 : Array.isArray(f.ia?.nursing?.homeMedications) ? f.ia.nursing.homeMedications : [];

  /* ── Risk scores extraction (consumed by the IA adapter + the
       Scoring-Trends section below) ─────────────────────────────── */
  // R7hr(F5-audit) — UNION the two nursing-IA copies so the Complete File
  // shows everything: the admission-backfilled record (riskAssessments,
  // systemAssessment, psychosocial, nutritionHydration, carePlan…) PLUS the
  // signed nurse-IA note's wrappers (anthropometry, allergies, mobility…).
  // Each copy is partial; the admission copy wins on collisions (canonical
  // backfill) — the same precedence the patient panel's adapter uses, so
  // both surfaces render the identical union.
  const _nurseIaNote = [...(f.nursingNotes || []), ...(f.doctorNotes || [])].find(
    (x) => x && (x.noteType === "initial" || x.noteType === "initialAssessment") &&
      (x.section === "nursing" || x.noteData?.nursing || x.noteData?.nursingNabh ||
       x.noteDetails?.nursing || x.noteDetails?.nursingNabh)
  );
  const _nurseIaNoteFlat = _nurseIaNote
    ? {
        ...(_nurseIaNote.noteData?.nursingNabh || {}),
        ...(_nurseIaNote.noteData?.nursing || {}),
        ...(_nurseIaNote.noteDetails?.nursingNabh || {}),
        ...(_nurseIaNote.noteDetails?.nursing || {}),
      }
    : {};
  const n = { ..._nurseIaNoteFlat, ...(f.ia?.nursing || {}) };
  const d = f.ia?.doctor || {};

  const morseVal   = pick(n, "fallRisk", "morseTotal", "morseScore") ?? scalarOrNum(n.morse?.total) ?? scalarOrNum(n.riskAssessments?.morseFallScale?.totalScore);
  const bradenVal  = pick(n, "pressureUlcer", "bradenTotal", "bradenScore") ?? scalarOrNum(n.braden?.total) ?? scalarOrNum(n.riskAssessments?.bradenScale?.totalScore);
  const painVal    = pick(n, "painScore", "vasPain") ?? scalarOrNum(n.pain?.score) ?? scalarOrNum(n.pain?.total) ?? scalarOrNum(n.vitals?.painScore);
  const nutriVal   = pick(n, "nutritionScore", "must", "nutriRisk", "mna") ?? scalarOrNum(n.nutrition?.score) ?? scalarOrNum(n.nutri?.total);
  const vteVal     = pick(n, "vteRisk", "padua") ?? scalarOrNum(n.vte?.total) ?? scalarOrNum(d.vte?.total) ?? pick(d, "vteRisk", "padua");
  const dvtVal     = pick(n, "dvtRisk") ?? scalarOrNum(n.dvt?.total) ?? pick(d, "dvtRisk");
  const gcsVal     = pick(d, "gcs", "GCS") ?? scalarOrNum(d.gcs?.total) ?? pick(n, "gcs", "GCS") ?? scalarOrNum(n.vitals?.gcs);
  const morseRisk  = (typeof n.morse?.risk === "string") ? n.morse.risk
                   : (typeof n.riskAssessments?.morseFallScale?.riskLevel === "string" ? n.riskAssessments.morseFallScale.riskLevel : null);
  const bradenRisk = (typeof n.braden?.risk === "string") ? n.braden.risk
                   : (typeof n.riskAssessments?.bradenScale?.riskLevel === "string" ? n.riskAssessments.bradenScale.riskLevel : null);
  const nutriRisk  = (typeof n.nutri?.risk === "string") ? n.nutri.risk : (typeof n.nutrition?.risk === "string" ? n.nutrition.risk : null);
  const vteRisk    = (typeof n.vte?.risk === "string") ? n.vte.risk : null;

  // Doctor / nursing IA signer lines, past/family/social one-liners, exam
  // paragraphs and the ROS one-liner were removed here — the shared
  // Initial-Assessment renderer (buildInitialAssessmentHtml) now composes all
  // of those from the canonical `ia` shape assembled by the adapter below.

  /* ── Helper to compose drug name from a doctor-order row ──── */
  const orderDetailLine = (o) => {
    const det = [o.displayName, o.dose, o.route, o.frequency].filter(Boolean).join(" · ");
    return det || "—";
  };
  // Colour-coded administration status (given / missed / held / pending) for
  // the per-order nursing-action table in the treatment chart.
  const adminStatusCell = (s) => {
    const v = String(s || "").toLowerCase();
    const color = v === "given" ? "#15803d"
                : v === "missed" ? "#b91c1c"
                : v === "held"   ? "#b45309"
                : "#6b7280";
    return <span style={{ color, fontWeight: 600, textTransform: "capitalize" }}>{s || "—"}</span>;
  };

  // The rich nursing-IA sub-block renderers (NIA_SYS_GROUPS / label maps /
  // IAGrid / niaVitalsBlock) were removed — the shared Initial-Assessment
  // renderer (buildInitialAssessmentHtml) now owns the entire nursing IA
  // layout via the canonical adapter below.

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
          {/* R7hr — coverage: registration demographics + ER context that
              used to be dropped. Each row renders only when populated. */}
          {(() => {
            const px = f.patientExtra || {};
            const addr = px.addressDetail || {};
            const addrLine = [addr.completeAddress, addr.district, addr.city, addr.state, addr.pincode]
              .filter(Boolean).join(", ");
            const contact = [px.emergencyContact?.name,
              px.emergencyContact?.relation && `(${px.emergencyContact.relation})`,
              px.emergencyContact?.phone && `☎ ${px.emergencyContact.phone}`]
              .filter(Boolean).join(" ");
            const demo = [
              f.patient?.mobile && `☎ ${f.patient.mobile}`,
              px.email, px.maritalStatus,
            ].filter(Boolean).join(" · ");
            const payer = [
              px.paymentType, px.tpaName,
              px.policyNumber && `Policy ${px.policyNumber}`,
            ].filter(Boolean).join(" · ");
            const er = [
              px.triageLevel && `Triage ${px.triageLevel}`, px.erType,
              px.broughtBy && `brought by ${px.broughtBy}`,
              px.policeStation && `PS ${px.policeStation}`,
            ].filter(Boolean).join(" · ");
            const Row = (label, val) => val ? (
              <tr>
                <td style={{ padding: "2px 6px", color: COL.muted }}>{label}</td>
                <td style={{ padding: "2px 6px", color: COL.body }}>{val}</td>
              </tr>
            ) : null;
            return (
              <>
                {Row("Contact", demo)}
                {Row("Address", addrLine)}
                {Row("Emergency contact", contact)}
                {Row("Payer", payer)}
                {Row("Emergency / triage", er)}
              </>
            );
          })()}
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
          Rendered by the SHARED comprehensive PROSE renderer
          (buildInitialAssessmentHtml) — the SAME one the individual IA
          print uses — so the IA looks identical on both surfaces. The
          adapter below maps the Complete-File data (f.ia.doctor /
          f.ia.nursing + f.history/f.exam/f.vitals/f.alerts) into the
          canonical { role:"both", doctor, nursing } shape.
          ════════════════════════════════════════════════════════════ */}
      {(() => {
        const _iaAllergies = (f.alerts?.allergies || [])
          .map((a) => (typeof a === "string"
            ? { name: a }
            : { name: a.allergen || a.agent || a.name, agent: a.agent || a.allergen || a.name, severity: a.severity, reaction: a.reaction, type: a.type }))
          .filter((a) => a.name || a.reaction);
        const iaForFile = {
          role: "both",
          doctor: {
            doctorName: d.doctorName || d.signedByName || f.admission?.consultant,
            regNo: d.signedByReg || d.mciRegNo || d.regNo,
            chiefComplaints: f.history?.chief || d.chiefComplaints || f.ia?.nursing?.chiefComplaint,
            ccDuration: d.ccDuration,
            hopi: f.history?.hopi || d.hopi,
            pastMedical: f.history?.medical || d.pastMedical,
            pastSurgical: f.history?.surgical || d.pastSurgical,
            familyHistory: f.history?.family || d.familyHistory,
            socialHistory: f.history?.social || d.socialHistory,
            comorbidities: d.comorbidities || null,
            // R7hr(F5-audit) — the doctor IA block shows only what the DOCTOR
            // recorded (the signed note's own allergies); the patient-level
            // alert list already surfaces in the file's alerts banner and the
            // nursing block. Injecting it here made the file's doctor IA
            // differ from the panel's / individual print's.
            allergies: {
              noKnown: d.allergies?.noKnown ?? d.noKnownAllergies,
              list: Array.isArray(d.allergies?.list) ? d.allergies.list : [],
            },
            medReconciliation: Array.isArray(d.medicationReconciliation) ? d.medicationReconciliation : [],
            clinicalExamination: {
              general: f.exam?.generalExam || d.generalExamination,
              systemic: f.exam?.systemicExam || d.systemicExamination,
              ros: f.exam?.ros || d.reviewOfSystems || d.ros || {},
            },
            localExam: d.localExamination || d.localExam,
            provisionalDiagnosis: f.admission?.provisionalDiagnosis || d.provisionalDiagnosis,
            workingDiagnosis: f.admission?.workingDiagnosis || d.workingDiagnosis,
            finalDiagnosis: f.admission?.finalDiagnosis || d.finalDiagnosis,
            icd10: f.admission?.icd10 || d.icd10,
            icd10Description: f.admission?.icd10Desc || d.icd10Description,
            patientStatus: d.patientStatus,
            differentialDiagnosis: d.differentialDiagnosis || d.differentialDx,
            // R7hr(F5-audit) — doctor's own anthropometry only (see allergies
            // note above); nurse-measured height/weight render in the nursing
            // block's Anthropometry.
            anthropometry: d.anthropometry || {},
            investigations: Array.isArray(d.investigations) ? d.investigations : [],
            investigationsText: typeof d.investigations === "string" ? d.investigations : (d.plannedInvestigations || ""),
            treatmentPlan: d.treatmentPlan,
            prescription: Array.isArray(d.prescription) ? d.prescription : (Array.isArray(d.medications) ? d.medications : []),
            infusions: Array.isArray(d.infusions) ? d.infusions : [],
            codeStatus: (typeof d.codeStatus === "object" && d.codeStatus) ? d.codeStatus.value : d.codeStatus,
            codeStatusDiscussedWith: (typeof d.codeStatus === "object" && d.codeStatus) ? d.codeStatus.discussedWith : d.codeStatusDiscussedWith,
            codeStatusLimitations: (typeof d.codeStatus === "object" && d.codeStatus) ? d.codeStatus.limitations : d.codeStatusLimitations,
            elosDays: d.elosDays,
            goalOfCare: d.goalOfCare,
            riskAcknowledgement: d.riskAcknowledgement || null,
            referrals: Array.isArray(d.referrals) ? d.referrals : [],
            prognosis: (typeof d.prognosis === "object" && d.prognosis) ? d.prognosis : (d.prognosis ? { summary: d.prognosis } : {}),
            consentNeeded: d.consentNeeded || d.consentsRequired || {},
            obGyn: f.history?.obstetric || d.obstetricGynae || {},
            immunisation: f.history?.immunisation || d.immunisation || {},
            ecog: (typeof d.functionalEcog === "object" && d.functionalEcog) ? d.functionalEcog : (d.functionalEcog ? { score: d.functionalEcog } : (d.ecog || {})),
            spiritual: d.spiritual || {},
            dietAdvice: d.dietAdvice,
            activityAdvice: d.activityAdvice,
            followupNotes: d.followupNotes || d.followUp,
            signedBy: {
              name: d.signedByName || d.signedBy,
              reg: d.signedByReg || d.mciRegNo,
              empId: d.signedByEmpId || d.doctorEmpId,
              at: d.signedAt || d.assessmentDate,
              signature: d.signature || d.signatureImage,
            },
          },
          nursing: {
            admission: {
              date: n.admitDate, time: n.admitTime, ipdNo: n.ipdNo,
              mode: n.modeOfAdmit || n.modeOfAdmission, ward: n.ward, bed: n.bedNo,
              consciousness: n.consciousnessLevel, mobility: n.mobility,
            },
            identification: n.identification || n.idBand || {},
            vitals: n.vitals || {},
            anthropometry: n.anthropometry || {},
            // R7hr(F5-audit) — prefer the nurse-IA's own allergy block (from
            // the note's nursingNabh, now unioned into n) over the generic
            // patient-level alerts list, matching the panel adapter.
            allergies: {
              noKnown: n.allergies?.noKnown ?? (n.noKnownAllergies || n.nurseNoKnownAllergies),
              list: (Array.isArray(n.allergies?.list) && n.allergies.list.length) ? n.allergies.list : _iaAllergies,
            },
            briefHistory: n.briefPmh || n.nurseBriefPmh || f.history?.medical,
            homeMeds: Array.isArray(homeMeds) ? homeMeds : [],
            pain: n.pain || (n.painScore != null ? { score: n.painScore } : {}),
            morse: n.morse || (morseVal != null ? { total: morseVal, risk: morseRisk } : null),
            braden: n.braden || (bradenVal != null ? { total: bradenVal, risk: bradenRisk } : null),
            nutrition: n.nutrition || n.nutri || (nutriVal != null ? { total: nutriVal, risk: nutriRisk } : null),
            vte: n.vte || (vteVal != null ? { total: vteVal, risk: vteRisk } : null),
            dvt: dvtVal != null ? { total: dvtVal } : null,
            gcs: gcsVal != null ? { total: gcsVal } : null,
            psychosocial: (typeof n.psychosocial === "object" && n.psychosocial) ? n.psychosocial : {},
            // R7hr(F5-audit) — head-to-toe + nutrition detail from the
            // admission-backfilled copy (rendered generically).
            systemAssessment: (typeof n.systemAssessment === "object" && n.systemAssessment) ? n.systemAssessment : {},
            nutritionDetail: (typeof n.nutritionHydration === "object" && n.nutritionHydration) ? n.nutritionHydration : {},
            barthel: n.adl || n.barthel || {},
            bodyChart: n.bodyChart || {},
            precautions: n.precautions || {},
            education: (typeof n.educationNeeds === "object" && n.educationNeeds) ? n.educationNeeds : {},
            dischargePlanning: (typeof n.dischargePlanning === "object" && n.dischargePlanning) ? n.dischargePlanning : {},
            cognitive: (typeof n.cognitive === "object" && n.cognitive) ? n.cognitive : {},
            cultural: n.cultural || {},
            elimination: (typeof n.bowelBladder === "object" && n.bowelBladder) ? n.bowelBladder : (n.elimination || {}),
            sleep: (typeof n.sleep === "object" && n.sleep) ? n.sleep : {},
            valuables: n.valuables || {},
            caregiver: (typeof n.caregiver === "object" && n.caregiver) ? n.caregiver : {},
            highRisk: n.highRisk || {},
            mobility: (typeof n.mobilityGait === "object" && n.mobilityGait) ? n.mobilityGait : {},
            preAnaesthesia: n.preAnaesthesia || {},
            prom: n.promPrem || {},
            plan: {
              problems: n.nursingProblems,
              goals: n.nursingGoals,
              notes: n.nursingNotes
                || (typeof n.carePlan === "string" ? n.carePlan : "")
                || (typeof n.notes === "string" ? n.notes : ""),
            },
            signedBy: {
              name: n.nurseName || n.signedByName || n.signedBy,
              reg: n.signedByReg || n.nurseRegNo,
              empId: n.signedByEmpId || n.nurseEmployeeId,
              at: n.signedAt || n.submittedAt,
              signature: n.signature || n.nurseSignature || n.signatureImage,
            },
          },
        };
        const html = buildInitialAssessmentHtml(iaForFile, { prose: true });
        if (!html) return null;
        return (
          <>
            <SectionHeader nabh="NABH AAC.4 / AAC.5">Initial Assessment</SectionHeader>
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </>
        );
      })()}

      {/* ════════════════════════════════════════════════════════════
          R7hr — PREVIOUS OPD ASSESSMENTS (latest 2)     [NABH AAC.4]
          The two most recent saved OPD visit assessments before/around
          this encounter, rendered like the on-page OPD assessment form
          (visit header → complaint → vitals → 3-tier Dx → Rx table →
          advice/follow-up). Empty ⇒ section collapses entirely.
          ════════════════════════════════════════════════════════════ */}
      {Array.isArray(file.opdAssessments) && file.opdAssessments.length > 0 ? (
        <>
          <SectionHeader nabh="NABH AAC.4">Previous OPD Assessments</SectionHeader>
          {file.opdAssessments.map((v, i) => {
            const vit = v.vitals || {};
            const vitLine = [
              vit.bloodPressure || vit.bp ? `BP ${vit.bloodPressure || vit.bp}` : "",
              vit.pulse ? `Pulse ${vit.pulse}` : "",
              vit.temperature || vit.temp ? `Temp ${vit.temperature || vit.temp}` : "",
              vit.oxygenSaturation || vit.spo2 ? `SpO₂ ${vit.oxygenSaturation || vit.spo2}` : "",
              vit.weight ? `Wt ${vit.weight}` : "",
            ].filter(Boolean).join(" · ");
            const rx = Array.isArray(v.prescribedMedications) ? v.prescribedMedications : [];
            return (
              <div key={v._id || i} style={{ border: "1px solid #e2e8f0", borderLeft: "4px solid #0891b2", borderRadius: 8, padding: "9px 12px", margin: "0 0 10px", pageBreakInside: "avoid" }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline", borderBottom: "1px solid #e2e8f0", paddingBottom: 5, marginBottom: 6 }}>
                  <strong style={{ fontSize: 11.5 }}>{v.visitNumber ? (/^OPD/i.test(v.visitNumber) ? v.visitNumber : `OPD ${v.visitNumber}`) : `OPD Visit ${i + 1}`}</strong>
                  <span style={{ fontSize: 10, color: COL.muted }}>
                    {v.at ? fmtDate(v.at) : ""}{v.department ? ` · ${v.department}` : ""}{v.consultantName ? ` · ${v.consultantName}` : ""}{v.visitType ? ` · ${v.visitType}` : ""}
                  </span>
                </div>
                {v.chiefComplaint ? <Para style={{ margin: "2px 0" }}><strong>Chief complaint:</strong> {v.chiefComplaint}</Para> : null}
                {vitLine ? <Para style={{ margin: "2px 0" }}><strong>Vitals:</strong> <em>{vitLine}</em></Para> : null}
                {(v.provisionalDiagnosis || v.workingDiagnosis || v.finalDiagnosis) ? (
                  <Para style={{ margin: "2px 0" }}>
                    <strong>Diagnosis:</strong>{" "}
                    {[v.provisionalDiagnosis && `Provisional — ${v.provisionalDiagnosis}`,
                      v.workingDiagnosis && `Working — ${v.workingDiagnosis}`,
                      v.finalDiagnosis && `Final — ${v.finalDiagnosis}`].filter(Boolean).join("; ")}
                  </Para>
                ) : null}
                {v.assessmentNote ? <Para style={{ margin: "2px 0" }}><strong>Assessment:</strong> {v.assessmentNote}</Para> : null}
                {rx.length > 0 ? (
                  <MiniTable
                    headers={["Medicine", "Dosage", "Frequency", "Duration", "Instructions"]}
                    widths={["28%", "14%", "16%", "14%", "28%"]}
                    rows={rx.map((m) => [
                      m.medicineName, m.dosage, m.frequency, m.duration,
                      [m.instructions, m.mealStatus].filter(Boolean).join(" · "),
                    ])}
                  />
                ) : null}
                {v.advice ? <Para style={{ margin: "3px 0 0" }}><strong>Advice:</strong> {v.advice}</Para> : null}
                {v.followUpDate ? <Para style={{ margin: "2px 0 0" }}><strong>Follow-up:</strong> {fmtDate(v.followUpDate)}{v.followUpInstructions ? ` — ${v.followUpInstructions}` : ""}</Para> : null}
              </div>
            );
          })}
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
        // R7gt — added vitals/IO/investigations/blood/care plan/nursing
        // reassessment/consent/ICU bundle/bed transfer/MLC streams so a
        // day that recorded only a vital sign or a single transfusion
        // still surfaces as its own block.
        [docNotesByDay, nurNotesByDay, ordersByDay, marByDay, handoverByDay,
         vitalsByDay, ioByDay, invsByDay, bloodByDay, carePlanByDay,
         nurAssByDay, consentByDay, icuByDay, xferByDay, mlcByDay, medsByDay].forEach((m) => {
          for (const k of m.keys()) allKeys.add(k);
        });
        if (allKeys.size === 0) return null;
        const indexKeys = new Set(dayIndex.map((d) => d.key));
        // R7gf — Drop any day-key BEFORE the admission anchor: the user
        // does not want orphan "Mon, 25 May" pre-admission orders or
        // OPD residue polluting the day-wise IPD journey. Keys on/after
        // admission date pass through (including discharge & post-dis).
        const admKey = dayKey(f.admission?.date);
        const orderedKeys = Array.from(allKeys)
          .filter((k) => !admKey || k >= admKey)
          .sort((a, b) => a.localeCompare(b));
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
              if (!notes.length && !orders.length && !marRows.length && !handovrs.length && !(medsByDay.get(k)?.size)) return null;

              const dayMatch = dayIndex.find((d) => d.key === k);
              // R7gf — Always derive the heading from the day-key itself
              // (YYYY-MM-DD) instead of the first item's createdAt — the
              // latter would mis-render when a note was late-entered on
              // a different calendar date. `k` IS the clinical day, so
              // it stays the source of truth for the banner.
              const dayLabel = dayMatch
                ? `Day ${dayMatch.n} — ${dayHeading(dayMatch.date)}`
                : dayHeading(k);

              // ── Day banner ──
              const banner = (
                <div key={`day-banner-${k}`} style={{
                  marginTop: 12,
                  marginBottom: 6,
                  padding: "4px 10px",
                  background: "#eef2ff",
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
                  {notes.map((n, idx) => (
                    // R7gd — replace the prose summary with the EXACT same
                    // structured per-type card that renders in the
                    // individual note print path. Death MCCD, ICU bundle
                    // table, WHO Safety Checklist, Procedure metadata,
                    // Vitals/IV/Pain/Wound/Braden/MEWS — every card shape
                    // the user sees on the doctor- or nurse-notes page now
                    // appears inline in the Complete File too. Wrapped in
                    // EmbeddedNoteCard (top of file) so JWT-gated /uploads
                    // signatures inline to data: URLs before injection.
                    <EmbeddedNoteCard key={`day-${k}-n-${idx}`} note={n} />
                  ))}
                </div>
              ) : null;

              // ── Treatment Chart sub-section ──
              // Each doctor order raised that day is printed WITH the nursing
              // administration actions recorded against it (given / missed /
              // held, dose given, route, by-whom, five-rights) — so an order
              // and the nursing response to it read together, not as two
              // disconnected lists. (order.admin ← DoctorOrder.administrationRecord)
              // ── Treatment Chart sub-section ──
              // A real drug-chart / MAR for the day: any orders WRITTEN that
              // day as a compact list, then one row per medicine with THAT
              // day's doses inline — scheduled slot → given time · by whom ·
              // on-time/late. A TDS drug is a single row with three dose lines
              // (the row grows with the number of doses). "medsByDay" buckets
              // every order's administrationRecord by scheduled day + drug.
              const dayMeds = medsByDay.get(k);
              const _thin = { fontWeight: 700, fontSize: 9, color: COL.muted, textTransform: "uppercase", letterSpacing: 0.3, margin: "5px 0 2px" };
              const ordersBlock = (orders.length > 0 || (dayMeds && dayMeds.size > 0)) ? (
                <div key={`day-orders-${k}`} style={{ marginBottom: 6 }}>
                  <Para style={{ fontWeight: 700, fontSize: 9.5, color: COL.muted, textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 2px" }}>
                    Treatment Chart
                  </Para>

                  {/* Orders written this day (compact — one line each) */}
                  {orders.length > 0 ? (
                    <>
                      <Para style={_thin}>Orders raised</Para>
                      <MiniTable
                        headers={["Time", "Type", "Order detail", "Priority", "Status", "Ordered by"]}
                        rows={orders.map((o) => [
                          fmtTimeOnly(o.orderedAt || o.createdAt),
                          o.orderType || "—",
                          orderDetailLine(o),
                          (o.priority && !/^(routine|normal)$/i.test(o.priority))
                            ? <span style={{ color: "#b91c1c", fontWeight: 700 }}>{o.priority}</span> : "—",
                          o.status || "—",
                          displayActor(o.orderedBy),
                        ])}
                        widths={["9%", "13%", "42%", "11%", "11%", "14%"]}
                      />
                    </>
                  ) : null}

                  {/* Medication administration — one row per drug, this day's doses */}
                  {dayMeds && dayMeds.size > 0 ? (
                    <>
                      <Para style={_thin}>Medication administration — who · when · on-time</Para>
                      <MiniTable
                        headers={["Medication", "Route · Freq", "Doses this day — scheduled → given · by · timing"]}
                        rows={[...dayMeds.values()].map(({ o, doses }) => [
                          <span><strong>{o.displayName || o.orderType || "—"}</strong>{o.dose ? ` ${o.dose}` : ""}</span>,
                          [o.route, o.frequency].filter(Boolean).join(" · ") || "—",
                          <div>
                            {doses.map((a, ai) => {
                              const t = _doseTiming(a);
                              const given = /given/i.test(a.status || "");
                              return (
                                <div key={ai} style={{ marginBottom: ai < doses.length - 1 ? 3 : 0, lineHeight: 1.35 }}>
                                  <strong>{a.schedTime || "—"}</strong>{" → "}
                                  {given ? (
                                    <>given{a.givenAt ? ` ${fmtTimeOnly(a.givenAt)}` : ""}{a.doseGiven ? ` (${a.doseGiven})` : ""} by {displayActor(a.givenBy, "—")}
                                      {t ? <span style={{ color: t.color, fontWeight: 700 }}>{` · ${t.label}`}</span> : null}
                                      {a.fiveRights ? <span style={{ color: "#15803d" }}> · ✓5R</span> : null}</>
                                  ) : (
                                    <span style={{ color: "#b91c1c", fontWeight: 700 }}>{a.status || "not given"}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>,
                        ])}
                        widths={["26%", "16%", "58%"]}
                      />
                    </>
                  ) : null}
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

              /* R7gt — Additional per-day streams folded into the journey
                 so the day-by-day flow really is everything-on-that-day.
                 Each sub-section appears only when there's at least one
                 row for the day. Tiny sub-header style mirrors the
                 existing "Clinical Notes / Orders Raised / MAR / Shift
                 Handovers" labels so the visual hierarchy stays flat. */
              const subHeadStyle = { fontWeight: 700, fontSize: 9.5, color: COL.muted, textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 2px" };

              const vitals  = (vitalsByDay.get(k)   || []).slice().sort((a,b) =>
                new Date(a.at || a.recordedAt || a.createdAt || 0) - new Date(b.at || b.recordedAt || b.createdAt || 0));
              const ios     = (ioByDay.get(k)       || []).slice().sort((a,b) =>
                new Date(a.at || a.recordedAt || a.createdAt || 0) - new Date(b.at || b.recordedAt || b.createdAt || 0));
              const invs    = (invsByDay.get(k)     || []).slice().sort((a,b) =>
                new Date(a.reportedAt || a.orderedAt || a.createdAt || 0) - new Date(b.reportedAt || b.orderedAt || b.createdAt || 0));
              const bloods  = (bloodByDay.get(k)    || []).slice().sort((a,b) =>
                new Date(a.startedAt || a.createdAt || 0) - new Date(b.startedAt || b.createdAt || 0));
              const cplans  = (carePlanByDay.get(k) || []);
              const nasses  = (nurAssByDay.get(k)   || []);
              const csents  = (consentByDay.get(k)  || []);
              const icus    = (icuByDay.get(k)      || []);
              const xfers   = (xferByDay.get(k)     || []);
              const mlcs    = (mlcByDay.get(k)      || []);

              const vitalsBlock = vitals.length > 0 ? (
                <div key={`day-vit-${k}`} style={{ marginBottom: 6 }}>
                  <Para style={subHeadStyle}>Vital Signs — Hourly Chart</Para>
                  <MiniTable
                    // R7hu — one day's hourly readings together; GCS added, and
                    // empty cells stay blank (never a "—" placeholder). MiniTable
                    // auto-drops any column that is empty for every row.
                    headers={["Time", "BP", "Pulse", "Temp", "SpO₂", "RR", "GCS", "By"]}
                    rows={vitals.map((v) => [
                      fmtTimeOnly(v.at || v.recordedAt || v.createdAt),
                      v.bp || v.bloodPressure || "",
                      v.pulse != null ? String(v.pulse) : "",
                      v.temp != null ? String(v.temp) : "",
                      v.spo2 != null ? String(v.spo2) : "",
                      v.rr   != null ? String(v.rr)   : "",
                      (v.gcs != null && v.gcs !== "") ? String(v.gcs) : "",
                      displayActor(v.recordedBy || v.by) || "",
                    ])}
                    widths={["11%", "15%", "10%", "10%", "11%", "9%", "9%", "25%"]}
                  />
                </div>
              ) : null;

              const ioBlock = ios.length > 0 ? (
                <div key={`day-io-${k}`} style={{ marginBottom: 6 }}>
                  <Para style={subHeadStyle}>Intake / Output</Para>
                  <MiniTable
                    headers={["Time", "Type", "Route / Source", "Amount", "By"]}
                    rows={ios.map((r) => [
                      fmtTimeOnly(r.at || r.recordedAt || r.createdAt),
                      r.type || (r.intakeMl != null ? "Intake" : r.outputMl != null ? "Output" : "—"),
                      r.route || r.source || r.fluidType || "—",
                      r.amount != null ? `${r.amount} ml`
                        : r.intakeMl != null ? `${r.intakeMl} ml`
                        : r.outputMl != null ? `${r.outputMl} ml` : "—",
                      displayActor(r.recordedBy || r.by) || "—",
                    ])}
                    widths={["12%", "14%", "26%", "18%", "30%"]}
                  />
                </div>
              ) : null;

              const invsBlock = invs.length > 0 ? (
                <div key={`day-inv-${k}`} style={{ marginBottom: 6 }}>
                  <Para style={subHeadStyle}>Investigations</Para>
                  <MiniTable
                    headers={["Time", "Test", "Result", "Status"]}
                    rows={invs.map((i) => [
                      fmtTimeOnly(i.reportedAt || i.orderedAt || i.createdAt),
                      i.name || i.testName || "—",
                      i.result || i.value || "—",
                      i.status || "—",
                    ])}
                    widths={["12%", "34%", "38%", "16%"]}
                  />
                </div>
              ) : null;

              const bloodBlock = bloods.length > 0 ? (
                <div key={`day-blood-${k}`} style={{ marginBottom: 6 }}>
                  <Para style={subHeadStyle}>Blood Transfusion</Para>
                  <MiniTable
                    headers={["Time", "Component", "Unit", "Group", "Reactions", "By"]}
                    rows={bloods.map((b) => [
                      fmtTimeOnly(b.at || b.startedAt || b.createdAt),
                      b.component || b.product || "—",
                      b.bagNumber || b.unitNumber || b.unit || "—",
                      b.bloodGroup || "—",
                      b.reaction === true ? (b.reactionType || "Yes") : (b.reactions || b.adverseReaction || "—"),
                      displayActor(b.transfusedBy || b.transfusedByName || b.administeredBy) || "—",
                    ])}
                    widths={["12%", "20%", "14%", "10%", "20%", "24%"]}
                  />
                </div>
              ) : null;

              const cplanBlock = cplans.length > 0 ? (
                <div key={`day-cp-${k}`} style={{ marginBottom: 6 }}>
                  <Para style={subHeadStyle}>Nursing Care Plan</Para>
                  {cplans.map((p, i) => {
                    const problem = p.diagnosis || p.problem;
                    const goal    = p.goals || p.goal;
                    return (
                      <Para key={i} style={{ fontSize: 11, margin: "2px 0" }}>
                        {problem ? <strong>{problem}</strong> : null}
                        {goal ? <> · Goal: {goal}</> : null}
                        {p.interventions ? <> · Intv: {p.interventions}</> : null}
                        {p.evaluation ? <> · Eval: {p.evaluation}</> : null}
                      </Para>
                    );
                  })}
                </div>
              ) : null;

              const nassBlock = nasses.length > 0 ? (
                <div key={`day-nass-${k}`} style={{ marginBottom: 6 }}>
                  <Para style={subHeadStyle}>Nursing Reassessment</Para>
                  {nasses.map((a, i) => {
                    const summary = a.content || a.summary;
                    return (
                      <Para key={i} style={{ fontSize: 11, margin: "2px 0" }}>
                        {a.type ? <strong>{a.type}</strong> : null}
                        {a.score != null ? <> · Score: {a.score}</> : null}
                        {summary ? <> · {summary}</> : null}
                      </Para>
                    );
                  })}
                </div>
              ) : null;

              const csentBlock = csents.length > 0 ? (
                <div key={`day-csent-${k}`} style={{ marginBottom: 6 }}>
                  <Para style={subHeadStyle}>Consent Signed</Para>
                  <MiniTable
                    headers={["Time", "Type", "Signed by", "Witness"]}
                    rows={csents.map((c) => [
                      fmtTimeOnly(c.signedAt || c.createdAt),
                      c.consentType || c.type || "—",
                      c.signedByName || c.consentingParty?.name || "—",
                      c.witnessName || "—",
                    ])}
                    widths={["12%", "32%", "30%", "26%"]}
                  />
                </div>
              ) : null;

              const icuBlock = icus.length > 0 ? (
                <div key={`day-icu-${k}`} style={{ marginBottom: 6 }}>
                  <Para style={subHeadStyle}>ICU Care Bundles (HIC.5)</Para>
                  {icus.map((b, i) => {
                    // Per-bundle compliance summary built from canonical
                    // per-key %s (vap/cauti/clabsi/dvt/sepsis/sup). Fall
                    // back to legacy bundleType label when no breakdown.
                    const parts = [
                      b.vapPct    != null ? `VAP ${b.vapPct}%`       : null,
                      b.cautiPct  != null ? `CAUTI ${b.cautiPct}%`   : null,
                      b.clabsiPct != null ? `CLABSI ${b.clabsiPct}%` : null,
                      b.dvtPct    != null ? `DVT ${b.dvtPct}%`       : null,
                      b.sepsisPct != null ? `Sepsis ${b.sepsisPct}%` : null,
                      b.supPct    != null ? `SUP ${b.supPct}%`       : null,
                    ].filter(Boolean);
                    const label = parts.length > 0 ? parts.join(" · ") : (b.bundleType || "Bundle");
                    const score = b.overallPct ?? b.bundleScore ?? "—";
                    return (
                      <Para key={i} style={{ fontSize: 11, margin: "2px 0" }}>
                        {label} · Score {score === "—" ? "—" : `${score}%`}
                      </Para>
                    );
                  })}
                </div>
              ) : null;

              const xferBlock = xfers.length > 0 ? (
                <div key={`day-xfer-${k}`} style={{ marginBottom: 6 }}>
                  <Para style={subHeadStyle}>Bed Transfer</Para>
                  {xfers.map((t, i) => (
                    <Para key={i} style={{ fontSize: 11, margin: "2px 0" }}>
                      {fmtTimeOnly(t.transferredAt || t.at || t.createdAt)} · {t.fromBed || "—"} → {t.toBed || "—"}
                      {t.reason ? <> · {t.reason}</> : null}
                    </Para>
                  ))}
                </div>
              ) : null;

              const mlcBlock = mlcs.length > 0 ? (
                <div key={`day-mlc-${k}`} style={{ marginBottom: 6 }}>
                  <Para style={{ ...subHeadStyle, color: "#dc2626" }}>Medico-Legal Case Entry</Para>
                  {mlcs.map((m, i) => {
                    const type    = m.type || m.natureOfCase || m.allegedType;
                    const brief   = m.brief || m.summary;
                    const io      = m.io || m.investigatingOfficer;
                    const station = m.station || m.policeStation;
                    return (
                      <Para key={i} style={{ fontSize: 11, margin: "2px 0" }}>
                        <strong>{m.mlcNumber || "MLC"}</strong> · {type || "—"}
                        {brief ? <> · {brief}</> : null}
                        {io ? <> · IO: {io}</> : null}
                        {station ? <> · PS: {station}</> : null}
                        {m.fir ? <> · FIR: {m.fir}</> : null}
                      </Para>
                    );
                  })}
                </div>
              ) : null;

              return (
                <React.Fragment key={`day-${k}`}>
                  {banner}
                  {notesBlock}
                  {vitalsBlock}
                  {ioBlock}
                  {invsBlock}
                  {ordersBlock}
                  {marBlock}
                  {bloodBlock}
                  {csentBlock}
                  {icuBlock}
                  {nassBlock}
                  {cplanBlock}
                  {xferBlock}
                  {handoverBlock}
                  {mlcBlock}
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
          R7gt — Suppressed; vital signs now render inline per-day in
          the Day-wise Clinical Journey. The flat tail-section is kept
          as dead JSX in case a future change reinstates a longitudinal
          trend view (e.g. for graphical export).
          ════════════════════════════════════════════════════════════ */}
      {/* R7hr — Vital Signs Trend re-enabled. The section was gated behind
          `{false && …}` because the VitalSheet GRID shape never mapped to flat
          trend rows; normalizeData now expands the grid (per time-slot points)
          so this renders the full observation chart. */}
      {(f.vitalsTrend || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH COP.3">Vital Signs Trend</SectionHeader>
          <MiniTable
            headers={["Date / Time", "BP", "Pulse", "Temp", "SpO₂", "RR", "GCS", "Recorded by"]}
            // R7gc — user requirement: NO vitals truncation. Print every reading.
            rows={(f.vitalsTrend || []).map((v) => [
              fmtDateTime(v.at),
              v.bp || "—",
              v.pulse || "—",
              v.temp || "—",
              v.spo2 || "—",
              v.rr || "—",
              v.gcs || "—",
              displayActor(v.recordedBy),
            ])}
            widths={["18%", "12%", "9%", "10%", "9%", "9%", "8%", "25%"]}
          />
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          7. INTAKE / OUTPUT SHEET                          [NABH COP.3]
          R7gt — Suppressed; I/O totals now render per day inline.
          ════════════════════════════════════════════════════════════ */}
      {false && (f.intakeOutput || []).length > 0 ? (() => {
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
          R7hr — DEVICES HISTORY                        [NABH HIC.5]
          Lifecycle of every indwelling device (IV cannula, urinary
          catheter, central line, ET tube …) in placement order:
          placed → site changes → removed. Mirrors the on-page
          devices strip; dwell time is the infection-control signal.
          ════════════════════════════════════════════════════════════ */}
      {Array.isArray(file.devices) && file.devices.length > 0 ? (
        <>
          <SectionHeader nabh="NABH HIC.5">Devices History</SectionHeader>
          <MiniTable
            headers={["Device", "Site", "Placed", "By", "Changes", "Removed", "Status"]}
            widths={["18%", "13%", "15%", "13%", "16%", "15%", "10%"]}
            rows={file.devices.map((d) => [
              [d.deviceType, d.deviceName].filter(Boolean).join(" · "),
              d.site,
              d.placedAt ? fmtDateTime(d.placedAt) : "",
              displayActor(d.placedBy),
              (d.changes || []).length
                ? (d.changes || []).map((c) =>
                    [c.at ? fmtDate(c.at) : "", c.reason || c.site].filter(Boolean).join(" — ")
                  ).join("; ")
                : "",
              d.removedAt ? `${fmtDateTime(d.removedAt)}${d.removedBy ? ` (${displayActor(d.removedBy)})` : ""}` : "",
              d.status || (d.removedAt ? "Removed" : "Active"),
            ])}
          />
        </>
      ) : null}

      {/* ════════════════════════════════════════════════════════════
          9. INVESTIGATIONS & REPORTS               [NABH AAC.7 / AAC.8]
          ════════════════════════════════════════════════════════════ */}
      {(invs.length > 0 || (f.labReports || []).length > 0
        || (f.labTrends || []).some((t) => (t.tests || []).some((x) => (x.readings || []).length))) ? (
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

          {/* R7hr(DOCS-FULL) — NABL results tables (labTrends were never
              printed before) + full diagnostic reports when the raw docs rode
              the receipt; one-line digest kept for legacy payloads. */}
          {(f.labTrends || []).some((t) => (t.tests || []).some((x) => (x.readings || []).length)) ? (
            <>
              <SubHeader>Laboratory Results (NABL format)</SubHeader>
              <FullLabTrends file={f} />
            </>
          ) : null}
          {(f.labReports || []).length > 0 ? (
            (f.labReports || []).some((r) => r.full) ? (
              <>
                <SubHeader>Lab & Imaging Reports</SubHeader>
                <FullDiagnosticReports file={f} />
              </>
            ) : (
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
            )
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
      {/* R7gt — Suppressed; care plans render per-day inline. */}
      {false && (f.nursingCarePlans || []).length > 0 ? (
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
      {/* R7gt — Suppressed; nursing reassessments render per-day inline. */}
      {false && (f.nursingAssessments || []).length > 0 ? (
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
      {/* R7gt — Suppressed; blood transfusions render per-day inline. */}
      {false && (f.bloodTransfusion || []).length > 0 ? (
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
      {/* R7gt — Suppressed; MLC entries render per-day inline. */}
      {false && (f.mlc || []).length > 0 ? (
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
      {/* R7hs — Bed Transfers print as their own complete log: every transfer
          (including any pre-admission / ER move that the day-wise journey drops
          because it predates the admission anchor), with from → to, reason,
          status and who handed over. A same-day transfer also surfaces briefly
          inline in the day-wise journey for context. */}
      {(f.bedTransfers || []).length > 0 ? (
        <>
          <SectionHeader nabh="NABH COP.6">Bed Transfers</SectionHeader>
          <MiniTable
            headers={["Date / Time", "From", "To", "Reason", "Status", "By"]}
            rows={f.bedTransfers.map((t) => [
              fmtDateTime(t.at),
              t.fromBed || "—",
              t.toBed || "—",
              t.reason || "—",
              t.status || "—",
              displayActor(t.by),
            ])}
            widths={["15%", "17%", "17%", "26%", "12%", "12%"]}
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

          <Para>
            {fullName} was <strong>discharged</strong>
            {f.admission?.dischargeDate ? <> on <strong>{fmtDate(f.admission.dischargeDate, true)}</strong></> : null}
            {f.discharge?.condition ? <> in <strong>{f.discharge.condition.toLowerCase()}</strong> condition</> : null}.
            {dxFinal ? <> Final diagnosis: <strong>{dxFinal}</strong>{f.admission?.icd10 ? <> (ICD-10 {f.admission.icd10})</> : null}.</> : null}
          </Para>

          {/* R7hr(DOCS-FULL, owner 2026-07-12) — when the raw DischargeSummary
              doc rode the receipt, print the FULL standalone-level summary via
              the shared section; legacy payloads keep the old digest below. */}
          {f.discharge?.full ? <FullDischargeSection file={f} /> : (
          <>
          {f.discharge?.summary ? (
            <Para>{cleanSentence(f.discharge.summary)}</Para>
          ) : null}

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
          </>
          )}

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

      {/* R7hr — extended clinical + administrative records and the patient's
          NABH safety registers render HERE (after the clinical narrative,
          before the financial summary) so Billing closes the record. */}
      <CoverageRecords file={f} />
      <ComplianceRegisters registers={f.complianceRegisters} />

      {/* ════════════════════════════════════════════════════════════
          18. BILLING SUMMARY                                     [—]
          ════════════════════════════════════════════════════════════ */}
      {bills.length > 0 ? (() => {
        let totBilled = 0, totPaid = 0, totBal = 0;
        const rows = bills.map((b) => {
          const tot  = Number(b.amount ?? b.total ?? b.grandTotal) || 0;
          const paid = Number(b.paid  ?? b.amountPaid)             || 0;
          const bal  = Number(b.balance ?? (tot - paid))           || 0;
          totBilled += tot; totPaid += paid; totBal += bal;
          const billNo = b.billNumber || b.billNo || b.invoiceNo || b.number || "—";
          const date   = b.at || b.date || b.createdAt;
          const type   = b.category || b.type || b.billType || "—";
          return [
            billNo,
            date ? fmtDate(date) : "—",
            type,
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

      {/* ════════════════════════════════════════════════════════════
          R7hr — RECORD AUTHENTICATION / ATTESTATION (medico-legal).
          Closes the file with the treating consultant + Medical Records
          sign-off and a computer-generated-record disclaimer.
          ════════════════════════════════════════════════════════════ */}
      <div style={{ marginTop: 14, borderTop: `2px solid ${COL.head}`, paddingTop: 10, pageBreakInside: "avoid" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 28, flexWrap: "wrap" }}>
          {[
            { name: f.admission?.consultant || f.signatures?.consultant || "Treating Consultant", role: "Treating Consultant — Signature & Date" },
            { name: "Medical Records Officer", role: "Certified true copy — Signature & Date" },
          ].map((s, i) => (
            <div key={i} style={{ flex: 1, minWidth: 210 }}>
              <div style={{ height: 30 }} />
              <div style={{ borderTop: "1px solid #64748b", paddingTop: 3 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: COL.body }}>{s.name}</div>
                <div style={{ fontSize: 9, color: COL.muted }}>{s.role}</div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 8.5, color: COL.muted, margin: "12px 0 0", lineHeight: 1.5 }}>
          Computer-generated Complete Patient File for <strong>{fullName}</strong> (UHID {f.meta?.uhid || f.patient?.uhid || "—"}{f.meta?.ipdNo ? ` · ${f.meta.ipdNo}` : ""}),
          compiled from the hospital medical record on {fmtDateTime(f.meta?.printedAt) || fmtDateTime(new Date())}. This document reproduces the patient's
          clinical record for the admission and is valid without a physical signature when digitally issued. Each page bears the patient identifier;
          report any discrepancy to the Medical Records Department. — NABH IMS.1 / MCI 1.4.
        </p>
      </div>

      {/* R7hr — per-page running footer: patient identity repeats on every
          printed page (medico-legal). Hidden on screen; fixed in print. */}
      <div className="pf-running-footer" aria-hidden="true">
        {fullName} · UHID {f.meta?.uhid || f.patient?.uhid || "—"}{f.meta?.ipdNo ? ` · ${f.meta.ipdNo}` : ""} · Complete Patient File · Confidential
      </div>
    </PrintShell>
  );
};

export default NarrativeTheme;
