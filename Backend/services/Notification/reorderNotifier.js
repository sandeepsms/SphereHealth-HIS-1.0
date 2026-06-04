/**
 * reorderNotifier.js  (R7bd-E-3 / A2-MED-17)
 *
 * Stub-level outbound notification fan-out for low-stock alerts. Real
 * SMS / email / Slack wiring is deferred — this service:
 *
 *   1. console.log()s the alert with full context
 *   2. writes a BillingAudit row (event reuses the closest existing
 *      enum value; future cycle should add NOTIFY_LOW_STOCK explicitly)
 *
 * The notifier is invoked by:
 *   • the new daily cron `reorder-notifier` registered in Backend/index.js
 *   • optionally other code paths that detect low stock mid-day
 *
 * Public surface:
 *   notifyLowStock(items, recipients)
 *     items      → [{ drugId, drugName, totalRemaining, reorderLevel, batchCount }]
 *     recipients → [{ name, email?, phone?, role? }] (informational only;
 *                                                    not yet dispatched)
 */
let BillingAudit;
try {
  BillingAudit = require("../../models/Billing/BillingAudit");
} catch (_) { BillingAudit = null; }

async function notifyLowStock(items = [], recipients = []) {
  const arr = Array.isArray(items) ? items : [];
  if (arr.length === 0) {
    return { sent: 0, channel: "noop", note: "no items below reorder level" };
  }
  // Compact log line — one row, full context. Operators tail the
  // pharmacy log; this is the single source of truth until real
  // SMS / email / Slack wiring lands.
  const summary = arr
    .slice(0, 25)
    .map((x) => `${x.drugName}(${x.totalRemaining}/${x.reorderLevel})`)
    .join(", ");
  // eslint-disable-next-line no-console
  console.log(
    `[reorder-notifier] ${arr.length} drug(s) below reorder level → ` +
    `${summary}${arr.length > 25 ? " …+" + (arr.length - 25) : ""}. ` +
    `Recipients: ${recipients.length || "(none configured)"}.`,
  );

  // BillingAudit best-effort. Pre-R7bd the closest enumerated event is
  // MASTER_DRUG_PRICE_CHANGED (master-data lifecycle bucket). A future
  // cycle should add NOTIFY_LOW_STOCK to the enum + bump retention to
  // 1y (routine). Until then we audit at 3y under master-data which is
  // still well within NABH expectations.
  try {
    if (BillingAudit && typeof BillingAudit.emitBillingAudit === "function") {
      await BillingAudit.emitBillingAudit({
        event:     "MASTER_DRUG_PRICE_CHANGED",
        actorName: "System (reorder-notifier)",
        reason:    `Low-stock notifier: ${arr.length} drug(s) below reorder. Recipients: ${recipients.length}.`,
        after: {
          items:      arr.slice(0, 50),
          itemsCount: arr.length,
          recipients: recipients.slice(0, 25),
        },
      });
    }
  } catch (e) {
    // Audit failure must not break the notifier — log + carry on.
    // eslint-disable-next-line no-console
    console.warn(`[reorder-notifier] audit emit failed: ${e.message}`);
  }

  return {
    sent: arr.length,
    channel: "log",
    recipients: recipients.length,
    note: "stub — real SMS/email/Slack delivery deferred",
  };
}

// R7hr-12-S2 (D8-10): pre-expiry batch notifier. Mirrors notifyLowStock —
// console.log + one BillingAudit summary row per cron run. NABH MOM.4
// requires "systems to identify and remove expired/recalled medications
// BEFORE administration" — a proactive cron sweep (separate from the
// on-demand /api/pharmacy/alerts dashboard tile) ensures procurement +
// pharmacy supervisor get a daily push even when no one opens the page.
//
// items shape (per the audit's suggested refinement):
//   { drugId, drugName, batchNo, expiryDate, daysToExpiry, remaining,
//     supplierName?, salePrice? }
//
// Caller is the new `pharmacy-expiry-watch` cron in Backend/index.js. It
// buckets items into urgent (≤30d), soon (≤60d), watch (≤90d), expired
// (<0d) on the way in; we surface bucket counts in the audit summary.
async function notifyExpiry(items = [], recipients = []) {
  const arr = Array.isArray(items) ? items : [];
  if (arr.length === 0) {
    return { sent: 0, channel: "noop", note: "no batches within expiry horizon" };
  }
  // Bucket counts for the summary line + audit row.
  const buckets = { expired: 0, urgent: 0, soon: 0, watch: 0 };
  for (const x of arr) {
    const d = Number(x.daysToExpiry);
    if (!Number.isFinite(d))     continue;
    if (d < 0)                   buckets.expired++;
    else if (d <= 30)            buckets.urgent++;
    else if (d <= 60)            buckets.soon++;
    else                         buckets.watch++;
  }
  const summary = arr
    .slice(0, 25)
    .map((x) => `${x.drugName}[${x.batchNo}](exp ${String(x.expiryDate).slice(0, 10)}/${x.daysToExpiry}d, rem ${x.remaining})`)
    .join(", ");
  // eslint-disable-next-line no-console
  console.log(
    `[expiry-notifier] ${arr.length} batch(es) within expiry horizon ` +
    `(expired=${buckets.expired}, ≤30d=${buckets.urgent}, ≤60d=${buckets.soon}, ≤90d=${buckets.watch}) → ` +
    `${summary}${arr.length > 25 ? " …+" + (arr.length - 25) : ""}. ` +
    `Recipients: ${recipients.length || "(none configured)"}.`,
  );

  // BillingAudit best-effort. Same retention pattern as notifyLowStock —
  // ride MASTER_DRUG_PRICE_CHANGED until a dedicated NOTIFY_BATCH_EXPIRY
  // enum value lands. Master-data class → 3y retention which is well
  // within NABH MOM.4 expectations for this signal.
  try {
    if (BillingAudit && typeof BillingAudit.emitBillingAudit === "function") {
      await BillingAudit.emitBillingAudit({
        event:     "MASTER_DRUG_PRICE_CHANGED",
        actorName: "System (pharmacy-expiry-watch)",
        reason:    `Pharmacy expiry sweep: expired=${buckets.expired}, ≤30d=${buckets.urgent}, ` +
                   `≤60d=${buckets.soon}, ≤90d=${buckets.watch}. Total=${arr.length}. ` +
                   `Recipients: ${recipients.length}.`,
        after: {
          buckets,
          items:      arr.slice(0, 50),
          itemsCount: arr.length,
          recipients: recipients.slice(0, 25),
        },
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[expiry-notifier] audit emit failed: ${e.message}`);
  }

  return {
    sent: arr.length,
    channel: "log",
    recipients: recipients.length,
    buckets,
    note: "stub — real SMS/email/Slack delivery deferred",
  };
}

module.exports = { notifyLowStock, notifyExpiry };
