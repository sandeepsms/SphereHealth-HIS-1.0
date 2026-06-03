/**
 * AntibiogramRegisterModel.js — R7gw-B10-T01 / NABH HIC.6
 *
 * Antibiogram register. Periodic facility-level cumulative susceptibility
 * report — organism × ward × sample-type × period (commonly month or
 * quarter) — derived from microbiology isolates. Powers the antimicrobial-
 * stewardship committee's first-line / second-line empiric recommendation
 * tables that show up in the ICU bundle, ER sepsis protocol, and post-op
 * antibiotic guidance sheets.
 *
 * One row per (organism, period, ward, sampleType) tuple. The
 * `sensitivityProfile` Map keys are antibiotic names (e.g. "Ceftriaxone")
 * and values are S | I | R (Susceptible / Intermediate / Resistant), so a
 * single row carries the full antibiogram column for that bug × cohort.
 *
 * UHID intentionally absent — antibiograms are aggregate epidemiology,
 * not patient-attributed. Per-isolate culture results live in the lab /
 * culture-and-sensitivity model.
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

const AntibiogramRegisterSchema = new Schema({
  // ── Organism + cohort key ───────────────────────────────────────
  organism: { type: String, required: true, trim: true, index: true },
  // Date the isolate was collected (or the representative date of the
  // aggregated cohort). Used for chronological lookups.
  isolatedAt: { type: Date, default: null, index: true },
  ward: { type: String, default: "", index: true },          // ICU / Med-1 / OT-2 / OPD
  sampleType: {
    type: String,
    enum: ["Blood", "Urine", "Sputum", "Wound", "CSF", "Stool", "Other"],
    default: "Other",
    index: true,
  },

  // ── Sensitivity profile (antibiotic → S / I / R) ────────────────
  // Map<String, String> — key = antibiotic name, value = "S" | "I" | "R".
  // Stored as a Map so the AMSC can append new antibiotics to the panel
  // without altering the schema.
  sensitivityProfile: {
    type: Map,
    of: { type: String, enum: ["S", "I", "R"] },
    default: () => new Map(),
  },

  // ── Empiric recommendations ─────────────────────────────────────
  recommendedFirstLine:  { type: [String], default: [] },
  recommendedSecondLine: { type: [String], default: [] },

  // ── Period grouping (e.g. "2026-06" or "2026-Q2") ───────────────
  period: { type: String, default: "", index: true },
  totalIsolates: { type: Number, default: 0 },

  notes: { type: String, default: "" },

  // ── Lifecycle ───────────────────────────────────────────────────
  status: { type: String, enum: ["Open", "InProgress", "Closed"], default: "Closed", index: true },

  // ── Idempotency / source ────────────────────────────────────────
  // sourceRef: server-generated UUID if none supplied by the caller.
  // Lets bulk-upload retries coalesce without double-writing.
  sourceRef:  { type: String, required: true, unique: true, index: true,
                default: () => crypto.randomUUID() },
  sourceType: { type: String, default: "Manual" },

  emittedAt:  { type: Date, default: Date.now, index: true },

  auditTrail: { type: [AuditSchema], default: [] },

  hospitalId:    { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  createdBy:     { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdByName: { type: String, default: "" },
  createdByRole: { type: String, default: "" },
}, { timestamps: true, collection: "antibiogram_registers" });

// ── Compound indexes ──────────────────────────────────────────────
AntibiogramRegisterSchema.index({ organism: 1, period: 1, ward: 1 });
AntibiogramRegisterSchema.index({ period: 1, sampleType: 1 });
AntibiogramRegisterSchema.index({ ward: 1, isolatedAt: -1 });
AntibiogramRegisterSchema.index({ status: 1, createdAt: -1 });

module.exports =
  mongoose.models.AntibiogramRegister ||
  mongoose.model("AntibiogramRegister", AntibiogramRegisterSchema);
