// Components/print/printables/MedicalCertificate.jsx
// ════════════════════════════════════════════════════════════════════
// R7fu — Comprehensive Medical Certificate printable.
//
// Handles ALL 12 standard certificate types via a switch on
// `certificate.certType`. Each type renders its own concise body block
// on the hospital letterhead via PrintShell.
//
//   fitness            — Fitness to resume duty/school/travel/sports
//   sick-leave         — Medical leave with rest duration
//   discharge-fitness  — Fit to resume after IPD admission
//   disability         — RPwD Act 2016 layout, % + category + board
//   vaccination        — Vaccine name + dose + lot + date + site
//   pre-employment     — Examination findings + fit-category
//   insurance-claim    — Insurer/policy/claim-type/justification
//   sterilization      — Procedure type + surgeon + anaesthetist
//   bedridden          — Bedridden from + purpose (postal voting etc)
//   medico-legal       — MLC no + IO + police station + injuries
//   cause-of-death     — WHO Form 4 / 4A layout
//   birth-notification — Baby + mother + attending doctor
//
// Common footer + "issued in good faith" + IPC §§463-477 + QR/Reception
// verification line appears above every signature.
//
// Backward compatibility: the OLD printable accepted `receipt` and a
// loose `certType` (sickness / leave / emergency / healthy-now /
// extending-leave). We still accept those payload shapes so the OPD
// emergency / sick-leave flows that pre-date R7fu keep working — the
// legacy renderer is invoked when the certType isn't one of the 12 new
// canonical values.
// ════════════════════════════════════════════════════════════════════

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
      })
    : "—";

const fmtDateLong = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit", month: "long", year: "numeric",
      })
    : "—";

const fmtTime = (t) => (t ? String(t) : "—");

// ────────────────────────────────────────────────────────────────────
// Per-type label / NABH or legal anchor.
// ────────────────────────────────────────────────────────────────────
const TYPE_LABEL = {
  "fitness":            "Fitness Certificate",
  "sick-leave":         "Sick-Leave Certificate",
  "discharge-fitness":  "Discharge Fitness Certificate",
  "disability":         "Disability Certificate",
  "vaccination":        "Vaccination Certificate",
  "pre-employment":     "Pre-Employment Medical Certificate",
  "insurance-claim":    "Insurance Claim Certificate",
  "sterilization":      "Sterilization Certificate",
  "bedridden":          "Bedridden Status Certificate",
  "medico-legal":       "Medico-Legal Certificate",
  "cause-of-death":     "Medical Certificate of Cause of Death",
  "birth-notification": "Hospital Birth Notification",
};

const NEW_CERT_TYPES = new Set(Object.keys(TYPE_LABEL));

// ────────────────────────────────────────────────────────────────────
// Reusable styles for body blocks.
// ────────────────────────────────────────────────────────────────────
const PROSE = {
  fontSize: 11,
  lineHeight: 1.55,
  textAlign: "justify",
  marginBottom: 12,
  whiteSpace: "pre-wrap",
};
const KV_ROW = {
  display: "grid",
  gridTemplateColumns: "180px 1fr",
  gap: "6px 12px",
  fontSize: 11,
  marginBottom: 4,
};
const SECTION_TITLE = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".4px",
  textTransform: "uppercase",
  marginTop: 14,
  marginBottom: 6,
  color: "var(--pr-accent-color, #1d4ed8)",
  borderBottom: "1px solid #cbd5e1",
  paddingBottom: 4,
};
const ITALIC_NOTE = {
  fontSize: 10.5,
  fontStyle: "italic",
  color: "#475569",
  marginTop: 10,
  marginBottom: 6,
};
const BANNER = (color) => ({
  background: color,
  color: "white",
  padding: "6px 10px",
  fontSize: 11,
  fontWeight: 700,
  textAlign: "center",
  letterSpacing: ".5px",
  marginBottom: 12,
  borderRadius: 4,
});

// ────────────────────────────────────────────────────────────────────
// Helpers shared by every body block.
// ────────────────────────────────────────────────────────────────────
const PatientLine = ({ name, age, gender, uhid }) => (
  <span>
    <strong>{name || "the patient"}</strong>
    {" "}({age || "—"} / {gender || "—"}, UHID <strong>{uhid || "—"}</strong>)
  </span>
);

const Row = ({ label, children }) => (
  <div style={KV_ROW}>
    <div style={{ fontWeight: 600, color: "#334155" }}>{label}</div>
    <div>{children || "—"}</div>
  </div>
);

// ────────────────────────────────────────────────────────────────────
// 12 per-type body renderers. Each receives the normalized {c, p, ts}.
//   c  — top-level certificate doc (certNumber, issuedAt, diagnosis, …)
//   p  — patient identity bundle
//   ts — typeSpecific payload (per the model schema)
// ────────────────────────────────────────────────────────────────────
const FitnessBody = ({ c, p, ts }) => (
  <>
    <p style={PROSE}>
      This is to certify that <PatientLine {...p} /> has been examined by me and is
      hereby declared <strong>medically fit</strong> to resume{" "}
      <strong>{ts.fitForPurpose || "normal duties"}</strong>
      {ts.fitForPurpose === "other" && ts.purposeOther ? ` (${ts.purposeOther})` : ""} with
      effect from <strong>{fmtDateLong(ts.fitFromDate)}</strong>.
      {ts.restrictions
        ? <> Recommended restrictions: <strong>{ts.restrictions}</strong>.</>
        : ""}
      {" "}This certificate is valid until{" "}
      <strong>{ts.validUntil ? fmtDateLong(ts.validUntil) : "no specified end date"}</strong>.
    </p>
    {c.diagnosis && (
      <p style={PROSE}><strong>Clinical Basis:</strong> {c.diagnosis}
        {c.icd10?.code ? <> · ICD-10: <strong>{c.icd10.code}</strong> {c.icd10.description || ""}</> : null}
      </p>
    )}
  </>
);

const SickLeaveBody = ({ c, p, ts }) => (
  <>
    <p style={PROSE}>
      I have examined <PatientLine {...p} /> on{" "}
      <strong>{fmtDateLong(c.issuedAt)}</strong> and advise medical rest from{" "}
      <strong>{fmtDateLong(ts.restFromDate)}</strong> to{" "}
      <strong>{fmtDateLong(ts.restToDate)}</strong>{" "}
      (<strong>{ts.totalRestDays || "—"} day{ts.totalRestDays === 1 ? "" : "s"}</strong>).
      {ts.reasonSummary
        ? <> Reason: <strong>{ts.reasonSummary}</strong>.</>
        : ""}
      {" "}The patient is advised to return to duty / school from{" "}
      <strong>{fmtDateLong(ts.advisedFitToReturn || ts.restToDate)}</strong>, subject to clinical
      improvement.
    </p>
    {c.diagnosis && (
      <p style={PROSE}><strong>Diagnosis:</strong> {c.diagnosis}
        {c.icd10?.code ? <> · ICD-10: <strong>{c.icd10.code}</strong> {c.icd10.description || ""}</> : null}
      </p>
    )}
  </>
);

const DischargeFitnessBody = ({ c, p, ts }) => (
  <>
    <p style={PROSE}>
      This is to certify that <PatientLine {...p} /> was admitted under our care
      from <strong>{fmtDateLong(ts.admittedFrom)}</strong> to{" "}
      <strong>{fmtDateLong(ts.admittedTo)}</strong>.
      {ts.treatmentSummary
        ? <> Treatment summary: <strong>{ts.treatmentSummary}</strong>.</>
        : ""}
      {" "}The patient is hereby declared <strong>fit to resume normal activities</strong>{" "}
      from <strong>{fmtDateLong(ts.fitToResumeOn)}</strong>
      {ts.advisedRest ? <> with advised rest of <strong>{ts.advisedRest}</strong></> : ""}.
    </p>
    {c.diagnosis && (
      <p style={PROSE}><strong>Final Diagnosis:</strong> {c.diagnosis}
        {c.icd10?.code ? <> · ICD-10: <strong>{c.icd10.code}</strong> {c.icd10.description || ""}</> : null}
      </p>
    )}
  </>
);

const DisabilityBody = ({ c, p, ts }) => (
  <>
    <div style={BANNER("#7c3aed")}>RIGHTS OF PERSONS WITH DISABILITIES ACT, 2016</div>
    <p style={PROSE}>
      This is to certify that <PatientLine {...p} /> has been examined and is
      assessed to have a <strong>{ts.permanenceType || "—"}</strong> disability of{" "}
      <strong>{ts.percentDisability != null ? `${ts.percentDisability}%` : "—"}</strong>{" "}
      in the <strong>{ts.category || "—"}</strong> category.
      {ts.permanenceType === "temporary" && ts.validUntilIfTemporary
        ? <> Valid until <strong>{fmtDateLong(ts.validUntilIfTemporary)}</strong>.</>
        : ""}
    </p>
    <Row label="Basis of Assessment">{ts.basisOfAssessment || "—"}</Row>
    {c.diagnosis && <Row label="Diagnosis">{c.diagnosis}</Row>}
    {c.icd10?.code && <Row label="ICD-10">{c.icd10.code} — {c.icd10.description || ""}</Row>}

    {ts.permanenceType === "permanent" && Array.isArray(ts.medicalBoardMembers) && ts.medicalBoardMembers.length > 0 && (
      <>
        <div style={SECTION_TITLE}>Medical Board (RPwD Act §57(2))</div>
        <ol style={{ fontSize: 11, paddingLeft: 18, margin: "0 0 8px" }}>
          {ts.medicalBoardMembers.filter(Boolean).map((m, i) => (
            <li key={i} style={{ marginBottom: 2 }}>{m}</li>
          ))}
        </ol>
      </>
    )}
  </>
);

const VaccinationBody = ({ p, ts }) => (
  <>
    <p style={PROSE}>
      This is to certify that <PatientLine {...p} /> was administered the
      vaccine detailed below at this facility.
    </p>
    <Row label="Vaccine">{ts.vaccineName || "—"}</Row>
    <Row label="Manufacturer">{ts.manufacturer || "—"}</Row>
    <Row label="Lot / Batch No">{ts.lotNumber || "—"}</Row>
    <Row label="Dose Number">{ts.doseNumber || "—"}</Row>
    <Row label="Route of Administration">{ts.routeOfAdmin || "—"}</Row>
    <Row label="Vaccination Site">{ts.vaccinationSite || "—"}</Row>
    <Row label="Date of Dose">{fmtDateLong(ts.doseDate)}</Row>
    {ts.nextDoseDue && <Row label="Next Dose Due">{fmtDateLong(ts.nextDoseDue)}</Row>}

    <div style={{ ...SECTION_TITLE, marginTop: 18 }}>Administered By</div>
    <div style={{ fontSize: 11 }}>
      The above dose was administered by the undersigned authorised personnel
      at this hospital under aseptic conditions.
    </div>
  </>
);

const PreEmploymentBody = ({ c, p, ts }) => (
  <>
    <p style={PROSE}>
      This is to certify that <PatientLine {...p} /> has undergone a
      pre-employment medical examination on{" "}
      <strong>{fmtDateLong(ts.examinationDate || c.issuedAt)}</strong> for employment
      with <strong>{ts.employerName || "—"}</strong>
      {ts.jobRole ? <> as <strong>{ts.jobRole}</strong></> : ""}.
    </p>
    <Row label="General Condition">{ts.generalCondition || "—"}</Row>
    <Row label="Fitness Category">
      <strong style={{ textTransform: "uppercase" }}>{ts.fitCategory || "—"}</strong>
    </Row>
    {ts.fitCategory === "fit-with-restriction" && (
      <Row label="Restriction Details">{ts.restrictionDetails || "—"}</Row>
    )}
    <Row label="Validity (months)">{ts.validityMonths || "—"}</Row>
    {c.diagnosis && <Row label="Clinical Notes">{c.diagnosis}</Row>}
  </>
);

const InsuranceClaimBody = ({ c, p, ts }) => (
  <>
    <p style={PROSE}>
      This is to certify that <PatientLine {...p} /> is/was under medical care
      at this hospital. The clinical details below are furnished to support
      the insurance claim with <strong>{ts.insurerName || "—"}</strong>
      {ts.policyNo ? <> (Policy No <strong>{ts.policyNo}</strong>)</> : ""}.
    </p>
    <Row label="Claim Type">
      <strong style={{ textTransform: "capitalize" }}>{ts.claimType || "—"}</strong>
    </Row>
    <Row label="Admission Required">
      <strong>{ts.admissionRequired ? "Yes" : "No"}</strong>
    </Row>
    {ts.estimatedDuration && <Row label="Estimated Duration">{ts.estimatedDuration}</Row>}
    {c.diagnosis && <Row label="Diagnosis">{c.diagnosis}</Row>}
    {c.icd10?.code && <Row label="ICD-10">{c.icd10.code} — {c.icd10.description || ""}</Row>}
    {ts.treatmentJustification && (
      <>
        <div style={SECTION_TITLE}>Treatment Justification</div>
        <p style={{ ...PROSE, marginBottom: 4 }}>{ts.treatmentJustification}</p>
      </>
    )}
  </>
);

const SterilizationBody = ({ p, ts }) => (
  <>
    <p style={PROSE}>
      This is to certify that <PatientLine {...p} /> underwent a{" "}
      <strong style={{ textTransform: "capitalize" }}>{ts.procedureType || "—"}</strong>{" "}
      (sterilization) at <strong>{ts.hospitalName || "this hospital"}</strong> on{" "}
      <strong>{fmtDateLong(ts.procedureDate)}</strong>.
    </p>
    <Row label="Surgeon">{ts.surgeonName || "—"}</Row>
    <Row label="Anaesthetist">{ts.anaesthetistName || "—"}</Row>
    <Row label="Post-Operative Fitness">{ts.postOpFitness || "—"}</Row>
    <Row label="Advised Follow-Up">{ts.advisedFollowUp || "—"}</Row>
  </>
);

const BedriddenBody = ({ c, p, ts }) => (
  <>
    <p style={PROSE}>
      This is to certify that <PatientLine {...p} /> is{" "}
      <strong>bedridden</strong> with effect from{" "}
      <strong>{fmtDateLong(ts.bedriddenFromDate)}</strong> and is, in my
      professional opinion, unable to leave the home premises for the purpose
      of <strong style={{ textTransform: "capitalize" }}>
        {String(ts.purposeOfCert || "official records").replace(/-/g, " ")}
      </strong>.
    </p>
    <Row label="Primary Diagnosis">{ts.primaryDiagnosis || c.diagnosis || "—"}</Row>
    {c.icd10?.code && <Row label="ICD-10">{c.icd10.code} — {c.icd10.description || ""}</Row>}
    <Row label="Expected Duration">{ts.expectedDuration || "—"}</Row>
    <Row label="Mobility Status">{ts.mobilityStatus || "—"}</Row>
    <Row label="Requires Attendant">
      <strong>{ts.requiresAttendant ? "Yes" : "No"}</strong>
    </Row>
  </>
);

const MedicoLegalBody = ({ c, p, ts }) => (
  <>
    <div style={BANNER("#0f172a")}>MEDICO-LEGAL — CONFIDENTIAL</div>
    <p style={PROSE}>
      This is to certify that <PatientLine {...p} /> was examined under
      Medico-Legal Case (MLC) registration{" "}
      <strong>{ts.mlcNo || "—"}</strong> at this hospital. The following
      summary is furnished pursuant to the request of the Investigating
      Officer.
    </p>
    <Row label="MLC No">{ts.mlcNo || "—"}</Row>
    <Row label="Investigating Officer">{ts.ioName || "—"}</Row>
    <Row label="Police Station">{ts.policeStation || "—"}</Row>
    {ts.brief && (
      <>
        <div style={SECTION_TITLE}>Brief History</div>
        <p style={{ ...PROSE, marginBottom: 4 }}>{ts.brief}</p>
      </>
    )}
    {ts.natureOfInjuries && (
      <>
        <div style={SECTION_TITLE}>Nature of Injuries</div>
        <p style={{ ...PROSE, marginBottom: 4 }}>{ts.natureOfInjuries}</p>
      </>
    )}
    {c.diagnosis && (
      <p style={PROSE}><strong>Clinical Diagnosis:</strong> {c.diagnosis}</p>
    )}
  </>
);

const CauseOfDeathBody = ({ p, ts }) => (
  <>
    <div style={BANNER("#1e293b")}>FORM 4 / 4A — MEDICAL CERTIFICATE OF CAUSE OF DEATH</div>
    <p style={PROSE}>
      I hereby certify that <PatientLine {...p} /> expired at this facility on{" "}
      <strong>{fmtDateLong(ts.dateOfDeath)}</strong>
      {ts.timeOfDeath ? <> at <strong>{fmtTime(ts.timeOfDeath)} hrs</strong></> : ""}
      {ts.placeOfDeath ? <> at <strong>{ts.placeOfDeath}</strong></> : ""}. The causes of
      death are recorded below in accordance with the WHO International Form
      of Medical Certificate of Cause of Death.
    </p>

    <div style={SECTION_TITLE}>I — Immediate Cause</div>
    <Row label="(a) Immediate cause">
      <strong>{ts.immediateCause || "—"}</strong>
    </Row>
    {Array.isArray(ts.antecedentCauses) && ts.antecedentCauses.filter(Boolean).map((cause, i) => (
      <Row key={i} label={`(${String.fromCharCode(98 + i)}) Antecedent cause`}>{cause}</Row>
    ))}

    {ts.otherSignificantConditions && (
      <>
        <div style={SECTION_TITLE}>II — Other Significant Conditions Contributing to Death</div>
        <p style={{ ...PROSE, marginBottom: 4 }}>{ts.otherSignificantConditions}</p>
      </>
    )}

    <div style={SECTION_TITLE}>Manner & Investigation</div>
    <Row label="Manner of Death">
      <strong style={{ textTransform: "capitalize" }}>{ts.mannerOfDeath || "natural"}</strong>
    </Row>
    <Row label="Post-Mortem Performed">
      <strong>{ts.postMortemDone ? "Yes" : "No"}</strong>
    </Row>
    {ts.postMortemDone && ts.postMortemFindings && (
      <Row label="Post-Mortem Findings">{ts.postMortemFindings}</Row>
    )}
    {ts.attendingDoctor && <Row label="Attending Doctor">{ts.attendingDoctor}</Row>}
    {ts.hospitalRegNo && <Row label="Hospital Registration No">{ts.hospitalRegNo}</Row>}
  </>
);

const BirthNotificationBody = ({ p, ts }) => (
  <>
    <div style={BANNER("#10b981")}>HOSPITAL BIRTH NOTIFICATION — FOR REGISTRATION OF BIRTH</div>
    <p style={PROSE}>
      This is to notify the live birth recorded at this hospital. The details
      below are furnished to the appropriate registrar pursuant to the
      Registration of Births and Deaths Act, 1969.
    </p>

    <div style={SECTION_TITLE}>Baby</div>
    <Row label="Date of Birth">{fmtDateLong(ts.dateOfBirth)}</Row>
    <Row label="Time of Birth">{fmtTime(ts.timeOfBirth)}</Row>
    <Row label="Sex">{ts.sexOfBaby || "—"}</Row>
    <Row label="Birth Weight (g)">{ts.birthWeightGrams || "—"}</Row>
    <Row label="Mode of Delivery">{ts.modeOfDelivery || "—"}</Row>
    <Row label="Gestational Age (weeks)">{ts.gestationalAgeWeeks || "—"}</Row>
    <Row label="Place of Birth">{ts.placeOfBirth || "this hospital"}</Row>
    <Row label="Health of Baby">
      <strong style={{ textTransform: "capitalize" }}>{ts.healthOfBaby || "alive"}</strong>
    </Row>

    <div style={SECTION_TITLE}>Mother</div>
    <Row label="Name">{ts.motherName || p.name || "—"}</Row>
    <Row label="Age">{ts.motherAge || "—"}</Row>
    <Row label="Address">{ts.motherAddress || "—"}</Row>

    <div style={SECTION_TITLE}>Father</div>
    <Row label="Name">{ts.fatherName || "—"}</Row>

    <div style={SECTION_TITLE}>Attending Doctor</div>
    <Row label="Name">{ts.attendantDoctor || "—"}</Row>
  </>
);

const TYPE_RENDERER = {
  "fitness":            FitnessBody,
  "sick-leave":         SickLeaveBody,
  "discharge-fitness":  DischargeFitnessBody,
  "disability":         DisabilityBody,
  "vaccination":        VaccinationBody,
  "pre-employment":     PreEmploymentBody,
  "insurance-claim":    InsuranceClaimBody,
  "sterilization":      SterilizationBody,
  "bedridden":          BedriddenBody,
  "medico-legal":       MedicoLegalBody,
  "cause-of-death":     CauseOfDeathBody,
  "birth-notification": BirthNotificationBody,
};

// ────────────────────────────────────────────────────────────────────
// Legacy renderer kept for the OPD emergency / extending-leave /
// healthy-now flows that pre-date R7fu and still call the old payload
// shape via { certType: "sickness" | "leave" | "emergency" | … }.
// Mirrors the original component verbatim so existing prints don't
// regress.
// ────────────────────────────────────────────────────────────────────
const LEGACY_TEXT = {
  sickness: (d) =>
    `This is to certify that ${d.patientName || "the patient"} (${d.age || "—"}Y / ${d.gender || "—"}, UHID ${d.uhid || "—"}) ` +
    `was under my care for ${d.diagnosis || "the condition mentioned below"} and was advised rest from ` +
    `${fmtDate(d.fromDate)} to ${fmtDate(d.toDate)} (${d.days || "—"} day${d.days === 1 ? "" : "s"}).`,
  leave: (d) =>
    `This is to certify that ${d.patientName || "the patient"} (${d.age || "—"}Y / ${d.gender || "—"}, UHID ${d.uhid || "—"}) ` +
    `was admitted under my care from ${fmtDate(d.fromDate)} to ${fmtDate(d.toDate)} ` +
    `for ${d.diagnosis || "treatment"} and requires further rest of ${d.restDays || "—"} day(s) post-discharge.`,
  emergency: (d) =>
    `This is to certify that ${d.patientName || "the patient"} (${d.age || "—"}Y / ${d.gender || "—"}, UHID ${d.uhid || "—"}) ` +
    `attended the Emergency Department of this hospital on ${fmtDate(d.examDate || d.fromDate || new Date())} ` +
    `${d.arrivalTime ? `at ${d.arrivalTime} ` : ""}` +
    `with complaints of ${d.complaints || d.diagnosis || "an acute medical condition"} ` +
    `and received immediate medical attention. ${d.treatment ? `Initial treatment given: ${d.treatment}.` : ""} ` +
    `The patient was ${d.dispositionText || "advised follow-up consultation in the OPD"}.`,
  "healthy-now": (d) =>
    `This is to certify that ${d.patientName || "the patient"} (${d.age || "—"}Y / ${d.gender || "—"}, UHID ${d.uhid || "—"}) ` +
    `was under my care for ${d.diagnosis || "the condition mentioned below"} ` +
    `from ${fmtDate(d.fromDate)} to ${fmtDate(d.toDate)} and has now fully recovered. ` +
    `Following clinical re-examination on ${fmtDate(d.examDate || new Date())}, the patient is found medically fit ` +
    `to resume ${d.fitnessPurpose || "normal duties / school / work"} with effect from ${fmtDate(d.resumeDate || new Date())}.`,
  "extending-leave": (d) =>
    `This is to certify that ${d.patientName || "the patient"} (${d.age || "—"}Y / ${d.gender || "—"}, UHID ${d.uhid || "—"}) ` +
    `was previously issued a medical leave certificate ${d.previousCertNo ? `(Ref: ${d.previousCertNo}) ` : ""}` +
    `for the period ${fmtDate(d.previousFromDate)} to ${fmtDate(d.previousToDate)}. ` +
    `On clinical re-examination on ${fmtDate(d.examDate || new Date())}, the patient still requires further rest ` +
    `for ${d.diagnosis || "ongoing treatment"}. The leave is hereby extended from ${fmtDate(d.fromDate)} ` +
    `to ${fmtDate(d.toDate)} (additional ${d.days || "—"} day${d.days === 1 ? "" : "s"}). ` +
    `The patient is expected to resume duties on or after ${fmtDate(d.resumeDate || d.toDate)}.`,
};
const LEGACY_TITLE = {
  sickness:          "Medical Sickness Certificate",
  leave:             "Medical Leave Certificate",
  emergency:         "Emergency Attendance Certificate",
  "healthy-now":     "Fitness-to-Resume (Recovery) Certificate",
  "extending-leave": "Extension of Medical Leave Certificate",
};

function LegacyBody({ r, kind, title }) {
  const text = (LEGACY_TEXT[kind] || LEGACY_TEXT.sickness)(r);
  return (
    <div style={{
      background: "white", border: "1px solid #e2e8f0", borderRadius: 8,
      padding: "18px 22px", marginBottom: 14,
      fontSize: 12, lineHeight: 1.7,
    }}>
      <div style={{ textAlign: "center", fontSize: 16, fontWeight: 800,
        textTransform: "uppercase", letterSpacing: ".5px",
        color: "var(--pr-accent-color, #1d4ed8)", marginBottom: 14,
        paddingBottom: 8, borderBottom: "2px solid currentColor",
      }}>{title}</div>
      <p style={{ margin: "0 0 12px" }}>To Whom It May Concern,</p>
      <p style={{ margin: "0 0 12px", textAlign: "justify" }}>{text}</p>
      {r.diagnosis && (
        <p style={{ margin: "0 0 12px" }}>
          <strong>Diagnosis:</strong> {r.diagnosis}
          {r.icd10 && <span className="muted"> · ICD-10: {r.icd10}</span>}
        </p>
      )}
      {r.remarks && (
        <p style={{ margin: "0 0 12px", whiteSpace: "pre-wrap" }}>
          <strong>Remarks:</strong> {r.remarks}
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Counter-signature panel — rendered only for disability + sterilization.
// ────────────────────────────────────────────────────────────────────
function CounterSignPanel({ c }) {
  const cs = c.counterSignedBy || {};
  if (!cs.name && !cs.reg) return null;
  return (
    <div style={{
      marginTop: 28,
      borderTop: "2px dashed #94a3b8",
      paddingTop: 14,
    }}>
      <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 8, color: "#475569" }}>
        COUNTER-SIGNED BY
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, fontSize: 11 }}>
        <div>
          <div style={{ fontWeight: 600 }}>{cs.name || "—"}</div>
          {cs.reg && <div style={{ color: "#64748b" }}>Reg No: {cs.reg}</div>}
          {cs.signedAt && (
            <div style={{ color: "#64748b" }}>
              Signed on {fmtDate(cs.signedAt)}
            </div>
          )}
        </div>
        <div style={{
          borderBottom: "1px solid #cbd5e1",
          height: 60,
          alignSelf: "end",
          color: "#94a3b8",
          fontSize: 9,
          textAlign: "right",
          paddingBottom: 4,
        }}>(Signature & Stamp)</div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Common footer block — appears above the digital signature on every
// printed certificate.
// ────────────────────────────────────────────────────────────────────
function CommonFooter({ settings, c }) {
  const helpline = settings.helpline24x7 || settings.phone1 || settings.phone2 || "the hospital reception";
  return (
    <div className="pr-section" style={{ marginTop: 16 }}>
      <div className="pr-section__title">Verification &amp; Good-Faith Disclosure</div>
      <div className="pr-section__body" style={{ fontSize: 10.5, lineHeight: 1.55 }}>
        <p style={{ ...ITALIC_NOTE, marginTop: 0 }}>
          This certificate is issued in good faith based on clinical examination
          and records as of {fmtDate(c.issuedAt)}. Any tampering or unauthorized
          use is a punishable offence under IPC §§ 463-477.
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 10.5 }}>
          <strong>Verify authenticity:</strong> contact the Medical Records Office at{" "}
          <strong>{helpline}</strong> quoting Certificate No <strong>{c.certNumber || "—"}</strong>.
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Main entry. Accepts both the NEW R7fu shape (`certificate`) and the
// LEGACY shape (`receipt`) so callers that haven't migrated yet keep
// rendering correctly.
// ────────────────────────────────────────────────────────────────────
const MedicalCertificate = ({ settings = {}, certificate, receipt }) => {
  // Determine payload + type
  const c    = certificate || receipt || {};
  const raw  = String(c.certType || "").trim();
  const isNew = NEW_CERT_TYPES.has(raw);
  const certType = isNew ? raw : raw.toLowerCase();

  // ── Patient identity bundle ─────────────────────────────────
  const p = {
    name:   c.patientName || c.fullName || "",
    age:    c.age || "",
    gender: c.gender || "",
    uhid:   c.patientUHID || c.UHID || c.uhid || "",
  };

  // ── PrintShell wiring ───────────────────────────────────────
  const typeLabel = TYPE_LABEL[certType] || (isNew ? "Medical Certificate" : (LEGACY_TITLE[certType] || "Medical Certificate"));
  const documentTitle = isNew
    ? `MEDICAL CERTIFICATE — ${typeLabel.toUpperCase()}`
    : (LEGACY_TITLE[certType] || (raw ? raw : "Medical Certificate"));

  const subtitle = c.certNumber
    ? `Certificate No. ${c.certNumber} · Issued on ${fmtDate(c.issuedAt)}`
    : (c.certNo ? `Certificate No. ${c.certNo}` : "");

  const infoItems = isNew
    ? [
        { label: "Patient",         value: p.name },
        { label: "UHID",            value: p.uhid },
        { label: "Age / Sex",       value: [p.age, p.gender].filter(Boolean).join(" / ") },
        { label: "Mobile",          value: c.mobile },
        { label: "Issuing Doctor",  value: c.doctorName },
        { label: "MCI Reg. No",     value: c.doctorReg },
        { label: "Visit Type",      value: c.visitType },
        { label: "Issued On",       value: fmtDate(c.issuedAt) },
      ]
    : [
        { label: "Patient",         value: p.name },
        { label: "UHID",            value: p.uhid },
        { label: "Age / Sex",       value: [p.age && `${p.age}Y`, p.gender].filter(Boolean).join(" / ") },
        { label: "Issued On",       value: fmtDate(c.issuedAt || new Date()) },
        { label: "Treating Doctor", value: c.doctorName },
        { label: "Reg. No",         value: c.doctorReg },
      ];

  // ── Body ────────────────────────────────────────────────────
  let body;
  if (isNew) {
    const Body = TYPE_RENDERER[certType];
    body = Body ? <Body c={c} p={p} ts={c.typeSpecific || {}} /> : null;
  } else {
    // Legacy fallback — keep all pre-R7fu certType strings working.
    const legacyKind = certType in LEGACY_TEXT ? certType : "sickness";
    body = <LegacyBody r={c} kind={legacyKind} title={documentTitle} />;
  }

  // Disability + sterilization render two signature panels. PrintShell
  // ships a single digital-issue stamp; we add the counter-sign block
  // just before the common footer.
  const showCounterSign = isNew && (certType === "disability" || certType === "sterilization");

  // Status banner — if revoked, render at the top of the body so a
  // re-printed copy of a revoked cert is unmistakable.
  const isRevoked = c.status === "revoked";
  // R7fu-PREVIEW — opened from MedicalCertificatePage's "Preview"
  // button before the cert is saved. Shows a prominent amber banner
  // so neither the doctor nor the patient mistakes a draft for the
  // final issued copy.
  const isPreview = c.previewMode === true || c.status === "preview" || c.certNumber === "PREVIEW · DRAFT";

  return (
    <PrintShell
      settings={settings}
      documentTitle={documentTitle}
      serialNo={c.certNumber || c.certNo}
      printCount={toNum(c.printCount)}
      infoItems={infoItems}
    >
      {/* Wrapping the body block keeps it on the hospital letterhead and
          centred inside PrintShell's body slot. */}
      <div style={{
        background: "white", border: "1px solid #e2e8f0", borderRadius: 8,
        padding: "18px 22px", marginBottom: 14, fontSize: 11, lineHeight: 1.55,
      }}>
        <div style={{
          textAlign: "center", fontSize: 15, fontWeight: 800,
          textTransform: "uppercase", letterSpacing: ".5px",
          color: "var(--pr-accent-color, #1d4ed8)", marginBottom: 6,
        }}>{typeLabel}</div>
        {subtitle && (
          <div style={{ textAlign: "center", fontSize: 10, color: "#475569", marginBottom: 14 }}>
            {subtitle}
          </div>
        )}
        {!subtitle && <div style={{ height: 6 }} />}

        {isRevoked && (
          <div style={BANNER("#b91c1c")}>
            REVOKED — THIS CERTIFICATE IS NO LONGER VALID
          </div>
        )}

        {isPreview && !isRevoked && (
          <div style={BANNER("#d97706")}>
            PREVIEW · DRAFT — NOT YET ISSUED · NO CERTIFICATE NUMBER ASSIGNED
          </div>
        )}

        <p style={{ ...PROSE, marginBottom: 14 }}>To Whom It May Concern,</p>

        {body}

        {showCounterSign && <CounterSignPanel c={c} />}

        <CommonFooter settings={settings} c={c} />
      </div>
    </PrintShell>
  );
};

export default MedicalCertificate;
