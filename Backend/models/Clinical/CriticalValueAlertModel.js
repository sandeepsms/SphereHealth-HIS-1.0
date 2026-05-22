/**
 * CriticalValueAlertModel.js  (R7bf-G / A5-CRIT-1 / NABH AAC.6 + IPSG.2)
 *
 * Critical / panic-value alert ledger. NABH AAC.6 + IPSG.2 require that
 * every life-threatening lab result (e.g. K+ > 6.5 mmol/L), critical
 * vital sign (SpO2 < 90 %, BP > 180/110), drug-allergy contradiction
 * or imaging "red-flag" finding is escalated to the treating clinician
 * within a defined SLA (typically 30 min), acknowledged by name, and
 * logged for audit.
 *
 * Pre-R7bf there was NO such ledger. The R7bd META audit claimed a
 * critical-value-alert reship that never landed; this is the proper
 * implementation that finally closes A5-CRIT-1.
 *
 * Lifecycle: OPEN → ACK | ESCALATED → CLOSED
 *   OPEN       — alert emitted, awaiting acknowledgement
 *   ACK        — clinician acknowledged inside SLA window
 *   ESCALATED  — overdue alert auto-bumped to charge-nurse / on-call
 *   CLOSED     — clinical action taken + alert resolved
 *
 * Audit: every state transition appends an immutable `auditTrail[]` row.
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditEntrySchema = new Schema(
  {
    _id:      false,
    action:   { type: String, enum: ["EMITTED", "ACKNOWLEDGED", "ESCALATED", "CLOSED", "NOTE"], required: true },
    at:       { type: Date, default: Date.now },
    byName:   { type: String, default: "" },
    byRole:   { type: String, default: "" },
    byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reason:   { type: String, default: "" },
  },
);

const CriticalValueAlertSchema = new Schema(
  {
    // ── What kind of critical value is this? ───────────────────
    kind: {
      type: String,
      enum: ["LAB", "VITAL", "DRUG", "IMAGING", "OTHER"],
      required: true,
      index: true,
    },

    // ── Patient ───────────────────────────────────────────────
    patientUHID: { type: String, required: true, trim: true, uppercase: true, index: true },
    patientName: { type: String, trim: true, default: "" },

    // ── Where did this come from? ─────────────────────────────
    // sourceRef is the originating document (a LabResult, Vital,
    // DrugAllergy, ImagingReport, …). We don't lock to a single ref
    // collection because the catalogue is diverse; sourceKind keeps
    // it grep-able.
    sourceRef:  { type: Schema.Types.ObjectId, default: null },
    sourceKind: { type: String, default: "" },

    // The human-readable value being flagged. Examples:
    //   "K+ 6.8 mmol/L"
    //   "SpO2 82% on RA"
    //   "Allergy: Penicillin — order #ORD-2026-04412"
    valueLabel: { type: String, required: true, trim: true },

    severity: {
      type: String,
      enum: ["CRITICAL", "PANIC"],
      default: "CRITICAL",
      index: true,
    },

    // ── Emission ──────────────────────────────────────────────
    emittedAt:   { type: Date, default: Date.now, index: true },
    emittedBy:   { type: String, default: "system" },     // "system" | user fullName
    emittedById: { type: Schema.Types.ObjectId, ref: "User", default: null },

    // ── SLA + Acknowledgement ─────────────────────────────────
    slaMinutes: { type: Number, default: 30, min: 1 },

    acknowledgedAt:     { type: Date, default: null },
    acknowledgedBy:     { type: Schema.Types.ObjectId, ref: "User", default: null },
    acknowledgedByName: { type: String, default: "" },
    acknowledgedByRole: { type: String, default: "" },

    // ── Escalation ────────────────────────────────────────────
    escalatedAt:   { type: Date, default: null },
    escalatedTo:   { type: String, default: "" },         // role label ("Nurse" / "Doctor" / "Admin")
    escalatedToId: { type: Schema.Types.ObjectId, ref: "User", default: null },

    // ── Closure ───────────────────────────────────────────────
    closedAt:   { type: Date, default: null },
    closedBy:   { type: Schema.Types.ObjectId, ref: "User", default: null },
    closedByName: { type: String, default: "" },

    // ── State ─────────────────────────────────────────────────
    status: {
      type: String,
      enum: ["OPEN", "ACK", "ESCALATED", "CLOSED"],
      default: "OPEN",
      index: true,
    },

    notes: { type: String, default: "" },

    // Append-only audit. Service writers push; never overwrite.
    auditTrail: { type: [AuditEntrySchema], default: [] },

    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "critical_value_alerts" },
);

// Common indices for the open-queue and per-patient drill-down.
CriticalValueAlertSchema.index({ status: 1, emittedAt: -1 });
CriticalValueAlertSchema.index({ patientUHID: 1, emittedAt: -1 });
CriticalValueAlertSchema.index({ status: 1, slaMinutes: 1, emittedAt: 1 }); // escalateOverdue scan

module.exports =
  mongoose.models.CriticalValueAlert ||
  mongoose.model("CriticalValueAlert", CriticalValueAlertSchema);
