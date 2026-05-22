/**
 * Frontend/src/utils/money.js — R7ap-F16/D4-01/D9-07
 *
 * Single source of truth for every money-shaped value crossing the wire
 * into the React tree. Pre-R7ap each page (AccountsConsole / ReceptionBilling
 * / PatientLookupPage / IPDBillingLedger / ReceptionDashboard) implemented
 * its own variant of "unwrap Decimal128, fall back to 0, format with INR".
 * Result: 38 of 42 fmtINR call sites in AccountsConsole.jsx received raw
 * Decimal128 objects and rendered "₹NaN". Other pages used `Number()` which
 * coerced Decimal128 objects to NaN silently.
 *
 * Export contract:
 *   toMoney(v) → JS Number (handles Decimal128 / {$numberDecimal} / Number / String / null)
 *   eff(bill)  → { gross, paid, due, advance } with R7am items-fallback for stale parents
 *   fmtINR0(n) → "₹1,234"      (rounded, used in KPI tiles)
 *   fmtINR2(n) → "₹1,234.50"   (used in ledger rows, audit lines)
 */

/**
 * Unwrap any money-shaped wire value into a JS Number.
 *
 * Handles:
 *   - mongoose Decimal128 objects ({$numberDecimal:"123.45"})
 *   - native Decimal128 instances with .toString()
 *   - plain numbers (1234)
 *   - strings ("1234.50")
 *   - null / undefined → 0 (safe default for reduces)
 *
 * The `Number(undefined)` and `Number({$numberDecimal:"x"})` paths both
 * produce NaN — handle them explicitly so reduces don't poison totals.
 */
export function toMoney(v) {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  // Wire shape from mongoose toJSON when transform skipped:
  //   { "$numberDecimal": "123.45" }
  if (typeof v === "object") {
    if (v.$numberDecimal != null) {
      const n = Number(v.$numberDecimal);
      return Number.isFinite(n) ? n : 0;
    }
    if (typeof v.toString === "function") {
      const n = Number(v.toString());
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

/**
 * Effective bill totals — same formula every page should use to derive
 * { gross, paid, due, advance } from a bill document.
 *
 * Falls back to summing `billItems[].netAmount` when the parent
 * `netAmount` / `patientPayableAmount` is stale-zero (R7aa root cause).
 * The IPD live ledger also depends on this — without the fallback, old
 * bills (where pre-save `recalcTotals` never fired) showed ₹0 totals.
 */
export function eff(b) {
  if (!b) return { gross: 0, paid: 0, due: 0, advance: 0 };
  const itemsNet = (b.billItems || []).reduce((s, it) => s + toMoney(it.netAmount), 0);
  const refNet   = Math.max(toMoney(b.patientPayableAmount), toMoney(b.netAmount), itemsNet);
  const payments = b.payments || [];
  // Positive payments only — refunds (negative rows) are tracked separately.
  const paidPos  = payments.reduce((s, p) => {
    const v = toMoney(p.amount);
    return s + (v > 0 ? v : 0);
  }, 0);
  const stored   = toMoney(b.balanceAmount);
  const due      = stored > 0 ? stored : Math.max(0, refNet - paidPos);
  return {
    gross:   refNet,
    paid:    Math.max(0, refNet - due),
    due,
    advance: toMoney(b.advancePaid),
  };
}

/** ₹1,234 (rounded — KPI tiles, headlines) */
export function fmtINR0(n) {
  return `₹${toMoney(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** ₹1,234.50 (ledger rows, audit lines, GST splits) */
export function fmtINR2(n) {
  return `₹${toMoney(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Number-only formatter (no ₹ prefix) — useful in CSV exports. */
export function fmtNum2(n) {
  return toMoney(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Default export for convenience.
export default { toMoney, eff, fmtINR0, fmtINR2, fmtNum2 };
