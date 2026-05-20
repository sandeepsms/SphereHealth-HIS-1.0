// utils/counter.js — single source of truth for atomic sequence numbers.
//
// Replaces the `countDocuments({regex}) + 1` anti-pattern that races
// under concurrent writes. Every auto-generated ID across the HIS
// should pipe through this.

const Counter = require("../models/CounterModel");

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
