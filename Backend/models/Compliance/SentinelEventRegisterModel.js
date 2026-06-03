/**
 * SentinelEventRegisterModel.js — R7gw-B9-T01 / NABH AAC.7 + MOM.4
 *
 * Sentinel-event registry. Logs each unanticipated event causing death or
 * serious physical / psychological injury (or risk thereof) so the Quality /
 * Patient-Safety Committee can drive a Root-Cause Analysis (RCA).
 *
 * Auto-triggered from:
 *   • emitPressureUlcer when bradenStage >= 3 (HAPU stage III+ = sentinel)
 *   • emitFallRisk when fallOccurred && majorInjury (post-fall sentinel)
 *
 * Manual entries allowed via POST / route — Quality team logs events not
 * surfaced by existing emit hooks (wrong-patient surgery, suicide attempt,
 * retained foreign object, severe maternal morbidity, etc.).
 *
 * Status lifecycle: Open → InProgress (RCA assigned) → Closed (RCA filed +
 * CAPA verified).
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: { type: String, enum: ["CREATED", "RCA_INITIATED", "STATUS_CHANGED", "CLOSED"], required: true },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "" },
});

const SentinelEventRegisterSchema = new Schema({
  // ── Patient context ──
  patientId:   { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:        { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName: { type: String, default: "" },
  admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },

  // ── Event details ──
  eventType: {
    type: String,
    required: true,
    enum: [
      "Unexpected-Death",
      "HAPU-stage3-4",
      "Wrong-Patient-Surgery",
      "Medication-Error-NCC-E-plus",
      "Suicide-attempt",
      "Severe-Maternal-Morbidity",
      "Retained-Object",
      "Fall-with-Major-Injury",
    ],
    index: true,
  },
  discoveredAt:      { type: Date, required: true, index: true },
  discoveredByEmpId: { type: String, default: "" },
  severity:          { type: String, enum: ["Critical", "Major"], required: true, index: true },
  immediateAction:   { type: String, default: "" },

  // ── RCA linkage ──
  rcaInitiated: { type: Boolean, default: false, index: true },
  rcaId:        { type: Schema.Types.ObjectId, ref: "RCARegister", default: null },

  // ── Status + idempotency ──
  status:    { type: String, enum: ["Open", "InProgress", "Closed"], default: "Open", index: true },
  sourceRef: { type: String, default: "", index: true }, // UUID/string for auto-emit idempotency

  // ── Audit ──
  auditTrail: { type: [AuditSchema], default: [] },

  // ── Tenant ──
  hospitalId:  { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  emittedAt:   { type: Date, default: Date.now, index: true },
}, { timestamps: true, collection: "sentinel_event_registers" });

SentinelEventRegisterSchema.index({ UHID: 1, createdAt: -1 });
SentinelEventRegisterSchema.index({ status: 1, createdAt: -1 });
SentinelEventRegisterSchema.index({ eventType: 1, discoveredAt: -1 });

module.exports =
  mongoose.models.SentinelEventRegister ||
  mongoose.model("SentinelEventRegister", SentinelEventRegisterSchema);
