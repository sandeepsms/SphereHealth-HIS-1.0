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

const HOLDER = `${process.pid}@${require("os").hostname()}`;

/**
 * Try-acquire a named distributed lock. Atomic via upsert with $setOnInsert.
 * Returns true if the caller now owns the lock; false if another holder
 * has a live (non-expired) lock for the same name.
 *
 * The Mongo TTL index on expiresAt cleans up dead lock docs automatically
 * within ~60s of expiry — for normal cron runs we just let the doc expire.
 */
async function acquireLock(name, ttlSec) {
  const Lock = getLockModel();
  const now  = new Date();
  const exp  = new Date(now.getTime() + ttlSec * 1000);
  try {
    // Atomic: insert only if doc is missing OR exists but expired. We can't
    // express "expired" as part of an upsert key, so do it in two steps:
    // 1. delete the doc if expiresAt < now (best-effort).
    await Lock.deleteOne({ _id: name, expiresAt: { $lt: now } });
    // 2. insert with $setOnInsert — fails uniquely if another live doc exists.
    await Lock.create({ _id: name, holder: HOLDER, acquiredAt: now, expiresAt: exp });
    return true;
  } catch (e) {
    if (e.code === 11000) return false;  // someone else holds it
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

  const tick = async () => {
    const t0 = Date.now();
    let acquired = false;
    try {
      // 30-minute lock TTL — generous so a slow runner finishes before
      // a replica tries to grab the next-day slot.
      acquired = await acquireLock(`cron:${name}`, 30 * 60);
      if (!acquired) {
        console.log(`[cron:${name}] skip — another instance holds the lock`);
        return;
      }
      const r = await fn();
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[cron:${name}] done in ${dt}s:`, r);
    } catch (e) {
      console.error(`[cron:${name}] error:`, e.stack || e.message);
    } finally {
      if (acquired) await releaseLock(`cron:${name}`);
      // Reschedule for next IST occurrence.
      const at = nextRunAt(hourIST, minuteIST);
      const ms = Math.max(1000, at.getTime() - Date.now());
      timer = setTimeout(tick, ms);
    }
  };

  // First arming: fire at the next IST occurrence.
  const at = nextRunAt(hourIST, minuteIST);
  const ms = Math.max(1000, at.getTime() - Date.now());
  console.log(`[cron:${name}] armed — next IST fire @ ${HOUR_FMT.format(at)} IST (in ${(ms/60000).toFixed(1)} min)`);
  timer = setTimeout(tick, ms);

  return () => { if (timer) clearTimeout(timer); };
}

module.exports = { scheduleDaily, acquireLock, releaseLock };
