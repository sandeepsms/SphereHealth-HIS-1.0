// models/Nurse/NursingAssessmentPlanModel.js
// ════════════════════════════════════════════════════════════════════
// R7hr-231 — Doctor-set plan of which nursing assessments must be done for an
// admission, and the MINIMUM number of times per day. The nurse sees the
// assigned assessments as required duties (with today's done-count) plus an
// "Extra Note" dropdown for ad-hoc assessments. SOFT guidance — no hard block.
// One plan per admission (upserted by the service).
// ════════════════════════════════════════════════════════════════════
const mongoose = require("mongoose");

const PlanItemSchema = new mongoose.Schema({
  type:      { type: String, required: true },             // nursing noteType id (vitals/pain/neuro/…)
  label:     { type: String, default: "" },                // display-label snapshot
  perDayMin: { type: Number, default: 1, min: 0, max: 96 },// minimum times per calendar day
}, { _id: false });

const NursingAssessmentPlanSchema = new mongoose.Schema({
  admissionId:    { type: mongoose.Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
  UHID:           { type: String, default: "", index: true },
  ipdNo:          { type: String, default: "" },
  items:          { type: [PlanItemSchema], default: [] },
  assignedBy:     { type: String, default: "" },   // doctor userId
  assignedByName: { type: String, default: "" },
}, { timestamps: true });

module.exports = mongoose.model("NursingAssessmentPlan", NursingAssessmentPlanSchema);
