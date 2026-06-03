/**
 * HAISurveillanceRegisterModel.js — R7gw-B9-T05 / NABH HIC.4
 *
 * Healthcare-Associated Infection (HAI) Surveillance Register. Logs every
 * hospital-acquired infection event so the Infection-Control Committee can
 * compute device-day denominators (CAUTI per 1000 catheter-days, CLABSI per
 * 1000 line-days, VAP per 1000 ventilator-days) and trend across months.
 *
 * Auto-triggered from:
 *   • emitICUBundle when CAUTI bundle compliance <100 AND Foley dwell >3 days
 *     AND patient has a positive UTI culture — these criteria mark a CAUTI
 *     event. linkedICUBundleId pins the row to the bundle sheet that
 *     surfaced the breach.
 *
 * Manual entries allowed via POST / so IC officers can log SSI, CDI,
 * MRSA-bacteremia events that surface from culture-result feeds rather
 * than bundle-sheet logic.
 *
 * Status lifecycle: Open → InProgress (cohort isolated, antibiotics
 * adjusted) → Closed (organism cleared OR patient died / discharged).
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["CREATED", "STATUS_CHANGED", "CLOSED"], required: true },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "" },
});

const HAISurveillanceRegisterSchema = new Schema({
  // ── Patient context ──
  patientId:   { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:        { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName: { type: String, default: "" },
  admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },

  // ── HAI classification ──
  HAIType: {
    type: String,
    required: true,
    enum: ["CAUTI", "CLABSI", "VAP", "SSI", "CDI", "MRSA-Bacteremia"],
    index: true,
  },
  onsetDate:        { type: Date, required: true, index: true },
  identifiedByEmpId:{ type: String, default: "" },

  // ── Device / dwell exposure ──
  // Foley/Central-line/Ventilator dwell days at the time of onset. The
  // denominator for device-related HAI rates is summed across patients
  // by the IC officer's monthly report.
  deviceDays:       { type: Number, default: null, min: 0 },

  // ── Culture + antimicrobial ──
  cultureSent:           { type: Boolean, default: false, index: true },
  organismIsolated:      { type: String, default: "" },
  antibioticPrescribed:  { type: String, default: "" },

  // ── Outcome ──
  outcome: {
    type: String,
    enum: ["", "Resolved", "Complicated", "Death"],
    default: "",
    index: true,
  },

  // ── ICU bundle linkage (auto-trigger source) ──
  // When emitICUBundle creates the row, this pins it to the offending
  // shift sheet so the IC officer can drill back to the bundle items
  // that broke (e.g. CAUTI cleaning, drainage-bag position).
  linkedICUBundleId: { type: Schema.Types.ObjectId, ref: "ICUBundle", default: null, index: true },

  // ── Status + idempotency ──
  status:    { type: String, enum: ["Open", "InProgress", "Closed"], default: "Open", index: true },
  // String sourceRef — server-generated UUID via crypto.randomUUID()
  // when auto-emitted; manual entries get an explicit value. Index for
  // O(1) idempotency lookups on retry.
  sourceRef: { type: String, default: "", index: true },

  // ── Audit ──
  auditTrail: { type: [AuditSchema], default: [] },

  // ── Tenant + emit timestamp ──
  hospitalId:  { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  emittedAt:   { type: Date, default: Date.now, index: true },
}, { timestamps: true, collection: "hai_surveillance_registers" });

// Compound indexes for surveyor reports
HAISurveillanceRegisterSchema.index({ UHID: 1, createdAt: -1 });
HAISurveillanceRegisterSchema.index({ status: 1, createdAt: -1 });
HAISurveillanceRegisterSchema.index({ HAIType: 1, onsetDate: -1 });
HAISurveillanceRegisterSchema.index({ outcome: 1, onsetDate: -1 });

module.exports =
  mongoose.models.HAISurveillanceRegister ||
  mongoose.model("HAISurveillanceRegister", HAISurveillanceRegisterSchema);
