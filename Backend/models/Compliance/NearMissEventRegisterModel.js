/**
 * NearMissEventRegisterModel.js — R7gw / B9-T02 — NABH QPS Near-Miss Register
 *
 * Captures any event that *almost* harmed a patient but was caught in time —
 * the surveyor's favourite indicator of a healthy safety culture. Common
 * sources: medication interception at MAR, wrong-patient grab at biometric
 * scan, fall prevented by sitter, IV extravasation caught early.
 *
 * Manual-entry only (no auto-trigger). The reporting nurse / RMO uses the
 * compliance page to log the event with the severity-if-missed grading
 * (NCC-MERP A-I scale) and the intervention that stopped the harm.
 *
 * NABH QPS.5 — near-miss reporting program. The link to Sentinel events is
 * optional (linkedSentinelId) — surveyors look for trends where near-misses
 * cluster around the same root cause as a recent sentinel.
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;
const crypto = require("crypto");

const AuditSchema = new Schema({
  _id: false,
  action: {
    type: String,
    enum: ["CREATED", "UPDATED", "STATUS_CHANGED", "LINKED_TO_SENTINEL", "CLOSED"],
    required: true,
  },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  reason: { type: String, default: "" },
});

const NearMissEventRegisterSchema = new Schema({
  // ── Patient context (UHID optional — some near-misses pre-date positive ID) ──
  patientId:        { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:             { type: String, uppercase: true, trim: true, default: "", index: true },
  patientName:      { type: String, default: "" },
  admissionId:      { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },

  // ── Event type — closed enum so dashboards can chart cleanly ──
  eventType: {
    type: String,
    required: true,
    enum: [
      "Wrong-medication-intercepted",
      "Wrong-patient-intercepted",
      "Wrong-site-intercepted",
      "IV-extravasation-prevented",
      "Fall-prevented",
      "Equipment-malfunction-detected",
    ],
    index: true,
  },

  // ── When + who observed it ──
  observedAt:       { type: Date, required: true, index: true },
  observedByEmpId:  { type: String, required: true, trim: true, index: true },
  observedByName:   { type: String, default: "" },
  observedByRole:   { type: String, default: "" },
  observedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },

  // ── NCC-MERP severity-if-missed ──
  // A = capacity to cause error (no harm); I = death. NABH QPS surveyors
  // map this to their severity matrix.
  severityIfMissed: {
    type: String,
    required: true,
    enum: ["A", "B", "C", "D", "E", "F", "G", "H", "I"],
    index: true,
  },

  // ── What was done ──
  interventionTaken: { type: String, required: true, default: "" },
  // R7hr-NABH-PSQ: was `required: true, default: ""` — a self-contradiction
  // (the "" default never satisfies required), so EVERY near-miss create
  // without a recommendation 400'd with an opaque "could not write". A
  // recommendation is optional at capture and can be added later during
  // review via PATCH.
  recommendation:    { type: String, default: "" },

  // ── Optional link to a Sentinel event row (clustering analysis) ──
  linkedSentinelId: { type: Schema.Types.ObjectId, ref: "SentinelEventRegister", default: null, index: true },

  // ── Workflow status ──
  status: {
    type: String,
    enum: ["Open", "InProgress", "Closed"],
    default: "Open",
    index: true,
  },

  // ── Idempotency — server-generated UUID so duplicate POSTs no-op ──
  sourceRef:  { type: String, default: () => crypto.randomUUID(), index: true, unique: true, sparse: true },
  sourceType: { type: String, default: "Manual" },

  // ── Reporting metadata ──
  emittedAt: { type: Date, default: Date.now, index: true },

  // NABH FMS/PSQ — equipment implicated in the near-miss, for RCA + recall join.
  equipmentRef: { assetTag: { type: String, default: "" }, serialNo: { type: String, default: "" }, equipmentId: { type: Schema.Types.ObjectId, ref: "Equipment", default: null } },
  auditTrail: { type: [AuditSchema], default: [] },

  hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "near_miss_event_registers" });

// Compound indexes for the most common queries
NearMissEventRegisterSchema.index({ UHID: 1, observedAt: -1 });
NearMissEventRegisterSchema.index({ status: 1, createdAt: -1 });
NearMissEventRegisterSchema.index({ eventType: 1, observedAt: -1 });
NearMissEventRegisterSchema.index({ severityIfMissed: 1, observedAt: -1 });

module.exports =
  mongoose.models.NearMissEventRegister ||
  mongoose.model("NearMissEventRegister", NearMissEventRegisterSchema);
