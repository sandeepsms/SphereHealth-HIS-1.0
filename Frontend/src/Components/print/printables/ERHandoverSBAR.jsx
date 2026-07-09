// Components/print/printables/ERHandoverSBAR.jsx
// R7hr(ER-P2) — ER→ward SBAR handover, auto-composed from the visit doc:
// S = complaint+triage, B = history/allergies, A = latest vitals+treatment,
// R = admit destination + pending items. Printed from the ER board when a
// case is Admitted, handed to the receiving ward nurse (NABH handover).
import React from "react";
import PrintShell from "../PrintShell";

const fmtDT = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const Block = ({ k, title, children }) => (
  <div className="pr-section">
    <div className="pr-section__title">{k} — {title}</div>
    <div className="pr-section__body" style={{ fontSize: 11 }}>{children || "—"}</div>
  </div>
);

const ERHandoverSBAR = ({ settings, receipt = {} }) => {
  const v = receipt.latestVitals || {};
  return (
    <PrintShell
      settings={settings}
      documentTitle="ER → Ward Handover (SBAR)"
      serialNo={receipt.erNumber}
      infoItems={[
        { label: "Patient",   value: receipt.patientName },
        { label: "UHID",      value: receipt.uhid },
        { label: "Age / Sex", value: [receipt.age && `${receipt.age}Y`, receipt.gender].filter(Boolean).join(" / ") },
        { label: "To Ward",   value: receipt.toWard },
        { label: "Bed",       value: receipt.toBed },
        { label: "Handover",  value: fmtDT(new Date()) },
      ]}
      signatureLabels={["ER Nurse / Doctor (giving)", "Ward Nurse (receiving)"]}
    >
      <Block k="S" title="Situation">
        {receipt.presentingComplaints || "—"} · Triage: <strong>{receipt.triageCategory || "—"}</strong> · Arrived {fmtDT(receipt.arrivalDate)}
        {receipt.isMLC ? <span style={{ color: "#7f1d1d" }}> · ⚖ MLC {receipt.mlcNumber || ""}</span> : null}
      </Block>
      <Block k="B" title="Background">
        {[receipt.pastMedicalHistory && `PMH: ${receipt.pastMedicalHistory}`,
          receipt.allergyHistory && `Allergies: ${receipt.allergyHistory}`,
          receipt.currentMedications && `Meds: ${receipt.currentMedications}`]
          .filter(Boolean).join(" · ") || "No significant history recorded"}
      </Block>
      <Block k="A" title="Assessment">
        {[v.bloodPressure && `BP ${v.bloodPressure}`, v.pulse && `Pulse ${v.pulse}`, v.respiratoryRate && `RR ${v.respiratoryRate}`,
          v.oxygenSaturation && `SpO₂ ${v.oxygenSaturation}%`, v.glasgowComaScale && `GCS ${v.glasgowComaScale}`]
          .filter(Boolean).join(" · ") || "Vitals: see chart"}
        {receipt.treatmentSummary ? <div style={{ marginTop: 4 }}>ER treatment: {receipt.treatmentSummary}</div> : null}
        {receipt.provisionalDiagnosis ? <div style={{ marginTop: 4 }}>Impression: <strong>{receipt.provisionalDiagnosis}</strong></div> : null}
      </Block>
      <Block k="R" title="Recommendation">
        Admit to <strong>{receipt.toWard || "ward"}</strong> bed <strong>{receipt.toBed || "—"}</strong> under <strong>{receipt.doctor || "—"}</strong>.
        {receipt.pendingItems ? <div style={{ marginTop: 4 }}>Pending: {receipt.pendingItems}</div> : null}
        <div style={{ marginTop: 4, color: "#64748b" }}>Continue monitoring per ward protocol; escalate red-flag changes to the admitting doctor.</div>
      </Block>
    </PrintShell>
  );
};

export default ERHandoverSBAR;
