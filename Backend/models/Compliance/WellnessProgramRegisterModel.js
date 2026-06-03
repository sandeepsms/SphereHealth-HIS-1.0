/**
 * WellnessProgramRegisterModel.js — R7gw-B10-T04 / NABH HRM.6
 *
 * Staff wellness program register. NABH HRM.6 requires the hospital to
 * conduct staff-wellness activities — annual health checks, vaccination
 * drives, stress-management workshops, yoga / mindfulness sessions,
 * nutrition counselling — and maintain dated attendance + feedback per
 * session. Surveyors sample one row per quarter and ask:
 *   • Who attended? (participantEmpIds)
 *   • Who facilitated?
 *   • What was the feedback score? (1-5 mean)
 *   • Were any follow-up actions captured? (notes)
 *
 * One row per programme session. No auto-trigger from clinical writes —
 * the HR / Wellness committee files each entry from the page UI.
 *
 * Indexes mirror the surveyor queries: filter by sessionDate range,
 * programme type, facilitator.
 */
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;
const crypto = require("crypto");

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["CREATED", "UPDATED", "CLOSED"], required: true },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "" },
});

const WellnessProgramRegisterSchema = new Schema({
  // ── Programme identity ─────────────────────────────────────────
  programName: { type: String, required: true, trim: true, index: true },
  type: {
    type: String,
    enum: [
      "StaffHealth",
      "Vaccination",
      "AnnualHealthCheck",
      "StressManagement",
      "Yoga",
      "Nutrition",
      "Mindfulness",
    ],
    required: true,
    index: true,
  },

  // ── Session schedule ───────────────────────────────────────────
  sessionDate: { type: Date, required: true, index: true },

  // ── Participation ─────────────────────────────────────────────
  // Free-form emp-IDs because the wellness committee may invite
  // visitor faculty + contract staff whose IDs don't exist in the
  // employee master. Validation deferred to the page UI.
  participantEmpIds: { type: [String], default: [] },

  // ── Content & facilitation ────────────────────────────────────
  topic: { type: String, required: true, trim: true, index: true },
  facilitator: { type: String, required: true, trim: true, index: true },

  // ── Outcome ────────────────────────────────────────────────────
  feedbackScore: { type: Number, min: 1, max: 5, default: 0, index: true },
  notes: { type: String, default: "" },

  // ── Lifecycle ───────────────────────────────────────────────────
  status: { type: String, enum: ["Planned", "Completed", "Cancelled"], default: "Completed", index: true },

  // ── Idempotency / source ────────────────────────────────────────
  // server-generated UUID via crypto.randomUUID() at emit time; lets repeated
  // POSTs of the same session row coalesce when the wellness page retries.
  sourceRef: { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
  sourceType: { type: String, default: "Manual" },

  emittedAt: { type: Date, default: Date.now, index: true },

  auditTrail: { type: [AuditSchema], default: [] },

  hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "wellness_program_registers" });

WellnessProgramRegisterSchema.index({ type: 1, sessionDate: -1 });
WellnessProgramRegisterSchema.index({ facilitator: 1, sessionDate: -1 });
WellnessProgramRegisterSchema.index({ status: 1, createdAt: -1 });
WellnessProgramRegisterSchema.index({ sessionDate: -1 });

module.exports =
  mongoose.models.WellnessProgramRegister ||
  mongoose.model("WellnessProgramRegister", WellnessProgramRegisterSchema);
