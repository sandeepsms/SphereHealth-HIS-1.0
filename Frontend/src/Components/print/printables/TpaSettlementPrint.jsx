// Components/print/printables/TpaSettlementPrint.jsx
// R7bh-F7 / R7bg-7-CRIT-3 + R7bg-7-HIGH-3: TPA / insurer SETTLEMENT
// statement. Issued once a TPA finalises a claim — captures the
// approved / paid / shortfall / TDS / write-off breakdown so the
// accountant and the patient both see exactly how the bill was
// reconciled with the insurer.

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

const fmtD = (d) => d
  ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  : "—";

const STATUS_TONE = {
  SETTLED:   { bg: "#dcfce7", fg: "#15803d", border: "#86efac" },
  PARTIAL:   { bg: "#fef3c7", fg: "#a16207", border: "#fcd34d" },
  "WRITE-OFF": { bg: "#fee2e2", fg: "#b91c1c", border: "#fca5a5" },
  REJECTED:  { bg: "#fee2e2", fg: "#b91c1c", border: "#fca5a5" },
  PENDING:   { bg: "#f1f5f9", fg: "#475569", border: "#cbd5e1" },
};

const TpaSettlementPrint = ({ settings = {}, receipt = {} }) => {
  const r = receipt;
  const printCount = toNum(r.printCount);

  const status = String(r.status || "SETTLED").toUpperCase();
  const tone = STATUS_TONE[status] || STATUS_TONE.SETTLED;

  const items = Array.isArray(r.items) ? r.items : [];
  const payments = Array.isArray(r.payments) ? r.payments : [];

  const billTotal = toNum(r.billTotal ?? r.invoiceAmount);
  const approved = toNum(r.approvedAmount ?? r.approved);
  const paidExplicit = toNum(r.paidAmount ?? r.paid);
  const paid = paidExplicit || payments.reduce((s, p) => s + toNum(p.amount), 0);
  const tds = toNum(r.tdsDeducted ?? r.tdsAmount);
  const shortfall = toNum(r.shortfall) || Math.max(0, approved - paid - tds);
  const writeOff = toNum(r.writeOff);
  const patientLiability = toNum(r.patientLiability) || Math.max(0, billTotal - approved);
  const disallowance = toNum(r.disallowance) || Math.max(0, billTotal - approved - patientLiability);

  return (
    <PrintShell
      settings={settings}
      documentTitle="TPA / Insurance Settlement Statement"
      serialNo={r.settlementNo || r.claimNumber}
      printCount={printCount}
      watermarkRecipient="TPA / INSURER"
      infoItems={[
        { label: "TPA / Insurer",    value: r.tpaName || r.insurerName },
        { label: "Policy No",        value: r.policyNo },
        { label: "Claim No",         value: r.claimNumber },
        { label: "Patient",          value: r.patientName },
        { label: "UHID",             value: r.uhid },
        { label: "IPD No",           value: r.ipdNo },
        { label: "Admitted",         value: fmtD(r.admissionDate) },
        { label: "Discharged",       value: fmtD(r.dischargeDate) },
        { label: "Diagnosis",        value: r.finalDiagnosis },
        { label: "Bill No",          value: r.billNumber },
        { label: "Bill Date",        value: fmtD(r.billDate) },
        { label: "Settlement Date",  value: fmtD(r.settlementDate || new Date()) },
      ]}
      signatureLabels={["TPA Cell", "Finance / Accountant"]}
    >
      <div style={{
        background: tone.bg, border: `1.5px solid ${tone.border}`,
        color: tone.fg, padding: "10px 14px", borderRadius: 6,
        marginBottom: 12, display: "flex", justifyContent: "space-between",
        alignItems: "center", fontSize: 12,
      }}>
        <span style={{ fontWeight: 800, letterSpacing: ".4px" }}>
          STATUS: {status}
        </span>
        <span style={{ fontWeight: 700 }}>
          Net Settled: {fmtINR(paid)}
        </span>
      </div>

      {/* Reconciliation totals */}
      <div className="pr-section">
        <div className="pr-section__title">Claim Reconciliation</div>
        <div className="pr-totals" style={{ marginTop: 0 }}>
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Bill Total (Claim Submitted)</span>
            <span className="pr-totals__val">{fmtINR(billTotal)}</span>
          </div>
          {disallowance > 0 && (
            <div className="pr-totals__row">
              <span className="pr-totals__lbl">Less: TPA Disallowance</span>
              <span className="pr-totals__val">- {fmtINR(disallowance)}</span>
            </div>
          )}
          {patientLiability > 0 && (
            <div className="pr-totals__row">
              <span className="pr-totals__lbl">Less: Patient Liability (Co-pay / Non-payable)</span>
              <span className="pr-totals__val">- {fmtINR(patientLiability)}</span>
            </div>
          )}
          <div className="pr-totals__row" style={{ background: "#f8fafc", fontWeight: 800 }}>
            <span className="pr-totals__lbl">Approved Amount</span>
            <span className="pr-totals__val">{fmtINR(approved)}</span>
          </div>
          {tds > 0 && (
            <div className="pr-totals__row">
              <span className="pr-totals__lbl">Less: TDS Deducted (u/s 194J)</span>
              <span className="pr-totals__val">- {fmtINR(tds)}</span>
            </div>
          )}
          {writeOff > 0 && (
            <div className="pr-totals__row">
              <span className="pr-totals__lbl">Less: Write-off</span>
              <span className="pr-totals__val">- {fmtINR(writeOff)}</span>
            </div>
          )}
          <div className="pr-totals__row pr-totals__row--grand">
            <span className="pr-totals__lbl">Amount Paid by TPA</span>
            <span className="pr-totals__val">{fmtINR(paid)}</span>
          </div>
          {shortfall > 0 && (
            <div className="pr-totals__row" style={{ color: "#b91c1c", fontWeight: 700 }}>
              <span className="pr-totals__lbl">Outstanding (Shortfall vs Approved)</span>
              <span className="pr-totals__val">{fmtINR(shortfall)}</span>
            </div>
          )}
        </div>
        <div className="pr-amount-words">
          <strong>Net settled in words: </strong>
          {numberToIndianWords(paid)}
        </div>
      </div>

      {/* Items breakdown — optional, only render if back-end sent it */}
      {items.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Bill Items Breakdown</div>
          <table className="pr-table" style={{ fontSize: 10.5 }}>
            <thead>
              <tr>
                <th>Particulars</th>
                <th className="right" style={{ width: 90 }}>Billed (₹)</th>
                <th className="right" style={{ width: 90 }}>Approved (₹)</th>
                <th className="right" style={{ width: 90 }}>Disallowed (₹)</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>{it.name || it.particulars}</td>
                  <td className="right">{fmtINR(toNum(it.billed ?? it.amount))}</td>
                  <td className="right">{fmtINR(toNum(it.approved))}</td>
                  <td className="right" style={{ color: toNum(it.disallowed) > 0 ? "#b91c1c" : "#94a3b8" }}>
                    {toNum(it.disallowed) > 0 ? fmtINR(toNum(it.disallowed)) : "—"}
                  </td>
                  <td className="muted" style={{ fontSize: 10 }}>{it.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Payment references */}
      {payments.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">TPA Payment References</div>
          <table className="pr-table" style={{ fontSize: 10.5 }}>
            <thead>
              <tr>
                <th style={{ width: 95 }}>Date</th>
                <th>Mode</th>
                <th>UTR / Reference</th>
                <th>Bank</th>
                <th className="right" style={{ width: 100 }}>Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={i}>
                  <td>{fmtD(p.date)}</td>
                  <td>{p.method || p.mode || "—"}</td>
                  <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 10 }}>
                    {p.utrReference || p.utrRef || p.refNo || "—"}
                  </td>
                  <td>{p.bankName || "—"}</td>
                  <td className="right">{fmtINR(toNum(p.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Settlement notes */}
      {r.remarks && (
        <div className="pr-section">
          <div className="pr-section__title">TPA Remarks / Settlement Note</div>
          <div className="pr-section__body" style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>
            {r.remarks}
          </div>
        </div>
      )}

      <div className="pr-section">
        <div className="pr-section__title">Declaration</div>
        <div className="pr-section__body" style={{ fontSize: 10.5, lineHeight: 1.5 }}>
          This statement reconciles the claim filed under Policy {r.policyNo || "—"} for the patient's hospitalisation.
          The hospital accepts payment from the TPA as full and final{status === "SETTLED" ? " settlement of the approved portion of the claim" : ""}.
          {patientLiability > 0 && " Patient liability (co-pay / non-payable items) is to be recovered separately as per hospital policy."}
        </div>
      </div>
    </PrintShell>
  );
};

export default TpaSettlementPrint;
