/**
 * CSSDLoadRecordModel.js — NABH HIC.7 / CSSD sterilisation load-release
 *
 * Per-cycle sterilisation load record. The physical autoclave process is
 * hardware, but the LOAD-RELEASE DOCUMENTATION — each cycle's parameters +
 * Bowie-Dick + chemical + biological indicator results, and the sign-off that
 * releases the load for use — is squarely a software-capturable NABH record.
 *
 * Release gate: a load CANNOT be released if the Bowie-Dick, chemical, or
 * biological indicator FAILED. A biological indicator is often still incubating
 * at release time — releasing with BI "Pending" is allowed but flagged
 * (releasedWithBiPending) so a later BI failure can trigger recall.
 *
 * Number: CSSD-YY-N (FY-keyed, gap-less via the shared counter).
 */
"use strict";

const mongoose = require("mongoose");
const { nextSequence } = require("../../utils/counter");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["CREATED", "RELEASED", "QUARANTINED", "RECALLED", "UPDATED"], default: "CREATED" },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "" },
});

const CSSDLoadRecordSchema = new Schema(
  {
    loadNumber: { type: String, unique: true, sparse: true, index: true }, // CSSD-YY-N

    // ── Cycle ──
    sterilizerId: { type: String, required: true, trim: true },   // autoclave / machine id
    cycleType: {
      type: String,
      enum: ["Steam", "ETO", "Plasma", "Formaldehyde", "Hot-Air", "Other"],
      default: "Steam",
    },
    cycleNumber: { type: String, default: "" },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    temperatureC: { type: Number, default: null },
    pressureKpa: { type: Number, default: null },
    exposureMinutes: { type: Number, default: null },

    // ── Indicators (the release gate) ──
    bowieDickResult:      { type: String, enum: ["NA", "Pass", "Fail"], default: "NA" },       // steam-penetration test
    chemicalIndicator:    { type: String, enum: ["NA", "Pass", "Fail"], default: "NA" },       // per-pack CI
    biologicalIndicator:  { type: String, enum: ["NA", "Pending", "Pass", "Fail"], default: "Pending" }, // spore test
    biologicalReadAt:     { type: Date, default: null },

    // ── Contents ──
    instrumentSets: { type: [String], default: [] },   // set / tray names in this load
    itemCount: { type: Number, default: null },
    department: { type: String, default: "" },          // OT / ward / clinic the load serves
    expiryDate: { type: Date, default: null },           // sterility expiry of the load

    // ── Release ──
    loadReleased: { type: Boolean, default: false, index: true },
    releasedWithBiPending: { type: Boolean, default: false },
    releasedByName: { type: String, default: "" },
    releasedById: { type: Schema.Types.ObjectId, ref: "User", default: null },
    releasedAt: { type: Date, default: null },

    status: { type: String, enum: ["Recorded", "Released", "Quarantined", "Recalled"], default: "Recorded", index: true },
    remarks: { type: String, default: "" },

    auditTrail: { type: [AuditSchema], default: [] },
    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
    createdByName: { type: String, default: "" },
  },
  { timestamps: true, collection: "cssd_load_records" },
);

CSSDLoadRecordSchema.index({ sterilizerId: 1, createdAt: -1 });
CSSDLoadRecordSchema.index({ status: 1, createdAt: -1 });
CSSDLoadRecordSchema.index({ biologicalIndicator: 1, loadReleased: 1 });

CSSDLoadRecordSchema.pre("save", async function (next) {
  if (this.loadNumber) return next();
  try {
    const now = new Date();
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const yy = String(fyStartYear).slice(-2);
    const seq = await nextSequence(`cssdload:${yy}`);
    this.loadNumber = `CSSD-${yy}-${seq}`;
    next();
  } catch (e) { next(e); }
});

// ── D19 — NABH register tamper-evidence ─────────────────────
// Stamp a keyed HMAC-SHA256 integrity digest on every save so an out-of-band
// edit of this surveyor-inspected register row is detectable. Non-blocking +
// backward-compatible: legacy rows (no stored digest) verify as "unverified",
// never "tampered". Registered AFTER the loadNumber pre('save') hook above so
// the minted loadNumber is included in the digest. Keyed by REGISTER_HMAC_SECRET.
const { registerIntegrityPlugin } = require("../../utils/registerIntegrity");
CSSDLoadRecordSchema.plugin(registerIntegrityPlugin);

module.exports =
  mongoose.models.CSSDLoadRecord || mongoose.model("CSSDLoadRecord", CSSDLoadRecordSchema);
