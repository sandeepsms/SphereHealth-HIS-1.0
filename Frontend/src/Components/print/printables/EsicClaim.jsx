// Components/print/printables/EsicClaim.jsx
// R7hr(CLAIM-P2) — ESIC medical reimbursement claim for insured persons.
// Auto-filled from claim-data + patient.schemeIds (IP no, employer,
// dispensary). Attested by the ESIC medical officer (manual).
import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";

const fmtD = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const Row = ({ label, value, blank }) => (
  <div style={{ display: "flex", fontSize: 11, marginBottom: 4 }}>
    <div style={{ width: 195, color: "#64748b", fontWeight: 600 }}>{label}</div>
    <div style={{ flex: 1, fontWeight: 600, color: blank ? "#cbd5e1" : "#0f172a", borderBottom: blank ? "1px dashed #cbd5e1" : "none", minHeight: blank ? 15 : "auto" }}>{blank ? "" : (value || "—")}</div>
  </div>
);

const EsicClaim = ({ settings, receipt = {} }) => {
  const p = receipt.patient || {};
  const a = receipt.admission || {};
  const s = p.schemeIds || {};
  return (
    <PrintShell
      settings={settings}
      documentTitle="ESIC — Claim for Reimbursement of Medical Expenses"
      serialNo={a.admissionNumber}
      infoItems={[
        { label: "Insured Person", value: p.name },
        { label: "ESIC IP No", value: s.esicIpNo },
        { label: "Employer", value: s.esicEmployer },
        { label: "Dispensary", value: s.esicDispensary },
      ]}
      signatureLabels={["Signature of Insured Person", "ESIC Medical Officer (seal)"]}
    >
      <div className="pr-section">
        <div className="pr-section__title">Insured Person</div>
        <div className="pr-section__body">
          <Row label="Name" value={p.name} />
          <Row label="ESIC Insurance (IP) No" value={s.esicIpNo} />
          <Row label="Employer / Establishment" value={s.esicEmployer} />
          <Row label="Dispensary / Branch Office" value={s.esicDispensary} />
          <Row label="Patient (if dependant)" value={p.name} />
          <Row label="Relationship to IP" blank />
          <Row label="Address" value={p.address} />
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Treatment & Amount</div>
        <div className="pr-section__body">
          <Row label="Hospital / ESIC tie-up" value={receipt.hospital?.name} />
          <Row label="Date of Admission" value={fmtD(a.admissionDate)} />
          <Row label="Date of Discharge" value={fmtD(a.dischargeDate)} />
          <Row label="Diagnosis / Treatment" value={a.finalDiagnosis} />
          <Row label="Referred by ESIC MO" blank />
          <Row label="Total Amount Claimed (₹)" value={fmtINR(receipt.totals?.net)} />
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Bank Details</div>
        <div className="pr-section__body">
          <Row label="Account Holder" blank /><Row label="Bank & Branch" blank />
          <Row label="Account No" blank /><Row label="IFSC" blank />
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Enclosures</div>
        <div className="pr-section__body" style={{ fontSize: 10.5 }}>
          {(receipt.docsChecklist || []).map((d, i) => <span key={i} style={{ display: "inline-block", marginRight: 14 }}>☐ {d}</span>)}
        </div>
      </div>
    </PrintShell>
  );
};

export default EsicClaim;
