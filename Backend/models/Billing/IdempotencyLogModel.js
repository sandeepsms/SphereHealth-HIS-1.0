// models/Billing/IdempotencyLogModel.js
// ════════════════════════════════════════════════════════════════════
// R7bh-F10 / R7bg-10-CRIT-3 + R7bg-6-HIGH-10 + R7bg-3-HIGH-9:
//   Idempotency-Key cache for money-touching POST endpoints.
//
//   The audit caught three independent failure modes that all collapse
//   to "the same logical request landed twice on the server":
//     • cashier double-click on the [Record Payment] button
//     • mobile + desktop both posting the same advance refund
//     • network retry on a slow 502 (browser sends the same POST again
//       and the first one DID land; now we'd post duplicate UPI rows)
//
//   The fix is the standard idempotency-key middleware: the client
//   supplies `Idempotency-Key: <uuid>` on POST; the server caches the
//   first response for 24h and replays it verbatim on any repeat.
//
//   TTL: 24h (Mongo's `expireAfterSeconds: 0` reads the value from the
//   `expiresAt` field — set on insert).
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const IdempotencyLogSchema = new mongoose.Schema(
  {
    // Client-supplied UUID (Idempotency-Key request header).
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      // Index implicitly via `unique:true`; the explicit index() block
      // below adds the TTL on `expiresAt`.
    },
    // Hint identifying which route this key was used on (e.g.
    // "POST:/api/billing/:billId/payment"). Lets a duplicate key
    // collision across endpoints be diagnosed instead of silently
    // returning a wrong-shape cached body.
    scope: { type: String, trim: true, default: null },
    // Hash of the request body — used to detect a same-key-different-body
    // collision (a real bug on the client). We don't reject; we log a
    // warning and serve the cached response so the client at least
    // observes its first successful state.
    requestHash: { type: String, trim: true, default: null },
    // Cached response body (what the controller passed to res.json).
    responseBody: { type: mongoose.Schema.Types.Mixed, default: null },
    // Cached HTTP status code (2xx → cache; 4xx/5xx → cached too so
    // a retried request doesn't accidentally re-execute a previously-
    // rejected operation).
    statusCode: { type: Number, default: 200 },
    // Actor id (best-effort) for forensic queries.
    actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdAt: { type: Date, default: Date.now },
    // TTL anchor — Mongo evicts at this timestamp. Default = +24h.
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  },
  {
    // Explicit collection name (not the auto-pluralised
    // "idempotencylogs") — easier to spot in operator queries.
    collection: "idempotency_logs",
  },
);

// TTL index — Mongo expires the doc when wall-clock passes expiresAt.
// expireAfterSeconds:0 means "use the date in the field as-is".
IdempotencyLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("IdempotencyLog", IdempotencyLogSchema);
