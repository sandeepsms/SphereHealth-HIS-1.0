// R7ft Theme 1 — Narrative Letter
//
// "Apollo / Fortis discharge-summary letter" style: pure prose
// paragraphs, sections (Brief · HOPI · Past History · Examination ·
// Investigations · Course in hospital · Procedures · Discharge meds ·
// Advice · Follow-up), serif-tinged section headers, justified body.
// Reads like a letter from the consultant to the referring physician.
//
// Target page count: 5–6 for a 4-day Demo-Patient-like admission
// (replaces the pre-R7ft 18-page chip-soup printout). Premium-brand
// vibe; best for family-doctor handover.
//
// Implementation notes:
//   • Switched to the new PrintShell at @/templates/PrintShell so we
//     inherit the Sir-Ganga-Ram-style triple-zone header, 2-col
//     patient strip, signature zone, banners and footer for free.
//   • Body is plain prose; no chips, no key-value rows, no labelled
//     vitals boxes. The patient-strip up top already shows IDs.
//   • Discharge medications stay as a tight 3-col table — doctors
//     photocopy this for the chemist; prose doesn't work for dosing.
//   • Allergy alert is a red-bordered callout (visual prominence is
//     a NABH requirement, not aesthetic).
//   • Empty sections silently skipped — no "—" placeholders.

import React from "react";
import PrintShell from "@/templates/PrintShell";
import { fmtDate, pronoun } from "./normalizeData";

/* ── small text helpers (component-local) ─────────────────────────
   Prose joiners that swallow empties so we never emit dangling
   commas / orphan "and"s when a field is missing.                  */
const cleanSentence = (s) => {
  if (!s) return "";
  let out = String(s).replace(/\s+/g, " ").trim();
  if (!out) return "";
  if (!/[.!?]$/.test(out)) out += ".";
  return out[0].toUpperCase() + out.slice(1);
};

const joinClauses = (...parts) => parts.filter(Boolean).join(" ");

const oxford = (arr) => {
  const a = arr.filter(Boolean).map((x) => String(x).trim());
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

/* Group lab results into "abnormal first" vs "normal" buckets using
   light heuristics. A result is flagged abnormal when its text
   contains the words hypo-/hyper-, "elevated", "low", "high",
   "deficiency", "positive", "growth", or numeric arrows. Anything
   else falls through to the normal bucket. Doctors reading the
   letter then see the actionable line up front instead of scanning
   a 20-row table.                                                  */
const ABNORMAL_RX = /(hypo|hyper|deficien|elev(?:ated)?|low\b|high\b|↑|↓|positive|growth|raised|reduced|deranged|mild|moderate|severe)/i;
const NEGATIVE_RX = /(no growth|no\b.*pathogen|negative|nil|wnl|within normal|normal)/i;

const isResultAbnormal = (resultText) => {
  if (!resultText) return false;
  if (NEGATIVE_RX.test(resultText) && !ABNORMAL_RX.test(resultText)) return false;
  return ABNORMAL_RX.test(resultText);
};

/* ── vitals → one sentence ──────────────────────────────────────── */
const vitalsSentence = (v = {}) => {
  if (!v || Object.keys(v).length === 0) return "";
  const bits = [];
  if (v.bp) bits.push(`BP ${v.bp}`);
  if (v.pulse) bits.push(`pulse ${v.pulse}/min`);
  if (v.temp) bits.push(`temperature ${v.temp}°F`);
  if (v.spo2) bits.push(`SpO₂ ${v.spo2}%`);
  if (v.rr) bits.push(`respiratory rate ${v.rr}/min`);
  if (!bits.length) return "";
  return `Vitals on admission were ${oxford(bits)}.`;
};

/* ── allergy alert text ────────────────────────────────────────── */
const allergyLine = (a) => {
  if (!a) return "";
  if (typeof a === "string") return a;
  const agent = a.allergen || a.agent || a.name || "";
  const reaction = a.reaction || a.severity || "";
  return reaction ? `${agent} (${reaction})` : agent;
};

/* ── day-of-admission helper for course narrative ─────────────── */
const dayLabel = (eventDate, admissionDate) => {
  if (!eventDate || !admissionDate) return "";
  const ms = new Date(eventDate).getTime() - new Date(admissionDate).getTime();
  if (!Number.isFinite(ms)) return "";
  const day = Math.max(1, Math.floor(ms / 86_400_000) + 1);
  return `Day ${day}`;
};

/* ── narrative sections ───────────────────────────────────────── */
const SectionHeader = ({ children, nabh }) => (
  <div
    style={{
      fontFamily: "'DM Sans', Georgia, serif",
      fontWeight: 700,
      fontSize: 12,
      letterSpacing: "0.6px",
      textTransform: "uppercase",
      color: "#0f172a",
      borderBottom: "1px solid #0f172a",
      paddingBottom: 3,
      marginTop: 14,
      marginBottom: 8,
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 8,
    }}
  >
    <span>{children}</span>
    {nabh ? (
      <span
        style={{
          fontSize: 9,
          fontWeight: 500,
          letterSpacing: "0.4px",
          color: "#94a3b8",
        }}
      >
        {nabh}
      </span>
    ) : null}
  </div>
);

const Para = ({ children, style }) => (
  <p
    style={{
      fontSize: 11,
      lineHeight: 1.45,
      color: "#1f2937",
      textAlign: "justify",
      margin: "0 0 6px 0",
      ...(style || {}),
    }}
  >
    {children}
  </p>
);

/* ── small format helpers used by the new "comprehensive" sections ── */
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
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch { return ""; }
};

/* group an array of objects with `at` (Date) by day → Map<dayKey, items[]> */
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

/* tiny consistent table-style for new comprehensive sections */
const cellTh = {
  borderBottom: "1px solid #cbd5e1",
  textAlign: "left",
  padding: "3px 5px",
  fontSize: 9.5,
  fontWeight: 700,
  color: "#0f172a",
  background: "#f1f5f9",
};
const cellTd = {
  borderBottom: "1px solid #e2e8f0",
  padding: "3px 5px",
  fontSize: 9.5,
  color: "#1f2937",
  verticalAlign: "top",
};

const MiniTable = ({ headers, rows, widths }) => (
  <table
    className="pr-table"
    style={{
      width: "100%",
      borderCollapse: "collapse",
      marginBottom: 8,
      fontSize: 9.5,
      pageBreakInside: "auto",
    }}
  >
    <thead>
      <tr>
        {headers.map((h, i) => (
          <th key={`th-${i}`} style={{ ...cellTh, width: widths?.[i] || "auto" }}>{h}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((cells, ri) => (
        <tr key={`tr-${ri}`} className="bill-line-row">
          {cells.map((c, ci) => (
            <td key={`td-${ri}-${ci}`} style={cellTd}>{c == null || c === "" ? "—" : c}</td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

/* ROS summary line — single paragraph "CVS: ..., RS: ..." */
const rosSummary = (ros) => {
  if (!ros || typeof ros !== "object") return "";
  const order = [
    ["cvs", "CVS"], ["rs", "RS"], ["git", "GIT"], ["gut", "GUT"],
    ["cns", "CNS"], ["msk", "MSK"], ["skin", "Skin"], ["heent", "HEENT"],
    ["endo", "Endocrine"], ["psych", "Psych"],
  ];
  const bits = order
    .map(([k, label]) => (ros[k] ? `${label}: ${String(ros[k]).trim()}` : ""))
    .filter(Boolean);
  return bits.join(", ");
};

/* Barthel ADL render — rows + total */
const barthelRows = (adl) => {
  if (!adl || typeof adl !== "object") return [];
  const items = [
    ["feeding",  "Feeding"],
    ["bathing",  "Bathing"],
    ["grooming", "Grooming"],
    ["dressing", "Dressing"],
    ["bowels",   "Bowels"],
    ["bladder",  "Bladder"],
    ["toilet",   "Toilet use"],
    ["transfer", "Transfer"],
    ["mobility", "Mobility"],
    ["stairs",   "Stairs"],
  ];
  return items.map(([k, l]) => [l, adl[k] != null ? String(adl[k]) : "—"]);
};

/* ============================================================ */
const NarrativeTheme = ({ settings = {}, file, events = [] }) => {
  const f  = file  || {};
  const pn = pronoun(f.patient?.gender);
  const subj  = pn.subj;            // "He" / "She" / "The patient"
  const subjL = subj.toLowerCase(); // "he" / "she" / "the patient"
  const pos   = pn.pos;             // "his" / "her" / "their"
  const obj   = pn.obj;             // "him" / "her" / "them"

  /* ── patient strip (handled by PrintShell) ─────────────────── */
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
    { label: "Admitted",    value: fmtDate(f.admission?.date, true) },
    { label: "Discharged",  value: fmtDate(f.admission?.dischargeDate, true) },
    { label: "Length of Stay", value: f.admission?.totalDays != null ? `${f.admission.totalDays} day(s)` : "—" },
    { label: "Consultant",  value: f.admission?.consultant || "—" },
    { label: "Bed / Ward",  value: [f.admission?.bed, f.admission?.ward].filter(Boolean).join(" · ") || "—" },
    { label: "Department",  value: f.admission?.department || "—" },
  ];

  /* ── signatures (PrintShell renders this) ──────────────────── */
  const signatures = {
    type: "single",
    centre: {
      name: f.signatures?.consultant || f.admission?.consultant || "",
      role: "Consultant in charge",
      reg: f.ia?.doctor?.signedByReg || "",
    },
  };

  /* ── derived content ──────────────────────────────────────── */
  const fullName = fullNameWithHonorific(f.patient?.fullName, f.patient?.gender);
  const ageGender = ageGenderPhrase(f.patient?.age, f.patient?.gender);

  /* 1. Brief */
  const briefBits = [
    `${fullName}, a ${ageGender},`,
    `was admitted on ${fmtDate(f.admission?.date)}`,
    f.admission?.consultant ? `under the care of ${f.admission.consultant}` : "",
    f.history?.chief
      ? `with chief complaints of ${String(f.history.chief).replace(/\s+/g, " ").trim().replace(/\.$/, "")}.`
      : f.admission?.reasonForAdmission
        ? `with ${String(f.admission.reasonForAdmission).replace(/\s+/g, " ").trim().replace(/\.$/, "")}.`
        : ".",
  ];
  const briefSentence = joinClauses(...briefBits);

  const provisional = f.admission?.provisionalDiagnosis;
  const working     = f.admission?.workingDiagnosis;
  const final       = f.admission?.finalDiagnosis;
  const diagBits = [];
  if (provisional) diagBits.push(`Provisional diagnosis at admission was ${provisional.replace(/\.$/, "")}`);
  if (working && working !== provisional) diagBits.push(`working diagnosis ${working.replace(/\.$/, "")}`);
  if (final && final !== working) diagBits.push(`final diagnosis at discharge ${final.replace(/\.$/, "")}`);
  const diagSentence = diagBits.length ? cleanSentence(diagBits.join("; ")) : "";

  const stayLen = f.admission?.totalDays;
  const stayBits = [];
  if (stayLen) stayBits.push(`The total length of stay was ${stayLen} day(s)`);
  if (f.discharge?.condition) stayBits.push(`${subj} was discharged in ${f.discharge.condition.toLowerCase()} condition`);
  const staySentence = stayBits.length ? cleanSentence(stayBits.join(" and ")) : "";

  /* 2. HOPI */
  const hopiParas = [];
  if (f.history?.chief) {
    hopiParas.push(
      cleanSentence(
        `${subj} presented with ${String(f.history.chief).replace(/\s+/g, " ").trim().replace(/\.$/, "")}`,
      ),
    );
  }
  if (f.history?.hopi) {
    String(f.history.hopi).split(/\n+/).forEach((line) => {
      const t = line.trim();
      if (t) hopiParas.push(cleanSentence(t));
    });
  }

  /* 3. Past, family, social */
  const pfsBits = [];
  if (f.history?.medical)  pfsBits.push(`Past medical history is significant for ${String(f.history.medical).replace(/\.$/, "")}`);
  if (f.history?.surgical) pfsBits.push(`past surgical history includes ${String(f.history.surgical).replace(/\.$/, "")}`);
  if (f.history?.homeMeds && f.history.homeMeds.length) {
    const meds = f.history.homeMeds
      .map((m) => (typeof m === "string" ? m : [m.drug || m.name, m.dose, m.frequency].filter(Boolean).join(" ")))
      .filter(Boolean);
    if (meds.length) pfsBits.push(`${subjL} is currently on ${oxford(meds)}`);
  }
  const pfsSentence = pfsBits.length ? cleanSentence(pfsBits.join("; ")) : "";

  const famSocBits = [];
  if (f.history?.family) famSocBits.push(`Family history: ${String(f.history.family).replace(/\.$/, "")}`);
  if (f.history?.social) famSocBits.push(`social history: ${String(f.history.social).replace(/\.$/, "")}`);
  const famSocSentence = famSocBits.length ? cleanSentence(famSocBits.join(". ")) : "";

  /* 4. Allergies */
  const allergies = (f.alerts?.allergies || []).map(allergyLine).filter(Boolean);

  /* 5. Examination + vitals */
  const examParas = [];
  if (f.exam?.generalExam) {
    examParas.push(cleanSentence(`On general examination ${String(f.exam.generalExam).replace(/\.$/, "")}`));
  }
  if (f.exam?.systemicExam) {
    examParas.push(cleanSentence(`On systemic examination ${String(f.exam.systemicExam).replace(/\.$/, "")}`));
  }
  const vSent = vitalsSentence(f.vitals?.onAdmission);
  if (vSent) examParas.push(vSent);

  /* 6. Investigations */
  const invs = (f.investigations || []).filter((i) => i.name);
  const abnormalInvs = invs.filter((i) => isResultAbnormal(i.result));
  const normalInvs   = invs.filter((i) => !isResultAbnormal(i.result));

  /* 7. Course in hospital — chronological by clinical-event filter */
  const CLINICAL_KINDS = new Set([
    "admission", "doctor-note", "procedure", "med-start", "discharge",
  ]);
  const courseEvents = (events || []).filter((e) => CLINICAL_KINDS.has(e.kind));

  /* Build prose: one mini-paragraph per Day-N bucket. */
  const courseByDay = new Map();
  courseEvents.forEach((e) => {
    const d = dayLabel(e.at, f.admission?.date) || "Course";
    if (!courseByDay.has(d)) courseByDay.set(d, []);
    courseByDay.get(d).push(e);
  });

  /* Compose a single sentence per day. */
  const courseParas = [];
  Array.from(courseByDay.entries()).forEach(([day, evs]) => {
    const summaries = evs
      .map((e) => {
        if (e.kind === "doctor-note" && e.detail) return e.detail;
        return e.summary || "";
      })
      .map((s) => String(s).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (!summaries.length) return;
    const combined = summaries.join(". ");
    courseParas.push(`${day}: ${cleanSentence(combined)}`);
  });

  /* 8. Procedures */
  const procs = f.procedures || [];

  /* 9. Discharge meds — prefer the canonical f.discharge.medications
        (R7ft-FIX2: pulled from DischargeSummary's dischargeMeds), fall
        back to the legacy f.medications timeline if missing. */
  const dischargeMeds = (f.discharge?.medications?.length ? f.discharge.medications : f.medications) || [];

  /* 10. Advice → split a single discharge.advice blob into lines */
  const adviceLines = (() => {
    const a = f.discharge?.advice;
    if (!a) return [];
    return String(a)
      .split(/\n+|(?:^|\s)\d+[\.)]\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  })();

  /* ============================================================ */
  return (
    <PrintShell
      hospital={settings}
      docTitle="Patient Case Summary"
      docSubtitle="Confidential clinical record — for the referring physician"
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
      {/* Opening salutation — keeps the "letter" cadence. */}
      <p
        style={{
          fontSize: 11,
          fontStyle: "italic",
          color: "#475569",
          marginTop: 4,
          marginBottom: 10,
        }}
      >
        {f.admission?.referringDoctor
          ? `Dear ${f.admission.referringDoctor},`
          : "Dear Colleague,"}
      </p>

      {/* 1. BRIEF */}
      <SectionHeader>Brief</SectionHeader>
      <Para>{briefSentence}</Para>
      {diagSentence ? <Para>{diagSentence}</Para> : null}
      {staySentence ? <Para>{staySentence}</Para> : null}

      {/* 2. HISTORY OF PRESENTING ILLNESS */}
      {hopiParas.length > 0 && (
        <>
          <SectionHeader>History of Presenting Illness</SectionHeader>
          {hopiParas.map((t, i) => <Para key={`hopi-${i}`}>{t}</Para>)}
        </>
      )}

      {/* 3. PAST · FAMILY · SOCIAL */}
      {(pfsSentence || famSocSentence) && (
        <>
          <SectionHeader>Past, Family & Social History</SectionHeader>
          {pfsSentence    ? <Para>{pfsSentence}</Para>    : null}
          {famSocSentence ? <Para>{famSocSentence}</Para> : null}
        </>
      )}

      {/* 4. ALLERGIES & ALERTS — red callout box (inspector-friendly) */}
      {allergies.length > 0 && (
        <div
          style={{
            border: "1.5px solid #b91c1c",
            background: "#fef2f2",
            padding: "8px 12px",
            borderRadius: 4,
            margin: "14px 0 8px",
            color: "#7f1d1d",
            fontSize: 11,
            lineHeight: 1.4,
            pageBreakInside: "avoid",
          }}
        >
          <div
            style={{
              fontWeight: 800,
              letterSpacing: "0.8px",
              textTransform: "uppercase",
              fontSize: 11,
              marginBottom: 2,
            }}
          >
            Allergy Alert
          </div>
          <div>
            {oxford(allergies)}. Please avoid the noted agents and verify any
            prescribed substitutes against this list.
          </div>
        </div>
      )}

      {/* Isolation flags piggy-back on the same alert pattern. */}
      {f.alerts?.isolationFlags?.length > 0 && (
        <div
          style={{
            border: "1.5px solid #ca8a04",
            background: "#fef9c3",
            padding: "6px 12px",
            borderRadius: 4,
            margin: "0 0 8px",
            color: "#713f12",
            fontSize: 11,
            lineHeight: 1.4,
            pageBreakInside: "avoid",
          }}
        >
          <strong style={{ letterSpacing: "0.4px" }}>Isolation precautions:</strong>{" "}
          {oxford(f.alerts.isolationFlags)}.
        </div>
      )}

      {/* 5. EXAMINATION & VITALS */}
      {examParas.length > 0 && (
        <>
          <SectionHeader>Examination & Vitals on Admission</SectionHeader>
          {examParas.map((t, i) => <Para key={`ex-${i}`}>{t}</Para>)}
        </>
      )}

      {/* ──────────────────────────────────────────────────────────────
          R7ft-FIX2 — Comprehensive clinical record sections (8 → 25).
          Each one is silently skipped when its data bucket is empty.
          ────────────────────────────────────────────────────────────── */}

      {/* 8. DOCTOR INITIAL ASSESSMENT */}
      {(() => {
        const d = f.ia?.doctor || {};
        const hasAny = Object.keys(d).length > 0;
        if (!hasAny) return null;
        const ros = rosSummary(d.reviewOfSystems || d.ros);
        const diagBlock = [
          d.provisionalDiagnosis || f.admission?.provisionalDiagnosis,
          d.workingDiagnosis     || f.admission?.workingDiagnosis,
          d.finalDiagnosis       || f.admission?.finalDiagnosis,
        ];
        const signedBy = d.signedByName || d.signedBy || f.signatures?.consultant;
        const signedReg = d.signedByReg || d.mciRegNo;
        const signedAt = d.signedAt || d.assessmentDate;
        return (
          <>
            <SectionHeader nabh="NABH AAC.4">Doctor Initial Assessment</SectionHeader>
            {d.chiefComplaints || d.cc ? (
              <Para><strong>Chief complaints:</strong> {String(d.chiefComplaints || d.cc).trim()}</Para>
            ) : null}
            {d.hopi || d.historyOfPresentingIllness ? (
              <Para><strong>HOPI:</strong> {String(d.hopi || d.historyOfPresentingIllness).trim()}</Para>
            ) : null}
            {d.pmh || d.briefPmh ? (
              <Para><strong>Past medical history:</strong> {String(d.pmh || d.briefPmh).trim()}</Para>
            ) : null}
            {d.psh || d.surgicalHistory ? (
              <Para><strong>Past surgical history:</strong> {String(d.psh || d.surgicalHistory).trim()}</Para>
            ) : null}
            {d.famHx || d.familyHistory ? (
              <Para><strong>Family history:</strong> {String(d.famHx || d.familyHistory).trim()}</Para>
            ) : null}
            {d.socHx || d.socialHistory || d.personalHistory ? (
              <Para><strong>Social / personal history:</strong> {String(d.socHx || d.socialHistory || d.personalHistory).trim()}</Para>
            ) : null}
            {d.allergies ? (
              <Para><strong>Allergies:</strong> {typeof d.allergies === "string" ? d.allergies
                : Array.isArray(d.allergies?.list) ? d.allergies.list.map(allergyLine).filter(Boolean).join(", ")
                : "Nil known"}</Para>
            ) : null}
            {ros ? <Para><strong>Review of systems:</strong> {ros}</Para> : null}
            {d.genExam || d.generalExamination || d.examination ? (
              <Para><strong>General examination:</strong> {String(d.genExam || d.generalExamination || d.examination).trim()}</Para>
            ) : null}
            {d.systemic || d.systemicExamination ? (
              <Para><strong>Systemic examination:</strong> {String(d.systemic || d.systemicExamination).trim()}</Para>
            ) : null}
            {diagBlock.filter(Boolean).length > 0 && (
              <Para>
                {diagBlock[0] ? <span><strong>Provisional diagnosis:</strong> {diagBlock[0]}<br/></span> : null}
                {diagBlock[1] && diagBlock[1] !== diagBlock[0] ? <span><strong>Working diagnosis:</strong> {diagBlock[1]}<br/></span> : null}
                {diagBlock[2] && diagBlock[2] !== diagBlock[1] ? <span><strong>Final diagnosis:</strong> {diagBlock[2]}</span> : null}
              </Para>
            )}
            <Para style={{ color: "#475569" }}>
              <em>Signed by: {signedBy || "—"}{signedReg ? ` (Reg: ${signedReg})` : ""}{signedAt ? ` · ${fmtDateTime(signedAt)}` : ""}</em>
            </Para>
          </>
        );
      })()}

      {/* 9. NURSING INITIAL ASSESSMENT */}
      {(() => {
        const n = f.ia?.nursing || {};
        if (!Object.keys(n).length) return null;
        const id = n.identification || {};
        const anth = n.anthropometry || {};
        const adl = n.adl || n.barthel || {};
        const allergyList = Array.isArray(n.allergies?.list) ? n.allergies.list
                          : Array.isArray(n.allergies)      ? n.allergies : [];
        const homeMeds = Array.isArray(n.medicationReconciliation) ? n.medicationReconciliation
                       : Array.isArray(n.homeMedications) ? n.homeMedications : [];
        const cross = Array.isArray(n.crossCheckAlerts) ? n.crossCheckAlerts : [];
        const dp = n.dischargePlanning || {};
        const signedBy = n.nurseName || n.signedByName || n.signedBy;
        const signedAt = n.signedAt || n.submittedAt;
        return (
          <>
            <SectionHeader nabh="NABH AAC.5 / COP.2">Nursing Initial Assessment</SectionHeader>
            {(n.modeOfAdmission || n.consciousness || n.mobility) && (
              <Para>
                {n.modeOfAdmission ? <><strong>Mode of admission:</strong> {n.modeOfAdmission}. </> : null}
                {n.consciousness ? <><strong>Consciousness:</strong> {n.consciousness}. </> : null}
                {n.mobility ? <><strong>Mobility:</strong> {n.mobility}.</> : null}
              </Para>
            )}
            {n.chiefComplaint && <Para><strong>Chief complaint:</strong> {n.chiefComplaint}</Para>}
            {Object.keys(id).length > 0 && (
              <Para>
                <strong>Identification:</strong>{" "}
                {[
                  id.bandAttached ? `Band attached: ${id.bandAttached}` : "",
                  id.nameVerified ? `Name verified: ${id.nameVerified}` : "",
                  id.uhidVerified ? `UHID verified: ${id.uhidVerified}` : "",
                  id.dobVerified  ? `DOB verified: ${id.dobVerified}`   : "",
                  id.verifiedBy   ? `Verified by: ${id.verifiedBy}`      : "",
                ].filter(Boolean).join(" · ")}
              </Para>
            )}
            {(anth.heightCm || anth.weightKg || anth.bmi) && (
              <Para>
                <strong>Anthropometry:</strong>{" "}
                {[
                  anth.heightCm ? `Height ${anth.heightCm} cm` : "",
                  anth.weightKg ? `Weight ${anth.weightKg} kg` : "",
                  anth.bmi      ? `BMI ${anth.bmi}`            : "",
                ].filter(Boolean).join(" · ")}
              </Para>
            )}
            {allergyList.length > 0 && (
              <Para>
                <strong>Allergies:</strong>{" "}
                {allergyList.map((a, i) => {
                  const txt = typeof a === "string" ? a
                    : [a.agent || a.allergen, a.reaction, a.severity].filter(Boolean).join(" — ");
                  return <span key={`alg-${i}`}>{i > 0 ? "; " : ""}{txt}</span>;
                })}
              </Para>
            )}
            {(n.languagePreferred || n.psychosocial || n.familySupport) && (
              <Para>
                {n.languagePreferred ? <><strong>Preferred language:</strong> {n.languagePreferred}. </> : null}
                {n.psychosocial ? <><strong>Psychosocial:</strong> {n.psychosocial}. </> : null}
                {n.familySupport ? <><strong>Family support:</strong> {n.familySupport}.</> : null}
              </Para>
            )}
            {Object.keys(adl).length > 0 && (() => {
              const rows = barthelRows(adl);
              if (!rows.length) return null;
              const total = adl.total != null ? adl.total
                : rows.reduce((sum, [, v]) => {
                    const n = Number(v); return Number.isFinite(n) ? sum + n : sum;
                  }, 0);
              return (
                <>
                  <Para style={{ marginBottom: 2 }}><strong>ADL (Barthel Index):</strong></Para>
                  <MiniTable
                    headers={["Item", "Score"]}
                    rows={[...rows, ["Total", String(total)]]}
                    widths={["60%", "40%"]}
                  />
                </>
              );
            })()}
            {(n.painScore || n.fallRisk || n.pressureUlcer || n.nutritionScore || n.dvtRisk || n.vteRisk) && (
              <Para>
                <strong>Risk screening:</strong>{" "}
                {[
                  n.painScore ? `Pain ${n.painScore}/10` : "",
                  n.fallRisk  ? `Fall (Morse) ${n.fallRisk}` : "",
                  n.pressureUlcer ? `Pressure ulcer (Braden) ${n.pressureUlcer}` : "",
                  n.nutritionScore ? `Nutrition (MUST) ${n.nutritionScore}` : "",
                  n.dvtRisk ? `DVT ${n.dvtRisk}` : "",
                  n.vteRisk ? `VTE ${n.vteRisk}` : "",
                ].filter(Boolean).join(" · ")}
              </Para>
            )}
            {homeMeds.length > 0 && (
              <>
                <Para style={{ marginBottom: 2 }}><strong>Home medications:</strong></Para>
                <MiniTable
                  headers={["Drug", "Dose", "Frequency", "Last taken"]}
                  rows={homeMeds.map((m) => [
                    m.drug || m.name || "—",
                    m.dose || "—",
                    m.frequency || m.freq || "—",
                    m.lastTaken || m.lastDose || "—",
                  ])}
                  widths={["35%", "20%", "25%", "20%"]}
                />
              </>
            )}
            {cross.length > 0 && (
              <>
                <Para style={{ marginBottom: 2 }}><strong>Cross-check alerts:</strong></Para>
                <MiniTable
                  headers={["Severity", "Category", "Message"]}
                  rows={cross.map((c) => [
                    <span style={{ color: String(c.severity).toLowerCase() === "high" ? "#b91c1c" : "#1f2937", fontWeight: String(c.severity).toLowerCase() === "high" ? 700 : 400 }}>
                      {c.severity || "—"}
                    </span>,
                    c.category || c.type || "—",
                    c.message || c.text || "—",
                  ])}
                  widths={["15%", "25%", "60%"]}
                />
              </>
            )}
            {(n.educationNeeds || n.cognitiveCommunication || n.bowelBladder || n.sleepPattern || n.familyCaregiver) && (
              <Para>
                {n.educationNeeds ? <><strong>Education needs:</strong> {n.educationNeeds}. </> : null}
                {n.cognitiveCommunication ? <><strong>Cognitive / communication:</strong> {n.cognitiveCommunication}. </> : null}
                {n.bowelBladder ? <><strong>Bowel/bladder:</strong> {n.bowelBladder}. </> : null}
                {n.sleepPattern ? <><strong>Sleep:</strong> {n.sleepPattern}. </> : null}
                {n.familyCaregiver ? <><strong>Family caregiver:</strong> {n.familyCaregiver}.</> : null}
              </Para>
            )}
            {Object.keys(dp).length > 0 && (
              <Para>
                <strong>Discharge planning:</strong>{" "}
                {[
                  dp.homeSupport ? `Home support: ${dp.homeSupport}` : "",
                  dp.primaryCaregiver ? `Primary caregiver: ${dp.primaryCaregiver}` : "",
                  dp.transportNeed ? `Transport: ${dp.transportNeed}` : "",
                  dp.anticipatedBarriers ? `Anticipated barriers: ${dp.anticipatedBarriers}` : "",
                ].filter(Boolean).join(" · ")}
              </Para>
            )}
            <Para style={{ color: "#475569" }}>
              <em>Signed by: {signedBy || "—"}{signedAt ? ` · ${fmtDateTime(signedAt)}` : ""}</em>
            </Para>
          </>
        );
      })()}

      {/* 10. DOCTOR ORDERS / TREATMENT ORDERS */}
      {(f.doctorOrders || []).length > 0 && (
        <>
          <SectionHeader nabh="NABH MOM.2">Doctor Orders / Treatment Orders</SectionHeader>
          <MiniTable
            headers={["Date", "Type", "Order Details", "Status", "Ordered By"]}
            rows={f.doctorOrders.map((o) => {
              const det = [o.displayName, o.dose, o.route, o.frequency].filter(Boolean).join(" · ");
              return [
                fmtDateTime(o.orderedAt),
                o.orderType || "—",
                det || "—",
                o.status || "—",
                o.orderedBy || "—",
              ];
            })}
            widths={["16%", "14%", "44%", "12%", "14%"]}
          />
        </>
      )}

      {/* 11. MEDICATION ADMINISTRATION RECORD (MAR) — last 3 days */}
      {(f.mar || []).length > 0 && (() => {
        const byDay = groupByDay(f.mar, (m) => m.givenAt || m.createdAt);
        const days = Array.from(byDay.keys()).slice(0, 3);
        if (!days.length) return null;
        return (
          <>
            <SectionHeader nabh="NABH MOM.4">Medication Administration Record</SectionHeader>
            {days.map((day) => {
              const items = byDay.get(day) || [];
              const drugMap = new Map();
              items.forEach((m) => {
                const key = `${m.drug}|${m.dose}|${m.route}|${m.frequency}`;
                if (!drugMap.has(key)) {
                  drugMap.set(key, {
                    drug: m.drug, dose: m.dose, route: m.route, frequency: m.frequency,
                    times: [], by: new Set(),
                  });
                }
                const entry = drugMap.get(key);
                if (m.givenAt) entry.times.push(fmtTimeOnly(m.givenAt));
                if (m.givenBy) entry.by.add(m.givenBy);
              });
              const rows = Array.from(drugMap.values()).map((e) => [
                e.drug || "—",
                e.dose || "—",
                e.route || "—",
                e.frequency || "—",
                e.times.join(", ") || "—",
                Array.from(e.by).join(", ") || "—",
              ]);
              return (
                <div key={`mar-${day}`} style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#475569", margin: "4px 0 2px" }}>{day}</div>
                  <MiniTable
                    headers={["Drug", "Dose", "Route", "Freq", "Given at", "By"]}
                    rows={rows}
                    widths={["26%", "10%", "10%", "14%", "26%", "14%"]}
                  />
                </div>
              );
            })}
          </>
        );
      })()}

      {/* 12. VITAL SIGNS TREND — last 12 readings */}
      {(f.vitalsTrend || []).length > 0 && (
        <>
          <SectionHeader nabh="NABH COP.3">Vital Signs Trend</SectionHeader>
          <MiniTable
            headers={["Time", "BP", "Pulse", "Temp", "SpO₂", "RR", "By"]}
            rows={(f.vitalsTrend || []).slice(0, 12).map((v) => [
              fmtDateTime(v.at),
              v.bp || "—",
              v.pulse || "—",
              v.temp || "—",
              v.spo2 || "—",
              v.rr || "—",
              v.recordedBy || "—",
            ])}
            widths={["22%", "12%", "10%", "10%", "10%", "10%", "26%"]}
          />
        </>
      )}

      {/* 13. INTAKE / OUTPUT — daily totals, last 5 days */}
      {(f.intakeOutput || []).length > 0 && (() => {
        const byDay = groupByDay(f.intakeOutput, (io) => io.at);
        const days = Array.from(byDay.entries()).slice(0, 5);
        if (!days.length) return null;
        const rows = days.map(([day, entries]) => {
          const inTotal  = entries.filter((e) => e.direction === "IN").reduce((s, e) => s + (Number(e.volumeML) || 0), 0);
          const outTotal = entries.filter((e) => e.direction === "OUT").reduce((s, e) => s + (Number(e.volumeML) || 0), 0);
          const net = inTotal - outTotal;
          const netStr = `${net > 0 ? "+" : ""}${net} mL`;
          return [day, `${inTotal} mL`, `${outTotal} mL`, netStr];
        });
        return (
          <>
            <SectionHeader nabh="NABH COP.3">Intake / Output Summary</SectionHeader>
            <MiniTable
              headers={["Date", "Total Intake", "Total Output", "Net Balance"]}
              rows={rows}
              widths={["25%", "25%", "25%", "25%"]}
            />
          </>
        );
      })()}

      {/* 14. INVESTIGATIONS — prose (existing) + details table (NEW) */}
      {invs.length > 0 && (
        <>
          <SectionHeader nabh="NABH AAC.7">Investigations</SectionHeader>
          {abnormalInvs.length > 0 && (
            <Para>
              Significant findings included{" "}
              {oxford(
                abnormalInvs.map((i) =>
                  i.result ? `${i.name} — ${String(i.result).replace(/\.$/, "")}` : i.name,
                ),
              )}
              .
            </Para>
          )}
          {normalInvs.length > 0 && (
            <Para>
              {abnormalInvs.length > 0 ? "Other investigations" : "Investigations performed"}{" "}
              including{" "}
              {oxford(normalInvs.map((i) => i.name))}{" "}
              were unremarkable or within normal limits.
            </Para>
          )}
          <MiniTable
            headers={["Test", "Ordered", "Reported", "Result"]}
            rows={invs.map((i) => [
              i.name || "—",
              i.orderedAt ? fmtDate(i.orderedAt) : "—",
              i.reportedAt ? fmtDate(i.reportedAt) : "—",
              i.result || "—",
            ])}
            widths={["28%", "18%", "18%", "36%"]}
          />
        </>
      )}

      {/* 15. LAB REPORTS */}
      {(f.labReports || []).length > 0 && (
        <>
          <SectionHeader nabh="NABH AAC.8">Lab Reports</SectionHeader>
          <MiniTable
            headers={["Report", "Type", "Date", "Key Findings"]}
            rows={f.labReports.map((r) => [
              r.name || "—",
              r.reportType || "—",
              fmtDate(r.date),
              (r.impression || "").slice(0, 80) + ((r.impression || "").length > 80 ? "…" : ""),
            ])}
            widths={["26%", "14%", "16%", "44%"]}
          />
        </>
      )}

      {/* 7. COURSE IN HOSPITAL */}
      {courseParas.length > 0 && (
        <>
          <SectionHeader>Course in Hospital</SectionHeader>
          {courseParas.map((t, i) => <Para key={`course-${i}`}>{t}</Para>)}
          {f.discharge?.summary ? (
            <Para>{cleanSentence(f.discharge.summary)}</Para>
          ) : null}
        </>
      )}

      {/* 16. PROCEDURES / OT NOTES */}
      {procs.length > 0 && (
        <>
          <SectionHeader nabh="NABH COP.13">Procedures / OT Notes</SectionHeader>
          {procs.map((p, i) => (
            <Para key={`proc-${i}`}>
              {p.name}
              {p.date ? ` was performed on ${fmtDate(p.date)}` : ""}
              {p.surgeon ? ` by ${p.surgeon}` : ""}
              {p.anaesthetist ? ` (anaesthetist: ${p.anaesthetist})` : ""}.{" "}
              {p.findings ? cleanSentence(`Operative findings: ${p.findings}`) : ""}{" "}
              {p.notes ? cleanSentence(p.notes) : ""}
            </Para>
          ))}
        </>
      )}

      {/* 17. BLOOD TRANSFUSION */}
      {(f.bloodTransfusion || []).length > 0 && (
        <>
          <SectionHeader nabh="NABH HIC.4 / MOM.4">Blood Transfusion Records</SectionHeader>
          <MiniTable
            headers={["Date", "Component", "Bag No", "Vol (mL)", "Pre BP/P", "Post BP/P", "Reaction", "By"]}
            rows={f.bloodTransfusion.map((b) => [
              fmtDateTime(b.at),
              b.component || "—",
              b.bagNumber || "—",
              b.volumeMl != null ? String(b.volumeMl) : "—",
              `${b.preVitals?.bp || "—"} / ${b.preVitals?.pulse || "—"}`,
              `${b.postVitals?.bp || "—"} / ${b.postVitals?.pulse || "—"}`,
              <span style={{ color: b.reaction ? "#b91c1c" : "#1f2937", fontWeight: b.reaction ? 700 : 400 }}>
                {b.reaction ? `Yes${b.reactionType ? ` — ${b.reactionType}` : ""}` : "No"}
              </span>,
              b.transfusedBy || "—",
            ])}
            widths={["14%", "11%", "10%", "8%", "12%", "12%", "16%", "17%"]}
          />
        </>
      )}

      {/* 18. CONSENT FORMS */}
      {(f.consents || []).length > 0 && (
        <>
          <SectionHeader nabh="NABH PRE.1">Consent Forms</SectionHeader>
          <MiniTable
            headers={["Form", "Signed", "Signed By", "Witness", "Date"]}
            rows={f.consents.map((c) => [
              c.name || "—",
              <span style={{ color: c.signed ? "#15803d" : "#b91c1c", fontWeight: 600 }}>
                {c.signed ? "Yes" : "Pending"}
              </span>,
              c.signedBy || "—",
              c.witness || "—",
              c.signedAt ? fmtDateTime(c.signedAt) : "—",
            ])}
            widths={["32%", "10%", "20%", "18%", "20%"]}
          />
        </>
      )}

      {/* 19. DIETICIAN / DIET PLANS */}
      {(f.dietPlans || []).length > 0 && (
        <>
          <SectionHeader nabh="NABH COP.4">Dietician / Diet Plans</SectionHeader>
          <MiniTable
            headers={["Date", "Diet Type", "Calories", "Restrictions", "Assigned By"]}
            rows={f.dietPlans.map((d) => [
              fmtDate(d.at),
              d.templateName || "—",
              d.targetCalories != null ? `${d.targetCalories} kcal` : "—",
              d.restrictions || "—",
              d.assignedBy || "—",
            ])}
            widths={["16%", "26%", "14%", "24%", "20%"]}
          />
          {f.dietPlans.filter((d) => d.notes).map((d, i) => (
            <Para key={`diet-note-${i}`} style={{ color: "#475569" }}>
              <em>{d.templateName || "Diet"} ({fmtDate(d.at)}): {d.notes}</em>
            </Para>
          ))}
        </>
      )}

      {/* 20. ICU CARE BUNDLES — last 5 shifts */}
      {(f.icuBundles || []).length > 0 && (
        <>
          <SectionHeader nabh="NABH HIC.6 / IPSG.6">ICU Care Bundles</SectionHeader>
          <MiniTable
            headers={["Date", "Shift", "VAP", "CAUTI", "CLABSI", "DVT", "Sepsis", "SUP", "Overall"]}
            rows={(f.icuBundles || []).slice(0, 5).map((b) => [
              b.date || "—",
              b.shift || "—",
              b.vapPct != null ? `${b.vapPct}%` : "—",
              b.cautiPct != null ? `${b.cautiPct}%` : "—",
              b.clabsiPct != null ? `${b.clabsiPct}%` : "—",
              b.dvtPct != null ? `${b.dvtPct}%` : "—",
              b.sepsisPct != null ? `${b.sepsisPct}%` : "—",
              b.supPct != null ? `${b.supPct}%` : "—",
              b.overallPct != null
                ? <span style={{ color: b.overallPct >= 80 ? "#15803d" : "#b91c1c", fontWeight: 600 }}>{b.overallPct}%</span>
                : "—",
            ])}
            widths={["12%", "10%", "10%", "10%", "10%", "10%", "10%", "10%", "18%"]}
          />
        </>
      )}

      {/* 21. NURSING NOTES & SHIFT HANDOVERS */}
      {((f.nursingNotes || []).length > 0 || (f.shiftHandovers || []).length > 0) && (
        <>
          <SectionHeader nabh="NABH COP.2">Nursing Notes & Shift Handovers</SectionHeader>
          {(f.nursingNotes || []).map((n, i) => (
            <Para key={`nn-${i}`}>
              <strong>{fmtDateTime(n.createdAt)}{n.shift ? ` — ${n.shift} shift` : ""} ({n.nurseName || "Nurse"}):</strong>{" "}
              {n.content}
            </Para>
          ))}
          {(f.shiftHandovers || []).length > 0 && (
            <>
              <Para style={{ marginBottom: 2, fontWeight: 600, color: "#475569" }}>Shift handovers:</Para>
              <MiniTable
                headers={["Date / Shift", "Handing nurse", "Receiving nurse", "Summary"]}
                rows={f.shiftHandovers.map((h) => [
                  `${fmtDate(h.at)}${h.shift ? " · " + h.shift : ""}`,
                  h.handingBy || "—",
                  h.receivingBy || "—",
                  h.summary || "—",
                ])}
                widths={["18%", "18%", "18%", "46%"]}
              />
            </>
          )}
        </>
      )}

      {/* 23. MLC / MEDICO-LEGAL */}
      {(f.mlc || []).length > 0 && (
        <>
          <SectionHeader nabh="NABH ROM.4">MLC / Medico-legal</SectionHeader>
          <MiniTable
            headers={["Date", "Type", "Brief", "IO / Station", "Signed by"]}
            rows={f.mlc.map((m) => [
              fmtDateTime(m.at),
              m.type || "—",
              m.brief || "—",
              [m.io, m.station].filter(Boolean).join(" · ") || "—",
              m.signedBy || "—",
            ])}
            widths={["16%", "12%", "36%", "22%", "14%"]}
          />
        </>
      )}

      {/* 24. BED TRANSFERS */}
      {(f.bedTransfers || []).length > 0 && (
        <>
          <SectionHeader nabh="NABH AAC.3">Bed Transfers</SectionHeader>
          <MiniTable
            headers={["Date", "From bed", "To bed", "Reason", "By"]}
            rows={f.bedTransfers.map((t) => [
              fmtDateTime(t.at),
              t.fromBed || "—",
              t.toBed || "—",
              t.reason || "—",
              t.by || "—",
            ])}
            widths={["18%", "16%", "16%", "32%", "18%"]}
          />
        </>
      )}

      {/* 25. DISCHARGE MEDICATIONS — tight table (chemist-photocopy use) */}
      {dischargeMeds.length > 0 && (
        <div className="pr-page-break-avoid" style={{ pageBreakInside: "avoid" }}>
          <SectionHeader nabh="NABH AAC.11">Medications on Discharge</SectionHeader>
          <table
            className="pr-table"
            style={{ width: "100%", marginTop: 4, fontSize: 11 }}
          >
            <thead>
              <tr>
                <th style={{ width: "32%" }}>Drug</th>
                <th style={{ width: "33%" }}>Dose · Route · Frequency</th>
                <th>Duration / Instructions</th>
              </tr>
            </thead>
            <tbody>
              {dischargeMeds.map((m, i) => {
                // R7ft-FIX2: support both legacy `m.drug` and the new
                // canonical `m.name` field that comes from DischargeSummary.
                const drugName = m.drug || m.name || "—";
                const doseLine = [m.dose, m.route, m.frequency].filter(Boolean).join(" · ");
                const duration = m.duration
                  ? m.duration
                  : m.endDate
                    ? `Until ${fmtDate(m.endDate)}`
                    : m.indication
                      ? m.indication
                      : "Continued";
                return (
                  <tr key={`med-${i}`} className="bill-line-row">
                    <td>
                      <div style={{ fontWeight: 600 }}>{drugName}</div>
                      {m.generic ? (
                        <div style={{ fontSize: 9.5, color: "#64748b" }}>{m.generic}</div>
                      ) : null}
                    </td>
                    <td>{doseLine || "—"}</td>
                    <td>
                      <div>{duration}</div>
                      {(m.instructions || m.indication) && duration !== (m.instructions || m.indication) ? (
                        <div style={{ fontSize: 9.5, color: "#64748b" }}>{m.instructions || m.indication}</div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 10. ADVICE ON DISCHARGE */}
      {adviceLines.length > 0 && (
        <>
          <SectionHeader>Advice on Discharge</SectionHeader>
          <Para>{subj} has been advised as follows:</Para>
          <ol
            style={{
              fontSize: 11,
              lineHeight: 1.45,
              color: "#1f2937",
              margin: "0 0 8px 22px",
              padding: 0,
            }}
          >
            {adviceLines.map((t, i) => (
              <li key={`adv-${i}`} style={{ marginBottom: 3 }}>{t}</li>
            ))}
          </ol>
        </>
      )}

      {/* 11. FOLLOW-UP */}
      {(f.discharge?.followUpDate || f.discharge?.condition) && (
        <>
          <SectionHeader>Follow-up</SectionHeader>
          <Para>
            {f.discharge?.followUpDate
              ? `Review in the out-patient department on ${fmtDate(f.discharge.followUpDate)}`
              : "Review in the out-patient department as advised"}
            {f.admission?.consultant ? ` with ${f.admission.consultant}` : ""}
            . {pos.charAt(0).toUpperCase() + pos.slice(1)} general practitioner
            may be contacted in the interim for any concerns; the hospital
            remains available round-the-clock for urgent issues.
          </Para>
        </>
      )}

      {/* Closing salutation — matches the opening "Dear …" so the
          letter form feels complete before PrintShell signs it. */}
      <p
        style={{
          fontSize: 11,
          fontStyle: "italic",
          color: "#475569",
          margin: "14px 0 4px",
        }}
      >
        Thank you for entrusting {obj || "the patient"} to our care.
      </p>
    </PrintShell>
  );
};

export default NarrativeTheme;
