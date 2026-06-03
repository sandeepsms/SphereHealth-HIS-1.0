/**
 * ESGComplianceRegisterModel.js — R7gw-B10-T03 / NABH 6th-ed Environment
 *
 * Monthly Environmental, Social & Governance (ESG) compliance register.
 * NABH 6th-edition introduces a chapter on sustainability — facilities are
 * expected to track energy / water / waste / carbon performance per period
 * (YYYY-MM) and surface green initiatives + audit findings to the QPS
 * Committee.
 *
 * One row per facility-month period. Compliance officer / Facilities Manager
 * files the row at month-end with consumption + waste figures from utility
 * bills, BMW vendor manifests, and audit reports. CO2-equivalent is derived
 * (or entered directly) for the green-house-gas line.
 *
 * Manual-entry only — no auto-trigger from upstream clinical writes.
 */
"use strict";

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

const ESGComplianceRegisterSchema = new Schema({
  // ── Reporting period (YYYY-MM, one row per facility-month) ──────
  period: { type: String, required: true, trim: true, index: true },   // "2026-05"

  // ── Resource consumption (period totals) ────────────────────────
  energyKwh:        { type: Number, default: 0 },                       // grid + DG kWh
  waterKl:          { type: Number, default: 0 },                       // kilolitres
  dieselLitres:     { type: Number, default: 0 },                       // DG fuel

  // ── Waste (kg, period totals) ───────────────────────────────────
  medicalWasteKg:    { type: Number, default: 0 },                      // total clinical waste
  biomedicalWasteKg: { type: Number, default: 0 },                      // BMW-specific (BMW Rules 2016)
  recycledPct:       { type: Number, default: 0 },                      // % of waste recycled

  // ── Carbon footprint ────────────────────────────────────────────
  co2eqKg:           { type: Number, default: 0 },                      // GHG equivalent (kg CO2e)

  // ── Initiatives + governance ────────────────────────────────────
  greenInitiatives:  { type: [String], default: [] },                   // ["Solar 30kW", "LED retrofit", …]
  auditFindings:     { type: String, default: "" },                     // internal ESG-audit notes

  // ── Reporter ────────────────────────────────────────────────────
  reportedByEmpId:   { type: String, default: "", index: true },
  reportedByName:    { type: String, default: "" },
  reportedByUserId:  { type: Schema.Types.ObjectId, ref: "User", default: null },

  // ── Lifecycle ───────────────────────────────────────────────────
  status: { type: String, enum: ["Open", "InProgress", "Closed"], default: "Closed", index: true },

  // ── Idempotency / source ────────────────────────────────────────
  sourceRef:  { type: String, default: () => require("crypto").randomUUID(), unique: true, index: true },
  sourceType: { type: String, default: "Manual" },

  emittedAt:  { type: Date, default: Date.now, index: true },

  auditTrail: { type: [AuditSchema], default: [] },

  hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "esg_compliance_registers" });

ESGComplianceRegisterSchema.index({ period: -1, createdAt: -1 });
ESGComplianceRegisterSchema.index({ reportedByEmpId: 1, period: -1 });
ESGComplianceRegisterSchema.index({ status: 1, createdAt: -1 });

module.exports =
  mongoose.models.ESGComplianceRegister ||
  mongoose.model("ESGComplianceRegister", ESGComplianceRegisterSchema);
