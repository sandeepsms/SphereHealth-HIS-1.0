/**
 * PROMPREMRegRegisterModel.js — R7gw-B10-T05 / NABH PRE.4 (6th-ed)
 *
 * Patient-Reported Outcome / Experience Measure register. NABH 6th-edition
 * PRE.4 requires the hospital to maintain a register of structured patient-
 * reported outcomes (PROMIS / SF-36 / EQ-5D) and patient-experience surveys
 * (HCAHPS / NHS Friends-and-Family Test / custom PREM) administered at
 * discharge or follow-up.
 *
 * Each row = one administration of one instrument to one patient. Scores are
 * captured as a free-form map (domain → number) because each instrument has
 * its own domain set (PROMIS has 7 domains, SF-36 has 8, EQ-5D has 5+VAS).
 *
 * dischargeContext defaults true — most PROM/PREM are administered at the
 * time of discharge; can be false for follow-up clinic visits or scheduled
 * post-op re-administration.
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

const PROMPREMRegRegisterSchema = new Schema({
  // ── Patient linkage ─────────────────────────────────────────────
  patientId:        { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:             { type: String, uppercase: true, trim: true, required: true, index: true },
  patientName:      { type: String, default: "" },
  admissionId:      { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
  admissionNumber:  { type: String, default: "" },

  // ── Instrument ──────────────────────────────────────────────────
  instrument: {
    type: String,
    enum: ["PROMIS", "SF-36", "EQ-5D", "Custom-PREM", "HCAHPS", "NHS-FFT"],
    required: true,
    index: true,
  },

  // ── Administration ──────────────────────────────────────────────
  administeredAt:      { type: Date, required: true, index: true },
  administeredByEmpId: { type: String, default: "", index: true },
  administeredByName:  { type: String, default: "" },
  administeredByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },

  // ── Scores (instrument-specific) ─────────────────────────────────
  // Map of domain key → numeric score. e.g. for SF-36:
  //   { PF: 75, RP: 50, BP: 60, GH: 70, VT: 65, SF: 80, RE: 50, MH: 75 }
  // for EQ-5D:
  //   { mobility: 2, selfcare: 1, usualActivities: 2, pain: 2, anxiety: 3, vas: 75 }
  scores:           { type: Map, of: Number, default: () => new Map() },

  // ── Qualitative ─────────────────────────────────────────────────
  comments:         { type: String, default: "" },     // free-text patient comment
  recommendation:   { type: String, default: "" },     // staff/PRO-officer follow-up note

  // ── Context ─────────────────────────────────────────────────────
  dischargeContext: { type: Boolean, default: true, index: true },  // true=at discharge, false=follow-up

  // ── Lifecycle ───────────────────────────────────────────────────
  status: { type: String, enum: ["Open", "InProgress", "Closed"], default: "Closed", index: true },

  // ── Idempotency / source ────────────────────────────────────────
  sourceRef:        { type: String, default: () => crypto.randomUUID(), unique: true, index: true },
  sourceType:       { type: String, default: "Manual" },

  emittedAt:        { type: Date, default: Date.now, index: true },

  auditTrail:       { type: [AuditSchema], default: [] },

  hospitalId:       { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "prom_prem_registers" });

PROMPREMRegRegisterSchema.index({ UHID: 1, administeredAt: -1 });
PROMPREMRegRegisterSchema.index({ instrument: 1, administeredAt: -1 });
PROMPREMRegRegisterSchema.index({ dischargeContext: 1, administeredAt: -1 });
PROMPREMRegRegisterSchema.index({ status: 1, createdAt: -1 });

module.exports =
  mongoose.models.PROMPREMRegRegister ||
  mongoose.model("PROMPREMRegRegister", PROMPREMRegRegisterSchema);
