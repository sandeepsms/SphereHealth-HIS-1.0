// utils/cronScheduler.js — R7ap-F21/D10-01/D10-02
//
// IST-aware day-boundary scheduler + Mongo distributed lock so multi-
// instance deploys don't run the daily accrual twice. Pre-R7ap the
// `setInterval(every 6h)` from boot cadence drifted between IST midnights
// after restarts, and any second replica would fire the same job in
// parallel without coordination (read-then-write race on BillingTrigger).
//
// Two public functions:
//
//   scheduleDaily(name, hourIST, minuteIST, fn) — runs `fn()` once per
//     IST calendar day at the chosen IST time, with a Mongo lock so only
//     ONE replica's tick actually invokes fn. Uses setTimeout for the
//     next-fire delay so the cadence stays anchored to IST regardless of
//     server TZ.
//
//   acquireLock(name, ttlSec) → bool — try-acquire a named distributed
//     lock backed by a Mongo doc with TTL. Used by scheduleDaily but
//     exported for ad-hoc one-shot jobs (boot-catchup, manual triggers).
//
// The lock collection (`cron_locks`) is created lazily on first call.

const mongoose = require("mongoose");

const TZ = process.env.HOSPITAL_TZ || "Asia/Kolkata";

// ─── Lock model ─────────────────────────────────────────────────────
const CronLockSchema = new mongoose.Schema(
  {
    _id:        { type: String, required: true },   // lock name
    holder:     { type: String, required: true },   // process identifier
    acquiredAt: { type: Date,   required: true, default: Date.now },
    expiresAt:  { type: Date,   required: true, index: { expireAfterSeconds: 0 } }, // TTL
  },
  { _id: false, versionKey: false },
);

let CronLockModel;
function getLockModel() {
  if (CronLockModel) return CronLockModel;
  CronLockModel = mongoose.models.CronLock || mongoose.model("CronLock", CronLockSchema, "cron_locks");
  return CronLockModel;
}

// R7ar-P1-19/D10-aq-07: append a per-process UUID so two K8s pods with
// identical hostname+PID (StatefulSet + container PID 1) don't claim
// each other's locks.
const _holderUuid = require("crypto").randomUUID();
const HOLDER = `${process.pid}@${require("os").hostname()}/${_holderUuid}`;

/**
 * Try-acquire a named distributed lock. **Single-roundtrip atomic** via
 * findOneAndUpdate(upsert) — replaces the prior R7ap two-step
 * deleteOne+create, which had a race window where a peer could insert
 * its lock between our delete and create and we'd both think we won.
 *
 * Semantics:
 *   - doc missing                 → upsert inserts our lock → win
 *   - doc exists & expiresAt < now → filter matches, $set rotates holder → win
 *   - doc exists & expiresAt ≥ now → filter misses; upsert tries to insert
 *                                     same _id → DuplicateKey (11000) → lose
 *
 * The Mongo TTL index on expiresAt cleans up dead lock docs automatically
 * within ~60s of expiry — but the `expiresAt < now` predicate above means
 * we don't have to wait for the TTL reaper to rotate.
 */
async function acquireLock(name, ttlSec) {
  const Lock = getLockModel();
  const now  = new Date();
  const exp  = new Date(now.getTime() + ttlSec * 1000);
  try {
    await Lock.findOneAndUpdate(
      { _id: name, expiresAt: { $lt: now } },
      { $set: { holder: HOLDER, acquiredAt: now, expiresAt: exp } },
      { upsert: true, setDefaultsOnInsert: true, new: true },
    );
    return true;
  } catch (e) {
    if (e.code === 11000) return false;  // live holder exists — lose race
    throw e;
  }
}

/** Release the lock if we own it (best-effort — never throws). */
async function releaseLock(name) {
  try {
    await getLockModel().deleteOne({ _id: name, holder: HOLDER });
  } catch (_) { /* swallow */ }
}

// ─── IST day-key helpers ─────────────────────────────────────────────
const DAY_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
});
const HOUR_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
});

function nextRunAt(hourIST, minuteIST) {
  // Compute the next UTC instant at which IST = HH:MM today or tomorrow.
  const now = new Date();
  // Build today's IST date-key, parse it with explicit +05:30 offset, then
  // adjust hour/minute. Works regardless of host TZ because we anchor on
  // the IST calendar.
  const istKey = DAY_KEY_FMT.format(now);                    // "2026-05-20"
  const todayIST = new Date(`${istKey}T${String(hourIST).padStart(2,"0")}:${String(minuteIST).padStart(2,"0")}:00+05:30`);
  if (todayIST > now) return todayIST;
  // Already past today's slot — schedule for tomorrow.
  return new Date(todayIST.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Schedule a daily IST cron. The function fires once per IST calendar
 * day at the chosen HH:MM IST, behind a 30-minute distributed lock so
 * only one replica per cluster actually invokes it. fn() returns are
 * logged; errors don't kill the scheduler.
 *
 * Returns a cancel() function to clear the timer (useful on shutdown).
 */
function scheduleDaily(name, hourIST, minuteIST, fn) {
  let timer = null;
  // R7at-FIX-6/D10-MED-4: `cancelled` flag captured in closure. On SIGTERM
  // the returned cancel() sets `cancelled=true` AND clears the pending
  // `timer`. But if a tick is mid-execution when shutdown fires, the
  // `finally` block was previously re-arming a NEW setTimeout that the
  // cancel() closure no longer had a reference to — that timer survived
  // shutdown intent and could fire against a half-dead Mongo connection.
  // Now we check the flag before re-arming.
  let cancelled = false;

  const tick = async () => {
    if (cancelled) return;                             // R7at-FIX-6
    const start = Date.now();
    const t0 = start;
    let acquired = false;
    // B4-T06: track outcome ('ok' | 'skip' | 'fail') + result/err so the
    // post-tick heartbeat emit + cron-failure recorder both have access
    // without re-throwing or losing state across the try/catch boundary.
    let outcome = "ok";
    let result  = null;
    let tickErr = null;
    try {
      // 30-minute lock TTL — generous so a slow runner finishes before
      // a replica tries to grab the next-day slot.
      acquired = await acquireLock(`cron:${name}`, 30 * 60);
      if (!acquired) {
        console.log(`[cron:${name}] skip — another instance holds the lock`);
        outcome = "skip";
        result  = { skipped: "lock-held-elsewhere" };
        return;
      }
      const r = await fn();
      result = r;
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[cron:${name}] done in ${dt}s:`, r);
    } catch (e) {
      outcome = "fail";
      tickErr = e;
      console.error(`[cron:${name}] error:`, e.stack || e.message);
    } finally {
      if (acquired) await releaseLock(`cron:${name}`);
      // B4-T06: emit a CRON_RECONCILED heartbeat for every tick (success,
      // skip, fail) so systemHealthController can show lastRunAt. We use
      // the BillingAudit model's `emit` helper (exported as both `emit`
      // and `emitBillingAudit` — see models/Billing/BillingAudit.js).
      // Best-effort: never throw out of the scheduler.
      try {
        const emitter = require("../models/Billing/BillingAudit");
        const _emit = emitter.emitBillingAudit || emitter.emit;
        if (typeof _emit === "function") {
          await _emit({
            event: "CRON_RECONCILED",
            actorName: `System (cron:${name})`,
            reason:
              outcome === "ok"     ? `Cron tick ok (${name})`
              : outcome === "skip" ? `Cron tick skipped (${name}): ${result?.skipped || "unknown"}`
              :                      `Cron tick failed (${name}): ${tickErr?.message || "unknown"}`,
            after: {
              kind:
                outcome === "ok"   ? "CRON_HEARTBEAT"
                : outcome === "skip" ? "CRON_SKIPPED"
                :                      "CRON_FAILED",
              name,
              outcome,
              durationMs:    Date.now() - start,
              skippedReason: result?.skipped,
              resultKeys:    Object.keys(result || {}),
              errorMessage:  tickErr ? (tickErr.message || String(tickErr)) : undefined,
            },
          });
        }
      } catch (auditErr) {
        console.warn(`[cron:${name}] heartbeat emit failed (non-fatal):`, auditErr.message);
      }
      // B4-T06: also record the failure into the CronFailure retry queue
      // (B4-T05 helper) so the sweeper can replay this tick on its
      // backoff ladder. Best-effort: never throw out of the scheduler.
      if (tickErr) {
        try {
          const { recordCronFailure } = require("./cronRetry");
          await recordCronFailure(name, tickErr);
        } catch (retryErr) {
          console.warn(`[cron:${name}] recordCronFailure failed (non-fatal):`, retryErr.message);
        }
      }
      // R7at-FIX-6: don't re-arm if shutdown has been signalled.
      if (!cancelled) {
        const at = nextRunAt(hourIST, minuteIST);
        const ms = Math.max(1000, at.getTime() - Date.now());
        timer = setTimeout(tick, ms);
      }
    }
  };

  // First arming: fire at the next IST occurrence.
  const at = nextRunAt(hourIST, minuteIST);
  const ms = Math.max(1000, at.getTime() - Date.now());
  console.log(`[cron:${name}] armed — next IST fire @ ${HOUR_FMT.format(at)} IST (in ${(ms/60000).toFixed(1)} min)`);
  timer = setTimeout(tick, ms);

  return () => {
    cancelled = true;                                  // R7at-FIX-6
    if (timer) clearTimeout(timer);
  };
}

module.exports = { scheduleDaily, acquireLock, releaseLock };
