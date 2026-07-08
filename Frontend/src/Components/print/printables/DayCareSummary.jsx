// Components/print/printables/DayCareSummary.jsx
// R7hr(DC-P2) — Day Care discharge summary variant: procedure, pre-procedure
// safety checklist state, the Aldrete-style readiness breakdown (objective
// fit-for-discharge evidence), and home advice. Printed from the Day Care
// board for READY patients.
import React from "react";
import PrintShell from "../PrintShell";

const fmtDT = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const CRIT = [["consciousness", "Consciousness"], ["oxygenation", "SpO₂ / breathing"], ["ambulation", "Ambulation"], ["pain", "Pain control"], ["bleeding", "Surgical site / bleeding"]];

const DayCareSummary = ({ settings, receipt = {} }) => {
  const cl = receipt.checklist || {};
  const r  = receipt.readiness || {};
  const clItems = [
    ["consentVerified", "Consent verified"], ["npoConfirmed", "NPO confirmed"],
    ["siteMarked", "Site marked"], ["highRiskMedsReviewed", "High-risk meds reviewed"],
  ];
  return (
    <PrintShell
      settings={settings}
      documentTitle="Day Care Discharge Summary"
      serialNo={receipt.admissionNumber}
      infoItems={[
        { label: "Patient",    value: receipt.patientName },
        { label: "UHID",       value: receipt.uhid },
        { label: "Age / Sex",  value: [receipt.age && `${receipt.age}Y`, receipt.gender].filter(Boolean).join(" / ") },
        { label: "Procedure",  value: receipt.procedure },
        { label: "Doctor",     value: receipt.doctor },
        { label: "Admitted",   value: fmtDT(receipt.admittedAt) },
        { label: "Discharged", value: fmtDT(receipt.dischargedAt || new Date()) },
      ]}
      signatureLabels={["Attending Doctor", "Patient / Attendant"]}
    >
      <div className="pr-section">
        <div className="pr-section__title">Pre-procedure Safety Checklist</div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          {clItems.map(([k, label]) => <span key={k} style={{ marginRight: 14 }}>{cl[k] ? "☑" : "☐"} {label}</span>)}
          {cl.completedBy && <div style={{ color: "#64748b", marginTop: 3 }}>Completed by {cl.completedBy}{cl.completedAt ? ` · ${fmtDT(cl.completedAt)}` : ""}</div>}
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Discharge Readiness (Aldrete-style)</div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          {CRIT.map(([k, label]) => <span key={k} style={{ marginRight: 14 }}>{label}: <strong>{r[k] ?? "—"}/2</strong></span>)}
          <div style={{ marginTop: 5, fontWeight: 800, color: (r.total ?? 0) >= 9 ? "#166534" : "#854d0e" }}>
            Total: {r.total ?? "—"}/10 {(r.total ?? 0) >= 9 ? "— fit for same-day discharge ✅" : ""}
          </div>
          {r.recordedBy && <div style={{ color: "#64748b" }}>Scored by {r.recordedBy}{r.recordedAt ? ` · ${fmtDT(r.recordedAt)}` : ""}</div>}
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Home Advice & Follow-up</div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          {receipt.advice || "Rest today; resume normal diet unless advised otherwise; take prescribed medicines; keep the procedure site clean and dry; review in OPD as advised."}
        </div>
      </div>

      <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", fontSize: 10.5, color: "#7f1d1d" }}>
        <strong>Return / call immediately if:</strong> increasing pain, bleeding or discharge from the site,
        fever, vomiting, breathlessness, or drowsiness that worsens.
      </div>
    </PrintShell>
  );
};

export default DayCareSummary;
