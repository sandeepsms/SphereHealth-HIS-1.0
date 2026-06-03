// Components/print/printables/RefundReceipt.jsx
// Refund slip — money returned to patient (advance excess, cancelled
// service, etc.). Half-A4 friendly. Includes audit-trail-relevant
// fields (original payment ref, approval by, refund mode).
//
// R7fq Track A: refactored onto the new shared <PrintShell> contract.
// Hospital logo + name + address now live entirely in the shell.
//
// Patient-strip mapping (per Track-A contract):
//   left:  Receipt No · UMID · Patient Name · Gender/Age · Contact · Address
//   right: Receipt Date · IP No · Approved By · Refunded By · Payer
//          (Doctor / Specialization not relevant for a cashier-cut refund
//           slip; replaced with the approval-trail fields the audit
//           review actually inspects)

import React from "react";
import PrintShell from "@/templates/PrintShell";
import { fmtINR } from "../amountWords";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "—";

const RefundReceipt = ({ settings = {}, receipt = {} }) => {
  const amount = toNum(receipt.amount);
  const printCount = toNum(receipt.printCount);
  // R7bf-F / A4-HIGH-5 + R7bh-F7 / R7bg-7-HIGH-4: refund mode + UTR
  // reference. Prefer refundMode (set by controller from audit row),
  // fall back to `method` for legacy callers. UTR may arrive under any
  // of 4 aliases over different code paths.
  const refundMode = receipt.refundMode || receipt.method || "Cash";
  const utrReference = receipt.utrReference
    || receipt.utrRef
    || receipt.refundTransactionId
    || receipt.refNo;

  const receiptNo = receipt.receiptNo || "—";
  const genderAge = [receipt.gender, receipt.age && `${receipt.age}Y`]
    .filter(Boolean).join(" ");
  const ipOrOpd = receipt.ipdNo || receipt.opdNo || "—";

  const patientLeft = [
    { label: "Receipt No",   value: receiptNo },
    { label: "UMID",         value: receipt.uhid || "—" },
    { label: "Patient Name", value: receipt.patientName || "—" },
    { label: "Gender/Age",   value: genderAge || "—" },
    { label: "Contact",      value: receipt.contactNumber || receipt.mobile || "—" },
    { label: "Address",      value: receipt.completeAddress || receipt.address || "—" },
  ];
  const patientRight = [
    { label: "Receipt Date", value: fmtDateTime(receipt.date || new Date().toISOString()) },
    { label: "IP / OP No",   value: ipOrOpd },
    { label: "Approved By",  value: receipt.approvedBy || "—" },
    { label: "Refunded By",  value: receipt.refundedBy || "—" },
    { label: "Payer",        value: receipt.payer || "Self" },
  ];

  return (
    <PrintShell
      hospital={settings}
      docTitle="Refund Receipt"
      patient={{ left: patientLeft, right: patientRight }}
      signatures={{
        type: "prepared-by",
        preparedBy: { name: receipt.refundedBy || receipt.preparedBy || "Cashier", role: "Cashier" },
        showAttestedStamp: true,
      }}
      banners={{ emergency24x7: true }}
      meta={{
        docNumber: receiptNo,
        pageOf: "1 of 1",
        printCount,
      }}
    >
      {/* Body: bordered table — Particulars · Amount (₹) */}
      <table className="pr-table" style={{ marginBottom: 12 }}>
        <thead>
          <tr>
            <th>Particulars</th>
            <th className="right" style={{ width: 140 }}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bill-line-row">
            <td>
              <div style={{ fontWeight: 600 }}>Refund Amount</div>
              {receipt.reason && (
                <div className="muted" style={{ fontSize: 10 }}>{receipt.reason}</div>
              )}
            </td>
            <td className="right">{toNum(amount).toLocaleString("en-IN")}</td>
          </tr>
          <tr>
            <td className="right" style={{ fontWeight: 700 }}>Total Amount</td>
            <td className="right" style={{ fontWeight: 800 }}>{fmtINR(amount)}</td>
          </tr>
        </tbody>
      </table>

      <div className="pr-amount-words" style={{ fontStyle: "italic" }}>
        Refunded an amount of (Rs.) {numberToIndianWords(amount)} only
      </div>

      {/* Refund mode + UTR slip — required when refund is NEFT/IMPS so the
          recipient can match the bank credit against the receipt. */}
      <div className="pr-section">
        <div className="pr-section__title">Refund Mode</div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          <div><strong>Mode:</strong>{" "}
            <span className={`pr-paymethod pr-paymethod--${String(refundMode).toLowerCase()}`}>
              {String(refundMode).toUpperCase()}
            </span>
          </div>
          {utrReference && (
            <div style={{ marginTop: 4 }}>
              <strong>UTR / Reference:</strong>{" "}
              <span style={{ fontFamily: "'DM Mono', monospace" }}>{utrReference}</span>
            </div>
          )}
          {receipt.bankName && <div><strong>Bank:</strong> {receipt.bankName}</div>}
          {receipt.chequeNo && <div><strong>Cheque No:</strong> {receipt.chequeNo}</div>}
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Refund Reason</div>
        <div className="pr-section__body">
          {receipt.reason || "Excess amount paid against the patient's account."}
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Source Payment Reference</div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          <div><strong>Original receipt:</strong> {receipt.sourceReceiptNo || "—"}</div>
          <div><strong>Original mode:</strong> {receipt.sourceMethod || "—"}</div>
          <div><strong>Original amount:</strong> {receipt.sourceAmount != null ? fmtINR(toNum(receipt.sourceAmount)) : "—"}</div>
          {receipt.runningBalance != null && (
            <div><strong>Balance after refund:</strong> {fmtINR(toNum(receipt.runningBalance))}</div>
          )}
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Recipient Declaration</div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          I/we hereby acknowledge receipt of the above refund amount in full and final settlement of the
          claim/excess noted above. I/we will not raise any further claim against this transaction.
        </div>
      </div>
    </PrintShell>
  );
};

export default RefundReceipt;
