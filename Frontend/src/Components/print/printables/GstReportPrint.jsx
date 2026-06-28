// Components/print/printables/GstReportPrint.jsx
// R7bh-F7 / R7bg-7-CRIT-3 + R7bg-1-CRIT-12 + R7bg-1-CRIT-14:
// Monthly GST register print — outward supplies grouped by rate, by HSN,
// and by source (Hospital bills vs Pharmacy sales). The figures mirror
// what the accountant files in GSTR-1 (Tables 6, 12 HSN) and GSTR-3B.
// Required by GST law + NABH AAC.7 (financial-trail evidence).

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

const fmtMY = (m, y) => {
  if (m == null || y == null) return "—";
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return `${months[Number(m) - 1] || ""} ${y}`;
};

const GstReportPrint = ({ settings = {}, receipt = {} }) => {
  const r = receipt;
  const printCount = toNum(r.printCount);

  const period = r.period || fmtMY(r.month, r.year);
  const summary = r.summary || {};

  // R7eo-D — Pattern D regulatory fix (GST §34): mirror credit-note logic
  // and derive interstate from placeOfSupply vs settings.state instead of
  // silently defaulting Place of Supply to settings.state (which would
  // misclassify every interstate supply as intrastate).
  const computedInterState =
    (r.placeOfSupply || "").trim().toLowerCase() !==
    (settings.state || "").trim().toLowerCase();
  const effectiveInterState = r.isInterState ?? (r.placeOfSupply ? computedInterState : false);

  // Slab-wise rows: [{ gstRate, taxable, cgst, sgst, igst, cess, totalTax }]
  const slabRows = Array.isArray(r.byRate) ? r.byRate : [];
  // HSN rows for GSTR-1 Table 12
  const hsnRows = Array.isArray(r.byHsn) ? r.byHsn : [];
  // Source split: [{ source, taxable, cgst, sgst, igst }]
  const sourceRows = Array.isArray(r.bySource) ? r.bySource : [];

  const totalTaxable = toNum(summary.totalTaxable
    || slabRows.reduce((s, x) => s + toNum(x.taxable), 0));
  const totalCgst    = toNum(summary.totalCgst
    || slabRows.reduce((s, x) => s + toNum(x.cgst), 0));
  const totalSgst    = toNum(summary.totalSgst
    || slabRows.reduce((s, x) => s + toNum(x.sgst), 0));
  const totalIgst    = toNum(summary.totalIgst
    || slabRows.reduce((s, x) => s + toNum(x.igst), 0));
  const totalCess    = toNum(summary.totalCess
    || slabRows.reduce((s, x) => s + toNum(x.cess), 0));
  const totalTax     = totalCgst + totalSgst + totalIgst + totalCess;
  const grandTotal   = totalTaxable + totalTax;

  return (
    <PrintShell
      settings={settings}
      documentTitle="GST Outward Register"
      serialNo={r.reportNo || `GSTR-${period}`}
      printCount={printCount}
      infoItems={[
        { label: "Period",          value: period },
        { label: "Hospital GSTIN",  value: settings.gstin },
        { label: "State",           value: settings.state || "—" },
        { label: "Place of Supply", value: r.placeOfSupply || "—" },
        { label: "PAN",             value: settings.panNumber || "—" },
        { label: "Generated",       value: new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) },
        { label: "Accountant",      value: r.accountantName || r.generatedBy },
      ]}
      signatureLabels={["Accountant", "Authorised Signatory"]}
    >
      <div style={{
        background: "#eef2ff", border: "1px solid #c7d2fe", color: "#4338ca",
        padding: "8px 14px", borderRadius: 6, marginBottom: 12,
        fontSize: 11, fontWeight: 700,
      }}>
        GST OUTWARD REGISTER — period {period}. Outward supplies of hospital + pharmacy. Use for GSTR-1 + GSTR-3B preparation.
      </div>

      {/* Summary tiles */}
      <div className="pr-section">
        <div className="pr-section__title">Summary</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, fontSize: 10.5 }}>
          {[
            { label: "Total Taxable",  value: fmtINR(totalTaxable) },
            { label: "Total CGST",     value: fmtINR(totalCgst) },
            { label: "Total SGST",     value: fmtINR(totalSgst) },
            { label: "Total IGST",     value: fmtINR(totalIgst) },
            { label: "Total Cess",     value: fmtINR(totalCess) },
          ].map((t, i) => (
            <div key={i} style={{
              border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px",
              background: "#f8fafc",
            }}>
              <div style={{ fontSize: 8.5, fontWeight: 800, color: "#64748b", letterSpacing: ".5px", textTransform: "uppercase" }}>
                {t.label}
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{t.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* By rate */}
      <div className="pr-section">
        <div className="pr-section__title">By GST Rate (GSTR-3B 3.1)</div>
        <table className="pr-table" style={{ fontSize: 10.5 }}>
          <thead>
            <tr>
              <th className="right" style={{ width: 70 }}>Rate</th>
              <th className="right">Taxable (₹)</th>
              <th className="right">CGST (₹)</th>
              <th className="right">SGST (₹)</th>
              <th className="right">IGST (₹)</th>
              <th className="right">Cess (₹)</th>
              <th className="right">Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            {slabRows.length === 0 ? (
              <tr><td colSpan={7} className="muted center" style={{ padding: 12, fontStyle: "italic" }}>No taxable supplies.</td></tr>
            ) : slabRows.map((slab, i) => {
              const s = slab;
              // R7eo-D — Pattern D regulatory fix (GST §34): CGST/SGST and
              // IGST are mutually exclusive for any given supply. Same-slab
              // simultaneous values indicate corrupt aggregation and would
              // double-count tax in GSTR-3B.
              if (Number(slab.cgst) > 0 && Number(slab.igst) > 0) {
                // eslint-disable-next-line no-console
                console.warn(
                  `[GstReportPrint] Data anomaly: slab ${toNum(slab.gstRate ?? slab.rate)}% has both CGST (${toNum(slab.cgst)}) and IGST (${toNum(slab.igst)}) > 0 simultaneously. These are mutually exclusive per GST law — verify aggregation pipeline.`
                );
              }
              const slabTotal = toNum(s.cgst) + toNum(s.sgst) + toNum(s.igst) + toNum(s.cess);
              return (
                <tr key={i}>
                  <td className="right">{toNum(s.gstRate ?? s.rate)}%</td>
                  <td className="right">{fmtINR(toNum(s.taxable))}</td>
                  <td className="right">{toNum(s.cgst) > 0 ? fmtINR(toNum(s.cgst)) : "—"}</td>
                  <td className="right">{toNum(s.sgst) > 0 ? fmtINR(toNum(s.sgst)) : "—"}</td>
                  <td className="right">{toNum(s.igst) > 0 ? fmtINR(toNum(s.igst)) : "—"}</td>
                  <td className="right">{toNum(s.cess) > 0 ? fmtINR(toNum(s.cess)) : "—"}</td>
                  <td className="right" style={{ fontWeight: 700 }}>{fmtINR(toNum(s.taxable) + slabTotal)}</td>
                </tr>
              );
            })}
            <tr style={{ background: "#f8fafc", fontWeight: 800 }}>
              <td className="right">Total</td>
              <td className="right">{fmtINR(totalTaxable)}</td>
              <td className="right">{fmtINR(totalCgst)}</td>
              <td className="right">{fmtINR(totalSgst)}</td>
              <td className="right">{fmtINR(totalIgst)}</td>
              <td className="right">{fmtINR(totalCess)}</td>
              <td className="right">{fmtINR(grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* By HSN (GSTR-1 Table 12) */}
      <div className="pr-section">
        <div className="pr-section__title">By HSN / SAC (GSTR-1 Table 12)</div>
        <table className="pr-table" style={{ fontSize: 10.5 }}>
          <thead>
            <tr>
              <th style={{ width: 80 }}>HSN / SAC</th>
              <th>Description</th>
              <th className="right" style={{ width: 50 }}>Rate</th>
              <th className="right" style={{ width: 60 }}>Qty</th>
              <th>UOM</th>
              <th className="right" style={{ width: 100 }}>Value (₹)</th>
              <th className="right" style={{ width: 100 }}>Tax (₹)</th>
            </tr>
          </thead>
          <tbody>
            {hsnRows.length === 0 ? (
              <tr><td colSpan={7} className="muted center" style={{ padding: 12, fontStyle: "italic" }}>No HSN-grouped supplies.</td></tr>
            ) : hsnRows.map((h, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "'DM Mono', monospace" }}>{h.hsn || h.hsnCode || "—"}</td>
                <td>{h.description || "—"}</td>
                <td className="right">{toNum(h.gstRate)}%</td>
                <td className="right">{h.qty || h.quantity || "—"}</td>
                <td>{h.uom || "—"}</td>
                <td className="right">{fmtINR(toNum(h.value ?? h.taxable))}</td>
                <td className="right">{fmtINR(toNum(h.tax))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* By source */}
      <div className="pr-section">
        <div className="pr-section__title">By Source (Hospital vs Pharmacy)</div>
        <table className="pr-table" style={{ fontSize: 10.5 }}>
          <thead>
            <tr>
              <th>Source</th>
              <th className="right">Taxable (₹)</th>
              <th className="right">CGST (₹)</th>
              <th className="right">SGST (₹)</th>
              <th className="right">IGST (₹)</th>
              <th className="right">Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            {sourceRows.length === 0 ? (
              <tr><td colSpan={6} className="muted center" style={{ padding: 12, fontStyle: "italic" }}>No source breakdown supplied.</td></tr>
            ) : sourceRows.map((s, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{s.source || "—"}</td>
                <td className="right">{fmtINR(toNum(s.taxable))}</td>
                <td className="right">{toNum(s.cgst) > 0 ? fmtINR(toNum(s.cgst)) : "—"}</td>
                <td className="right">{toNum(s.sgst) > 0 ? fmtINR(toNum(s.sgst)) : "—"}</td>
                <td className="right">{toNum(s.igst) > 0 ? fmtINR(toNum(s.igst)) : "—"}</td>
                <td className="right" style={{ fontWeight: 700 }}>
                  {fmtINR(toNum(s.taxable) + toNum(s.cgst) + toNum(s.sgst) + toNum(s.igst))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pr-totals">
        <div className="pr-totals__row">
          <span className="pr-totals__lbl">Total Taxable Value</span>
          <span className="pr-totals__val">{fmtINR(totalTaxable)}</span>
        </div>
        <div className="pr-totals__row">
          <span className="pr-totals__lbl">Total Tax</span>
          <span className="pr-totals__val">{fmtINR(totalTax)}</span>
        </div>
        <div className="pr-totals__row pr-totals__row--grand">
          <span className="pr-totals__lbl">Total Outward Supply</span>
          <span className="pr-totals__val">{fmtINR(grandTotal)}</span>
        </div>
      </div>

      <div className="pr-amount-words">
        <strong>Total outward supply in words: </strong>
        {numberToIndianWords(grandTotal)}
      </div>

      {/* R7eo-D — Pattern D regulatory fix (GST §34): the hospital-exemption
          note under Notification 12/2017 Entry 74 only applies to hospital
          (in-patient) supplies. Drop the line when the report is pharmacy-only,
          as pharmacy OTC/Rx sales are fully taxable under HSN 3004. */}
      <div className="pr-section">
        <div className="pr-section__title">Notes</div>
        <div className="pr-section__body" style={{ fontSize: 10.5, lineHeight: 1.55 }}>
          {(r.scope === "hospital" || r.scope === "both" || r.scope == null) && (
            <>
              1. This register reflects outward supplies as recorded in the HIS for the period {period}.
              Health-care services rendered to in-patients are exempt under Notification 12/2017-Central Tax (Rate) Entry 74,
              and are reported under "Exempt outward supplies" in GSTR-3B 3.1(c).<br/>
              2. Pharmacy sales (OTC + prescription) are taxable under HSN 3004 — rates as per the Drug Master.<br/>
              3. Match against the credit-note register (CN issued — GSTR-1 9B) before filing.
            </>
          )}
          {r.scope === "pharmacy" && (
            <>
              1. This register reflects pharmacy outward supplies (OTC + prescription) for the period {period},
              taxable under HSN 3004 — rates as per the Drug Master.<br/>
              2. Inter-state vs intra-state determination is based on Place of Supply
              ({r.placeOfSupply || "—"}) vs Hospital State ({settings.state || "—"}) —
              {effectiveInterState ? " classified as INTER-STATE (IGST)." : " classified as INTRA-STATE (CGST + SGST)."}<br/>
              3. Match against the credit-note register (CN issued — GSTR-1 9B) before filing.
            </>
          )}
        </div>
      </div>
    </PrintShell>
  );
};

export default GstReportPrint;
