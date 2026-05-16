// Components/print/printables/AdvanceReceipt.jsx
// Advance / Deposit receipt — money taken at admission, before billing
// starts. Will be adjusted against the final bill.

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR, amountInWords } from "../amountWords";

const AdvanceReceipt = ({ settings, receipt = {} }) => {
  const amount = Number(receipt.amount) || 0;
  return (
    <PrintShell
      settings={settings}
      documentTitle="Advance / Deposit Receipt"
      serialNo={receipt.receiptNo}
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
        <strong>In words:</strong> {amountInWords(amount)}
      </div>

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
            <strong style={{ color: "#713f12" }}>{fmtINR(receipt.estimatedCost)}</strong>
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
            <strong>{fmtINR(Math.max(0, Number(receipt.estimatedCost) - amount))}</strong>
          </div>
        </div>
      )}
    </PrintShell>
  );
};

export default AdvanceReceipt;
