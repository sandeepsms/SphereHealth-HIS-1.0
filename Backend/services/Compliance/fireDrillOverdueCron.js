/**
 * services/Compliance/fireDrillOverdueCron.js  (R7bh-F6 / R7bg CRIT-A6 / NABH FMS.4)
 *
 * NABH FMS.4 mandates fire drills + emergency-code drills run at the
 * scheduled cadence (quarterly minimum). Pre-R7bh a SCHEDULED drill
 * whose date had passed without conduct stayed SCHEDULED forever — the
 * register couldn't distinguish "tomorrow's drill" from "missed last
 * quarter's drill". This cron flips overdue rows to OVERDUE so the UI
 * + audit register surface the gap.
 *
 * Two overdue conditions (whichever fires first):
 *   1. A SCHEDULED drill whose `scheduledDate` is in the past.
 *   2. A COMPLETED drill whose `nextDrillDue` is in the past AND no
 *      newer drill exists for the same type (placeholder — keeps the
 *      historical row immutable; the OVERDUE flag lives on the most
 *      recent SCHEDULED row that should have been booked).
 *
 * The cron emits a single BillingAudit summary row per run (idempotent).
 */
"use strict";

const FireDrill = require("../../models/Compliance/FireDrillModel");

async function runOverdueSweep() {
  const now = new Date();
  // CAS — only flip SCHEDULED → OVERDUE when scheduledDate has passed.
  // nextDrillDue is the secondary deadline carried on the COMPLETED row
  // for the drill type cadence; if it's in the past AND there's no
  // SCHEDULED follow-up, we don't currently auto-create — that's a
  // separate scheduler responsibility. This cron only flags rows that
  // already exist in SCHEDULED state.
  const r = await FireDrill.updateMany(
    { status: "SCHEDULED", scheduledDate: { $lt: now } },
    { $set: { status: "OVERDUE" } },
  );
  const result = {
    matched: r.matchedCount,
    modified: r.modifiedCount,
    runAt: now.toISOString(),
  };

  if (result.modified > 0) {
    try {
      const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
      await emitBillingAudit({
        event: "CRON_RECONCILED",
        actorName: "System (fire-drill-overdue)",
        reason: `Fire-drill register: ${result.modified} SCHEDULED drill(s) past scheduledDate flipped to OVERDUE.`,
        after: { kind: "FIREDRILL_OVERDUE", ...result },
      });
    } catch (e) {
      console.warn("[fire-drill-overdue] audit emit failed:", e.message);
    }
  }
  return result;
}

module.exports = { runOverdueSweep };
