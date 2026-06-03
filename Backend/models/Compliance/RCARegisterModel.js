/**
 * RCARegisterModel.js — R7gw-B9-B9-T03 / NABH QPS.1 + AAC.7
 *
 * Root-Cause Analysis register. Each row tracks one RCA workflow attached
 * to a sentinel event (or a serious near-miss), capturing:
 *   • the multi-disciplinary RCA team and timeline of fact-finding,
 *   • the contributing factors + root causes identified,
 *   • the corrective + preventive actions (CAPA) the committee approved,
 *   • status lifecycle Open → InProgress → Closed.
 *
 * Auto-created from emitSentinelEvent — a new RCA row is opened in
 * "Open" status whenever a Sentinel-Event Register row is emitted,
 * with linkedSentinelId populated so the QPS chair can drill in.
 *
 * Manual entries allowed via POST / route — Quality team logs RCAs
 * triggered from non-sentinel sources (serious near-misses, recurrent
 * deviations identified during clinical audit).
 *
 * NABH QPS.1: documented quality programme with root-cause analysis
 * of sentinel events and a corrective-action register.
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

const TimelineEntrySchema = new Schema({
  _id: false,
  date:  { type: Date, required: true },
  event: { type: String, default: "" },
});

const AuditSchema = new Schema({
  _id: false,
  action:   { type: String, enum: ["CREATED", "TEAM_ASSIGNED", "STATUS_CHANGED", "CAPA_FILED", "CLOSED"], required: true },
  at:       { type: Date, default: Date.now },
  byName:   { type: String, default: "" },
  byRole:   { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes:    { type: String, default: "" },
});

const RCARegisterSchema = new Schema({
  // ── Patient context (optional — some RCAs are systemic, no single patient) ──
  patientId:   { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:        { type: String, default: "", uppercase: true, trim: true, index: true },
  patientName: { type: String, default: "" },
  admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },

  // ── Trigger linkage ──
  linkedSentinelId: { type: Schema.Types.ObjectId, ref: "SentinelEventRegister", default: null, index: true },
  linkedNearMissId: { type: Schema.Types.ObjectId, default: null, index: true },

  // ── Initiation ──
  initiatedAt:       { type: Date, required: true, index: true },
  initiatedByEmpId:  { type: String, default: "" },
  initiatedByName:   { type: String, default: "" },

  // ── Team + timeline ──
  teamMembers: { type: [String], default: [] },                // names / emp IDs
  timeline:    { type: [TimelineEntrySchema], default: [] },   // chronological RCA log

  // ── Findings ──
  contributingFactors: { type: [String], default: [] },
  rootCauses:          { type: [String], default: [] },

  // ── Actions (CAPA) ──
  correctiveActions: { type: [String], default: [] },
  preventiveActions: { type: [String], default: [] },

  // ── Status lifecycle ──
  status: {
    type: String,
    enum: ["Open", "Initiated", "InProgress", "Closed"],
    default: "Open",
    index: true,
  },
  closedAt:       { type: Date, default: null },
  closedByEmpId:  { type: String, default: "" },
  closedByName:   { type: String, default: "" },

  // ── Idempotency / source tracking ──
  sourceRef:  { type: String, default: "", index: true },      // UUID for auto-emit idempotency
  sourceType: { type: String, default: "Manual" },             // "SentinelEvent" / "NearMiss" / "Manual"

  // ── Audit ──
  auditTrail: { type: [AuditSchema], default: [] },

  // ── Tenant ──
  hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  emittedAt:  { type: Date, default: Date.now, index: true },
}, { timestamps: true, collection: "rca_registers" });

// Note: single-field indexes on UHID, status, linkedSentinelId, initiatedAt
// are already declared inline with `index: true` on the field. Only declare
// compound indexes here to avoid Mongoose duplicate-index warnings.
RCARegisterSchema.index({ UHID: 1, createdAt: -1 });
RCARegisterSchema.index({ status: 1, createdAt: -1 });

module.exports =
  mongoose.models.RCARegister ||
  mongoose.model("RCARegister", RCARegisterSchema);
