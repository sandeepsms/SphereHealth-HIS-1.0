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
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },

    // R7bh-F1 / R7bg-7-CRIT-2: PrintAudit infrastructure $incs this on
    // every print/reprint. Pre-R7bh ConsentForm had no printCount
    // field, so $inc no-op'd and the DUPLICATE watermark + PrintAudit
    // chain-of-custody (NABH PRE.4) didn't engage on reprints.
    printCount: { type: Number, default: 0 },

    // ── R7ez · Paperless consent — biometric + staff e-sign ──────────
    //
    // Three blocks that together replace the paper "thumb impression +
    // doctor signature" artefact on every consent. The /sign endpoint
    // now refuses to flip status PENDING→SIGNED unless either:
    //   • biometric.captured === true AND staffSignature.signedAt set
    //   • bypass.authorisedAt set by an Admin (with reason)
    consentingParty: {
      // "Who placed the fingerprint?". Either the patient themselves or
      // a legally authorised representative (LAR). Captured even if the
      // form was filled by staff so the audit chain knows whose finger
      // touched the device.
      relation: {
        type: String,
        enum: ["SELF", "SPOUSE", "FATHER", "MOTHER", "SON", "DAUGHTER", "GUARDIAN", "LAR", "OTHER"],
      },
      relationOther: { type: String, trim: true },
      name: { type: String, trim: true },
      idProofType: {
        type: String,
        enum: ["AADHAAR", "PAN", "DRIVING_LICENSE", "PASSPORT", "VOTER_ID", "OTHER", ""],
        default: "",
      },
      idProofNumber: { type: String, trim: true },
      contactNumber: { type: String, trim: true },
    },

    biometric: {
      captured: { type: Boolean, default: false },
      method: {
        // WEBAUTHN: platform authenticator via Windows Hello / Touch ID
        // MANUAL:   external fingerprint device (out of scope this phase)
        // BYPASS:   no biometric — admin override, see `bypass` block below
        type: String,
        enum: ["WEBAUTHN", "MANUAL", "BYPASS", ""],
        default: "",
      },
      // The W3C WebAuthn assertion stored verbatim for audit replay.
      // credentialId + publicKey are public values; storing them does not
      // leak biometric template (the fingerprint never leaves the device).
      credentialId:    { type: String, default: "" },     // base64url
      publicKey:       { type: String, default: "" },     // base64url COSE key
      counter:         { type: Number, default: 0 },
      attestationFmt:  { type: String, default: "" },     // none / packed / fido-u2f / apple / tpm
      aaguid:          { type: String, default: "" },     // authenticator type id
      // R7gh — Hardware-backed flag. True only when the AAGUID matches
      // an approved TPM/Secure-Enclave/StrongBox authenticator. False
      // would mean a software/virtual authenticator slipped past the
      // verifier (only possible if STRICT_HARDWARE_BIOMETRIC was off).
      // The /sign endpoint MUST refuse to flip PENDING→SIGNED when
      // this is false, unless the admin has lodged a bypass.
      isHardwareBacked:     { type: Boolean, default: false },
      authenticatorVendor:  { type: String, default: "" },  // e.g. "Windows Hello Hardware (TPM)"
      // Server-stamped at verify time (cannot be forged by client).
      capturedAt:      { type: Date },
      capturedFromIp:  { type: String, default: "" },
      capturedUserAgent: { type: String, default: "" },
      // The transient challenge issued to the browser. Cleared after
      // verify so it can never be replayed.
      pendingChallenge: { type: String, default: "" },
      pendingChallengeExpiresAt: { type: Date },
    },

    staffSignature: {
      // The staff member / doctor who facilitated the consent ceremony.
      // Identity comes from req.user (cannot be spoofed by the body).
      userId:        { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      userName:      { type: String, default: "" },
      userRole:      { type: String, default: "" },
      // Drawn signature image (base64 PNG). Reuses the existing
      // SignaturePad component on the frontend.
      signatureImage: { type: String, default: "" },
      signedAt:      { type: Date },
      signedFromIp:  { type: String, default: "" },
    },

    bypass: {
      // Admin-only escape valve when device fails or patient genuinely
      // cannot biometric-sign. NABH PRE.4 still demands a documented
      // reason + authoriser; this captures both.
      reason:        { type: String, default: "" },
      authorisedBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      authorisedByName: { type: String, default: "" },
      authorisedAt:  { type: Date },
    },
  },
  { timestamps: true, collection: "consent_forms" }
);

ConsentFormSchema.index({ UHID: 1, consentType: 1 });
ConsentFormSchema.index({ admissionId: 1, consentType: 1 });
ConsentFormSchema.index({ status: 1 });

// R7bf-I / A7-CRIT-4 — Consent state-machine guard.
// Pre-R7bf the refuse / revoke endpoints had no transition guard:
//   • A patient who already REFUSED could be silently "re-refused"
//     overwriting the original refusal timestamp + reason — NABH PRE.4
//     audit chain broken.
//   • A SIGNED consent could be REVOKED at any time, including
//     post-procedure, which is medico-legally invalid.
// The registry now restricts:
//   PENDING → SIGNED | REFUSED       (offer outcome — one-shot)
//   SIGNED  → REVOKED                (only while procedure not yet started;
//                                     the post-procedure check is enforced
//                                     by the controller, not the schema)
//   REFUSED / REVOKED → terminal
const { attachStatusGuard } = require("../../utils/statusTransitionGuard");
attachStatusGuard(ConsentFormSchema, { modelName: "ConsentForm", field: "status" });

module.exports =
  mongoose.models.ConsentForm ||
  mongoose.model("ConsentForm", ConsentFormSchema);
