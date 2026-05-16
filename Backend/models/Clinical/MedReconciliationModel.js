// models/Clinical/MedReconciliationModel.js
// ═══════════════════════════════════════════════════════════════
// NABH MOM.4d — Medication Reconciliation on Admit + Discharge.
//
// Captures a per-drug three-way diff between:
//   • Home  — patient's medications BEFORE admission (from intake)
//   • Inpatient — what's actually being administered during the stay
//                 (joined from DoctorOrder + MAR at view time)
//   • Discharge — what the doctor is prescribing on discharge
//
// Each row carries the doctor's explicit action — Continue / Modify /
// Stop / New — with a reason. NABH wants this signed at both reference
// points (admission day and discharge day); we represent that with two
// `reviewedAt` / `reviewedBy` fields, one per phase.
//
// The document is keyed by admissionId — one reconciliation record per
// admission. Doctors can keep updating the row over the stay; the
// final state at discharge is the official record.
// ═══════════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const ACTION_ENUM = ["CONTINUE", "MODIFY", "STOP", "NEW", "HOLD"];

const ReconRowSchema = new mongoose.Schema({
  // Drug identification — same fields across the three columns so the
  // UI can diff them on display.
  drugName:    { type: String, required: true, trim: true },
  dose:        { type: String, default: "" },
  route:       { type: String, default: "" },
  frequency:   { type: String, default: "" },
  duration:    { type: String, default: "" },
  indication:  { type: String, default: "" },

  // Which column was this drug surfaced in initially?
  source: {
    type: String,
    enum: ["home", "inpatient", "discharge", "added"],
    default: "home",
  },

  // Cross-references back to inpatient orders if the row was matched
  // against an active DoctorOrder.
  doctorOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorOrder", default: null },

  // The doctor's explicit action at the discharge review.
  action: { type: String, enum: ACTION_ENUM, default: "CONTINUE" },
  // Free-text reason when action !== CONTINUE (mandatory for STOP/MODIFY).
  actionReason: { type: String, default: "" },

  // True once the doctor confirms this individual row at discharge.
  signedAt:    { type: Date, default: null },
  signedBy:    { type: String, default: "" },
  signedByReg: { type: String, default: "" },
}, { _id: true });

const MedReconciliationSchema = new mongoose.Schema(
  {
    // ── Patient + admission anchor ─────────────────────────
    UHID:         { type: String, required: true, trim: true, index: true, uppercase: true },
    patientName:  { type: String, default: "" },
    admissionId:  { type: mongoose.Schema.Types.ObjectId, ref: "Admission", required: true, index: true, unique: true },
    ipdNo:        { type: String, default: "" },

    // ── Phase tracking ─────────────────────────────────────
    // Reconciliation is signed once at admission and once at discharge.
    // Each has its own reviewer + timestamp.
    admitReviewedAt:    { type: Date, default: null },
    admitReviewedBy:    { type: String, default: "" },
    admitReviewedByReg: { type: String, default: "" },

    dischargeReviewedAt:    { type: Date, default: null },
    dischargeReviewedBy:    { type: String, default: "" },
    dischargeReviewedByReg: { type: String, default: "" },

    // ── The actual list ────────────────────────────────────
    rows: { type: [ReconRowSchema], default: [] },

    // Free-text notes the doctor adds at discharge ("Stop ASA, bleeding risk").
    summaryNotes: { type: String, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, collection: "med_reconciliations" }
);

module.exports =
  mongoose.models.MedReconciliation ||
  mongoose.model("MedReconciliation", MedReconciliationSchema);

module.exports.ACTION_ENUM = ACTION_ENUM;
