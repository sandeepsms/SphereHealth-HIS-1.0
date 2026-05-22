/**
 * ADRReportModel.js  (R7bf-G / A5-CRIT-4 / NABH MOM.7)
 *
 * Adverse Drug Reaction (ADR) reporting register. NABH MOM.7 + the
 * national Pharmacovigilance Programme of India (PvPI) require every
 * hospital pharmacy / treating clinician to:
 *   1. Capture suspected reactions in a structured register
 *   2. Classify severity (MILD / MODERATE / SEVERE / LIFE_THREATENING / FATAL)
 *   3. Record dechallenge / rechallenge outcomes
 *   4. Submit the suspected case to PvPI within statutory timelines
 *
 * Pre-R7bf there was no ADR collection at all. This model + its
 * service-controller-route quartet shaped after the pharmacy stock-take
 * pattern ship the minimum register to close A5-CRIT-4.
 *
 * Lifecycle: DRAFT → SUBMITTED → PVPI_FILED
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

const ADRAuditSchema = new Schema(
  {
    _id:      false,
    action:   { type: String, enum: ["CREATED", "UPDATED", "SUBMITTED", "PVPI_FILED", "REOPENED"], required: true },
    at:       { type: Date, default: Date.now },
    byName:   { type: String, default: "" },
    byRole:   { type: String, default: "" },
    byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reason:   { type: String, default: "" },
  },
);

const ADRReportSchema = new Schema(
  {
    // ── Patient ───────────────────────────────────────────────
    patientUHID: { type: String, required: true, trim: true, uppercase: true, index: true },
    patientName: { type: String, trim: true, default: "" },

    // ── Suspected drug ────────────────────────────────────────
    // Soft ref to the pharmacy drug master — keep `drugName` as a
    // fallback string so a report can be filed even if the master
    // entry is later deleted / merged.
    suspectedDrug:     { type: Schema.Types.ObjectId, ref: "PharmacyDrug", default: null },
    suspectedDrugName: { type: String, trim: true, default: "" },
    suspectedDrugDose: { type: String, trim: true, default: "" },
    suspectedRoute:    { type: String, trim: true, default: "" }, // PO / IV / IM / etc.

    // Concomitant medications — free-text list; future cycle can
    // upgrade to soft refs once the drug master is stabilised.
    concomitantDrugs: [{ type: String, trim: true }],

    // ── Reaction ──────────────────────────────────────────────
    reactionDescription: { type: String, required: true, trim: true },
    onsetDate: { type: Date, default: null },
    severity: {
      type: String,
      enum: ["MILD", "MODERATE", "SEVERE", "LIFE_THREATENING", "FATAL"],
      required: true,
      index: true,
    },

    // WHO causality: Certain / Probable / Possible / Unlikely / Unrelated
    causality: {
      type: String,
      enum: ["CERTAIN", "PROBABLE", "POSSIBLE", "UNLIKELY", "UNRELATED", "UNASSESSABLE"],
      default: "POSSIBLE",
    },

    // Dechallenge — what happened when the drug was withdrawn?
    // Rechallenge — what happened when the drug was re-administered?
    dechallenge: {
      type: String,
      enum: ["NOT_DONE", "POSITIVE", "NEGATIVE", "UNKNOWN"],
      default: "NOT_DONE",
    },
    rechallenge: {
      type: String,
      enum: ["NOT_DONE", "POSITIVE", "NEGATIVE", "UNKNOWN"],
      default: "NOT_DONE",
    },

    // Action taken — free-text capture (drug withdrawn, dose reduced, etc.)
    actionTaken: { type: String, trim: true, default: "" },

    // Outcome — patient state at last follow-up
    outcome: {
      type: String,
      enum: ["RECOVERED", "RECOVERING", "NOT_RECOVERED", "FATAL", "UNKNOWN"],
      default: "UNKNOWN",
    },

    // ── Reporter ──────────────────────────────────────────────
    reportedBy:     { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reportedByName: { type: String, trim: true, default: "" },
    reportedByRole: { type: String, trim: true, default: "" },

    // ── PvPI Submission ───────────────────────────────────────
    // R7bn — added PVPI_FAILED so a transport failure during submission
    // doesn't get optimistically flipped to PVPI_FILED with a null
    // reference (which previously poisoned the audit trail — pre-R7bn
    // the controller flipped status before checking submitter result).
    status: {
      type: String,
      enum: ["DRAFT", "SUBMITTED", "PVPI_FILED", "PVPI_FAILED"],
      default: "DRAFT",
      index: true,
    },
    submittedAt:        { type: Date, default: null },
    pvpiReferenceNumber:{ type: String, trim: true, default: "" },
    pvpiFiledAt:        { type: Date, default: null },
    pvpiFiledBy:        { type: Schema.Types.ObjectId, ref: "User", default: null },
    pvpiFiledByName:    { type: String, trim: true, default: "" },
    // R7bn — observability for the submitter retry/backoff loop.
    pvpiAttemptCount:     { type: Number, default: 0 },
    pvpiLastAttemptedAt:  { type: Date, default: null },
    pvpiLastErrorMessage: { type: String, default: "" },
    pvpiLastErrorCode:    { type: String, default: "" },
    pvpiSubmissionAttemptedAt: { type: Date, default: null },

    // ── Attachments ───────────────────────────────────────────
    // Document URLs — uploads are owned by a separate service in a
    // future cycle. For now this is a simple URL list.
    attachments: [{
      _id:        false,
      label:      { type: String, default: "" },
      url:        { type: String, required: true, trim: true },
      uploadedAt: { type: Date, default: Date.now },
      uploadedBy: { type: String, default: "" },
    }],

    notes: { type: String, default: "" },

    auditTrail: { type: [ADRAuditSchema], default: [] },

    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "adr_reports" },
);

// Common query patterns: by-patient drill-down, severity filter, status queue.
ADRReportSchema.index({ patientUHID: 1, createdAt: -1 });
ADRReportSchema.index({ status: 1, createdAt: -1 });
ADRReportSchema.index({ severity: 1, createdAt: -1 });

module.exports =
  mongoose.models.ADRReport || mongoose.model("ADRReport", ADRReportSchema);
