// Components/print/printables/FinalBill.jsx
// Final IPD bill / discharge bill — itemized by charge category
// (bed, doctor, nursing, pharmacy, lab, radiology, procedure, consumable),
// subtotals per category, advances received, discount, tax, payable.
//
// Doubles as the Interim Bill printable when registered under the
// "interim-bill" slug — the IPD Live Ledger fires openPrint("interim-bill")
// with the same payload shape. Caller sets `receipt.isInterim = true` to
// flip the title/heading + add the "Day N" stamp; everything else (item
// grouping, subtotals, totals box, payment history) is identical.

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

  // Interim mode flips the document title + adds a Day-N stamp so the
  // patient understands the bill is a running snapshot, not the final
  // settlement. The same template can be reused once final discharge
  // happens by clearing the flag.
  //
  // viewMode drives WHICH middle table is rendered — IPDBillingLedger
  // passes the currently-active tab so the printout mirrors the on-screen
  // view:
  //   "category" → bed/nursing/doctor/drugs/etc. grouped sections (default)
  //   "day"      → Day-1 / Day-2 / Day-3 grouped sections
  //   "audit"    → flat chronological log with source + actor + status
  //                + override / void rows inline (no totals — it's a
  //                compliance log, not a bill).
  const isInterim = !!receipt.isInterim;
  const viewMode  = receipt.viewMode || "category";
  const isAudit   = viewMode === "audit";
  const isDaily   = viewMode === "day";
  const docTitle  = isAudit
    ? `Bill Audit Trail — Day ${receipt.totalDays || "?"}`
    : isInterim
    ? `Interim Bill${isDaily ? " (Daily Breakdown)" : ""} — Day ${receipt.totalDays || "?"}`
    : "Final Bill (Discharge / IPD)";
  const dischargeLabel = isInterim || isAudit ? "Discharge (planned)" : "Discharged";

  /* ── Audit Trail branch ─────────────────────────────────────────
     A completely different middle section: one row per trigger in
     chronological order, with override / void sub-rows so a
     compliance reviewer can replay every change. No totals box —
     "running ledger" only. Hospital-tone amber banner replaces the
     interim-bill yellow one. */
  if (isAudit) {
    const audit = Array.isArray(receipt.auditEntries) ? receipt.auditEntries : [];
    const statusTone = (s) => ({
      billed:    { bg: "#dcfce7", fg: "#15803d" },
      pending:   { bg: "#fef3c7", fg: "#a16207" },
      completed: { bg: "#dbeafe", fg: "#1d4ed8" },
      voided:    { bg: "#fee2e2", fg: "#b91c1c" },
      cancelled: { bg: "#fee2e2", fg: "#b91c1c" },
      skipped:   { bg: "#f1f5f9", fg: "#475569" },
    }[s] || { bg: "#f1f5f9", fg: "#475569" });
    const liveTotal = audit
      .filter(e => !["voided", "cancelled", "skipped"].includes(e.status))
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const voidedTotal = audit
      .filter(e => ["voided", "cancelled"].includes(e.status))
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);

    return (
      <PrintShell
        settings={settings}
        documentTitle={docTitle}
        serialNo={receipt.billNo || receipt.invoiceNo}
        infoItems={[
          { label: "Patient",       value: receipt.patientName },
          { label: "UHID",          value: receipt.uhid },
          { label: "IPD No",        value: receipt.ipdNo },
          { label: "Age / Sex",     value: [receipt.age && `${receipt.age}Y`, receipt.gender].filter(Boolean).join(" / ") },
          { label: "Admitted",      value: receipt.admissionDate
              ? new Date(receipt.admissionDate).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—" },
          { label: "Length of Stay",value: receipt.totalDays ? `${receipt.totalDays} day${receipt.totalDays === 1 ? "" : "s"}${isInterim ? " (so far)" : ""}` : "—" },
          { label: "Bed / Ward",    value: [receipt.bedNumber, receipt.wardName].filter(Boolean).join(" · ") },
          { label: "Consultant",    value: receipt.consultantName },
          { label: "Entries",       value: `${audit.length} (${audit.filter(e => e.status === "billed").length} billed)` },
          { label: "Snapshot",      value: new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) },
        ]}
        signatureLabels={["Reviewed By", "Operator"]}
      >
        <div style={{
          background: "#fffbeb", border: "1px solid #fcd34d",
          color: "#92400e", padding: "8px 14px", borderRadius: 6,
          marginBottom: 12, fontSize: 11, fontWeight: 700,
        }}>
          BILL AUDIT TRAIL — chronological log of every charge fired against this admission, including voided / cancelled entries. For compliance review.
        </div>

        <table className="pr-table" style={{ fontSize: 10.5 }}>
          <thead>
            <tr>
              <th style={{ width: 110 }}>When</th>
              <th style={{ width: 75 }}>Source</th>
              <th>Service</th>
              <th className="center" style={{ width: 40 }}>Qty</th>
              <th className="right" style={{ width: 65 }}>Rate</th>
              <th className="right" style={{ width: 75 }}>Amount</th>
              <th className="center" style={{ width: 65 }}>Status</th>
              <th style={{ width: 110 }}>Actor</th>
            </tr>
          </thead>
          <tbody>
            {audit.length === 0 ? (
              <tr><td colSpan={8} className="muted center" style={{ padding: 20, fontStyle: "italic" }}>
                No audit entries.
              </td></tr>
            ) : audit.map((e, i) => {
              const t = statusTone(e.status);
              const closed = e.status === "voided" || e.status === "cancelled";
              return (
                <React.Fragment key={i}>
                  <tr>
                    <td style={{ fontSize: 10 }}>{e.when ? new Date(e.when).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    <td style={{ fontSize: 10, fontFamily: "'DM Mono', monospace" }}>{e.source || "—"}</td>
                    <td>
                      <div style={{ fontWeight: 700, textDecoration: closed ? "line-through" : "none", color: closed ? "#94a3b8" : "#0f172a" }}>
                        {e.name}
                      </div>
                      {e.code && <div className="muted" style={{ fontSize: 9.5, fontFamily: "'DM Mono', monospace" }}>{e.code}</div>}
                      {e.remarks && <div className="muted" style={{ fontSize: 9.5, fontStyle: "italic" }}>{e.remarks}</div>}
                    </td>
                    <td className="center">{e.qty}</td>
                    <td className="right">{fmtINR(e.rate)}</td>
                    <td className="right" style={{ fontWeight: 700, textDecoration: closed ? "line-through" : "none", color: closed ? "#94a3b8" : "#0f172a" }}>
                      {fmtINR(e.amount)}
                    </td>
                    <td className="center">
                      <span style={{
                        background: t.bg, color: t.fg,
                        padding: "1px 6px", borderRadius: 8,
                        fontSize: 9, fontWeight: 800, textTransform: "uppercase",
                      }}>{e.status}</span>
                    </td>
                    <td style={{ fontSize: 9.5 }}>{e.actor}</td>
                  </tr>
                  {/* Override history rows */}
                  {Array.isArray(e.overrideHistory) && e.overrideHistory.map((h, hi) => (
                    <tr key={`o-${i}-${hi}`} style={{ background: "#fffbeb" }}>
                      <td colSpan={8} style={{ fontSize: 9.5, padding: "4px 10px 4px 24px", color: "#a16207" }}>
                        ↪ OVERRIDE {h.changedAt ? new Date(h.changedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""} —{" "}
                        <strong>{JSON.stringify(h.oldValue)}</strong> → <strong>{JSON.stringify(h.newValue)}</strong>{" "}
                        — <em>{h.reason}</em> · {h.changedBy}{h.changedByRole ? ` (${h.changedByRole})` : ""}
                      </td>
                    </tr>
                  ))}
                  {/* Void / cancel row */}
                  {e.voidedAt && (
                    <tr style={{ background: "#fef2f2" }}>
                      <td colSpan={8} style={{ fontSize: 9.5, padding: "4px 10px 4px 24px", color: "#b91c1c" }}>
                        ↪ {e.status === "cancelled" ? "CANCELLED" : "VOIDED"} {new Date(e.voidedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{" "}
                        — <em>{e.voidReason}</em> · {e.voidedBy}{e.voidedByRole ? ` (${e.voidedByRole})` : ""}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        {/* Compact summary at the bottom — not a totals box, just a tally */}
        <div className="pr-totals">
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Live Total (excludes voided / cancelled)</span>
            <span className="pr-totals__val">{fmtINR(liveTotal)}</span>
          </div>
          {voidedTotal > 0 && (
            <div className="pr-totals__row">
              <span className="pr-totals__lbl">Voided / Cancelled (informational)</span>
              <span className="pr-totals__val">{fmtINR(voidedTotal)}</span>
            </div>
          )}
        </div>
      </PrintShell>
    );
  }

  return (
    <PrintShell
      settings={settings}
      documentTitle={docTitle}
      serialNo={receipt.billNo || receipt.invoiceNo}
      infoItems={[
        { label: "Patient",       value: receipt.patientName },
        { label: "UHID",          value: receipt.uhid },
        { label: "IPD No",        value: receipt.ipdNo },
        { label: "Age / Sex",     value: [receipt.age && `${receipt.age}Y`, receipt.gender].filter(Boolean).join(" / ") },
        { label: "Admitted",      value: receipt.admissionDate
            ? new Date(receipt.admissionDate).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : "—" },
        { label: dischargeLabel,  value: receipt.dischargeDate
            ? new Date(receipt.dischargeDate).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : (isInterim ? "Ongoing" : "—") },
        { label: "Length of Stay",value: receipt.totalDays ? `${receipt.totalDays} day${receipt.totalDays === 1 ? "" : "s"}${isInterim ? " (so far)" : ""}` : "—" },
        { label: "Bed / Ward",    value: [receipt.bedNumber, receipt.wardName].filter(Boolean).join(" · ") },
        { label: "Consultant",    value: receipt.consultantName },
        { label: isInterim ? "Working Dx" : "Final Dx", value: receipt.finalDiagnosis },
        { label: "TPA / Scheme",  value: receipt.tpaName || receipt.scheme },
        { label: "Bill Date",     value: new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) },
      ]}
      signatureLabels={["Billing Officer", "Patient / Attendant"]}
    >
      {isInterim && (
        <div style={{
          background: "#fef3c7", border: "1px solid #fcd34d",
          color: "#92400e", padding: "8px 14px", borderRadius: 6,
          marginBottom: 12, fontSize: 11, fontWeight: 700,
        }}>
          INTERIM BILL — snapshot as of {new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}. Final bill will be issued at discharge.
        </div>
      )}
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
