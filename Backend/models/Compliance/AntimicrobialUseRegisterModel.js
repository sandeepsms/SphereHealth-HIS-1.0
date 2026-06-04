/**
 * AntimicrobialUseRegisterModel.js — R7bu / NABH MOM.7
 *
 * Antimicrobial stewardship register. One row per antibiotic order.
 * Auto-populated by nabhRegisterEmitter.emitAntimicrobial when a
 * DoctorOrder of type="Medication" is created with a medicineName that
 * matches the curated antibiotic list (see ANTIBIOTIC_NAMES in the
 * emitter).
 *
 * NABH MOM.7 + AMS surveyors track:
 *   - antibiotic name + dose + route + duration;
 *   - indication (empirical vs targeted);
 *   - culture-result-pending flag (drives de-escalation review);
 *   - prophylactic flag (surgical prophylaxis ≤24h is the target);
 *   - de-escalation timestamp (downgrade from broad → narrow).
 *
 * Used for monthly AMSC (Antimicrobial Stewardship Committee) review.
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: {
    type: String,
    enum: [
      "ORDERED",
      "STARTED",
      "CULTURE_SENT",
      "CULTURE_RECEIVED",
      "DEESCALATED",
      "ESCALATED",
      "DISCONTINUED",
      "REVIEWED",
      "AMENDED",
    ],
    required: true,
  },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "", maxlength: 500 },
});

const AntimicrobialUseRegisterSchema = new Schema({
  // ── Patient / admission ──
  patientId:   { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:        { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName: { type: String, default: "" },
  age:         { type: Number, default: null },
  sex:         { type: String, default: "" },
  admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
  admissionNumber: { type: String, default: "" },
  ward:        { type: String, default: "" },

  // ── Drug ──
  antibiotic:    { type: String, required: true, trim: true, index: true },
  antibioticClass: {
    type: String,
    default: "",
    index: true,
  },              // beta-lactam / fluoroquinolone / glycopeptide / carbapenem etc.
  watchAccessReserve: {
    type: String,
    enum: ["", "Access", "Watch", "Reserve"],
    default: "",
    index: true,
  },              // WHO AWaRe classification

  dose:     { type: String, default: "" },          // "1 g IV q8h"
  route:    { type: String, default: "" },          // IV / PO / IM / Topical
  frequency:{ type: String, default: "" },          // OD / BD / TDS / q6h
  duration: { type: String, default: "" },          // "5 days" / "7 days"
  startedAt:{ type: Date, default: null, index: true },
  stoppedAt:{ type: Date, default: null },

  // ── Indication ──
  indication:    { type: String, required: true, trim: true, default: "" },
  indicationType: {
    type: String,
    enum: ["Empirical", "Targeted", "Prophylactic", "Definitive", "Unknown"],
    default: "Unknown",
    index: true,
  },
  suspectedSite: { type: String, default: "" },     // UTI / RTI / SSTI / bloodstream / intra-abdo
  prophylactic:  { type: Boolean, default: false, index: true },
  prophylaxisType: {
    type: String,
    enum: ["", "Surgical", "Medical", "PostExposure"],
    default: "",
  },
  prophylaxisDurationHours: { type: Number, default: null },  // target ≤24h for SAP

  // ── Microbiology linkage ──
  cultureSent:           { type: Boolean, default: false, index: true },
  cultureSentAt:         { type: Date, default: null },
  cultureResultPending:  { type: Boolean, default: true, index: true },
  cultureResult:         { type: String, default: "" },      // organism + sensitivity summary
  cultureResultAt:       { type: Date, default: null },
  cultureReportId:       { type: Schema.Types.ObjectId, default: null },

  // ── De-escalation (NABH MOM.7 + AMSC) ──
  deescalated:           { type: Boolean, default: false, index: true },
  deescalatedAt:         { type: Date, default: null },
  deescalatedTo:         { type: String, default: "" },      // new narrow agent
  deescalatedBy:         { type: String, default: "" },
  deescalatedByUserId:   { type: Schema.Types.ObjectId, ref: "User", default: null },

  // ── Ordering doctor ──
  orderingDoctor:    { type: String, default: "" },
  orderingDoctorId:  { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  doctorOrderId:     { type: Schema.Types.ObjectId, ref: "DoctorOrder", default: null, index: true },

  // ── Stewardship review ──
  reviewedBy:        { type: Schema.Types.ObjectId, ref: "User", default: null },
  reviewedByName:    { type: String, default: "" },
  reviewedAt:        { type: Date, default: null },
  reviewOutcome: {
    type: String,
    enum: ["", "Appropriate", "Continue", "De-escalate", "Escalate", "Stop", "Substitute"],
    default: "",
  },
  reviewNotes:       { type: String, default: "" },

  // ── Adverse events / outcomes ──
  adverseDrugReaction: { type: Boolean, default: false },
  adrNotes:            { type: String, default: "" },
  cDiffOccurred:       { type: Boolean, default: false },     // post-antibiotic C-diff

  // ── Status ──
  status: {
    type: String,
    enum: ["Active", "Discontinued", "Completed"],
    default: "Active",
    index: true,
  },

  // ── Source / audit ──
  sourceRef:  { type: Schema.Types.ObjectId, default: null },
  sourceType: { type: String, default: "DoctorOrder" },
  occurredAt: { type: Date, default: Date.now, index: true },
  auditTrail: { type: [AuditSchema], default: [] },

  createdBy:     { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdByName: { type: String, default: "" },
  createdByRole: { type: String, default: "" },

  hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "antimicrobial_use_registers" });

// Surveyor + AMSC review indexes
AntimicrobialUseRegisterSchema.index({ UHID: 1, admissionId: 1 });
AntimicrobialUseRegisterSchema.index({ UHID: 1, occurredAt: -1 });
AntimicrobialUseRegisterSchema.index({ admissionId: 1, occurredAt: -1 });
AntimicrobialUseRegisterSchema.index({ antibiotic: 1, startedAt: -1 });
AntimicrobialUseRegisterSchema.index({ watchAccessReserve: 1, startedAt: -1 });
AntimicrobialUseRegisterSchema.index({ cultureResultPending: 1, startedAt: -1 });
AntimicrobialUseRegisterSchema.index({ prophylactic: 1, startedAt: -1 });
AntimicrobialUseRegisterSchema.index({ status: 1, occurredAt: -1 });
// Idempotency: one register row per DoctorOrder
AntimicrobialUseRegisterSchema.index(
  { doctorOrderId: 1 },
  { unique: true, sparse: true, name: "uniq_amu_doctor_order" },
);
// R7hr-33 (audit P0-1): pharmacy-sourced rows have doctorOrderId=null, so
// the sparse index above does NOT dedup them. A retry/replay of
// POST /pharmacy/sales (already-committed Sale, new request reaches the
// emit hook) would create a second AMU row per item. Compound unique
// sparse on (sourceType, sourceRef, antibiotic) closes this — same
// (sale, drugName) tuple can only land once. Sparse on sourceRef means
// legacy rows with sourceRef=null don't conflict.
AntimicrobialUseRegisterSchema.index(
  { sourceType: 1, sourceRef: 1, antibiotic: 1 },
  { unique: true, sparse: true, name: "uniq_amu_source_drug" },
);

module.exports =
  mongoose.models.AntimicrobialUseRegister ||
  mongoose.model("AntimicrobialUseRegister", AntimicrobialUseRegisterSchema);
