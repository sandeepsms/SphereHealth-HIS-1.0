/**
 * MLCReportModel — Medico-Legal Case (MLC) report
 *
 * Two workflows the doctor can use:
 *
 *   1. EXTERNAL MLC (`source: "External"`)
 *      Patient arrives with an MLC already cut at another hospital / by police.
 *      Doctor just records the basic identifiers (external MLC number, the
 *      hospital that issued it, police station + FIR if available) and links
 *      the local patient file to that existing case. The hospital's own MLR
 *      number is still generated so internal documents have a stamp number
 *      to print.
 *
 *   2. INTERNAL MLC (`source: "Internal"`)
 *      Patient does NOT have an MLC yet and the doctor formally cuts one.
 *      Full incident + injury workup is captured.
 *
 * MLR number format
 *   `<doctor-prefix><4-digit-seq>` — e.g. RK0001, RK0002, … per doctor.
 *   `doctor-prefix` is 2 letters derived from the doctor's name:
 *     • first letter of first name + first letter of last name (default)
 *     • single-name doctor → first + last letter of that name
 *     • prefix is globally UNIQUE — first 2 letters of any MLR identify
 *       exactly one doctor in the hospital.
 *
 * Once generated, the MLR number is treated as the official stamp on every
 * document produced for this case (patient file pages, discharge summary,
 * investigation reports, prescription print, etc.).
 */
const mongoose = require("mongoose");

const InjurySchema = new mongoose.Schema(
  {
    region: { type: String, trim: true },        // e.g. "Right forearm"
    type: {                                       // e.g. "Abrasion", "Contusion"
      type: String,
      enum: [
        "Abrasion",
        "Contusion",
        "Laceration",
        "Incised",
        "Stab",
        "Firearm",
        "Burn",
        "Bite",
        "Fracture",
        "Other",
      ],
      default: "Other",
    },
    size: { type: String, trim: true },           // e.g. "3x2 cm"
    description: { type: String, trim: true },
    ageOfInjury: { type: String, trim: true },    // e.g. "Fresh", "<24 hours"
  },
  { _id: false }
);

const MLCReportSchema = new mongoose.Schema(
  {
    // ── MLR identifier (auto-generated) ───────────────────────────
    mlrNumber: {
      type: String,
      uppercase: true,
      unique: true,
      index: true,
    },
    // Snapshot of the doctor's 2-letter prefix at creation time — pinned so
    // the MLR stays stable even if the doctor's name is later edited.
    mlrPrefix: { type: String, uppercase: true, length: 2 },
    mlrSeq:    { type: Number },

    // ── Patient link ──────────────────────────────────────────────
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    UHID: { type: String, required: true, index: true },
    // Denormalised so list views render without populate
    patientName:   { type: String },
    age:           { type: Number },
    gender:        { type: String, enum: ["Male", "Female", "Other"] },
    contactNumber: { type: String },

    // Optional cross-links to the visit that triggered the MLC
    emergencyId:  { type: mongoose.Schema.Types.ObjectId, ref: "Emergency" },
    admissionId:  { type: mongoose.Schema.Types.ObjectId, ref: "Admission" },
    opdVisitId:   { type: mongoose.Schema.Types.ObjectId, ref: "OPDRegistration" },

    // ── Doctor who cut / recorded the MLC ─────────────────────────
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },
    doctorName: { type: String, required: true },

    // ── Source: existing or fresh ─────────────────────────────────
    source: {
      type: String,
      enum: ["External", "Internal"],
      required: true,
      default: "Internal",
    },

    // External-MLC basic details (used when source = "External")
    externalDetails: {
      externalMlcNumber: { type: String, trim: true },   // e.g. "AIIMS/MLC/2025/00342"
      externalHospital:  { type: String, trim: true },   // hospital that cut it
      externalDate:      { type: Date },
      remarks:           { type: String, trim: true },
    },

    // ── Type / category of MLC ────────────────────────────────────
    mlcType: {
      type: String,
      enum: [
        "Assault",
        "Road Traffic Accident",
        "Burn",
        "Poisoning",
        "Suicide Attempt",
        "Sexual Assault",
        "Industrial Accident",
        "Self-inflicted",
        "Animal Bite",
        "Unnatural Death",
        "Other",
      ],
      required: true,
      default: "Other",
    },

    // ── Incident details ──────────────────────────────────────────
    incidentDate:  { type: Date },
    incidentTime:  { type: String, trim: true },         // free text "10:45 PM"
    incidentPlace: { type: String, trim: true },
    allegedHistory:{ type: String, trim: true },         // as told by patient / attendant

    broughtBy:       { type: String, trim: true },        // self / relative / police
    broughtByName:   { type: String, trim: true },
    broughtByPhone:  { type: String, trim: true },

    // ── Police information ────────────────────────────────────────
    informedPolice: { type: Boolean, default: false },
    policeStation:  { type: String, trim: true },
    firNumber:      { type: String, trim: true },
    investigatingOfficer: { type: String, trim: true },
    officerContact: { type: String, trim: true },

    // ── Clinical examination ──────────────────────────────────────
    generalCondition: { type: String, trim: true },
    consciousness:    { type: String, trim: true },        // Alert / Drowsy / Unconscious
    smellOfAlcohol:   { type: Boolean, default: false },
    vitals: {
      bloodPressure:   { type: String, trim: true },
      pulse:           { type: Number },
      respiratoryRate: { type: Number },
      temperature:     { type: Number },
      oxygenSaturation:{ type: Number },
      glasgowComaScale:{ type: Number },
    },
    injuries: { type: [InjurySchema], default: [] },
    examinationFindings: { type: String, trim: true },

    // ── Plan / opinion ────────────────────────────────────────────
    investigationsAdvised: { type: String, trim: true },
    provisionalDiagnosis:  { type: String, trim: true },
    opinion:               { type: String, trim: true },   // doctor's opinion
    disposition: {
      type: String,
      enum: ["Admitted", "Discharged", "Referred", "DOR", "Absconded", "Expired", "Under Observation"],
      default: "Under Observation",
    },

    // ── Lifecycle ─────────────────────────────────────────────────
    status: {
      type: String,
      enum: ["Draft", "Finalized", "Closed"],
      default: "Draft",
      index: true,
    },
    finalizedAt: { type: Date },
    finalizedBy: { type: String, trim: true, default: "" },
    finalizedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedAt:    { type: Date },
    closedBy:    { type: String, trim: true, default: "" },
    closedById:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedReason:{ type: String, trim: true },

    createdBy:   { type: String, trim: true },             // user fullname
    createdById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdByRole: { type: String, trim: true },

    // R7bb-FIX-E-5 / D3-CRIT-5: chain-of-custody co-signer. MLCs are
    // medico-legal documents that must carry a second clinician's
    // attestation on finalize/close. The co-signer MUST be a different
    // User than createdById AND must be a Doctor with designation
    // Consultant or above (HOD). Enforced by mlcController.finalize
    // and mlcController.close.
    coSignedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    coSignedByName: { type: String, trim: true, default: "" },
    coSignedAt:   { type: Date, default: null },

    // NABH IMS.3 (#138) — MLC/medico-legal records carry a 12y retention
    // floor; legalHold (open case) excludes from the purge-candidate queue.
    // Set / cleared via POST /api/mrd/legal-hold; who + when captured below.
    legalHold: { type: Boolean, default: false },
    legalHoldReason: { type: String, default: "" },
    legalHoldBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    legalHoldByName: { type: String, default: "" },
    legalHoldAt:     { type: Date, default: null },
  },
  { timestamps: true }
);

MLCReportSchema.index({ doctorId: 1, mlrSeq: 1 });
MLCReportSchema.index({ status: 1, createdAt: -1 });
MLCReportSchema.index({ UHID: 1, createdAt: -1 });

// R7bf-I / A7-CRIT-3 — MLC state-machine guard.
// MLCs are medico-legal documents: a Closed report cannot drift back
// to Draft / Finalized (the police/court audit chain depends on the
// finalisation timestamp being immutable). Pre-R7bf there was no
// schema-level guard; mlcController.close enforced "no further close"
// but a direct service or migration could silently flip status.
//
// Force-bypass: set doc.__forceTransition = true AND
// doc.__forceAdminUserId = <Admin User._id> on the in-memory doc
// before save. The Admin route handler is expected to emit a
// `BillingAudit` (or equivalent MLC audit) row with the reason; the
// guard itself doesn't audit.
const { attachStatusGuard } = require("../../utils/statusTransitionGuard");
attachStatusGuard(MLCReportSchema, { modelName: "MLCReport", field: "status" });

module.exports =
  mongoose.models.MLCReport ||
  mongoose.model("MLCReport", MLCReportSchema);
