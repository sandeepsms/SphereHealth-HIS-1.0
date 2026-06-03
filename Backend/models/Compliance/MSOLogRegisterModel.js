/**
 * MSOLogRegisterModel.js — R7gw-B10-T02 / NABH PRE.1
 *
 * Medical Social Officer (MSO) session log. One row per MSO session with a
 * patient or family — counseling, financial-aid, discharge-planning,
 * bereavement support, grievance-resolution and vulnerable-patient care
 * touchpoints. NABH PRE.1 wants this evidence-trail of psychosocial /
 * financial / discharge-planning support delivered by qualified social
 * workers.
 *
 * Each session captures: who (social worker emp id), when (sessionDate),
 * for how long (duration min), what was discussed (concernAddressed), what
 * came of it (outcome enum), and whether follow-up is needed. Manual entry
 * by the social worker — no auto-trigger.
 */
"use strict";

const crypto = require("crypto");
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["CREATED", "UPDATED", "CLOSED"], required: true },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "" },
});

const MSOLogRegisterSchema = new Schema({
  // ── Patient linkage (UHID required) ──────────────────────────────
  patientId:        { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:             { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName:      { type: String, default: "" },
  admissionId:      { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
  admissionNumber:  { type: String, default: "" },

  // ── Session context ──────────────────────────────────────────────
  sessionDate:      { type: Date, required: true, index: true },
  sessionType: {
    type: String,
    enum: [
      "Counseling",
      "Financial-Aid",
      "Discharge-Planning",
      "Bereavement",
      "Grievance-Resolution",
      "Vulnerable-Patient-Care",
    ],
    required: true,
    index: true,
  },
  duration:         { type: Number, default: 0 },                          // minutes
  concernAddressed: { type: String, default: "" },

  // ── Outcome ──────────────────────────────────────────────────────
  outcome: {
    type: String,
    enum: ["Resolved", "Escalated", "Ongoing", "Referred"],
    required: true,
    index: true,
  },
  followUpNeeded:   { type: Boolean, default: false, index: true },
  followUpDate:     { type: Date, default: null },
  referredTo:       { type: String, default: "" },                         // dept / agency when outcome=Referred

  // ── Social worker (MSO) ──────────────────────────────────────────
  socialWorkerEmpId: { type: String, default: "", index: true },
  socialWorkerName:  { type: String, default: "" },
  socialWorkerUserId:{ type: Schema.Types.ObjectId, ref: "User", default: null },

  // ── Free-text ────────────────────────────────────────────────────
  notes:            { type: String, default: "" },

  // ── Lifecycle ────────────────────────────────────────────────────
  status: { type: String, enum: ["Open", "InProgress", "Closed"], default: "Closed", index: true },

  // ── Idempotency / source ─────────────────────────────────────────
  // server-generated UUID via crypto.randomUUID() at create time; lets
  // repeated POSTs of the same session row coalesce when the entry form
  // retries.
  sourceRef:  { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
  sourceType: { type: String, default: "Manual" },

  emittedAt:  { type: Date, default: Date.now, index: true },

  auditTrail: { type: [AuditSchema], default: [] },

  hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "mso_log_registers" });

MSOLogRegisterSchema.index({ UHID: 1, sessionDate: -1 });
MSOLogRegisterSchema.index({ sessionType: 1, sessionDate: -1 });
MSOLogRegisterSchema.index({ outcome: 1, sessionDate: -1 });
MSOLogRegisterSchema.index({ followUpNeeded: 1, followUpDate: 1 });
MSOLogRegisterSchema.index({ socialWorkerEmpId: 1, sessionDate: -1 });
MSOLogRegisterSchema.index({ status: 1, createdAt: -1 });

module.exports =
  mongoose.models.MSOLogRegister ||
  mongoose.model("MSOLogRegister", MSOLogRegisterSchema);
