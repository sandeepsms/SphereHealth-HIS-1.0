// models/Compliance/AssessmentComplianceModel.js
// ════════════════════════════════════════════════════════════════════
// R7bn-5 / D6-fix: AssessmentCompliance — per-admission, per-type
// schedule tracker for twice-daily clinical assessments.
//
// User requirement: "all types of assessment must be filled twice a
// day by both doctor and nurse" — vitals, neuro, pain, MEWS, Morse,
// Caprini DVT, pressure-area, intake/output, daily nursing,
// doctor progress.
//
// One row per (admissionId, assessmentType, role). Each assessment-
// save updates `lastAssessedAt` and recomputes `nextDueAt` =
// lastAssessedAt + cadenceHours. A cron sweeper flips `status` to
// OVERDUE when nextDueAt < now, so the frontend can render red
// badges.
//
// Why a separate collection vs embedding on admission:
//   - Cron can scan ALL active admissions in one indexed query.
//   - Frontend reads only the types it cares about per page.
//   - Doesn't bloat the admission doc (4-10 rows × N admissions
//     fits Mongo single-doc limits but reads on bed-view are
//     hot enough that we don't want extra Mixed fields on it).
// ════════════════════════════════════════════════════════════════════
const mongoose = require("mongoose");

const ASSESSMENT_TYPES = [
  "vitals",
  "neuro",
  "pain",
  "mews",
  "morse-fall",
  "caprini-dvt",
  "pressure-area",
  "intake-output",
  "daily-nursing",
  "doctor-progress",
];

const AssessmentComplianceSchema = new mongoose.Schema(
  {
    admissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IPDAdmission",
      required: true,
      index: true,
    },
    UHID: { type: String, default: "", index: true },
    patientName: { type: String, default: "" },

    assessmentType: { type: String, enum: ASSESSMENT_TYPES, required: true, index: true },
    // Some assessments are nurse-only (vitals, MEWS, Morse) — role lets
    // us track doctor + nurse separately for those that are dual.
    role: { type: String, enum: ["nurse", "doctor"], required: true },

    lastAssessedAt: { type: Date, default: null },
    lastAssessedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      name:   { type: String, default: "" },
    },

    // R7bn — cadenceHours defaults to 12 (twice-daily). Set higher
    // per-type if a particular assessment is daily-only.
    cadenceHours: { type: Number, default: 12, min: 1, max: 168 },

    nextDueAt: { type: Date, default: null, index: true },
    status: {
      type: String,
      enum: ["NOT_DUE_YET", "DUE_SOON", "OVERDUE", "DONE_THIS_WINDOW"],
      default: "NOT_DUE_YET",
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "assessment_compliance",
  },
);

// Unique per (admission, type, role) — recordAssessment upserts.
AssessmentComplianceSchema.index(
  { admissionId: 1, assessmentType: 1, role: 1 },
  { unique: true },
);
// Cron sweeper query: find rows where nextDueAt is in the past and
// status isn't already OVERDUE.
AssessmentComplianceSchema.index({ nextDueAt: 1, status: 1 });

module.exports =
  mongoose.models.AssessmentCompliance ||
  mongoose.model("AssessmentCompliance", AssessmentComplianceSchema);
module.exports.ASSESSMENT_TYPES = ASSESSMENT_TYPES;
