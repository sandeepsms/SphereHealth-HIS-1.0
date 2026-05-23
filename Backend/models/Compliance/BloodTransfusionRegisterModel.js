/**
 * BloodTransfusionRegisterModel.js — R7bo / NABH MOM.4 + COP.16
 *
 * Chronological log of every blood/blood-product transfusion. Auto-populated
 * by nabhRegisterEmitter.emitBloodTransfusion when a doctor places an order
 * with orderType="BloodTransfusion" (existing DoctorOrderModel enum). Then
 * progressively updated as cross-match → release → transfusion → post-monitor
 * happen. Reaction window stays open for 48 h post end.
 *
 * Cross-links into ADRReport when a transfusion reaction is logged.
 */
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const VitalsSchema = new Schema(
  {
    _id: false,
    at: { type: Date, default: Date.now },
    bp: { type: String, default: "" },
    pulse: { type: Number, default: null, min: 0, max: 300 },
    temp: { type: Number, default: null, min: 25, max: 45 },
    spo2: { type: Number, default: null, min: 0, max: 100 },
    recordedByName: { type: String, default: "" },
    recordedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
);

const BagSchema = new Schema(
  {
    _id: false,
    bagNumber: { type: String, required: true, trim: true, uppercase: true },
    productType: {
      type: String,
      enum: ["PRBC", "FFP", "Platelet", "Cryo", "Whole_Blood", "SDP", "Albumin"],
      required: true,
    },
    volumeMl: { type: Number, default: 0, min: 0, max: 5000 },
    bagExpiryAt: { type: Date, default: null },
    issuedAt: { type: Date, default: null },
    issuedBy: { type: String, default: "" },
  },
);

const AuditSchema = new Schema(
  {
    _id: false,
    action: {
      type: String,
      enum: [
        "ORDERED", "CROSS_MATCHED", "BLOOD_RELEASED", "TRANSFUSION_STARTED",
        "INTRA_VITALS", "TRANSFUSION_ENDED", "POST_VITALS", "REACTION_LOGGED",
        "DISPOSAL", "LOCKED",
      ],
      required: true,
    },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: "" },
    byRole: { type: String, default: "" },
    byUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    notes: { type: String, default: "", maxlength: 500 },
  },
);

const BloodTransfusionRegisterSchema = new Schema(
  {
    // ── Auto-serial: BTR-YYYY-NNNNNN ──
    btNumber: { type: String, required: true, unique: true, index: true },

    // ── Patient ──
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
    UHID: { type: String, required: true, uppercase: true, trim: true, index: true },
    patientName: { type: String, default: "" },
    age: { type: Number, default: null },
    sex: { type: String, default: "" },

    admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
    admissionNumber: { type: String, default: "" },
    ward: { type: String, default: "" },

    // ── Request (auto-populated from DoctorOrder) ──
    doctorOrderId: { type: Schema.Types.ObjectId, ref: "DoctorOrder", default: null, index: true },
    requestedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    requestedByName: { type: String, default: "" },
    requestedAt: { type: Date, default: Date.now },
    indication: { type: String, default: "" },

    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"],
      default: "Unknown",
    },
    rhFactor: { type: String, enum: ["+", "-", ""], default: "" },
    unitsRequested: { type: Number, default: 1, min: 1, max: 20 },

    // ── Source ──
    source: {
      isInHouse: { type: Boolean, default: true },
      bloodBankName: { type: String, default: "" },
      nablCertified: { type: Boolean, default: false },
      certificateNumber: { type: String, default: "" },
    },

    // ── Cross-match ──
    crossMatch: {
      result: { type: String, enum: ["", "Compatible", "Incompatible", "Urgent_Uncrossmatched"], default: "" },
      doneByName: { type: String, default: "" },
      doneAt: { type: Date, default: null },
      validUntil: { type: Date, default: null },
      notes: { type: String, default: "" },
    },

    // ── Bag(s) issued ──
    bagsIssued: { type: [BagSchema], default: [] },

    // ── Release ──
    release: {
      releasedAt: { type: Date, default: null },
      releasedByName: { type: String, default: "" },
      receivedInWardAt: { type: Date, default: null },
      transportedBy: { type: String, default: "" },
    },

    // ── Pre-transfusion ──
    preTransfusion: {
      vitals: { type: VitalsSchema, default: () => ({}) },
      hbGdL: { type: Number, default: null, min: 0, max: 25 },
      consentSigned: { type: Boolean, default: false },
      premedsGiven: { type: String, default: "" },
    },

    // ── Transfusion execution ──
    startedAt: { type: Date, default: null, index: true },
    endedAt: { type: Date, default: null },
    durationMinutes: { type: Number, default: null, min: 0 },
    rateMlPerHr: { type: Number, default: null, min: 0 },
    transfusedByName: { type: String, default: "" },

    // ── Intra-transfusion vitals (Q15min × 1h then Q1h) ──
    intraVitals: { type: [VitalsSchema], default: [] },

    // ── Post-transfusion ──
    postTransfusion: {
      vitals: { type: VitalsSchema, default: () => ({}) },
      hbGdL: { type: Number, default: null, min: 0, max: 25 },
      followUp24h: { type: VitalsSchema, default: () => ({}) },
    },

    // ── Reaction (window stays open 48 h post end) ──
    reaction: {
      occurred: { type: Boolean, default: false, index: true },
      type: {
        type: String,
        enum: ["", "None", "AHTR", "DHTR", "FNHTR", "Allergic", "TRALI", "TACO", "Bacterial"],
        default: "",
      },
      severity: { type: String, enum: ["", "Mild", "Moderate", "Severe", "Life-threatening"], default: "" },
      onsetAt: { type: Date, default: null },
      minutesIntoTransfusion: { type: Number, default: null },
      description: { type: String, default: "", maxlength: 1000 },
      reportedToBloodBankAt: { type: Date, default: null },
      reportedToBloodBankBy: { type: String, default: "" },
      adrReportId: { type: Schema.Types.ObjectId, ref: "ADRReport", default: null },
      managementTaken: { type: String, default: "" },
      outcome: { type: String, enum: ["", "Resolved", "Ongoing", "Escalated"], default: "" },
      reportingWindowEndsAt: { type: Date, default: null },
    },

    // ── Disposal / wastage ──
    disposal: {
      wastageVolumeMl: { type: Number, default: 0, min: 0 },
      wastageReason: { type: String, enum: ["", "Expired", "Contamination", "Incomplete_use", "Transfusion_cancelled"], default: "" },
      returnedTo: { type: String, default: "" },
      returnedAt: { type: Date, default: null },
      returnedByName: { type: String, default: "" },
    },

    // ── Workflow state ──
    status: {
      type: String,
      enum: ["Draft", "Cross-matched", "Released", "In-progress", "Completed", "Reaction-pending", "Cancelled"],
      default: "Draft",
      index: true,
    },

    // ── Append-only lock (after status=Completed + reaction-window expires) ──
    locked: { type: Boolean, default: false, index: true },
    lockedAt: { type: Date, default: null },

    auditTrail: { type: [AuditSchema], default: [] },

    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "blood_transfusion_registers" },
);

// NABH inspection indexes
BloodTransfusionRegisterSchema.index({ UHID: 1, startedAt: -1 });
BloodTransfusionRegisterSchema.index({ startedAt: -1 });
BloodTransfusionRegisterSchema.index({ "bagsIssued.bagNumber": 1 });
BloodTransfusionRegisterSchema.index({ "reaction.occurred": 1, startedAt: -1 });
BloodTransfusionRegisterSchema.index({ status: 1, startedAt: -1 });

module.exports =
  mongoose.models.BloodTransfusionRegister ||
  mongoose.model("BloodTransfusionRegister", BloodTransfusionRegisterSchema);
