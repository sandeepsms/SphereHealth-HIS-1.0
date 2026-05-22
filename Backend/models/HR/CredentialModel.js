/**
 * CredentialModel.js  (R7bf-G / A5-CRIT-6 / NABH HRD.3)
 *
 * Staff credentialing register. NABH HRD.3 mandates that every clinician
 * (and every staff member with a regulated qualification) has their
 * degrees, registration numbers, council recognition, scope of practice
 * and granted privileges captured, verified, and tracked through expiry.
 *
 * Pre-R7bf there was no formal register. Designation / specialisation
 * lived on User.doctorDetails as free-text. This model adds:
 *   • Multiple credential rows per user (MBBS + MD + Fellowship + Licence)
 *   • Verification flow (PENDING → VERIFIED → EXPIRED → REVOKED)
 *   • Document URL attachment
 *   • Privileges granted (admit, prescribe Schedule X, perform surgery,
 *     run blood transfusion, etc.)
 *   • Scope-of-practice specialty list
 *
 * Cron `expireCredentials` flips status to EXPIRED when expiryDate < today.
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

const CredentialSchema = new Schema(
  {
    // ── Subject ──────────────────────────────────────────────
    userId:   { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    doctorId: { type: Schema.Types.ObjectId, ref: "Doctor", default: null, index: true },

    // Captured snapshot so the register stays readable even if the
    // User/Doctor row is deleted (cascade-delete protection).
    userFullName:  { type: String, default: "" },
    userRole:      { type: String, default: "" },
    userEmployeeId:{ type: String, default: "" },

    // ── Credential details ───────────────────────────────────
    credentialType: {
      type: String,
      // R7bj-F6 / NABH DT-CRIT-1 / PT-CRIT-2 / SEC-CRIT-2 / HK:
      // Added IDA RD licence (Dietitian), IAP registration (Physio),
      // PSARA guard licence (Security), FSSAI food-handler training
      // (Kitchen), and ICAN membership (Infection-Control). Without
      // these the modules can't enforce role-bound credentialing.
      enum: [
        "MBBS", "MD", "MS", "MCh", "DM",
        "PG_DIPLOMA", "FELLOWSHIP",
        "LICENCE", "BSc_NURSING", "GNM", "ANM",
        "DIPLOMA_PHARMACY", "BPHARM", "MPHARM",
        "DMLT", "BMLT", "MMLT",
        "BPT", "MPT",
        "RD_LICENCE",          // IDA Registered Dietitian
        "IAP_REG",             // Indian Association of Physiotherapists
        "PSARA_GUARD",         // Private Security Agencies Regulation Act 2005
        "FSSAI_FOOD_HANDLER",  // FSSAI Schedule IV kitchen-staff training
        "ICAN_MEMBER",         // Infection Control Academy of India / HIC
        "BMW_HANDLER",         // R7bn — BMW Rules 2016 Schedule IV training (handler/operator sign-off)
        "NMC_REG",             // R7bn — National Medical Commission registration (MD/MBBS practising licence)
        "OTHER",
      ],
      required: true,
      index: true,
    },

    title:        { type: String, required: true, trim: true },   // e.g. "MBBS — KGMU 2012"
    institution:  { type: String, default: "" },
    year:         { type: Number, default: null, min: 1900, max: 2100 },

    // Council / regulator registration
    registrationNumber: { type: String, trim: true, default: "" },
    councilName:        { type: String, default: "" },            // MCI / NMC / State medical / Pharmacy Council …

    // ── Expiry / renewal ─────────────────────────────────────
    expiryDate: { type: Date, default: null, index: true },

    // ── Verification ─────────────────────────────────────────
    verified:    { type: Boolean, default: false },
    verifiedBy:  { type: Schema.Types.ObjectId, ref: "User", default: null },
    verifiedByName: { type: String, default: "" },
    verifiedAt:  { type: Date, default: null },

    // ── Scope of practice + privileges ───────────────────────
    scopeOfPractice:    [{ type: String, trim: true }],
    privilegesGranted:  [{ type: String, trim: true }],

    // ── Attachments ──────────────────────────────────────────
    documentUrl: { type: String, default: "" },

    // ── State ────────────────────────────────────────────────
    status: {
      type: String,
      enum: ["PENDING", "VERIFIED", "EXPIRED", "REVOKED"],
      default: "PENDING",
      index: true,
    },
    revokedAt:     { type: Date, default: null },
    revokedBy:     { type: Schema.Types.ObjectId, ref: "User", default: null },
    revokedByName: { type: String, default: "" },
    revokedReason: { type: String, default: "" },

    notes:      { type: String, default: "" },
    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "credentials" },
);

CredentialSchema.index({ userId: 1, credentialType: 1 });
CredentialSchema.index({ status: 1, expiryDate: 1 });
CredentialSchema.index({ doctorId: 1, status: 1 });

module.exports =
  mongoose.models.Credential || mongoose.model("Credential", CredentialSchema);
