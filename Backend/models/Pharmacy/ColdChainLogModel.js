// Backend/models/Pharmacy/ColdChainLogModel.js
// R7bh-F5: cold-chain temperature log for vaccine/insulin/biologic storage
// (NABH MOM.2 + D&C Schedule K / WHO PQS E003 vaccine cold chain).
// Append-only. Pre-update guard blocks any mutation except the acknowledge fields.

const mongoose = require("mongoose");

const ColdChainLogSchema = new mongoose.Schema(
  {
    fridgeId: { type: String, required: true, trim: true, index: true },
    fridgeLabel: { type: String, default: null, trim: true },
    fridgeLocation: { type: String, default: null, trim: true },
    fridgeType: { type: String, enum: ["FRIDGE", "FREEZER", "ROOM_TEMP"], default: "FRIDGE" },
    recordedAt: { type: Date, default: Date.now },
    recordedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recordedByName: { type: String, default: null },
    temperatureC: { type: Number, required: true, min: -50, max: 50 },
    humidityPct: { type: Number, min: 0, max: 100, default: null },
    inRange: { type: Boolean, default: true },
    isBreachIncident: { type: Boolean, default: false },
    incidentNotes: { type: String, default: null },
    correctiveAction: { type: String, default: null },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    acknowledgedByName: { type: String, default: null },
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital", default: null },

    // R7bm-F7 — FSSAI 2.1.13 + D&C Schedule K + WHO PQS E003:
    // cold-chain (vaccine/insulin/biologic) temperature logs must be
    // retained for at least 3 years so an SPCB / FSSAI / WHO PQS
    // inspection can reconstruct breach chronology and corrective
    // action history. Recorded as a date marker only — a future
    // scheduled-purge cron sweeps rows past this horizon. NO TTL is
    // attached on purpose: dropping cold-chain rows must be a
    // governed workflow (review + sign-off), not silent auto-delete.
    retainUntil: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

ColdChainLogSchema.index({ fridgeId: 1, recordedAt: -1 });
ColdChainLogSchema.index({ isBreachIncident: 1, acknowledgedAt: 1, recordedAt: -1 });

// R7bm-F7 — set retainUntil = createdAt + 3 years on insert only.
// The append-only ACK_ONLY guard below blocks updates so retainUntil
// can never be back-dated from a portal request.
const COLD_CHAIN_RETENTION_YEARS = 3;
ColdChainLogSchema.pre("save", function (next) {
  if (this.isNew && !this.retainUntil) {
    const base = this.createdAt || this.recordedAt || new Date();
    const d = new Date(base);
    d.setFullYear(d.getFullYear() + COLD_CHAIN_RETENTION_YEARS);
    this.retainUntil = d;
  }
  next();
});

// Append-only: block any non-ack mutation paths.
const ACK_ONLY = new Set(["acknowledgedAt", "acknowledgedById", "acknowledgedByName", "correctiveAction", "updatedAt"]);
ColdChainLogSchema.pre("findOneAndUpdate", function (next) {
  const upd = this.getUpdate() || {};
  const $set = upd.$set || upd;
  const trying = Object.keys($set || {});
  const illegal = trying.filter((k) => !ACK_ONLY.has(k));
  if (illegal.length) {
    const err = new Error(`Cold-chain log is append-only; cannot modify: ${illegal.join(",")}`);
    err.statusCode = 409;
    err.code = "COLD_CHAIN_APPEND_ONLY";
    return next(err);
  }
  next();
});
ColdChainLogSchema.pre("updateOne", function (next) {
  ColdChainLogSchema.statics._appendOnlyGuard(this);
  next();
});
ColdChainLogSchema.statics._appendOnlyGuard = function (queryThis) {
  const upd = queryThis.getUpdate() || {};
  const $set = upd.$set || upd;
  const trying = Object.keys($set || {});
  const illegal = trying.filter((k) => !ACK_ONLY.has(k));
  if (illegal.length) {
    const err = new Error(`Cold-chain log is append-only; cannot modify: ${illegal.join(",")}`);
    err.statusCode = 409;
    err.code = "COLD_CHAIN_APPEND_ONLY";
    throw err;
  }
};

module.exports = mongoose.models.ColdChainLog || mongoose.model("ColdChainLog", ColdChainLogSchema);
