// ReferralSummary — Condensed handover for a referring physician.
//
// Trigger: "Referral Summary" button on the Patient File page, next
// to "Print Complete File". The full chronological file is too long
// for a quick handover — the referring colleague wants the essentials
// in 2-4 A4 pages:
//
//   1.  Patient strip + condensed admission facts
//   2.  Allergy / isolation safety callouts
//   3.  First Doctor Note + Last Doctor Note            [NABH COP.7]
//   4.  First Nursing Note + Last Nursing Note          [NABH COP.2]
//   5.  Investigations + Lab Reports                    [NABH AAC.7 / 8]
//   6.  Latest MAR (last 48 h)                          [NABH MOM.4]
//   7.  Consents on file                                [NABH PRE.1]
//   8.  Blood Transfusion records                       [NABH HIC.4]
//   9.  Procedure records                               [NABH COP.13]
//   10. Current status / discharge brief
//   11. Suggested action items (optional)
//
// Visual identity inherits the Narrative letter (serif-tinged headers,
// justified prose, NABH chips). Helpers are cloned LOCALLY so the file
// is self-contained.
//
// Hard rules honoured:
//   * Empty sections collapse silently.
//   * ObjectId hashes → "signed digitally" via displayActor().
//   * English only, no emoji in the printable body.

import React from "react";
import PrintShell from "@/templates/PrintShell";
import { fmtDate } from "./normalizeData";

/* === Prose, date and ID helpers — cloned locally from Narrative === */

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
const stripDot = (s) => String(s || "").replace(/\.$/, "").trim();
const ageGenderPhrase = (age, gender) => {
  const g = String(gender || "").toLowerCase();
  const word = g.startsWith("f") ? "female" : g.startsWith("m") ? "male" : "patient";
  return (age && Number(age) > 0) ? `${age}-year-old ${word}` : word;
};
const honorific = (gender) => {
  const g = String(gender || "").toLowerCase();
  if (g.startsWith("f")) return "Ms.";
  if (g.startsWith("m")) return "Mr.";
  return "";
};
const fullNameWithHonorific = (name, gender) => {
  if (!name) return "the patient";
  const n = String(name).trim();
  if (/^(mr|mrs|ms|miss|dr|master|baby)\.?\s/i.test(n)) return n;
  const h = honorific(gender);
  return h ? `${h} ${n}` : n;
};
/* ObjectId hashes never leak — 24-hex strings render as "signed digitally". */
const OBJECT_ID_RX = /^[0-9a-f]{24}$/i;
const isObjectId = (v) => typeof v === "string" && OBJECT_ID_RX.test(v.trim());
const displayActor = (v, fallback = "signed digitally") => {
  if (v == null || v === "") return fallback;
  if (isObjectId(String(v))) return fallback;
  return String(v).trim();
};
const ABNORMAL_RX = /(hypo|hyper|deficien|elev(?:ated)?|low\b|high\b|↑|↓|positive|growth|raised|reduced|deranged|mild|moderate|severe)/i;
const NEGATIVE_RX = /(no growth|no\b.*pathogen|negative|nil|wnl|within normal|normal)/i;
const isResultAbnormal = (t) => {
  if (!t) return false;
  if (NEGATIVE_RX.test(t) && !ABNORMAL_RX.test(t)) return false;
  return ABNORMAL_RX.test(t);
};
const vitalsSentence = (v) => {
  if (!v || typeof v !== "object") return "";
  const bits = [];
  if (v.bp)    bits.push(`BP ${v.bp}`);
  if (v.pulse) bits.push(`pulse ${v.pulse}/min`);
  if (v.temp)  bits.push(`temperature ${v.temp}°F`);
  if (v.spo2)  bits.push(`SpO₂ ${v.spo2}%`);
  if (v.rr)    bits.push(`respiratory rate ${v.rr}/min`);
  return bits.length ? oxford(bits) : "";
};
const allergyLine = (a) => {
  if (!a) return "";
  if (typeof a === "string") return a;
  const agent = a.allergen || a.agent || a.name || "";
  const reaction = a.reaction || a.severity || "";
  return reaction ? `${agent} (${reaction})` : agent;
};
const fmtDateTime = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(d); }
};
const tsOf = (d) => {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
};

/* === Style tokens === */

const COL = {
  ink:     "#0f172a",
  body:    "#1f2937",
  muted:   "#475569",
  rule:    "#0f172a",
  pillBg:  "#f1f5f9",
  pillTxt: "#475569",
  abN:     "#b91c1c",
  ok:      "#15803d",
};

const SH = {
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

const SUB = {
  fontFamily: "'DM Sans', Georgia, serif",
  fontWeight: 600,
  fontSize: 10,
  letterSpacing: "0.5px",
  textTransform: "uppercase",
  color: COL.muted,
  margin: "8px 0 3px",
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

/* === Primitives === */

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

/* === Primary theme component === */
const ReferralSummary = ({ settings = {}, file, events = [], receipt = {} }) => {
  const f = file || {};

  /* ── Patient strip — same two-column layout as Narrative ─── */
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

  /* ── Derived names + diagnosis ───────────────────────────── */
  const fullName  = fullNameWithHonorific(f.patient?.fullName, f.patient?.gender);
  const ageGender = ageGenderPhrase(f.patient?.age, f.patient?.gender);
  const dxProv    = f.admission?.provisionalDiagnosis || f.ia?.doctor?.provisionalDiagnosis || "";
  const dxWork    = f.admission?.workingDiagnosis    || f.ia?.doctor?.workingDiagnosis    || "";
  const dxFinal   = f.admission?.finalDiagnosis      || f.ia?.doctor?.finalDiagnosis      || "";
  const currentDx = dxWork || dxProv || dxFinal || "";

  /* ── Allergies + isolation ───────────────────────────────── */
  const allergies = (f.alerts?.allergies || []).map(allergyLine).filter(Boolean);
  const isolationFlags = (f.alerts?.isolationFlags || []).filter(Boolean);

  /* ── Doctor Notes: first + last (excluding "initial" type) ─ */
  const allDocNotes = (Array.isArray(f.doctorNotes) ? f.doctorNotes.slice() : [])
    .sort((a, b) => tsOf(a.createdAt) - tsOf(b.createdAt));
  const nonInitialDocNotes = allDocNotes.filter((n) => (n.noteType || "").toLowerCase() !== "initial");
  const firstDocNote = nonInitialDocNotes[0];
  const lastDocNote  = nonInitialDocNotes[nonInitialDocNotes.length - 1];
  const hasOneDocNote = nonInitialDocNotes.length === 1;

  /* ── Nursing Notes: first + last ─────────────────────────── */
  const allNurseNotes = (Array.isArray(f.nursingNotes) ? f.nursingNotes.slice() : [])
    .sort((a, b) => tsOf(a.createdAt) - tsOf(b.createdAt));
  const firstNurseNote = allNurseNotes[0];
  const lastNurseNote  = allNurseNotes[allNurseNotes.length - 1];
  const hasOneNurseNote = allNurseNotes.length === 1;

  /* ── Investigations split (abnormal vs normal) ───────────── */
  const invs = (f.investigations || []).filter((i) => i.name);
  const abnormalInvs = invs.filter((i) => isResultAbnormal(i.result));
  const recentInvs = invs.slice().sort((a, b) =>
    tsOf(b.reportedAt || b.orderedAt) - tsOf(a.reportedAt || a.orderedAt),
  );
  const invsToShow = recentInvs.slice(0, 10);
  const invsOverflow = Math.max(0, recentInvs.length - invsToShow.length);

  /* ── MAR — last 48 h window from latest dose ─────────────── */
  const allMar = Array.isArray(f.mar) ? f.mar : [];
  const marAt = (m) => m.givenAt || m.createdAt;
  const latestMarTs = allMar.reduce((acc, m) => Math.max(acc, tsOf(marAt(m))), 0);
  const cutoffTs = latestMarTs ? (latestMarTs - 48 * 3600 * 1000) : 0;
  const recentMar = allMar
    .filter((m) => tsOf(marAt(m)) >= cutoffTs)
    .sort((a, b) => tsOf(marAt(b)) - tsOf(marAt(a)));
  /* Group by drug+dose+route to give "last given" per medication. */
  const marByDrug = new Map();
  recentMar.forEach((m) => {
    const key = `${m.drug || "?"}|${m.dose || ""}|${m.route || ""}|${m.frequency || ""}`;
    if (!marByDrug.has(key)) {
      marByDrug.set(key, {
        drug: m.drug, dose: m.dose, route: m.route, frequency: m.frequency,
        lastGivenAt: marAt(m),
        status: m.status || "Administered",
        lastBy: m.givenBy,
      });
    }
  });
  const marRows = Array.from(marByDrug.values());

  /* Fallback to currently-prescribed meds if MAR is empty. */
  const activeMeds = Array.isArray(f.medications)
    ? f.medications.filter((m) => {
        if (!m.endDate) return true;
        return tsOf(m.endDate) >= Date.now() - 24 * 3600 * 1000;
      })
    : [];

  /* ── Consents on file ─────────────────────────────────────── */
  const consents = Array.isArray(f.consents) ? f.consents : [];

  /* ── Blood Transfusions ───────────────────────────────────── */
  const transfusions = (Array.isArray(f.bloodTransfusion) ? f.bloodTransfusion : [])
    .slice()
    .sort((a, b) => tsOf(a.at) - tsOf(b.at));

  /* ── Procedures ───────────────────────────────────────────── */
  const procedures = (Array.isArray(f.procedures) ? f.procedures : [])
    .slice()
    .sort((a, b) => tsOf(a.date) - tsOf(b.date));

  /* ── Discharge brief ─────────────────────────────────────── */
  const dischargeSummary = f.discharge?.summary || "";
  const isDischarged = !!(f.admission?.dischargeDate || dischargeSummary);
  const dischargeAdviceText = f.discharge?.advice || "";
  const dischargeAdviceItems = (() => {
    if (!dischargeAdviceText) return [];
    return String(dischargeAdviceText)
      .split(/\n+|(?:^|\s)\d+[\.)]\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
  })();

  /* ── Hospital contact (helpline / phone) ──────────────────── */
  const contactPhone = settings?.helpline24x7
                    || settings?.phone1
                    || settings?.phone
                    || "the front desk";

  /* ── IA chief-complaint, used only if missing from nurse note ── */
  const iaNurseChief = stripDot(f.ia?.nursing?.chiefComplaint || "");

  /* ── Doctor IA HOPI for optional render ───────────────────── */
  const iaDoc = f.ia?.doctor || {};
  const iaDocHopi = stripDot(iaDoc.hopi || iaDoc.history || iaDoc.historyOfPresentingIllness || "");
  const iaDocChief = stripDot(iaDoc.chiefComplaints || iaDoc.cc || iaDoc.complaints || "");
  const iaDocSigner = displayActor(iaDoc.signedByName || iaDoc.signedBy, "");
  const iaDocAt = iaDoc.signedAt || iaDoc.assessmentDate;
  const hasIADoc = !!(iaDocHopi || iaDocChief);

  /* ── Suggested action items from doctor IA, if any ────────── */
  const iaFollowUp = stripDot(iaDoc.planForFollowUp || iaDoc.followUpPlan || "");
  const iaAdvisory = stripDot(iaDoc.advisoryNote || iaDoc.handoverAdvice || "");
  const actionItems = [iaFollowUp, iaAdvisory].filter(Boolean);

  /* =====================================================================
     RENDER
     ===================================================================== */
  return (
    <PrintShell
      hospital={settings}
      docTitle="Referral Summary"
      docSubtitle="Condensed handover for the referring physician"
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
        I am pleased to share the most recent condition of <strong>{fullName}</strong>,
        currently under our care at <strong>{settings?.hospitalName || settings?.name || "our hospital"}</strong>.
        This is a <strong>condensed handover</strong> containing the first and last clinical
        notes, current medications, recent reports, blood transfusions,
        procedures and consents on file. The full chronological record is
        available as the <em>Complete Patient File</em> on request.
      </Para>

      {/* §  Encounter at a Glance — 4-row compact header */}
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
            <td style={{ padding: "2px 6px", color: COL.muted }}>Admitted</td>
            <td style={{ padding: "2px 6px", color: COL.body }}>
              {fmtDate(f.admission?.date, true)}
              {f.admission?.consultant ? <> under <strong>{f.admission.consultant}</strong></> : null}
              {f.admission?.department ? <> ({f.admission.department}</> : null}
              {f.admission?.bed ? <>{f.admission?.department ? ", " : " ("}bed {f.admission.bed}</> : null}
              {(f.admission?.department || f.admission?.bed) ? <>)</> : null}.
            </td>
          </tr>
          <tr>
            <td style={{ padding: "2px 6px", color: COL.muted }}>Current diagnosis</td>
            <td style={{ padding: "2px 6px", color: COL.body }}>
              {currentDx ? <strong>{currentDx}</strong> : <em style={{ color: COL.muted }}>not yet recorded</em>}
              {f.admission?.icd10 ? <> · <em>ICD-10 {f.admission.icd10}</em></> : null}.
            </td>
          </tr>
          <tr>
            <td style={{ padding: "2px 6px", color: COL.muted }}>Allergies</td>
            <td style={{ padding: "2px 6px", color: COL.body }}>
              {allergies.length > 0
                ? <strong>{oxford(allergies)}</strong>
                : "Nil known"}.
            </td>
          </tr>
        </tbody>
      </table>

      {/* Allergy + isolation callouts — safety-critical */}
      {allergies.length > 0 && (
        <Callout tone="red" title="Allergy alert">
          <strong>{oxford(allergies)}.</strong>{" "}
          Avoid the noted agents and verify any prescribed substitutes
          against this list.
        </Callout>
      )}
      {isolationFlags.length > 0 && (
        <Callout tone="amber" title="Isolation precautions">
          <strong>{oxford(isolationFlags)}.</strong> Universal and contact
          precautions to be observed by all care providers.
        </Callout>
      )}

      {/* §  Doctor Assessment Notes  [NABH COP.7] */}
      {(hasIADoc || nonInitialDocNotes.length > 0) ? (
        <>
          <SectionHeader nabh="NABH COP.7">Doctor Assessment Notes</SectionHeader>

          {hasIADoc ? (
            <>
              <SubHeader>Doctor Initial Assessment</SubHeader>
              {iaDocChief ? (
                <Para><strong>Chief complaint:</strong> {iaDocChief}.</Para>
              ) : null}
              {iaDocHopi ? (
                <Para><em>{cleanSentence(iaDocHopi)}</em></Para>
              ) : null}
              {(dxProv || dxWork) ? (
                <Para style={{ marginBottom: 2 }}>
                  {dxProv ? <><strong>Provisional diagnosis:</strong> {dxProv}. </> : null}
                  {dxWork && dxWork !== dxProv ? <><strong>Working diagnosis:</strong> {dxWork}.</> : null}
                </Para>
              ) : null}
              {(iaDocSigner || iaDocAt) ? (
                <Para style={{ color: COL.muted, fontSize: 10 }}>
                  <em>
                    Signed by {iaDocSigner || "Consultant"}
                    {iaDocAt ? ` · ${fmtDateTime(iaDocAt)}` : ""}.
                  </em>
                </Para>
              ) : null}
            </>
          ) : null}

          {nonInitialDocNotes.length > 0 ? (
            hasOneDocNote ? (
              <>
                <SubHeader>Doctor's Note</SubHeader>
                <Para>
                  <strong>{fmtDateTime(firstDocNote.createdAt)}</strong>
                  {firstDocNote.noteType ? <> · {firstDocNote.noteType}</> : null}
                  {firstDocNote.doctorName ? <> · <em>{displayActor(firstDocNote.doctorName)}</em></> : null}
                </Para>
                <Para>{cleanSentence(firstDocNote.content)}</Para>
              </>
            ) : (
              <>
                <SubHeader>First Note — Initial Impression</SubHeader>
                <Para>
                  <strong>{fmtDateTime(firstDocNote.createdAt)}</strong>
                  {firstDocNote.noteType ? <> · {firstDocNote.noteType}</> : null}
                  {firstDocNote.doctorName ? <> · <em>{displayActor(firstDocNote.doctorName)}</em></> : null}
                </Para>
                <Para>{cleanSentence(firstDocNote.content)}</Para>

                <SubHeader>Most Recent Note — Current Status</SubHeader>
                <Para>
                  <strong>{fmtDateTime(lastDocNote.createdAt)}</strong>
                  {lastDocNote.noteType ? <> · {lastDocNote.noteType}</> : null}
                  {lastDocNote.doctorName ? <> · <em>{displayActor(lastDocNote.doctorName)}</em></> : null}
                </Para>
                <Para>{cleanSentence(lastDocNote.content)}</Para>
              </>
            )
          ) : null}
        </>
      ) : null}

      {/* §  Nursing Observations  [NABH COP.2] */}
      {allNurseNotes.length > 0 ? (
        <>
          <SectionHeader nabh="NABH COP.2">Nursing Observations</SectionHeader>

          {/* Patient voice — IA chief complaint if the first nursing note
              doesn't already capture it. */}
          {(() => {
            if (!iaNurseChief) return null;
            const firstContent = String(firstNurseNote?.content || "").toLowerCase();
            const chiefLower = iaNurseChief.toLowerCase().slice(0, Math.max(8, Math.floor(iaNurseChief.length / 3)));
            if (firstContent.includes(chiefLower)) return null;
            return (
              <Para>
                On admission the patient described: <em>{iaNurseChief}</em>.
              </Para>
            );
          })()}

          {hasOneNurseNote ? (
            <>
              <SubHeader>Nursing Note</SubHeader>
              <Para>
                <strong>{fmtDateTime(firstNurseNote.createdAt)}</strong>
                {firstNurseNote.shift ? <> · {firstNurseNote.shift} shift</> : null}
                {firstNurseNote.nurseName ? <> · <em>{displayActor(firstNurseNote.nurseName)}</em></> : null}
              </Para>
              <Para>{cleanSentence(firstNurseNote.content)}</Para>
              {(() => {
                const vs = vitalsSentence(firstNurseNote.vitals);
                return vs ? (
                  <Para style={{ color: COL.muted, fontSize: 10 }}>
                    <em>vitals: {vs.toLowerCase()}.</em>
                  </Para>
                ) : null;
              })()}
            </>
          ) : (
            <>
              <SubHeader>First Nursing Note — Admission Baseline</SubHeader>
              <Para>
                <strong>{fmtDateTime(firstNurseNote.createdAt)}</strong>
                {firstNurseNote.shift ? <> · {firstNurseNote.shift} shift</> : null}
                {firstNurseNote.nurseName ? <> · <em>{displayActor(firstNurseNote.nurseName)}</em></> : null}
              </Para>
              <Para>{cleanSentence(firstNurseNote.content)}</Para>
              {(() => {
                const vs = vitalsSentence(firstNurseNote.vitals);
                return vs ? (
                  <Para style={{ color: COL.muted, fontSize: 10 }}>
                    <em>vitals: {vs.toLowerCase()}.</em>
                  </Para>
                ) : null;
              })()}

              <SubHeader>Most Recent Nursing Note — Current Observation</SubHeader>
              <Para>
                <strong>{fmtDateTime(lastNurseNote.createdAt)}</strong>
                {lastNurseNote.shift ? <> · {lastNurseNote.shift} shift</> : null}
                {lastNurseNote.nurseName ? <> · <em>{displayActor(lastNurseNote.nurseName)}</em></> : null}
              </Para>
              <Para>{cleanSentence(lastNurseNote.content)}</Para>
              {(() => {
                const vs = vitalsSentence(lastNurseNote.vitals);
                return vs ? (
                  <Para style={{ color: COL.muted, fontSize: 10 }}>
                    <em>vitals: {vs.toLowerCase()}.</em>
                  </Para>
                ) : null;
              })()}
            </>
          )}
        </>
      ) : null}

      {/* §  Investigations & Reports  [NABH AAC.7 / AAC.8] */}
      {(invs.length > 0 || (f.labReports || []).length > 0) ? (
        <>
          <SectionHeader nabh="NABH AAC.7 / AAC.8">Investigations & Reports</SectionHeader>

          {invs.length > 0 ? (
            <>
              <SubHeader>Investigations</SubHeader>
              {abnormalInvs.length > 0 ? (
                <Para>
                  Significant findings included{" "}
                  {abnormalInvs.map((iv, idx) => {
                    const sep = idx === 0
                      ? null
                      : idx === abnormalInvs.length - 1
                        ? " and "
                        : ", ";
                    return (
                      <span key={`ab-${idx}`}>
                        {sep}
                        <strong>{iv.name}</strong>
                        {iv.result ? <> — {stripDot(iv.result)}</> : null}
                      </span>
                    );
                  })}.
                </Para>
              ) : (
                <Para><em>Routine investigations were within normal limits.</em></Para>
              )}
              <MiniTable
                headers={["Test", "Ordered", "Reported", "Result"]}
                rows={invsToShow.map((iv) => [
                  <strong>{iv.name || "—"}</strong>,
                  iv.orderedAt  ? fmtDate(iv.orderedAt)  : "—",
                  iv.reportedAt ? fmtDate(iv.reportedAt) : "—",
                  iv.result ? (isResultAbnormal(iv.result)
                    ? <span style={{ color: COL.abN, fontWeight: 600 }}>{iv.result}</span>
                    : <em>{iv.result}</em>) : "—",
                ])}
                widths={["28%", "16%", "16%", "40%"]}
              />
              {invsOverflow > 0 ? (
                <Para style={{ color: COL.muted, fontSize: 9 }}>
                  <em>…plus {invsOverflow} more on file.</em>
                </Para>
              ) : null}
            </>
          ) : null}

          {(f.labReports || []).length > 0 ? (
            <>
              <SubHeader>Lab Reports</SubHeader>
              <MiniTable
                headers={["Report", "Date", "Key Findings"]}
                rows={f.labReports.map((r) => {
                  const imp = String(r.impression || r.summary || "").slice(0, 100);
                  return [
                    <strong>{r.name || "—"}</strong>,
                    fmtDate(r.date),
                    imp || "—",
                  ];
                })}
                widths={["30%", "16%", "54%"]}
              />
            </>
          ) : null}
        </>
      ) : null}

      {/* §  Current Medication Administration (last 48 h)  [NABH MOM.4] */}
      {(marRows.length > 0 || activeMeds.length > 0) ? (
        <>
          <SectionHeader nabh="NABH MOM.4">Current Medication Administration</SectionHeader>
          {marRows.length > 0 ? (
            <>
              <Para style={{ color: COL.muted, fontSize: 10 }}>
                <em>Showing drugs administered in the last 48 hours.</em>
              </Para>
              <MiniTable
                headers={["Drug", "Dose", "Route", "Last Given", "Frequency", "Status", "By"]}
                rows={marRows.map((m) => [
                  <strong>{m.drug || "—"}</strong>,
                  m.dose      || "—",
                  m.route     || "—",
                  m.lastGivenAt ? fmtDateTime(m.lastGivenAt) : "—",
                  m.frequency || "—",
                  m.status    || "—",
                  displayActor(m.lastBy),
                ])}
                widths={["24%", "10%", "10%", "18%", "12%", "12%", "14%"]}
              />
            </>
          ) : (
            <>
              <SubHeader>Currently Prescribed Medications</SubHeader>
              <MiniTable
                headers={["Drug", "Dose", "Route", "Frequency", "Status", "Prescribed By"]}
                rows={activeMeds.map((m) => [
                  <strong>{m.drug || m.name || "—"}</strong>,
                  m.dose      || "—",
                  m.route     || "—",
                  m.frequency || "—",
                  m.status    || (m.endDate ? "Continued" : "Active"),
                  displayActor(m.prescribedBy || m.orderedBy),
                ])}
                widths={["26%", "12%", "12%", "16%", "14%", "20%"]}
              />
            </>
          )}
        </>
      ) : null}

      {/* §  Consents Taken  [NABH PRE.1] */}
      {consents.length > 0 ? (
        <>
          <SectionHeader nabh="NABH PRE.1">Consents Taken</SectionHeader>
          <MiniTable
            headers={["Consent Form", "Signed", "Signed By", "Witness", "Signed At"]}
            rows={consents.map((c) => [
              c.name || c.formName || "—",
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

      {/* §  Blood Transfusion Records  [NABH HIC.4 / MOM.4] */}
      {transfusions.length > 0 ? (
        <>
          <SectionHeader nabh="NABH HIC.4 / MOM.4">Blood Transfusion Records</SectionHeader>
          {transfusions.map((b, i) => {
            const preBp    = b.preVitals?.bp    || "—";
            const prePulse = b.preVitals?.pulse || "—";
            const postBp    = b.postVitals?.bp    || "—";
            const postPulse = b.postVitals?.pulse || "—";
            const hadReaction = !!b.reaction;
            return (
              <div key={`bt-${i}`} style={{ marginBottom: 6, pageBreakInside: "avoid" }}>
                <Para style={{ marginBottom: 2 }}>
                  <strong>{fmtDateTime(b.at)}</strong> · Component <strong>{b.component || "—"}</strong>
                  {b.bagNumber ? <> · Bag No {b.bagNumber}</> : null}
                  {b.volumeMl != null ? <> · Volume {b.volumeMl} ml</> : null}.
                </Para>
                <Para style={{ marginBottom: 2 }}>
                  Pre-vitals: BP {preBp}, pulse {prePulse}. Post-vitals: BP {postBp}, pulse {postPulse}.
                </Para>
                <Para style={{ marginBottom: 2 }}>
                  Reaction:{" "}
                  {hadReaction
                    ? <em style={{ color: COL.abN, fontWeight: 700 }}>
                        Yes{b.reactionType ? ` — ${b.reactionType}` : ""}
                      </em>
                    : <span>Nil</span>}.
                  {" "}Given by: {displayActor(b.transfusedBy || b.givenBy)}.
                </Para>
              </div>
            );
          })}
        </>
      ) : null}

      {/* §  Procedure Records  [NABH COP.13] */}
      {procedures.length > 0 ? (
        <>
          <SectionHeader nabh="NABH COP.13">Procedure Records</SectionHeader>
          {procedures.map((p, i) => (
            <div key={`proc-${i}`} style={{ marginBottom: 6, pageBreakInside: "avoid" }}>
              <Para style={{ marginBottom: 2 }}>
                <strong>{p.date ? fmtDate(p.date, true) : "—"}</strong> · <strong>{p.name || p.procedureName || "—"}</strong>
              </Para>
              {(p.surgeon || p.anaesthetist) ? (
                <Para style={{ marginBottom: 2 }}>
                  {p.surgeon ? <>Surgeon: <em>{displayActor(p.surgeon)}</em></> : null}
                  {p.surgeon && p.anaesthetist ? <>, </> : null}
                  {p.anaesthetist ? <>Anaesthetist: <em>{displayActor(p.anaesthetist)}</em></> : null}.
                </Para>
              ) : null}
              {p.findings ? (
                <Para style={{ marginBottom: 2 }}>
                  Findings: {stripDot(p.findings)}.
                </Para>
              ) : null}
              {p.notes ? (
                <Para style={{ marginBottom: 2 }}>
                  Notes: {cleanSentence(p.notes)}
                </Para>
              ) : null}
            </div>
          ))}
        </>
      ) : null}

      {/* §  Current Status / Discharge */}
      <SectionHeader nabh={isDischarged ? "NABH AAC.11" : undefined}>
        {isDischarged ? "Discharge Brief" : "Current Status"}
      </SectionHeader>
      {isDischarged ? (
        <>
          {dischargeSummary ? (
            <Para>{cleanSentence(dischargeSummary)}</Para>
          ) : null}
          <Para>
            <strong>{fullName}</strong> was <strong>discharged</strong>
            {f.admission?.dischargeDate ? <> on <strong>{fmtDate(f.admission.dischargeDate, true)}</strong></> : null}
            {f.discharge?.condition ? <> in <strong>{String(f.discharge.condition).toLowerCase()}</strong> condition</> : null}.
            {dxFinal ? <> Final diagnosis: <strong>{dxFinal}</strong>.</> : null}
          </Para>
          {dischargeAdviceItems.length > 0 ? (
            <>
              <SubHeader>Discharge Advice</SubHeader>
              <ol style={{ fontSize: 10.5, lineHeight: 1.4, color: COL.body, margin: "2px 0 6px 22px", padding: 0 }}>
                {dischargeAdviceItems.map((t, idx) => (
                  <li key={`adv-${idx}`} style={{ marginBottom: 2 }}>{t}</li>
                ))}
              </ol>
            </>
          ) : null}
          {f.discharge?.followUpDate ? (
            <Para>
              <strong>Follow-up:</strong> {fmtDate(f.discharge.followUpDate)}
              {f.admission?.consultant ? <> with <strong>{f.admission.consultant}</strong></> : null}.
            </Para>
          ) : null}
        </>
      ) : (
        <Para>
          The patient remains under our care.
          {f.admission?.bed ? <> Currently on bed <strong>{f.admission.bed}</strong>{f.admission?.ward ? <> ({f.admission.ward})</> : null}.</> : null}
          {(dxWork || dxProv) ? <> The treating team's working impression is <strong>{dxWork || dxProv}</strong>.</> : null}
          {" "}Plan: continue current management and reassess daily.
        </Para>
      )}

      {/* §  Suggested Action Items — optional, only if IA had a plan */}
      {actionItems.length > 0 ? (
        <>
          <SectionHeader>Suggested Action Items for the Referring Physician</SectionHeader>
          <ol style={{ fontSize: 10.5, lineHeight: 1.4, color: COL.body, margin: "2px 0 6px 22px", padding: 0 }}>
            {actionItems.map((t, idx) => (
              <li key={`act-${idx}`} style={{ marginBottom: 2 }}>{t}.</li>
            ))}
          </ol>
        </>
      ) : null}

      {/* Closing paragraph */}
      <p
        style={{
          fontSize: 11,
          fontStyle: "italic",
          color: COL.muted,
          margin: "12px 0 4px",
          textAlign: "justify",
        }}
      >
        Should you need additional information, the <em>Complete Patient
        File</em> containing every progress note, MAR entry, vital sign
        reading and audit trail can be requested through Medical Records
        at <strong>{contactPhone}</strong>. We thank you for entrusting
        this patient to our shared care.
      </p>
    </PrintShell>
  );
};

export default ReferralSummary;
