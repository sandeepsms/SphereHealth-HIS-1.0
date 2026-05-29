// Components/print/printables/PaymentReceipt.jsx
// A general payment-received slip — cash, UPI, card, net banking, cheque.
// Use for any incoming payment that isn't a full bill (e.g. a partial
// settlement against an IPD running bill, or a follow-up OPD top-up).
//
// R7bh-F7 / R7bg-7-CRIT-4 + R7bg-7-CRIT-5 + R7bg-7-HIGH-1:
//   • Decimal128 unwrap via toNum() everywhere (was bare Number()).
//   • numberToIndianWords() handles paise — replaces legacy amountInWords
//     which dropped the rupee/paise leg.
//   • PrintWatermark / printCount wired via PrintShell so reprints carry
//     the GST §48(4) DUPLICATE stamp.

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

const METHOD_STYLE = {
  cash:   { tone: "cash", label: "Cash" },
  upi:    { tone: "upi",  label: "UPI" },
  card:   { tone: "card", label: "Card" },
  net:    { tone: "net",  label: "Net Banking" },
  neft:   { tone: "neft", label: "NEFT" },
  imps:   { tone: "imps", label: "IMPS" },
  rtgs:   { tone: "rtgs", label: "RTGS" },
  cheque: { tone: "chq",  label: "Cheque" },
};

const PaymentReceipt = ({ settings = {}, receipt = {} }) => {
  // R7bg-7-CRIT-5: bare Number(amount) leaked {$numberDecimal:"…"} from
  // the wire as NaN → big amount block rendered "₹0". Replaced with
  // toNum() which unwraps Decimal128 + Number + string consistently.
  const amount = toNum(receipt.amount);
  const printCount = toNum(receipt.printCount);
  const m = METHOD_STYLE[String(receipt.method || "cash").toLowerCase()] || METHOD_STYLE.cash;
  const runningBalance = toNum(receipt.runningBalance);

  // R7eo-A — Pattern A fix: hardcoded "Payment Receipt" title forced
  // OPD top-ups, IPD interim advances, and Final Settlements to print
  // under the same banner. Derive a visit-aware label only when the
  // caller supplies receipt.visitType / receipt.context — legacy
  // callers (no fields set) keep the original "Payment Receipt" string.
  const visitTypeRaw = receipt.visitType ? String(receipt.visitType).toUpperCase() : "";
  const visitLabel =
      visitTypeRaw === "IPD"        ? "IPD"
    : visitTypeRaw === "DAYCARE"    ? "Daycare"
    : visitTypeRaw === "DAY CARE"   ? "Daycare"
    : visitTypeRaw === "EMERGENCY"  ? "Emergency"
    : visitTypeRaw === "ER"         ? "Emergency"
    : visitTypeRaw === "OPD"        ? "OPD"
                                    : "";
  const isFinalSettlement =
    String(receipt.context || "").toUpperCase() === "FINAL_SETTLEMENT";
  const docTitle = isFinalSettlement
    ? `Final Settlement Receipt${visitLabel ? ` — ${visitLabel}` : ""}`
    : visitLabel
    ? `${visitLabel} Payment Receipt`
    : "Payment Receipt";

  return (
    <PrintShell
      settings={settings}
      documentTitle={docTitle}
      serialNo={receipt.receiptNo}
      printCount={printCount}
      infoItems={[
        { label: "Patient",    value: receipt.patientName },
        { label: "UHID",       value: receipt.uhid },
        { label: "IPD No",     value: receipt.ipdNo },
        { label: "Date",       value: receipt.date
            ? new Date(receipt.date).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) },
        { label: "Received By", value: receipt.receivedBy },
      ]}
      signatureLabels={["Authorised Cashier", "Payer / Patient"]}
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
          {(receipt.refNo || receipt.utrReference || receipt.utrRef) && (
            <span style={{ marginLeft: 10, fontSize: 11, color: "#475569", fontFamily: "'DM Mono', monospace" }}>
              Ref: {receipt.utrReference || receipt.utrRef || receipt.refNo}
            </span>
          )}
        </div>
      </div>

      <div className="pr-amount-words">
        <strong>In words:</strong> {numberToIndianWords(amount)}
      </div>

      {/* Payment-specific details */}
      <div className="pr-section">
        <div className="pr-section__title">Payment Details</div>
        <dl className="pr-kv">
          <dt>Mode</dt><dd>{m.label}</dd>
          {receipt.refNo && (<><dt>Reference No</dt><dd style={{ fontFamily: "'DM Mono', monospace" }}>{receipt.refNo}</dd></>)}
          {/* R7bg-7-HIGH-4: UTR aliases — accept all backend variants */}
          {(receipt.utrReference || receipt.utrRef) && (
            <><dt>UTR / Bank Ref</dt><dd style={{ fontFamily: "'DM Mono', monospace" }}>{receipt.utrReference || receipt.utrRef}</dd></>
          )}
          {receipt.transactionId && (<><dt>Transaction ID</dt><dd style={{ fontFamily: "'DM Mono', monospace" }}>{receipt.transactionId}</dd></>)}
          {receipt.cardLast4 && (<><dt>Card</dt><dd>****-****-****-{receipt.cardLast4}</dd></>)}
          {receipt.upiId && (<><dt>UPI ID</dt><dd>{receipt.upiId}</dd></>)}
          {receipt.bank && (<><dt>Bank</dt><dd>{receipt.bank}</dd></>)}
          {receipt.chequeNo && (<><dt>Cheque No</dt><dd>{receipt.chequeNo}</dd></>)}
          {receipt.purpose && (<><dt>Purpose</dt><dd>{receipt.purpose}</dd></>)}
          {receipt.runningBalance != null && (
            <><dt>Running Balance</dt><dd>{fmtINR(runningBalance)}</dd></>
          )}
        </dl>
      </div>
    </PrintShell>
  );
};

export default PaymentReceipt;
