// models/Clinical/ConsentFormModel.js
// NABH Standard: PRE.3, PRE.4 — Informed Consent

const mongoose = require("mongoose");

const ConsentFormSchema = new mongoose.Schema(
  {
    // ── Patient Info ─────────────────────────────────────────
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true },
    UHID: { type: String, required: true, trim: true },
    patientName: { type: String, trim: true },
    age: { type: String },
    gender: { type: String },

    admissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission" },
    ipdNo: { type: String, index: true },

    // ── Consent Details ──────────────────────────────────────
    consentType: {
      type: String,
      enum: [
        "GENERAL_ADMISSION",
        "SURGICAL",
        "PROCEDURE",
        "ANESTHESIA",
        "BLOOD_TRANSFUSION",
        "HIV_TESTING",
        "LAMA",
        "DNR",
        "INFORMATION_RELEASE",
        "PHOTOGRAPHY",
        "RESEARCH",
        "OTHER",
      ],
      required: true,
      index: true },
    consentTitle: { type: String, required: true, trim: true },
    procedureDescription: { type: String },
    risksDisclosed: [{ type: String, trim: true }],
    benefitsExplained: [{ type: String, trim: true }],
    alternativesDisclosed: [{ type: String, trim: true }],

    // ── Language & Communication ─────────────────────────────
    languageUsed: { type: String, default: "Hindi", trim: true },
    interpreterRequired: { type: Boolean, default: false },
    interpreterName: { type: String, trim: true },

    // ── Consent Giver ────────────────────────────────────────
    // FIX (audit P18-B1): enum was missing RELATIVE / LEGAL_REP that the
    // frontend <select> offers, so those values silently failed save and
    // the user was told "preview mode" instead of a real error. Now
    // accepts every option the UI exposes.
    consentGivenBy: {
      type: String,
      enum: ["SELF", "GUARDIAN", "SPOUSE", "PARENT", "SIBLING", "RELATIVE", "LEGAL_REP", "OTHER"],
      default: "SELF" },
    guardianName: { type: String, trim: true },
    guardianRelation: { type: String, trim: true },
    guardianContact: { type: String, trim: true },

    // ── Signatures (text-based acknowledgement) ──────────────
    patientAcknowledged: { type: Boolean, default: false },
    witnessName: { type: String, trim: true },
    witnessRelation: { type: String, trim: true },

    // ── Doctor who explained ─────────────────────────────────
    explainedByDoctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor" },
    explainedByDoctorName: { type: String, trim: true },
    doctorRegNo: { type: String, trim: true },

    // ── Status ───────────────────────────────────────────────
    status: {
      type: String,
      enum: ["PENDING", "SIGNED", "REFUSED", "REVOKED"],
      default: "PENDING" },
    signedAt:      { type: Date },
    signedByName:  { type: String, trim: true, default: "" },
    signedByRole:  { type: String, trim: true, default: "" },
    refusalReason: { type: String },
    refusedAt:     { type: Date },
    refusedByName: { type: String, trim: true, default: "" },
    revokedAt:     { type: Date },
    revokedReason: { type: String },
    revokedByName: { type: String, trim: true, default: "" },

    additionalNotes: { type: String },

    // ── Audit trail (NABH PRE.3 / PRE.4) ─────────────────────
    // Every state transition (sign / refuse / revoke / amend) appends an
    // immutable entry — captures who, when, IP, and any free-text reason.
    auditTrail: [{
      _id:        false,
      action:     { type: String, enum: ["CREATED", "UPDATED", "SIGNED", "REFUSED", "REVOKED", "PRINTED"], required: true },
      at:         { type: Date, default: Date.now },
      byName:     { type: String, default: "" },
      byRole:     { type: String, default: "" },
      byUserId:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      ip:         { type: String, default: "" },
      userAgent:  { type: String, default: "" },
      reason:     { type: String, default: "" },
    }],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" } },
  { timestamps: true, collection: "consent_forms" }
);

ConsentFormSchema.index({ UHID: 1, consentType: 1 });
ConsentFormSchema.index({ admissionId: 1, consentType: 1 });
ConsentFormSchema.index({ status: 1 });

module.exports =
  mongoose.models.ConsentForm ||
  mongoose.model("ConsentForm", ConsentFormSchema);
