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

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR, amountInWords } from "../amountWords";

const ServiceReceipt = ({ settings, receipt = {} }) => {
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const subtotal = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const discount = Number(receipt.discount) || 0;
  const tax      = Number(receipt.tax)      || 0;
  const grand    = subtotal - discount + tax;

  return (
    <PrintShell
      settings={settings}
      documentTitle="Service Bill / Receipt"
      serialNo={receipt.receiptNo || receipt.invoiceNo}
      infoItems={[
        { label: "Patient",      value: receipt.patientName },
        { label: "UHID",         value: receipt.uhid },
        { label: "Age / Sex",    value: [receipt.age && `${receipt.age}Y`, receipt.gender].filter(Boolean).join(" / ") },
        { label: "Service Date", value: receipt.serviceDate || receipt.visitDate
            ? new Date(receipt.serviceDate || receipt.visitDate).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : "—" },
        { label: "Reference",    value: receipt.referredBy || receipt.referralSource || "Walk-in" },
        { label: "Counter",      value: receipt.counter || "Reception" },
      ]}
    >
      <table className="pr-table">
        <thead>
          <tr>
            <th style={{ width: 32 }}>#</th>
            <th>Service / Particulars</th>
            <th className="center" style={{ width: 60 }}>Qty</th>
            <th className="right" style={{ width: 90 }}>Rate (₹)</th>
            <th className="right" style={{ width: 100 }}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={5} className="muted center">No items billed.</td></tr>
          ) : items.map((it, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <div style={{ fontWeight: 600 }}>{it.name || it.service || "—"}</div>
                {it.description && <div className="muted" style={{ fontSize: 10 }}>{it.description}</div>}
              </td>
              <td className="center">{it.qty || 1}</td>
              <td className="right">{Number(it.rate || it.amount || 0).toLocaleString("en-IN")}</td>
              <td className="right">{Number(it.amount || 0).toLocaleString("en-IN")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pr-totals">
        <div className="pr-totals__row">
          <span className="pr-totals__lbl">Subtotal</span>
          <span className="pr-totals__val">{fmtINR(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Discount</span>
            <span className="pr-totals__val">- {fmtINR(discount)}</span>
          </div>
        )}
        {tax > 0 && (
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
        <strong>Amount in words:</strong> {amountInWords(grand)}
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
