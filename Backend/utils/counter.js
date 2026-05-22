// utils/counter.js — single source of truth for atomic sequence numbers.
//
// Replaces the `countDocuments({regex}) + 1` anti-pattern that races
// under concurrent writes. Every auto-generated ID across the HIS
// should pipe through this.

const Counter = require("../models/CounterModel");

// R7aw-FIX-3/D6-MED-1: IST year extractor for year-rollover detection.
// Anchored on IST so a UTC host near 31-Dec-23:30 doesn't classify a
// trigger fired at 05:00 IST on Jan 1 as last year.
const _IST_TZ = process.env.HOSPITAL_TZ || "Asia/Kolkata";
const _IST_YEAR_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: _IST_TZ, year: "numeric",
});
function _currentIstYear() {
  return Number(_IST_YEAR_FMT.format(new Date()));
}

// One-warn-per-key memo so a cron loop doesn't flood the log.
const _rolloverWarnedKeys = new Set();

/**
 * Atomically bump and return the next sequence value for `key`.
 *
 * @param {string} key   Scope key — e.g. `"opd:2026"`, `"ER:2026"`,
 *                       `"appointment:20260513"`, `"transfer:2026"`,
 *                       `"mlc:RK"`, `"gatepass:20260513"`.
 * @param {number} [seed]  Optional starting value (used the FIRST time
 *                         this key is bumped, e.g. when migrating from
 *                         a legacy serial). Default 0 → first call returns 1.
 * @returns {Promise<number>}
 */
async function nextSequence(key, seed) {
  if (!key) throw new Error("nextSequence: key is required");

  // R7aw-FIX-3/D6-MED-1: year-rollover audit. When the key contains a
  // year segment (e.g. "BILL-2026", "opd:2026", "CN-2026") that doesn't
  // match the current IST calendar year, warn — usually a sign that a
  // caller is using last year's prefix (audit-blocking under IT-Rule-46
  // gap-less series since a new bill bearing year Y-1 lands AFTER the
  // year-end audit closes). One warn per (key, currentYear) pair.
  try {
    const yearMatch = String(key).match(/(?<!\d)(20\d{2})(?!\d)/);
    if (yearMatch) {
      const keyYear = Number(yearMatch[1]);
      const nowYear = _currentIstYear();
      if (Number.isFinite(keyYear) && Number.isFinite(nowYear) && keyYear !== nowYear) {
        const memoKey = `${key}|${nowYear}`;
        if (!_rolloverWarnedKeys.has(memoKey)) {
          _rolloverWarnedKeys.add(memoKey);
          console.warn(
            `[sequenceAudit] year-rollover detected — key="${key}" carries year ${keyYear} but current IST year is ${nowYear}. ` +
            `Sequences crossing a year boundary break IT-Rule-46 gap-less series; verify the caller is using the correct year prefix.`,
          );
        }
      }
    }
  } catch (_) { /* year audit is best-effort */ }

  // R7ag: when a seed is supplied, do a two-step upsert. Mongo rejects
  // a single op that both $setOnInsert and $inc the same field path
  // ("Updating the path 'seq' would create a conflict at 'seq'"). So we
  // (1) ensure the doc exists with seq = seed via $setOnInsert (this is
  // a no-op if the doc already exists), then (2) atomically $inc and
  // return. The two-step has a tiny race window only on the FIRST seed
  // attempt — concurrent first-callers all succeed because
  // $setOnInsert is idempotent and the subsequent $inc serialises.
  if (seed != null) {
    await Counter.updateOne(
      { _id: key },
      { $setOnInsert: { seq: seed } },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return doc.seq;
}

/**
 * Convenience formatter: produces `PREFIX-PAD(N)`.
 * @example formatId("OPD-2026", await nextSequence("opd:2026"), 6) → "OPD-2026-000123"
 */
function formatId(prefix, seq, pad = 4) {
  return `${prefix}-${String(seq).padStart(pad, "0")}`;
}

module.exports = { nextSequence, formatId };
