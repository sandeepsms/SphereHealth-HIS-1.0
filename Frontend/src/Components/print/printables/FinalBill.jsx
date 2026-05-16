// Components/print/printables/FinalBill.jsx
// Final IPD bill / discharge bill — itemized by charge category
// (bed, doctor, nursing, pharmacy, lab, radiology, procedure, consumable),
// subtotals per category, advances received, discount, tax, payable.

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR, amountInWords } from "../amountWords";

const CATEGORY_ORDER = [
  "Room/Bed Charges",
  "Doctor / Consultant Fees",
  "Nursing Charges",
  "Procedure / OT Charges",
  "Investigations / Lab",
  "Radiology / Imaging",
  "Pharmacy / Medications",
  "Consumables / Disposables",
  "Equipment / Monitoring",
  "Ambulance",
  "Other Charges",
];

const FinalBill = ({ settings, receipt = {} }) => {
  // `categories` can be passed pre-grouped as { name, items: [...] }
  // OR a flat `items` list with `category` on each row — group locally
  let groups = Array.isArray(receipt.categories) ? receipt.categories : null;
  if (!groups) {
    const map = {};
    (receipt.items || []).forEach((it) => {
      const cat = it.category || "Other Charges";
      if (!map[cat]) map[cat] = { name: cat, items: [] };
      map[cat].items.push(it);
    });
    // Order known categories first, unknown ones after
    groups = [
      ...CATEGORY_ORDER.filter((c) => map[c]).map((c) => map[c]),
      ...Object.values(map).filter((g) => !CATEGORY_ORDER.includes(g.name)),
    ];
  }

  const sumOf = (g) => g.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  const gross     = groups.reduce((s, g) => s + sumOf(g), 0);
  const advances  = Number(receipt.advanceReceived) || 0;
  const discount  = Number(receipt.discount)        || 0;
  const tpaPaid   = Number(receipt.tpaPaid)         || 0;
  const tax       = Number(receipt.tax)             || 0;
  const netBefore = gross - discount;
  const netAfterTax = netBefore + tax;
  const payable   = Math.max(0, netAfterTax - advances - tpaPaid);

  return (
    <PrintShell
      settings={settings}
      documentTitle="Final Bill (Discharge / IPD)"
      serialNo={receipt.billNo || receipt.invoiceNo}
      infoItems={[
        { label: "Patient",       value: receipt.patientName },
        { label: "UHID",          value: receipt.uhid },
        { label: "IPD No",        value: receipt.ipdNo },
        { label: "Age / Sex",     value: [receipt.age && `${receipt.age}Y`, receipt.gender].filter(Boolean).join(" / ") },
        { label: "Admitted",      value: receipt.admissionDate
            ? new Date(receipt.admissionDate).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : "—" },
        { label: "Discharged",    value: receipt.dischargeDate
            ? new Date(receipt.dischargeDate).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : "—" },
        { label: "Length of Stay",value: receipt.totalDays ? `${receipt.totalDays} day${receipt.totalDays === 1 ? "" : "s"}` : "—" },
        { label: "Bed / Ward",    value: [receipt.bedNumber, receipt.wardName].filter(Boolean).join(" · ") },
        { label: "Consultant",    value: receipt.consultantName },
        { label: "Final Dx",      value: receipt.finalDiagnosis },
        { label: "TPA / Scheme",  value: receipt.tpaName || receipt.scheme },
        { label: "Bill Date",     value: new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) },
      ]}
      signatureLabels={["Billing Officer", "Patient / Attendant"]}
    >
      {/* ── Category-grouped bill table ── */}
      {groups.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontStyle: "italic" }}>
          No charges recorded.
        </div>
      ) : (
        <table className="pr-table">
          <thead>
            <tr>
              <th style={{ width: 30 }}>#</th>
              <th>Particulars</th>
              <th className="center" style={{ width: 60 }}>Qty</th>
              <th className="right" style={{ width: 90 }}>Rate (₹)</th>
              <th className="right" style={{ width: 100 }}>Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, gi) => {
              const sub = sumOf(g);
              return (
                <React.Fragment key={gi}>
                  <tr>
                    <td colSpan={5} style={{
                      background: "var(--pr-accent-color, #1d4ed8)15",
                      color: "var(--pr-accent-color, #1d4ed8)",
                      fontWeight: 800,
                      fontSize: 10.5,
                      textTransform: "uppercase",
                      letterSpacing: ".5px",
                      padding: "6px 10px",
                    }}>
                      {g.name}
                    </td>
                  </tr>
                  {g.items.map((it, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{it.name || it.service || it.particulars}</div>
                        {it.description && <div className="muted" style={{ fontSize: 10 }}>{it.description}</div>}
                        {it.date && <div className="muted" style={{ fontSize: 10 }}>
                          {new Date(it.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </div>}
                      </td>
                      <td className="center">{it.qty || 1}</td>
                      <td className="right">{Number(it.rate || it.amount || 0).toLocaleString("en-IN")}</td>
                      <td className="right">{Number(it.amount || 0).toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={4} className="right" style={{ fontWeight: 700, color: "#475569", paddingTop: 5, paddingBottom: 5 }}>
                      Subtotal · {g.name}
                    </td>
                    <td className="right" style={{ fontWeight: 800, color: "#0f172a", paddingTop: 5, paddingBottom: 5 }}>
                      {fmtINR(sub)}
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {/* ── Totals box ── */}
      <div className="pr-totals">
        <div className="pr-totals__row">
          <span className="pr-totals__lbl">Gross Charges</span>
          <span className="pr-totals__val">{fmtINR(gross)}</span>
        </div>
        {discount > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Less: Discount</span>
            <span className="pr-totals__val">- {fmtINR(discount)}</span>
          </div>
        )}
        {tax > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Add: GST / Tax</span>
            <span className="pr-totals__val">+ {fmtINR(tax)}</span>
          </div>
        )}
        <div className="pr-totals__row" style={{ background: "#f8fafc", fontWeight: 800 }}>
          <span className="pr-totals__lbl">Net Bill Amount</span>
          <span className="pr-totals__val">{fmtINR(netAfterTax)}</span>
        </div>
        {advances > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Less: Advances Received</span>
            <span className="pr-totals__val">- {fmtINR(advances)}</span>
          </div>
        )}
        {tpaPaid > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Less: TPA / Insurance Paid</span>
            <span className="pr-totals__val">- {fmtINR(tpaPaid)}</span>
          </div>
        )}
        <div className="pr-totals__row pr-totals__row--grand">
          <span className="pr-totals__lbl">
            {payable > 0 ? "Net Payable" : "Refund Due"}
          </span>
          <span className="pr-totals__val">
            {payable > 0 ? fmtINR(payable) : fmtINR(advances + tpaPaid - netAfterTax)}
          </span>
        </div>
      </div>

      <div className="pr-amount-words">
        <strong>{payable > 0 ? "Payable in words: " : "Refund in words: "}</strong>
        {amountInWords(payable > 0 ? payable : (advances + tpaPaid - netAfterTax))}
      </div>

      {/* ── Payment history (if provided) ── */}
      {Array.isArray(receipt.payments) && receipt.payments.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Payment History</div>
          <table className="pr-table" style={{ fontSize: 10.5 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Mode</th>
                <th>Reference</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {receipt.payments.map((p, i) => (
                <tr key={i}>
                  <td>{p.date ? new Date(p.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</td>
                  <td>{p.method ? <span className={`pr-paymethod pr-paymethod--${String(p.method).toLowerCase()}`}>{p.method.toUpperCase()}</span> : "—"}</td>
                  <td className="muted">{p.refNo || p.transactionId || "—"}</td>
                  <td className="right">{fmtINR(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PrintShell>
  );
};

export default FinalBill;
