/**
 * services/Abdm/abdmGateway.js — ABDM gateway HTTP client
 *
 * Handles the outbound half of the async ABDM protocol: a cached session
 * (bearer) token, a signed-request helper that stamps the REQUEST-ID /
 * TIMESTAMP / X-CM-ID / X-HIP-ID headers the gateway expects, and typed
 * `on-*` responders (the HIP replies to a gateway callback by POSTing to the
 * matching /on-* endpoint) plus the health-information data push.
 *
 * Fully disabled-safe: when ABDM is off, every call throws ABDM_DISABLED
 * synchronously so callers (callback handlers) simply skip the outbound leg
 * and still return a clean local ACK. Uses Node's global fetch (Node ≥18).
 */
"use strict";

const crypto = require("crypto");
const { ABDM, isReady } = require("../../config/abdm");

let _session = { token: "", expiresAt: 0 };

function _assertEnabled() {
  if (!ABDM.enabled) {
    const e = new Error("ABDM integration is disabled (ABDM_ENABLED not set).");
    e.code = "ABDM_DISABLED"; e.status = 503; throw e;
  }
}

async function _journal(fields) {
  try {
    const AbdmTransaction = require("../../models/Abdm/AbdmTransactionModel");
    await AbdmTransaction.create(fields);
  } catch (_) { /* journalling is best-effort */ }
}

function _uuid() { return crypto.randomUUID(); }
function _nowIso() { return new Date().toISOString(); }

// ── session token (cached) ─────────────────────────────────────────
async function getSessionToken({ force = false } = {}) {
  _assertEnabled();
  if (!isReady()) {
    const e = new Error("ABDM client credentials not configured (clientId/secret/hipId).");
    e.code = "ABDM_NOT_CONFIGURED"; e.status = 503; throw e;
  }
  const now = Date.now();
  if (!force && _session.token && _session.expiresAt > now + 30_000) return _session.token;

  const res = await _fetch(ABDM.sessionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: ABDM.clientId, clientSecret: ABDM.clientSecret }),
  });
  const body = await _safeJson(res);
  if (!res.ok || !body?.accessToken) {
    await _journal({ kind: "SESSION", direction: "OUTBOUND", status: "ERROR", endpoint: ABDM.sessionUrl, httpStatus: res.status, error: JSON.stringify(body).slice(0, 500) });
    const e = new Error(`ABDM session failed (HTTP ${res.status})`); e.code = "ABDM_SESSION_FAILED"; e.status = 502; throw e;
  }
  _session = { token: body.accessToken, expiresAt: now + (Number(body.expiresIn) || 1200) * 1000 };
  await _journal({ kind: "SESSION", direction: "OUTBOUND", status: "PROCESSED", endpoint: ABDM.sessionUrl, httpStatus: res.status });
  return _session.token;
}

// ── signed gateway POST (relative to gatewayBaseUrl) ───────────────
async function gwPost(path, payload, { kind = "OTHER", extraHeaders = {} } = {}) {
  _assertEnabled();
  const token = await getSessionToken();
  const url = `${ABDM.gatewayBaseUrl}${path}`;
  const requestId = payload?.requestId || _uuid();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "REQUEST-ID": requestId,
    TIMESTAMP: _nowIso(),
    "X-CM-ID": ABDM.cmId,
    "X-HIP-ID": ABDM.hipId,
    ...extraHeaders,
  };
  const res = await _fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  const body = await _safeJson(res);
  await _journal({
    kind, direction: "OUTBOUND", status: res.ok ? "PROCESSED" : "ERROR",
    requestId, endpoint: path, httpStatus: res.status,
    requestPayload: payload, responsePayload: body, error: res.ok ? "" : `HTTP ${res.status}`,
  });
  return { ok: res.ok, status: res.status, body };
}

// ── typed on-* responders (HIP → gateway async replies) ────────────
const onDiscover        = (p) => gwPost("/v0.5/care-contexts/on-discover", p, { kind: "DISCOVER" });
const onLinkInit        = (p) => gwPost("/v0.5/links/link/on-init", p, { kind: "LINK_INIT" });
const onLinkConfirm     = (p) => gwPost("/v0.5/links/link/on-confirm", p, { kind: "LINK_CONFIRM" });
const onConsentNotify   = (p) => gwPost("/v0.5/consents/hip/on-notify", p, { kind: "CONSENT_NOTIFY" });
const onHiRequest       = (p) => gwPost("/v0.5/health-information/hip/on-request", p, { kind: "HI_REQUEST" });
const hiNotify          = (p) => gwPost("/v0.5/health-information/notify", p, { kind: "HI_TRANSFER" });

// R9-FIX(R9-078/R9-086): SSRF guard for the HIU-supplied absolute dataPushUrl.
// The URL comes straight off the ABDM callback body and is fetched — without
// validation an attacker (esp. combined with the R9-085 unauth callback) could
// point it at an internal service or the cloud metadata endpoint. Require https
// (http only in sandbox), block loopback/private/link-local hosts, and honour
// an optional strict host allowlist.
function _assertSafePushUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); }
  catch { const e = new Error("dataPushUrl is not a valid absolute URL"); e.status = 400; throw e; }
  const allowHttp = ABDM.env !== "prod";
  if (!(u.protocol === "https:" || (allowHttp && u.protocol === "http:"))) {
    const e = new Error(`dataPushUrl scheme '${u.protocol}' not allowed`); e.status = 400; throw e;
  }
  const host = u.hostname.toLowerCase();
  const allow = String(process.env.ABDM_HIU_PUSH_HOST_ALLOWLIST || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.includes(host)) {
    const e = new Error(`dataPushUrl host '${host}' not in ABDM_HIU_PUSH_HOST_ALLOWLIST`); e.status = 400; throw e;
  }
  const blocked =
    host === "localhost" || host === "0.0.0.0" || host === "::1" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host) ||
    /^::ffff:127\./.test(host) || /^fe80:/i.test(host) || /^fc00:/i.test(host) || /^fd[0-9a-f]{2}:/i.test(host);
  if (blocked) {
    const e = new Error(`dataPushUrl host '${host}' is a private/loopback address (SSRF blocked)`); e.status = 400; throw e;
  }
}

// ── health-information data push (to the HIU's absolute dataPushUrl) ─
async function hiDataPush(dataPushUrl, payload) {
  _assertEnabled();
  _assertSafePushUrl(dataPushUrl);
  const res = await _fetch(dataPushUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await _safeJson(res).catch(() => null);
  await _journal({
    kind: "HI_TRANSFER", direction: "OUTBOUND", status: res.ok ? "PROCESSED" : "ERROR",
    endpoint: dataPushUrl, httpStatus: res.status, transactionId: payload?.transactionId || "",
    error: res.ok ? "" : `HTTP ${res.status}`,
  });
  return { ok: res.ok, status: res.status, body };
}

// ── fetch helpers (timeout + safe json) ────────────────────────────
async function _fetch(url, opts) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ABDM.httpTimeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}
async function _safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

module.exports = {
  getSessionToken,
  gwPost,
  onDiscover,
  onLinkInit,
  onLinkConfirm,
  onConsentNotify,
  onHiRequest,
  hiNotify,
  hiDataPush,
  _resetSessionForTest: () => { _session = { token: "", expiresAt: 0 }; },
};
