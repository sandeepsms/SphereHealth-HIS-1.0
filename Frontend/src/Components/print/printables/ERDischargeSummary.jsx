// Components/print/printables/ERDischargeSummary.jsx
// R7hr(ER-P1.2) — ER exit summary. NABH AAC: every emergency patient
// leaving the ER (Discharged / Referred / LAMA) gets a treatment summary —
// what they came with, what was found, what was done, and what to do next.
// Built from the Emergency visit doc (vitals snapshot + vitalsLog trail,
// investigationsOrdered, treatmentGiven) + the disposition form.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDT = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const vitalsLine = (v = {}) =>
  [
    v.bloodPressure && `BP ${v.bloodPressure}`,
    v.pulse && `Pulse ${v.pulse}/min`,
    v.respiratoryRate && `RR ${v.respiratoryRate}/min`,
    v.oxygenSaturation && `SpO₂ ${v.oxygenSaturation}%`,
    v.temperature && `Temp ${v.temperature}°F`,
    (v.painScore != null && v.painScore !== "") && `Pain ${v.painScore}/10`,
    v.glasgowComaScale && `GCS ${v.glasgowComaScale}`,
  ].filter(Boolean).join(" · ") || "—";

const ERDischargeSummary = ({ settings, receipt = {} }) => {
  const meds  = Array.isArray(receipt.medications) ? receipt.medications : [];
  const procs = Array.isArray(receipt.procedures) ? receipt.procedures : [];
  const invs  = Array.isArray(receipt.investigations) ? receipt.investigations : [];

  return (
    <PrintShell
      settings={settings}
      documentTitle="Emergency Treatment Summary"
      serialNo={receipt.erNumber}
      printCount={toNum(receipt.printCount)}
      infoItems={[
        { label: "Patient",     value: receipt.patientName },
        { label: "UHID",        value: receipt.uhid },
        { label: "Age / Sex",   value: [receipt.age && `${receipt.age}Y`, receipt.gender].filter(Boolean).join(" / ") },
        { label: "Arrival",     value: fmtDT(receipt.arrivalDate) },
        { label: "Triage",      value: receipt.triageCategory },
        { label: "Mode",        value: receipt.arrivalMode },
        { label: "Doctor",      value: receipt.consultantIncharge },
        { label: "Disposition", value: receipt.disposition },
        ...(receipt.isMLC ? [{ label: "MLC No.", value: receipt.mlcNumber || "Yes" }] : []),
      ]}
      signatureLabels={["Attending Doctor", "Patient / Attendant"]}
    >
      <div className="pr-section">
        <div className="pr-section__title">Presenting Complaint</div>
        <div className="pr-section__body">{receipt.presentingComplaints || "—"}</div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Vitals</div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          <div><strong>On arrival:</strong> {vitalsLine(receipt.arrivalVitals)}</div>
          {receipt.latestVitals && (
            <div style={{ marginTop: 3 }}>
              <strong>Latest{receipt.latestVitalsAt ? ` (${fmtDT(receipt.latestVitalsAt)})` : ""}:</strong>{" "}
              {vitalsLine(receipt.latestVitals)}
            </div>
          )}
        </div>
      </div>

      {invs.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Investigations Ordered</div>
          <div className="pr-section__body" style={{ fontSize: 11 }}>
            {invs.map((iv, i) => (
              <div key={i}>• {iv.testName}{iv.urgency ? ` (${iv.urgency})` : ""}{iv.result ? ` — ${iv.result}` : iv.status ? ` — ${iv.status}` : ""}</div>
            ))}
          </div>
        </div>
      )}

      {(meds.length > 0 || procs.length > 0) && (
        <div className="pr-section">
          <div className="pr-section__title">Treatment Given in ER</div>
          <div className="pr-section__body" style={{ fontSize: 11 }}>
            {meds.map((m, i) => (
              <div key={`m${i}`}>• {m.medicineName} {m.dosage || ""} {m.route ? `(${m.route})` : ""} {m.givenAt ? `— ${fmtDT(m.givenAt)}` : ""}</div>
            ))}
            {procs.map((p, i) => (
              <div key={`p${i}`}>• {p.procedureName} {p.performedBy ? `— ${p.performedBy}` : ""} {p.performedAt ? `(${fmtDT(p.performedAt)})` : ""}</div>
            ))}
          </div>
        </div>
      )}

      <div className="pr-section">
        <div className="pr-section__title">
          {receipt.disposition === "Referred" ? "Referral Details"
            : receipt.disposition === "Left Against Medical Advice" ? "LAMA Declaration"
            : "Discharge Advice & Follow-up"}
        </div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          {receipt.disposition === "Referred" && (
            <div style={{ marginBottom: 4 }}>
              <strong>Referred to:</strong> {receipt.referredToHospital || "—"}
              {receipt.referralReason && <> · <strong>Reason:</strong> {receipt.referralReason}</>}
            </div>
          )}
          {receipt.disposition === "Left Against Medical Advice" && (
            <div style={{ marginBottom: 4, color: "#7f1d1d" }}>
              Patient/attendant left against medical advice after risks were explained
              {receipt.damaExplainedBy ? ` by ${receipt.damaExplainedBy}` : ""}
              {receipt.damaWitness ? ` (witness: ${receipt.damaWitness})` : ""}.
              {receipt.damaReason && <> Reason: {receipt.damaReason}.</>}
            </div>
          )}
          <div>{receipt.advice || receipt.dispositionNotes || "As advised — review in OPD if symptoms persist or worsen. Return to ER immediately for red-flag symptoms."}</div>
        </div>
      </div>

      <div style={{
        background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8,
        padding: "8px 12px", fontSize: 10.5, color: "#7f1d1d", marginTop: 6,
      }}>
        <strong>Return to Emergency immediately if:</strong> breathlessness, chest pain, uncontrolled bleeding,
        altered consciousness, high fever not settling, or worsening of the presenting complaint.
      </div>
    </PrintShell>
  );
};

export default ERDischargeSummary;
