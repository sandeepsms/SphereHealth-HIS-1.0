/**
 * IdempotencyMapModel.js  (R7bh-F4 / R7bg-3-CRIT-2)
 *
 * Idempotency-Key support for write endpoints that create new docs
 * (initially: pharmacy dispense + vendor return). When the client passes
 * `Idempotency-Key: <uuid>`, the controller looks up this collection
 * first; an existing row with a matching requestHash returns the
 * cached response immediately instead of double-charging stock.
 *
 * TTL: 1 hour from createdAt — well under any sane retry window for a
 * pharmacy counter operation, and short enough that the collection never
 * grows beyond a few thousand rows even under load.
 *
 * Lookup pattern:
 *   await IdempotencyMap.findOne({ key }).lean();
 *   // → if exists && requestHash matches → return cached responseBody/status
 *   // → else process the request, then await IdempotencyMap.create({...})
 */
const mongoose = require("mongoose");

const IdempotencyMapSchema = new mongoose.Schema(
  {
    key:          { type: String, required: true, unique: true, index: true },
    method:       { type: String, default: "" },                              // e.g. "POST"
    route:        { type: String, default: "" },                              // e.g. "/api/pharmacy/sales"
    // Hash of the canonical request body so the same key + DIFFERENT
    // payload is treated as a NEW request rather than serving a stale
    // cached response. SHA-256 hex string.
    requestHash:  { type: String, default: "" },
    responseBody: { type: mongoose.Schema.Types.Mixed, default: null },
    status:       { type: Number, default: 200 },
    createdAt:    { type: Date, default: Date.now },
    // TTL anchor — Mongo expires the doc when wall clock passes expiresAt.
    expiresAt:    { type: Date, default: () => new Date(Date.now() + 60 * 60 * 1000) },
  },
  { timestamps: false },
);

// Mongo TTL monitor evicts expired docs roughly once per minute.
IdempotencyMapSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.IdempotencyMap ||
  mongoose.model("IdempotencyMap", IdempotencyMapSchema);
