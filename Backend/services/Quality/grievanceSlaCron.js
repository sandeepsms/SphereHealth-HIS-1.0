/**
 * services/Quality/grievanceSlaCron.js  (R7bh-F6 / R7bg CRIT-A6 / NABH PRE.6)
 *
 * Cron entry-point that wraps grievanceService.escalateOverdue and
 * adds the auditing + lock semantics expected by Backend/index.js.
 *
 * NABH PRE.6 — every grievance must be redressed within its SLA window.
 * Pre-R7bh `slaHours` was captured on the Grievance row but nothing
 * actually escalated when the deadline passed; OPEN tickets quietly
 * aged and slipped off the operator's radar. This cron runs hourly
 * (configured in Backend/index.js) and flips OPEN/IN_PROGRESS rows
 * past their slaHours window to ESCALATED with reason="SLA breach".
 *
 * Best-effort audit emit. Idempotent.
 */
"use strict";

const grievanceService = require("./grievanceService");

async function runSlaEscalation() {
  let r;
  try {
    r = await grievanceService.escalateOverdue();
  } catch (e) {
    console.error("[grievance-sla-cron] error:", e.stack || e.message);
    return { error: e.message };
  }

  // Audit summary row — only when something actually escalated (avoid
  // flooding the audit feed with empty ticks).
  if (r && (r.escalated || 0) > 0) {
    try {
      const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
      await emitBillingAudit({
        event: "CRON_RECONCILED",
        actorName: "System (grievance-sla-cron)",
        reason: `Grievance SLA breach: ${r.escalated} of ${r.scanned} open ticket(s) escalated.`,
        after: { kind: "GRIEVANCE_SLA_BREACH", ...r, runAt: new Date().toISOString() },
      });
    } catch (e) {
      console.warn("[grievance-sla-cron] audit emit failed:", e.message);
    }
  }
  return r;
}

module.exports = { runSlaEscalation };
