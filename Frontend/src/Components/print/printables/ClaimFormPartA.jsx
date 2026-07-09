// Components/print/printables/ClaimFormPartA.jsx
// R7hr(CLAIM-P1.3) — IRDAI standard Claim Form PART A (insured-filled).
// System pre-fills what it knows (patient/policy/admission); fields only
// the patient can supply (occupation, their bank account, out-of-hospital
// bills, declaration signature) are printed as blank boxes to hand-fill.
import React from "react";
import PrintShell from "../PrintShell";
import { dxText, Fill } from "./claimBits";  // R7hr(CLAIM-P3)
import { fmtINR } from "../amountWords";

const fmtD = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const Row = ({ label, value, blank }) => (
  <div style={{ display: "flex", fontSize: 11, marginBottom: 4 }}>
    <div style={{ width: 175, color: "#64748b", fontWeight: 600 }}>{label}</div>
    <div style={{ flex: 1, fontWeight: 600, color: blank ? "#cbd5e1" : "#0f172a", borderBottom: blank ? "1px dashed #cbd5e1" : "none", minHeight: blank ? 15 : "auto" }}>
      {blank ? <Fill value={value} /> : (value || "—")}
    </div>
  </div>
);

const ClaimFormPartA = ({ settings, receipt = {} }) => {
  const p = receipt.patient || {};
  const a = receipt.admission || {};
  return (
    <PrintShell
      settings={settings}
      documentTitle="Health Insurance Claim Form — Part A (Insured)"
      serialNo={a.admissionNumber}
      infoItems={[
        { label: "TPA / Insurer", value: p.tpaName },
        { label: "Policy No",     value: p.policyNumber },
        { label: "Sum Insured",   value: p.sumInsured ? fmtINR(p.sumInsured) : "—" },
      ]}
      signatureLabels={["Signature of Insured / Claimant", "Date"]}
    >
      <div className="pr-section">
        <div className="pr-section__title">A. Insured / Policy Details</div>
        <div className="pr-section__body">
          <Row label="Policy Holder Name" value={p.policyHolderName || p.name} />
          <Row label="Patient Name" value={p.name} />
          <Row label="UHID" value={p.uhid} />
          <Row label="Age / Gender" value={[p.age && `${p.age}Y`, p.gender].filter(Boolean).join(" / ")} />
          <Row label="Date of Birth" value={fmtD(p.dob)} />
          <Row label="Contact No" value={p.phone} />
          <Row label="Address" value={p.address} />
          <Row label="Occupation" blank />
          <Row label="Relationship to Policyholder" blank />
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">B. Hospitalisation</div>
        <div className="pr-section__body">
          <Row label="Hospital" value={receipt.hospital?.name} />
          <Row label="Date of Admission" value={fmtD(a.admissionDate)} />
          <Row label="Date of Discharge" value={fmtD(a.dischargeDate)} />
          <Row label="Diagnosis (ICD-10)" value={dxText(a)} />
          <Row label="Nature of Illness" value={a.isMLC ? "Accident / MLC" : "Illness"} />
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">C. Claim & Bank Details (to be completed by insured)</div>
        <div className="pr-section__body">
          <Row label="Total Amount Claimed" blank />
          <Row label="Bank Account Holder Name" blank />
          <Row label="Bank Name & Branch" blank />
          <Row label="Account No" blank />
          <Row label="IFSC Code" blank />
          <Row label="Pre-hospitalisation bills (₹)" blank />
          <Row label="Post-hospitalisation bills (₹)" blank />
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">D. Declaration</div>
        <div className="pr-section__body" style={{ fontSize: 10.5 }}>
          I hereby declare that the information furnished above is true and correct to the best of my knowledge. I
          authorise the hospital / TPA / insurer to obtain any medical or other records relevant to this claim.
        </div>
      </div>
    </PrintShell>
  );
};

export default ClaimFormPartA;
