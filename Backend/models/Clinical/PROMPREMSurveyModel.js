/**
 * R7hr-113 — Paperless PROM / PREM Survey
 * ──────────────────────────────────────────
 * Patient-Reported Outcome (PROM) and Patient-Reported Experience (PREM)
 * surveys captured before discharge. NABH PSQ + COP.6.b mandate that
 * the patient's voice is recorded at end of stay; the discharge gate
 * (dischargeSummaryController.finalize) refuses to lock the discharge
 * until ONE signed PROM AND ONE signed PREM exist for the admission.
 *
 * Mirrors the consent-form ceremony pattern (R7ez / R7gj / R7hr-79):
 *   - Patient signature: digital pad, biometric, or verbal-attested
 *     (when patient cannot sign — caregiver attests on their behalf)
 *   - Staff witness signature: required, captures who facilitated
 *   - Status: DRAFT (filled but not signed) → SIGNED (immutable)
 *
 * On sign, the row mirrors into the PROM/PREM NABH register (R7gw-B10-T05)
 * so the compliance team's KPI strip + register page light up
 * automatically — no separate data-entry step.
 *
 * Idempotency: sourceRef unique per admission+type. Re-runs of the
 * fan-out / re-opens of a draft never duplicate.
 */
const mongoose = require("mongoose");

const SignatureSchema = new mongoose.Schema(
  {
    method: { type: String, enum: ["DIGITAL_PAD", "BIOMETRIC", "VERBAL_ATTESTED", "BYPASS"], default: null },
    signatureImage: { type: String, default: null }, // base64 PNG data URL (≤500KB)
    signedAt: { type: Date, default: null },
    signedFromIp: { type: String, default: null },
    // Verbal attestation — when patient is too unwell to sign themselves,
    // a caregiver / family member attests on their behalf. Captures
    // their name, relation, and ID proof.
    attestedByName: { type: String, default: null },
    attestedByRelation: { type: String, default: null },
    attestedByIdProof: { type: String, default: null },
    attestedByContact: { type: String, default: null },
  },
  { _id: false },
);

const StaffWitnessSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    userName: { type: String, default: null },
    userRole: { type: String, default: null },
    employeeId: { type: String, default: null },
    signatureImage: { type: String, default: null },
    signedAt: { type: Date, default: null },
    signedFromIp: { type: String, default: null },
  },
  { _id: false },
);

const AuditEntrySchema = new mongoose.Schema(
  {
    action: { type: String, required: true }, // CREATED / UPDATED / SIGNED / VOIDED
    at: { type: Date, default: Date.now },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, default: null },
    byRole: { type: String, default: null },
    notes: { type: String, default: "" },
  },
  { _id: false },
);

// Instrument enum — the recognised survey questionnaires the form
// supports. "Other" allows free-text labelling for any instrument
// not yet first-class (e.g. a department-specific PROM the hospital
// validates internally).
const PROM_INSTRUMENTS = ["EQ-5D-5L", "SF-36", "PROMIS", "Oxford-Knee", "Oxford-Hip", "VAS-Pain", "Other"];
const PREM_INSTRUMENTS = ["NABH-PSQ", "HCAHPS", "NHS-FFT", "Custom-PREM", "Other"];

const PROMPREMSurveySchema = new mongoose.Schema(
  {
    // Patient + admission linkage (required — surveys ALWAYS attach
    // to a real admission so the discharge gate can find them).
    UHID: { type: String, required: true, index: true, trim: true, uppercase: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    patientName: { type: String, default: "" },
    admissionId: { type: mongoose.Schema.Types.ObjectId, ref: "Admission", required: true, index: true },
    admissionNumber: { type: String, default: "" },

    // Survey type — drives the discharge gate (one of each required)
    type: { type: String, enum: ["PROM", "PREM"], required: true, index: true },

    // Specific instrument within the type
    instrument: { type: String, required: true },
    // When instrument === "Other"
    otherInstrumentLabel: { type: String, default: "" },

    // Responses — flexible per-instrument shape. EQ-5D-5L expects
    // { mobility, selfcare, usualActivities, pain, anxiety, vas },
    // NABH-PSQ expects an array of {questionId, response, comment},
    // etc. Stored as Mixed so the schema doesn't constrain new
    // instruments before we add their question banks.
    responses: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    // Derived domain scores (computed at submit time client-side or
    // server-side by an instrument scorer)
    scores: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    // Free-text comment box on every survey
    comments: { type: String, default: "" },
    // Optional recommendation by staff (e.g. "OPD follow-up for pain")
    staffRecommendation: { type: String, default: "" },

    // Patient signature ceremony
    patientSignature: { type: SignatureSchema, default: () => ({}) },
    // Staff facilitator signature (required to mark SIGNED)
    staffWitness: { type: StaffWitnessSchema, default: () => ({}) },

    // Administered when (ISO datetime)
    administeredAt: { type: Date, default: Date.now },
    // Where (ward / OPD / discharge desk)
    administeredAtLocation: { type: String, default: "Discharge desk" },

    // Status lifecycle
    status: { type: String, enum: ["DRAFT", "SIGNED", "VOIDED"], default: "DRAFT", index: true },

    // Sign metadata (for quick filter / report)
    signedAt: { type: Date, default: null, index: true },
    signedByName: { type: String, default: null },
    signedByEmpId: { type: String, default: null },

    // Bypass (admin escape valve when patient/caregiver refuse but
    // discharge must still proceed — LAMA / Death case)
    bypass: {
      enabled: { type: Boolean, default: false },
      reason: { type: String, default: "" },
      authorisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      authorisedByName: { type: String, default: null },
      authorisedAt: { type: Date, default: null },
    },

    // Idempotency — `prom-prem:<admissionId>:<type>` unique
    sourceRef: { type: String, default: null, unique: true, sparse: true, index: true },

    auditLog: { type: [AuditEntrySchema], default: () => [] },

    // Register emit linkage — once mirrored into PROM/PREM register
    // we stamp the register row's id here so the round-trip is
    // traceable both ways.
    registerRowId: { type: mongoose.Schema.Types.ObjectId, ref: "PROMPREMRegRegister", default: null },
  },
  { timestamps: true },
);

// Compound: one SIGNED PROM and one SIGNED PREM per admission satisfy
// the discharge gate. We DON'T enforce uniqueness on (admissionId,
// type, status) at the schema level because hospitals may legitimately
// re-administer a survey if the patient changes their mind. The gate
// only checks "at least one SIGNED of each type exists".
PROMPREMSurveySchema.index({ admissionId: 1, type: 1, status: 1 });
PROMPREMSurveySchema.index({ UHID: 1, createdAt: -1 });

// Static helper used by dischargeSummaryController.finalize() to
// answer "are both PROM + PREM signed for this admission?" in one
// round-trip. Returns { prom: boolean, prem: boolean }.
PROMPREMSurveySchema.statics.checkDischargeReadiness = async function (admissionId) {
  if (!admissionId) return { prom: false, prem: false };
  const rows = await this.find(
    { admissionId, status: "SIGNED" },
    { type: 1, _id: 0 },
  ).lean();
  const prom = rows.some((r) => r.type === "PROM");
  const prem = rows.some((r) => r.type === "PREM");
  return { prom, prem };
};

module.exports.PROM_INSTRUMENTS = PROM_INSTRUMENTS;
module.exports.PREM_INSTRUMENTS = PREM_INSTRUMENTS;
module.exports =
  mongoose.models.PROMPREMSurvey ||
  mongoose.model("PROMPREMSurvey", PROMPREMSurveySchema);
module.exports.PROM_INSTRUMENTS = PROM_INSTRUMENTS;
module.exports.PREM_INSTRUMENTS = PREM_INSTRUMENTS;
