// Components/print/printables/OPDReceipt.jsx
// OPD billing receipt — services / consultations / charges with totals.
// Half-A4 friendly so a single OPD bill fits on a half-fold receipt.
//
// R7bf-F / A4-CRIT-3: GST tax-invoice fields rendered when present —
//   - "TAX INVOICE" label in header
//   - hospital GSTIN (PrintShell already shows this in the header)
//   - customer GSTIN + legal name + place of supply when B2B
//   - per-line HSN/SAC
//   - CGST/SGST split per slab (or IGST for inter-state)
//   - total in words via numberToIndianWords
// R7bf-F / A4-MED-5: bill-line-row class for page-break-inside: avoid.

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

const OPDReceipt = ({ settings, receipt = {} }) => {
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const subtotal = items.reduce((s, it) => s + toNum(it.amount), 0);
  const discount = toNum(receipt.discount);
  const tax      = toNum(receipt.tax);
  const cgst     = toNum(receipt.cgstAmount);
  const sgst     = toNum(receipt.sgstAmount);
  const igst     = toNum(receipt.igstAmount);
  const grand    = subtotal - discount + (cgst + sgst + igst || tax);

  // Detect tax invoice mode — render header "TAX INVOICE" + extra B2B
  // strip when ANY of customer GSTIN / place of supply / any item HSN
  // is populated. Hospital GSTIN already prints via the PrintShell
  // header. The OR keeps backward compat with retail bills which had
  // none of these fields and should remain "OPD Bill / Receipt".
  const hasGstFields = !!(
    receipt.customerGstin ||
    receipt.placeOfSupply ||
    items.some((it) => it.hsnSacCode || it.hsnSac)
  );

  const printCount = toNum(receipt.printCount);
  const docTitle = hasGstFields ? "Tax Invoice (OPD)" : "OPD Bill / Receipt";

  return (
    <PrintShell
      settings={settings}
      documentTitle={docTitle}
      serialNo={receipt.receiptNo || receipt.invoiceNo || receipt.billNumber}
      printCount={printCount}
      watermarkRecipient={hasGstFields ? "RECIPIENT" : undefined}
      infoItems={[
        { label: "Patient",    value: receipt.patientName },
        { label: "UHID",       value: receipt.uhid },
        { label: "Age / Sex",  value: [receipt.age && `${receipt.age}Y`, receipt.gender].filter(Boolean).join(" / ") },
        { label: "Doctor",     value: receipt.doctorName },
        { label: "Department", value: receipt.department },
        { label: "Visit Date", value: receipt.visitDate
            ? new Date(receipt.visitDate).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : "—" },
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

      {/* Totals box */}
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

      {/* Payment method chip */}
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

export default OPDReceipt;
