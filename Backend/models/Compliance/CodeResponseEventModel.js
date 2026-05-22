/**
 * CodeResponseEventModel.js  (R7bj-F6 / NABH SEC-CRIT-1 / FMS.5 + COP.18)
 *
 * Unified emergency-code response register. Pre-R7bj only Code Blue
 * (cardiac arrest) had a model — `wardOpsModels.CodeBlueEvent` —
 * which left Codes Red (fire), Pink (infant abduction), Grey
 * (combative person), Yellow (mass-casualty / MCI), White (violence),
 * Brown (hazmat) and Black (bomb threat) unrecorded. FireDrillModel
 * captures *drills* not *events*; that's why it's a separate register.
 *
 * Code Blue is intentionally absorbed here so the hospital has a
 * single Mean-Response-Time (MRT) dashboard across all codes. The
 * legacy CodeBlueEvent stays in `wardOpsModels.js` for backwards-
 * compat reads but new writes must funnel through this model.
 *
 * Append-only on resolution: once `resolvedAt` is set, the doc is
 * frozen except for free-text `notes` (post-incident review).
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

const CodeResponderSchema = new Schema(
  {
    _id:        false,
    byUserId:   { type: Schema.Types.ObjectId, ref: "User", default: null },
    name:       { type: String, default: "" },
    role:       { type: String, default: "" },
    arrivedAt:  { type: Date, default: Date.now },
  },
);

const CodeResponseEventSchema = new Schema(
  {
    // Auto-counter — formatId("CR-YYYY", seq, 5) → "CR-2026-00001"
    eventNumber: { type: String, required: true, unique: true, index: true },

    code: {
      type: String,
      // BLUE  — cardiac arrest
      // RED   — fire
      // PINK  — infant / paediatric abduction
      // GREY  — combative / threatening person
      // YELLOW— MCI / mass casualty
      // WHITE — violence (active assailant)
      // BROWN — hazmat / chemical spill
      // BLACK — bomb threat
      enum: ["BLUE", "RED", "PINK", "GREY", "YELLOW", "WHITE", "BROWN", "BLACK"],
      required: true,
      index: true,
    },

    location:    { type: String, required: true, trim: true },     // ward / room / building
    bedNumber:   { type: String, default: "" },

    alertedAt:     { type: Date, required: true, default: Date.now, index: true },
    alertedById:   { type: Schema.Types.ObjectId, ref: "User", default: null },
    alertedByName: { type: String, default: "" },

    // Optional patient context — relevant for Blue/Pink. Red/Yellow
    // may have many victims or none yet linked.
    patientUHID: { type: String, default: "", index: true, uppercase: true, trim: true },
    patientName: { type: String, default: "" },

    responders:       { type: [CodeResponderSchema], default: [] },
    arrivedFirstAt:   { type: Date, default: null, index: true },  // computed = min(responders.arrivedAt)
    arrivalDelaySec:  { type: Number, default: null },             // alertedAt → arrivedFirstAt

    resolvedAt:       { type: Date, default: null, index: true },
    durationMinutes:  { type: Number, default: null },             // alertedAt → resolvedAt

    outcome: {
      type: String,
      enum: ["RESOLVED", "ESCALATED", "FALSE_ALARM", "PRONOUNCED_DEAD", "TRANSFERRED", ""],
      default: "",
      index: true,
    },

    // Red / Yellow specific
    evacuationCount: { type: Number, default: null, min: 0 },

    notes: { type: String, default: "" },

    // Cross-register links
    linkedMortuaryId: { type: Schema.Types.ObjectId, ref: "MortuaryRecord",  default: null },
    linkedIncidentId: { type: Schema.Types.ObjectId, ref: "IncidentReport",  default: null },

    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "code_response_events" },
);

CodeResponseEventSchema.index({ code: 1, alertedAt: -1 });
CodeResponseEventSchema.index({ patientUHID: 1, alertedAt: -1 });
CodeResponseEventSchema.index({ outcome: 1, alertedAt: -1 });

// Append-only on resolution: once `resolvedAt` is set, only `notes`
// (post-incident review free-text) may change.  Mortuary / incident
// links can still attach via dedicated service helpers that use
// $set:{linkedMortuaryId|linkedIncidentId} but those keys are allowed.
const POST_RESOLVE_ALLOWED = new Set([
  "notes",
  "linkedMortuaryId",
  "linkedIncidentId",
  "updatedAt",
]);
function _guardPostResolve(queryThis) {
  const upd = queryThis.getUpdate() || {};
  const $set = upd.$set || upd;
  const trying = Object.keys($set || {});
  const illegal = trying.filter((k) => !POST_RESOLVE_ALLOWED.has(k) && !k.startsWith("$"));
  if (!illegal.length) return;
  return queryThis.model.findOne(queryThis.getQuery()).then((existing) => {
    if (existing && existing.resolvedAt) {
      const err = new Error(
        `Code-response event is resolved; cannot modify: ${illegal.join(",")}`,
      );
      err.statusCode = 409;
      err.code = "CODE_RESPONSE_RESOLVED";
      throw err;
    }
  });
}
CodeResponseEventSchema.pre("findOneAndUpdate", function (next) {
  try {
    const p = _guardPostResolve(this);
    if (p && typeof p.then === "function") return p.then(() => next()).catch(next);
    next();
  } catch (e) { next(e); }
});
CodeResponseEventSchema.pre("updateOne", function (next) {
  try {
    const p = _guardPostResolve(this);
    if (p && typeof p.then === "function") return p.then(() => next()).catch(next);
    next();
  } catch (e) { next(e); }
});

module.exports =
  mongoose.models.CodeResponseEvent ||
  mongoose.model("CodeResponseEvent", CodeResponseEventSchema);
