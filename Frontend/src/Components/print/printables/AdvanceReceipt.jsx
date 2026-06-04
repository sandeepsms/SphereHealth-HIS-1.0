// Components/print/printables/AdvanceReceipt.jsx
// Advance / Deposit receipt — money taken at admission, before billing
// starts. Will be adjusted against the final bill.
//
// R7fq Track A: refactored onto the new shared <PrintShell> contract.
// Hospital logo + name + address now live entirely in the shell.
//
// Patient-strip mapping (per Track-A contract):
//   left:  Receipt No · UMID · Patient Name · Gender/Age · Contact · Address
//   right: Receipt Date · IP No · Admission Date · Payer · Doctor · Specialization
//
// R7bh-F7 / R7bg-7-HIGH-1: 2026 GST circular — advances ≥ ₹50,000 must
// capture the customer's GSTIN on the receipt (B2B threshold). The
// hospital's GSTIN prints in the shell header from settings.

import React from "react";
import PrintShell from "@/templates/PrintShell";
import { fmtINR } from "../amountWords";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
      })
    : "—";
const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "—";

const AdvanceReceipt = ({ settings = {}, receipt = {} }) => {
  const amount = toNum(receipt.amount);
  const printCount = toNum(receipt.printCount);
  // 2026 GST circular — advances ≥ ₹50,000 must capture customer GSTIN.
  const HIGH_VALUE_GST_THRESHOLD = 50000;
  const customerGstin = receipt.customerGstin || receipt.gstin;
  const requiresGstin = amount >= HIGH_VALUE_GST_THRESHOLD;
  const missingGstinForHighValue = requiresGstin && !customerGstin;

  const receiptNo = receipt.receiptNo || "—";
  const genderAge = [receipt.gender, receipt.age && `${receipt.age}Y`]
    .filter(Boolean).join(" ");

  const patientLeft = [
    { label: "Receipt No",   value: receiptNo },
    { label: "UMID",         value: receipt.uhid || "—" },
    { label: "Patient Name", value: receipt.patientName || "—" },
    { label: "Gender/Age",   value: genderAge || "—" },
    { label: "Contact",      value: receipt.contactNumber || receipt.mobile || "—" },
    { label: "Address",      value: receipt.completeAddress || receipt.address || "—" },
  ];
  const patientRight = [
    { label: "Receipt Date",   value: fmtDateTime(receipt.date || new Date().toISOString()) },
    { label: "IP No",          value: receipt.ipdNo || "—" },
    { label: "Admission Date", value: fmtDate(receipt.admissionDate) },
    { label: "Payer",          value: receipt.payer || "Self" },
    { label: "Doctor",         value: receipt.doctor || "—" },
    { label: "Specialization", value: receipt.department || "—" },
  ];

  return (
    <PrintShell
      hospital={settings}
      // R7bf-F / A4-HIGH-4: explicit override so customers can tell apart
      // a deposit slip from a tax invoice.
      docTitle="Advance Receipt"
      patient={{ left: patientLeft, right: patientRight }}
      signatures={{
        type: "prepared-by",
        preparedBy: { name: receipt.preparedBy || receipt.cashier || "Cashier", role: "Cashier" },
        showAttestedStamp: true,
      }}
      banners={{ emergency24x7: true }}
      meta={{
        docNumber: receiptNo,
        pageOf: "1 of 1",
        printCount,
      }}
    >
      {/* Body: bordered single-row table — Particulars · Amount (₹) */}
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
              <div style={{ fontWeight: 600 }}>Advance Deposit</div>
              {receipt.depositPurpose && (
                <div className="muted" style={{ fontSize: 10 }}>{receipt.depositPurpose}</div>
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
        {/* R7hr-12-S2 (D7-03): numberToIndianWords() already terminates
            with " Only" (utils/printUtils.js L99) — the literal " only"
            suffix double-stamped patient-facing receipts as
            "Rupees X Only only". Drop the suffix and terminate with a
            period, mirroring PharmacyBill's R7hr-7 Fix #5 pattern. */}
        Received an amount of (Rs.) {numberToIndianWords(amount)}.
      </div>

      {/* Track-A contract: Note line for AdvanceReceipt */}
      <div style={{ marginTop: 8, marginBottom: 10, fontSize: 11, fontWeight: 600 }}>
        Note: This Receipt is required to be produced at the time of discharge at Billing Counter.
      </div>

      {/* Payment method chip */}
      {receipt.method && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, fontSize: 11 }}>
          <span style={{ color: "#475569", fontWeight: 700 }}>Paid via:</span>
          <span className={`pr-paymethod pr-paymethod--${String(receipt.method).toLowerCase()}`}>
            {String(receipt.method).toUpperCase()}
          </span>
          {receipt.refNo && (
            <span style={{ color: "#64748b", fontSize: 10.5 }}>Ref: {receipt.refNo}</span>
          )}
        </div>
      )}

      {missingGstinForHighValue && (
        <div style={{
          background: "#fef2f2", border: "1.5px solid #fecaca", color: "#7f1d1d",
          padding: "8px 14px", borderRadius: 6, marginBottom: 12,
          fontSize: 11, fontWeight: 700,
        }}>
          GST COMPLIANCE — Advances of Rs.50,000 or more require the depositor's GSTIN
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
