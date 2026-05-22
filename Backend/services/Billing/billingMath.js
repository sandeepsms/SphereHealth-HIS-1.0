/**
 * services/Billing/billingMath.js
 * ────────────────────────────────────────────────────────────────────
 * R7bf-H / A6-CRIT-8 — Largest-remainder distribution for bill-level
 * totals split across categories.
 *
 * PROBLEM
 *   When you split a bill's `totalDiscount` (or `totalGst`) across N
 *   category buckets by gross share, doing `Math.round(totalDiscount *
 *   share / totalGross * 100) / 100` per category sums to ≠ totalDiscount
 *   for any totalDiscount that doesn't divide cleanly. Off by ₹0.01–0.50
 *   per bill — invisible per row but a real GL imbalance at month-end.
 *
 * FIX
 *   "Largest-remainder method" (a.k.a. Hamilton method) — used by
 *   parliamentary apportionment for exactly this kind of integer split:
 *     1. Compute raw share per bucket = total * (bucketWeight / sumWeights)
 *     2. Floor each raw share to the rounding step (here: paise / 0.01)
 *     3. Distribute the remainder (total - sum-of-floors) to buckets with
 *        the largest fractional residual, in order, one paisa at a time
 *   Sum of distributed shares === total, exactly. No drift.
 *
 * USAGE
 *   const { distributeByShare } = require("./billingMath");
 *   const rows = distributeByShare([
 *     { key: "Pharmacy",     weight: 3000 },
 *     { key: "Consultation", weight: 1000 },
 *     { key: "Bed",          weight: 4000 },
 *   ], 100, { step: 0.01 });
 *   // rows[i].amount sums to 100.00 exactly even though raw shares are
 *   // 37.50/12.50/50.00 (here clean) or 33.33/16.66/50.00 (here drifting).
 *
 * Tie-break: when two buckets have the same fractional residual, the one
 * appearing earlier in the input array wins the extra paisa — deterministic
 * for unit tests and reproducible per-bill audits.
 */

"use strict";

/**
 * Distribute `total` across the buckets in `items` proportionally to each
 * bucket's `weight`. Returns a new array of `{ key, weight, amount }` rows
 * such that `sum(rows[i].amount) === total` (to within step rounding).
 *
 * @param {Array<{key: string, weight: number}>} items
 * @param {number} total — the value to be split (rupees / GST / etc.)
 * @param {Object} [opts]
 * @param {number} [opts.step=0.01] — rounding step (paise default)
 * @returns {Array<{key: string, weight: number, amount: number}>}
 */
function distributeByShare(items, total, opts = {}) {
  const step = Number(opts.step) || 0.01;
  if (!Array.isArray(items) || items.length === 0) return [];
  const t = Number(total) || 0;
  if (t === 0) {
    return items.map((it) => ({ key: it.key, weight: Number(it.weight) || 0, amount: 0 }));
  }
  const totalWeight = items.reduce((s, it) => s + (Number(it.weight) || 0), 0);
  if (totalWeight <= 0) {
    // No weights → distribute the total evenly across buckets (still no drift).
    const each = floorStep(t / items.length, step);
    let remainder = +(t - each * items.length).toFixed(8);
    return items.map((it, i) => {
      const bonus = remainder > 0 ? step : 0;
      if (bonus) remainder = +(remainder - step).toFixed(8);
      return { key: it.key, weight: 0, amount: +(each + bonus).toFixed(_decimals(step)) };
    });
  }
  // Step 1: raw share + floored share + residual.
  const rows = items.map((it) => {
    const w = Number(it.weight) || 0;
    const raw = t * (w / totalWeight);
    const floored = floorStep(raw, step);
    return {
      key: it.key,
      weight: w,
      raw,
      amount: floored,
      residual: +(raw - floored).toFixed(8),
    };
  });
  // Step 2: distribute the remainder one step at a time to the largest
  // residuals. We compute the integer "paise gap" rather than looping the
  // step value to avoid float drift on totals like 33.333333…
  const sumFloored = rows.reduce((s, r) => s + r.amount, 0);
  let gap = Math.round((t - sumFloored) / step);
  if (gap <= 0) {
    return rows.map(({ residual: _r, raw: _raw, ...rest }) => ({
      ...rest,
      amount: +rest.amount.toFixed(_decimals(step)),
    }));
  }
  // Stable sort: largest residual first, original index as tiebreaker.
  const order = rows
    .map((r, i) => ({ idx: i, residual: r.residual }))
    .sort((a, b) => (b.residual - a.residual) || (a.idx - b.idx));
  for (let k = 0; k < gap && k < order.length; k++) {
    rows[order[k].idx].amount = +(rows[order[k].idx].amount + step).toFixed(_decimals(step));
  }
  // If gap > order.length (very large total, tiny step), keep cycling.
  // Realistically impossible for hospital bills but defensive.
  let remaining = gap - order.length;
  let cursor = 0;
  while (remaining > 0) {
    rows[order[cursor % order.length].idx].amount =
      +(rows[order[cursor % order.length].idx].amount + step).toFixed(_decimals(step));
    remaining -= 1;
    cursor += 1;
  }
  return rows.map(({ residual: _r, raw: _raw, ...rest }) => rest);
}

/**
 * Convenience wrapper: given an array of category gross figures, return a
 * map { category → discountShare } that sums to `totalDiscount`. Useful for
 * the revenue-breakdown byCategory shape.
 */
function distributeDiscount(byCategoryGross, totalDiscount, opts = {}) {
  const items = Object.entries(byCategoryGross).map(([key, weight]) => ({ key, weight }));
  const rows = distributeByShare(items, totalDiscount, opts);
  const out = {};
  for (const r of rows) out[r.key] = r.amount;
  return out;
}

/** Same shape for GST distribution. */
function distributeGst(byCategoryGross, totalGst, opts = {}) {
  return distributeDiscount(byCategoryGross, totalGst, opts);
}

/** Floor `v` to the nearest multiple of `step` (towards −∞ for negatives). */
function floorStep(v, step) {
  if (!step || step <= 0) return v;
  const scale = 1 / step;
  return Math.floor(v * scale) / scale;
}

/** Decimal places implied by a step (0.01 → 2). */
function _decimals(step) {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

module.exports = {
  distributeByShare,
  distributeDiscount,
  distributeGst,
};
