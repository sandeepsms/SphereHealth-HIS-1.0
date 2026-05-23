/**
 * DVTRegisterModel.js — R7bq / NABH MOM.7 + AAC.4 + COP.12/16
 *
 * VTE (Deep Vein Thrombosis) risk-assessment register. Auto-populated
 * every time a nurse saves a NursingAssessment with type="dvt". Backs the
 * Caprini VTE risk score (2010 form) paired with the IMPROVE bleeding
 * risk score, surveyor-ready chronological log of:
 *
 *   - Caprini total (0–50) with tier (Very Low / Low / Moderate / High /
 *     Highest) auto-derived per 2010 form
 *   - IMPROVE bleed total (0–32.5) with tier (Low / High) for safety gating
 *   - Recommended prophylaxis (Ambulate / Mechanical / Pharmacological /
 *     Mechanical-only-with-reassessment) based on Caprini × IMPROVE matrix
 *   - Contraindications (free-list): active bleed, severe thrombocytopenia,
 *     known HIT, neuraxial-block timing window, etc.
 *   - Factor breakdown — which weighted factors fired (audit-grade)
 *   - Escalation flag when Caprini ≥5 (treating doctor notification)
 *
 * NABH surveyors expect a chronological register tying each high-risk
 * patient to a prophylaxis order or a contraindication note. The append-
 * only auditTrail logs CREATED / REASSESSED / ESCALATED / PROPHYLAXIS_SET.
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["CREATED", "REASSESSED", "ESCALATED", "PROPHYLAXIS_SET", "CONTRAINDICATED"], required: true },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "", maxlength: 500 },
});

const DVTRegisterSchema = new Schema({
  patientId:        { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:             { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName:      { type: String, default: "" },
  admissionId:      { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },

  // ── Caprini VTE Risk (2010 form) ──
  capriniScore:     { type: Number, required: true, min: 0, max: 50, index: true },
  capriniTier:      {
    type: String,
    enum: ["Very Low", "Low", "Moderate", "High", "Highest"],
    required: true,
    index: true,
  },

  // ── IMPROVE Bleed Risk (gates pharmacological prophylaxis safety) ──
  improveScore:     { type: Number, default: null, min: 0, max: 50 },
  improveTier:      { type: String, enum: ["", "Low", "High"], default: "" },
  bleedingRiskFlag: { type: Boolean, default: false, index: true },

  // ── Factor breakdown (audit-grade — which weighted factors fired) ──
  // Each entry: { code, label, points } so surveyors can verify the sum.
  factorBreakdown:  [{
    _id: false,
    code:   { type: String, required: true },          // e.g. "AGE_61_74"
    label:  { type: String, required: true },          // human-readable
    points: { type: Number, required: true, min: 0, max: 10 },
  }],

  // ── Prophylaxis recommendation (auto-derived from Caprini × IMPROVE) ──
  recommendedProphylaxis: {
    type: String,
    enum: ["Ambulation", "Mechanical", "Pharmacological", "Combined", "Mechanical-only-reassess"],
    required: true,
  },
  recommendedAgent: { type: String, default: "" },     // e.g. "Enoxaparin 40 mg SC OD"
  recommendedDuration: { type: String, default: "" }, // e.g. "Until discharge" / "28-35 days post-op"

  // ── Contraindications (free-list, gated against pharmacological) ──
  contraindications: { type: [String], default: [] },
  contraindicationNotes: { type: String, default: "", maxlength: 1000 },

  // ── Prophylaxis ordered? (back-fillable when doctor places the order) ──
  prophylaxisOrdered: { type: Boolean, default: false },
  prophylaxisOrderRef: { type: Schema.Types.ObjectId, ref: "DoctorOrder", default: null },
  prophylaxisOrderedAt: { type: Date, default: null },

  // ── Escalation (NABH MOM.7) ──
  // Caprini ≥5 = high-risk → treating doctor must respond with a
  // prophylaxis order or a contraindication note within the SLA.
  escalatedFlag:    { type: Boolean, default: false, index: true },
  escalationStatus: {
    type: String,
    enum: ["", "PENDING", "ADDRESSED", "OVERDUE"],
    default: "",
  },
  escalationSlaMinutes: { type: Number, default: 60 },  // doctor-response SLA
  escalatedToUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  escalationAddressedAt: { type: Date, default: null },

  // ── Reassessment cadence (NABH AAC.5) ──
  reassessmentTrigger: {
    type: String,
    enum: ["", "Admission", "Q-Shift", "Condition-Change", "Post-Op", "Bleeding-Event", "Pre-Discharge"],
    default: "",
  },
  reassessmentDue:  { type: Date, default: null },

  // ── Trigger metadata (auto from nursing assessment save) ──
  assessedAt:       { type: Date, required: true, index: true },
  assessedBy:       { type: String, default: "" },
  assessedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  assessedByRole:   { type: String, default: "" },

  sourceRef:        { type: Schema.Types.ObjectId, ref: "NursingAssessment", default: null },
  sourceType:       { type: String, default: "NursingAssessment" },

  auditTrail:       { type: [AuditSchema], default: [] },

  hospitalId:       { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "dvt_registers" });

// Surveyor-inspection + escalation indexes
DVTRegisterSchema.index({ UHID: 1, assessedAt: -1 });
DVTRegisterSchema.index({ admissionId: 1, assessedAt: -1 });
DVTRegisterSchema.index({ capriniTier: 1, assessedAt: -1 });
DVTRegisterSchema.index({ escalatedFlag: 1, escalationStatus: 1, assessedAt: -1 });
DVTRegisterSchema.index({ bleedingRiskFlag: 1, assessedAt: -1 });

module.exports =
  mongoose.models.DVTRegister ||
  mongoose.model("DVTRegister", DVTRegisterSchema);
