// Components/print/printables/SettlementStatement.jsx
// R7bh-F7 / R7bg-7-CRIT-3: Final-bill discharge SETTLEMENT STATEMENT.
// One A4 sheet that aggregates the whole bill's life-cycle: charges by
// category (gross / discount / net / GST / total), every payment (date +
// mode + ref + amount), TDS deducted, and the final net receivable or
// refundable figure — plus the total in words and dual signatures
// (cashier + patient/attendant). Used by Accounts at discharge to close
// the patient's billing folder; NABH AAC.7 compliant.

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

const fmtDT = (d) => d
  ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "—";
const fmtD = (d) => d
  ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  : "—";

const SettlementStatement = ({ settings = {}, receipt = {} }) => {
  const r = receipt;
  const printCount = toNum(r.printCount);

  // Charges grouped by category (the controller pre-aggregates these so
  // settlement print is fast — but fall back to flattening items[] if
  // the back-end didn't send categories).
  let categories = Array.isArray(r.categories) ? r.categories : null;
  if (!categories) {
    const map = {};
    (r.items || []).forEach((it) => {
      const name = it.category || "Other Charges";
      if (!map[name]) {
        map[name] = { name, gross: 0, discount: 0, net: 0, gst: 0, total: 0 };
      }
      const row = map[name];
      const gross = toNum(it.gross ?? it.amount);
      const discount = toNum(it.discount);
      const net = toNum(it.net ?? (gross - discount));
      const gst = toNum(it.gst ?? it.tax);
      row.gross += gross;
      row.discount += discount;
      row.net += net;
      row.gst += gst;
      row.total += (net + gst);
    });
    categories = Object.values(map);
  }

  const sumCol = (key) => categories.reduce((s, c) => s + toNum(c[key]), 0);
  const grossTotal = sumCol("gross");
  const discountTotal = sumCol("discount");
  const netTotal = sumCol("net");
  const gstTotal = sumCol("gst");
  const billTotal = sumCol("total") || (netTotal + gstTotal);

  const payments = Array.isArray(r.payments) ? r.payments : [];
  const paymentsTotal = payments.reduce((s, p) => s + toNum(p.amount), 0);
  const advanceApplied = toNum(r.advanceApplied);
  const tpaPaid = toNum(r.tpaPaid);
  const tdsDeducted = toNum(r.tdsDeducted ?? r.tdsAmount);
  const totalReceived = paymentsTotal + advanceApplied + tpaPaid;
  const netSettlement = billTotal - totalReceived - tdsDeducted;
  const isRefund = netSettlement < 0;

  // R7eo-A — Pattern A fix: hardcoded "Settlement Statement" obscured
  // whether this was an IPD / Daycare / OPD reconciliation. Derive a
  // visit-aware title from receipt.settlementType first, falling back
  // to receipt.visitType. Legacy callers (neither field set) keep the
  // original generic banner.
  const settlementTypeRaw = String(
    r.settlementType || r.visitType || ""
  ).toUpperCase();
  const settlementLabel =
      settlementTypeRaw === "IPD"        ? "IPD"
    : settlementTypeRaw === "DAYCARE"    ? "Daycare"
    : settlementTypeRaw === "DAY CARE"   ? "Daycare"
    : settlementTypeRaw === "OPD"        ? "OPD"
    : settlementTypeRaw === "EMERGENCY"  ? "Emergency"
    : settlementTypeRaw === "ER"         ? "Emergency"
                                         : "";
  const docTitle = settlementLabel
    ? `${settlementLabel} Final Settlement`
    : "Settlement Statement";

  return (
    <PrintShell
      settings={settings}
      documentTitle={docTitle}
      serialNo={r.settlementNo || r.billNo}
      printCount={printCount}
      watermarkRecipient="RECIPIENT"
      infoItems={[
        { label: "Patient",         value: r.patientName },
        { label: "UHID",            value: r.uhid },
        { label: "IPD No",          value: r.ipdNo },
        { label: "Bill No",         value: r.billNo },
        { label: "Bill Date",       value: fmtDT(r.billDate || r.date) },
        { label: "Admitted",        value: fmtDT(r.admissionDate) },
        { label: "Discharged",      value: fmtDT(r.dischargeDate) },
        { label: "Length of Stay",  value: r.totalDays ? `${r.totalDays} day${r.totalDays === 1 ? "" : "s"}` : "—" },
        { label: "Consultant",      value: r.consultantName },
        { label: "TPA / Scheme",    value: r.tpaName || r.scheme },
        { label: "Settlement Date", value: fmtDT(r.settlementDate || new Date()) },
        { label: "Cashier",         value: r.cashierName || r.settledBy },
      ]}
      signatureLabels={["Cashier", "Patient / Attendant"]}
    >
      <div style={{
        background: "#eef2ff", border: "1px solid #c7d2fe", color: "#4338ca",
        padding: "8px 14px", borderRadius: 6, marginBottom: 12,
        fontSize: 11, fontWeight: 700, letterSpacing: ".3px",
      }}>
        SETTLEMENT STATEMENT — final reconciliation of charges, payments, and balance due / refundable.
      </div>

      {/* Charges by category */}
      <div className="pr-section">
        <div className="pr-section__title">Charges Summary (by category)</div>
        <table className="pr-table">
          <thead>
            <tr>
              <th>Category</th>
              <th className="right" style={{ width: 90 }}>Gross (₹)</th>
              <th className="right" style={{ width: 90 }}>Discount (₹)</th>
              <th className="right" style={{ width: 90 }}>Net (₹)</th>
              <th className="right" style={{ width: 80 }}>GST (₹)</th>
              <th className="right" style={{ width: 100 }}>Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted center" style={{ padding: 16, fontStyle: "italic" }}>
                  No charges recorded.
                </td>
              </tr>
            ) : categories.map((c, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td className="right">{fmtINR(toNum(c.gross))}</td>
                <td className="right" style={{ color: toNum(c.discount) > 0 ? "#dc2626" : "#94a3b8" }}>
                  {toNum(c.discount) > 0 ? `- ${fmtINR(toNum(c.discount))}` : "—"}
                </td>
                <td className="right">{fmtINR(toNum(c.net))}</td>
                <td className="right">{toNum(c.gst) > 0 ? fmtINR(toNum(c.gst)) : "—"}</td>
                <td className="right" style={{ fontWeight: 700 }}>{fmtINR(toNum(c.total) || toNum(c.net) + toNum(c.gst))}</td>
              </tr>
            ))}
            <tr style={{ background: "#f8fafc", fontWeight: 800 }}>
              <td>Total</td>
              <td className="right">{fmtINR(grossTotal)}</td>
              <td className="right" style={{ color: discountTotal > 0 ? "#dc2626" : "#94a3b8" }}>
                {discountTotal > 0 ? `- ${fmtINR(discountTotal)}` : "—"}
              </td>
              <td className="right">{fmtINR(netTotal)}</td>
              <td className="right">{fmtINR(gstTotal)}</td>
              <td className="right">{fmtINR(billTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Payments breakdown */}
      <div className="pr-section">
        <div className="pr-section__title">Payments Received</div>
        {payments.length === 0 && advanceApplied === 0 && tpaPaid === 0 ? (
          <div className="muted center" style={{ padding: 12, fontStyle: "italic", fontSize: 11 }}>
            No payments recorded against this bill.
          </div>
        ) : (
          <table className="pr-table" style={{ fontSize: 10.5 }}>
            <thead>
              <tr>
                <th style={{ width: 95 }}>Date</th>
                <th style={{ width: 75 }}>Mode</th>
                <th>Reference / UTR</th>
                <th>Source</th>
                <th className="right" style={{ width: 100 }}>Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={i}>
                  <td>{fmtD(p.date)}</td>
                  <td>
                    {p.method ? (
                      <span className={`pr-paymethod pr-paymethod--${String(p.method).toLowerCase()}`}>
                        {String(p.method).toUpperCase()}
                      </span>
                    ) : "—"}
                  </td>
                  <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 10 }}>
                    {p.utrReference || p.refNo || p.transactionId || "—"}
                  </td>
                  <td className="muted" style={{ fontSize: 10 }}>{p.source || p.purpose || "Bill Payment"}</td>
                  <td className="right">{fmtINR(toNum(p.amount))}</td>
                </tr>
              ))}
              {advanceApplied > 0 && (
                <tr>
                  <td colSpan={4} style={{ fontStyle: "italic" }}>Advance applied to bill</td>
                  <td className="right">{fmtINR(advanceApplied)}</td>
                </tr>
              )}
              {tpaPaid > 0 && (
                <tr>
                  <td colSpan={4} style={{ fontStyle: "italic" }}>TPA / Insurance settlement</td>
                  <td className="right">{fmtINR(tpaPaid)}</td>
                </tr>
              )}
              <tr style={{ background: "#f8fafc", fontWeight: 800 }}>
                <td colSpan={4} className="right">Total Received</td>
                <td className="right">{fmtINR(totalReceived)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Reconciliation totals box */}
      <div className="pr-totals">
        <div className="pr-totals__row">
          <span className="pr-totals__lbl">Total Bill Amount</span>
          <span className="pr-totals__val">{fmtINR(billTotal)}</span>
        </div>
        <div className="pr-totals__row">
          <span className="pr-totals__lbl">Less: Total Received</span>
          <span className="pr-totals__val">- {fmtINR(totalReceived)}</span>
        </div>
        {tdsDeducted > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Less: TDS Deducted</span>
            <span className="pr-totals__val">- {fmtINR(tdsDeducted)}</span>
          </div>
        )}
        <div className="pr-totals__row pr-totals__row--grand">
          <span className="pr-totals__lbl">
            {isRefund ? "Net Refundable" : netSettlement === 0 ? "Settled — No Balance" : "Net Receivable"}
          </span>
          <span className="pr-totals__val">{fmtINR(Math.abs(netSettlement))}</span>
        </div>
      </div>

      <div className="pr-amount-words">
        <strong>
          {isRefund ? "Refund in words: " : netSettlement === 0 ? "Total settled in words: " : "Receivable in words: "}
        </strong>
        {numberToIndianWords(Math.abs(netSettlement) || billTotal)}
      </div>

      {r.remarks && (
        <div className="pr-section">
          <div className="pr-section__title">Settlement Remarks</div>
          <div className="pr-section__body" style={{ whiteSpace: "pre-wrap" }}>{r.remarks}</div>
        </div>
      )}

      <div className="pr-section">
        <div className="pr-section__title">Declaration</div>
        <div className="pr-section__body" style={{ fontSize: 11, lineHeight: 1.55 }}>
          I/we acknowledge that the above is a true and correct reconciliation of charges raised against
          the patient's hospitalisation, and confirm receipt of {isRefund ? "the refund amount" : "the goods / services rendered"}.
          {!isRefund && netSettlement !== 0 && " I/we undertake to pay the outstanding balance as per hospital policy."}
        </div>
      </div>
    </PrintShell>
  );
};

export default SettlementStatement;
