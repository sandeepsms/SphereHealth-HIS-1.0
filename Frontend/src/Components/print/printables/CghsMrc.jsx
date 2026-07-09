// Components/print/printables/CghsMrc.jsx
// R7hr(CLAIM-P2) — CGHS Medical Reimbursement Claim. One template covers
// both MRC(S) serving employees and MRC(P) pensioners (variant flag);
// auto-filled from the claim-data builder + patient.schemeIds (CGHS card,
// ward entitlement, PPO). Pensioner-only fields box blank when serving.
import React from "react";
import PrintShell from "../PrintShell";
import { dxText, Fill } from "./claimBits";  // R7hr(CLAIM-P3)
import { fmtINR } from "../amountWords";

const fmtD = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const Row = ({ label, value, blank }) => (
  <div style={{ display: "flex", fontSize: 11, marginBottom: 4 }}>
    <div style={{ width: 200, color: "#64748b", fontWeight: 600 }}>{label}</div>
    <div style={{ flex: 1, fontWeight: 600, color: blank ? "#cbd5e1" : "#0f172a", borderBottom: blank ? "1px dashed #cbd5e1" : "none", minHeight: blank ? 15 : "auto" }}>{blank ? <Fill value={value} /> : (value || "—")}</div>
  </div>
);

const CghsMrc = ({ settings, receipt = {} }) => {
  const p = receipt.patient || {};
  const a = receipt.admission || {};
  const s = p.schemeIds || {};
  const pensioner = !!(s.ppoNo);   // PPO present → pensioner MRC(P)
  return (
    <PrintShell
      settings={settings}
      documentTitle={`CGHS Medical Reimbursement Claim — Form MRC(${pensioner ? "P" : "S"})`}
      serialNo={a.admissionNumber}
      infoItems={[
        { label: "Beneficiary", value: p.name },
        { label: "CGHS Card No", value: s.cghsCardNo },
        { label: "Ward Entitlement", value: s.cghsWardEntitlement },
        { label: pensioner ? "PPO No" : "Employee ID", value: pensioner ? s.ppoNo : "" },
      ]}
      signatureLabels={["Signature of Beneficiary", "CMO I/C (CGHS Wellness Centre)"]}
    >
      <div className="pr-section">
        <div className="pr-section__title">Beneficiary Details</div>
        <div className="pr-section__body">
          <Row label="Name" value={p.name} />
          <Row label="Age / Gender" value={[p.age && `${p.age}Y`, p.gender].filter(Boolean).join(" / ")} />
          <Row label="CGHS Card No" value={s.cghsCardNo} />
          <Row label="Ward Entitlement" value={s.cghsWardEntitlement} />
          {pensioner ? <Row label="PPO No" value={s.ppoNo} /> : <Row label="Office / Department" blank />}
          <Row label="Address" value={p.address} />
          <Row label="Contact No" value={p.phone} />
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Treatment Details</div>
        <div className="pr-section__body">
          <Row label="Hospital" value={receipt.hospital?.name} />
          <Row label="Date of Admission" value={fmtD(a.admissionDate)} />
          <Row label="Date of Discharge" value={fmtD(a.dischargeDate)} />
          <Row label="Diagnosis (ICD-10)" value={dxText(a)} />
          <Row label="Referred by (CMO / Specialist)" blank />
          <Row label="Permission / Referral No" blank />
          <Row label="Total Amount Claimed (₹)" value={fmtINR(receipt.totals?.net)} />
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Bank Details (for reimbursement)</div>
        <div className="pr-section__body">
          <Row label="Account Holder" blank /><Row label="Bank & Branch" blank />
          <Row label="Account No" blank /><Row label="IFSC" blank />
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Enclosures (Annexure B checklist)</div>
        <div className="pr-section__body" style={{ fontSize: 10.5 }}>
          {(receipt.docsChecklist || []).map((d, i) => <span key={i} style={{ display: "inline-block", marginRight: 14 }}>☐ {d}</span>)}
        </div>
      </div>
    </PrintShell>
  );
};

export default CghsMrc;
