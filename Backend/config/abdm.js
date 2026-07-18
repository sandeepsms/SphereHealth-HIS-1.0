// Backend/config/abdm.js
// ════════════════════════════════════════════════════════════════════
// ABDM (Ayushman Bharat Digital Mission) integration — deploy-time config.
//
// The whole ABDM framework is FEATURE-FLAGGED OFF by default. A hospital
// only turns it on once it has ABDM Sandbox/Prod credentials + a registered
// HFR facility + HPR-linked doctors + milestone certification. Until then
// every gateway call is a no-op and the callback routes report "disabled",
// so a stock HIS deployment is completely unaffected.
//
// Enable at process start:
//   ABDM_ENABLED=1 \
//   ABDM_ENV=sandbox \
//   ABDM_CLIENT_ID=... ABDM_CLIENT_SECRET=... \
//   ABDM_HIP_ID=<HFR-id> ABDM_HIP_NAME="BIMS Hospital" \
//   ABDM_CM_ID=sbx \
//   ABDM_CALLBACK_HMAC_SECRET=<shared-secret> \
//   node index.js
//
// Gateway base URLs (well-known ABDM endpoints; overridable via env):
//   sandbox → https://dev.abdm.gov.in
//   prod    → https://live.abdm.gov.in
// ════════════════════════════════════════════════════════════════════
"use strict";

const ENABLED = process.env.ABDM_ENABLED === "1" || String(process.env.ABDM_ENABLED || "").toLowerCase() === "true";
const ENV = String(process.env.ABDM_ENV || "sandbox").trim().toLowerCase() === "prod" ? "prod" : "sandbox";

const DEFAULT_BASE = ENV === "prod" ? "https://live.abdm.gov.in" : "https://dev.abdm.gov.in";

const ABDM = {
  enabled: ENABLED,
  env: ENV,
  // Gateway (M2/M3) base + the session (auth) base. ABDM historically split
  // these; both default off the same host and are individually overridable.
  gatewayBaseUrl: String(process.env.ABDM_GATEWAY_BASE_URL || `${DEFAULT_BASE}/gateway`).replace(/\/$/, ""),
  sessionUrl: String(process.env.ABDM_SESSION_URL || `${DEFAULT_BASE}/gateway/v0.5/sessions`),
  // Client credentials (from the ABDM facility onboarding).
  clientId: process.env.ABDM_CLIENT_ID || "",
  clientSecret: process.env.ABDM_CLIENT_SECRET || "",
  // HIP identity — the hospital as a Health Information Provider.
  hipId: process.env.ABDM_HIP_ID || "",          // HFR facility id
  hipName: process.env.ABDM_HIP_NAME || "",
  cmId: process.env.ABDM_CM_ID || "sbx",         // consent-manager suffix (e.g. "sbx" / "abdm")
  // The public base URL the ABDM gateway will call back on (this hospital's
  // reverse-proxied host). Used only for self-registration/documentation.
  callbackBaseUrl: process.env.ABDM_CALLBACK_BASE_URL || "",
  // Shared secret to authenticate inbound gateway callbacks (HMAC). When
  // empty in sandbox the signature middleware logs + allows; in prod it must
  // be set (the middleware rejects unsigned callbacks when enabled+prod).
  callbackHmacSecret: process.env.ABDM_CALLBACK_HMAC_SECRET || "",
  // Outbound HTTP timeout (ms).
  httpTimeoutMs: Number(process.env.ABDM_HTTP_TIMEOUT_MS) || 15000,
};

/** True only when ABDM is on AND the minimum client identity is configured. */
function isReady() {
  return !!(ABDM.enabled && ABDM.clientId && ABDM.clientSecret && ABDM.hipId);
}

/**
 * Express guard — 503s a route when ABDM is disabled/unconfigured, so the
 * whole surface can be mounted safely and simply reports "not enabled" until
 * the hospital finishes ABDM onboarding.
 */
function requireAbdmEnabled(req, res, next) {
  if (!ABDM.enabled) {
    return res.status(503).json({
      success: false,
      code: "ABDM_DISABLED",
      message: "ABDM integration is not enabled on this deployment. Set ABDM_ENABLED=1 with facility credentials.",
    });
  }
  return next();
}

// A redacted view safe to return from a status endpoint (no secrets).
function publicConfig() {
  return {
    enabled: ABDM.enabled,
    ready: isReady(),
    env: ABDM.env,
    gatewayBaseUrl: ABDM.gatewayBaseUrl,
    hipId: ABDM.hipId,
    hipName: ABDM.hipName,
    cmId: ABDM.cmId,
    callbackBaseUrl: ABDM.callbackBaseUrl,
    clientConfigured: !!(ABDM.clientId && ABDM.clientSecret),
    callbackHmacConfigured: !!ABDM.callbackHmacSecret,
  };
}

module.exports = { ABDM, isReady, requireAbdmEnabled, publicConfig };
