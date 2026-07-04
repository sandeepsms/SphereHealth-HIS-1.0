/**
 * PatientFeedbackModel — NABH PRE.3 / PRE.6 patient satisfaction & experience
 * feedback. Distinct from the formal PROM/PREM clinical instruments: this is
 * the general "how was your experience" feedback captured either by staff at
 * the reception / discharge desk OR by the patient themselves on their phone
 * via a shareable link / QR (no login).
 *
 *   - Ratings 1-5 across service categories (doctor, nursing, cleanliness,
 *     food, billing, facilities, overall)
 *   - Net Promoter Score (0-10, "would you recommend us")
 *   - Free text: what went well + what to improve
 *   - Optional contact-for-follow-up consent
 *   - Works for OPD, IPD, Emergency, Daycare and anonymous walk-ins
 *
 * Patient-link flow: staff generates a row in `pending` state with a random
 * `publicToken`; the patient opens /feedback/<token>, fills it, and the row
 * flips to `submitted`. Direct staff entry lands as `submitted` immediately.
 */
const mongoose = require("mongoose");
const crypto = require("crypto");

// The service categories the patient rates. Kept as a shared export so the
// controller's dashboard aggregation and the frontend form stay in lock-step.
const RATING_KEYS = ["doctor", "nursing", "cleanliness", "food", "billing", "facilities", "overall"];

const _rating = () => ({ type: Number, min: 0, max: 5, default: 0 });

const PatientFeedbackSchema = new mongoose.Schema(
  {
    // ── Optional patient linkage (feedback can be anonymous / walk-in) ──
    UHID:          { type: String, default: "", trim: true, uppercase: true, index: true },
    patientName:   { type: String, default: "" },
    contactNumber: { type: String, default: "" },
    admissionId:   { type: mongoose.Schema.Types.ObjectId, ref: "Admission", default: null },
    visitType:     { type: String, enum: ["OPD", "IPD", "Emergency", "Daycare", "Walk-in"], default: "OPD", index: true },
    department:    { type: String, default: "" },
    ward:          { type: String, default: "" },

    // ── Ratings (1-5 each; 0 = not answered) ──
    ratings: {
      doctor:      _rating(),
      nursing:     _rating(),
      cleanliness: _rating(),
      food:        _rating(),
      billing:     _rating(),
      facilities:  _rating(),
      overall:     _rating(),
    },
    // Net Promoter Score — 0-10 "how likely to recommend". null = not answered.
    npsScore: { type: Number, min: 0, max: 10, default: null },

    // ── Free-text ──
    wentWell:     { type: String, default: "", maxlength: 4000 },
    improvements: { type: String, default: "", maxlength: 4000 },

    // ── Consent / privacy ──
    contactConsent: { type: Boolean, default: false }, // may we contact you about this?
    anonymous:      { type: Boolean, default: false },

    // ── Provenance ──
    submittedVia:      { type: String, enum: ["staff", "patient-link"], default: "staff", index: true },
    submittedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    submittedByName:   { type: String, default: "" },
    submittedFromIp:   { type: String, default: "" },
    generatedByName:   { type: String, default: "" }, // who generated the patient link

    // ── Public link token (patient-facing) ──
    publicToken:    { type: String, default: null, index: true, sparse: true },
    tokenExpiresAt: { type: Date, default: null },

    submittedAt: { type: Date, default: null },
    // pending  = link generated, patient hasn't submitted yet
    // submitted = feedback captured (staff-direct or via link)
    status: { type: String, enum: ["pending", "submitted"], default: "submitted", index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

// Index on submittedAt (not createdAt): the dashboard/list/stats queries all
// filter the date range and sort on submittedAt, so this is the field the
// planner needs to avoid a scan-and-in-memory-sort at scale.
PatientFeedbackSchema.index({ status: 1, submittedAt: -1 });
PatientFeedbackSchema.index({ visitType: 1, submittedAt: -1 });

// Mean of the answered (non-zero) category ratings.
PatientFeedbackSchema.virtual("avgRating").get(function () {
  const vals = RATING_KEYS.map((k) => this.ratings?.[k]).filter((v) => v > 0);
  return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : 0;
});

// URL-safe random token for the patient link.
PatientFeedbackSchema.statics.newToken = () => crypto.randomBytes(24).toString("base64url");
PatientFeedbackSchema.statics.RATING_KEYS = RATING_KEYS;

module.exports = mongoose.models.PatientFeedback || mongoose.model("PatientFeedback", PatientFeedbackSchema);
module.exports.RATING_KEYS = RATING_KEYS;
