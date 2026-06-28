// Components/print/printables/CashierShiftClosePrint.jsx
// R7bh-F7 / R7bg-7-CRIT-3: cashier-shift CLOSE printout. One sheet
// summarises a cashier's shift — opening drawer, collections by mode,
// refunds issued, advances taken vs applied, closing drawer + variance,
// and dual signatures (cashier + supervisor). NABH AAC.7 + Income Tax
// §44AA evidence of daily collection close-out.

import React from "react";
import PrintShell from "../PrintShell";
import { fmtINR } from "../amountWords";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

const fmtDT = (d) => d
  ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "—";

const CashierShiftClosePrint = ({ settings = {}, receipt = {} }) => {
  const r = receipt;
  const printCount = toNum(r.printCount);

  // Collections by mode (CASH / UPI / CARD / CHEQUE / NEFT)
  const collections = r.collections || {};
  const refunds     = r.refunds     || {};

  const modes = ["CASH", "UPI", "CARD", "CHEQUE", "NEFT", "IMPS", "RTGS"];
  const collectedTotal = modes.reduce((s, m) => s + toNum(collections[m] ?? collections[m.toLowerCase()]), 0);
  const refundedTotal  = modes.reduce((s, m) => s + toNum(refunds[m] ?? refunds[m.toLowerCase()]), 0);

  const advancesTaken   = toNum(r.advancesTaken);
  const advancesApplied = toNum(r.advancesApplied);
  const openingCash     = toNum(r.openingCash);
  const closingCash     = r.closingCash != null ? toNum(r.closingCash) : null;

  // Cash drawer reconciliation: only CASH mode contributes to physical
  // drawer. Other modes are bank/wallet/POS and don't change cash.
  const cashCollected = toNum(collections.CASH ?? collections.cash);
  const cashRefunded  = toNum(refunds.CASH ?? refunds.cash);
  const cashAdvanceTaken   = toNum(r.cashAdvancesTaken   ?? advancesTaken);
  const cashAdvanceApplied = toNum(r.cashAdvancesApplied ?? advancesApplied);
  const expectedClosing = openingCash + cashCollected + cashAdvanceTaken - cashRefunded - cashAdvanceApplied;
  const variance = (closingCash != null) ? closingCash - expectedClosing : null;

  // Counts (optional)
  const counts = r.counts || {};
  const totalReceipts = toNum(counts.totalReceipts);
  const totalRefunds  = toNum(counts.totalRefunds);
  const totalAdvances = toNum(counts.totalAdvances);

  return (
    <PrintShell
      settings={settings}
      documentTitle="Cashier Shift Close"
      serialNo={r.shiftCloseNo || r.shiftId}
      printCount={printCount}
      infoItems={[
        { label: "Cashier",     value: r.cashierName },
        { label: "Counter",     value: r.counter },
        { label: "Shift",       value: r.shift || "—" },
        { label: "Opened At",   value: fmtDT(r.openedAt) },
        { label: "Closed At",   value: fmtDT(r.closedAt || new Date()) },
        { label: "Duration",    value: r.duration || "—" },
        { label: "Supervisor",  value: r.supervisorName },
        { label: "Generated",   value: fmtDT(new Date()) },
      ]}
      signatureLabels={["Cashier", "Supervisor"]}
    >
      <div style={{
        background: "#eef2ff", border: "1px solid #c7d2fe", color: "#4338ca",
        padding: "8px 14px", borderRadius: 6, marginBottom: 12,
        fontSize: 11, fontWeight: 700,
      }}>
        CASHIER SHIFT CLOSE — daily reconciliation of cash drawer + electronic collections. Retain per Income Tax §44AA.
      </div>

      {/* Cash drawer reconciliation */}
      <div className="pr-section">
        <div className="pr-section__title">Cash Drawer Reconciliation</div>
        <div className="pr-totals" style={{ marginTop: 0 }}>
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Opening Cash Drawer</span>
            <span className="pr-totals__val">{fmtINR(openingCash)}</span>
          </div>
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Add: Cash Collections (Bills)</span>
            <span className="pr-totals__val">+ {fmtINR(cashCollected)}</span>
          </div>
          {cashAdvanceTaken > 0 && (
            <div className="pr-totals__row">
              <span className="pr-totals__lbl">Add: Cash Advances Taken</span>
              <span className="pr-totals__val">+ {fmtINR(cashAdvanceTaken)}</span>
            </div>
          )}
          {cashRefunded > 0 && (
            <div className="pr-totals__row">
              <span className="pr-totals__lbl">Less: Cash Refunds Issued</span>
              <span className="pr-totals__val">- {fmtINR(cashRefunded)}</span>
            </div>
          )}
          {cashAdvanceApplied > 0 && (
            <div className="pr-totals__row">
              <span className="pr-totals__lbl">Less: Cash Advances Applied (bill credit)</span>
              <span className="pr-totals__val">- {fmtINR(cashAdvanceApplied)}</span>
            </div>
          )}
          <div className="pr-totals__row" style={{ background: "#f8fafc", fontWeight: 800 }}>
            <span className="pr-totals__lbl">Expected Closing Cash</span>
            <span className="pr-totals__val">{fmtINR(expectedClosing)}</span>
          </div>
          {closingCash != null && (
            <>
              <div className="pr-totals__row">
                <span className="pr-totals__lbl">Actual Closing Cash (counted)</span>
                <span className="pr-totals__val">{fmtINR(closingCash)}</span>
              </div>
              <div className="pr-totals__row pr-totals__row--grand" style={{
                background: variance === 0 ? "#dcfce7" : Math.abs(variance) > 100 ? "#fee2e2" : "#fef3c7",
              }}>
                <span className="pr-totals__lbl">
                  {variance === 0 ? "Variance — Tallied" : variance > 0 ? "Excess Cash" : "Cash Shortage"}
                </span>
                <span className="pr-totals__val">{fmtINR(Math.abs(variance))}</span>
              </div>
            </>
          )}
        </div>
        {closingCash != null && (
          <div className="pr-amount-words">
            <strong>Closing cash in words: </strong>
            {numberToIndianWords(closingCash)}
          </div>
        )}
      </div>

      {/* Collections by mode */}
      <div className="pr-section">
        <div className="pr-section__title">Collections by Mode</div>
        <table className="pr-table" style={{ fontSize: 10.5 }}>
          <thead>
            <tr>
              <th>Mode</th>
              <th className="right" style={{ width: 120 }}>Collected (₹)</th>
              <th className="right" style={{ width: 120 }}>Refunded (₹)</th>
              <th className="right" style={{ width: 120 }}>Net (₹)</th>
            </tr>
          </thead>
          <tbody>
            {modes.map(m => {
              const c = toNum(collections[m] ?? collections[m.toLowerCase()]);
              const ref = toNum(refunds[m] ?? refunds[m.toLowerCase()]);
              if (c === 0 && ref === 0) return null;
              return (
                <tr key={m}>
                  <td>
                    <span className={`pr-paymethod pr-paymethod--${m.toLowerCase()}`}>{m}</span>
                  </td>
                  <td className="right">{c > 0 ? fmtINR(c) : "—"}</td>
                  <td className="right" style={{ color: ref > 0 ? "#b91c1c" : "#94a3b8" }}>
                    {ref > 0 ? `- ${fmtINR(ref)}` : "—"}
                  </td>
                  <td className="right" style={{ fontWeight: 700 }}>{fmtINR(c - ref)}</td>
                </tr>
              );
            })}
            <tr style={{ background: "#f8fafc", fontWeight: 800 }}>
              <td>Total</td>
              <td className="right">{fmtINR(collectedTotal)}</td>
              <td className="right" style={{ color: refundedTotal > 0 ? "#b91c1c" : "inherit" }}>
                {refundedTotal > 0 ? `- ${fmtINR(refundedTotal)}` : "—"}
              </td>
              <td className="right">{fmtINR(collectedTotal - refundedTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Advances summary */}
      {(advancesTaken > 0 || advancesApplied > 0) && (
        <div className="pr-section">
          <div className="pr-section__title">Advance Deposits</div>
          <table className="pr-table" style={{ fontSize: 10.5 }}>
            <thead>
              <tr>
                <th>Activity</th>
                <th className="right" style={{ width: 130 }}>Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Advances received (deposits taken)</td>
                <td className="right">{fmtINR(advancesTaken)}</td>
              </tr>
              <tr>
                <td>Advances applied (credited to final bills)</td>
                <td className="right">{fmtINR(advancesApplied)}</td>
              </tr>
              <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
                <td>Net advance movement</td>
                <td className="right">{fmtINR(advancesTaken - advancesApplied)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Counts strip */}
      {(totalReceipts > 0 || totalRefunds > 0 || totalAdvances > 0) && (
        <div className="pr-section">
          <div className="pr-section__title">Document Counts</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, fontSize: 11 }}>
            {[
              { label: "Receipts Issued",   value: totalReceipts },
              { label: "Refunds Issued",    value: totalRefunds },
              { label: "Advances Recorded", value: totalAdvances },
            ].map((t, i) => (
              <div key={i} style={{
                border: "1px solid #e2e8f0", borderRadius: 6,
                padding: "8px 10px", background: "#f8fafc", textAlign: "center",
              }}>
                <div style={{ fontSize: 8.5, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>{t.label}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{t.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Variance / notes */}
      {(variance != null && variance !== 0) && (
        <div className="pr-section">
          <div className="pr-section__title">Cash Variance Note</div>
          <div className="pr-section__body" style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>
            {r.varianceNote || "Cash count variance noted — record explanation, witness, and corrective action."}
          </div>
        </div>
      )}

      <div className="pr-section">
        <div className="pr-section__title">Hand-over Declaration</div>
        <div className="pr-section__body" style={{ fontSize: 11, lineHeight: 1.55 }}>
          I, {r.cashierName || "the undersigned cashier"}, certify that the figures stated above represent
          a complete and accurate reconciliation of my shift's collections, refunds, and cash drawer.
          The cash count was performed jointly with the supervisor on hand-over.
        </div>
      </div>
    </PrintShell>
  );
};

export default CashierShiftClosePrint;
