// models/Clinical/MedicalCertificateModel.js
// ════════════════════════════════════════════════════════════════════
// R7fu — Medical Certificate model. NABH-compliant clinical certificate
// surface covering the 12 standard certificate types issued by a
// hospital (fitness, sick-leave, discharge-fitness, disability,
// vaccination, pre-employment, insurance-claim, sterilization,
// bedridden, medico-legal, cause-of-death, birth-notification).
//
// Each certificate is tied to (patient + optional visit) and carries
// (a) the auto-generated certNumber (atomic counter, never re-used),
// (b) the issuing doctor identity + MCI registration (R7bx invariant —
//     blocked at write-time if missing),
// (c) a snapshotted hospital meta block so historical prints aren't
//     rewritten when admin changes the hospital config later,
// (d) a typeSpecific Mixed payload whose shape varies per certType.
//
// Schema-level validators enforce:
//   • disability with permanenceType=permanent → ≥3 medical board members
//     (RPwD Act 2016 §57(2))
//   • cause-of-death → immediateCause required
//   • sick-leave → totalRestDays auto-computed from restFrom/restToDate
//   • certNumber unique
//
// Indexes:
//   { patient: 1, issuedAt: -1 }     // patient's cert history
//   { certNumber: 1 } unique         // direct lookup + dedup guarantee
//   { certType: 1, issuedAt: -1 }    // per-type reporting / filtering
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const CERT_TYPES = [
  "fitness",            // Fitness to resume duty / school / travel
  "sick-leave",         // Medical leave with rest duration
  "discharge-fitness",  // Fitness after IPD admission
  "disability",         // % disability with category
  "vaccination",        // Vaccine name + dose + lot + date
  "pre-employment",     // Pre-employment medical exam result
  "insurance-claim",    // Cashless / reimbursement claim certificate
  "sterilization",      // Tubectomy / Vasectomy certificate
  "bedridden",          // Bedridden status (postal voting / pension)
  "medico-legal",       // MLC certificate
  "cause-of-death",     // WHO Form 4 / 4A
  "birth-notification", // Hospital birth notification (Form 1 precursor)
];

const VISIT_TYPES = ["OPD", "IPD", "DAYCARE", "EMERGENCY", "SERVICES"];

const CounterSignSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", default: null },
    name:     { type: String, default: "" },
    reg:      { type: String, default: "" },
    signedAt: { type: Date, default: null },
  },
  { _id: false },
);

const AttachmentSchema = new mongoose.Schema(
  {
    filename: { type: String, default: "" },
    url:      { type: String, default: "" },
    mimeType: { type: String, default: "" },
  },
  { _id: true },
);

const HospitalMetaSchema = new mongoose.Schema(
  {
    hospitalRegistrationNo: { type: String, default: "" },
    hospitalName:           { type: String, default: "" },
    nabhBadgeAtIssue:       { type: String, default: "" },
  },
  { _id: false },
);

const MedicalCertificateSchema = new mongoose.Schema(
  {
    // ── Patient (FK + denormalized snapshot) ────────────────────
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    patientName:  { type: String, trim: true, default: "" },
    patientUHID:  { type: String, trim: true, default: "", index: true },
    gender:       { type: String, default: "" },
    age:          { type: String, default: "" },     // "32Y" / "6M" — free form
    mobile:       { type: String, default: "" },

    // ── Source visit (optional — standalone certs allowed) ───────
    visitId:   { type: mongoose.Schema.Types.ObjectId, default: null },
    visitType: {
      type: String,
      enum: [...VISIT_TYPES, ""],
      default: "",
    },

    // ── R7hr-169-FIX — Admission ref persist (IPD certs) ─────────
    // Front-end MedicalCertificatePage.jsx submits admissionNumber +
    // admissionId on IPD-context certs so the printable Visit Type
    // fallback chain ((c.admissionNumber || c.admissionId || c.admission)
    // ? "IPD" : "") and the MedCertsTab inline grid (R7hr-169) can show
    // "IPD-26-NN" instead of "—". Pre-fix the controller whitelist
    // dropped these fields silently; this adds them as first-class
    // schema members so they round-trip cleanly. Additive — does not
    // change any existing serialised cert.
    admissionId:     { type: mongoose.Schema.Types.ObjectId, ref: "Admission", default: null },
    admissionNumber: { type: String, trim: true, default: "" },

    // ── Identity ────────────────────────────────────────────────
    certNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    certType: {
      type: String,
      enum: CERT_TYPES,
      required: true,
      index: true,
    },

    // ── Issuance ────────────────────────────────────────────────
    issuedAt: { type: Date, default: () => new Date() },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", default: null },
    // R7bx — MCI reg is mandatory on every certificate. Blocked at
    // controller-write time if missing on the doctor profile.
    doctorName: { type: String, default: "" },
    doctorReg:  { type: String, default: "" },

    // ── Counter-signature (disability + sterilization only) ─────
    counterSignedBy: { type: CounterSignSchema, default: () => ({}) },

    // ── Clinical context ────────────────────────────────────────
    diagnosis: { type: String, default: "" },
    icd10: {
      code:        { type: String, default: "" },
      description: { type: String, default: "" },
    },

    // ── Per-type payload (validated below) ──────────────────────
    typeSpecific: { type: mongoose.Schema.Types.Mixed, default: {} },

    // ── Lifecycle ───────────────────────────────────────────────
    status: {
      type: String,
      enum: ["issued", "revoked"],
      default: "issued",
      index: true,
    },
    revokedAt:    { type: Date, default: null },
    revokedBy:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    revokeReason: { type: String, default: "" },

    // ── Attachments + hospital snapshot ─────────────────────────
    attachments: { type: [AttachmentSchema], default: [] },
    meta:        { type: HospitalMetaSchema, default: () => ({}) },

    // PrintAudit hook — bumped by the print-audit infrastructure.
    printCount:  { type: Number, default: 0 },
  },
  { timestamps: true, collection: "medical_certificates" },
);

// ── Indexes ────────────────────────────────────────────────────
MedicalCertificateSchema.index({ patient: 1, issuedAt: -1 });
MedicalCertificateSchema.index({ certType: 1, issuedAt: -1 });
MedicalCertificateSchema.index({ doctorReg: 1, issuedAt: -1 });

// ── Pre-save: typeSpecific validation + derived totals ─────────
MedicalCertificateSchema.pre("validate", function (next) {
  try {
    const t = this.certType;
    const ts = this.typeSpecific || {};

    // Disability — RPwD Act 2016 §57(2): permanent disability requires
    // a Medical Board with at least 3 members (chairperson + 2 specialists).
    if (t === "disability") {
      if (ts.permanenceType === "permanent") {
        const board = Array.isArray(ts.medicalBoardMembers) ? ts.medicalBoardMembers : [];
        const valid = board.filter((m) => m && String(m).trim().length).length;
        if (valid < 3) {
          return next(new Error(
            "Permanent disability certificate requires a Medical Board of " +
            "at least 3 members (RPwD Act 2016 §57(2)).",
          ));
        }
      }
      const pct = Number(ts.percentDisability);
      if (ts.percentDisability != null && (Number.isNaN(pct) || pct < 0 || pct > 100)) {
        return next(new Error("percentDisability must be between 0 and 100."));
      }
    }

    // Cause-of-death — WHO Form 4 immediate cause is mandatory.
    if (t === "cause-of-death") {
      if (!ts.immediateCause || !String(ts.immediateCause).trim()) {
        return next(new Error("cause-of-death certificate requires immediateCause."));
      }
    }

    // Sick-leave — derive totalRestDays from restFromDate / restToDate
    // (inclusive — day 1 counts). Round to nearest whole day.
    if (t === "sick-leave" && ts.restFromDate && ts.restToDate) {
      const from = new Date(ts.restFromDate).getTime();
      const to   = new Date(ts.restToDate).getTime();
      if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
        const days = Math.round((to - from) / 86400000) + 1;
        ts.totalRestDays = days;
        this.typeSpecific = ts; // re-assign so Mixed change is detected
        this.markModified("typeSpecific");
      }
    }

    // Vaccination — dose number sanity (1..5).
    if (t === "vaccination" && ts.doseNumber != null) {
      const dn = Number(ts.doseNumber);
      if (Number.isNaN(dn) || dn < 1 || dn > 5) {
        return next(new Error("vaccination doseNumber must be 1–5."));
      }
    }

    next();
  } catch (e) {
    next(e);
  }
});

MedicalCertificateSchema.statics.CERT_TYPES  = CERT_TYPES;
MedicalCertificateSchema.statics.VISIT_TYPES = VISIT_TYPES;

module.exports =
  mongoose.models.MedicalCertificate ||
  mongoose.model("MedicalCertificate", MedicalCertificateSchema);
