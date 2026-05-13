// Components/print/printables/MedicalCertificate.jsx
// Medical certificate — fitness / sickness / leave / disability.
// Half-A4 friendly. Issued by the treating doctor; carries the doctor's
// MCI registration and signature for legal validity.

import React from "react";
import PrintShell from "../PrintShell";

const CERT_TEXT = {
  sickness: (d) =>
    `This is to certify that ${d.patientName || "the patient"} (${d.age || "—"}Y / ${d.gender || "—"}, UHID ${d.uhid || "—"}) ` +
    `was under my care for ${d.diagnosis || "the condition mentioned below"} and was advised rest from ` +
    `${d.fromDate ? new Date(d.fromDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"} ` +
    `to ${d.toDate ? new Date(d.toDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"} ` +
    `(${d.days || "—"} day${d.days === 1 ? "" : "s"}).`,
  fitness: (d) =>
    `This is to certify that ${d.patientName || "the patient"} (${d.age || "—"}Y / ${d.gender || "—"}, UHID ${d.uhid || "—"}) ` +
    `has been examined by me and is found medically fit ${d.fitnessPurpose ? `for ${d.fitnessPurpose}` : "for normal duties"} ` +
    `as on ${d.examDate ? new Date(d.examDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
      : new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}.`,
  leave: (d) =>
    `This is to certify that ${d.patientName || "the patient"} (${d.age || "—"}Y / ${d.gender || "—"}, UHID ${d.uhid || "—"}) ` +
    `was admitted under my care from ${d.fromDate ? new Date(d.fromDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"} ` +
    `to ${d.toDate ? new Date(d.toDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"} ` +
    `for ${d.diagnosis || "treatment"} and requires further rest of ${d.restDays || "—"} day(s) post-discharge.`,
  disability: (d) =>
    `This is to certify that ${d.patientName || "the patient"} (${d.age || "—"}Y / ${d.gender || "—"}, UHID ${d.uhid || "—"}) ` +
    `is suffering from ${d.diagnosis || "the condition specified below"} and has a permanent disability of ${d.disabilityPct || "—"}% ` +
    `as assessed on ${d.examDate ? new Date(d.examDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}.`,
};

const CERT_TITLE = {
  sickness:   "Medical Sickness Certificate",
  fitness:    "Medical Fitness Certificate",
  leave:      "Medical Leave Certificate",
  disability: "Medical Disability Certificate",
};

const MedicalCertificate = ({ settings, receipt = {} }) => {
  const r = receipt;
  const kind = r.certType || "sickness";
  const text = (CERT_TEXT[kind] || CERT_TEXT.sickness)(r);

  return (
    <PrintShell
      settings={settings}
      documentTitle={CERT_TITLE[kind] || "Medical Certificate"}
      serialNo={r.certNo}
      infoItems={[
        { label: "Patient",      value: r.patientName },
        { label: "UHID",         value: r.uhid },
        { label: "Age / Sex",    value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Issued On",    value: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) },
        { label: "Treating Doctor", value: r.doctorName },
        { label: "Reg. No",      value: r.doctorReg },
      ]}
      signatureLabels={["Doctor's Stamp & Signature", "—"]}
    >
      {/* Certificate body — formal letter style */}
      <div style={{
        background: "white", border: "1px solid #e2e8f0", borderRadius: 8,
        padding: "18px 22px", marginBottom: 14,
        fontSize: 12, lineHeight: 1.7,
      }}>
        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 800,
          textTransform: "uppercase", letterSpacing: ".5px",
          color: "var(--pr-accent-color, #1d4ed8)", marginBottom: 14,
          paddingBottom: 8, borderBottom: "2px solid currentColor",
        }}>
          {CERT_TITLE[kind] || "Medical Certificate"}
        </div>

        <p style={{ margin: "0 0 12px" }}>To Whom It May Concern,</p>

        <p style={{ margin: "0 0 12px", textAlign: "justify" }}>{text}</p>

        {r.diagnosis && (
          <p style={{ margin: "0 0 12px" }}>
            <strong>Diagnosis:</strong> {r.diagnosis}
            {r.icd10 && <span className="muted"> · ICD-10: {r.icd10}</span>}
          </p>
        )}

        {r.treatment && (
          <p style={{ margin: "0 0 12px" }}>
            <strong>Treatment:</strong> {r.treatment}
          </p>
        )}

        {r.remarks && (
          <p style={{ margin: "0 0 12px", whiteSpace: "pre-wrap" }}>
            <strong>Remarks:</strong> {r.remarks}
          </p>
        )}

        {kind === "sickness" && (
          <p style={{ margin: "0 0 12px", fontStyle: "italic" }}>
            The patient is hereby advised rest and is expected to resume normal duties on or after
            <strong> {r.resumeDate ? new Date(r.resumeDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</strong>,
            subject to clinical improvement.
          </p>
        )}

        <p style={{ margin: "16px 0 0" }}>
          This certificate is issued on the request of the patient / attendant for the purpose of
          <strong> {r.purpose || "official records"}</strong>.
        </p>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Verification</div>
        <div className="pr-section__body" style={{ fontSize: 10.5 }}>
          This certificate carries the seal &amp; signature of the issuing doctor. Verification of its authenticity
          may be obtained from the hospital records department by quoting the certificate number printed above.
        </div>
      </div>
    </PrintShell>
  );
};

export default MedicalCertificate;
