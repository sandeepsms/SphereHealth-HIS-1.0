/**
 * PharmacyBill.jsx — GST tax-invoice for pharmacy dispense.
 *
 * Compliant with: Indian GST law (CGST/SGST split for intra-state,
 * IGST for inter-state) + Drugs & Cosmetics Rules (batch + expiry
 * required on every dispense).
 *
 * Layout: header (hospital + GSTIN) → bill meta → patient + doctor →
 *   item table (incl. HSN, batch, expiry, qty, rate, disc, taxable,
 *   tax-rate, tax-amt, total) → HSN-wise tax summary → totals +
 *   amount-in-words → payment summary → terms + signatures.
 *
 * Paper sizes supported via the standard PrintPreviewPage toolbar:
 *   half-a4 (default — typical pharmacy slip)
 *   a4      (formal tax invoice)
 *   a5      (compact)
 */
import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR, amountInWords } from "../amountWords";

const fmtDate = (d, opts) => d
  ? new Date(d).toLocaleDateString("en-IN", opts || { day: "2-digit", month: "short", year: "numeric" })
  : "—";

const PharmacyBill = ({ settings, receipt = {} }) => {
  const r = receipt;
  const items = Array.isArray(r.items) ? r.items : [];

  // Determine inter-state vs intra-state to split CGST/SGST or use IGST.
  // If supply state matches hospital state → intra-state → CGST + SGST.
  // Else IGST.
  const hospitalState = String(settings?.state || "").trim().toLowerCase();
  const customerState = String(r.customerState || hospitalState).trim().toLowerCase();
  const isInterState  = !!customerState && !!hospitalState && customerState !== hospitalState;

  // HSN-wise tax breakup
  const hsnMap = new Map();
  let subTotal = 0, totalDisc = 0, totalTaxable = 0, totalTax = 0;
  for (const it of items) {
    const qty   = Number(it.quantity || it.qty || 0);
    const rate  = Number(it.unitPrice || it.rate || 0);
    const gst   = Number(it.gstRate ?? 12);
    const gross = qty * rate;
    const disc  = Number(it.discountAmount != null ? it.discountAmount : gross * (Number(it.discountPercent || 0) / 100));
    const taxable = Number(it.taxableAmount != null ? it.taxableAmount : gross - disc);
    const tax     = Number(it.gstAmount != null ? it.gstAmount : taxable * (gst / 100));
    subTotal     += gross;
    totalDisc    += disc;
    totalTaxable += taxable;
    totalTax     += tax;

    const hsn = it.hsnCode || "30049099";
    const key = `${hsn}__${gst}`;
    if (!hsnMap.has(key)) hsnMap.set(key, { hsn, gstRate: gst, taxable: 0, tax: 0, qty: 0 });
    const row = hsnMap.get(key);
    row.taxable += taxable;
    row.tax     += tax;
    row.qty     += qty;
  }
  const hsnRows = [...hsnMap.values()];

  const grandRaw = totalTaxable + totalTax;
  const grandTotal = Number(r.grandTotal != null ? r.grandTotal : Math.round(grandRaw));
  const roundOff   = Number(r.roundOff != null ? r.roundOff : grandTotal - grandRaw);
  const paid       = Number(r.amountPaid != null ? r.amountPaid : grandTotal);
  const balance    = Math.max(0, grandTotal - paid);

  return (
    <PrintShell
      settings={settings}
      documentTitle="Tax Invoice · Pharmacy"
      serialNo={r.billNumber}
      infoItems={[
        { label: "Bill No",      value: r.billNumber },
        { label: "Date / Time",  value: r.createdAt ? new Date(r.createdAt).toLocaleString("en-IN") : new Date().toLocaleString("en-IN") },
        { label: "Patient",      value: r.patientName || "Walk-in customer" },
        { label: "UHID",         value: r.patientUHID || "—" },
        { label: "Age / Sex",    value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") || "—" },
        { label: "Contact",      value: r.contactNumber || "—" },
        { label: "Doctor",       value: r.doctorName || "—" },
        ...(r.admissionNumber ? [{ label: "IPD / Adm No", value: r.admissionNumber }] : []),
        { label: "Sale Type",    value: r.saleType || "Walk-in" },
        { label: "Pharmacist",   value: r.createdBy || "—" },
      ]}
      signatureLabels={["Pharmacist Signature", "Receiver Signature"]}
    >
      {/* ════ ITEMS ════ */}
      <table className="pr-table" style={{ marginBottom: 12 }}>
        <thead>
          <tr>
            <th style={{ width: "4%"   }}>#</th>
            <th style={{ width: "26%"  }}>Medicine / Description</th>
            <th style={{ width: "8%"   }}>HSN</th>
            <th style={{ width: "12%"  }}>Batch</th>
            <th style={{ width: "8%"   }}>Expiry</th>
            <th style={{ width: "5%", textAlign: "right" }}>Qty</th>
            <th style={{ width: "7%", textAlign: "right" }}>Rate</th>
            <th style={{ width: "5%", textAlign: "right" }}>Disc</th>
            <th style={{ width: "8%", textAlign: "right" }}>Taxable</th>
            <th style={{ width: "5%", textAlign: "right" }}>GST %</th>
            <th style={{ width: "12%", textAlign: "right" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={11} style={{ textAlign: "center", padding: 18, color: "#94a3b8" }}>No items.</td></tr>
          ) : items.map((it, i) => {
            const qty   = Number(it.quantity || it.qty || 0);
            const rate  = Number(it.unitPrice || it.rate || 0);
            const gst   = Number(it.gstRate ?? 12);
            const gross = qty * rate;
            const disc  = Number(it.discountAmount != null ? it.discountAmount : gross * (Number(it.discountPercent || 0) / 100));
            const taxable = Number(it.taxableAmount != null ? it.taxableAmount : gross - disc);
            const net     = Number(it.netAmount != null ? it.netAmount : taxable + taxable * gst / 100);
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <div style={{ fontWeight: 700 }}>{it.drugName || it.name}</div>
                  {it.strength && <div className="muted" style={{ fontSize: 9 }}>{it.strength}</div>}
                </td>
                <td>{it.hsnCode || "30049099"}</td>
                <td style={{ fontFamily: "DM Mono, monospace", fontSize: 10 }}>{it.batchNo || "—"}</td>
                <td>{it.expiryDate ? fmtDate(it.expiryDate, { month: "short", year: "2-digit" }) : "—"}</td>
                <td style={{ textAlign: "right" }}>{qty}</td>
                <td style={{ textAlign: "right" }}>{rate.toFixed(2)}</td>
                <td style={{ textAlign: "right" }}>{disc > 0 ? disc.toFixed(2) : "—"}</td>
                <td style={{ textAlign: "right" }}>{taxable.toFixed(2)}</td>
                <td style={{ textAlign: "right" }}>{gst}%</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{net.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ════ HSN-WISE TAX SUMMARY + TOTALS ════ */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12, marginBottom: 12 }}>

        {/* HSN-wise GST breakup */}
        <div className="pr-section">
          <div className="pr-section__title">HSN-wise tax summary</div>
          <table className="pr-table pr-table--sm">
            <thead>
              <tr>
                <th>HSN</th>
                <th style={{ textAlign: "right" }}>Taxable</th>
                {isInterState ? (
                  <>
                    <th style={{ textAlign: "right" }}>IGST %</th>
                    <th style={{ textAlign: "right" }}>IGST ₹</th>
                  </>
                ) : (
                  <>
                    <th style={{ textAlign: "right" }}>CGST</th>
                    <th style={{ textAlign: "right" }}>SGST</th>
                  </>
                )}
                <th style={{ textAlign: "right" }}>Total Tax</th>
              </tr>
            </thead>
            <tbody>
              {hsnRows.map((h, i) => {
                const half = h.tax / 2;
                return (
                  <tr key={i}>
                    <td>{h.hsn}</td>
                    <td style={{ textAlign: "right" }}>{h.taxable.toFixed(2)}</td>
                    {isInterState ? (
                      <>
                        <td style={{ textAlign: "right" }}>{h.gstRate}%</td>
                        <td style={{ textAlign: "right" }}>{h.tax.toFixed(2)}</td>
                      </>
                    ) : (
                      <>
                        <td style={{ textAlign: "right" }}>
                          <span style={{ fontSize: 9, opacity: .7 }}>@{(h.gstRate/2).toFixed(1)}%</span> {half.toFixed(2)}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span style={{ fontSize: 9, opacity: .7 }}>@{(h.gstRate/2).toFixed(1)}%</span> {half.toFixed(2)}
                        </td>
                      </>
                    )}
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{h.tax.toFixed(2)}</td>
                  </tr>
                );
              })}
              <tr className="pr-table__totalrow">
                <td><b>Total</b></td>
                <td style={{ textAlign: "right", fontWeight: 800 }}>{totalTaxable.toFixed(2)}</td>
                {isInterState ? (
                  <>
                    <td />
                    <td style={{ textAlign: "right", fontWeight: 800 }}>{totalTax.toFixed(2)}</td>
                  </>
                ) : (
                  <>
                    <td style={{ textAlign: "right", fontWeight: 800 }}>{(totalTax/2).toFixed(2)}</td>
                    <td style={{ textAlign: "right", fontWeight: 800 }}>{(totalTax/2).toFixed(2)}</td>
                  </>
                )}
                <td style={{ textAlign: "right", fontWeight: 800 }}>{totalTax.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Grand totals */}
        <div className="pr-totals">
          <div className="pr-totals__row"><span>Sub-total</span><span>{fmtINR(subTotal)}</span></div>
          {totalDisc > 0 && (
            <div className="pr-totals__row"><span>Discount</span><span style={{ color: "#dc2626" }}>− {fmtINR(totalDisc)}</span></div>
          )}
          <div className="pr-totals__row"><span>Taxable value</span><span>{fmtINR(totalTaxable)}</span></div>
          {isInterState ? (
            <div className="pr-totals__row"><span>IGST</span><span>+ {fmtINR(totalTax)}</span></div>
          ) : (
            <>
              <div className="pr-totals__row"><span>CGST</span><span>+ {fmtINR(totalTax / 2)}</span></div>
              <div className="pr-totals__row"><span>SGST</span><span>+ {fmtINR(totalTax / 2)}</span></div>
            </>
          )}
          {Math.abs(roundOff) >= 0.01 && (
            <div className="pr-totals__row"><span>Round-off</span><span>{roundOff > 0 ? "+ " : "− "}{fmtINR(Math.abs(roundOff))}</span></div>
          )}
          <div className="pr-totals__row pr-totals__row--grand">
            <span>Grand total</span><span>{fmtINR(grandTotal)}</span>
          </div>
          <div className="pr-totals__row" style={{ borderTop: "1px dashed #94a3b8", marginTop: 6, paddingTop: 6, fontSize: 10 }}>
            <span>Paid ({r.paymentMode || "Cash"})</span><span style={{ color: "#16a34a", fontWeight: 700 }}>{fmtINR(paid)}</span>
          </div>
          {balance > 0 && (
            <div className="pr-totals__row" style={{ fontSize: 10 }}>
              <span>Balance due</span><span style={{ color: "#dc2626", fontWeight: 700 }}>{fmtINR(balance)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Amount in words */}
      <div style={{
        background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 6,
        padding: "8px 12px", marginBottom: 10, fontSize: 10.5,
      }}>
        <b>Rupees in words:</b> {amountInWords(grandTotal)}
      </div>

      {/* Schedule-H + narcotic banner */}
      {items.some(it => it.schedule && /^(H|H1|X)$/i.test(it.schedule)) && (
        <div style={{
          border: "1.5px solid #dc2626", borderRadius: 6, padding: "8px 12px",
          background: "#fef2f2", marginBottom: 10, fontSize: 10,
        }}>
          <b style={{ color: "#dc2626" }}>⚠ Schedule H/H1/X medicines dispensed.</b> To be sold only on a registered medical practitioner's prescription. Prescription retained for record per Drugs &amp; Cosmetics Rules.
        </div>
      )}

      {/* Terms */}
      <div className="pr-section">
        <div className="pr-section__title">Terms &amp; Notes</div>
        <ul className="pr-section__body" style={{ margin: 0, paddingLeft: 18, fontSize: 9.5, lineHeight: 1.55 }}>
          <li>Goods once sold are not returnable unless the seal is intact and within 7 days, subject to vendor policy.</li>
          <li>Medicines must be stored as per the storage condition mentioned on the pack.</li>
          <li>Self-medication is harmful — read the leaflet inside before use and consult your physician.</li>
          <li>This is a computer-generated invoice; signature is not required.</li>
          <li>Subject to local jurisdiction — disputes resolved at the hospital's registered office.</li>
        </ul>
      </div>
    </PrintShell>
  );
};

export default PharmacyBill;
