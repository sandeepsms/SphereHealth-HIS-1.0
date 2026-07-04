// Components/print/printables/CompleteIPDFile.jsx
//
// R7ft — Theme router. Picks 1 of 5 patient-file themes based on
// `settings.patientFilePrintTheme` (or the explicit `?theme=` URL
// override used by the print gallery). All themes consume the same
// canonical shape produced by normalizeFileData() — switching
// themes is render-only, never a data-fetch difference.
//
//   narrative  → Narrative Letter (Apollo/Fortis discharge prose)
//   timeline   → Chronological Journal (day-diary feed)
//   executive  → Executive Brief (Max/Tirath 2-col dense)
//   audit      → NABH Audit Table (inspector tabular)
//   editorial  → Editorial Magazine (glossy VIP)
//
// Pre-R7ft: 350 LoC of chip-style sections in this file. The
// old layout is preserved as the fallback when settings hasn't
// got a valid theme picked (e.g. fresh install, model upgrade in
// flight) — see "fallback" branch below.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";
import {
  normalizeFileData,
  buildChronologicalEvents,
  fmtDate,
} from "./patientFileThemes/normalizeData";
import NarrativeTheme from "./patientFileThemes/Narrative";
import TimelineTheme  from "./patientFileThemes/Timeline";
import ExecutiveTheme from "./patientFileThemes/Executive";
import AuditTheme     from "./patientFileThemes/Audit";
import EditorialTheme from "./patientFileThemes/Editorial";
import AuditAppendix  from "./patientFileThemes/AuditAppendix";

/* ── R7hr — Print Center section filtering ─────────────────────────
   The Print Center dialog on CompletePatientFilePage passes
   `receipt.printSections` (array of section keys). We strip the
   EXCLUDED sections' canonical fields here — every theme already
   collapses empty sections, so one data-level filter covers all 5
   themes with zero per-theme edits. Absent/empty printSections
   (old payloads, demo mode, gallery) ⇒ print everything.          */
const SECTION_FIELDS = {
  initialAssessment: ["ia", "chiefComplaints", "history", "medicalHistory", "surgicalHistory", "familyHistory", "socialHistory", "generalExamination", "systemicExamination", "vitalsOnAdmission", "patientExtra"],
  opdAssessments:    ["opdAssessments"],
  devices:           ["devices"],
  doctorNotes:       ["doctorNotes"],
  nursingNotes:      ["nursingNotes", "nursingAssessments", "nursingCarePlans"],
  treatmentChart:    ["doctorOrders", "mar", "medications"],
  vitals:            ["vitalsTrend", "intakeOutput"],
  investigations:    ["investigations", "labReports", "labTrends"],
  procedures:        ["procedures"],
  consents:          ["consents"],
  diet:              ["dietPlans"],
  transfusion:       ["bloodTransfusion"],
  mlc:               ["mlc"],
  handovers:         ["shiftHandovers", "bedTransfers"],
  discharge:         ["discharge", "dischargeSummary", "dischargeAdvice", "dischargeMedications"],
  billing:           ["bills"],
  activityLog:       ["activityLog"],
  // R7ht — the full-coverage records + NABH safety registers. Previously in
  // NO section, so an unticked / audit-only / single-preset print still leaked
  // them (pharmacy sales, advances, ADR, restraint/mortality/LAMA registers…).
  // Governed by one "coverageRecords" section (checkbox in PF_PRINT_SECTIONS).
  // Keep this key list in sync with PF_EXTRA_COLLECTIONS in CompletePatientFilePage.
  coverageRecords:   ["emergencyCases", "prescriptions", "medicalCertificates",
                      "physioPlans", "physioSessions", "medReconciliation", "diabeticCharts",
                      "pharmacySales", "advances", "appointments", "procedureNotes",
                      "adrReports", "foodReactions", "promPremSurveys", "codeResponseEvents",
                      "complianceRegisters"],
  // `timeline` (section 21) is handled via the events array below.
};
export const PRINT_SECTION_KEYS = [...Object.keys(SECTION_FIELDS), "timeline"];

function filterFileBySections(file, printSections) {
  // null/undefined ⇒ old payload / demo ⇒ print everything.
  // [] (nothing ticked) ⇒ strip ALL sections (audit-only print keeps just
  // the identity header + appendix).
  if (!Array.isArray(printSections)) return file;
  const keep = new Set(printSections);
  const out = { ...file };
  Object.entries(SECTION_FIELDS).forEach(([key, fields]) => {
    if (keep.has(key)) return;
    fields.forEach((f) => {
      if (!(f in out)) return;
      const v = out[f];
      if (Array.isArray(v)) out[f] = [];
      else if (v && typeof v === "object") out[f] = {};
      else out[f] = "";
    });
  });
  return out;
}

const THEMES = {
  narrative: NarrativeTheme,
  timeline:  TimelineTheme,
  executive: ExecutiveTheme,
  audit:     AuditTheme,
  editorial: EditorialTheme,
};

const VALID_THEMES = Object.keys(THEMES);

// Resolve a theme override from the popup URL. Two channels:
//   (a) ?theme=<key>            — explicit query-string override
//   (b) /print/ipd-file-<key>   — slug-suffix override (gallery cards)
// Either lets the print gallery compare themes without touching the
// admin's settings.patientFilePrintTheme. Empty string ⇒ honour the
// settings field.
const themeFromUrl = () => {
  if (typeof window === "undefined") return "";
  try {
    const p = new URLSearchParams(window.location.search);
    const q = String(p.get("theme") || "").toLowerCase();
    if (VALID_THEMES.includes(q)) return q;
    const path = String(window.location.pathname || "").toLowerCase();
    const m = path.match(/\/print\/ipd-file-([a-z]+)\b/);
    if (m && VALID_THEMES.includes(m[1])) return m[1];
    return "";
  } catch { return ""; }
};

const CompleteIPDFile = ({ settings = {}, receipt = {} }) => {
  const urlTheme = themeFromUrl();
  const themeKey = urlTheme || settings.patientFilePrintTheme || "narrative";
  const Theme = THEMES[themeKey] || NarrativeTheme;

  // Normalize once, pass to theme. Themes never touch raw `receipt`
  // unless they need a field we don't yet model — in which case the
  // contract is to ADD it to normalizeFileData(), not bypass it.
  // R7hr — Print Center: strip un-ticked sections at the DATA level so
  // every theme (they all collapse empty sections) honours the picker.
  const printSections = Array.isArray(receipt?.printSections) ? receipt.printSections : null;
  const file = filterFileBySections(normalizeFileData(receipt), printSections);
  const events =
    printSections && !printSections.includes("timeline")
      ? []
      : buildChronologicalEvents(file);

  /* R7gb P0-12 — viewer role propagation. CompletePatientFilePage
     stuffs the authenticated user's RBAC role into the receipt
     (`receipt.viewerRole`) before openPrint(). Themes use this for
     defence-in-depth gating on PHI-heavy sections like Activity Log.
     Defaults to "" so demo / pop-up flows without a logged-in user
     see a minimal, PHI-safe print. */
  const viewerRole = String(receipt?.viewerRole || "").toLowerCase();

  return (
    <>
      <Theme
        settings={settings}
        receipt={receipt}   // still passed for backward-compat / niche fields
        file={file}
        events={events}
        viewerRole={viewerRole}
      />
      {/* R7hr — audit-logs print option. Rendered AFTER the theme body so
          every theme gets the same appendix without per-theme edits. Only
          present when the Print Center attached an auditBundle (fetched
          from /patient-file/:uhid/audit-bundle, Admin/MRD-gated). */}
      {receipt?.auditBundle && (
        <AuditAppendix
          bundle={receipt.auditBundle}
          selections={receipt.auditSelections}
          patient={{ name: file?.patientName || receipt.patientName, uhid: file?.uhid || receipt.uhid, ipdNo: file?.ipdNo || receipt.ipdNo }}
          viewerRole={viewerRole}
        />
      )}
    </>
  );
};

export default CompleteIPDFile;

/* ── Named export: legacy fallback ────────────────────────────
   If admin hasn't picked a theme AND the new themes haven't been
   built yet, this old chip-grid layout is what they get. Kept
   intentionally as a safety net during R7ft Phase 2 rollout.
   Same export shape as the original pre-R7ft component.        */
export const CompleteIPDFileLegacy = ({ settings, receipt = {} }) => {
  const r = receipt;
  const investigations = Array.isArray(r.investigations) ? r.investigations : [];
  const medications    = Array.isArray(r.medications)    ? r.medications    : [];
  const doctorNotes    = Array.isArray(r.doctorNotes)    ? r.doctorNotes    : [];
  const nursingNotes   = Array.isArray(r.nursingNotes)   ? r.nursingNotes   : [];
  const procedures     = Array.isArray(r.procedures)     ? r.procedures     : [];
  const consents       = Array.isArray(r.consents)       ? r.consents       : [];
  const vitalsOnAdm    = r.vitalsOnAdmission || {};
  const printCount     = toNum(r.printCount);

  const KV = ({ label, value }) => value ? (
    <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 4, fontSize: 11, padding: "2px 0" }}>
      <span style={{ color: "#64748b", fontWeight: 700 }}>{label}</span>
      <span style={{ color: "#0f172a" }}>{value}</span>
    </div>
  ) : null;

  return (
    <PrintShell
      settings={settings}
      documentTitle="Complete IPD File"
      serialNo={r.ipdNo}
      printCount={printCount}
      infoItems={[
        { label: "Patient",     value: r.patientName },
        { label: "UHID",        value: r.uhid },
        { label: "IPD No",      value: r.ipdNo },
        { label: "Age / Sex",   value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Admitted",    value: fmtDate(r.admissionDate, true) },
        { label: "Discharged",  value: fmtDate(r.dischargeDate, true) },
        { label: "Consultant",  value: r.consultantName },
        { label: "Bed / Ward",  value: [r.bedNumber, r.wardName].filter(Boolean).join(" · ") },
      ]}
      signatureLabels={["Consultant", "Medical Records Officer"]}
    >
      <div className="pr-section">
        <div className="pr-section__title">Legacy fallback</div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          The 5-theme print system (R7ft) is selected on Hospital
          Settings → Print → "Patient-file theme". Pre-R7ft layout
          rendered here as a safety net.
        </div>
      </div>
      {/* Minimal legacy content for graceful degradation */}
      {vitalsOnAdm.bp && <KV label="BP on admission" value={vitalsOnAdm.bp} />}
      {investigations.length > 0 && <KV label="Investigations" value={`${investigations.length} ordered`} />}
      {doctorNotes.length > 0 && <KV label="Doctor notes" value={`${doctorNotes.length} entries`} />}
      {nursingNotes.length > 0 && <KV label="Nursing notes" value={`${nursingNotes.length} entries`} />}
      {medications.length > 0 && <KV label="Medications" value={`${medications.length} drugs`} />}
      {procedures.length > 0 && <KV label="Procedures" value={`${procedures.length} performed`} />}
      {consents.length > 0 && <KV label="Consents" value={`${consents.length} forms`} />}
    </PrintShell>
  );
};
