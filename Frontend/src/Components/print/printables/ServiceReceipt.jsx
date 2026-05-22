// Components/print/printables/ServiceReceipt.jsx
// R7b-HIGH-3b: dedicated receipt for walk-in SERVICE bills (lab tests,
// imaging packages, day procedures with no admission, miscellaneous
// charges). Same line-item + totals shape as OPDReceipt but the header
// uses Service Date / Reference labels instead of Doctor / Department /
// Visit Date, which are OPD-specific. Half-A4 friendly.
//
// Caller fires this via `openPrint("service-receipt", payload)` after a
// SERVICE bill is generated or paid — see ReceptionBilling.printReceipt
// which now branches on `bill.visitType === "SERVICE"`.
//
// R7bf-F / A4-CRIT-3: GST tax-invoice gaps closed — HSN/SAC, GST split,
// customer GSTIN, place of supply, total in words.
// R7bf-F / A4-CRIT-5: DUPLICATE watermark via PrintShell printCount prop.
// R7bf-F / A4-MED-5: bill-line-row class for page-break-inside: avoid.

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

const ServiceReceipt = ({ settings, receipt = {} }) => {
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const subtotal = items.reduce((s, it) => s + toNum(it.amount), 0);
  const discount = toNum(receipt.discount);
  const tax      = toNum(receipt.tax);
  const cgst     = toNum(receipt.cgstAmount);
  const sgst     = toNum(receipt.sgstAmount);
  const igst     = toNum(receipt.igstAmount);
  const grand    = subtotal - discount + (cgst + sgst + igst || tax);

  const hasGstFields = !!(
    receipt.customerGstin ||
    receipt.placeOfSupply ||
    items.some((it) => it.hsnSacCode || it.hsnSac)
  );
  const printCount = toNum(receipt.printCount);
  const docTitle = hasGstFields ? "Tax Invoice (Service)" : "Service Bill / Receipt";

  return (
    <PrintShell
      settings={settings}
      documentTitle={docTitle}
      serialNo={receipt.receiptNo || receipt.invoiceNo || receipt.billNumber}
      printCount={printCount}
      watermarkRecipient={hasGstFields ? "RECIPIENT" : undefined}
      infoItems={[
        { label: "Patient",      value: receipt.patientName },
        { label: "UHID",         value: receipt.uhid },
        { label: "Age / Sex",    value: [receipt.age && `${receipt.age}Y`, receipt.gender].filter(Boolean).join(" / ") },
        { label: "Service Date", value: receipt.serviceDate || receipt.visitDate
            ? new Date(receipt.serviceDate || receipt.visitDate).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : "—" },
        { label: "Reference",    value: receipt.referredBy || receipt.referralSource || "Walk-in" },
        { label: "Counter",      value: receipt.counter || "Reception" },
        ...(hasGstFields ? [
          { label: "Place of Supply", value: receipt.placeOfSupply || "—" },
          { label: "Customer GSTIN",  value: receipt.customerGstin || "—" },
        ] : []),
      ]}
    >
      {hasGstFields && (receipt.customerLegalName || receipt.customerAddress) && (
        <div className="pr-section">
          <div className="pr-section__title">Bill To (Customer)</div>
          <div className="pr-section__body" style={{ fontSize: 11 }}>
            {receipt.customerLegalName && <div><strong>{receipt.customerLegalName}</strong></div>}
            {receipt.customerAddress && <div>{receipt.customerAddress}</div>}
            {receipt.customerGstin && <div>GSTIN: <strong>{receipt.customerGstin}</strong></div>}
          </div>
        </div>
      )}

      <div className={hasGstFields ? "pr-gst-invoice" : ""}>
        <table className="pr-table">
          <thead>
            <tr>
              <th style={{ width: 30 }}>#</th>
              <th>Service / Particulars</th>
              {hasGstFields && <th style={{ width: 70 }}>HSN/SAC</th>}
              <th className="center" style={{ width: 50 }}>Qty</th>
              <th className="right" style={{ width: 75 }}>Rate (₹)</th>
              {hasGstFields && <th className="right" style={{ width: 60 }}>GST %</th>}
              <th className="right" style={{ width: 85 }}>Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={hasGstFields ? 7 : 5} className="muted center">No items billed.</td></tr>
            ) : items.map((it, i) => (
              <tr key={i} className="bill-line-row">
                <td>{i + 1}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{it.name || it.service || it.serviceName || "—"}</div>
                  {it.description && <div className="muted" style={{ fontSize: 10 }}>{it.description}</div>}
                </td>
                {hasGstFields && <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 10 }}>{it.hsnSacCode || it.hsnSac || "—"}</td>}
                <td className="center">{it.qty || it.quantity || 1}</td>
                <td className="right">{toNum(it.rate || it.unitPrice || it.amount).toLocaleString("en-IN")}</td>
                {hasGstFields && <td className="right">{toNum(it.taxPercent ?? it.gstRate ?? 0)}%</td>}
                <td className="right">{toNum(it.amount).toLocaleString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pr-totals">
        <div className="pr-totals__row">
          <span className="pr-totals__lbl">Subtotal (Taxable Value)</span>
          <span className="pr-totals__val">{fmtINR(subtotal - (cgst + sgst + igst))}</span>
        </div>
        {discount > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Discount</span>
            <span className="pr-totals__val">- {fmtINR(discount)}</span>
          </div>
        )}
        {cgst > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">CGST</span>
            <span className="pr-totals__val">+ {fmtINR(cgst)}</span>
          </div>
        )}
        {sgst > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">SGST</span>
            <span className="pr-totals__val">+ {fmtINR(sgst)}</span>
          </div>
        )}
        {igst > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">IGST</span>
            <span className="pr-totals__val">+ {fmtINR(igst)}</span>
          </div>
        )}
        {(!cgst && !sgst && !igst && tax > 0) && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">GST / Tax</span>
            <span className="pr-totals__val">+ {fmtINR(tax)}</span>
          </div>
        )}
        <div className="pr-totals__row pr-totals__row--grand">
          <span className="pr-totals__lbl">Grand Total</span>
          <span className="pr-totals__val">{fmtINR(grand)}</span>
        </div>
      </div>

      <div className="pr-amount-words">
        <strong>Amount in words:</strong> {numberToIndianWords(grand)}
      </div>

      {receipt.paymentMethod && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, fontSize: 11 }}>
          <span style={{ color: "#475569", fontWeight: 700 }}>Paid via:</span>
          <span className={`pr-paymethod pr-paymethod--${String(receipt.paymentMethod).toLowerCase()}`}>
            {receipt.paymentMethod.toUpperCase()}
          </span>
          {receipt.paymentRef && (
            <span style={{ color: "#64748b", fontSize: 10.5 }}>Ref: {receipt.paymentRef}</span>
          )}
        </div>
      )}
    </PrintShell>
  );
};

export default ServiceReceipt;
