/**
 * MedicationErrorRegisterModel.js — R7gw-B9-T04 / NABH MOM.4
 *
 * Medication-Error register. Per NCC-MERP severity (A-I) with phase, dose
 * mismatch, route mismatch, and harm class. Auto-populated when a MAR dose
 * is recorded with nurseError=true; severity E-I additionally fires the
 * Sentinel Event register via emitSentinelEvent.
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["CREATED", "INVESTIGATED", "CLOSED", "ESCALATED"], required: true },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "" },
});

const MedicationErrorRegisterSchema = new Schema({
  // ── Patient ────────────────────────────────────────────────────
  patientId:        { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:             { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName:      { type: String, default: "" },
  admissionId:      { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
  admissionNumber:  { type: String, default: "" },

  // ── Error specifics ────────────────────────────────────────────
  errorPhase: {
    type: String,
    enum: ["Prescribing", "Transcribing", "Dispensing", "Administering", "Monitoring"],
    required: true,
    index: true,
  },
  medicationName:   { type: String, default: "" },
  expectedDose:     { type: String, default: "" },
  actualDose:       { type: String, default: "" },
  expectedRoute:    { type: String, default: "" },
  actualRoute:      { type: String, default: "" },

  // ── NCC-MERP severity (A = potential, no error reached patient → I = death) ──
  severityNCC: {
    type: String,
    enum: ["A", "B", "C", "D", "E", "F", "G", "H", "I"],
    required: true,
    index: true,
  },

  actionTakenImmediate: { type: String, default: "" },

  patientHarm: {
    type: String,
    enum: ["None", "Minor", "Major", "Death"],
    default: "None",
    index: true,
  },

  // ── Reporter ──────────────────────────────────────────────────
  reportedByEmpId:  { type: String, default: "" },
  reportedByName:   { type: String, default: "" },
  reportedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  reportedByRole:   { type: String, default: "" },
  reportedAt:       { type: Date, default: Date.now, index: true },

  // ── Investigation / closure ───────────────────────────────────
  investigationNotes: { type: String, default: "" },
  rootCause:          { type: String, default: "" },
  correctiveAction:   { type: String, default: "" },
  closedAt:           { type: Date, default: null },
  closedByName:       { type: String, default: "" },

  // ── Sentinel linkage (severity E-I auto-emits) ────────────────
  sentinelFlag:     { type: Boolean, default: false, index: true },
  sentinelEventRef: { type: Schema.Types.ObjectId, default: null }, // ref to SentinelEvent row when emitted

  // ── Idempotency / lineage ─────────────────────────────────────
  // sourceRef is a string (UUID or external id) — used to dedupe
  // auto-emits from MAR.administrationRecord.nurseError=true.
  sourceRef:        { type: String, default: "" }, // indexed below via schema.index({sourceRef:1},{sparse:true})
  sourceType:       { type: String, default: "Manual" },           // Manual | MAR | DoctorOrder | PharmacyDispense

  // ── Status ────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ["Open", "InProgress", "Closed"],
    default: "Open",
    index: true,
  },

  // NABH FMS/PSQ — device implicated (e.g. infusion pump), for RCA + recall join.
  equipmentRef:     { assetTag: { type: String, default: "" }, serialNo: { type: String, default: "" }, equipmentId: { type: Schema.Types.ObjectId, ref: "Equipment", default: null } },
  auditTrail:       { type: [AuditSchema], default: [] },

  hospitalId:       { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "medication_error_registers" });

MedicationErrorRegisterSchema.index({ UHID: 1, createdAt: -1 });
MedicationErrorRegisterSchema.index({ status: 1, createdAt: -1 });
MedicationErrorRegisterSchema.index({ severityNCC: 1, createdAt: -1 });
MedicationErrorRegisterSchema.index({ sentinelFlag: 1, createdAt: -1 });
MedicationErrorRegisterSchema.index({ sourceRef: 1 }, { sparse: true });

module.exports =
  mongoose.models.MedicationErrorRegister ||
  mongoose.model("MedicationErrorRegister", MedicationErrorRegisterSchema);
