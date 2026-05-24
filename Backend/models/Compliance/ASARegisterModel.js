/**
 * ASARegisterModel.js — R7bu / NABH COP.13
 *
 * Anaesthesia register. One row per anaesthesia event (pre-op or
 * intra-procedure). Auto-populated by nabhRegisterEmitter.emitASA on:
 *
 *   (a) pre-op note save (Draft row with ASA grade, planned technique,
 *       allergies, fasting status);
 *   (b) procedure note save (Completed row with drugs administered,
 *       recovery time, complications).
 *
 * NABH COP.13 surveyors require pre-anaesthesia evaluation, ASA grade,
 * informed consent, monitoring chart, post-anaesthesia recovery score
 * (Aldrete). This register links every anaesthesia event to a named
 * anaesthetist with a chronological audit trail.
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: {
    type: String,
    enum: ["PRE_OP_CREATED", "INDUCED", "MAINTAINED", "REVERSED", "RECOVERED", "AMENDED", "LOCKED"],
    required: true,
  },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "", maxlength: 500 },
});

const DrugSchema = new Schema({
  _id: false,
  name:  { type: String, required: true, trim: true },
  dose:  { type: String, default: "" },          // "100 mg", "2 mcg/kg"
  route: { type: String, default: "" },          // IV / IM / Inhalation / Epidural
  time:  { type: Date, default: null },
  notes: { type: String, default: "" },
});

const ASARegisterSchema = new Schema({
  // ── Patient / admission ──
  patientId:   { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:        { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName: { type: String, default: "" },
  age:         { type: Number, default: null },
  sex:         { type: String, default: "" },
  admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
  admissionNumber: { type: String, default: "" },

  // ── ASA classification ──
  // I  = Healthy
  // II = Mild systemic disease
  // III= Severe systemic disease
  // IV = Severe systemic disease constant threat to life
  // V  = Moribund, not expected to survive without operation
  // VI = Declared brain-dead organ donor
  asaGrade: {
    type: String,
    enum: ["I", "II", "III", "IV", "V", "VI"],
    required: true,
    index: true,
  },
  emergencyModifier: { type: Boolean, default: false },   // "E" suffix

  // ── Anaesthesia plan ──
  anaesthesiaType: {
    type: String,
    enum: ["General", "Spinal", "Epidural", "Regional", "Local", "MAC", "Sedation", "Combined"],
    required: true,
    index: true,
  },
  technique:        { type: String, default: "" },        // RSI / awake fiberoptic / TIVA
  airwayPlan:       { type: String, default: "" },        // ETT / LMA / mask / nasal

  // ── Care team ──
  anaesthetistName: { type: String, default: "" },
  anaesthetistId:   { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  assistantName:    { type: String, default: "" },

  // ── Pre-op assessment (NABH COP.13.a) ──
  fastingHours:     { type: Number, default: null },
  allergies:        { type: [String], default: [] },
  comorbidities:    { type: [String], default: [] },      // DM / HTN / IHD etc.
  preOpVitals: {
    bp:    { type: String, default: "" },
    pulse: { type: Number, default: null },
    temp:  { type: Number, default: null },
    spo2:  { type: Number, default: null },
  },
  consentSigned:    { type: Boolean, default: false },
  consentFormId:    { type: Schema.Types.ObjectId, default: null },

  // ── Intra-op ──
  drugs:            { type: [DrugSchema], default: [] },
  inductionAt:      { type: Date, default: null },
  reversalAt:       { type: Date, default: null },

  // ── Recovery (NABH COP.13.c) ──
  recoveryTimeMinutes: { type: Number, default: null },   // induction → fit for ward
  aldreteScore:        { type: Number, default: null, min: 0, max: 10 },
  postOpVitals: {
    bp:    { type: String, default: "" },
    pulse: { type: Number, default: null },
    temp:  { type: Number, default: null },
    spo2:  { type: Number, default: null },
  },

  // ── Complications ──
  complications:    { type: String, default: "" },        // free-text
  intraOpAdverseEvents: { type: [String], default: [] },  // hypotension / desat / bronchospasm

  // ── Linkage ──
  otRegisterId:     { type: Schema.Types.ObjectId, ref: "OTRegister", default: null, index: true },
  preOpNoteId:      { type: Schema.Types.ObjectId, default: null },
  procedureNoteId:  { type: Schema.Types.ObjectId, default: null },
  sourceRef:        { type: Schema.Types.ObjectId, default: null },
  sourceType:       { type: String, default: "PreOpNote" },

  // ── Status / audit ──
  status: {
    type: String,
    enum: ["PreOp", "InProgress", "Recovered", "Cancelled"],
    default: "PreOp",
    index: true,
  },
  occurredAt: { type: Date, default: Date.now, index: true },
  locked:     { type: Boolean, default: false },
  lockedAt:   { type: Date, default: null },
  auditTrail: { type: [AuditSchema], default: [] },

  createdBy:     { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdByName: { type: String, default: "" },
  createdByRole: { type: String, default: "" },

  hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "asa_registers" });

// Surveyor + workflow indexes
ASARegisterSchema.index({ UHID: 1, admissionId: 1 });
ASARegisterSchema.index({ UHID: 1, occurredAt: -1 });
ASARegisterSchema.index({ admissionId: 1, occurredAt: -1 });
ASARegisterSchema.index({ asaGrade: 1, occurredAt: -1 });
ASARegisterSchema.index({ anaesthesiaType: 1, occurredAt: -1 });

module.exports =
  mongoose.models.ASARegister ||
  mongoose.model("ASARegister", ASARegisterSchema);
