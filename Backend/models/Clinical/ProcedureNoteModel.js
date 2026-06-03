/**
 * ProcedureNoteModel.js — NABH COP.10 evidence
 *
 * Post-operative / post-procedural note. One document per completed OT
 * Procedure. Persisted by procedureNoteController.create() after the
 * surgeon finishes a case; that controller then transitions the linked
 * OTRegister row from "Scheduled" → "Completed" (or calls
 * nabhRegisterEmitter.emitOT as a fallback if no Scheduled row exists).
 *
 * Source linkage: every note belongs to ONE DoctorOrder where
 * `orderType="Procedure"` and `orderDetails.requiresOT=true`. The
 * doctorOrderId is the join key the OT register row uses to find the
 * matching scheduled case.
 *
 * NABH mapping:
 *   • COP.10 — Operating-theatre register evidence (actual procedure,
 *     surgeon, anaesthetist, complications, blood-loss, specimens).
 *   • COP.13 — Anaesthesia register feeds off the same note (ASA grade,
 *     anaesthesia type).
 *
 * Idempotency: a doctorOrderId may have at most one ProcedureNote (the
 * controller checks before insert + the unique sparse index below
 * enforces it at the DB level on concurrent saves).
 */
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const AuditSchema = new Schema({
  _id: false,
  action: {
    type: String,
    enum: ["CREATED", "AMENDED", "LOCKED"],
    required: true,
  },
  at: { type: Date, default: Date.now },
  byName: { type: String, default: "" },
  byRole: { type: String, default: "" },
  byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  notes: { type: String, default: "", maxlength: 500 },
});

const SpecimenSchema = new Schema({
  _id: false,
  name:   { type: String, default: "", trim: true },    // e.g. "Gallbladder", "Lymph node biopsy"
  sentTo: { type: String, default: "", trim: true },    // Histopath / Culture / Frozen section
  sentAt: { type: Date,   default: null },
});

const ProcedureNoteSchema = new Schema({
  // ── Patient / admission linkage ──
  patientId:        { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:             { type: String, required: true, uppercase: true, trim: true, index: true },
  patientName:      { type: String, default: "" },
  admissionId:      { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
  admissionNumber:  { type: String, default: "" },

  // ── Source order (the doctor order that booked the OT case) ──
  // Sparse unique index declared below enforces one note per order at the
  // DB layer; no field-level `index: true` here so we don't duplicate it.
  doctorOrderId:    { type: Schema.Types.ObjectId, ref: "DoctorOrder", default: null },

  // ── Procedure identification ──
  surgeryName:      { type: String, default: "", trim: true },
  actualProcedure:  { type: String, required: true, trim: true, maxlength: 2000 },

  // ── Timing ──
  startTime:        { type: Date, required: true },
  endTime:          { type: Date, required: true },
  // Auto-derived in pre-save hook below from (endTime - startTime).
  durationMinutes:  { type: Number, default: null, min: 0 },

  // ── Care team ──
  surgeon:          { type: String, default: "", trim: true },
  surgeonId:        { type: Schema.Types.ObjectId, ref: "User", default: null },
  assistantSurgeons:{ type: [String], default: [] },

  // ── Anaesthesia ──
  anaesthetistName: { type: String, default: "", trim: true },
  anaesthetistId:   { type: Schema.Types.ObjectId, ref: "User", default: null },
  anaesthesiaType:  {
    type: String,
    enum: ["", "General", "Spinal", "Epidural", "Regional", "Local", "MAC", "Sedation", "Combined"],
    default: "",
  },
  asaGrade: {
    type: String,
    enum: ["", "I", "II", "III", "IV", "V", "VI"],
    default: "",
  },

  // ── Outcome ──
  complications:    { type: String, default: "", maxlength: 2000 },
  bloodLossMl:      { type: Number, default: null, min: 0 },
  specimensSent:    { type: [SpecimenSchema], default: [] },

  // ── Post-op disposition ──
  postOpDestination: {
    type: String,
    enum: ["", "Ward", "ICU", "HDU", "Recovery", "Discharge"],
    default: "Recovery",
  },

  // ── Authorship + audit ──
  createdBy:        { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdByName:    { type: String, default: "" },
  createdByRole:    { type: String, default: "" },
  auditTrail:       { type: [AuditSchema], default: [] },

  hospitalId:       { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "procedure_notes" });

// One note per scheduled order. Sparse so legacy notes without a
// doctorOrderId (none today, but future free-form notes might exist)
// don't trip the uniqueness check.
ProcedureNoteSchema.index({ doctorOrderId: 1 }, { unique: true, sparse: true });
// Surveyor + workflow indexes
ProcedureNoteSchema.index({ UHID: 1, createdAt: -1 });
ProcedureNoteSchema.index({ admissionId: 1, createdAt: -1 });
ProcedureNoteSchema.index({ surgeonId: 1, createdAt: -1 });

// Auto-derive durationMinutes from (endTime - startTime). Computed on
// every save so an amendment of either timestamp recomputes the value;
// surveyors compare this against OTRegister.durationMinutes for
// consistency.
ProcedureNoteSchema.pre("save", function nextDuration(next) {
  try {
    if (this.startTime && this.endTime) {
      const ms = new Date(this.endTime).getTime() - new Date(this.startTime).getTime();
      if (Number.isFinite(ms) && ms >= 0) {
        this.durationMinutes = Math.round(ms / 60000);
      }
    }
  } catch (_) { /* non-fatal — leave durationMinutes as-is */ }
  next();
});

module.exports =
  mongoose.models.ProcedureNote ||
  mongoose.model("ProcedureNote", ProcedureNoteSchema);
