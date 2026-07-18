// R7ft Theme 3 — Executive Brief
//
// Max Healthcare / Tirath Ram premium 2-column dense layout.
// Side rail (~30% width) = quick-glance reference cards (allergy,
// vitals, sparkline, active meds, alerts, at-a-glance tiles).
// Main column (~70% width) = pure prose narrative (Brief, HOPI,
// Past Hx, Examination, Course in hospital, Investigations
// summary, Final diagnosis, Discharge advice + meds, Follow-up).
//
// Target page count: 4–5 A4 pages for a 4-day acute admission.
// Density and terse prose communicate "specialist-grade handover".
//
// Implementation notes:
//   • PrintShell at @/templates/PrintShell owns the triple-zone
//     header, patient strip, signature zone, banners and footer.
//   • Side-rail cards silently omit themselves when empty —
//     no "—" placeholders, no empty bordered boxes.
//   • Sparkline only renders when ≥2 trend points exist; the
//     demo (no `vitalsTrend`) gracefully falls back to 5 cards.
//   • Accent colour flows via CSS variable `--pr-accent-color`,
//     with a safe fallback. Hospital red (#dc2626) and amber
//     (#d97706) are kept hard-coded because they're semantic.
//   • No chips, no emojis, no Hindi — English clinical prose.

import React from "react";
import PrintShell from "@/templates/PrintShell";
import { fmtDate, fmtDayMonth, pronoun } from "./normalizeData";
// R7hr(THEME-REG): coverage records + NABH registers — previously Narrative-only.
import SharedRegisterSections from "./SharedRegisterSections";
// R7hr(DOCS-FULL-FU): six full formal documents appendix (order sheet, MAR,
// NABL labs, diagnostic reports, consents, diet, discharge).
import SharedFormalDocSections from "./SharedFormalDocSections";

/* ── prose helpers (component-local, mirrored from Narrative) ──── */
const cleanSentence = (s) => {
  if (!s) return "";
  let out = String(s).replace(/\s+/g, " ").trim();
  if (!out) return "";
  if (!/[.!?]$/.test(out)) out += ".";
  return out[0].toUpperCase() + out.slice(1);
};

const joinClauses = (...parts) => parts.filter(Boolean).join(" ");

const oxford = (arr) => {
  const a = (arr || []).filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
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

const stripTrailingDot = (s) => String(s || "").replace(/\s+/g, " ").trim().replace(/\.$/, "");

/* Lab abnormality detection — copied from Narrative so the
   "significant findings first" pattern stays identical across
   themes. Bumping the regex here would only drift Executive
   away from Narrative; keep them word-for-word the same.       */
const ABNORMAL_RX = /(hypo|hyper|deficien|elev(?:ated)?|low\b|high\b|↑|↓|positive|growth|raised|reduced|deranged|mild|moderate|severe)/i;
const NEGATIVE_RX = /(no growth|no\b.*pathogen|negative|nil|wnl|within normal|normal)/i;
const isResultAbnormal = (resultText) => {
  if (!resultText) return false;
  if (NEGATIVE_RX.test(resultText) && !ABNORMAL_RX.test(resultText)) return false;
  return ABNORMAL_RX.test(resultText);
};

/* ── allergy line: "Sulfa drugs (anaphylaxis)" ─────────────────── */
const allergyLine = (a) => {
  if (!a) return "";
  if (typeof a === "string") return a;
  const agent = a.allergen || a.agent || a.name || "";
  const reaction = a.reaction || a.severity || "";
  return reaction ? `${agent} (${reaction})` : agent;
};

/* ── day-of-admission bucketing for the day-wise course ────────── */
const dayNumber = (eventDate, admissionDate) => {
  if (!eventDate || !admissionDate) return null;
  const ms = new Date(eventDate).getTime() - new Date(admissionDate).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
};

/* Group a vitalsTrend array into two SVG polylines (BP-systolic
   and pulse). Width and height are passed as numbers; output is
   self-contained <svg/> JSX. Returns null when fewer than two
   plottable points exist.                                       */
const buildSparkline = (trend, width, height) => {
  if (!Array.isArray(trend) || trend.length < 2) return null;

  const sysVals = [];
  const pulseVals = [];
  trend.forEach((t) => {
    const bpStr = String(t.bp || t.bpSys || "");
    const sysMatch = bpStr.match(/(\d+)/);
    const sys = sysMatch ? Number(sysMatch[1]) : null;
    const pulse = t.pulse != null ? Number(t.pulse) : null;
    sysVals.push(Number.isFinite(sys) ? sys : null);
    pulseVals.push(Number.isFinite(pulse) ? pulse : null);
  });

  const finiteSys = sysVals.filter((n) => Number.isFinite(n));
  const finitePul = pulseVals.filter((n) => Number.isFinite(n));
  if (finiteSys.length < 2 && finitePul.length < 2) return null;

  // Shared Y-range across both series so curves stay legible.
  const all = [...finiteSys, ...finitePul];
  const minV = Math.min(...all);
  const maxV = Math.max(...all);
  const span = Math.max(1, maxV - minV);
  const pad = 4;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = innerW / Math.max(1, trend.length - 1);

  const toPoints = (vals) => vals
    .map((v, i) => Number.isFinite(v)
      ? `${(pad + i * stepX).toFixed(1)},${(pad + innerH - ((v - minV) / span) * innerH).toFixed(1)}`
      : null)
    .filter(Boolean)
    .join(" ");

  const sysPts = toPoints(sysVals);
  const pulsePts = toPoints(pulseVals);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
      aria-hidden="true"
    >
      <rect x="0" y="0" width={width} height={height} fill="#f8fafc" stroke="#e2e8f0" strokeWidth="0.5" />
      {sysPts ? (
        <polyline points={sysPts} fill="none" stroke="#dc2626" strokeWidth="1.2" />
      ) : null}
      {pulsePts ? (
        <polyline points={pulsePts} fill="none" stroke="#4f46e5" strokeWidth="1.2" />
      ) : null}
    </svg>
  );
};

/* ── styled atoms shared across side-rail and main column ────── */
const RailCard = ({ children, tone, style }) => {
  // tone: "default" | "danger" | "warning"
  const base = {
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    color: "#0f172a",
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
    fontSize: 10.5,
    lineHeight: 1.35,
    breakInside: "avoid",
    pageBreakInside: "avoid",
  };
  if (tone === "danger") {
    base.border = "1.5px solid #dc2626";
    base.background = "#fef2f2";
    base.color = "#991b1b";
  } else if (tone === "warning") {
    base.border = "1.5px solid #d97706";
    base.background = "#fffbeb";
    base.color = "#92400e";
  }
  return <div style={{ ...base, ...(style || {}) }}>{children}</div>;
};

const RailTitle = ({ children, color }) => (
  <div
    style={{
      fontSize: 9,
      letterSpacing: "0.6px",
      textTransform: "uppercase",
      color: color || "#64748b",
      fontWeight: 700,
      marginBottom: 4,
    }}
  >
    {children}
  </div>
);

const SectionHeader = ({ children }) => (
  <div
    style={{
      fontSize: 11,
      letterSpacing: "0.7px",
      textTransform: "uppercase",
      fontWeight: 700,
      color: "var(--pr-accent-color, #4f46e5)",
      borderBottom: "1.5px solid var(--pr-accent-color, #4f46e5)",
      paddingBottom: 2,
      margin: "12px 0 6px",
    }}
  >
    {children}
  </div>
);

const Para = ({ children, style }) => (
  <p
    style={{
      fontSize: 11,
      lineHeight: 1.35,
      color: "#1f2937",
      textAlign: "justify",
      margin: "0 0 5px 0",
      ...(style || {}),
    }}
  >
    {children}
  </p>
);

/* ============================================================ */
const ExecutiveTheme = ({ settings = {}, file, events = [] }) => {
  const f  = file || {};
  const pn = pronoun(f.patient?.gender);
  const subj  = pn.subj;            // "He" / "She" / "The patient"
  const subjL = subj.toLowerCase(); // "he" / "she" / "the patient"
  const pos   = pn.pos;             // "his" / "her" / "their"
  const obj   = pn.obj;             // "him" / "her" / "them"

  /* ── patient strip (left/right) ───────────────────────────── */
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

  /* ── signature zone ────────────────────────────────────────── */
  const signatures = {
    type: "single",
    centre: {
      name: f.signatures?.consultant || f.admission?.consultant || "",
      role: "Consultant in charge",
      reg: f.ia?.doctor?.signedByReg || "",
    },
  };

  /* ── side-rail prep ───────────────────────────────────────── */
  const allergies = (f.alerts?.allergies || []).filter(Boolean);
  const isolation = (f.alerts?.isolationFlags || []).filter(Boolean);
  const v = f.vitals?.onAdmission || {};
  const vitalRows = [
    { label: "BP",   value: v.bp ? `${v.bp} mmHg` : null },
    { label: "HR",   value: v.pulse != null ? `${v.pulse}/min` : null },
    { label: "Temp", value: v.temp != null ? `${v.temp} °F` : null },
    { label: "SpO₂", value: v.spo2 != null ? `${v.spo2} %` : null },
    { label: "RR",   value: v.rr != null ? `${v.rr}/min` : null },
    { label: "Wt",   value: v.weight != null ? `${v.weight} kg` : null },
    { label: "Ht",   value: v.height != null ? `${v.height} cm` : null },
    { label: "BMI",  value: v.bmi != null ? String(v.bmi) : null },
  ].filter((r) => r.value);

  const trend = Array.isArray(f.vitals?.trend) ? f.vitals.trend : [];
  const sparkline = buildSparkline(trend, 170, 38);

  const dischargeDate = f.admission?.dischargeDate
    ? new Date(f.admission.dischargeDate).getTime()
    : Date.now();
  const activeMeds = (f.medications || []).filter((m) => {
    if (!m.endDate) return true;
    return new Date(m.endDate).getTime() > dischargeDate;
  });
  // Demo data ends every med on discharge day so activeMeds may be
  // empty for AGE/short-stay cases. Fall back to the full med list
  // so the side rail still shows the day-of-discharge regimen and
  // the card never disappears for non-pathological reasons.
  const railMeds = activeMeds.length > 0 ? activeMeds : (f.medications || []);

  const crossAlerts = (f.alerts?.crossCheckAlerts || []).filter((a) => {
    const sev = String(a?.severity || a?.level || "").toLowerCase();
    if (!sev) return true; // un-graded alerts surface too
    return sev === "high" || sev === "critical" || sev === "severe";
  });

  // At-a-glance tiles
  const tiles = [
    { label: "LOS · days",       value: f.admission?.totalDays != null ? String(f.admission.totalDays) : "—" },
    { label: "Notes",            value: String((f.doctorNotes || []).length + (f.nursingNotes || []).length) },
    { label: "Investigations",   value: String((f.investigations || []).length) },
    { label: "Procedures",       value: String((f.procedures || []).length) },
  ];

  /* ── main column prose ────────────────────────────────────── */
  const fullName  = fullNameWithHonorific(f.patient?.fullName, f.patient?.gender);
  const ageGender = ageGenderPhrase(f.patient?.age, f.patient?.gender);

  // 1. Brief
  const briefSentence = joinClauses(
    `${fullName}, a ${ageGender},`,
    `was admitted on ${fmtDate(f.admission?.date)}`,
    f.admission?.consultant ? `under the care of ${f.admission.consultant}` : "",
    f.admission?.department ? `(${f.admission.department})` : "",
    f.history?.chief
      ? `with chief complaints of ${stripTrailingDot(f.history.chief)}.`
      : f.admission?.reasonForAdmission
        ? `with ${stripTrailingDot(f.admission.reasonForAdmission)}.`
        : ".",
  );

  // 2. HOPI — chief + hopi woven into 1-2 paragraphs
  const hopiParas = [];
  if (f.history?.chief) {
    hopiParas.push(
      cleanSentence(`${subj} presented with ${stripTrailingDot(f.history.chief)}`),
    );
  }
  if (f.history?.hopi) {
    String(f.history.hopi).split(/\n+/).forEach((line) => {
      const t = line.trim();
      if (t) hopiParas.push(cleanSentence(t));
    });
  }

  // 3. Past History — medical + surgical + family + social, one paragraph
  const pastBits = [];
  if (f.history?.medical)  pastBits.push(`Past medical history is significant for ${stripTrailingDot(f.history.medical)}`);
  if (f.history?.surgical) pastBits.push(`past surgical history of ${stripTrailingDot(f.history.surgical)}`);
  if (f.history?.family)   pastBits.push(`family history: ${stripTrailingDot(f.history.family)}`);
  if (f.history?.social)   pastBits.push(`social history: ${stripTrailingDot(f.history.social)}`);
  const pastSentence = pastBits.length ? cleanSentence(pastBits.join("; ")) : "";

  // 4. Examination
  const examBits = [];
  if (f.exam?.generalExam)  examBits.push(`On general examination ${stripTrailingDot(f.exam.generalExam)}`);
  if (f.exam?.systemicExam) examBits.push(`on systemic examination ${stripTrailingDot(f.exam.systemicExam)}`);
  const examSentence = examBits.length ? cleanSentence(examBits.join("; ")) : "";

  // 5. Course in hospital — day-wise narrative
  const CLINICAL_KINDS = new Set([
    "admission", "doctor-note", "procedure", "discharge",
  ]);
  const courseEvents = (events || []).filter((e) => CLINICAL_KINDS.has(e.kind));
  const courseByDay = new Map();
  courseEvents.forEach((e) => {
    const d = dayNumber(e.at, f.admission?.date);
    if (d == null) return;
    if (!courseByDay.has(d)) courseByDay.set(d, []);
    courseByDay.get(d).push(e);
  });
  const dayEntries = Array.from(courseByDay.entries()).sort((a, b) => a[0] - b[0]);

  // 6. Investigations summary
  const invs = (f.investigations || []).filter((i) => i.name);
  const abnormalInvs = invs.filter((i) => isResultAbnormal(i.result));
  const normalInvs   = invs.filter((i) => !isResultAbnormal(i.result));

  // 7. Final diagnosis
  const finalDx = f.admission?.finalDiagnosis || f.admission?.workingDiagnosis || f.admission?.provisionalDiagnosis || "";

  // 8. Discharge advice — split on newlines / "1." numbered prefixes
  const adviceLines = (() => {
    const a = f.discharge?.advice;
    if (!a) return [];
    return String(a)
      .split(/\n+|(?:^|\s)\d+[\.)]\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  })();

  // 9. Discharge meds — all (active filter doesn't apply to a
  // chemist-facing list — patient must continue what's listed).
  const dischargeMeds = f.medications || [];

  // 10. Follow-up sentence
  const followUpSentence = (() => {
    if (!f.discharge?.followUpDate && !f.discharge?.condition) return "";
    const fu = f.discharge?.followUpDate
      ? `${subj} is advised review in the out-patient department on ${fmtDate(f.discharge.followUpDate)}`
      : `${subj} is advised review in the out-patient department as scheduled`;
    const tail = f.admission?.consultant ? ` with ${f.admission.consultant}` : "";
    return cleanSentence(`${fu}${tail}; ${pos} family has been counselled on red-flag symptoms requiring return to hospital`);
  })();

  /* ============================================================ */
  return (
    <PrintShell
      hospital={settings}
      docTitle="Patient File · Executive Brief"
      docSubtitle="Specialist handover summary — confidential clinical record"
      patient={{ left: patientLeft, right: patientRight }}
      signatures={signatures}
      banners={{ emergency24x7: true }}
      meta={{
        docNumber: f.meta?.ipdNo || "",
        pageOf: "",
        printedAt: f.meta?.printedAt
          ? new Date(f.meta.printedAt).toISOString()
          : new Date().toISOString(),
        printCount: f.meta?.printCount || 0,
      }}
    >
      {/* Two-column grid — side rail (30%) + main prose (70%) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "30% 70%",
          gap: 12,
          alignItems: "start",
        }}
      >
        {/* ──────────────────── SIDE RAIL ──────────────────── */}
        <aside>
          {/* 1. ALLERGY ALERT — red */}
          {allergies.length > 0 && (
            <RailCard tone="danger">
              <RailTitle color="#991b1b">Allergy Alert</RailTitle>
              {allergies.map((a, i) => {
                const txt = allergyLine(a);
                const sev = (a && typeof a === "object")
                  ? (a.severity || a.reaction || "")
                  : "";
                return (
                  <div
                    key={`al-${i}`}
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 4,
                      marginBottom: 2,
                    }}
                  >
                    <span>{(typeof a === "object" ? (a.allergen || a.agent || a.name) : a) || txt}</span>
                    {sev ? <span style={{ fontWeight: 500, fontStyle: "italic" }}>{sev}</span> : null}
                  </div>
                );
              })}
            </RailCard>
          )}

          {/* 2. ISOLATION FLAGS — amber */}
          {isolation.length > 0 && (
            <RailCard tone="warning">
              <RailTitle color="#92400e">Isolation</RailTitle>
              {isolation.map((flag, i) => (
                <div key={`iso-${i}`} style={{ fontSize: 10.5, fontWeight: 600, marginBottom: 1 }}>
                  {flag}
                </div>
              ))}
            </RailCard>
          )}

          {/* 3. VITALS ON ADMISSION */}
          {vitalRows.length > 0 && (
            <RailCard>
              <RailTitle>Vitals on Admission</RailTitle>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {vitalRows.map((r, i) => (
                    <tr key={`vt-${i}`}>
                      <td
                        style={{
                          fontSize: 9,
                          color: "#64748b",
                          textTransform: "uppercase",
                          letterSpacing: "0.4px",
                          padding: "1px 0",
                          width: "38%",
                        }}
                      >
                        {r.label}
                      </td>
                      <td
                        style={{
                          fontFamily: "'JetBrains Mono', 'Menlo', monospace",
                          fontSize: 9.5,
                          color: "#0f172a",
                          padding: "1px 0",
                          textAlign: "right",
                        }}
                      >
                        {r.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </RailCard>
          )}

          {/* 4. VITALS TREND SPARKLINE */}
          {sparkline && (
            <RailCard>
              <RailTitle>Vitals Trend</RailTitle>
              {sparkline}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 6,
                  marginTop: 3,
                  fontSize: 8.5,
                  color: "#475569",
                }}
              >
                <span>
                  <span style={{ display: "inline-block", width: 8, height: 2, background: "#dc2626", verticalAlign: "middle", marginRight: 3 }} />
                  BP sys
                </span>
                <span>
                  <span style={{ display: "inline-block", width: 8, height: 2, background: "#4f46e5", verticalAlign: "middle", marginRight: 3 }} />
                  Pulse
                </span>
              </div>
            </RailCard>
          )}

          {/* 5. ACTIVE MEDICATIONS */}
          {railMeds.length > 0 && (
            <RailCard>
              <RailTitle>Active Medications</RailTitle>
              {railMeds.map((m, i) => {
                const dose = [m.dose, m.route].filter(Boolean).join(" ");
                return (
                  <div
                    key={`am-${i}`}
                    style={{
                      fontSize: 10,
                      lineHeight: 1.3,
                      paddingBottom: 3,
                      marginBottom: 3,
                      borderBottom: i < railMeds.length - 1 ? "1px dotted #e2e8f0" : "none",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "#0f172a" }}>{m.drug || "—"}</div>
                    <div style={{ color: "#475569", fontSize: 9.5 }}>
                      {[dose, m.frequency].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                );
              })}
            </RailCard>
          )}

          {/* 6. CROSS-CHECK ALERTS — high-severity only */}
          {crossAlerts.length > 0 && (
            <RailCard tone="danger">
              <RailTitle color="#991b1b">Cross-check Alerts</RailTitle>
              {crossAlerts.map((al, i) => {
                const txt = typeof al === "string"
                  ? al
                  : (al.message || al.note || al.description || al.title || "");
                if (!txt) return null;
                return (
                  <div key={`xc-${i}`} style={{ fontSize: 10, fontWeight: 500, marginBottom: 2 }}>
                    {txt}
                  </div>
                );
              })}
            </RailCard>
          )}

          {/* 7. AT-A-GLANCE TILES */}
          <RailCard>
            <RailTitle>At-a-glance</RailTitle>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 4,
              }}
            >
              {tiles.map((t, i) => (
                <div
                  key={`tl-${i}`}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 4,
                    padding: "4px 6px",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--pr-accent-color, #4f46e5)",
                      lineHeight: 1.1,
                    }}
                  >
                    {t.value}
                  </div>
                  <div
                    style={{
                      fontSize: 8,
                      letterSpacing: "0.4px",
                      textTransform: "uppercase",
                      color: "#64748b",
                      marginTop: 1,
                    }}
                  >
                    {t.label}
                  </div>
                </div>
              ))}
            </div>
          </RailCard>
        </aside>

        {/* ──────────────────── MAIN COLUMN ──────────────────── */}
        <main>
          {/* § BRIEF */}
          <SectionHeader>Brief</SectionHeader>
          <Para>{briefSentence}</Para>

          {/* § HISTORY OF PRESENTING ILLNESS */}
          {hopiParas.length > 0 && (
            <>
              <SectionHeader>History of Presenting Illness</SectionHeader>
              {hopiParas.map((t, i) => <Para key={`hopi-${i}`}>{t}</Para>)}
            </>
          )}

          {/* § PAST HISTORY */}
          {pastSentence && (
            <>
              <SectionHeader>Past History</SectionHeader>
              <Para>{pastSentence}</Para>
            </>
          )}

          {/* § EXAMINATION */}
          {examSentence && (
            <>
              <SectionHeader>Examination</SectionHeader>
              <Para>{examSentence}</Para>
            </>
          )}

          {/* § COURSE IN HOSPITAL — day-wise paragraphs */}
          {dayEntries.length > 0 && (
            <>
              <SectionHeader>Course in Hospital</SectionHeader>
              {dayEntries.map(([day, evs]) => {
                // Compose: take detail (richer) when available, else summary.
                // De-dupe identical strings so we don't echo "Admitted in
                // emergency" twice if both admission + IA events fire.
                const seen = new Set();
                const sentences = [];
                evs.forEach((e) => {
                  const raw = (e.kind === "doctor-note" && e.detail) ? e.detail : (e.summary || e.detail || "");
                  const t = String(raw).replace(/\s+/g, " ").trim();
                  if (!t) return;
                  const key = t.toLowerCase();
                  if (seen.has(key)) return;
                  seen.add(key);
                  sentences.push(t);
                });
                if (!sentences.length) return null;
                const dayDateRef = evs[0]?.at;
                const dateLabel = dayDateRef ? fmtDayMonth(dayDateRef) : "";
                return (
                  <Para key={`day-${day}`}>
                    <strong style={{ color: "var(--pr-accent-color, #4f46e5)" }}>
                      Day {day}{dateLabel ? ` (${dateLabel})` : ""}.
                    </strong>{" "}
                    {cleanSentence(sentences.join(". "))}
                  </Para>
                );
              })}
            </>
          )}

          {/* § INVESTIGATIONS SUMMARY */}
          {invs.length > 0 && (
            <>
              <SectionHeader>Investigations Summary</SectionHeader>
              {abnormalInvs.length > 0 && (
                <Para>
                  Significant findings included{" "}
                  {oxford(
                    abnormalInvs.map((i) =>
                      i.result ? `${i.name} — ${stripTrailingDot(i.result)}` : i.name,
                    ),
                  )}
                  .
                </Para>
              )}
              {normalInvs.length > 0 && (
                <Para>
                  {abnormalInvs.length > 0 ? "Other investigations including " : "Investigations performed including "}
                  {oxford(normalInvs.map((i) => i.name))} were within normal limits.
                </Para>
              )}
            </>
          )}

          {/* § FINAL DIAGNOSIS — bold prominent one-liner */}
          {finalDx && (
            <>
              <SectionHeader>Final Diagnosis</SectionHeader>
              <Para
                style={{
                  fontWeight: 700,
                  fontSize: 12,
                  color: "#0f172a",
                  margin: "0 0 6px 0",
                }}
              >
                {stripTrailingDot(finalDx)}
                {f.admission?.icd10 ? `  ·  ICD-10: ${f.admission.icd10}` : ""}
              </Para>
            </>
          )}

          {/* § PLAN / DISCHARGE ADVICE */}
          {adviceLines.length > 0 && (
            <>
              <SectionHeader>Plan / Discharge Advice</SectionHeader>
              <ol
                style={{
                  fontSize: 11,
                  lineHeight: 1.4,
                  color: "#1f2937",
                  margin: "0 0 6px 22px",
                  padding: 0,
                }}
              >
                {adviceLines.map((t, i) => (
                  <li key={`adv-${i}`} style={{ marginBottom: 2 }}>{t}</li>
                ))}
              </ol>
            </>
          )}

          {/* § DISCHARGE MEDICATIONS — tight 2-col mini-table in column */}
          {dischargeMeds.length > 0 && (
            <div style={{ pageBreakInside: "avoid", breakInside: "avoid" }}>
              <SectionHeader>Discharge Medications</SectionHeader>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 10,
                  lineHeight: 1.3,
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid #cbd5e1" }}>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "3px 4px",
                        fontSize: 9,
                        color: "#475569",
                        letterSpacing: "0.4px",
                        textTransform: "uppercase",
                        fontWeight: 600,
                        width: "50%",
                      }}
                    >
                      Drug · Dose · Frequency
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "3px 4px",
                        fontSize: 9,
                        color: "#475569",
                        letterSpacing: "0.4px",
                        textTransform: "uppercase",
                        fontWeight: 600,
                      }}
                    >
                      Duration / Instructions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dischargeMeds.map((m, i) => {
                    const drugLine = [m.dose, m.route, m.frequency].filter(Boolean).join(" · ");
                    const duration = m.endDate
                      ? `Until ${fmtDate(m.endDate)}`
                      : m.indication
                        ? "Continued"
                        : "Continued";
                    return (
                      <tr key={`dm-${i}`} style={{ borderBottom: "1px dotted #e2e8f0" }}>
                        <td style={{ padding: "2px 4px", verticalAlign: "top" }}>
                          <div style={{ fontWeight: 600 }}>{m.drug || "—"}</div>
                          {drugLine ? <div style={{ color: "#475569", fontSize: 9.5 }}>{drugLine}</div> : null}
                        </td>
                        <td style={{ padding: "2px 4px", verticalAlign: "top" }}>
                          <div>{duration}</div>
                          {m.indication ? <div style={{ color: "#475569", fontSize: 9.5 }}>{m.indication}</div> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* § FOLLOW-UP */}
          {followUpSentence && (
            <>
              <SectionHeader>Follow-up</SectionHeader>
              <Para>{followUpSentence}</Para>
            </>
          )}
        </main>
      </div>
      <SharedRegisterSections file={file} />
      <SharedFormalDocSections file={file} />
    </PrintShell>
  );
};

export default ExecutiveTheme;
