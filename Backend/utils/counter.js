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
  const update = { $inc: { seq: 1 } };
  if (seed != null) update.$setOnInsert = { seq: seed };
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    update,
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
