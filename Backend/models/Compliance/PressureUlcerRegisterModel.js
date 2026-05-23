/**
 * PressureUlcerRegisterModel.js — R7bp / NABH HIC.4 + COP.8
 *
 * Pressure-injury surveillance. Auto-populated from nursing assessments
 * with type="pressure-area" (Braden Scale 6-23). Tracks risk tier, existing
 * ulcer stage (NPUAP I-IV / Unstageable / Deep Tissue Injury), location,
 * intervention bundle. Hospital-acquired pressure ulcers (HAPU) are NABH
 * sentinel events when stage III+.
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["CREATED", "REASSESSED", "STAGE_CHANGED", "HEALED"], required: true },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
});

const PressureUlcerRegisterSchema = new Schema({
  patientId:        { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:             { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName:      { type: String, default: "" },
  admissionId:      { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },

  // ── Braden Scale (6-23) ──
  bradenScore:      { type: Number, required: true, min: 6, max: 23, index: true },
  riskTier:         { type: String, enum: ["No Risk", "Mild", "Moderate", "High", "Severe"], required: true, index: true },

  // ── Existing pressure ulcer (if any) ──
  ulcerPresent:     { type: Boolean, default: false },
  ulcerStage:       { type: String, enum: ["", "I", "II", "III", "IV", "Unstageable", "DTI"], default: "" },
  ulcerSite:        { type: String, default: "" },          // sacrum, heel, etc.
  ulcerSize:        { type: String, default: "" },          // "3x2 cm"
  hospitalAcquired: { type: Boolean, default: false, index: true }, // HAPU flag — sentinel if stage III+

  // ── Intervention bundle ──
  repositioningFreq:{ type: String, default: "" },          // "Q2H"
  pressureMattress: { type: Boolean, default: false },
  nutritionConsult: { type: Boolean, default: false },
  dressingType:     { type: String, default: "" },

  // ── Trigger metadata ──
  assessedAt:       { type: Date, required: true, index: true },
  assessedBy:       { type: String, default: "" },
  assessedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  assessedByRole:   { type: String, default: "" },

  sourceRef:        { type: Schema.Types.ObjectId, ref: "NursingAssessment", default: null },
  sourceType:       { type: String, default: "NursingAssessment" },

  sentinelFlag:     { type: Boolean, default: false, index: true }, // true if HAPU stage III+

  auditTrail:       { type: [AuditSchema], default: [] },

  hospitalId:       { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "pressure_ulcer_registers" });

PressureUlcerRegisterSchema.index({ UHID: 1, assessedAt: -1 });
PressureUlcerRegisterSchema.index({ admissionId: 1, assessedAt: -1 });
PressureUlcerRegisterSchema.index({ sentinelFlag: 1, assessedAt: -1 });
PressureUlcerRegisterSchema.index({ hospitalAcquired: 1, assessedAt: -1 });

module.exports =
  mongoose.models.PressureUlcerRegister ||
  mongoose.model("PressureUlcerRegister", PressureUlcerRegisterSchema);
