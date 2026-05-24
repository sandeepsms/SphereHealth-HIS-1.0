/**
 * ReadmissionRegisterModel.js — R7bu / NABH COP.16
 *
 * 30-day readmission tracking. Auto-populated by
 * nabhRegisterEmitter.emitReadmission when a NEW Admission is created
 * within 30 days of a previous Admission's dischargeDate (same UHID).
 *
 * NABH COP.16 surveyors track this rate as a quality indicator —
 * unplanned readmissions within 30 days suggest premature discharge or
 * inadequate follow-up. The register links current ↔ previous admission
 * and classifies the readmission type (planned / unplanned / elective).
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: {
    type: String,
    enum: ["CREATED", "REVIEWED", "CATEGORIZED", "CLOSED", "AMENDED"],
    required: true,
  },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "", maxlength: 500 },
});

const ReadmissionRegisterSchema = new Schema({
  // ── Patient ──
  patientId:   { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:        { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName: { type: String, default: "" },
  age:         { type: Number, default: null },
  sex:         { type: String, default: "" },

  // ── Current admission (the readmission event) ──
  currentAdmissionId:     { type: Schema.Types.ObjectId, ref: "Admission", required: true, index: true },
  currentAdmissionNumber: { type: String, default: "" },
  currentAdmissionDate:   { type: Date, required: true, index: true },
  currentDiagnosis:       { type: String, default: "" },
  currentDepartment:      { type: String, default: "" },
  currentAttendingDoctor: { type: String, default: "" },

  // ── Previous admission (the index discharge) ──
  previousAdmissionId:     { type: Schema.Types.ObjectId, ref: "Admission", required: true, index: true },
  previousAdmissionNumber: { type: String, default: "" },
  previousDischargeDate:   { type: Date, required: true, index: true },
  previousDiagnosis:       { type: String, default: "" },
  previousDepartment:      { type: String, default: "" },
  previousDischargeType:   { type: String, default: "" },     // Routine / LAMA / DAMA / Referral

  // ── Time-since (computed) ──
  daysSinceDischarge: { type: Number, required: true, min: 0, max: 365 },
  withinWindowDays:   { type: Number, default: 30 },          // NABH threshold

  // ── Classification (NABH COP.16) ──
  readmissionType: {
    type: String,
    enum: ["Unplanned", "Planned", "Elective", "ReturnForProcedure", "Unknown"],
    default: "Unknown",
    index: true,
  },
  // Free-text reason filled by reviewing doctor / QA
  reason:           { type: String, default: "" },
  sameDiagnosis:    { type: Boolean, default: false },        // surveyor metric
  preventableFlag:  { type: Boolean, default: false, index: true },

  // ── Status / review ──
  status: {
    type: String,
    enum: ["Open", "UnderReview", "Closed"],
    default: "Open",
    index: true,
  },
  reviewedBy:      { type: Schema.Types.ObjectId, ref: "User", default: null },
  reviewedByName:  { type: String, default: "" },
  reviewedAt:      { type: Date, default: null },
  reviewNotes:     { type: String, default: "" },

  // ── Source / audit ──
  sourceRef:  { type: Schema.Types.ObjectId, default: null },
  sourceType: { type: String, default: "Admission" },
  occurredAt: { type: Date, default: Date.now, index: true },
  auditTrail: { type: [AuditSchema], default: [] },

  createdBy:     { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdByName: { type: String, default: "" },
  createdByRole: { type: String, default: "" },

  hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "readmission_registers" });

// Surveyor + workflow indexes
ReadmissionRegisterSchema.index({ UHID: 1, currentAdmissionId: 1 });
ReadmissionRegisterSchema.index({ UHID: 1, occurredAt: -1 });
// Idempotency guard: never two register rows for the same (current, previous) pair
ReadmissionRegisterSchema.index(
  { currentAdmissionId: 1, previousAdmissionId: 1 },
  { unique: true, name: "uniq_readmission_pair" },
);
ReadmissionRegisterSchema.index({ readmissionType: 1, occurredAt: -1 });
ReadmissionRegisterSchema.index({ status: 1, occurredAt: -1 });
ReadmissionRegisterSchema.index({ daysSinceDischarge: 1 });

module.exports =
  mongoose.models.ReadmissionRegister ||
  mongoose.model("ReadmissionRegister", ReadmissionRegisterSchema);
