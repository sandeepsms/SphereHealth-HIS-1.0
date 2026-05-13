// Components/print/printables/ReferralLetter.jsx
// Outgoing referral letter — referring our patient to another
// specialist / hospital / facility. Formal letter format on A4.

import React from "react";
import PrintShell from "../PrintShell";

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const ReferralLetter = ({ settings, receipt = {} }) => {
  const r = receipt;
  return (
    <PrintShell
      settings={settings}
      documentTitle="Referral Letter"
      serialNo={r.referralNo}
      infoItems={[
        { label: "Patient",    value: r.patientName },
        { label: "UHID",       value: r.uhid },
        { label: "Age / Sex",  value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Mobile",     value: r.mobile },
        { label: "Date",       value: fmtDate(r.date || new Date()) },
      ]}
      signatureLabels={["Referring Doctor", "—"]}
    >
      <div style={{
        background: "white", border: "1px solid #e2e8f0", borderRadius: 8,
        padding: "18px 22px", fontSize: 12, lineHeight: 1.65,
      }}>
        {/* To block */}
        <div style={{ marginBottom: 12 }}>
          <strong>To,</strong>
          <div>{r.referToDoctor || "The Consultant"}</div>
          {r.referToSpeciality && <div>{r.referToSpeciality}</div>}
          {r.referToHospital   && <div>{r.referToHospital}</div>}
          {r.referToAddress    && <div className="muted" style={{ fontSize: 11 }}>{r.referToAddress}</div>}
        </div>

        <p style={{ margin: "0 0 8px" }}>
          <strong>Subject:</strong> Referral of patient <strong>{r.patientName}</strong> (UHID {r.uhid}) for
          {" "}<strong>{r.reason || "specialist opinion"}</strong>
        </p>

        <p style={{ margin: "0 0 12px" }}>Respected Doctor,</p>

        <p style={{ margin: "0 0 12px", textAlign: "justify" }}>
          I am referring the above patient to you for further evaluation and management. A brief
          clinical summary is provided below for your kind consideration.
        </p>

        {r.clinicalSummary && (
          <div style={{ margin: "0 0 12px" }}>
            <strong style={{ color: "var(--pr-accent-color, #1d4ed8)" }}>Clinical Summary</strong>
            <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{r.clinicalSummary}</div>
          </div>
        )}

        {r.provisionalDiagnosis && (
          <p style={{ margin: "0 0 8px" }}>
            <strong>Provisional Diagnosis:</strong> {r.provisionalDiagnosis}
          </p>
        )}

        {Array.isArray(r.investigationsDone) && r.investigationsDone.length > 0 && (
          <div style={{ margin: "0 0 12px" }}>
            <strong style={{ color: "var(--pr-accent-color, #1d4ed8)" }}>Investigations Done</strong>
            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
              {r.investigationsDone.map((inv, i) => (
                <li key={i}>{inv.name || inv} {inv.result && <span className="muted">— {inv.result}</span>}</li>
              ))}
            </ul>
          </div>
        )}

        {r.treatmentGiven && (
          <div style={{ margin: "0 0 12px" }}>
            <strong style={{ color: "var(--pr-accent-color, #1d4ed8)" }}>Treatment Given</strong>
            <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{r.treatmentGiven}</div>
          </div>
        )}

        {r.reasonForReferral && (
          <div style={{ margin: "0 0 12px" }}>
            <strong style={{ color: "var(--pr-accent-color, #1d4ed8)" }}>Reason for Referral</strong>
            <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{r.reasonForReferral}</div>
          </div>
        )}

        {r.urgency && (
          <div style={{ margin: "0 0 12px" }}>
            <span style={{
              display: "inline-block",
              padding: "3px 12px",
              borderRadius: 999,
              fontSize: 11, fontWeight: 800, letterSpacing: ".3px",
              background: r.urgency === "Emergency" ? "#fee2e2"
                : r.urgency === "Urgent" ? "#fef3c7"
                : "#dbeafe",
              color: r.urgency === "Emergency" ? "#991b1b"
                : r.urgency === "Urgent" ? "#92400e"
                : "#1e40af",
              border: `1.5px solid currentColor`,
            }}>
              {r.urgency.toUpperCase()} REFERRAL
            </span>
          </div>
        )}

        <p style={{ margin: "20px 0 4px" }}>
          Kindly do the needful and oblige. Patient has been informed about the referral. Looking forward to
          your expert opinion and management.
        </p>

        <p style={{ margin: "16px 0 0" }}>Thanking you,<br />Yours sincerely,</p>

        <div style={{ marginTop: 28 }}>
          <strong>{r.doctorName || "—"}</strong>
          <div className="muted" style={{ fontSize: 11 }}>{r.doctorQualifications || ""}</div>
          {r.doctorReg && <div className="muted" style={{ fontSize: 11 }}>Reg. No: {r.doctorReg}</div>}
          {r.department && <div className="muted" style={{ fontSize: 11 }}>{r.department}</div>}
        </div>
      </div>
    </PrintShell>
  );
};

export default ReferralLetter;
