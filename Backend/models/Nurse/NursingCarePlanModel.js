// models/Nurse/NursingCarePlanModel.js
// NABH Standard: COP.1 — Individualized Nursing Care Plan

const mongoose = require("mongoose");

const NursingInterventionSchema = new mongoose.Schema(
  {
    intervention: { type: String, required: true, trim: true },
    frequency: { type: String, trim: true },
    responsible: { type: String, trim: true },
    done: { type: Boolean, default: false },
    remarks: { type: String } },
  { _id: true }
);

const NursingProblemSchema = new mongoose.Schema(
  {
    problemStatement: { type: String, required: true, trim: true },
    relatedTo: { type: String, trim: true },
    evidencedBy: { type: String, trim: true },
    priority: {
      type: String,
      enum: ["HIGH", "MEDIUM", "LOW"],
      default: "MEDIUM" },
    shortTermGoal: { type: String, trim: true },
    longTermGoal: { type: String, trim: true },
    interventions: [NursingInterventionSchema],
    evaluation: { type: String },
    status: {
      type: String,
      enum: ["ACTIVE", "RESOLVED", "ON_HOLD"],
      default: "ACTIVE" },
    resolvedAt: { type: Date } },
  { _id: true }
);

const NursingCarePlanSchema = new mongoose.Schema(
  {
    // ── Patient & Admission ──────────────────────────────────
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true },
    UHID: { type: String, required: true, trim: true },
    patientName: { type: String, trim: true },
    age: { type: String },
    gender: { type: String },
    admissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission" },
    ipdNo: { type: String, required: true },

    // ── Nursing Team ─────────────────────────────────────────
    primaryNurse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NurseStaff" },
    nurseName: { type: String, trim: true },
    attendingDoctor: { type: String, trim: true },
    department: { type: String, trim: true },

    // ── Admission Assessment ─────────────────────────────────
    assessmentDate: { type: Date, default: Date.now },
    admissionAssessment: {
      consciousnessLevel: {
        type: String,
        enum: ["Alert", "Drowsy", "Confused", "Unconscious", "Sedated"],
        default: "Alert" },
      mobility: {
        type: String,
        enum: ["Independent", "Assisted", "Dependent", "Bedridden"],
        default: "Independent" },
      nutritionStatus: {
        type: String,
        enum: ["Good", "Fair", "Poor", "On NGT", "On TPN"],
        default: "Good" },
      eliminationPattern: {
        type: String,
        enum: ["Normal", "Constipation", "Diarrhea", "Catheterized", "Colostomy"],
        default: "Normal" },
      selfCareAbility: {
        type: String,
        enum: ["Full", "Partial", "Dependent"],
        default: "Full" },
      painPresent: { type: Boolean, default: false },
      painScore: { type: Number, min: 0, max: 10, default: 0 },
      skinCondition: {
        type: String,
        enum: ["Intact", "Wound", "Rash", "Pressure Ulcer", "Edema"],
        default: "Intact" },
      fallRisk: {
        type: String,
        enum: ["Low", "Medium", "High"],
        default: "Low" },
      pressureUlcerRisk: {
        type: String,
        enum: ["Low", "Medium", "High"],
        default: "Low" },
      ivAccess: { type: Boolean, default: false },
      urinaryCatheter: { type: Boolean, default: false },
      nasogastricTube: { type: Boolean, default: false },
      oxygenSupport: { type: Boolean, default: false },
      oxygenFlowRate: { type: String },
      additionalNotes: { type: String } },

    // ── Nursing Problems & Interventions ─────────────────────
    nursingProblems: [NursingProblemSchema],

    // ── Patient Education ────────────────────────────────────
    educationNeedsAssessed: { type: Boolean, default: false },
    educationTopics: [{ type: String, trim: true }],
    educationBarriers: { type: String },

    // ── Discharge Planning ───────────────────────────────────
    dischargeGoals: { type: String },
    expectedDischargeDate: { type: Date },

    // ── Status ───────────────────────────────────────────────
    status: {
      type: String,
      enum: ["ACTIVE", "COMPLETED", "DISCONTINUED"],
      default: "ACTIVE" },
    reviewDate: { type: Date },
    completedAt: { type: Date },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "NurseStaff" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "NurseStaff" } },
  { timestamps: true, collection: "nursing_care_plans" }
);

NursingCarePlanSchema.index({ UHID: 1, createdAt: -1 });
NursingCarePlanSchema.index({ ipdNo: 1 });
NursingCarePlanSchema.index({ admissionId: 1 });
NursingCarePlanSchema.index({ status: 1 });

module.exports =
  mongoose.models.NursingCarePlan ||
  mongoose.model("NursingCarePlan", NursingCarePlanSchema);
