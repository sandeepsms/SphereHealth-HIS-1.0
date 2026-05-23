/**
 * FallRiskRegisterModel.js — R7bp / NABH PSQ + IPSG.6
 *
 * NABH requires every IPD patient to receive a Morse Fall Scale assessment
 * at admission, q-shift, post-fall, and on condition change. This register
 * is auto-populated every time a nurse saves a NursingAssessment with
 * type="fall-risk". High-risk tier (Morse ≥ 45) triggers intervention bundle.
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["CREATED", "REASSESSED", "ESCALATED"], required: true },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
});

const FallRiskRegisterSchema = new Schema({
  patientId:        { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:             { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName:      { type: String, default: "" },
  admissionId:      { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },

  // ── Morse Fall Scale (0-125) ──
  morseScore:       { type: Number, required: true, min: 0, max: 125, index: true },
  riskTier:         { type: String, enum: ["Low", "Moderate", "High"], required: true, index: true },

  // ── Optional sub-scores (Morse 6 items) ──
  historyOfFalling: { type: Boolean, default: false },
  secondaryDx:      { type: Boolean, default: false },
  ambulatoryAid:    { type: String, default: "" },          // None / Crutches / Walker / Furniture
  ivTherapy:        { type: Boolean, default: false },
  gait:             { type: String, default: "" },          // Normal / Weak / Impaired
  mentalStatus:     { type: String, default: "" },          // Oriented / Forgets

  interventionBundle: { type: String, default: "" },        // text summary of bundle applied

  // ── Trigger metadata ──
  assessedAt:       { type: Date, required: true, index: true },
  assessedBy:       { type: String, default: "" },
  assessedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  assessedByRole:   { type: String, default: "" },

  sourceRef:        { type: Schema.Types.ObjectId, ref: "NursingAssessment", default: null },
  sourceType:       { type: String, default: "NursingAssessment" },

  highRiskFlag:     { type: Boolean, default: false, index: true },

  auditTrail:       { type: [AuditSchema], default: [] },

  hospitalId:       { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "fall_risk_registers" });

FallRiskRegisterSchema.index({ UHID: 1, assessedAt: -1 });
FallRiskRegisterSchema.index({ admissionId: 1, assessedAt: -1 });
FallRiskRegisterSchema.index({ riskTier: 1, assessedAt: -1 });

module.exports =
  mongoose.models.FallRiskRegister ||
  mongoose.model("FallRiskRegister", FallRiskRegisterSchema);
