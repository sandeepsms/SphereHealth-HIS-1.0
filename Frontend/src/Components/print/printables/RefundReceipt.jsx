// Components/print/printables/RefundReceipt.jsx
// Refund slip — money returned to patient (advance excess, cancelled
// service, etc.). Half-A4 friendly. Includes audit-trail-relevant
// fields (original payment ref, approval by, refund mode).

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

const RefundReceipt = ({ settings, receipt = {} }) => {
  const amount = toNum(receipt.amount);
  const printCount = toNum(receipt.printCount);
  // R7bf-F / A4-HIGH-5: refund mode + UTR reference. Use refundMode
  // (preferred — set by the controller from the audit row), falling
  // back to `method` for legacy callers. UTR comes from the bank API
  // when the refund is an NEFT/IMPS transfer.
  const refundMode = receipt.refundMode || receipt.method || "Cash";
  const utrReference = receipt.utrReference || receipt.utrRef || receipt.refundTransactionId;
  return (
    <PrintShell
      settings={settings}
      documentTitle="Refund Receipt"
      serialNo={receipt.receiptNo}
      printCount={printCount}
      infoItems={[
        { label: "Patient",       value: receipt.patientName },
        { label: "UHID",          value: receipt.uhid },
        { label: "IPD / OPD No",  value: receipt.ipdNo || receipt.opdNo },
        { label: "Refund Date",   value: receipt.date
            ? new Date(receipt.date).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) },
        { label: "Approved By",   value: receipt.approvedBy },
        { label: "Refunded By",   value: receipt.refundedBy },
      ]}
      signatureLabels={["Authorised Cashier", "Recipient"]}
    >
      <div style={{
        background: "linear-gradient(135deg, #fee2e2, #fecaca)",
        border: "2px solid #fca5a5",
        borderRadius: 8, padding: "16px 18px",
        textAlign: "center", marginBottom: 14,
      }}>
        <div style={{ fontSize: 11, color: "#991b1b", fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase" }}>
          Refund Amount
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, color: "#7f1d1d", lineHeight: 1, marginTop: 4 }}>
          {fmtINR(amount)}
        </div>
        {receipt.method && (
          <div style={{ marginTop: 10 }}>
            <span className={`pr-paymethod pr-paymethod--${String(receipt.method).toLowerCase()}`}>
              {String(receipt.method).toUpperCase()}
            </span>
            {receipt.refNo && (
              <span style={{ marginLeft: 10, fontSize: 11, color: "#991b1b" }}>Ref: {receipt.refNo}</span>
            )}
          </div>
        )}
      </div>

      <div className="pr-amount-words">
        <strong>Refund in words:</strong> {numberToIndianWords(amount)}
      </div>

      {/* R7bf-F / A4-HIGH-5: refund mode + UTR slip — required when the
          refund goes out via NEFT/IMPS so the recipient can match the
          bank credit against the receipt. */}
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
