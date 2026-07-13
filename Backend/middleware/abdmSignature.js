/**
 * middleware/abdmSignature.js — authenticate inbound ABDM gateway callbacks
 *
 * The ABDM gateway calls the HIP's registered callback URLs directly (not via
 * our JWT). We authenticate those requests with a shared-secret HMAC over the
 * raw request body:
 *   X-HMAC = base64( HMAC-SHA256(rawBody, ABDM_CALLBACK_HMAC_SECRET) )
 *
 * Policy:
 *   • secret configured  → verify; reject (401) on mismatch/missing.
 *   • no secret + sandbox → allow (log a warning; convenient for onboarding).
 *   • no secret + prod    → reject (503) — refuse to accept unauthenticated
 *                           callbacks in production.
 *
 * NOTE: the exact gateway signature scheme is ABDM-version specific (some
 * milestones use a JWKS-signed detached JWS instead of a body HMAC). Swap the
 * `_verify` body for the certified scheme before go-live; the raw body is
 * captured in index.js's express.json verify hook (req.rawBody).
 */
"use strict";

const crypto = require("crypto");
const { ABDM } = require("../config/abdm");

function _timingSafeEq(a, b) {
  const ba = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function abdmSignature(req, res, next) {
  // The router is only mounted when ABDM is enabled, but double-guard here.
  if (!ABDM.enabled) {
    return res.status(503).json({ error: { code: "ABDM_DISABLED", message: "ABDM integration disabled" } });
  }

  if (!ABDM.callbackHmacSecret) {
    if (ABDM.env === "prod") {
      return res.status(503).json({ error: { code: "ABDM_HMAC_NOT_CONFIGURED", message: "Callback HMAC secret required in production" } });
    }
    console.warn("[abdmSignature] no ABDM_CALLBACK_HMAC_SECRET set — allowing callback (sandbox only).");
    return next();
  }

  const provided = req.get("X-HMAC") || req.get("x-hmac") || "";
  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), "utf8");
  const expected = crypto.createHmac("sha256", ABDM.callbackHmacSecret).update(raw).digest("base64");
  if (!provided || !_timingSafeEq(provided, expected)) {
    return res.status(401).json({ error: { code: "ABDM_BAD_SIGNATURE", message: "Callback signature verification failed" } });
  }
  return next();
}

// Helper the framework/tests use to sign an outbound test callback.
abdmSignature.sign = function (rawBodyBuffer) {
  if (!ABDM.callbackHmacSecret) return "";
  return crypto.createHmac("sha256", ABDM.callbackHmacSecret).update(rawBodyBuffer).digest("base64");
};

module.exports = abdmSignature;
