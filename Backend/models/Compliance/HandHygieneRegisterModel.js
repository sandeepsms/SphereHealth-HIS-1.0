/**
 * HandHygieneRegisterModel.js — R7gw-B9-B9-T06 / NABH HIC.3
 *
 * Hand-hygiene compliance register. Filled by IC officer / surveyor during
 * direct observation rounds (WHO 5-Moments framework). One row per
 * observation event (role × moment × complied). No auto-trigger — the IC
 * officer uses a mobile-friendly tap-to-record entry form.
 *
 * Compliance % = (# complied = true) / (# observations) per ward / role /
 * moment / period. Surveyors check trend monthly.
 *
 * UHID is OPTIONAL — most observations are anonymous (HCW × moment), not
 * patient-attributed. Where the observer chose to link to a specific
 * patient (e.g. an isolation case audit), UHID may be present.
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

const HandHygieneRegisterSchema = new Schema({
  // UHID optional — most HH observations are anonymous HCW × moment events.
  patientId:        { type: Schema.Types.ObjectId, ref: "Patient", default: null, index: true },
  UHID:             { type: String, uppercase: true, trim: true, default: "", index: true },
  patientName:      { type: String, default: "" },
  admissionId:      { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },

  // ── Observation context ─────────────────────────────────────────
  observedAt:       { type: Date, required: true, index: true },
  observedByEmpId:  { type: String, default: "", index: true },   // IC officer who watched
  observedByName:   { type: String, default: "" },
  observedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  ward:             { type: String, default: "", index: true },   // ICU / Med-1 / OT-2 etc.

  // ── WHO 5-Moments × Role × Compliance ───────────────────────────
  role: {
    type: String,
    enum: ["Doctor", "Nurse", "Allied", "Visitor"],
    required: true,
    index: true,
  },
  moment: {
    type: String,
    enum: [
      "BeforeTouchPatient",
      "BeforeCleanProcedure",
      "AfterBodyFluid",
      "AfterTouchPatient",
      "AfterTouchSurroundings",
    ],
    required: true,
    index: true,
  },
  complied:         { type: Boolean, required: true, index: true },
  technique:        { type: String, enum: ["Rub", "Wash", "Skip", "NotDone"], default: "NotDone" },
  notes:            { type: String, default: "" },

  // ── Lifecycle ───────────────────────────────────────────────────
  status: { type: String, enum: ["Open", "InProgress", "Closed"], default: "Closed", index: true },

  // ── Idempotency / source ────────────────────────────────────────
  // server-generated UUID via crypto.randomUUID() at emit time; lets repeated
  // POSTs of the same observation row coalesce when the mobile form retries.
  sourceRef:        { type: String, default: "", index: true },
  sourceType:       { type: String, default: "Manual" },

  emittedAt:        { type: Date, default: Date.now, index: true },

  auditTrail:       { type: [AuditSchema], default: [] },

  hospitalId:       { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
}, { timestamps: true, collection: "hand_hygiene_registers" });

HandHygieneRegisterSchema.index({ UHID: 1, observedAt: -1 });
HandHygieneRegisterSchema.index({ ward: 1, observedAt: -1 });
HandHygieneRegisterSchema.index({ role: 1, moment: 1, observedAt: -1 });
HandHygieneRegisterSchema.index({ complied: 1, observedAt: -1 });
HandHygieneRegisterSchema.index({ status: 1, createdAt: -1 });

module.exports =
  mongoose.models.HandHygieneRegister ||
  mongoose.model("HandHygieneRegister", HandHygieneRegisterSchema);
