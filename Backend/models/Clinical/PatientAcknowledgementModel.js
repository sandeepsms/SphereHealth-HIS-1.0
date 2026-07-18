/**
 * PatientAcknowledgementModel.js — NABH PRE.1/PRE.4 + DPDP Act 2023
 *
 * Per-patient acknowledgements + informational consents that aren't
 * procedure-specific (those live in ConsentForm). One record per
 * acknowledgement event:
 *   • RIGHTS_HANDOUT     — patient/kin received & acknowledged the Patient
 *                          Rights & Responsibilities charter (PRE.1).
 *   • DPDP_CONSENT       — consent to process personal data (DPDP Act 2023).
 *   • BIOMETRIC_CONSENT  — explicit consent to capture/process biometric data
 *                          (fingerprint / face used for positive ID).
 *   • RESPONSIBILITIES   — patient responsibilities acknowledged.
 *
 * Consent types carry `consentGranted`; the rights handout is an acknowledge-
 * ment (granted defaults true). Withdrawable — DPDP grants the data principal
 * a right to withdraw, captured via withdrawnAt.
 */
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const PatientAcknowledgementSchema = new Schema(
  {
    UHID: { type: String, uppercase: true, trim: true, required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", default: null },
    admissionId: { type: Schema.Types.ObjectId, ref: "Admission", default: null, index: true },

    type: {
      type: String,
      enum: ["RIGHTS_HANDOUT", "DPDP_CONSENT", "BIOMETRIC_CONSENT", "RESPONSIBILITIES"],
      required: true,
      index: true,
    },
    documentVersion: { type: String, default: "v1" },  // charter / notice version acknowledged

    // Consent semantics (rights-handout defaults granted=true).
    consentGranted: { type: Boolean, default: true },
    // DPDP purpose limitation — what the data is processed for.
    purpose: { type: String, default: "" },
    dataCategories: { type: [String], default: [] }, // e.g. ["biometric","contact","clinical"]

    // Who acknowledged + how.
    acknowledgedByName: { type: String, default: "" },     // patient or kin name
    relationship: { type: String, default: "Self" },        // Self / Spouse / Parent / Guardian
    method: { type: String, enum: ["Signed", "Verbal", "Digital", "Thumb-impression"], default: "Signed" },
    language: { type: String, default: "" },                // language the notice was given in
    acknowledgedAt: { type: Date, default: Date.now, index: true },

    witnessedByName: { type: String, default: "" },
    capturedByName: { type: String, default: "" },
    capturedById: { type: Schema.Types.ObjectId, ref: "User", default: null },

    // Withdrawal (DPDP right to withdraw consent).
    withdrawnAt: { type: Date, default: null },
    withdrawnReason: { type: String, default: "" },

    attachmentRef: { type: String, default: "" },  // scanned signed copy id
    notes: { type: String, default: "" },

    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "patient_acknowledgements" },
);

PatientAcknowledgementSchema.index({ UHID: 1, type: 1, acknowledgedAt: -1 });

module.exports =
  mongoose.models.PatientAcknowledgement ||
  mongoose.model("PatientAcknowledgement", PatientAcknowledgementSchema);
