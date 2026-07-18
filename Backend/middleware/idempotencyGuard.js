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

    // R9-FIX(R9-092): reserve-BEFORE-dispatch. The old guard was check-then-act
    // — it did findOne() up front and only cached the response on the way OUT
    // (res.json, fire-and-forget). Two concurrent same-key POSTs therefore BOTH
    // missed the cache, BOTH ran the handler, and BOTH executed the side effect
    // (e.g. created a payment) — so it only ever deduped SEQUENTIAL retries,
    // never a concurrent double-submit (double-click / client retry storm). We
    // now atomically CLAIM the key via the unique index before next(): a
    // statusCode:0 row = "reserved, in progress"; a statusCode>0 row = completed
    // and replayable. The loser of the race replays the cached reply or gets 409.
    const isCompleted = (row) => !!row && Number(row.statusCode) > 0;

    // Fast path: a completed row → replay verbatim.
    let existing = null;
    try {
      existing = await IdempotencyLog.findOne({ key: trimmedKey }).lean();
    } catch (e) {
      // Lookup failure must NOT block the request (controller-level dup-txn
      // guard is the second line of defense). Fall through to the claim.
      console.warn(`[idempotencyGuard] lookup failed: ${e.message}`);
    }
    if (isCompleted(existing)) {
      if (existing.requestHash && requestHash && existing.requestHash !== requestHash) {
        console.warn(
          `[idempotencyGuard] key=${trimmedKey} body-hash mismatch ` +
          `(scope=${scope}, cached=${existing.scope}). Serving cached response.`,
        );
      }
      return res.status(existing.statusCode || 200).set("Idempotent-Replay", "true").json(existing.responseBody);
    }
    if (existing && !isCompleted(existing)) {
      // Another request holds the reservation but hasn't finished.
      return res.status(409).json({
        success: false, code: "IDEMPOTENCY_IN_PROGRESS",
        message: "A request with this Idempotency-Key is already in progress. Retry shortly.",
      });
    }

    // Atomically claim the key. A SHORT expiry bounds an abandoned reservation
    // (handler crash before completion) to ~2 min instead of the full 24h TTL,
    // so a legitimate retry isn't stuck behind a dead claim.
    let claimed = false;
    try {
      await IdempotencyLog.create({
        key: trimmedKey, scope, requestHash,
        responseBody: null, statusCode: 0,
        actorId: req.user?._id || req.user?.id || null,
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
      });
      claimed = true;
    } catch (e) {
      if (e?.code === 11000) {
        // Lost the claim race — replay if the winner already completed, else 409.
        let now = null;
        try { now = await IdempotencyLog.findOne({ key: trimmedKey }).lean(); } catch (_) { /* ignore */ }
        if (isCompleted(now)) {
          return res.status(now.statusCode || 200).set("Idempotent-Replay", "true").json(now.responseBody);
        }
        return res.status(409).json({
          success: false, code: "IDEMPOTENCY_IN_PROGRESS",
          message: "A request with this Idempotency-Key is already in progress. Retry shortly.",
        });
      }
      // Non-conflict insert error → fail open (never block a request on a cache bug).
      console.warn(`[idempotencyGuard] claim failed: ${e.message}`);
    }

    if (claimed) {
      // Complete the reservation on the way out — or RELEASE it on a non-2xx so
      // a legitimate retry can proceed rather than replaying a failure forever.
      const origJson = res.json.bind(res);
      let settled = false;
      res.json = function _patchedJson(body) {
        settled = true;
        const status = res.statusCode || 200;
        if (status >= 200 && status < 300) {
          IdempotencyLog.updateOne(
            { key: trimmedKey },
            { $set: { responseBody: body, statusCode: status, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } },
          ).catch((err) => console.warn(`[idempotencyGuard] cache finalize failed: ${err.message}`));
        } else {
          IdempotencyLog.deleteOne({ key: trimmedKey, statusCode: 0 }).catch(() => {});
        }
        return origJson(body);
      };
      // Safety net: if the response finishes WITHOUT the patched res.json firing
      // (an error handler used res.send/res.end), release the pending claim so
      // the key isn't wedged at 409 until its 2-min expiry.
      res.on("finish", () => {
        if (!settled) IdempotencyLog.deleteOne({ key: trimmedKey, statusCode: 0 }).catch(() => {});
      });
    }

    return next();
  };
}

module.exports = idempotencyGuard;
module.exports.idempotencyGuard = idempotencyGuard;
