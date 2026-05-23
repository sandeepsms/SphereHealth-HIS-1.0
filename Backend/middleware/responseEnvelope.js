/**
 * Backend/middleware/responseEnvelope.js
 * ────────────────────────────────────────────────────────────────────
 * R7bh-F8 — light Express middleware that attaches `res.ok()` / `res.err()`
 * sugar so controllers can write
 *     return res.ok(data, meta);
 *     return res.err(e, "VALIDATION", 400);
 * instead of importing `sendOk`/`sendErr` everywhere.
 *
 * Intentionally NOT registered globally yet — opt-in per route file. The
 * heavy controllers under our scope continue to import the helper directly;
 * other controllers that already normalise their own envelope MUST NOT be
 * rewrapped (Pharmacy F4, Billing F10).
 *
 * To enable on a router:
 *     router.use(require("../middleware/responseEnvelope"));
 */

"use strict";

const { ok, sendErr } = require("../utils/apiEnvelope");

module.exports = function responseEnvelope(req, res, next) {
  res.ok = function ok_(data, meta, status) {
    const s = typeof status === "number" ? status : 200;
    return res.status(s).json(ok(data, meta));
  };
  res.err = function err_(e, code, status) {
    return sendErr(res, e, code, status);
  };
  next();
};
