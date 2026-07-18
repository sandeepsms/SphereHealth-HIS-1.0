/**
 * GateLogModel — every entry/exit at any of the hospital gates.
 *
 * Captured by Security at the gate desk. Optionally linked to a
 * VisitorPass when the person on the way in is an attendant for an
 * admitted patient.
 *
 * R7bj-F3: append-only + 5y retention with TTL + legalHold override.
 * R7bi 1-CRIT-7 / 10-CRIT-2: identifying fields (personName / ID proof /
 *   contact / vehicle / direction / gate / pass link / recorded-by trio
 *   / recordedAt) frozen post-write. Only `notes` and `legalHold` mutate.
 */
const mongoose = require("mongoose");

const FIVE_YEARS_MS = 5 * 365 * 24 * 60 * 60 * 1000;

const GateLogSchema = new mongoose.Schema(
  {
    direction: {
      type: String,
      enum: ["in", "out"],
      required: true,
      index: true,
    },
    gate: {
      type: String,
      enum: ["Main", "Emergency", "Service", "Pharmacy", "Other"],
      default: "Main",
      index: true,
    },
    personType: {
      type: String,
      // "Attendant" is first-class: VisitorPass issues attendant passes
      // (attendantName/attendantRelation), and the gate desk records the
      // linked entry as personType "Attendant" when that pass is scanned.
      // Its absence made a real attendant gate-entry throw a Mongoose
      // ValidationError → HTTP 500 (E2E: tasks/security slice).
      enum: ["Visitor", "Attendant", "Patient", "Staff", "Vendor", "Ambulance", "Other"],
      default: "Visitor",
      index: true,
    },
    personName:     { type: String, required: true, trim: true },
    contactNumber:  { type: String, default: "" },
    idProofType: {
      type: String,
      enum: ["Aadhaar", "PAN", "Voter ID", "Driving License", "Passport", "Employee ID", "Other", null],
      default: null,
    },
    idProofNumber:  { type: String, default: "" },
    purpose:        { type: String, default: "" },
    vehicleNumber:  { type: String, default: "" },

    // Optional VisitorPass linkage — set when the gate desk scans an
    // existing attendant pass instead of capturing fresh ID details.
    visitorPassId:  { type: mongoose.Schema.Types.ObjectId, ref: "VisitorPass", default: null, index: true },
    linkedPassNumber: { type: String, default: "" },

    // Authoritative recording timestamp (separate from createdAt so an
    // append-only guard can freeze it independently of the Mongoose
    // timestamp). Defaults to now on create.
    recordedAt:     { type: Date, default: Date.now, index: true },

    // Audit
    recordedBy:     { type: String, required: true, trim: true },
    recordedByName: { type: String, default: "" },
    recordedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    recordedByRole: { type: String, default: "Security" },

    notes:          { type: String, default: "" },

    // R7bj-F3 / 10-CRIT-2: 5y retention with TTL auto-prune.
    // legalHold=true freezes the row past retainUntil via partial filter
    // on the TTL index (kept indefinitely while a case is open).
    retainUntil:    { type: Date, default: () => new Date(Date.now() + FIVE_YEARS_MS) },
    legalHold:      { type: Boolean, default: false },
  },
  { timestamps: true },
);

GateLogSchema.index({ createdAt: -1 });
GateLogSchema.index({ direction: 1, createdAt: -1 });
GateLogSchema.index({ personName: 1 });
// R7bi-9-MED-2: compound indexes for security-dashboard queries.
GateLogSchema.index({ personType: 1, createdAt: -1 });
GateLogSchema.index({ gate: 1, createdAt: -1 });
// TTL — purge expired rows automatically, but only those NOT under legalHold.
GateLogSchema.index(
  { retainUntil: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { legalHold: false } },
);

/* ── R7bj-F3: APPEND-ONLY GUARD ───────────────────────────────
 * Only `notes`, `legalHold`, `retainUntil`, and Mongoose-managed
 * `updatedAt` may mutate after the row is written. Any attempt to
 * change identifying fields (personType/personName/ID proof/contact/
 * vehicle/direction/gate/pass linkage/recordedAt/recorded-by trio)
 * throws GATE_LOG_APPEND_ONLY with HTTP 409. */
const GATE_LOG_MUTABLE = new Set(["notes", "legalHold", "retainUntil", "updatedAt"]);

function gateLogAppendOnlyGuard(queryThis) {
  const upd = queryThis.getUpdate() || {};
  const $set = upd.$set || {};
  const $unset = upd.$unset || {};
  const topLevel = Object.keys(upd).filter((k) => !k.startsWith("$"));
  // Reject if anyone is using top-level field shorthand (Mongoose
  // hoists these to $set automatically, but defensive check first).
  const candidates = new Set([...Object.keys($set), ...Object.keys($unset), ...topLevel]);
  const illegal = [...candidates].filter((k) => !GATE_LOG_MUTABLE.has(k));
  if (illegal.length) {
    const err = new Error(
      `GateLog is append-only; cannot modify: ${illegal.join(", ")}. ` +
      `Mutable fields: notes, legalHold, retainUntil.`,
    );
    err.statusCode = 409;
    err.code = "GATE_LOG_APPEND_ONLY";
    throw err;
  }
}

GateLogSchema.pre("findOneAndUpdate", function (next) {
  try { gateLogAppendOnlyGuard(this); next(); } catch (e) { next(e); }
});
GateLogSchema.pre("updateOne", function (next) {
  try { gateLogAppendOnlyGuard(this); next(); } catch (e) { next(e); }
});
GateLogSchema.pre("updateMany", function (next) {
  try { gateLogAppendOnlyGuard(this); next(); } catch (e) { next(e); }
});

module.exports =
  mongoose.models.GateLog || mongoose.model("GateLog", GateLogSchema);
