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
  handler: (req, res /*, next, options */) => {
    res.status(429).json({
      ok: false,
      code: "TOO_MANY_LOGIN_ATTEMPTS",
      message: "Too many login attempts from this IP. Try again in 15 minutes.",
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

module.exports = {
  loginRateLimit,
  clientErrorRateLimit,
};
