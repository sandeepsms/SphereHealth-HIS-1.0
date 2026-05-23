// middleware/idempotencyGuard.js
// ════════════════════════════════════════════════════════════════════
// R7bh-F10 / R7bg-10-CRIT-3 + R7bg-6-HIGH-10 + R7bg-3-HIGH-9:
//   Idempotency-Key middleware for money-touching POST endpoints.
//
//   Contract:
//     Client supplies `Idempotency-Key: <uuid>` request header on a
//     POST that has a side-effect (recordPayment, refund, advance,
//     bulk-collect). If the same key has been seen in the last 24h,
//     we replay the cached response (same status, same body) WITHOUT
//     re-executing the route handler — so a cashier double-click or
//     a network retry never posts two payment rows.
//
//   No header → no guard. Legacy clients without the header keep
//   their existing behaviour (so we never accidentally drop a
//   request just because the header is missing — the worst case is
//   the same dup-row the audit caught, which the controller-level
//   transactionId guards now also catch).
//
//   Same key + DIFFERENT body → cached response is served + a warn
//   is logged. We don't 409: the client thinks it's retrying the
//   same op, and serving anything other than the cached result
//   would break the idempotency contract.
//
//   Wrap-once: we monkey-patch `res.json` so the moment the route
//   handler calls it, we capture the response and cache it. This
//   keeps the middleware decoupled from the controller's error /
//   success paths.
// ════════════════════════════════════════════════════════════════════

const crypto = require("crypto");
const IdempotencyLog = require("../models/Billing/IdempotencyLogModel");

// Stable-stringify (sort object keys) so two callers posting the same
// payload in different key orders produce the same hash. Arrays keep
// insertion order — they're semantically ordered.
function _stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(_stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + _stableStringify(obj[k])).join(",") + "}";
}

function _hashBody(body) {
  try {
    return crypto.createHash("sha256").update(_stableStringify(body || {})).digest("hex");
  } catch (_) {
    return null;
  }
}

/**
 * Returns an Express middleware factory.
 *   @param {string} scope — short label for the route (e.g. "recordPayment").
 *                          Stored on the cache row for forensic queries.
 *   @returns {Function} (req, res, next)
 */
function idempotencyGuard(scope) {
  return async function _idemGuard(req, res, next) {
    // Only POST mutates state. GETs / HEADs / OPTIONS pass through
    // even if the client sends the header by accident.
    if (req.method !== "POST") return next();

    const key = req.get("Idempotency-Key") || req.get("idempotency-key");
    if (!key || !String(key).trim()) {
      // No header → no guard. Legacy / unguarded clients pass through.
      return next();
    }
    const trimmedKey = String(key).trim();
    // Sanity: 8–128 chars, no shell-special. Reject obviously-malformed
    // headers loudly so the client owner notices their bug instead of
    // silently bypassing the guard.
    if (!/^[A-Za-z0-9_\-:.]{8,128}$/.test(trimmedKey)) {
      return res.status(400).json({
        success: false,
        message: "Idempotency-Key must be 8-128 chars, alnum + _-:. only",
        code: "BAD_IDEMPOTENCY_KEY",
      });
    }

    const requestHash = _hashBody(req.body);

    // Look up first — if cached, replay verbatim and SKIP the handler.
    try {
      const existing = await IdempotencyLog.findOne({ key: trimmedKey }).lean();
      if (existing) {
        if (existing.requestHash && requestHash && existing.requestHash !== requestHash) {
          // Same key + different body → almost certainly a client bug.
          // Log loudly and serve the cached response so the client at
          // least observes its first successful state (which is what
          // an idempotency contract demands).
          console.warn(
            `[idempotencyGuard] key=${trimmedKey} body-hash mismatch ` +
            `(scope=${scope}, cached=${existing.scope}). Serving cached response.`,
          );
        }
        return res
          .status(existing.statusCode || 200)
          .set("Idempotent-Replay", "true")
          .json(existing.responseBody);
      }
    } catch (e) {
      // Cache lookup failure must NOT block the request. Log and continue
      // — the controller-level duplicate-transactionId guard is the
      // second line of defense.
      console.warn(`[idempotencyGuard] lookup failed: ${e.message}`);
    }

    // No cache hit — monkey-patch res.json to capture the response and
    // cache it on its way out.
    const origJson = res.json.bind(res);
    res.json = function _patchedJson(body) {
      // Fire-and-forget cache insert. We DON'T await — the client must
      // not block on the cache write. If the insert loses a race
      // (E11000 on `key` unique), a concurrent retry already cached
      // the response; we don't care which side wins.
      const status = res.statusCode || 200;
      IdempotencyLog.create({
        key:          trimmedKey,
        scope,
        requestHash,
        responseBody: body,
        statusCode:   status,
        actorId:      req.user?._id || req.user?.id || null,
      }).catch((e) => {
        if (e?.code === 11000) {
          // Race — another writer already cached this key. Fine.
          return;
        }
        console.warn(`[idempotencyGuard] cache write failed: ${e.message}`);
      });
      return origJson(body);
    };

    return next();
  };
}

module.exports = idempotencyGuard;
module.exports.idempotencyGuard = idempotencyGuard;
