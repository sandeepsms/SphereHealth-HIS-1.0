/**
 * PhysioPlanModel.js — R7bj-F1 (Physiotherapy module greenfield).
 *
 * NABH COP.20 (Rehabilitation Services) requires a documented physiotherapy
 * plan for every patient referred for rehab care — diagnosis, goals, modality
 * mix, session count, frequency, discharge advice. Pre-R7bj the
 * Physiotherapist role existed in the user enum (and the doctor's order panel
 * could create physio orders) but no plan/session model existed, so referrals
 * landed in a permanent void.
 *
 * Append-only audit trail on every status transition. Sessions completed
 * count is maintained ONLY by the sessions endpoint — the plan PUT explicitly
 * strips it to prevent backfill / fraud (audit dispute resilience).
 *
 * Indexes target the three hot-path reads:
 *   - per-admission plan list (admission timeline + IPD file render)
 *   - per-UHID plan history (cross-admission rehab continuity)
 *   - per-therapist productivity (stats dashboard)
 */
"use strict";

const mongoose = require("mongoose");

const AuditEntrySchema = new mongoose.Schema({
  action:    { type: String, required: true },           // "CREATED" | "STATUS_CHANGED" | "COMPLETED" | "CANCELLED"
  at:        { type: Date,   default: Date.now },
  byUserId:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  byName:    { type: String, default: "" },
  byRole:    { type: String, default: "" },
  reason:    { type: String, default: "" },
  // Free-form additional context (e.g. previous status, fields changed).
  // Mixed-typed so the audit row stays cheap to write without a schema
  // migration every time a new attribute is captured.
  meta:      { type: mongoose.Schema.Types.Mixed, default: undefined },
}, { _id: false });

const MODALITY_ENUM = [
  "ULTRASOUND", "SWD", "TENS", "IFC",
  "HOT_PACK", "CRYO",
  "MANUAL_THERAPY", "EXERCISE", "MOBILIZATION", "CHEST_PHYSIO",
  "GAIT", "BALANCE", "STRENGTH", "ROM",
];

const FREQUENCY_ENUM = ["BD", "OD", "2D", "3D", "WEEKLY", "PRN"];
const STATUS_ENUM    = ["ACTIVE", "COMPLETED", "CANCELLED"];

const PhysioPlanSchema = new mongoose.Schema({
  // ── Patient / admission context ─────────────────────────────
  admissionId:    { type: mongoose.Schema.Types.ObjectId, ref: "Admission", required: true, index: true },
  UHID:           { type: String, trim: true, uppercase: true, index: true },
  patientName:    { type: String, default: "" },

  // ── Clinical plan body ──────────────────────────────────────
  diagnosis:      { type: String, default: "" },
  goals:          { type: [String], default: [] },
  // The set of modalities the plan is licensed to deliver — every session's
  // sessionType MUST be drawn from this set (validated at session-create).
  modalitySet:    [{ type: String, enum: MODALITY_ENUM }],

  // ── Schedule ────────────────────────────────────────────────
  sessionsTotal:     { type: Number, min: 1, max: 60, required: true },
  // sessionsCompleted is moved ONLY by the sessions endpoint (completeSession).
  // The plan PUT explicitly strips this so the counter cannot be forged.
  sessionsCompleted: { type: Number, default: 0, min: 0 },
  frequency:         { type: String, enum: FREQUENCY_ENUM, required: true },
  dischargeAdvice:   { type: String, default: "" },

  // ── Authorship ──────────────────────────────────────────────
  createdById:    { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdByName:  { type: String, default: "" },
  createdByRole:  { type: String, default: "" },

  // ── Lifecycle ───────────────────────────────────────────────
  status:         { type: String, enum: STATUS_ENUM, default: "ACTIVE", index: true },
  closedAt:       { type: Date, default: null },
  closedReason:   { type: String, default: "" },

  // ── Append-only audit (NABH AAC.7) ──────────────────────────
  auditTrail:     { type: [AuditEntrySchema], default: [] },

  // ── Print counter (R7bh print audit alignment) ──────────────
  printCount:     { type: Number, default: 0 },

  // ── Multi-tenancy (R7bh-F3 hospitalId stamp) ────────────────
  hospitalId:     { type: mongoose.Schema.Types.ObjectId, ref: "Hospital" },
}, { timestamps: true });

// Hot-path read indexes.
PhysioPlanSchema.index({ admissionId: 1, status: 1 });
PhysioPlanSchema.index({ UHID: 1, status: 1, createdAt: -1 });
PhysioPlanSchema.index({ createdById: 1, createdAt: -1 });

module.exports = mongoose.model("PhysioPlan", PhysioPlanSchema);

// Export the enums so the controller / service can reuse them for validation
// without duplicating the literal list.
module.exports.MODALITY_ENUM  = MODALITY_ENUM;
module.exports.FREQUENCY_ENUM = FREQUENCY_ENUM;
module.exports.STATUS_ENUM    = STATUS_ENUM;
