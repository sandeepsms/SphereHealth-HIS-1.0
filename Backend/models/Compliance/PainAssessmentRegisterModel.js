/**
 * PainAssessmentRegisterModel.js — R7bp / NABH IPSG.5 + COP.7
 *
 * Pain is the 5th vital sign — NABH requires every IPD patient to have
 * documented pain assessments at admission, q-shift, and after every
 * analgesic intervention. This register is auto-populated every time a
 * nurse saves a NursingAssessment with type="pain".
 *
 * Append-only audit trail; severity (mild/moderate/severe) auto-derived
 * from NRS score (0-10). Severe pain (>=7) flagged for escalation.
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

const PainAssessmentRegisterSchema = new Schema({
  patientId:        { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:             { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName:      { type: String, default: "" },
  admissionId:      { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },

  // ── Pain reading ──
  painScale:        { type: Number, required: true, min: 0, max: 10, index: true },
  severity:         { type: String, enum: ["None", "Mild", "Moderate", "Severe"], required: true, index: true },
  scaleUsed:        { type: String, enum: ["NRS", "FACES", "FLACC", "Verbal"], default: "NRS" },

  // ── Optional clinical context (taken from NursingAssessment.data) ──
  site:             { type: String, default: "" },         // "abdomen", "incision", etc.
  character:        { type: String, default: "" },         // "burning", "throbbing"
  durationMinutes:  { type: Number, default: null },
  intervention:     { type: String, default: "" },         // "Inj Tramadol 50mg given"
  reassessmentDue:  { type: Date, default: null },         // typically +30 min for parenteral, +60 oral

  // ── Trigger metadata ──
  assessedAt:       { type: Date, required: true, index: true },
  assessedBy:       { type: String, default: "" },
  assessedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  assessedByRole:   { type: String, default: "" },

  // ── Source linkage (parent NursingAssessment row) ──
  sourceRef:        { type: Schema.Types.ObjectId, ref: "NursingAssessment", default: null },
  sourceType:       { type: String, default: "NursingAssessment" },

  escalatedFlag:    { type: Boolean, default: false, index: true },

  auditTrail:       { type: [AuditSchema], default: [] },

  hospitalId:       { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "pain_assessment_registers" });

PainAssessmentRegisterSchema.index({ UHID: 1, assessedAt: -1 });
PainAssessmentRegisterSchema.index({ admissionId: 1, assessedAt: -1 });
PainAssessmentRegisterSchema.index({ severity: 1, assessedAt: -1 });

module.exports =
  mongoose.models.PainAssessmentRegister ||
  mongoose.model("PainAssessmentRegister", PainAssessmentRegisterSchema);
