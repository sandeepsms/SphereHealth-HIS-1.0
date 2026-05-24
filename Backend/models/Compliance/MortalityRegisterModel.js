/**
 * MortalityRegisterModel.js — R7bu / NABH COP.18
 *
 * In-hospital mortality register. One row per death event.
 * Auto-populated by nabhRegisterEmitter.emitMortality when:
 *
 *   (a) DischargeSummary.conditionOnDischarge === "Expired" OR
 *       DischargeSummary.dischargeType === "Death";
 *   (b) a stand-alone Death Note is saved.
 *
 * NABH COP.18 surveyors expect a chronological mortality log with
 * primary + contributory causes, MLC linkage (where applicable), post-
 * mortem status, death-certificate number, and the attending doctor.
 * Used for monthly mortality-review committee meetings.
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: {
    type: String,
    enum: ["CREATED", "REVIEWED", "CERT_ISSUED", "PM_RESULT_FILED", "AMENDED", "LOCKED"],
    required: true,
  },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "", maxlength: 500 },
});

const MortalityRegisterSchema = new Schema({
  // ── Patient / admission ──
  patientId:   { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:        { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName: { type: String, default: "" },
  age:         { type: Number, default: null },
  sex:         { type: String, default: "" },
  admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
  admissionNumber: { type: String, default: "" },

  // ── Mortality serial (sequence per fiscal year) ──
  mortalityNumber: { type: String, default: "", index: true },     // e.g. "MORT-2026-000017"

  // ── Death event ──
  dateOfDeath: { type: Date, required: true, index: true },
  timeOfDeath: { type: String, trim: true, default: "" },          // "HH:MM"
  placeOfDeath: {
    type: String,
    enum: ["", "Ward", "ICU", "Emergency", "OT", "Recovery", "Pre-Hospital-Arrival", "Other"],
    default: "",
  },

  // ── Cause of death (NABH COP.18 — ICD-10 friendly) ──
  primaryCause:        { type: String, required: true, trim: true },
  immediateCauseOfDeath: { type: String, default: "" },             // Part 1a
  antecedentCauseOfDeath:{ type: String, default: "" },             // Part 1b
  underlyingCause:     { type: String, default: "" },               // Part 1c
  contributoryCauses:  { type: [String], default: [] },             // Part 2
  manner: {
    type: String,
    enum: ["", "Natural", "Accident", "Suicide", "Homicide", "Undetermined", "Pending"],
    default: "",
  },

  // ── Stay / category ──
  admissionToDeathHours: { type: Number, default: null },           // computed
  bruceCategory: {
    type: String,
    enum: ["", "Less24h", "More24h", "GROSS"],                       // <24h, >24h, gross deaths
    default: "",
  },

  // ── MLC linkage (medico-legal) ──
  isMLC:              { type: Boolean, default: false },
  mlcNumber:          { type: String, default: "" },
  policeIntimated:    { type: Boolean, default: false },
  policeStation:      { type: String, default: "" },

  // ── Post-mortem ──
  postMortemDone:        { type: Boolean, default: false },
  postMortemRequiredFlag:{ type: Boolean, default: false },
  postMortemFindings:    { type: String, default: "" },
  postMortemHospital:    { type: String, default: "" },

  // ── Death certificate ──
  deathCertificateNumber: { type: String, default: "" },
  deathCertificateIssuedAt: { type: Date, default: null },
  deathCertificateIssuedBy: { type: String, default: "" },

  // ── Attending team ──
  attendingDoctor:    { type: String, default: "" },
  attendingDoctorId:  { type: Schema.Types.ObjectId, ref: "User", default: null },
  certifyingDoctor:   { type: String, default: "" },
  certifyingDoctorId: { type: Schema.Types.ObjectId, ref: "User", default: null },

  // ── Mortality review (committee) ──
  reviewedByCommittee: { type: Boolean, default: false },
  reviewDate:          { type: Date, default: null },
  reviewFindings:      { type: String, default: "" },
  preventableFlag:     { type: Boolean, default: false, index: true },

  // ── Linkage / source ──
  dischargeSummaryId:  { type: Schema.Types.ObjectId, ref: "DischargeSummary", default: null, index: true },
  deathNoteId:         { type: Schema.Types.ObjectId, default: null },
  sourceRef:           { type: Schema.Types.ObjectId, default: null },
  sourceType:          { type: String, default: "DischargeSummary" },

  // ── Audit ──
  occurredAt: { type: Date, default: Date.now, index: true },
  locked:     { type: Boolean, default: false },
  lockedAt:   { type: Date, default: null },
  auditTrail: { type: [AuditSchema], default: [] },

  createdBy:     { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdByName: { type: String, default: "" },
  createdByRole: { type: String, default: "" },

  hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "mortality_registers" });

// Surveyor + workflow indexes
MortalityRegisterSchema.index({ UHID: 1, admissionId: 1 });
MortalityRegisterSchema.index({ UHID: 1, dateOfDeath: -1 });
MortalityRegisterSchema.index({ admissionId: 1, dateOfDeath: -1 });
MortalityRegisterSchema.index({ dateOfDeath: -1 });
MortalityRegisterSchema.index({ isMLC: 1, dateOfDeath: -1 });
MortalityRegisterSchema.index({ preventableFlag: 1, dateOfDeath: -1 });
// Idempotency: one mortality row per admission
MortalityRegisterSchema.index(
  { admissionId: 1 },
  { unique: true, sparse: true, name: "uniq_mortality_admission" },
);

module.exports =
  mongoose.models.MortalityRegister ||
  mongoose.model("MortalityRegister", MortalityRegisterSchema);
