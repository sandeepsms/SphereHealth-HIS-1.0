/**
 * PhysioSessionModel.js — R7bj-F1.
 *
 * One row per physiotherapy session delivered (or scheduled). The plan
 * (PhysioPlanModel) is the parent; sessions inherit the patient identity
 * and modality whitelist from it. The session is the unit that bills —
 * every COMPLETED session emits a BillingTrigger (PHYSIO_SESSION source-
 * type, IPD-PHY-001 service code, fee from session.sessionFee).
 *
 * sessionFee is stored as Decimal128 so long-stay rehab patients (60-
 * session courses for stroke / post-op) don't drift on summing. toJSON
 * unwraps via the shared utils/money.decimalToNumber.
 *
 * Status transitions are atomic (findOneAndUpdate with a status-guard
 * filter) so two therapists can't double-complete the same session from
 * adjacent tabs.
 *
 * Indexes target the three hot reads:
 *   - per-plan session list (plan detail / progress chart)
 *   - per-UHID timeline (IPD file render)
 *   - per-therapist productivity (stats dashboard)
 *   - status sweeps (find SCHEDULED rows for today's worklist)
 */
"use strict";

const mongoose = require("mongoose");
const { toDec, decimalToNumber } = require("../../utils/money");
const Dec = mongoose.Schema.Types.Decimal128;

const TOLERANCE_ENUM = ["GOOD", "FAIR", "POOR"];
const STATUS_ENUM    = ["SCHEDULED", "COMPLETED", "MISSED", "CANCELLED"];

const PhysioSessionSchema = new mongoose.Schema({
  // ── Parent plan + denormalised patient context ──────────────
  planId:         { type: mongoose.Schema.Types.ObjectId, ref: "PhysioPlan", required: true, index: true },
  admissionId:    { type: mongoose.Schema.Types.ObjectId, ref: "Admission", index: true },
  UHID:           { type: String, trim: true, uppercase: true },
  patientName:    { type: String, default: "" },

  // ── Session timing ──────────────────────────────────────────
  sessionDate:    { type: Date, default: Date.now, index: -1 },

  // ── Modality executed ───────────────────────────────────────
  // Service-level guard: sessionType must be a member of the parent
  // plan.modalitySet — controller / service enforces (we don't FK the
  // enum here because plan.modalitySet is the source of truth).
  sessionType:    { type: String, default: "" },
  duration_min:   { type: Number, min: 5, max: 120 },
  modalitiesUsed: { type: [String], default: [] },

  // ── Clinical observations ───────────────────────────────────
  painScoreBefore:  { type: Number, min: 0, max: 10 },
  painScoreAfter:   { type: Number, min: 0, max: 10 },
  tolerance:        { type: String, enum: TOLERANCE_ENUM },
  patientCompliant: { type: Boolean, default: true },
  notes:            { type: String, default: "" },

  // ── Billing handoff (Decimal128 so long courses don't drift) ─
  sessionFee:       { type: Dec, default: () => toDec(0) },

  // ── Signature (therapist who completed the session) ─────────
  signedById:       { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  signedByName:     { type: String, default: "" },
  signedAt:         { type: Date, default: null },

  // ── Lifecycle ───────────────────────────────────────────────
  status:           { type: String, enum: STATUS_ENUM, default: "SCHEDULED", index: true },
  cancelledReason:  { type: String, default: "" },

  // ── Billing trigger linkage ─────────────────────────────────
  // Set by _emitPhysioBillingTrigger after the BillingTrigger.create
  // resolves. The trigger row's sourceDocumentRef points back at this
  // session._id so the audit ledger can replay both directions.
  billingTriggerId: { type: mongoose.Schema.Types.ObjectId, ref: "BillingTrigger", default: null },

  // ── Print counter ───────────────────────────────────────────
  printCount:       { type: Number, default: 0 },

  // ── Multi-tenancy ───────────────────────────────────────────
  hospitalId:       { type: mongoose.Schema.Types.ObjectId, ref: "Hospital" },
}, { timestamps: true });

// Hot-path indexes.
PhysioSessionSchema.index({ planId: 1, sessionDate: -1 });
PhysioSessionSchema.index({ UHID: 1, sessionDate: -1 });
PhysioSessionSchema.index({ status: 1, sessionDate: -1 });
PhysioSessionSchema.index({ signedById: 1, signedAt: -1 });

// Serialize Decimal128 sessionFee back to a plain Number on the wire so
// the frontend currency-format helpers don't choke on $numberDecimal.
PhysioSessionSchema.set("toJSON",   { transform: decimalToNumber });
PhysioSessionSchema.set("toObject", { transform: decimalToNumber });

module.exports = mongoose.model("PhysioSession", PhysioSessionSchema);

module.exports.TOLERANCE_ENUM = TOLERANCE_ENUM;
module.exports.STATUS_ENUM    = STATUS_ENUM;
