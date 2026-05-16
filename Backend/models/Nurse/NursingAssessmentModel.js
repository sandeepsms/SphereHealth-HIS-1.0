/**
 * NursingAssessment — generic store for all six nurse-recorded assessments:
 *   daily, fall-risk, pressure-area, pain, nutrition, education
 *
 * Each frontend page POSTs to `/api/nursing-assessments/<type>` with a
 * payload shape unique to that assessment type. We store it as Mixed so
 * we don't have to declare every variant.
 */
const mongoose = require("mongoose");

const NursingAssessmentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ["daily", "fall-risk", "pressure-area", "pain", "nutrition", "education"],
      index: true,
    },
    UHID:        { type: String, index: true },
    patientName: { type: String },
    admissionId: { type: mongoose.Schema.Types.ObjectId, ref: "Admission", index: true },

    // Free-form payload — vitals, scores, notes, signoff. Different per
    // assessment type; Mixed keeps the controller dumb.
    data: { type: mongoose.Schema.Types.Mixed, default: {} },

    recordedBy:     { type: String, default: "" },     // nurse name / employeeId
    recordedByUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    recordedAt:     { type: Date, default: Date.now },
  },
  { timestamps: true },
);

NursingAssessmentSchema.index({ admissionId: 1, type: 1, recordedAt: -1 });
NursingAssessmentSchema.index({ UHID: 1, type: 1, recordedAt: -1 });

module.exports =
  mongoose.models.NursingAssessment ||
  mongoose.model("NursingAssessment", NursingAssessmentSchema);
