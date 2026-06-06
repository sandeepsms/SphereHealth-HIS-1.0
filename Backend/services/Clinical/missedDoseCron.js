// services/Clinical/missedDoseCron.js
// ════════════════════════════════════════════════════════════════════
// R7bq-J1 — Daily missed-dose sweeper.
//
// Why: pre-J1, an administrationRecord (AR) slot scheduled for a past
// day that the nurse never marked given/skipped/refused stayed
// "pending" forever. The order-completion check (≥466 of
// doctorOrderRoutes.js) only flips InProgress → Completed when EVERY
// regular AR row is in a terminal state — so one stale "pending" past
// the EOD window stuck the whole order at InProgress, which then
// silently blocked discharge, billing close-out, and the daily
// compliance counts (NABH MOM.4 expects every dose accounted for).
//
// Algorithm (per tick, runs every 15 min):
//   1. Find DoctorOrders where status ∈ {Pending, Acknowledged,
//      Active, InProgress}.
//   2. Walk each order's administrationRecord. For every entry where:
//        - status === "pending"
//        - isStatDose !== true
//        - scheduledDate < midnight-of-today
//      → flip to status "missed" with notes "Auto-marked missed at
//      end-of-day" and append an auditLog row. Emit ClinicalAudit
//      MAR_DOSE_MISSED for each flipped slot.
//   3. Save the order only if anything changed (so we don't churn).
//
// NABH MOM.4 distinction: "skipped" = nurse decided to skip; "missed"
// = system observed nothing happened. They're not the same.
//
// Errors per-order are swallowed so one bad doc doesn't kill the
// sweep. The summary log shows up only when the sweep flipped > 0
// rows so the logs stay quiet during clean periods.
// ════════════════════════════════════════════════════════════════════
const mongoose = require("mongoose");
const { logErr } = require("../../utils/logErr");
const { acquireLock, releaseLock } = require("../../utils/cronScheduler");
// R7hr-12-S2 (D10-04): Replace server-local setHours(0,0,0,0) with the
// canonical IST helper. On a UTC-deployed pod the previous helper made the
// EOD missed-dose sweep fire 5h30m late (UTC 00:00 instead of IST 00:00).
// istStartOfToday() anchors on Asia/Kolkata via Intl.DateTimeFormat +
// explicit +05:30 offset, matching cronScheduler/autoBillingService and the
// other ~12 call sites that already use this helper.
const { istStartOfToday } = require("../../utils/queryGuards");

/** Midnight of today in the hospital timezone (IST). Delegates to the
 * shared queryGuards helper so all crons share one source of truth and
 * stay consistent on UTC-deployed containers. The previous local-time
 * `setHours(0,0,0,0)` pattern is preserved in diagStuckOrders.js /
 * doctorOrderRoutes.js — those producers should be migrated together in
 * a follow-up so the producer/consumer boundary stays aligned. */
function todayMidnight() {
  // R7hr-12-S2 (D10-04): IST-anchored cutoff (was server-local before).
  return istStartOfToday();
}

async function tickOnce() {
  let processed = 0;
  let flipped = 0;
  let ordersTouched = 0;

  try {
    const DoctorOrder = mongoose.model("DoctorOrder");
    let emitClinicalAudit = null;
    try {
      ({ emitClinicalAudit } = require("../Compliance/clinicalAuditService"));
    } catch (_) { /* audit emit non-critical */ }

    const cutoff = todayMidnight();

    // R7bq-K — also sweep Completed orders. Under the new spec, a
    // Medication order flips to Completed after the first dose is given,
    // but the course continues across the AR slots; days that were
    // skipped (nurse forgot, weekend) must still be marked "missed" so
    // the MAR view + audit trail show an accurate per-day record.
    // We exclude Cancelled/Stopped because those are intentional
    // terminations — past-pending slots there should NOT be auto-missed
    // (the order was killed before that day).
    const orders = await DoctorOrder.find({
      status: { $in: ["Pending", "Acknowledged", "Active", "InProgress", "Completed", "OnHold"] },
      "administrationRecord.0": { $exists: true }, // has at least one AR row
    });

    for (const order of orders) {
      processed++;
      try {
        const ar = order.administrationRecord || [];
        let orderChanged = false;

        for (let i = 0; i < ar.length; i++) {
          const row = ar[i];
          if (!row) continue;
          if (row.status !== "pending") continue;
          if (row.isStatDose === true) continue;
          if (!row.scheduledDate) continue;
          const sched = new Date(row.scheduledDate);
          if (!(sched < cutoff)) continue; // future or today — leave alone

          // Flip in-place. Mongoose tracks the subdoc mutation.
          row.status = "missed";
          row.notes = row.notes
            ? `${row.notes} | Auto-marked missed at end-of-day`
            : "Auto-marked missed at end-of-day";

          order.auditLog.push({
            step: `MAR slot auto-missed (${row.scheduledTime} on ${sched.toISOString().slice(0,10)})`,
            doneBy: "SYSTEM",
            doneAt: new Date(),
            notes: "missedDoseCron — scheduled window passed with no nurse entry",
          });
          flipped++;
          orderChanged = true;

          // Emit a ClinicalAudit row per flipped slot for NABH MOM.4
          // traceability. Best-effort, never throws.
          if (emitClinicalAudit) {
            emitClinicalAudit({
              event: "MAR_DOSE_MISSED",
              UHID: order.UHID,
              admissionId: order.admissionId,
              patientId: order.patientId,
              patientName: order.patientName,
              targetType: "DoctorOrder.AR",
              targetId: order._id,
              before: { status: "pending", scheduledTime: row.scheduledTime, scheduledDate: sched },
              after:  { status: "missed", autoMarked: true },
              reason: "End-of-day sweep — no administration recorded",
              actor: { _id: null, fullName: "SYSTEM", role: "System" },
            }).catch(() => { /* silenced inside emitter */ });
          }
        }

        if (orderChanged) {
          ordersTouched++;
          try {
            await order.save();
          } catch (saveErr) {
            // State-machine guard shouldn't trip (we're not changing the
            // order.status here, only subdoc statuses + auditLog). Log if
            // it does so we notice.
            logErr("missedDoseCron", `save order=${order._id}`)(saveErr);
          }
        }
      } catch (e) {
        logErr("missedDoseCron", `tick order=${order?._id}`)(e);
      }
    }
  } catch (e) {
    logErr("missedDoseCron", "tick")(e);
  }

  return { processed, flipped, ordersTouched };
}

/**
 * Arm the 15-minute sweep. Returns a cancel function. Fires once at
 * arm time so a server restart picks up backlog in the current window
 * without waiting 15 minutes.
 */
function arm({ intervalMs = 15 * 60 * 1000 } = {}) {
  const runGuarded = async () => {
    try {
      const acquired = await acquireLock('cron:missed-dose', 10 * 60); // 10-min TTL
      if (!acquired) return; // another replica is running
      try { return await tickOnce(); }
      finally { await releaseLock('cron:missed-dose'); }
    } catch (e) { console.error('[cron:missed-dose] lock error:', e.message); }
  };

  runGuarded()
    .then((r) => {
      if (r && (r.flipped || r.ordersTouched)) {
        console.log(`[cron:missed-dose] first tick processed=${r.processed} ordersTouched=${r.ordersTouched} flipped=${r.flipped}`);
      }
    })
    .catch((e) => console.error("[cron:missed-dose] first tick failed:", e?.message));

  const interval = setInterval(() => {
    runGuarded()
      .then((r) => {
        if (r && (r.flipped || r.ordersTouched)) {
          console.log(`[cron:missed-dose] tick processed=${r.processed} ordersTouched=${r.ordersTouched} flipped=${r.flipped}`);
        }
      })
      .catch((e) => console.error("[cron:missed-dose] tick failed:", e?.message));
  }, intervalMs);

  if (typeof interval.unref === "function") interval.unref();
  console.log("[cron:missed-dose] armed — every 15 min");

  return () => clearInterval(interval);
}

module.exports = { arm, tickOnce, todayMidnight };
