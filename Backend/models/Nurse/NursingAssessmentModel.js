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
      enum: ["daily", "fall-risk", "pressure-area", "pain", "nutrition", "education", "dvt"],
      index: true,
    },
    UHID:        { type: String, index: true },
    patientName: { type: String },
    admissionId: { type: mongoose.Schema.Types.ObjectId, ref: "Admission", index: true },

    // Free-form payload — vitals, scores, notes, signoff. Different per
    // assessment type; Mixed keeps the controller dumb.
    //
    // R7az-D2-MED-1: per-type bounds validator. Pain ≤ 10 on NRS, fall-risk
    // Morse-style 0–125, pressure-area Braden 6–23. Wide enough to admit
    // every clinical scale we ship today; narrow enough to catch a
    // copy-paste fat-finger that would otherwise propagate to the chart.
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      validate: {
        validator: function (val) {
          if (val == null || typeof val !== "object") return true;
          const type = this.type;
          const checks = {
            pain:           { painScale: [0, 10] },
            "fall-risk":    { morseScore: [0, 125] },
            "pressure-area":{ bradenScore: [6, 23] },
            nutrition:      { mustScore: [0, 10] },
            // R7bq — Caprini VTE risk score (sum of weighted factors).
            // Theoretical max ~40 in 2010 form; cap at 50 for safety margin.
            // IMPROVE bleed score paired (max ~32). Both gate prophylaxis
            // recommendation per NABH MOM.7 / AAC.4.
            dvt:            { capriniScore: [0, 50], improveScore: [0, 50] },
          };
          const rules = checks[type] || {};
          for (const [k, [lo, hi]] of Object.entries(rules)) {
            const v = val[k];
            if (v == null || v === "") continue;
            const n = Number(v);
            if (!Number.isFinite(n) || n < lo || n > hi) return false;
          }
          return true;
        },
        message: (props) => `NursingAssessment.data violates the per-type bounds for the chosen assessment type`,
      },
    },

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
