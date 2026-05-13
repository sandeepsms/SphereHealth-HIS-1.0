// Components/print/printables/PaymentReceipt.jsx
// A general payment-received slip — cash, UPI, card, net banking, cheque.
// Use for any incoming payment that isn't a full bill (e.g. a partial
// settlement against an IPD running bill, or a follow-up OPD top-up).

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR, amountInWords } from "../amountWords";

const METHOD_STYLE = {
  cash: { tone: "cash", label: "Cash" },
  upi:  { tone: "upi",  label: "UPI" },
  card: { tone: "card", label: "Card" },
  net:  { tone: "net",  label: "Net Banking" },
  cheque: { tone: "chq",  label: "Cheque" },
};

const PaymentReceipt = ({ settings, receipt = {} }) => {
  const amount = Number(receipt.amount) || 0;
  const m = METHOD_STYLE[String(receipt.method || "cash").toLowerCase()] || METHOD_STYLE.cash;
  return (
    <PrintShell
      settings={settings}
      documentTitle="Payment Receipt"
      serialNo={receipt.receiptNo}
      infoItems={[
        { label: "Patient",    value: receipt.patientName },
        { label: "UHID",       value: receipt.uhid },
        { label: "IPD No",     value: receipt.ipdNo },
        { label: "Date",       value: receipt.date
            ? new Date(receipt.date).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) },
        { label: "Received By", value: receipt.receivedBy },
      ]}
    >
      {/* Big amount block */}
      <div style={{
        background: "var(--pr-accent-color, #1d4ed8)10",
        border: "2px dashed var(--pr-accent-color, #1d4ed8)",
        borderRadius: 8, padding: "16px 18px",
        textAlign: "center", marginBottom: 14,
      }}>
        <div style={{ fontSize: 11, color: "#475569", fontWeight: 700, letterSpacing: ".5px", textTransform: "uppercase" }}>
          Amount Received
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, color: "var(--pr-accent-color, #1d4ed8)", lineHeight: 1, marginTop: 4 }}>
          {fmtINR(amount)}
        </div>
        <div style={{ marginTop: 10 }}>
          <span className={`pr-paymethod pr-paymethod--${m.tone}`}>
            {m.label}
          </span>
        </div>
      </div>

      <div className="pr-amount-words">
        <strong>In words:</strong> {amountInWords(amount)}
      </div>

      {/* Payment-specific details */}
      <div className="pr-section">
        <div className="pr-section__title">Payment Details</div>
        <dl className="pr-kv">
          <dt>Mode</dt><dd>{m.label}</dd>
          {receipt.refNo && (<><dt>Reference No</dt><dd>{receipt.refNo}</dd></>)}
          {receipt.transactionId && (<><dt>Transaction ID</dt><dd>{receipt.transactionId}</dd></>)}
          {receipt.cardLast4 && (<><dt>Card</dt><dd>****-****-****-{receipt.cardLast4}</dd></>)}
          {receipt.upiId && (<><dt>UPI ID</dt><dd>{receipt.upiId}</dd></>)}
          {receipt.bank && (<><dt>Bank</dt><dd>{receipt.bank}</dd></>)}
          {receipt.chequeNo && (<><dt>Cheque No</dt><dd>{receipt.chequeNo}</dd></>)}
          {receipt.purpose && (<><dt>Purpose</dt><dd>{receipt.purpose}</dd></>)}
          {receipt.runningBalance != null && (
            <><dt>Running Balance</dt><dd>{fmtINR(receipt.runningBalance)}</dd></>
          )}
        </dl>
      </div>
    </PrintShell>
  );
};

export default PaymentReceipt;
