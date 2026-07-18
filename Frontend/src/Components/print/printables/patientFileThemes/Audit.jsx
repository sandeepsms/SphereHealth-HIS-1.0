// R7ft Theme 4 — NABH Audit Table
//
// Inspector-ready. No prose — every section is a tight 3-column
// table (Field · Value · NABH-Ref). Footer carries the chapter-
// code legend (AAC.4, COP.2, etc.) so the inspector can map each
// data point to the standard. Maximum data density.
//
// Target page count: 6 A4 pages for a 4-day admission.
// Compliance-grade brand vibe; best for NABH 6th-edition
// inspection and regulatory submission.
//
// Design rules:
//   • Every section title carries its NABH chapter suffix [NABH AAC.4]
//   • Every row carries a NABH-Ref column (e.g. AAC.1.3, MOM.4.2)
//   • Empty sections silently skipped — no "—" placeholders
//   • Long fields wrap; very long fields truncated to 80 chars + …
//   • IA blobs flattened recursively so the inspector can tick boxes
//     against each leaf field
//   • Legend block at end maps NABH chapter codes to chapter names

import React from "react";
import PrintShell from "@/templates/PrintShell";
import { fmtDate, fmtTime } from "./normalizeData";
// R7hr(THEME-REG): coverage records + NABH registers — previously Narrative-only.
import SharedRegisterSections from "./SharedRegisterSections";
// R7hr(DOCS-FULL-FU): six full formal documents appendix (order sheet, MAR,
// NABL labs, diagnostic reports, consents, diet, discharge).
import SharedFormalDocSections from "./SharedFormalDocSections";

/* ── helpers ─────────────────────────────────────────────────── */

// Truncate to N chars, normalise whitespace, append ellipsis.
const trunc = (s, n = 80) => {
  const x = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  if (!x) return "";
  return x.length <= n ? x : x.slice(0, n - 1).trim() + "…";
};

// Em-dash for empty values so the inspector sees an explicit "no data".
const emOrVal = (v) => {
  if (v == null) return "—";
  const s = String(v).trim();
  return s === "" ? "—" : s;
};

// "studentIdentification" → "Student Identification"
// "ros.cardiovascular"     → "Ros / Cardiovascular"
const titleCase = (key) => {
  if (!key) return "";
  return String(key)
    .split(".")
    .map((seg) =>
      seg
        .replace(/([A-Z])/g, " $1")
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase())
    )
    .join(" / ");
};

// Skip helper — null, undefined, empty string, empty array, empty object.
const isBlank = (v) => {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
};

// Stringify a scalar leaf into a render-friendly value.
const leafToStr = (v) => {
  if (v == null) return "";
  if (v instanceof Date) return fmtDate(v, true);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") {
    // Date-like ISO string sometimes lands here as wrapper
    if (v.$numberDecimal) return String(v.$numberDecimal);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
};

/* Walk an arbitrary IA (Initial Assessment) object and emit a flat
   list of { field, value, isSubTable?, subTable? } rows.
   Rules:
     • null / empty values silently skipped
     • nested object → recurse with dot-prefixed key
     • array of primitives → comma-join values
     • array of objects   → render as a sub-table block          */
const flattenIA = (obj, prefix = "") => {
  const rows = [];
  if (!obj || typeof obj !== "object") return rows;

  // Field names we never want surfaced to the inspector (signatures
  // and audit metadata live elsewhere in the print).
  const SKIP_KEYS = new Set([
    "_id", "__v", "createdAt", "updatedAt", "signedAt", "signedBy",
    "signedByName", "signedByReg", "submittedAt", "submittedBy",
    "assessmentDate", "patientId", "admissionId", "ipdId",
  ]);

  Object.entries(obj).forEach(([key, val]) => {
    if (SKIP_KEYS.has(key)) return;
    if (isBlank(val)) return;

    const fieldKey = prefix ? `${prefix}.${key}` : key;

    if (Array.isArray(val)) {
      // Array of primitives
      if (val.every((x) => x == null || typeof x !== "object")) {
        const joined = val.filter((x) => x != null && String(x).trim() !== "").join(", ");
        if (joined) rows.push({ field: titleCase(fieldKey), value: joined });
        return;
      }
      // Array of objects → sub-table
      const subRows = val
        .map((item, idx) =>
          item && typeof item === "object"
            ? Object.entries(item)
                .filter(([k, v]) => !SKIP_KEYS.has(k) && !isBlank(v))
                .map(([k, v]) => ({ field: `${idx + 1}. ${titleCase(k)}`, value: leafToStr(v) }))
            : []
        )
        .flat();
      if (subRows.length) {
        rows.push({
          field: titleCase(fieldKey),
          value: "",
          isSubTable: true,
          subTable: subRows,
        });
      }
      return;
    }

    if (typeof val === "object" && !(val instanceof Date)) {
      rows.push(...flattenIA(val, fieldKey));
      return;
    }

    rows.push({ field: titleCase(fieldKey), value: leafToStr(val) });
  });

  return rows;
};

/* ── small style primitives (component-local) ───────────────── */

const SECTION_HEADING = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#0f172a",
  margin: "14px 0 4px",
  fontWeight: 700,
  borderBottom: "1px solid #0f172a",
  paddingBottom: 2,
};

const SECTION_NABH = {
  color: "#64748b",
  fontSize: 9,
  fontWeight: 600,
  marginLeft: 6,
  letterSpacing: 0.4,
};

const TABLE_STYLE = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 9,
  marginBottom: 4,
  tableLayout: "fixed",
};

const TH_STYLE = {
  fontSize: 9,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  fontWeight: 700,
  background: "#f1f5f9",
  color: "#0f172a",
  padding: "3px 6px",
  border: "0.5px solid #cbd5e1",
  textAlign: "left",
};

const TD_STYLE = {
  fontSize: 9,
  padding: "3px 6px",
  border: "0.5px solid #e2e8f0",
  color: "#1e293b",
  verticalAlign: "top",
  wordBreak: "break-word",
};

const NABH_REF_STYLE = {
  ...TD_STYLE,
  fontFamily: "'Courier New', Consolas, monospace",
  fontSize: 9,
  color: "#475569",
  textAlign: "center",
  letterSpacing: 0.2,
};

/* ── shared section frame ────────────────────────────────────── */

const SectionHeading = ({ title, nabh }) => (
  <h3 style={SECTION_HEADING}>
    § {title}
    {nabh ? <span style={SECTION_NABH}>[NABH {nabh}]</span> : null}
  </h3>
);

// 3-col table: Field 30% / Value 55% / NABH-Ref 15%.
// Renders sub-tables inline beneath any "isSubTable" row.
const FieldTable = ({ rows, refPrefix }) => {
  if (!rows || !rows.length) return null;
  return (
    <table style={TABLE_STYLE} className="pr-table">
      <colgroup>
        <col style={{ width: "30%" }} />
        <col style={{ width: "55%" }} />
        <col style={{ width: "15%" }} />
      </colgroup>
      <thead>
        <tr>
          <th style={TH_STYLE}>Field</th>
          <th style={TH_STYLE}>Value</th>
          <th style={{ ...TH_STYLE, textAlign: "center" }}>NABH-Ref</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const stripe = i % 2 === 1 ? { background: "#f8fafc" } : null;
          const refCode = r.ref || (refPrefix ? `${refPrefix}.${i + 1}` : "");
          if (r.isSubTable && r.subTable && r.subTable.length) {
            return (
              <React.Fragment key={`r-${i}`}>
                <tr style={stripe}>
                  <td style={{ ...TD_STYLE, fontWeight: 600 }}>{r.field}</td>
                  <td style={{ ...TD_STYLE, color: "#64748b", fontStyle: "italic" }}>
                    ({r.subTable.length} item{r.subTable.length === 1 ? "" : "s"})
                  </td>
                  <td style={NABH_REF_STYLE}>{refCode}</td>
                </tr>
                {r.subTable.map((sr, j) => {
                  const subStripe = (i + j + 1) % 2 === 1 ? { background: "#f8fafc" } : null;
                  return (
                    <tr key={`r-${i}-s-${j}`} style={subStripe}>
                      <td style={{ ...TD_STYLE, paddingLeft: 18, color: "#475569" }}>
                        {sr.field}
                      </td>
                      <td style={{ ...TD_STYLE, whiteSpace: "pre-wrap" }}>
                        {emOrVal(sr.value)}
                      </td>
                      <td style={NABH_REF_STYLE}>{refPrefix ? `${refPrefix}.${i + 1}.${j + 1}` : ""}</td>
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          }
          return (
            <tr key={`r-${i}`} style={stripe}>
              <td style={{ ...TD_STYLE, fontWeight: 600 }}>{r.field}</td>
              <td style={{ ...TD_STYLE, whiteSpace: "pre-wrap" }}>{emOrVal(r.value)}</td>
              <td style={NABH_REF_STYLE}>{refCode}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

// Multi-column variant — used by event/list-style sections where the
// 3-col Field/Value/Ref shape doesn't fit (e.g. Investigations, MAR).
const MultiTable = ({ columns, rows }) => {
  if (!rows || !rows.length) return null;
  return (
    <table style={TABLE_STYLE} className="pr-table">
      <colgroup>
        {columns.map((c, i) => (
          <col key={`col-${i}`} style={{ width: c.width || "auto" }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={`h-${i}`} style={{ ...TH_STYLE, textAlign: c.align || "left" }}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => {
          const stripe = ri % 2 === 1 ? { background: "#f8fafc" } : null;
          return (
            <tr key={`row-${ri}`} style={stripe}>
              {columns.map((c, ci) => {
                const isRef = c.key === "ref";
                const baseStyle = isRef ? NABH_REF_STYLE : TD_STYLE;
                return (
                  <td
                    key={`c-${ri}-${ci}`}
                    style={{
                      ...baseStyle,
                      textAlign: c.align || baseStyle.textAlign || "left",
                      whiteSpace: c.wrap ? "pre-wrap" : baseStyle.whiteSpace,
                    }}
                  >
                    {emOrVal(row[c.key])}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

/* ============================================================ */

const AuditTheme = ({ settings = {}, file, events = [] }) => {
  const f = file || {};

  /* ── PrintShell patient strip ──────────────────────────────── */
  const ageSex = [
    f.patient?.age != null ? `${f.patient.age} yrs` : null,
    f.patient?.gender || null,
  ].filter(Boolean).join(" · ");

  const patientLeft = [
    { label: "Patient",     value: emOrVal(f.patient?.fullName) },
    { label: "UHID",        value: emOrVal(f.meta?.uhid) },
    { label: "IPD No",      value: emOrVal(f.meta?.ipdNo) },
    { label: "Age / Sex",   value: emOrVal(ageSex) },
    { label: "Blood Group", value: emOrVal(f.patient?.bloodGroup) },
    { label: "Mobile",      value: emOrVal(f.patient?.mobile) },
  ];
  const patientRight = [
    { label: "Admitted",    value: fmtDate(f.admission?.date, true) },
    { label: "Discharged",  value: fmtDate(f.admission?.dischargeDate, true) },
    { label: "Length of Stay", value: f.admission?.totalDays != null ? `${f.admission.totalDays} day(s)` : "—" },
    { label: "Consultant",  value: emOrVal(f.admission?.consultant) },
    { label: "Bed / Ward",  value: emOrVal([f.admission?.bed, f.admission?.ward].filter(Boolean).join(" · ")) },
    { label: "Department",  value: emOrVal(f.admission?.department) },
  ];

  /* ── Signatures (consultant + MRO) ─────────────────────────── */
  const signatures = {
    type: "double",
    left: {
      name: f.signatures?.consultant || f.admission?.consultant || "",
      role: "Consultant",
    },
    right: {
      name: f.signatures?.mro || "Medical Records Officer",
      role: "MRO",
    },
  };

  /* ── 1. Patient Identification [AAC.1] ─────────────────────── */
  const identificationRows = [
    { field: "UHID",            value: f.meta?.uhid,          ref: "AAC.1.1" },
    { field: "IPD No",          value: f.meta?.ipdNo,         ref: "AAC.1.2" },
    { field: "Full Name",       value: f.patient?.fullName,   ref: "AAC.1.3" },
    { field: "Age",             value: f.patient?.age != null ? `${f.patient.age} years` : "", ref: "AAC.1.4" },
    { field: "Sex",             value: f.patient?.gender,     ref: "AAC.1.5" },
    { field: "Mobile",          value: f.patient?.mobile,     ref: "AAC.1.6" },
    { field: "Address",         value: f.patient?.address,    ref: "AAC.1.7" },
    { field: "Blood Group",     value: f.patient?.bloodGroup, ref: "AAC.1.8" },
    { field: "Consultant",      value: f.admission?.consultant, ref: "AAC.1.9" },
    { field: "Department",      value: f.admission?.department, ref: "AAC.1.10" },
    { field: "Ward",            value: f.admission?.ward,     ref: "AAC.1.11" },
    { field: "Bed",             value: f.admission?.bed,      ref: "AAC.1.12" },
    { field: "Admitted",        value: fmtDate(f.admission?.date, true), ref: "AAC.1.13" },
    { field: "Discharged",      value: fmtDate(f.admission?.dischargeDate, true), ref: "AAC.1.14" },
    {
      field: "Length of Stay",
      value: f.admission?.totalDays != null ? `${f.admission.totalDays} day(s)` : "",
      ref: "AAC.1.15",
    },
  ];

  /* ── 2. Admission Details [AAC.4] ──────────────────────────── */
  const admissionRows = [
    { field: "Admission Type",        value: f.admission?.type,                ref: "AAC.4.1" },
    { field: "Mode of Arrival",       value: f.admission?.modeOfArrival,       ref: "AAC.4.2" },
    { field: "Referring Doctor",      value: f.admission?.referringDoctor,     ref: "AAC.4.3" },
    { field: "Reason for Admission",  value: f.admission?.reasonForAdmission,  ref: "AAC.4.4" },
    { field: "Provisional Diagnosis", value: f.admission?.provisionalDiagnosis,ref: "AAC.4.5" },
    { field: "Working Diagnosis",     value: f.admission?.workingDiagnosis,    ref: "AAC.4.6" },
    { field: "Final Diagnosis",       value: f.admission?.finalDiagnosis,      ref: "AAC.4.7" },
    { field: "ICD-10 Code",           value: f.admission?.icd10,               ref: "AAC.4.8" },
    { field: "ICD-10 Description",    value: f.admission?.icd10Desc,           ref: "AAC.4.9" },
  ];

  /* ── 3. Allergies & Safety Alerts [PSQ.1] ──────────────────── */
  const allergyRows = [];
  (f.alerts?.allergies || []).forEach((a, i) => {
    const agent = typeof a === "string" ? a : (a.allergen || a.agent || a.name || "");
    const reaction = typeof a === "string" ? "" : (a.reaction || "");
    const severity = typeof a === "string" ? "" : (a.severity || "");
    const valBits = [reaction, severity].filter(Boolean).join(" · ");
    if (agent) {
      allergyRows.push({
        field: `Allergen: ${agent}`,
        value: valBits || "Reaction not documented",
        ref: `PSQ.1.${i + 1}`,
      });
    }
  });
  (f.alerts?.isolationFlags || []).forEach((flag, i) => {
    if (flag) allergyRows.push({ field: "Isolation Flag", value: flag, ref: `PSQ.2.${i + 1}` });
  });
  (f.alerts?.crossCheckAlerts || []).forEach((alert, i) => {
    const msg = typeof alert === "string"
      ? alert
      : [alert.message || alert.text, alert.severity].filter(Boolean).join(" · ");
    if (msg) allergyRows.push({ field: "Cross-Check Alert", value: msg, ref: `PSQ.3.${i + 1}` });
  });

  /* ── 4. Initial Assessment — Doctor [AAC.4, AAC.5] ─────────── */
  const iaDoctorRows = flattenIA(f.ia?.doctor).map((r, i) => ({
    ...r,
    ref: r.ref || `AAC.4.${100 + i + 1}`,
  }));

  /* ── 5. Initial Assessment — Nursing [AAC.5, COP.2] ────────── */
  const iaNursingRows = flattenIA(f.ia?.nursing).map((r, i) => ({
    ...r,
    ref: r.ref || `AAC.5.${100 + i + 1}`,
  }));

  /* ── 6. Vitals on Admission [COP.2] ────────────────────────── */
  const v = f.vitals?.onAdmission || {};
  const vitalsRows = [
    { field: "Blood Pressure", value: v.bp ? `${v.bp} mmHg` : "",  ref: "COP.2.1" },
    { field: "Heart Rate",     value: v.pulse != null ? `${v.pulse} /min` : (v.hr != null ? `${v.hr} /min` : ""), ref: "COP.2.2" },
    { field: "Temperature",    value: v.temp != null ? `${v.temp} °F` : "", ref: "COP.2.3" },
    { field: "SpO₂",           value: v.spo2 != null ? `${v.spo2} %` : "",  ref: "COP.2.4" },
    { field: "Respiratory Rate", value: v.rr != null ? `${v.rr} /min` : "", ref: "COP.2.5" },
    { field: "Weight",         value: v.weight != null ? `${v.weight} kg` : "", ref: "COP.2.6" },
    { field: "Height",         value: v.height != null ? `${v.height} cm` : "", ref: "COP.2.7" },
    { field: "BMI",            value: v.bmi != null ? `${v.bmi} kg/m²` : "",   ref: "COP.2.8" },
  ].filter((r) => !isBlank(r.value));

  /* ── 7. Investigations & Reports [COP.5] ───────────────────── */
  const invRows = (f.investigations || []).map((inv, i) => ({
    name: inv.name,
    ordered: fmtDate(inv.orderedAt, true),
    reported: fmtDate(inv.reportedAt, true),
    result: trunc(inv.result, 80),
    ref: `COP.5.${i + 1}`,
  }));

  /* ── 8. Doctor Orders & Notes [COP.7] ──────────────────────── */
  const drNoteRows = (f.doctorNotes || []).map((n, i) => ({
    at: fmtDate(n.createdAt, true),
    noteType: n.noteType,
    doctor: n.doctorName,
    content: trunc(n.content, 80),
    ref: `COP.7.${i + 1}`,
  }));

  /* ── 9. Nursing Notes [COP.2] ──────────────────────────────── */
  const nrNoteRows = (f.nursingNotes || []).map((n, i) => ({
    at: fmtDate(n.createdAt, true),
    shift: n.shift,
    nurse: n.nurseName,
    content: trunc(n.content, 80),
    ref: `COP.2.${10 + i + 1}`,
  }));

  /* ── 10. Medication Administration Record [MOM.4] ──────────── */
  const medRows = (f.medications || []).map((m, i) => ({
    drug: m.drug,
    dose: m.dose,
    route: m.route,
    frequency: m.frequency,
    start: fmtDate(m.startDate),
    end: fmtDate(m.endDate),
    indication: trunc(m.indication, 40),
    ref: `MOM.4.${i + 1}`,
  }));

  /* ── 11. Procedures [COP.16] ───────────────────────────────── */
  const procRows = (f.procedures || []).map((p, i) => ({
    date: fmtDate(p.date, true),
    procedure: p.name,
    surgeon: p.surgeon,
    anaesthetist: p.anaesthetist,
    findings: trunc(p.findings, 80),
    ref: `COP.16.${i + 1}`,
  }));

  /* ── 12. Consent Forms [PRE.4] ─────────────────────────────── */
  const consentRows = (f.consents || []).map((c, i) => ({
    form: c.name,
    signed: c.signed ? "Y" : "N",
    signedBy: c.signedBy,
    witness: c.witness,
    signedAt: fmtDate(c.signedAt, true),
    ref: `PRE.4.${i + 1}`,
  }));

  /* ── 13. Discharge Summary [AAC.7] ─────────────────────────── */
  const dischargeRows = [
    { field: "Discharge Date",     value: fmtDate(f.admission?.dischargeDate, true), ref: "AAC.7.1" },
    { field: "Condition",          value: f.discharge?.condition,              ref: "AAC.7.2" },
    { field: "Final Diagnosis",    value: f.admission?.finalDiagnosis,         ref: "AAC.7.3" },
    { field: "Discharge Summary",  value: f.discharge?.summary,                ref: "AAC.7.4" },
    { field: "Discharge Advice",   value: f.discharge?.advice,                 ref: "AAC.7.5" },
    { field: "Follow-up",          value: fmtDate(f.discharge?.followUpDate),  ref: "AAC.7.6" },
  ];
  const hasDischarge = dischargeRows.some((r) => !isBlank(r.value) && r.value !== "—");

  /* ── 14. Audit Trail of Significant Events [IMS.1] ─────────── */
  const AUDIT_KINDS = new Set([
    "admission", "ia-doctor", "ia-nursing", "procedure", "discharge",
  ]);
  const auditEventRows = (events || [])
    .filter((e) => AUDIT_KINDS.has(e.kind))
    .map((e, i) => ({
      at: fmtDate(e.at, true),
      kind: e.kind,
      actor: e.actor,
      summary: trunc(e.summary, 80),
      ref: `IMS.1.${i + 1}`,
    }));

  /* ============================================================ */
  return (
    <PrintShell
      hospital={settings}
      docTitle="Patient File · NABH Audit Register"
      docSubtitle="Compliance-grade register — NABH 6th Edition cross-reference"
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
      {/* 1. PATIENT IDENTIFICATION */}
      <SectionHeading title="Patient Identification" nabh="AAC.1" />
      <FieldTable rows={identificationRows} />

      {/* 2. ADMISSION DETAILS */}
      <SectionHeading title="Admission Details" nabh="AAC.4" />
      <FieldTable rows={admissionRows} />

      {/* 3. ALLERGIES & SAFETY ALERTS */}
      {allergyRows.length > 0 && (
        <>
          <SectionHeading title="Allergies & Safety Alerts" nabh="PSQ.1" />
          <FieldTable rows={allergyRows} />
        </>
      )}

      {/* 4. INITIAL ASSESSMENT — DOCTOR */}
      {iaDoctorRows.length > 0 && (
        <>
          <SectionHeading title="Initial Assessment — Doctor" nabh="AAC.4 · AAC.5" />
          <FieldTable rows={iaDoctorRows} refPrefix="AAC.4" />
        </>
      )}

      {/* 5. INITIAL ASSESSMENT — NURSING */}
      {iaNursingRows.length > 0 && (
        <>
          <SectionHeading title="Initial Assessment — Nursing" nabh="AAC.5 · COP.2" />
          <FieldTable rows={iaNursingRows} refPrefix="AAC.5" />
        </>
      )}

      {/* 6. VITALS ON ADMISSION */}
      {vitalsRows.length > 0 && (
        <>
          <SectionHeading title="Vitals on Admission" nabh="COP.2" />
          <FieldTable rows={vitalsRows} />
        </>
      )}

      {/* 7. INVESTIGATIONS & REPORTS */}
      {invRows.length > 0 && (
        <>
          <SectionHeading title="Investigations & Reports" nabh="COP.5" />
          <MultiTable
            columns={[
              { key: "name",     label: "Test",     width: "20%" },
              { key: "ordered",  label: "Ordered",  width: "18%" },
              { key: "reported", label: "Reported", width: "18%" },
              { key: "result",   label: "Result",   width: "32%", wrap: true },
              { key: "ref",      label: "NABH-Ref", width: "12%", align: "center" },
            ]}
            rows={invRows}
          />
        </>
      )}

      {/* 8. DOCTOR ORDERS & NOTES */}
      {drNoteRows.length > 0 && (
        <>
          <SectionHeading title="Doctor Orders & Notes" nabh="COP.7" />
          <MultiTable
            columns={[
              { key: "at",       label: "Date / Time", width: "18%" },
              { key: "noteType", label: "Note Type",   width: "18%" },
              { key: "doctor",   label: "Doctor",      width: "18%" },
              { key: "content",  label: "Content",     width: "34%", wrap: true },
              { key: "ref",      label: "NABH-Ref",    width: "12%", align: "center" },
            ]}
            rows={drNoteRows}
          />
        </>
      )}

      {/* 9. NURSING NOTES */}
      {nrNoteRows.length > 0 && (
        <>
          <SectionHeading title="Nursing Notes" nabh="COP.2" />
          <MultiTable
            columns={[
              { key: "at",      label: "Date / Time", width: "18%" },
              { key: "shift",   label: "Shift",       width: "12%" },
              { key: "nurse",   label: "Nurse",       width: "18%" },
              { key: "content", label: "Note",        width: "40%", wrap: true },
              { key: "ref",     label: "NABH-Ref",    width: "12%", align: "center" },
            ]}
            rows={nrNoteRows}
          />
        </>
      )}

      {/* 10. MEDICATION ADMINISTRATION RECORD */}
      {medRows.length > 0 && (
        <>
          <SectionHeading title="Medication Administration Record" nabh="MOM.4" />
          <MultiTable
            columns={[
              { key: "drug",       label: "Drug",       width: "18%" },
              { key: "dose",       label: "Dose",       width: "10%" },
              { key: "route",      label: "Route",      width: "8%",  align: "center" },
              { key: "frequency",  label: "Frequency",  width: "12%" },
              { key: "start",      label: "Start",      width: "12%" },
              { key: "end",        label: "End",        width: "12%" },
              { key: "indication", label: "Indication", width: "16%", wrap: true },
              { key: "ref",        label: "NABH-Ref",   width: "12%", align: "center" },
            ]}
            rows={medRows}
          />
        </>
      )}

      {/* 11. PROCEDURES */}
      {procRows.length > 0 && (
        <>
          <SectionHeading title="Procedures" nabh="COP.16" />
          <MultiTable
            columns={[
              { key: "date",         label: "Date",         width: "16%" },
              { key: "procedure",    label: "Procedure",    width: "20%" },
              { key: "surgeon",      label: "Surgeon",      width: "16%" },
              { key: "anaesthetist", label: "Anaesthetist", width: "14%" },
              { key: "findings",     label: "Findings",     width: "22%", wrap: true },
              { key: "ref",          label: "NABH-Ref",     width: "12%", align: "center" },
            ]}
            rows={procRows}
          />
        </>
      )}

      {/* 12. CONSENT FORMS — R7hr(re-audit C3): suppress this compact
          register when the full Consent Records appendix (DOCS-FULL) will
          render the same consents, so they don't print twice. */}
      {consentRows.length > 0 && !(f.consents || []).some((c) => c.full) && (
        <>
          <SectionHeading title="Consent Forms" nabh="PRE.4" />
          <MultiTable
            columns={[
              { key: "form",     label: "Form",      width: "28%" },
              { key: "signed",   label: "Signed",    width: "10%", align: "center" },
              { key: "signedBy", label: "Signed By", width: "18%" },
              { key: "witness",  label: "Witness",   width: "18%" },
              { key: "signedAt", label: "Signed At", width: "14%" },
              { key: "ref",      label: "NABH-Ref",  width: "12%", align: "center" },
            ]}
            rows={consentRows}
          />
        </>
      )}

      {/* 13. DISCHARGE SUMMARY — R7hr(re-audit C3): suppress this compact
          digest when the full Discharge Summary appendix (DOCS-FULL) rides,
          so the discharge doesn't print twice. */}
      {hasDischarge && !f.discharge?.full && (
        <>
          <SectionHeading title="Discharge Summary" nabh="AAC.7" />
          <FieldTable rows={dischargeRows} />
        </>
      )}

      {/* 14. AUDIT TRAIL OF SIGNIFICANT EVENTS */}
      {auditEventRows.length > 0 && (
        <>
          <SectionHeading title="Audit Trail of Significant Events" nabh="IMS.1" />
          <MultiTable
            columns={[
              { key: "at",      label: "Timestamp",  width: "20%" },
              { key: "kind",    label: "Event Kind", width: "18%" },
              { key: "actor",   label: "Actor",      width: "20%" },
              { key: "summary", label: "Summary",    width: "30%", wrap: true },
              { key: "ref",     label: "NABH-Ref",   width: "12%", align: "center" },
            ]}
            rows={auditEventRows}
          />
        </>
      )}

      {/* NABH chapter legend — last block on the last page */}
      <div
        style={{
          marginTop: 16,
          padding: "8px 10px",
          border: "1px solid #cbd5e1",
          background: "#f8fafc",
          fontSize: 8.5,
          lineHeight: 1.45,
          color: "#0f172a",
          pageBreakInside: "avoid",
        }}
      >
        <div
          style={{
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            fontSize: 9,
            marginBottom: 4,
            color: "#0f172a",
          }}
        >
          Legend — NABH 6th Edition chapters referenced
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 18, rowGap: 2 }}>
          <div><b>AAC</b> — Access, Assessment & Continuity of Care</div>
          <div><b>COP</b> — Care of Patients</div>
          <div><b>MOM</b> — Management of Medications</div>
          <div><b>PRE</b> — Patient Rights & Education</div>
          <div><b>PSQ</b> — Patient Safety & Quality Improvement</div>
          <div><b>IMS</b> — Information Management System</div>
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 8,
            color: "#64748b",
            fontStyle: "italic",
          }}
        >
          This register is generated from the electronic patient file and
          retained per Medical Records Retention Policy (IMS.4). Inspector
          may cross-reference each row against the cited NABH chapter.
        </div>
      </div>
      <SharedRegisterSections file={file} />
      <SharedFormalDocSections file={file} />
    </PrintShell>
  );
};

export default AuditTheme;
