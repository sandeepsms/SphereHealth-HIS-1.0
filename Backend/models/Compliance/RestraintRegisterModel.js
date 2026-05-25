/**
 * RestraintRegisterModel.js — R7bu / NABH COP.17
 *
 * Physical and chemical restraint register. One row per restraint
 * episode. Auto-populated by nabhRegisterEmitter.emitRestraint when a
 * restraint entry is recorded — typically from a nurse note flagged as
 * "restraint", a doctor order with restraintType set, or (in future) a
 * dedicated restraint module.
 *
 * NABH COP.17 surveyors require:
 *   - written order from a treating doctor (no nurse-initiated restraints);
 *   - documented reason (safety / medical / behavioural);
 *   - monitoring frequency (q15 / q30 / q60 min based on type);
 *   - clear removal time + removing person.
 *
 * NOTE: No restraint UI exists in the codebase today — this model + the
 * emitter helper are scaffolded for the future restraint module. The
 * `emitRestraint` helper is callable RIGHT NOW from any caller (nurse
 * note save, doctor order save) that wants to log a restraint episode.
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: {
    type: String,
    enum: ["ORDERED", "APPLIED", "MONITORED", "EXTENDED", "REMOVED", "REASSESSED", "AMENDED"],
    required: true,
  },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "", maxlength: 500 },
});

const MonitoringEntrySchema = new Schema({
  _id: false,
  at:       { type: Date, default: Date.now },
  status:   { type: String, default: "" },         // skin intact / circulation OK / agitated
  byName:   { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes:    { type: String, default: "" },
});

const RestraintRegisterSchema = new Schema({
  // ── Patient / admission ──
  patientId:   { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:        { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName: { type: String, default: "" },
  age:         { type: Number, default: null },
  sex:         { type: String, default: "" },
  admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
  admissionNumber: { type: String, default: "" },

  // ── Restraint classification (NABH COP.17) ──
  restraintType: {
    type: String,
    enum: ["physical", "chemical", "both"],
    required: true,
    index: true,
  },
  restraintDevice: {
    type: [String],
    default: [],
  },                                              // wrist-strap / ankle-strap / vest / bed-rail / mitten
  chemicalAgent: { type: String, default: "" },   // e.g. "Inj Haloperidol 5mg IM"

  // ── Indication ──
  reason: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
  },                                              // free-text indication
  reasonCategory: {
    type: String,
    enum: ["", "Safety", "Medical", "Behavioural", "PostOp", "Procedural"],
    default: "",
    index: true,
  },

  // ── Timing ──
  startTime: { type: Date, required: true, index: true },
  endTime:   { type: Date, default: null, index: true },
  durationMinutes: { type: Number, default: null },

  // ── Monitoring (NABH COP.17 — q15 for chemical, q30 for physical) ──
  monitoringFrequency: {
    type: String,
    enum: ["q15min", "q30min", "q1h", "q2h", "Other"],
    default: "q30min",
  },
  monitoringLog: { type: [MonitoringEntrySchema], default: [] },
  reassessmentDue: { type: Date, default: null },

  // ── Ordering doctor (NABH requires a written doctor order) ──
  orderingDoctor:    { type: String, required: true, default: "" },
  orderingDoctorId:  { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  orderingDoctorRole: { type: String, default: "" },
  doctorOrderId:     { type: Schema.Types.ObjectId, ref: "DoctorOrder", default: null, index: true },

  // ── Application / removal ──
  appliedBy:     { type: String, default: "" },
  appliedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  removedAt:     { type: Date, default: null },
  removedBy:     { type: String, default: "" },
  removedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  removalReason: { type: String, default: "" },     // no longer needed / condition resolved

  // ── Consent (where capacity exists) ──
  consentObtained: { type: Boolean, default: false },
  consentFrom:     { type: String, default: "" },   // patient / next-of-kin
  consentFormId:   { type: Schema.Types.ObjectId, default: null },

  // ── Adverse events ──
  adverseEvent:      { type: Boolean, default: false },
  adverseEventNotes: { type: String, default: "" },     // skin breakdown / circulation impairment

  // ── Status ──
  status: {
    type: String,
    enum: ["Active", "Removed", "Expired"],
    default: "Active",
    index: true,
  },

  // ── Source linkage / audit ──
  sourceRef:  { type: Schema.Types.ObjectId, default: null },
  sourceType: { type: String, default: "DoctorOrder" },     // DoctorOrder / NurseNote / Restraint
  occurredAt: { type: Date, default: Date.now, index: true },
  auditTrail: { type: [AuditSchema], default: [] },

  createdBy:     { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdByName: { type: String, default: "" },
  createdByRole: { type: String, default: "" },

  hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "restraint_registers" });

// Surveyor + workflow indexes
RestraintRegisterSchema.index({ UHID: 1, admissionId: 1 });
RestraintRegisterSchema.index({ UHID: 1, occurredAt: -1 });
RestraintRegisterSchema.index({ admissionId: 1, occurredAt: -1 });
RestraintRegisterSchema.index({ status: 1, startTime: -1 });
RestraintRegisterSchema.index({ restraintType: 1, startTime: -1 });
RestraintRegisterSchema.index({ orderingDoctorId: 1, occurredAt: -1 });

module.exports =
  mongoose.models.RestraintRegister ||
  mongoose.model("RestraintRegister", RestraintRegisterSchema);
