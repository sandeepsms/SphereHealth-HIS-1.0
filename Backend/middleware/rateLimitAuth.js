// middleware/rateLimitAuth.js
// ════════════════════════════════════════════════════════════════════
// R7bz — IP-based rate limit for auth + client-error reporting.
//
// Complements (does NOT replace) the per-user lockout in authRoutes.js
// which trips on 5 failed attempts → 30-min lock. This middleware exists
// to defend the auth endpoint from username-rotation brute-force where a
// botnet hits 1000 usernames once each, sidestepping the per-user
// lockout. It also throttles the public /api/client-errors reporter so
// a misbehaving / hostile frontend can't flood the error sink.
//
// Notes:
//   • Uses express-rate-limit v8 (already in package.json).
//   • Both limiters key on req.ip. Express 5 + `app.set('trust proxy', 1)`
//     in Backend/index.js makes req.ip the real client IP behind one
//     reverse proxy hop. If that line is removed, req.ip becomes the
//     proxy's IP and every request shares one bucket — DO NOT remove.
//   • standardHeaders:true emits the IETF draft `RateLimit-*` headers
//     so clients can self-throttle; legacyHeaders:false suppresses the
//     deprecated `X-RateLimit-*` siblings.
// ════════════════════════════════════════════════════════════════════
"use strict";

const rateLimit = require("express-rate-limit");
// express-rate-limit v8 requires the `ipKeyGenerator` helper when a
// custom keyGenerator derives its key from req.ip. The helper folds
// IPv6 addresses to their /64 prefix so an attacker can't sidestep
// the limit by burning through ::/64 host bits. Without it, the
// limiter refuses to construct (ERR_ERL_KEY_GEN_IPV6) at module load.
const { ipKeyGenerator } = require("express-rate-limit");

// ── /api/auth/login ────────────────────────────────────────────────
// 10 requests / 15 min per IP. `skipSuccessfulRequests:true` so a real
// human typing the right password isn't punished by their last 9
// mis-types — only failed attempts count toward the limit.
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req, res) => ipKeyGenerator(req.ip),
  // R7cp: ship `retryAfterSec` in the response body so the LoginPage can
  // render a live mm:ss countdown instead of the vague "few minutes"
  // copy. express-rate-limit populates `req.rateLimit.resetTime` (a Date)
  // when the limit trips; we derive seconds-until-reset from it. The
  // standard `RateLimit-Reset` header is also emitted via
  // `standardHeaders:true` for non-browser clients that follow RFC 6585.
  handler: (req, res /*, next, options */) => {
    const resetMs = req.rateLimit?.resetTime
      ? new Date(req.rateLimit.resetTime).getTime() - Date.now()
      : 15 * 60 * 1000;
    const retryAfterSec = Math.max(1, Math.ceil(resetMs / 1000));
    // Mirror RFC 6585 — Retry-After in seconds when the value is short
    // enough that an HTTP-date would be silly. express-rate-limit v8
    // already sets it via standardHeaders, but we set it explicitly so
    // older proxies/CDNs that strip non-RateLimit-* headers still get it.
    res.set("Retry-After", String(retryAfterSec));
    const mins = Math.floor(retryAfterSec / 60);
    const secs = retryAfterSec % 60;
    const human = mins > 0
      ? `${mins} min ${secs.toString().padStart(2, "0")} sec`
      : `${secs} sec`;
    res.status(429).json({
      ok: false,
      success: false,                  // some old frontend paths read .success
      code: "TOO_MANY_LOGIN_ATTEMPTS",
      retryAfterSec,                   // machine-readable countdown driver
      resetAt: req.rateLimit?.resetTime || new Date(Date.now() + resetMs),
      message: `Too many login attempts from this IP. Try again in ${human}.`,
    });
  },
});

// ── /api/client-errors ─────────────────────────────────────────────
// 30 requests / minute per IP. A misbehaving frontend release can
// fire a stack trace on every render; this stops one bad deploy from
// melting the error sink without losing the legitimate first wave of
// reports.
const clientErrorRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => ipKeyGenerator(req.ip),
  handler: (req, res /*, next, options */) => {
    res.status(429).json({
      ok: false,
      code: "TOO_MANY_ERROR_REPORTS",
      message: "Too many error reports from this IP. Try again in a minute.",
    });
  },
});

// ── /api/auth/users-by-role/:role ──────────────────────────────────
// R7hr-218 (RBAC audit #5): the login-screen role-pill roster returns
// {employeeId, firstName, lastName} pre-auth so a name-click can autofill
// the login id (R7hr-38 UX). loginRateLimit does NOT protect it because
// `skipSuccessfulRequests:true` ignores the endpoint's 200s — so an
// attacker could enumerate the whole employee directory (and then
// credential-spray the harvested ids) unthrottled. This dedicated limiter
// COUNTS every fetch (no skip) and is tight enough to stop bulk scraping
// loops while staying generous for a legit (cached, per-role) pill click
// even on a shared reception terminal: 30 / 15 min / IP.
const rosterRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => ipKeyGenerator(req.ip),
  handler: (req, res /*, next, options */) => {
    const resetMs = req.rateLimit?.resetTime
      ? new Date(req.rateLimit.resetTime).getTime() - Date.now()
      : 15 * 60 * 1000;
    res.set("Retry-After", String(Math.max(1, Math.ceil(resetMs / 1000))));
    res.status(429).json({
      ok: false,
      success: false,
      code: "TOO_MANY_ROSTER_REQUESTS",
      message: "Too many staff-roster lookups from this IP. Please try again shortly.",
    });
  },
});

module.exports = {
  loginRateLimit,
  clientErrorRateLimit,
  rosterRateLimit,
};
