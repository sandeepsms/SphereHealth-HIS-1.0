/**
 * microbiologyAppender.js  (R7bd-E-4 / A3-HIGH-9)
 *
 * Microbiology workflow is multi-step over hours-to-days. A single
 * `LabReport.reportType: "microbiology"` document can't capture the
 * append-only timeline of:
 *
 *     GRAM_STAIN  → preliminary morphology (~ hour 0)
 *     GROWTH      → 24h plate read
 *     ID          → organism identification (48h)
 *     SUSCEPTIBILITY → antibiogram (48-72h)
 *     FINAL       → consolidated report + sign-off
 *
 * Pre-R7bd the Lab Tech overwrote the single LabReport row on each step,
 * losing every prior interim. This service persists each step as a
 * separate, immutable MicroResultStep row linked to the order item and
 * exposes a single appender so the controller stays thin.
 *
 * NABH POE.5 + NABL 112 expect every intermediate result to be
 * retrievable — clinicians often start empiric therapy on the Gram stain
 * 24h before the final sensitivity lands.
 *
 * IMPORTANT: this service does NOT touch LabReportSchema (owned by
 * Agent C). The final report is compiled by reading the steps[]
 * collection — the schema is not modified.
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

const STEP_KINDS = ["GRAM_STAIN", "GROWTH", "ID", "SUSCEPTIBILITY", "FINAL"];

const MicroResultStepSchema = new Schema(
  {
    // Link to investigation-order line (preferred) and/or the parent
    // LabReport id (when one exists). orderItemId is the canonical
    // foreign key — the LabReport id is denormalised for the final-
    // compile query when it has been generated.
    orderItemId: { type: Schema.Types.ObjectId, index: true, required: true },
    labReportId: { type: Schema.Types.ObjectId, ref: "LabReport", default: null },
    UHID:        { type: String, uppercase: true, trim: true, index: true },

    stepKind: { type: String, enum: STEP_KINDS, required: true },

    // Free-form payload. Each step kind has its own preferred shape but
    // we leave it permissive so the UI can add fields without a model
    // migration:
    //   GRAM_STAIN    → { morphology, comment }
    //   GROWTH        → { mediaResults: [{media, growth, colonyCount}] }
    //   ID            → { organism, identMethod, comment }
    //   SUSCEPTIBILITY → { antibiogram: [{antibiotic, mic, interpretation}] }
    //   FINAL         → { summary, recommendations }
    payload: { type: Schema.Types.Mixed, default: {} },

    performedBy:   { type: String, default: "" },
    performedById: { type: Schema.Types.ObjectId, ref: "User" },
    performedAt:   { type: Date, default: Date.now, index: true },

    // Sign-off — only FINAL steps need a signer; interim steps usually
    // don't. Schema leaves both optional.
    signedBy:      { type: String, default: "" },
    signedById:    { type: Schema.Types.ObjectId, ref: "User" },
    signedAt:      { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }, // append-only
);

MicroResultStepSchema.index({ orderItemId: 1, performedAt: 1 });

// Append-only at the model level — no updates after insert.
MicroResultStepSchema.pre("save", function (next) {
  if (!this.isNew) {
    return next(new Error("MicroResultStep is append-only — emit a new step instead of editing"));
  }
  next();
});
function _block() {
  throw new Error("MicroResultStep is append-only — use appendStep() to add new rows");
}
MicroResultStepSchema.statics.updateOne          = _block;
MicroResultStepSchema.statics.updateMany         = _block;
MicroResultStepSchema.statics.findOneAndUpdate   = _block;
MicroResultStepSchema.statics.findByIdAndUpdate  = _block;
MicroResultStepSchema.statics.deleteOne          = _block;
MicroResultStepSchema.statics.deleteMany         = _block;
MicroResultStepSchema.statics.findByIdAndDelete  = _block;
MicroResultStepSchema.statics.findOneAndDelete   = _block;

const MicroResultStep = mongoose.models.MicroResultStep ||
  mongoose.model("MicroResultStep", MicroResultStepSchema);

// ── appendStep ───────────────────────────────────────────────────
async function appendStep({
  orderItemId,
  labReportId = null,
  UHID = "",
  stepKind,
  payload = {},
  performedBy = "",
  performedById = null,
  signedBy = "",
  signedById = null,
} = {}) {
  if (!orderItemId) {
    const e = new Error("orderItemId required"); e.code = "ARG_MISSING"; e.status = 400; throw e;
  }
  if (!STEP_KINDS.includes(stepKind)) {
    const e = new Error(`Unknown stepKind: ${stepKind}. Expected one of ${STEP_KINDS.join("/")}.`);
    e.code = "INVALID_STEP"; e.status = 400; throw e;
  }
  // FINAL must be signed (the report goes back to the treating doctor).
  if (stepKind === "FINAL" && (!signedById || !signedBy)) {
    const e = new Error("FINAL micro step must be signed (signedBy + signedById required)");
    e.code = "SIGN_REQUIRED"; e.status = 400; throw e;
  }
  // Once FINAL exists, refuse further appends for the same orderItemId —
  // the report is locked at that point.
  const finalExisting = await MicroResultStep.findOne({ orderItemId, stepKind: "FINAL" }).lean();
  if (finalExisting) {
    const e = new Error("FINAL step already recorded for this order — micro report is locked");
    e.code = "ALREADY_FINAL"; e.status = 409; throw e;
  }

  const row = await MicroResultStep.create({
    orderItemId, labReportId, UHID,
    stepKind, payload,
    performedBy, performedById,
    performedAt: new Date(),
    signedBy:    stepKind === "FINAL" ? signedBy   : "",
    signedById:  stepKind === "FINAL" ? signedById : null,
    signedAt:    stepKind === "FINAL" ? new Date() : null,
  });

  // #134 — SSI auto-surveillance. A positive surgical-site / wound culture in a
  // patient who had surgery within the 90-day SSI window is a surgical-site
  // infection. Fire-and-forget; a surveillance-emit failure never affects the
  // lab result write.
  try { await _maybeEmitSSI({ orderItemId, UHID, stepKind, payload }); }
  catch (e) { console.warn("[microbiologyAppender] SSI auto-emit failed:", e.message); }

  return row.toObject();
}

// Emit an SSI HAI-surveillance row when an ID/SUSCEPTIBILITY step reports an
// organism from a surgical-site/wound specimen AND the UHID has an OT row in
// the last 90 days. Deterministic sourceRef (per orderItemId) so retries no-op.
const _SSI_SPECIMEN_RE = /wound|pus|surgical|surgic|tissue|abscess|incision|drain/i;
async function _maybeEmitSSI({ orderItemId, UHID, stepKind, payload }) {
  if (!UHID) return;
  if (stepKind !== "ID" && stepKind !== "SUSCEPTIBILITY") return;
  const organism = String(payload?.organism || "").trim();
  if (!organism) return;
  const specimen = String(payload?.specimenType || payload?.sampleType || payload?.source || "").trim();
  if (!_SSI_SPECIMEN_RE.test(specimen)) return; // not a surgical-site specimen

  const mongoose = require("mongoose");
  const OTRegister = mongoose.models.OTRegister || require("../../models/Compliance/OTRegisterModel");
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const ot = await OTRegister.findOne({ UHID: String(UHID).toUpperCase(), occurredAt: { $gte: since } })
    .sort({ occurredAt: -1 }).select("admissionId patientId patientName surgeryName occurredAt").lean();
  if (!ot) return; // no recent surgery → not attributable as SSI

  const { emitHAISurveillance } = require("../Compliance/nabhRegisterEmitter");
  await emitHAISurveillance({
    UHID: String(UHID).toUpperCase(),
    patientId: ot.patientId || null,
    patientName: ot.patientName || "",
    admissionId: ot.admissionId || null,
    HAIType: "SSI",
    onsetDate: new Date(),
    cultureSent: true,
    organismIsolated: organism,
    outcome: "",
    status: "Open",
    sourceRef: `SSI:MicroStep:${orderItemId}`,
    autoTriggeredFrom: "microbiologyAppender.ssi",
  });
}

// ── compileSteps ────────────────────────────────────────────────
// Returns every step for an order in chronological order so the lab
// dispatcher (or the LabReport renderer Agent C owns) can assemble a
// final printable report from the timeline.
async function compileSteps(orderItemId) {
  if (!orderItemId) {
    const e = new Error("orderItemId required"); e.code = "ARG_MISSING"; e.status = 400; throw e;
  }
  return await MicroResultStep.find({ orderItemId })
    .sort({ performedAt: 1 })
    .lean();
}

module.exports = {
  appendStep,
  compileSteps,
  STEP_KINDS,
  MicroResultStep,   // exported for tests + read-only callers
};
