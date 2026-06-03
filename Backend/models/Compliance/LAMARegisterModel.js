/**
 * LAMARegisterModel.js — R7gw-B9-T07 / NABH AAC.4
 *
 * LAMA (Leave Against Medical Advice) / DAMA (Discharged Against Medical
 * Advice) register. Auto-populated when a discharge is finalised with
 * disposition === "LAMA" (or dischargeType === "DAMA" / "LAMA"). NABH
 * AAC.4 expects a single chronological log of every LAMA episode with
 * counselling notes, risks-explained attestation, patient + witness
 * signatures, and any police/transfer activity.
 *
 * Idempotency: server-generated sourceRef (UUID) when the discharge
 * doesn't already carry one. find-or-create by sourceRef so a re-finalize
 * never double-writes the row.
 */
"use strict";
const mongoose = require("mongoose");
const crypto = require("crypto");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["CREATED", "UPDATED", "CLOSED", "REOPENED"], default: "CREATED" },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  reason: { type: String, default: "" },
  notes: { type: String, default: "" },
});

const LAMARegisterSchema = new Schema({
  patientId:        { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:             { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName:      { type: String, default: "" },
  age:              { type: Number, default: null },
  sex:              { type: String, default: "" },
  admissionId:      { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
  admissionNumber:  { type: String, default: "" },

  // ── LAMA episode metadata ──
  lamaAt:           { type: Date, required: true, index: true },
  lamaReason:       { type: String, default: "" },

  // ── Signatures (text capture; uploads handled elsewhere) ──
  patientSignature:  { type: String, default: "" },
  witnessName:       { type: String, default: "" },
  witnessSignature:  { type: String, default: "" },

  // ── Counselling + risk disclosure ──
  doctorCounsellingNotes: { type: String, default: "" },
  risksExplained:    { type: Boolean, default: false, index: true },
  familyInformed:    { type: Boolean, default: false },

  // ── Statutory / forensic notifications ──
  policeNotified:    { type: Boolean, default: false, index: true },
  policeStation:     { type: String, default: "" },
  policeFIRNo:       { type: String, default: "" },

  // ── Onward transfer (if patient is being moved to another facility) ──
  transferRequested: { type: Boolean, default: false },
  transferTo:        { type: String, default: "" },

  // ── Staff trace ──
  attendingDoctor:   { type: String, default: "" },
  attendingDoctorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  counsellingDoctor: { type: String, default: "" },
  counsellingDoctorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  ward:              { type: String, default: "" },

  // ── Idempotency + provenance ──
  // sourceRef: server-generated UUID if none supplied by the caller.
  // Lets the discharge form retry the emit on network blips without
  // double-writing the register row.
  sourceRef:         { type: String, required: true, unique: true, index: true,
                       default: () => crypto.randomUUID() },
  sourceType:        { type: String, default: "DischargeSummary" },
  dischargeSummaryId:{ type: Schema.Types.ObjectId, ref: "DischargeSummary", default: null },

  // ── Lifecycle ──
  status:            { type: String, enum: ["Open", "InProgress", "Closed"], default: "Open", index: true },
  emittedAt:         { type: Date, default: Date.now, index: true },
  closedAt:          { type: Date, default: null },
  closedBy:          { type: String, default: "" },

  auditTrail:        { type: [AuditSchema], default: [] },

  hospitalId:        { type: Schema.Types.ObjectId, ref: "Hospital", default: null },

  createdBy:         { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdByName:     { type: String, default: "" },
  createdByRole:     { type: String, default: "" },
}, { timestamps: true, collection: "lama_registers" });

LAMARegisterSchema.index({ UHID: 1, lamaAt: -1 });
LAMARegisterSchema.index({ admissionId: 1, lamaAt: -1 });
LAMARegisterSchema.index({ status: 1, emittedAt: -1 });
LAMARegisterSchema.index({ status: 1, createdAt: -1 });

module.exports =
  mongoose.models.LAMARegister ||
  mongoose.model("LAMARegister", LAMARegisterSchema);
