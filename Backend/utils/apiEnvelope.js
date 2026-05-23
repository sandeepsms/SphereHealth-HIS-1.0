/**
 * Backend/utils/apiEnvelope.js
 * ────────────────────────────────────────────────────────────────────
 * R7bh-F8 — canonical API envelope helper for HIS controllers.
 *
 * Single-shape contract every controller in scope SHOULD honour:
 *
 *   SUCCESS  →  { success: true,  data, meta? }
 *   ERROR    →  { success: false, message, code? }   (no stack, no `error`,
 *                                                     no `msg`, no `errors`)
 *
 * Status-code conventions (see R7bg AUDIT API CRIT-10):
 *   • 200  — read/update success.
 *   • 201  — create success (POST).
 *   • 204  — delete success (no body) — but most clients want a tiny
 *            confirmation body, so `sendOk(res, {deleted:true}, undefined, 200)`
 *            is also acceptable.
 *   • 400  — validation / bad request (`code:"VALIDATION"` recommended).
 *   • 401  — auth required.
 *   • 403  — RBAC denied.
 *   • 404  — entity not found (`code:"NOT_FOUND"`).
 *   • 409  — illegal transition / duplicate / conflict
 *            (`code:"ILLEGAL_TRANSITION"` for R7bf-I TPA approve/settle).
 *   • 500  — internal server error (do NOT leak `error.stack`).
 *
 * NEVER leak `error.stack`, `error.errors`, or process paths in any
 * response — even on development. PHI / customer-data routes are
 * production-mirrored and a stack trace can fingerprint server topology.
 *
 * The audit (R7bg-3-CRIT-12) found 6 distinct success shapes and 3
 * distinct error shapes across in-scope controllers. This helper
 * collapses every callsite to one ok/err pair.
 */

"use strict";

function ok(data, meta) {
  const out = { success: true, data };
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    out.meta = meta;
  }
  return out;
}

function err(message, code, statusCode) {
  return {
    success: false,
    message: String(message || "Internal Server Error"),
    code: code || null,
    ...(typeof statusCode === "number" ? { statusCode } : {}),
  };
}

/**
 * sendOk(res, data, meta?, status?)
 *   res.status(status).json({success:true, data, meta?})
 */
function sendOk(res, data, meta, status) {
  const s = typeof status === "number" ? status : 200;
  return res.status(s).json(ok(data, meta));
}

/**
 * sendErr(res, errOrMessage, code?, status?)
 *   Never exposes stack. Accepts:
 *     • Error instance — uses e.message
 *     • string         — uses as-is
 *   `code` precedence: explicit arg > e.code > null.
 *   `status` precedence: explicit arg > e.status > 500.
 */
function sendErr(res, e, code, status) {
  const isErr = e && typeof e === "object" && "message" in e;
  const msg   = typeof e === "string" ? e : (isErr ? e.message : "Internal Server Error");
  const sc    = typeof status === "number"
    ? status
    : (isErr && typeof e.status === "number" ? e.status : 500);
  const cd    = code || (isErr && e.code ? e.code : null);
  return res.status(sc).json({
    success: false,
    message: String(msg || "Internal Server Error"),
    code: cd || null,
  });
}

module.exports = { ok, err, sendOk, sendErr };
