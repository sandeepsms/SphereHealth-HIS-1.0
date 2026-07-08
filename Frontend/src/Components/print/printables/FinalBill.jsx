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
import { fmtINR } from "../amountWords";
import { numberToIndianWords, toNum } from "../../../utils/printUtils";

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

  const sumOf = (g) => g.items.reduce((s, it) => s + toNum(it.amount), 0);

  // R7bf-F / A4-HIGH-1: every money field goes through toNum() so raw
  // Decimal128 ({$numberDecimal:"..."}) wire shapes can never bleed
  // into the rendered total as a literal string.
  const gross     = groups.reduce((s, g) => s + sumOf(g), 0);
  const advances  = toNum(receipt.advanceReceived);
  const discount  = toNum(receipt.discount);
  const tpaPaid   = toNum(receipt.tpaPaid);
  const tax       = toNum(receipt.tax);
  const tdsDeducted = toNum(receipt.tdsDeducted ?? receipt.tdsAmount);
  // R7bf-F / A4-CRIT-3: GST split per slab. When non-zero, render in
  // place of the generic "tax" line so GSTR-1 trace is preserved.
  const cgst      = toNum(receipt.cgstAmount);
  const sgst      = toNum(receipt.sgstAmount);
  const igst      = toNum(receipt.igstAmount);
  const taxTotal  = cgst + sgst + igst || tax;
  const netBefore = gross - discount;
  const netAfterTax = netBefore + taxTotal;
  // R7bf-F / A4-HIGH-7: settlement / TPA bills carry a TDS-deducted line
  // (subtracted before Net Receivable). When tdsDeducted=0 the line is
  // hidden so retail bills keep their existing layout.
  const payable   = Math.max(0, netAfterTax - advances - tpaPaid - tdsDeducted);
  const hasGstFields = !!(
    receipt.customerGstin ||
    receipt.placeOfSupply ||
    cgst || sgst || igst ||
    groups.some(g => g.items.some(it => it.hsnSacCode || it.hsnSac))
  );
  const printCount = toNum(receipt.printCount);

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
  // R7eo-A — Pattern A fix: the discharge title hardcoded "/ IPD",
  // so Daycare + Emergency discharges printed under the wrong banner.
  // Read receipt.visitType (or admissionType as a fallback) and slot
  // the right label into both the GST and non-GST variants. Legacy
  // callers that pass neither field keep the original "IPD" string.
  const visitTypeRaw = String(
    receipt.visitType || receipt.admissionType || "IPD"
  ).toUpperCase();
  const visitLabel =
      visitTypeRaw === "DAYCARE"   ? "Daycare"
    : visitTypeRaw === "DAY CARE"  ? "Daycare"
    : visitTypeRaw === "EMERGENCY" ? "Emergency"
    : visitTypeRaw === "ER"        ? "Emergency"
    : visitTypeRaw === "OPD"       ? "OPD"
                                   : "IPD";
  const docTitle  = isAudit
    ? `Bill Audit Trail — Day ${receipt.totalDays || "?"}`
    : isInterim
    ? `Interim Bill${isDaily ? " (Daily Breakdown)" : ""} — Day ${receipt.totalDays || "?"}`
    : (hasGstFields
        ? `Tax Invoice (Final / ${visitLabel})`
        : `Final Bill (Discharge / ${visitLabel})`);
  const dischargeLabel = isInterim || isAudit ? "Discharge (planned)" : "Discharged";
  // R7bf-F / A4-HIGH-9: IPD interim bill must carry "as on dd-mmm hh:mm"
  // banner so the patient can tell it's a snapshot, not the final bill.
  const interimAsOf = isInterim
    ? new Date().toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : null;

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
      completed: { bg: "#e0e7ff", fg: "#4f46e5" },
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
        printCount={printCount}
        infoItems={[
          { label: "Patient",       value: receipt.patientName },
          { label: "UHID",          value: receipt.uhid },
          { label: visitTypeRaw === "IPD" ? "IPD No" : "Admission No", value: receipt.ipdNo },
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
      printCount={printCount}
      watermarkRecipient={hasGstFields ? "RECIPIENT" : undefined}
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
        ...(hasGstFields ? [
          { label: "Place of Supply", value: receipt.placeOfSupply || "—" },
          { label: "Customer GSTIN",  value: receipt.customerGstin || "—" },
        ] : []),
      ]}
      signatureLabels={["Billing Officer", "Patient / Attendant"]}
    >
      {isInterim && (
        <div style={{
          background: "#fef3c7", border: "1px solid #fcd34d",
          color: "#92400e", padding: "8px 14px", borderRadius: 6,
          marginBottom: 12, fontSize: 11, fontWeight: 700,
        }}>
          INTERIM BILL — as on {interimAsOf}. Final bill will be issued at discharge.
        </div>
      )}
      {hasGstFields && (receipt.customerLegalName || receipt.customerAddress) && (
        <div className="pr-section">
          <div className="pr-section__title">Bill To (Customer)</div>
          <div className="pr-section__body" style={{ fontSize: 11 }}>
            {receipt.customerLegalName && <div><strong>{receipt.customerLegalName}</strong></div>}
            {receipt.customerAddress && <div>{receipt.customerAddress}</div>}
            {receipt.customerGstin && <div>GSTIN: <strong>{receipt.customerGstin}</strong></div>}
          </div>
        </div>
      )}
      {/* ── Category-grouped bill table ── */}
      {groups.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontStyle: "italic" }}>
          No charges recorded.
        </div>
      ) : (
        <div className={hasGstFields ? "pr-gst-invoice" : ""}>
          <table className="pr-table">
            <thead>
              <tr>
                <th style={{ width: 30 }}>#</th>
                <th>Particulars</th>
                {hasGstFields && <th style={{ width: 70 }}>HSN/SAC</th>}
                <th className="center" style={{ width: 50 }}>Qty</th>
                <th className="right" style={{ width: 75 }}>Rate (₹)</th>
                {hasGstFields && <th className="right" style={{ width: 50 }}>GST %</th>}
                <th className="right" style={{ width: 90 }}>Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => {
                const sub = sumOf(g);
                const cols = hasGstFields ? 7 : 5;
                // R7bf-F / A4-HIGH-8: daycare same-day proration label.
                // Receipt sets `receipt.daycareProrationHours` (set by
                // billingService for daycare admissions with same-day
                // discharge). The chip is rendered next to the Room/Bed
                // category header so the patient sees WHY the bed
                // charge is half.
                const daycareNote = (g.name === "Room/Bed Charges" && toNum(receipt.daycareProrationHours) > 0)
                  ? `(Pro-rata: ${toNum(receipt.daycareProrationHours)}h stay)`
                  : null;
                return (
                  <React.Fragment key={gi}>
                    <tr>
                      <td colSpan={cols} style={{
                        background: "var(--pr-accent-color, #4f46e5)15",
                        color: "var(--pr-accent-color, #4f46e5)",
                        fontWeight: 800,
                        fontSize: 10.5,
                        textTransform: "uppercase",
                        letterSpacing: ".5px",
                        padding: "6px 10px",
                      }}>
                        {g.name}
                        {daycareNote && (
                          <span style={{
                            marginLeft: 8, fontSize: 9.5, fontWeight: 700,
                            color: "#a16207", background: "#fef3c7",
                            padding: "1px 6px", borderRadius: 4,
                            letterSpacing: ".2px", textTransform: "none",
                          }}>{daycareNote}</span>
                        )}
                      </td>
                    </tr>
                    {g.items.map((it, i) => (
                      <tr key={i} className="bill-line-row">
                        <td>{i + 1}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{it.name || it.service || it.particulars || it.serviceName}</div>
                          {it.description && <div className="muted" style={{ fontSize: 10 }}>{it.description}</div>}
                          {it.date && <div className="muted" style={{ fontSize: 10 }}>
                            {new Date(it.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                          </div>}
                        </td>
                        {hasGstFields && <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 10 }}>{it.hsnSacCode || it.hsnSac || "—"}</td>}
                        <td className="center">{it.qty || it.quantity || 1}</td>
                        <td className="right">{toNum(it.rate || it.unitPrice || it.amount).toLocaleString("en-IN")}</td>
                        {hasGstFields && <td className="right">{toNum(it.taxPercent ?? it.gstRate ?? 0)}%</td>}
                        <td className="right">{toNum(it.amount).toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={cols - 1} className="right" style={{ fontWeight: 700, color: "#475569", paddingTop: 5, paddingBottom: 5 }}>
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
        </div>
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
        {cgst > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Add: CGST</span>
            <span className="pr-totals__val">+ {fmtINR(cgst)}</span>
          </div>
        )}
        {sgst > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Add: SGST</span>
            <span className="pr-totals__val">+ {fmtINR(sgst)}</span>
          </div>
        )}
        {igst > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Add: IGST</span>
            <span className="pr-totals__val">+ {fmtINR(igst)}</span>
          </div>
        )}
        {(!cgst && !sgst && !igst && tax > 0) && (
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
        {/* R7bf-F / A4-HIGH-7: TDS deducted (TPA settlement bills) */}
        {tdsDeducted > 0 && (
          <div className="pr-totals__row">
            <span className="pr-totals__lbl">Less: TDS Deducted</span>
            <span className="pr-totals__val">- {fmtINR(tdsDeducted)}</span>
          </div>
        )}
        <div className="pr-totals__row pr-totals__row--grand">
          <span className="pr-totals__lbl">
            {payable > 0 ? "Net Payable" : "Refund Due"}
          </span>
          <span className="pr-totals__val">
            {payable > 0 ? fmtINR(payable) : fmtINR(advances + tpaPaid + tdsDeducted - netAfterTax)}
          </span>
        </div>
      </div>

      <div className="pr-amount-words">
        <strong>{payable > 0 ? "Total in words: " : "Refund in words: "}</strong>
        {numberToIndianWords(payable > 0 ? payable : (advances + tpaPaid + tdsDeducted - netAfterTax))}
      </div>

      {/* R7hr(billing-audit P1.2) — same-episode OPD charges memo. Referenced,
          not merged (the OPD visit keeps its own GST bill + number), so the
          discharge document still shows the whole episode in one place. */}
      {receipt.preAdmissionOpd && (
        <div className="pr-note" style={{ marginTop: 8, padding: "8px 12px", border: "1px dashed #c7d2fe", background: "#eef2ff", borderRadius: 6, fontSize: 10.5 }}>
          <strong>Pre-admission OPD charges (same episode):</strong>{" "}
          {fmtINR(receipt.preAdmissionOpd.net)}
          {receipt.preAdmissionOpd.billNumber ? ` · billed separately on ${receipt.preAdmissionOpd.billNumber}` : ""}
          {Number(receipt.preAdmissionOpd.due) > 0
            ? ` · ₹${Number(receipt.preAdmissionOpd.due).toFixed(2)} still outstanding on that bill`
            : " · settled"}
        </div>
      )}

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
