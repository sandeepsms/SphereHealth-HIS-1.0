// Components/print/printables/CreditNotePrint.jsx
// R7bh-F7 / R7bg-7-CRIT-3 + R7bg-1-CRIT-11: GST Credit Note (§34) print.
// Issued whenever a tax invoice is partially or fully reversed (refund,
// cancellation, return). Carries the original bill reference, GSTIN of
// supplier + recipient (when present), reason for issue, item-by-item
// reversal with GST per slab, and the total tax reversed (which the
// hospital reports on GSTR-1 Table 9B).

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

const fmtD = (d) => d
  ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  : "—";
const fmtDT = (d) => d
  ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "—";

const CreditNotePrint = ({ settings = {}, receipt = {} }) => {
  const r = receipt;
  const printCount = toNum(r.printCount);
  const items = Array.isArray(r.items) ? r.items : [];

  // R7eo-D — Pattern D regulatory fix (GST §34): derive isInterState from
  // placeOfSupply vs settings.state instead of silently defaulting to
  // intrastate. The previous code made every CN intrastate by default,
  // which mis-bookkeeps CGST/SGST for genuinely inter-state transactions.
  const computedInterState =
    (r.placeOfSupply || "").trim().toLowerCase() !==
    (settings.state || "").trim().toLowerCase();
  const effectiveInterState = r.isInterState ?? (r.placeOfSupply ? computedInterState : false);

  // R7eo-D — Pattern D regulatory fix (GST §34(1)): credit note MUST cite
  // the original tax-invoice number — without it, the CN cannot be filed
  // on GSTR-1 Table 9B and is legally void.
  const originalBillRef = r.originalBillNumber || r.originalBillNo;
  const originalBillMissing = !originalBillRef;

  // Aggregate by GST slab — required on the credit note + matches the
  // GSTR-1 9B line items so the accountant can directly map.
  const slabMap = new Map();
  let totalTaxable = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalNet = 0;

  for (const it of items) {
    const qty = toNum(it.quantity ?? it.qty);
    const rate = toNum(it.rate ?? it.unitPrice);
    const gstPct = toNum(it.gstRate ?? it.taxPercent);
    const taxable = toNum(it.taxableAmount ?? (qty * rate));
    const tax = toNum(it.gstAmount ?? (taxable * gstPct / 100));
    const cgst = toNum(it.cgstAmount ?? (effectiveInterState ? 0 : tax / 2));
    const sgst = toNum(it.sgstAmount ?? (effectiveInterState ? 0 : tax / 2));
    const igst = toNum(it.igstAmount ?? (effectiveInterState ? tax : 0));
    totalTaxable += taxable;
    totalCgst += cgst;
    totalSgst += sgst;
    totalIgst += igst;
    totalNet += (taxable + cgst + sgst + igst);

    const key = `${gstPct}`;
    if (!slabMap.has(key)) slabMap.set(key, { gstPct, taxable: 0, cgst: 0, sgst: 0, igst: 0 });
    const row = slabMap.get(key);
    row.taxable += taxable;
    row.cgst += cgst;
    row.sgst += sgst;
    row.igst += igst;
  }
  const slabs = [...slabMap.values()].sort((a, b) => a.gstPct - b.gstPct);
  const totalTax = totalCgst + totalSgst + totalIgst;
  const grandTotal = toNum(r.totalReversed ?? r.grandTotal ?? totalNet);

  return (
    <PrintShell
      settings={settings}
      documentTitle="Credit Note (GST §34)"
      serialNo={r.creditNoteNumber || r.cnNo}
      printCount={printCount}
      watermarkRecipient="RECIPIENT"
      infoItems={[
        { label: "CN Number",       value: r.creditNoteNumber || r.cnNo },
        { label: "CN Date",         value: fmtDT(r.creditNoteDate || r.date || new Date()) },
        { label: "Original Bill",   value: r.originalBillNumber || r.originalBillNo },
        { label: "Bill Date",       value: fmtD(r.originalBillDate) },
        { label: "Patient",         value: r.patientName },
        { label: "UHID",            value: r.uhid },
        { label: "IPD / OPD No",    value: r.ipdNo || r.opdNo },
        { label: "Place of Supply", value: r.placeOfSupply || "—" },
        { label: "Hospital GSTIN",  value: settings.gstin },
        { label: "Customer GSTIN",  value: r.customerGstin || "—" },
        { label: "Issued By",       value: r.issuedBy || r.cashierName },
      ]}
      signatureLabels={["Authorised Signatory", "Recipient"]}
    >
      {/* R7eo-D — Pattern D regulatory fix (GST §34(1)): blocking banner
          when the credit note has no original tax-invoice reference. */}
      {originalBillMissing && (
        <div style={{
          background: "#dc2626", border: "2px solid #7f1d1d", color: "#ffffff",
          padding: "12px 16px", borderRadius: 8, marginBottom: 12,
          fontSize: 12.5, fontWeight: 800, textAlign: "center",
          textTransform: "uppercase", letterSpacing: ".5px",
        }}>
          ORIGINAL INVOICE REFERENCE MISSING — INVALID UNDER GST §34(1).<br/>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "none", letterSpacing: 0 }}>
            This credit note cannot be filed with GST returns.
          </span>
        </div>
      )}
      <div style={{
        background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b",
        padding: "10px 14px", borderRadius: 6, marginBottom: 12, fontSize: 11,
      }}>
        <strong>CREDIT NOTE</strong> — issued under GST Rules §34 against tax invoice <strong>{originalBillRef || "—"}</strong>.
        This document REVERSES the corresponding portion of the original invoice for GSTR-1 (Table 9B) reporting.
      </div>

      {/* Bill-To (customer) block — required if customer GSTIN is set */}
      {(r.customerLegalName || r.customerGstin || r.customerAddress) && (
        <div className="pr-section">
          <div className="pr-section__title">Recipient (Bill To)</div>
          <div className="pr-section__body" style={{ fontSize: 11 }}>
            {r.customerLegalName && <div><strong>{r.customerLegalName}</strong></div>}
            {r.customerAddress && <div>{r.customerAddress}</div>}
            {r.customerGstin && <div>GSTIN: <strong>{r.customerGstin}</strong></div>}
          </div>
        </div>
      )}

      {/* Reason */}
      <div className="pr-section">
        <div className="pr-section__title">Reason for Credit Note</div>
        <div className="pr-section__body" style={{ whiteSpace: "pre-wrap", fontSize: 11.5 }}>
          {r.reason || r.cause || "Cancellation / partial refund of services billed under the original tax invoice."}
        </div>
      </div>

      {/* Item-by-item reversal */}
      <div className="pr-section">
        <div className="pr-section__title">Items Reversed</div>
        <table className="pr-table">
          <thead>
            <tr>
              <th style={{ width: 30 }}>#</th>
              <th>Particulars</th>
              <th style={{ width: 70 }}>HSN/SAC</th>
              <th className="center" style={{ width: 45 }}>Qty</th>
              <th className="right" style={{ width: 75 }}>Rate (₹)</th>
              <th className="right" style={{ width: 50 }}>GST %</th>
              <th className="right" style={{ width: 80 }}>Taxable (₹)</th>
              <th className="right" style={{ width: 80 }}>Tax (₹)</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={8} className="muted center" style={{ padding: 16, fontStyle: "italic" }}>No line items.</td></tr>
            ) : items.map((it, i) => {
              const qty = toNum(it.quantity ?? it.qty);
              const rate = toNum(it.rate ?? it.unitPrice);
              const gstPct = toNum(it.gstRate ?? it.taxPercent);
              const taxable = toNum(it.taxableAmount ?? (qty * rate));
              const tax = toNum(it.gstAmount ?? (taxable * gstPct / 100));
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{it.name || it.particulars || it.drugName}</div>
                    {it.description && <div className="muted" style={{ fontSize: 10 }}>{it.description}</div>}
                  </td>
                  <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 10 }}>{it.hsnSacCode || it.hsnCode || "—"}</td>
                  <td className="center">{qty || "—"}</td>
                  <td className="right">{rate ? rate.toLocaleString("en-IN") : "—"}</td>
                  <td className="right">{gstPct}%</td>
                  <td className="right">{fmtINR(taxable)}</td>
                  <td className="right">{fmtINR(tax)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* GST slab summary — matches GSTR-1 Table 9B fields */}
      {slabs.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Tax Reversed (slab-wise — for GSTR-1 Table 9B)</div>
          <table className="pr-table" style={{ fontSize: 10.5 }}>
            <thead>
              <tr>
                <th className="right" style={{ width: 70 }}>GST Rate</th>
                <th className="right">Taxable (₹)</th>
                <th className="right">CGST (₹)</th>
                <th className="right">SGST (₹)</th>
                <th className="right">IGST (₹)</th>
                <th className="right">Total Tax (₹)</th>
              </tr>
            </thead>
            <tbody>
              {slabs.map((s, i) => (
                <tr key={i}>
                  <td className="right">{s.gstPct}%</td>
                  <td className="right">{fmtINR(s.taxable)}</td>
                  <td className="right">{s.cgst > 0 ? fmtINR(s.cgst) : "—"}</td>
                  <td className="right">{s.sgst > 0 ? fmtINR(s.sgst) : "—"}</td>
                  <td className="right">{s.igst > 0 ? fmtINR(s.igst) : "—"}</td>
                  <td className="right" style={{ fontWeight: 700 }}>{fmtINR(s.cgst + s.sgst + s.igst)}</td>
                </tr>
              ))}
              <tr style={{ background: "#f8fafc", fontWeight: 800 }}>
                <td className="right">Total</td>
                <td className="right">{fmtINR(totalTaxable)}</td>
                <td className="right">{fmtINR(totalCgst)}</td>
                <td className="right">{fmtINR(totalSgst)}</td>
                <td className="right">{fmtINR(totalIgst)}</td>
                <td className="right">{fmtINR(totalTax)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="pr-totals">
        <div className="pr-totals__row">
          <span className="pr-totals__lbl">Total Taxable Reversed</span>
          <span className="pr-totals__val">{fmtINR(totalTaxable)}</span>
        </div>
        <div className="pr-totals__row">
          <span className="pr-totals__lbl">Total Tax Reversed</span>
          <span className="pr-totals__val">{fmtINR(totalTax)}</span>
        </div>
        <div className="pr-totals__row pr-totals__row--grand">
          <span className="pr-totals__lbl">Credit Note Total</span>
          <span className="pr-totals__val">{fmtINR(grandTotal)}</span>
        </div>
      </div>

      <div className="pr-amount-words">
        <strong>Credit Note total in words: </strong>
        {numberToIndianWords(grandTotal)}
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Statutory Disclosure</div>
        <div className="pr-section__body" style={{ fontSize: 10.5, lineHeight: 1.55 }}>
          This Credit Note has been issued in pursuance of Section 34 of the CGST Act, 2017 and corresponding
          provisions of the SGST/IGST Acts. The corresponding output tax liability for the supplier will be
          reduced and reported in GSTR-1 Table 9B for the tax period of issue. The recipient (where registered)
          is required to reverse the corresponding input tax credit availed on the original invoice.
        </div>
      </div>
    </PrintShell>
  );
};

export default CreditNotePrint;
