// Components/print/printables/CostEstimate.jsx
// Pre-treatment / pre-admission cost estimate. Given to a patient
// before they agree to a surgery / IPD package, so they know what
// to expect financially. NABH PRE.4 — patient must be informed of
// estimated cost before consent.

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR, amountInWords } from "../amountWords";

const CostEstimate = ({ settings, receipt = {} }) => {
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const subtotal = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const tax      = Number(receipt.tax) || 0;
  const total    = subtotal + tax;
  const totalLow  = receipt.totalLow  != null ? Number(receipt.totalLow)  : total * 0.9;
  const totalHigh = receipt.totalHigh != null ? Number(receipt.totalHigh) : total * 1.15;

  return (
    <PrintShell
      settings={settings}
      documentTitle="Cost Estimate · Indicative"
      serialNo={receipt.estimateNo}
      infoItems={[
        { label: "Patient",      value: receipt.patientName },
        { label: "UHID",         value: receipt.uhid },
        { label: "Age / Sex",    value: [receipt.age && `${receipt.age}Y`, receipt.gender].filter(Boolean).join(" / ") },
        { label: "Procedure",    value: receipt.procedure },
        { label: "Ward / Class", value: receipt.wardClass || receipt.roomCategory },
        { label: "Consultant",   value: receipt.consultantName },
        { label: "Est. Stay",    value: receipt.estimatedDays ? `${receipt.estimatedDays} day${receipt.estimatedDays === 1 ? "" : "s"}` : "—" },
        { label: "Estimate Date",value: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) },
      ]}
      signatureLabels={["Authorised Estimator", "Patient / Attendant"]}
    >
      <div style={{
        background: "#fef3c7", border: "1.5px solid #facc15", borderRadius: 8,
        padding: "10px 14px", marginBottom: 14, fontSize: 11.5, color: "#713f12",
      }}>
        <strong>⚠ This is an indicative estimate.</strong> The final bill may vary based on length of stay,
        additional investigations, complications, change of ward category, consumables used, or any
        unforeseen medical requirements. Actual charges will appear on the final bill.
      </div>

      <table className="pr-table">
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            <th>Item / Service</th>
            <th className="center" style={{ width: 70 }}>Qty / Days</th>
            <th className="right" style={{ width: 100 }}>Rate (₹)</th>
            <th className="right" style={{ width: 110 }}>Estimated (₹)</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={5} className="muted center" style={{ padding: 20 }}>No line items configured.</td></tr>
          ) : items.map((it, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <strong>{it.name || it.service}</strong>
                {it.category && <div className="muted" style={{ fontSize: 9.5 }}>{it.category}</div>}
                {it.description && <div className="muted" style={{ fontSize: 9.5 }}>{it.description}</div>}
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
        {tax > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">GST / Tax</span>
            <span className="pr-totals__val">+ {fmtINR(tax)}</span>
          </div>
        )}
        <div className="pr-totals__row pr-totals__row--grand">
          <span className="pr-totals__lbl">Estimated Total</span>
          <span className="pr-totals__val">{fmtINR(total)}</span>
        </div>
        <div className="pr-totals__row" style={{ background: "#f8fafc", fontSize: 10.5 }}>
          <span className="pr-totals__lbl">Likely range</span>
          <span className="pr-totals__val">{fmtINR(totalLow)} – {fmtINR(totalHigh)}</span>
        </div>
      </div>

      <div className="pr-amount-words">
        <strong>Estimated amount in words:</strong> {amountInWords(total)}
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Patient Acknowledgement</div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          I/we have been counselled about the estimated cost of treatment as above. I/we understand that
          this is an indicative figure and the actual bill may differ. I/we agree to make payments as per
          hospital policy (advance at admission, interim deposits as required, and balance at discharge).
        </div>
      </div>
    </PrintShell>
  );
};

export default CostEstimate;
