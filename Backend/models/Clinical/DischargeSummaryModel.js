// models/Clinical/DischargeSummaryModel.js
// NABH Standard: AAC.5, COP.2 — Discharge Summary

const mongoose = require("mongoose");

const MedicationOnDischargeSchema = new mongoose.Schema(
  {
    medicineName: { type: String, required: true, trim: true },
    dose: { type: String, trim: true },
    route: { type: String, trim: true },
    frequency: { type: String, trim: true },
    duration: { type: String, trim: true },
    remarks: { type: String } },
  { _id: true }
);

const InvestigationSummarySchema = new mongoose.Schema(
  {
    testName: { type: String, trim: true },
    result: { type: String, trim: true },
    date: { type: Date },
    remarks: { type: String } },
  { _id: true }
);

const ProcedureSchema = new mongoose.Schema(
  {
    procedureName: { type: String, trim: true },
    date: { type: Date },
    performedBy: { type: String, trim: true },
    notes: { type: String } },
  { _id: true }
);

const DischargeSummarySchema = new mongoose.Schema(
  {
    // ── Patient & Admission Info ──────────────────────────────
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true },
    UHID: { type: String, required: true, trim: true },
    patientName: { type: String, trim: true },
    age: { type: String },
    gender: { type: String },
    contactNumber: { type: String },

    admissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission" },
    ipdNo: { type: String, index: true },
    admissionDate: { type: Date },
    dischargeDate: { type: Date },

    // ── Treating Team ────────────────────────────────────────
    attendingDoctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor" },
    doctorName: { type: String, trim: true },
    doctorRegNo: { type: String },
    department: { type: String, trim: true },
    consultants: [{ type: String, trim: true }],

    // ── Diagnosis ────────────────────────────────────────────
    admittingDiagnosis: { type: String, trim: true },
    finalDiagnosis: { type: String, trim: true },
    icdCode: { type: String, trim: true },
    comorbidities: [{ type: String, trim: true }],

    // ── Clinical Narrative ───────────────────────────────────
    historyOfPresentIllness: { type: String },
    courseInHospital: { type: String },
    significantFindings: { type: String },

    // ── Investigations ───────────────────────────────────────
    investigationsSummary: [InvestigationSummarySchema],
    // R7hr-200 — free-text investigations paragraph, auto-filled on the
    // discharge page from the patient's recorded lab trends + imaging/path
    // reports (so the doctor doesn't retype). Editable; prints in the summary.
    keyInvestigationsText: { type: String, default: "" },

    // ── Procedures / Surgeries ───────────────────────────────
    proceduresDone: [ProcedureSchema],

    // ── Condition & Discharge ────────────────────────────────
    conditionOnDischarge: {
      type: String,
      enum: ["Stable", "Improved", "Unchanged", "Deteriorated", "Critical", "LAMA", "Expired"],
      default: "Stable" },
    totalDaysAdmitted: { type: Number, default: 0 },
    // FIX (audit P17-B5): NABH required fields that were missing entirely.
    // dischargeType is mandatory per NABH COP.7 — captures the legal mode
    // of departure (Routine, LAMA, DAMA, Absconded, Referral, Death).
    dischargeType: {
      type: String,
      enum: ["Routine", "LAMA", "DAMA", "Absconded", "Referral", "Death"],
      default: "Routine",
    },
    timeOfDischarge: { type: String, trim: true, default: "" },  // free-text "HH:MM"
    // Death-related fields (only used when conditionOnDischarge === "Expired"
    // or dischargeType === "Death")
    deathDate:       { type: Date,   default: null },
    deathTime:       { type: String, trim: true, default: "" },
    causeOfDeath:    { type: String, trim: true, default: "" },
    immediateCauseOfDeath: { type: String, trim: true, default: "" },
    antecedentCauseOfDeath:{ type: String, trim: true, default: "" },
    // Snapshot the active MLR number at finalize-time so historical prints
    // keep the stamp even if MLC is later closed (audit P17-B7).
    mlrNumberSnapshot: { type: String, trim: true, default: "" },

    // ── Discharge Instructions ───────────────────────────────
    medicationsOnDischarge: [MedicationOnDischargeSchema],
    dietAdvice: { type: String },
    activityAdvice: { type: String },
    woundCareInstructions: { type: String },
    specialInstructions: { type: String },
    restrictionsAndPrecautions: { type: String },

    // ── Follow Up ────────────────────────────────────────────
    followUpRequired: { type: Boolean, default: true },
    followUpDate: { type: Date },
    followUpDoctor: { type: String, trim: true },
    followUpDepartment: { type: String, trim: true },
    followUpInstructions: { type: String },

    // ── Emergency Warnings ───────────────────────────────────
    emergencyWarnings: { type: String },

    // ── Status & Workflow ────────────────────────────────────
    status: {
      type: String,
      enum: ["draft", "finalized"],
      default: "draft" },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
    finalizedByName: { type: String },
    finalizedAt: { type: Date },
    // R7bb-FIX-E-4 / D3-CRIT-4: senior co-sign on Junior Resident-
    // authored discharge summaries. Populated by a future endpoint
    // (POST /discharge-summary/:id/cosign — Agent C will wire).
    cosignedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cosignedByName: { type: String, trim: true, default: "" },
    cosignedAt:     { type: Date, default: null },
    // Audit row for any self-finalize WARN — the actor cleared the
    // self-finalize gate without an actual senior co-sign because the
    // attending isn't flagged mustCosign.
    selfFinalizeAck: { type: Boolean, default: false },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },

    // R7bh-F1 / R7bg-7-CRIT-2: PrintAudit infrastructure $incs this on
    // every print/reprint. Pre-R7bh DischargeSummary had no printCount
    // field so the $inc silently no-op'd, and DUPLICATE watermarks
    // never rendered on reprinted discharge documents — breaking the
    // NABH IMS.5 reprint trail.
    printCount: { type: Number, default: 0 } },
  { timestamps: true, collection: "discharge_summaries" }
);

DischargeSummarySchema.index({ UHID: 1, createdAt: -1 });
DischargeSummarySchema.index({ admissionId: 1 });
DischargeSummarySchema.index({ status: 1, createdAt: -1 });

// ── R7az-D2-CRIT-2: schema-level guard against overwriting a finalized
// discharge summary. Once status=finalized the document is a legal
// record (insurance / medico-legal / NABH AAC.5). The only legitimate
// edits at that point are minor amendments via a dedicated
// "createAmendment" path (controller-owned by Agent D). Both
// findOneAndUpdate and findByIdAndUpdate are intercepted here so
// even bypass attempts via the model layer are blocked.
//
// Whitelist: if the caller is explicitly toggling status (e.g.
// finalized → finalized with the same value) or adding metadata fields
// the law allows post-finalize (mlrNumberSnapshot for stamp updates),
// we allow that — anything else is refused.
const FINALIZED_WHITELIST = new Set(["mlrNumberSnapshot"]);
async function _refuseIfFinalized(next) {
  try {
    const query = this.getQuery();
    const update = this.getUpdate() || {};
    // Look up the target doc's current status.
    const doc = await this.model.findOne(query).select("status").lean();
    if (!doc || doc.status !== "finalized") return next();

    // Allow no-op writes that only touch whitelisted fields.
    const setKeys = Object.keys((update.$set) || {}).concat(
      Object.keys(update).filter((k) => !k.startsWith("$")),
    );
    if (setKeys.length && setKeys.every((k) => FINALIZED_WHITELIST.has(k))) return next();

    return next(new Error(
      `Discharge summary ${doc._id || query._id} is finalized — refusing overwrite. ` +
      `Create an amendment via the dedicated controller path instead (NABH AAC.5).`,
    ));
  } catch (e) {
    return next(e);
  }
}
DischargeSummarySchema.pre("findOneAndUpdate", _refuseIfFinalized);
DischargeSummarySchema.pre("findByIdAndUpdate", _refuseIfFinalized);
DischargeSummarySchema.pre("updateOne",         _refuseIfFinalized);

// R7bf-I / A7-HIGH-10 — DischargeSummary state-machine guard.
// In-codebase status enum is lowercase `["draft", "finalized"]`. The
// existing _refuseIfFinalized middleware already blocks every direct
// findOneAndUpdate / findByIdAndUpdate / updateOne; we add the same
// constraint on direct doc.save() paths via the shared registry. A
// "correction" route that wants to flip finalized → draft must:
//   1. Set doc.__forceTransition = true AND doc.__forceAdminUserId =
//      <Admin User._id> on the in-memory instance, AND
//   2. Provide a non-empty correctionReason field (validated below)
//      before save. Both gates are belt-and-braces — the route handler
//      should also emit an audit row.
const { attachStatusGuard: _dsGuard } = require("../../utils/statusTransitionGuard");
_dsGuard(DischargeSummarySchema, { modelName: "DischargeSummary", field: "status" });

// Require a non-empty correction reason on every finalized → draft flip
// even when the admin force flag is set, so the audit row downstream
// has the operator-supplied "why" attached.
DischargeSummarySchema.pre("save", function (next) {
  if (this.isNew) return next();
  const prior = this.__prior_status;
  if (prior === "finalized" && this.status === "draft") {
    if (!this.__correctionReason || String(this.__correctionReason).trim().length < 5) {
      const err = new Error(
        "Cannot revert discharge summary to draft — set doc.__correctionReason " +
        "(≥ 5 chars) describing why the correction is needed. NABH AAC.5 requires " +
        "a documented rationale on every post-finalize edit.",
      );
      err.code = "MISSING_CORRECTION_REASON";
      err.statusCode = 422;
      err.status = 422;
      return next(err);
    }
  }
  next();
});

module.exports =
  mongoose.models.DischargeSummary ||
  mongoose.model("DischargeSummary", DischargeSummarySchema);
