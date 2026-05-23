/**
 * services/HR/credentialExpiryBlocker.js  (R7bh-F6 / R7bg CRIT / NABH HRD.3)
 *
 * Express middleware that refuses clinical writes when the acting
 * doctor's credentials have expired. NABH HRD.3 expects the hospital to
 * stop a clinician from prescribing / discharging once their licence /
 * council registration expires. The cron `expire-credentials` already
 * flips `Credential.status` to EXPIRED; this middleware enforces the
 * downstream block at the API edge.
 *
 * Usage:
 *   router.post(
 *     "/orders",
 *     requireAction("doctor-orders.write"),
 *     blockIfCredentialExpired,
 *     ctrl.create,
 *   );
 *
 * Behaviour:
 *   • Only runs when req.user.role === "Doctor". Non-doctor writes pass.
 *   • If `Credential.find({ userId: req.user.id, status: "EXPIRED" })`
 *     returns at least one row, respond 403 with code CREDENTIAL_EXPIRED.
 *   • The credentialed-signer check is conservative — we block any
 *     write reaching the middleware regardless of doc type, since
 *     this middleware is opt-in on the specific routes that demand
 *     credentialed authors.
 *
 * The middleware is wired *additively* on the routes that demand it —
 * NOT globally — so a doctor with one expired credential type can still
 * (for example) read their own notes; only the writes that demand a
 * credentialed signer are blocked.
 */
"use strict";

const Credential = require("../../models/HR/CredentialModel");

/**
 * Express middleware factory. By default checks for any EXPIRED row;
 * supply { credentialTypes: ["LICENCE", "MBBS"] } to limit the gate
 * to the specific credential class(es) the route requires.
 */
function blockIfCredentialExpired(opts = {}) {
  const restrictedTypes = Array.isArray(opts.credentialTypes)
    ? opts.credentialTypes
    : null;

  return async function _gate(req, res, next) {
    try {
      // Non-doctors and unauthenticated requests skip — the upstream
      // `authenticate` + role checks have already had their say.
      if (!req.user) return next();
      if (req.user.role !== "Doctor") return next();
      const filter = { userId: req.user.id, status: "EXPIRED" };
      if (restrictedTypes) filter.credentialType = { $in: restrictedTypes };
      const expired = await Credential.findOne(filter).select("_id credentialType expiryDate").lean();
      if (!expired) return next();
      return res.status(403).json({
        success: false,
        code: "CREDENTIAL_EXPIRED",
        message:
          `Cannot proceed — your credential ${expired.credentialType} expired on ${
            expired.expiryDate ? new Date(expired.expiryDate).toISOString().slice(0, 10) : "—"
          }. Contact HR / Admin to renew.`,
        credentialType: expired.credentialType,
        expiryDate: expired.expiryDate,
      });
    } catch (e) {
      // Fail-open: a Mongo blip should not silently block writes — that
      // is a worse failure mode than letting a doctor through with an
      // about-to-expire creditial. Log + proceed.
      console.warn("[credentialExpiryBlocker] check failed (fail-open):", e.message);
      return next();
    }
  };
}

module.exports = { blockIfCredentialExpired };
