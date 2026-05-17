/**
 * utils/logErr.js
 *
 * Curryable error-logging helper for promise chains. Closes audit
 * D-01 — the codebase had 35+ `.catch(() => {})` silent swallows
 * across billing / clinical paths, so when a charge failed to fire
 * or a note failed to save there was no breadcrumb for the on-call
 * engineer.
 *
 * Usage:
 *   const { logErr } = require("../../utils/logErr");
 *
 *   // Fire-and-forget — log on failure, never throw:
 *   autoBilling.onInvestigationOrdered(order)
 *     .catch(logErr("autoBilling", "onInvestigationOrdered"));
 *
 *   // Same with extra context:
 *   bill.save().catch(logErr("billing", `save bill ${bill._id}`));
 *
 * Each log line carries the module name and an action string so a
 * grep over container logs finds the offending site quickly. The
 * helper never re-throws (matches the silent-catch semantics it
 * replaces — failure is informational, not blocking).
 */
function logErr(module, action) {
  return function onError(err) {
    const msg = err && (err.message || String(err));
    console.error(`[${module}] ${action}: ${msg}`);
  };
}

module.exports = { logErr };
