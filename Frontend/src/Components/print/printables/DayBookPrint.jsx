// Components/print/printables/DayBookPrint.jsx
// R7bh-F7 / R7bg-7-CRIT-3 + R7bg-1-CRIT-13: daily Cash Book (Bahi Khata)
// for the cashier / accountant. Aggregates opening balance, cash IN by
// source, cash OUT by source, mode-wise breakdown, and closing cash.
// Required by NABH AAC.7 + Income Tax (S.44AA — books of accounts).

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

const fmtD = (d) => d
  ? new Date(d).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })
  : "—";

const DayBookPrint = ({ settings = {}, receipt = {} }) => {
  const r = receipt;
  const printCount = toNum(r.printCount);

  const cashIn = Array.isArray(r.cashIn) ? r.cashIn : [];
  const cashOut = Array.isArray(r.cashOut) ? r.cashOut : [];
  const byMode = r.byMode || {};

  const totalIn = cashIn.reduce((s, x) => s + toNum(x.amount), 0);
  const totalOut = cashOut.reduce((s, x) => s + toNum(x.amount), 0);
  const opening = toNum(r.openingCash);
  const closingExpected = opening + totalIn - totalOut;
  const closingActual = r.closingCash != null ? toNum(r.closingCash) : closingExpected;
  const variance = closingActual - closingExpected;

  // Mode-wise: prefer structured payload; otherwise compute from cashIn/Out
  // bucketed by `mode` field.
  const modes = ["CASH", "UPI", "CARD", "CHEQUE", "NEFT", "IMPS", "RTGS"];
  const modeTotalsIn = {};
  const modeTotalsOut = {};
  for (const m of modes) {
    modeTotalsIn[m] = toNum(byMode?.[m]?.in)
      || cashIn.filter(x => String(x.mode || x.method || "").toUpperCase() === m)
               .reduce((s, x) => s + toNum(x.amount), 0);
    modeTotalsOut[m] = toNum(byMode?.[m]?.out)
      || cashOut.filter(x => String(x.mode || x.method || "").toUpperCase() === m)
                .reduce((s, x) => s + toNum(x.amount), 0);
  }

  // R7eo-A — Pattern A fix: hardcoded "Day Book — Cash Register"
  // masked multi-counter hospitals where the cashier needed to see
  // which counter the snapshot belonged to. Derive a counter-aware
  // title when receipt.counter is set, or a "Multi-Counter (N)" label
  // when the payload aggregates more than one counter. Legacy callers
  // (no counter / countersIncluded) keep the original heading.
  const countersIncluded = toNum(r.countersIncluded);
  const isMultiCounter = !r.counter && countersIncluded > 1;
  const docTitle = r.counter
    ? `Day Book — Counter ${r.counter}`
    : isMultiCounter
    ? `Day Book — Multi-Counter (${countersIncluded})`
    : "Day Book — Cash Register";

  return (
    <PrintShell
      settings={settings}
      documentTitle={docTitle}
      serialNo={r.dayBookNo || fmtD(r.date)}
      printCount={printCount}
      infoItems={[
        { label: "Date",        value: fmtD(r.date) },
        { label: "Cashier",     value: r.cashierName },
        { label: "Counter",     value: r.counter || "—" },
        { label: "Shift",       value: r.shift || "—" },
        { label: "Opened At",   value: r.openedAt ? new Date(r.openedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—" },
        { label: "Closed At",   value: r.closedAt ? new Date(r.closedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—" },
        { label: "Entries",     value: `${cashIn.length + cashOut.length} (${cashIn.length} in / ${cashOut.length} out)` },
        { label: "Generated",   value: new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) },
      ]}
      signatureLabels={["Cashier", "Accountant / Supervisor"]}
    >
      <div style={{
        background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534",
        padding: "8px 14px", borderRadius: 6, marginBottom: 12,
        fontSize: 11, fontWeight: 700,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
      }}>
        <span>DAY BOOK — opening + cash in − cash out = closing. Retain per Income Tax §44AA + NABH AAC.7.</span>
        {/* R7eo-A — Multi-Counter chip when payload aggregates >1 counter */}
        {isMultiCounter && (
          <span style={{
            background: "#4338ca", color: "#fff",
            padding: "2px 9px", borderRadius: 999,
            fontSize: 9.5, fontWeight: 800,
            letterSpacing: ".5px", textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}>
            Multi-Counter · {countersIncluded}
          </span>
        )}
      </div>

      {/* Opening balance */}
      <div className="pr-section">
        <div className="pr-section__title">Opening Cash Balance</div>
        <div className="pr-section__body" style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
          <span>As on start of day {fmtD(r.date)}</span>
          <strong>{fmtINR(opening)}</strong>
        </div>
      </div>

      {/* Cash IN */}
      <div className="pr-section">
        <div className="pr-section__title">Cash IN (Receipts)</div>
        <table className="pr-table" style={{ fontSize: 10.5 }}>
          <thead>
            <tr>
              <th style={{ width: 95 }}>Time</th>
              <th>Source</th>
              <th>Reference</th>
              <th style={{ width: 75 }}>Mode</th>
              <th className="right" style={{ width: 100 }}>Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {cashIn.length === 0 ? (
              <tr><td colSpan={5} className="muted center" style={{ padding: 12, fontStyle: "italic" }}>No receipts recorded.</td></tr>
            ) : cashIn.map((x, i) => (
              <tr key={i}>
                <td>{x.time ? new Date(x.time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                <td>{x.source || x.purpose || "—"}</td>
                <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 10 }}>{x.receiptNo || x.refNo || "—"}</td>
                <td>
                  {x.mode || x.method ? (
                    <span className={`pr-paymethod pr-paymethod--${String(x.mode || x.method).toLowerCase()}`}>
                      {String(x.mode || x.method).toUpperCase()}
                    </span>
                  ) : "—"}
                </td>
                <td className="right">{fmtINR(toNum(x.amount))}</td>
              </tr>
            ))}
            <tr style={{ background: "#dcfce7", fontWeight: 800 }}>
              <td colSpan={4} className="right">Total Cash IN</td>
              <td className="right">+ {fmtINR(totalIn)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Cash OUT */}
      <div className="pr-section">
        <div className="pr-section__title">Cash OUT (Refunds / Reversals / Petty)</div>
        <table className="pr-table" style={{ fontSize: 10.5 }}>
          <thead>
            <tr>
              <th style={{ width: 95 }}>Time</th>
              <th>Source</th>
              <th>Reference</th>
              <th style={{ width: 75 }}>Mode</th>
              <th className="right" style={{ width: 100 }}>Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {cashOut.length === 0 ? (
              <tr><td colSpan={5} className="muted center" style={{ padding: 12, fontStyle: "italic" }}>No outflows recorded.</td></tr>
            ) : cashOut.map((x, i) => (
              <tr key={i}>
                <td>{x.time ? new Date(x.time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                <td>{x.source || x.purpose || "—"}</td>
                <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 10 }}>{x.refundSlipNo || x.refNo || "—"}</td>
                <td>
                  {x.mode || x.method ? (
                    <span className={`pr-paymethod pr-paymethod--${String(x.mode || x.method).toLowerCase()}`}>
                      {String(x.mode || x.method).toUpperCase()}
                    </span>
                  ) : "—"}
                </td>
                <td className="right">{fmtINR(toNum(x.amount))}</td>
              </tr>
            ))}
            <tr style={{ background: "#fee2e2", fontWeight: 800 }}>
              <td colSpan={4} className="right">Total Cash OUT</td>
              <td className="right">- {fmtINR(totalOut)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Mode-wise breakdown */}
      <div className="pr-section">
        <div className="pr-section__title">Mode-wise Breakdown</div>
        <table className="pr-table" style={{ fontSize: 10.5 }}>
          <thead>
            <tr>
              <th>Mode</th>
              <th className="right" style={{ width: 110 }}>Cash IN (₹)</th>
              <th className="right" style={{ width: 110 }}>Cash OUT (₹)</th>
              <th className="right" style={{ width: 110 }}>Net (₹)</th>
            </tr>
          </thead>
          <tbody>
            {modes.map(m => {
              const inAmt = modeTotalsIn[m];
              const outAmt = modeTotalsOut[m];
              if (inAmt === 0 && outAmt === 0) return null;
              return (
                <tr key={m}>
                  <td>
                    <span className={`pr-paymethod pr-paymethod--${m.toLowerCase()}`}>{m}</span>
                  </td>
                  <td className="right">{inAmt > 0 ? fmtINR(inAmt) : "—"}</td>
                  <td className="right">{outAmt > 0 ? fmtINR(outAmt) : "—"}</td>
                  <td className="right" style={{ fontWeight: 700 }}>{fmtINR(inAmt - outAmt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Closing reconciliation */}
      <div className="pr-totals">
        <div className="pr-totals__row">
          <span className="pr-totals__lbl">Opening Cash</span>
          <span className="pr-totals__val">{fmtINR(opening)}</span>
        </div>
        <div className="pr-totals__row">
          <span className="pr-totals__lbl">Add: Cash IN</span>
          <span className="pr-totals__val">+ {fmtINR(totalIn)}</span>
        </div>
        <div className="pr-totals__row">
          <span className="pr-totals__lbl">Less: Cash OUT</span>
          <span className="pr-totals__val">- {fmtINR(totalOut)}</span>
        </div>
        <div className="pr-totals__row" style={{ background: "#f8fafc", fontWeight: 800 }}>
          <span className="pr-totals__lbl">Expected Closing</span>
          <span className="pr-totals__val">{fmtINR(closingExpected)}</span>
        </div>
        <div className="pr-totals__row">
          <span className="pr-totals__lbl">Actual Closing (counted)</span>
          <span className="pr-totals__val">{fmtINR(closingActual)}</span>
        </div>
        <div className="pr-totals__row pr-totals__row--grand" style={{
          background: variance === 0 ? "#dcfce7" : Math.abs(variance) > 100 ? "#fee2e2" : "#fef3c7",
        }}>
          <span className="pr-totals__lbl">
            {variance === 0 ? "Variance — Tallied" : variance > 0 ? "Excess" : "Shortage"}
          </span>
          <span className="pr-totals__val">{fmtINR(Math.abs(variance))}</span>
        </div>
      </div>

      <div className="pr-amount-words">
        <strong>Closing cash in words: </strong>
        {numberToIndianWords(closingActual)}
      </div>

      {/* Manual variance note */}
      {(variance !== 0 || r.varianceNote) && (
        <div className="pr-section">
          <div className="pr-section__title">Variance Note / Cash Discrepancy</div>
          <div className="pr-section__body" style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>
            {r.varianceNote || "Cash count discrepancy noted — please record explanation here."}
          </div>
        </div>
      )}
    </PrintShell>
  );
};

export default DayBookPrint;
