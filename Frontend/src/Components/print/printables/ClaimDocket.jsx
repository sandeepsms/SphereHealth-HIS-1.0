// Components/print/printables/ClaimDocket.jsx
// R7hr(CLAIM-P2) — universal claim/document docket (cover-sheet). For
// payers whose claim is filed on a portal (PM-JAY TMS, state schemes) or
// where a cover index of enclosures is needed, this is the hospital's
// proof-pack: what's attached, the bill totals, and a sign-off grid.
import React from "react";
import PrintShell from "../PrintShell";
import { dxText } from "./claimBits";  // R7hr(CLAIM-P3.1)
import { fmtINR } from "../amountWords";

const fmtD = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const Row = ({ label, value }) => (
  <div style={{ display: "flex", fontSize: 11, marginBottom: 3 }}>
    <div style={{ width: 170, color: "#64748b", fontWeight: 600 }}>{label}</div>
    <div style={{ flex: 1, fontWeight: 600 }}>{value || "—"}</div>
  </div>
);

const SCHEME_LABEL = {
  PMJAY: "Ayushman Bharat PM-JAY", STATE: "State Health Scheme", RETAIL_TPA: "TPA / Retail Insurance",
  CORPORATE: "Corporate / Group", CGHS: "CGHS", ESIC: "ESIC", ECHS: "ECHS", CASH: "Self-pay", OTHER: "Other",
};

const ClaimDocket = ({ settings, receipt = {} }) => {
  const p = receipt.patient || {};
  const a = receipt.admission || {};
  const t = receipt.totals || {};
  const s = p.schemeIds || {};
  const schemeId = s.pmjayId || s.stateSchemeId || s.cghsCardNo || s.esicIpNo || p.policyNumber || "—";
  return (
    <PrintShell
      settings={settings}
      documentTitle="Claim Document Docket"
      serialNo={a.admissionNumber}
      infoItems={[
        { label: "Patient", value: p.name },
        { label: "UHID", value: p.uhid },
        { label: "Scheme", value: SCHEME_LABEL[p.payerScheme] || p.payerScheme },
        { label: "Scheme / Policy ID", value: schemeId },
      ]}
      signatureLabels={["Prepared by (Claims Desk)", "Verified by"]}
    >
      <div className="pr-section">
        <div className="pr-section__title">Episode Summary</div>
        <div className="pr-section__body">
          <Row label="Admission No" value={a.admissionNumber} />
          <Row label="Admission → Discharge" value={`${fmtD(a.admissionDate)} → ${fmtD(a.dischargeDate)}`} />
          <Row label="Diagnosis (ICD-10)" value={dxText(a)} />
          <Row label="Total Billed (Net)" value={fmtINR(t.net)} />
          <Row label="Scheme / Insurer Payable" value={fmtINR(t.tpaPayable)} />
          <Row label="Patient Share" value={fmtINR(t.patientPayable)} />
          {receipt.preAuth?.number && <Row label="Pre-Auth / Approval No" value={receipt.preAuth.number} />}
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Enclosed Documents</div>
        <table className="pr-table" style={{ fontSize: 10.5 }}>
          <thead><tr><th style={{ width: 30 }}>#</th><th>Document</th><th style={{ width: 70 }} className="center">Enclosed</th></tr></thead>
          <tbody>
            {(receipt.docsChecklist || []).map((d, i) => (
              <tr key={i}><td>{i + 1}</td><td>{d}</td><td className="center">☐</td></tr>
            ))}
            {(receipt.billsList || []).map((b, i) => (
              <tr key={`b${i}`}><td>{(receipt.docsChecklist?.length || 0) + i + 1}</td><td className="muted">Bill {b.billNumber} — {fmtINR(b.netAmount)}</td><td className="center">☑</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>
        {p.payerScheme === "PMJAY"
          ? "PM-JAY claims are filed electronically on the TMS portal (tms.pmjay.gov.in) — this docket is the hospital's enclosure index / proof-pack, not a submission form."
          : "Cover index of documents accompanying this claim. Tick each enclosure before dispatch."}
      </div>
    </PrintShell>
  );
};

export default ClaimDocket;
