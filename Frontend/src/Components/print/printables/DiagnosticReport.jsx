// Components/print/printables/DiagnosticReport.jsx
// R7hr(LAB-P1) — NABH AAC.3-compliant NARRATIVE diagnostic report for the
// in-house reporting the lab desk transcribes: radiology & imaging
// (X-ray / USG / CT / MRI / mammography / bone densitometry), microbiology
// (culture + sensitivity), histopathology, cytology, ECG / echo, PFT and
// endoscopy. Tabular quantitative lab panels use the sibling `lab-report`
// (NABL) template; this one carries prose findings + impression + the
// reporting consultant's sign-off (name, registration, qualifications).
//
// Fed from a LabReport doc (models/Clinical/labRecordsModels.js) via the
// adapter in LabResultsEntry. Registered in printables/index.js under slug
// "diagnostic-report".
import React from "react";
import PrintShell from "../PrintShell";

const fmtDate = (d, withTime = false) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", withTime
      ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short", year: "numeric" });
  } catch { return String(d); }
};

// reportType → human report title + modality label.
const TYPE_META = {
  "imaging-xray":  { title: "Radiology & Imaging Report",   modality: "X-Ray",                     kind: "imaging" },
  "imaging-usg":   { title: "Ultrasonography Report",       modality: "Ultrasonography (USG)",     kind: "imaging" },
  "imaging-ct":    { title: "CT Scan Report",               modality: "Computed Tomography (CT)",  kind: "imaging" },
  "imaging-mri":   { title: "MRI Report",                   modality: "Magnetic Resonance Imaging",kind: "imaging" },
  "imaging-mammo": { title: "Mammography Report",           modality: "Mammography",               kind: "imaging" },
  "imaging-bmd":   { title: "Bone Densitometry Report",     modality: "DEXA / Bone Densitometry",  kind: "imaging" },
  "imaging-other": { title: "Imaging Report",               modality: "Imaging",                   kind: "imaging" },
  "microbiology":  { title: "Microbiology Report",          modality: "Culture & Sensitivity",     kind: "micro" },
  "histopath":     { title: "Histopathology Report",        modality: "Histopathology",            kind: "path" },
  "cytology":      { title: "Cytology Report",              modality: "Cytology",                  kind: "path" },
  "ecg":           { title: "Electrocardiography (ECG) Report", modality: "ECG",                   kind: "cardiac" },
  "echo":          { title: "Echocardiography Report",      modality: "2D Echo / Doppler",         kind: "cardiac" },
  "pft":           { title: "Pulmonary Function Test Report", modality: "Spirometry / PFT",        kind: "other" },
  "endoscopy":     { title: "Endoscopy Report",             modality: "Endoscopy",                 kind: "other" },
  "other":         { title: "Diagnostic Report",            modality: "Diagnostic Study",          kind: "other" },
};

const Sec = ({ title, children, emphasize }) => (
  <div className="pr-section" style={emphasize ? { background: "#f8fafc", borderRadius: 8, padding: "4px 2px" } : undefined}>
    <div className="pr-section__title">{title}</div>
    <div className="pr-section__body" style={{ whiteSpace: "pre-wrap", fontWeight: emphasize ? 700 : 400, fontSize: emphasize ? 13.5 : 13 }}>
      {children}
    </div>
  </div>
);

const DiagnosticReport = ({ settings = {}, receipt = {} }) => {
  const r = receipt;
  const meta = TYPE_META[r.reportType] || TYPE_META.other;
  const isMicro = meta.kind === "micro";
  const isPath  = meta.kind === "path";
  const isImaging = meta.kind === "imaging";

  const verifierName = r.verifiedByName || r.reportedByName || r.consultantName || "—";
  const verifierReg  = r.verifiedByReg || r.verifiedByDmc || r.doctorReg || "";
  const roleLabel = isImaging ? "Consultant Radiologist"
    : (isMicro || isPath) ? "Consultant Pathologist"
    : meta.kind === "cardiac" ? "Consultant Cardiologist"
    : "Reporting Consultant";

  return (
    <PrintShell
      settings={settings}
      documentTitle={meta.title}
      serialNo={r.reportNo}
      signatureLabels={["Received By Patient / Attendant", roleLabel]}
      infoItems={[
        { label: "Patient",      value: r.patientName },
        { label: "UHID",         value: r.uhid },
        { label: "Age / Sex",    value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Referring Dr", value: r.referringDoctor },
        { label: "Modality",     value: meta.modality },
        { label: "Study",        value: r.testName },
        { label: isImaging ? "Region" : "Specimen", value: r.bodyPart || r.specimen },
        { label: "Report Date",  value: fmtDate(r.reportDate || new Date()) },
        { label: "Status",       value: r.status || "Final" },
      ]}
    >
      <div className="pr-diagnostic-report">
        {r.clinicalDetails && <Sec title="Clinical Details / Indication">{r.clinicalDetails}</Sec>}

        {/* Micro: specimen + organism + sensitivity */}
        {isMicro && (
          <>
            <div className="pr-section">
              <div className="pr-section__title">Specimen &amp; Isolate</div>
              <div className="pr-section__body" style={{ fontSize: 13 }}>
                <div><strong>Specimen / Source:</strong> {r.specimen || "—"}</div>
                <div style={{ marginTop: 3 }}><strong>Organism isolated:</strong>{" "}
                  <span style={{ fontWeight: 800, color: r.organism && !/no growth/i.test(r.organism) ? "#7f1d1d" : "#15803d" }}>
                    {r.organism || "No growth"}
                  </span>
                </div>
              </div>
            </div>
            {r.sensitivity && (
              <div className="pr-section">
                <div className="pr-section__title">Antibiotic Sensitivity</div>
                <div className="pr-section__body" style={{ whiteSpace: "pre-wrap", fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                  {r.sensitivity}
                </div>
              </div>
            )}
          </>
        )}

        {isPath && r.specimen && <Sec title="Specimen / Gross Description">{r.specimen}</Sec>}

        {r.findings && (
          <Sec title={isImaging ? "Findings" : isPath ? "Microscopic Findings" : isMicro ? "Growth / Microscopy" : "Observations"}>
            {r.findings}
          </Sec>
        )}

        {r.impression && <Sec title="Impression / Diagnosis" emphasize>{r.impression}</Sec>}

        {r.recommendations && <Sec title="Recommendations / Advice">{r.recommendations}</Sec>}

        {/* Reporting consultant sign-off — NABH AAC.3 */}
        <div className="pr-section" style={{ marginTop: 16 }}>
          <div className="pr-section__title">Reported By</div>
          <div className="pr-section__body" style={{ fontSize: 12 }}>
            <div style={{ fontWeight: 800, color: "#0f172a" }}>
              {verifierName}
              {verifierReg && <span style={{ fontWeight: 700, color: "#475569" }}>, Reg. {verifierReg}</span>}
              <span style={{ fontWeight: 600, color: "#64748b" }}> · {roleLabel}</span>
            </div>
            {r.qualifications && <div style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>{r.qualifications}</div>}
            {r.verifiedAt && <div style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>Reported at: {fmtDate(r.verifiedAt, true)}</div>}
          </div>
        </div>

        <div style={{
          marginTop: 10, padding: "8px 12px", borderRadius: 6,
          background: "#f8fafc", border: "1px solid #e2e8f0",
          fontSize: 10.5, color: "#475569", fontStyle: "italic",
        }}>
          This report is a professional interpretation of the {isImaging ? "images" : "specimen / study"} described and must be
          correlated clinically and with prior studies. It is not valid for medico-legal purposes unless counter-signed.
          Critical findings are communicated per the hospital&apos;s critical-value notification policy (NABH AAC.6).
        </div>
      </div>
    </PrintShell>
  );
};

export default DiagnosticReport;
