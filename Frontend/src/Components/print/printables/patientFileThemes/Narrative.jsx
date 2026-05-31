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
const SectionHeader = ({ children }) => (
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
    }}
  >
    {children}
  </div>
);

const Para = ({ children }) => (
  <p
    style={{
      fontSize: 11,
      lineHeight: 1.45,
      color: "#1f2937",
      textAlign: "justify",
      margin: "0 0 6px 0",
    }}
  >
    {children}
  </p>
);

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

  /* 9. Discharge meds */
  const dischargeMeds = f.medications || [];

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

      {/* 6. INVESTIGATIONS */}
      {invs.length > 0 && (
        <>
          <SectionHeader>Investigations</SectionHeader>
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

      {/* 8. PROCEDURES */}
      {procs.length > 0 && (
        <>
          <SectionHeader>Procedures</SectionHeader>
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

      {/* 9. DISCHARGE MEDICATIONS — tight table (chemist-photocopy use) */}
      {dischargeMeds.length > 0 && (
        <div className="pr-page-break-avoid" style={{ pageBreakInside: "avoid" }}>
          <SectionHeader>Medications on Discharge</SectionHeader>
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
                const doseLine = [m.dose, m.route, m.frequency].filter(Boolean).join(" · ");
                const duration = m.endDate
                  ? `Until ${fmtDate(m.endDate)}`
                  : m.indication
                    ? m.indication
                    : "Continued";
                return (
                  <tr key={`med-${i}`} className="bill-line-row">
                    <td>
                      <div style={{ fontWeight: 600 }}>{m.drug || "—"}</div>
                      {m.generic ? (
                        <div style={{ fontSize: 9.5, color: "#64748b" }}>{m.generic}</div>
                      ) : null}
                    </td>
                    <td>{doseLine || "—"}</td>
                    <td>
                      <div>{duration}</div>
                      {m.indication && duration !== m.indication ? (
                        <div style={{ fontSize: 9.5, color: "#64748b" }}>{m.indication}</div>
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
