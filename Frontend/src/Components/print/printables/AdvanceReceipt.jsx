// Components/print/printables/AdvanceReceipt.jsx
// Advance / Deposit receipt — money taken at admission, before billing
// starts. Will be adjusted against the final bill.

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

const AdvanceReceipt = ({ settings = {}, receipt = {} }) => {
  const amount = toNum(receipt.amount);
  const printCount = toNum(receipt.printCount);
  // R7bh-F7 / R7bg-7-HIGH-1: 2026 GST circular — advances ≥ ₹50,000 must
  // capture the customer's GSTIN on the receipt (B2B threshold). The
  // hospital's GSTIN already prints in PrintShell's header from settings.
  const HIGH_VALUE_GST_THRESHOLD = 50000;
  const customerGstin = receipt.customerGstin || receipt.gstin;
  const requiresGstin = amount >= HIGH_VALUE_GST_THRESHOLD;
  const missingGstinForHighValue = requiresGstin && !customerGstin;
  return (
    <PrintShell
      settings={settings}
      // R7bf-F / A4-HIGH-4: title was "Tax Invoice" pre-R7bf because
      // the advance template inherited bill chrome. Explicit override
      // so customers can tell apart a deposit slip from a tax invoice.
      documentTitle="Advance Receipt"
      serialNo={receipt.receiptNo}
      printCount={printCount}
      infoItems={[
        { label: "Patient",    value: receipt.patientName },
        { label: "UHID",       value: receipt.uhid },
        { label: "IPD No",     value: receipt.ipdNo },
        { label: "Admission",  value: receipt.admissionDate
            ? new Date(receipt.admissionDate).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
            : "—" },
        { label: "Bed / Ward", value: receipt.bedNumber
            ? `${receipt.bedNumber}${receipt.wardName ? " · " + receipt.wardName : ""}`
            : (receipt.wardName || "—") },
        { label: "Receipt Date", value: receipt.date
            ? new Date(receipt.date).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) },
        // R7bh-F7 / R7bg-7-HIGH-1: hospital + customer GSTIN visible on
        // the deposit receipt so corporate / TPA accounts can later claim
        // input tax credit when the advance is adjusted on the final bill.
        { label: "Hospital GSTIN", value: settings.gstin || "—" },
        { label: "Customer GSTIN", value: customerGstin || (requiresGstin ? "MISSING — required for ≥ ₹50,000" : "—") },
      ]}
      signatureLabels={["Authorised Cashier", "Depositor / Patient"]}
    >
      <div style={{
        background: "linear-gradient(135deg, #fef9c3, #fde68a)",
        border: "2px solid #facc15",
        borderRadius: 8, padding: "16px 18px",
        textAlign: "center", marginBottom: 14,
      }}>
        <div style={{ fontSize: 11, color: "#92400e", fontWeight: 700, letterSpacing: ".6px", textTransform: "uppercase" }}>
          Advance Received
        </div>
        <div style={{ fontSize: 32, fontWeight: 800, color: "#713f12", lineHeight: 1, marginTop: 4 }}>
          {fmtINR(amount)}
        </div>
        {receipt.method && (
          <div style={{ marginTop: 10 }}>
            <span className={`pr-paymethod pr-paymethod--${String(receipt.method).toLowerCase()}`}>
              {String(receipt.method).toUpperCase()}
            </span>
            {receipt.refNo && (
              <span style={{ marginLeft: 10, fontSize: 11, color: "#92400e" }}>Ref: {receipt.refNo}</span>
            )}
          </div>
        )}
      </div>

      <div className="pr-amount-words">
        <strong>In words:</strong> {numberToIndianWords(amount)}
      </div>

      {missingGstinForHighValue && (
        <div style={{
          background: "#fef2f2", border: "1.5px solid #fecaca", color: "#7f1d1d",
          padding: "8px 14px", borderRadius: 6, marginBottom: 12,
          fontSize: 11, fontWeight: 700,
        }}>
          ⚠ GST COMPLIANCE — Advances of ₹50,000 or more require the depositor's GSTIN
          (2026 GST circular). Please capture the customer's GSTIN before printing.
        </div>
      )}

      {customerGstin && (
        <div className="pr-section">
          <div className="pr-section__title">Tax Identification</div>
          <div className="pr-section__body" style={{ fontSize: 11 }}>
            <div><strong>Hospital GSTIN:</strong> <span style={{ fontFamily: "'DM Mono', monospace" }}>{settings.gstin || "—"}</span></div>
            <div style={{ marginTop: 2 }}>
              <strong>Customer GSTIN:</strong> <span style={{ fontFamily: "'DM Mono', monospace" }}>{customerGstin}</span>
            </div>
            {receipt.customerLegalName && <div style={{ marginTop: 2 }}><strong>Legal Name:</strong> {receipt.customerLegalName}</div>}
          </div>
        </div>
      )}

      <div className="pr-section">
        <div className="pr-section__title">Adjustment Note</div>
        <div className="pr-section__body">
          The above amount has been received as an <strong>advance deposit</strong>{" "}
          {receipt.depositPurpose ? `for ${receipt.depositPurpose}` : "against the patient's hospitalization"}.{" "}
          It will be adjusted against the final bill at the time of discharge.
          Any unutilised balance will be refunded as per hospital policy after
          adjustment of all hospital charges.
        </div>
      </div>

      {receipt.estimatedCost != null && (
        <div className="pr-section">
          <div className="pr-section__title">Estimated Total Cost</div>
          <div className="pr-section__body" style={{ display: "flex", justifyContent: "space-between", maxWidth: 360 }}>
            <span>Estimated package / treatment cost</span>
            <strong style={{ color: "#713f12" }}>{fmtINR(toNum(receipt.estimatedCost))}</strong>
          </div>
          <div className="pr-section__body" style={{ display: "flex", justifyContent: "space-between", maxWidth: 360 }}>
            <span>Less: Advance received today</span>
            <strong>- {fmtINR(amount)}</strong>
          </div>
          <div className="pr-section__body" style={{
            display: "flex", justifyContent: "space-between", maxWidth: 360,
            borderTop: "1.5px solid #cbd5e1", marginTop: 4, paddingTop: 4,
            fontWeight: 800,
          }}>
            <span>Estimated Balance</span>
            <strong>{fmtINR(Math.max(0, toNum(receipt.estimatedCost) - amount))}</strong>
          </div>
        </div>
      )}
    </PrintShell>
  );
};

export default AdvanceReceipt;
