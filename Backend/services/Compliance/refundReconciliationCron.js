/**
 * services/Compliance/refundReconciliationCron.js — GST Act §34 / NABH-BILLING
 *
 * Refund → credit-note reconciliation (detective control). Under GST §34 every
 * post-invoice value reduction (a refund on a numbered tax invoice) must be
 * backed by a credit note that lands on GSTR-1's CDNR section — otherwise the
 * hospital keeps paying output GST on money it handed back.
 *
 * The refund path (autoBillingService) emits a CreditNote linked to the bill
 * via `billId`. This cron independently re-checks that linkage each night:
 *   • Every bill in REFUNDED status must have ≥ 1 CreditNote(billId).
 *     A REFUNDED bill with zero CN is a §34 exception the accountant must
 *     clear before the month is filed.
 *   • CreditNotes whose billId no longer resolves to a bill are dangling
 *     (data-integrity signal).
 * Findings are surfaced as one idempotent BillingAudit summary row; the cron
 * never mutates ledgers — it only reports.
 *
 * Window: bills updated in the last `lookbackDays` (default 45 — one GST
 * filing cycle plus slack). Run nightly via index.js.
 */
"use strict";

const PatientBill = require("../../models/PatientBillModel/PatientBillModel");
const CreditNote = require("../../models/Billing/CreditNote");

async function _audit(reason, after) {
  try {
    const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
    await emitBillingAudit({ event: "CRON_RECONCILED", actorName: "System (refund-recon)", reason, after });
  } catch (e) {
    console.warn("[refund-recon] audit emit failed:", e.message);
  }
}

/**
 * runReconciliation({ lookbackDays = 45, now })
 * @returns {Promise<{scanned, withCN, orphanRefunds, danglingCreditNotes, exceptions, runAt}>}
 */
async function runReconciliation({ lookbackDays = 45, now } = {}) {
  const runAt = now instanceof Date ? now : new Date();
  const since = new Date(runAt.getTime() - Math.max(1, lookbackDays) * 24 * 60 * 60 * 1000);

  // ── 1. Refunded bills must each carry a credit note ──────────────
  const refundedBills = await PatientBill
    .find({ billStatus: "REFUNDED", updatedAt: { $gte: since } })
    .select("_id billNumber UHID updatedAt grandTotal")
    .limit(5000)
    .lean();

  const orphanRefunds = [];
  let withCN = 0;
  for (const b of refundedBills) {
    const cnCount = await CreditNote.countDocuments({ billId: b._id });
    if (cnCount > 0) { withCN += 1; continue; }
    orphanRefunds.push({
      billId: String(b._id),
      billNumber: b.billNumber || "(unnumbered)",
      UHID: b.UHID || "",
      refundedAt: b.updatedAt,
    });
  }

  // ── 2. Credit notes whose bill no longer resolves (dangling) ─────
  const recentCNs = await CreditNote
    .find({ creditNoteDate: { $gte: since } })
    .select("_id creditNoteNumber billId originalBillNumber")
    .limit(5000)
    .lean();

  const danglingCreditNotes = [];
  if (recentCNs.length) {
    const billIds = [...new Set(recentCNs.map((c) => String(c.billId)).filter(Boolean))];
    const existing = new Set(
      (await PatientBill.find({ _id: { $in: billIds } }).select("_id").lean()).map((b) => String(b._id)),
    );
    for (const c of recentCNs) {
      if (!c.billId || !existing.has(String(c.billId))) {
        danglingCreditNotes.push({
          creditNoteNumber: c.creditNoteNumber || "(unnumbered)",
          billId: c.billId ? String(c.billId) : null,
          originalBillNumber: c.originalBillNumber || "",
        });
      }
    }
  }

  const result = {
    scanned: refundedBills.length,
    withCN,
    orphanRefunds,
    danglingCreditNotes,
    exceptions: orphanRefunds.length + danglingCreditNotes.length,
    runAt: runAt.toISOString(),
    lookbackDays,
  };

  if (result.exceptions > 0) {
    await _audit(
      `Refund↔CreditNote reconciliation: ${orphanRefunds.length} refunded bill(s) missing a §34 credit note, ` +
        `${danglingCreditNotes.length} dangling CN(s). Clear before GST filing.`,
      {
        kind: "REFUND_CN_RECONCILIATION",
        orphanRefundBills: orphanRefunds.slice(0, 50).map((o) => o.billNumber),
        danglingCNs: danglingCreditNotes.slice(0, 50).map((d) => d.creditNoteNumber),
        scanned: result.scanned,
        withCN: result.withCN,
      },
    );
  }

  return result;
}

module.exports = { runReconciliation };
