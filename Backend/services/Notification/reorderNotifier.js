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

module.exports = { notifyLowStock };
