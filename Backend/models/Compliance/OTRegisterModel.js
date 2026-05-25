/**
 * OTRegisterModel.js — R7bu / NABH COP.10
 *
 * Operating Theatre case log. One row per surgical / procedural case
 * conducted in an OT. Auto-populated by nabhRegisterEmitter.emitOT when:
 *
 *   (a) a DoctorOrder of type "Procedure" with `requiresOT=true` is
 *       acknowledged / scheduled (Draft row);
 *   (b) a Procedure note is saved post-op (the row is updated to
 *       Completed with actualProcedure, complications, end-time).
 *
 * NABH COP.10 surveyors expect a chronological OT register tying each
 * case to surgeon, anaesthetist, anaesthesia type, ASA grade, planned vs.
 * actual procedure, and complications. Locked once status=Completed.
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: {
    type: String,
    enum: ["SCHEDULED", "STARTED", "COMPLETED", "CANCELLED", "AMENDED", "LOCKED"],
    required: true,
  },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "", maxlength: 500 },
});

const OTRegisterSchema = new Schema({
  // ── Patient / admission ──
  patientId:   { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:        { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName: { type: String, default: "" },
  age:         { type: Number, default: null },
  sex:         { type: String, default: "" },
  admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
  admissionNumber: { type: String, default: "" },

  // ── Case identification ──
  otNumber:    { type: String, default: "", index: true },     // e.g. "OT-2026-000123"
  otTheatre:   { type: String, default: "" },                  // OT-1 / OT-2 / Minor OT etc.

  // ── Procedure (planned vs actual) ──
  surgeryName:        { type: String, required: true, trim: true },
  plannedProcedure:   { type: String, default: "" },
  actualProcedure:    { type: String, default: "" },
  surgicalSpeciality: { type: String, default: "" },           // Gen Surg / Ortho / OBG etc.

  // ── Care team ──
  surgeonName:        { type: String, default: "" },
  surgeonId:          { type: Schema.Types.ObjectId, ref: "User", default: null },
  assistantNames:     { type: [String], default: [] },
  anaesthetistName:   { type: String, default: "" },
  anaesthetistId:     { type: Schema.Types.ObjectId, ref: "User", default: null },
  scrubNurse:         { type: String, default: "" },
  circulatingNurse:   { type: String, default: "" },

  // ── Anaesthesia ──
  anaesthesiaType: {
    type: String,
    enum: ["", "General", "Spinal", "Epidural", "Regional", "Local", "MAC", "Sedation", "Combined"],
    default: "",
  },
  asaGrade: {
    type: String,
    enum: ["", "I", "II", "III", "IV", "V", "VI"],
    default: "",
  },
  emergencyCase: { type: Boolean, default: false },           // ASA "E" suffix

  // ── Timing ──
  scheduledAt: { type: Date, default: null, index: true },
  startTime:   { type: Date, default: null, index: true },
  endTime:     { type: Date, default: null },
  durationMinutes: { type: Number, default: null },           // computed end-start

  // ── Outcome ──
  complications:      { type: String, default: "" },          // free-text
  unplannedReturn:    { type: Boolean, default: false },      // NABH COP.10 metric
  bloodLossMl:        { type: Number, default: null },
  specimensSent:      { type: [String], default: [] },        // histopath / culture / frozen

  // ── Status / lifecycle ──
  status: {
    type: String,
    enum: ["Scheduled", "InProgress", "Completed", "Cancelled"],
    default: "Scheduled",
    index: true,
  },
  cancelReason: { type: String, default: "" },

  // ── Source linkage ──
  doctorOrderId: { type: Schema.Types.ObjectId, ref: "DoctorOrder", default: null, index: true },
  procedureNoteId: { type: Schema.Types.ObjectId, default: null },
  sourceRef:  { type: Schema.Types.ObjectId, default: null },
  sourceType: { type: String, default: "DoctorOrder" },

  // ── Audit ──
  occurredAt: { type: Date, default: Date.now, index: true },  // chronological anchor for idempotency
  locked:     { type: Boolean, default: false },
  lockedAt:   { type: Date, default: null },
  auditTrail: { type: [AuditSchema], default: [] },

  createdBy:  { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdByName: { type: String, default: "" },
  createdByRole: { type: String, default: "" },

  hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "ot_registers" });

// Surveyor + workflow indexes
OTRegisterSchema.index({ UHID: 1, admissionId: 1 });
OTRegisterSchema.index({ UHID: 1, occurredAt: -1 });
OTRegisterSchema.index({ admissionId: 1, occurredAt: -1 });
OTRegisterSchema.index({ status: 1, scheduledAt: -1 });
OTRegisterSchema.index({ surgeonId: 1, occurredAt: -1 });

module.exports =
  mongoose.models.OTRegister ||
  mongoose.model("OTRegister", OTRegisterSchema);
