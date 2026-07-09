// Components/print/printables/ClaimFormPartB.jsx
// R7hr(CLAIM-P1.3) — IRDAI standard Claim Form PART B (hospital-filled).
// The reimbursement "money form": hospital identity (with ROHINI —
// insurer-mandatory), admission + diagnosis, category-wise bill breakup,
// enumerated bills/receipts, pre-auth. ~95% auto-filled from the claim
// data builder; only signature/seal is manual.
import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { toNum } from "../../../utils/printUtils";

const fmtDT = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtD  = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const Row = ({ label, value }) => (
  <div style={{ display: "flex", fontSize: 11, marginBottom: 3 }}>
    <div style={{ width: 165, color: "#64748b", fontWeight: 600 }}>{label}</div>
    <div style={{ flex: 1, color: "#0f172a", fontWeight: 600 }}>{value || "—"}</div>
  </div>
);

const ClaimFormPartB = ({ settings, receipt = {} }) => {
  const h = receipt.hospital || {};
  const p = receipt.patient || {};
  const a = receipt.admission || {};
  const pa = receipt.preAuth || {};
  const t = receipt.totals || {};
  const breakup = receipt.billBreakup || [];
  const breakSum = breakup.reduce((s, b) => s + toNum(b.amount), 0);

  return (
    <PrintShell
      settings={settings}
      documentTitle="Health Insurance Claim Form — Part B (Hospital)"
      serialNo={receipt.billsList?.[0]?.billNumber || a.admissionNumber}
      infoItems={[
        { label: "Patient",     value: p.name },
        { label: "UHID",        value: p.uhid },
        { label: "Age / Sex",   value: [p.age && `${p.age}Y`, p.gender].filter(Boolean).join(" / ") },
        { label: "IP / Adm No", value: a.ipNo || a.admissionNumber },
        { label: "TPA / Insurer", value: p.tpaName },
        { label: "Policy No",   value: p.policyNumber },
      ]}
      signatureLabels={["Hospital Seal & Signature", "Treating Doctor"]}
    >
      {/* Hospital block — ROHINI is the field insurers reject Part B without */}
      <div className="pr-section">
        <div className="pr-section__title">Hospital Details</div>
        <div className="pr-section__body">
          <Row label="Hospital" value={h.name} />
          <Row label="Address" value={h.address} />
          <div style={{ display: "flex", gap: 24 }}>
            <Row label="ROHINI ID" value={h.rohiniId} />
            <Row label="Registration No" value={h.registrationNo} />
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            <Row label="GSTIN" value={h.gstin} />
            <Row label="PAN" value={h.pan} />
          </div>
        </div>
      </div>

      {/* Admission + clinical */}
      <div className="pr-section">
        <div className="pr-section__title">Hospitalisation Details</div>
        <div className="pr-section__body">
          <div style={{ display: "flex", gap: 24 }}>
            <Row label="Date of Admission" value={fmtDT(a.admissionDate)} />
            <Row label="Date of Discharge" value={fmtDT(a.dischargeDate)} />
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            <Row label="Admission Type" value={a.type} />
            <Row label="Room / Bed" value={a.roomCategory} />
          </div>
          <Row label="Treating Consultant" value={a.consultant} />
          <Row label="Provisional Diagnosis" value={a.provisionalDiagnosis} />
          <Row label="Final Diagnosis" value={a.finalDiagnosis} />
          <Row label="Line of Treatment / Reason" value={a.reasonForAdmission} />
          {a.isMLC && <Row label="MLC No" value={a.mlcNumber || "Yes"} />}
          <Row label="Nature of Illness (Accident/Illness)" value={a.isMLC ? "Accident / MLC" : "Illness"} />
        </div>
      </div>

      {/* Pre-auth */}
      {(pa.number || pa.approvedAmount) && (
        <div className="pr-section">
          <div className="pr-section__title">Pre-Authorisation</div>
          <div className="pr-section__body" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <Row label="Pre-Auth No" value={pa.number} />
            <Row label="Sanctioned ₹" value={pa.sanctionedAmount != null ? fmtINR(pa.sanctionedAmount) : "—"} />
            <Row label="Claim No" value={pa.claimNumber} />
            <Row label="Approved ₹" value={pa.approvedAmount != null ? fmtINR(pa.approvedAmount) : "—"} />
          </div>
        </div>
      )}

      {/* Bill breakup — the core of Part B */}
      <div className="pr-section">
        <div className="pr-section__title">Bill Breakup (category-wise)</div>
        <table className="pr-table">
          <thead><tr><th style={{ width: 30 }}>#</th><th>Head of Expense</th><th className="right" style={{ width: 130 }}>Amount (₹)</th></tr></thead>
          <tbody>
            {breakup.map((b, i) => (
              <tr key={i}><td>{i + 1}</td><td>{b.name}</td><td className="right">{fmtINR(b.amount)}</td></tr>
            ))}
            <tr style={{ fontWeight: 800, background: "#f8fafc" }}><td colSpan={2} className="right">Total Billed</td><td className="right">{fmtINR(breakSum)}</td></tr>
            {toNum(t.discount) > 0 && <tr><td colSpan={2} className="right">Less: Discount</td><td className="right">- {fmtINR(t.discount)}</td></tr>}
            <tr style={{ fontWeight: 800 }}><td colSpan={2} className="right">Net Payable</td><td className="right">{fmtINR(t.net)}</td></tr>
            {toNum(t.tpaPayable) > 0 && <tr><td colSpan={2} className="right">TPA / Insurer Payable</td><td className="right">{fmtINR(t.tpaPayable)}</td></tr>}
            {toNum(t.patientPayable) > 0 && <tr><td colSpan={2} className="right">Patient Co-pay / Non-payable</td><td className="right">{fmtINR(t.patientPayable)}</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Bills + receipts enumeration */}
      {(receipt.billsList?.length > 0) && (
        <div className="pr-section">
          <div className="pr-section__title">Bills & Receipts Enclosed</div>
          <table className="pr-table" style={{ fontSize: 10.5 }}>
            <thead><tr><th>Bill No</th><th>Date</th><th className="right">Amount</th><th className="right">Paid</th></tr></thead>
            <tbody>
              {receipt.billsList.map((b, i) => (
                <tr key={i}><td>{b.billNumber || "—"}</td><td>{fmtD(b.billDate)}</td><td className="right">{fmtINR(b.netAmount)}</td><td className="right">{fmtINR(b.paid)}</td></tr>
              ))}
              {(receipt.receipts || []).map((r, i) => (
                <tr key={`r${i}`}><td className="muted">Rcpt {r.receiptNumber || "—"}</td><td>{fmtD(r.date)}</td><td className="right muted">{r.mode}</td><td className="right">{fmtINR(r.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>
        This Part B is completed by the hospital per the IRDAI standard claim form. The hospital certifies that the
        treatment details and charges above are true and the patient was hospitalised as stated.
      </div>
    </PrintShell>
  );
};

export default ClaimFormPartB;
