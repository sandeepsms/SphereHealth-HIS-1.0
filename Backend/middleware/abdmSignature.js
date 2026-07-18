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

  // R9-FIX(R9-085): fail CLOSED whenever ABDM is enabled but the callback HMAC
  // secret is unset — regardless of env. The old sandbox bypass (env !== "prod"
  // → next()) meant that the moment ABDM was switched on for the NHA sandbox /
  // M1–M4 certification without ABDM_CALLBACK_HMAC_SECRET, an anonymous internet
  // caller could forge a GRANTED consent artefact and have the HIS encrypt a
  // patient's full FHIR chart to the attacker's key + URL. Enabled-without-secret
  // is a misconfiguration, not a "sandbox convenience" — 503 until it is set.
  if (!ABDM.callbackHmacSecret) {
    return res.status(503).json({ error: { code: "ABDM_HMAC_NOT_CONFIGURED", message: "ABDM_CALLBACK_HMAC_SECRET is required to accept signed callbacks (set it before enabling ABDM)." } });
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
