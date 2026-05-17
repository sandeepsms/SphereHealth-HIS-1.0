const mongoose = require("mongoose");

const prescriptionSchema = new mongoose.Schema(
  {
    // ── Patient ───────────────────────────────────────────────
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    UHID: { type: String, required: true, uppercase: true },
    patientName: String,
    // Patient-safety audit A-06: bounded age (0–150 mirrors patientModel)
    // and gender enum keep paediatric-dosing logic and pregnancy-flag
    // workflows reliable. "Other" is included so non-binary patients
    // and missing data flow through without throwing.
    age: { type: Number, min: 0, max: 150 },
    gender: { type: String, enum: ["Male", "Female", "Other", ""], default: "" },
    contactNumber: String,
    fatherName: String,
    department: String,
    date: { type: Date, default: Date.now },

    // ── Doctor ────────────────────────────────────────────────
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },
    doctorName: String,
    referredBy: String,

    registrationType: {
      type: String,
      enum: ["OPD", "IPD", "Emergency", "Daycare"],
      default: "OPD",
    },

    // ── Clinical ──────────────────────────────────────────────
    clinicalDetails: {
      historyOfAllergy: String,
      historyOfPresentIllness: String,
      physicalExamination: String,
    },

    // Patient-safety bounds — same envelope as NurseVitalsSchema so
    // OPD-side and IPD-side share the same definition of "physiologically
    // possible". Patient-safety audit 2026-05-17 A-02.
    vitals: {
      weight:          { type: Number, min: 0,   max: 500 },
      temperature:     { type: Number, min: 25,  max: 45 },
      bloodPressure:   { type: String, match: /^\d{2,3}\/\d{2,3}$/ },
      pulse:           { type: Number, min: 0,   max: 300 },
      respiratoryRate: { type: Number, min: 0,   max: 80 },
      spo2:            { type: Number, min: 0,   max: 100 },
    },

    provisionalDiagnosis: { type: String, required: true },

    // ── Medicines ─────────────────────────────────────────────
    medicines: [
      {
        medicineName: { type: String, required: true, trim: true, minlength: 1 },
        schedule: String,
        instruction: String,
        // Enum-constrained route so a typo like "Orall" or freeform text
        // can't poison MAR / pharmacy downstream. Patient-safety audit A-07.
        route: {
          type: String,
          enum: ["Oral", "IV", "IM", "SC", "SL", "PR", "PV", "Topical", "Inhalation", "Nebulisation", "Ophthalmic", "Otic", "Nasal", "Rectal", "Transdermal"],
          default: "Oral",
        },
        days: { type: String, default: "1" },
      },
    ],

    // ── Services (ref: ServiceMaster) ─────────────────────────
    // Doctor selects service name only — billing handled by backend
    selectedServices: [
      {
        serviceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "ServiceMaster",
          default: null,
        },
        serviceName: { type: String, default: "" },
        serviceCode: { type: String },
      },
    ],

    // ── Investigations (ref: InvestigationMaster) ─────────────
    investigations: [
      {
        investigationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "InvestigationMaster",
          default: null,
        },
        investigationName: { type: String, default: "" },
        investigationCode: { type: String },
        chargedPrice: { type: Number, default: 0 },
        tariffType: {
          type: String,
          enum: ["CASH", "TPA", "CORPORATE"],
          default: "CASH",
        },
      },
    ],

    advice: String,

    prescriptionDate: { type: Date, default: Date.now },

    status: {
      type: String,
      enum: ["Active", "Completed", "Cancelled", "CREATED", "FINAL"],
      default: "Active",
    },

    isActive: { type: Boolean, default: true },

    // ── Lab Orders auto-created when investigations present ────
    labOrderIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "InvestigationOrder",
      },
    ],
  },
  { timestamps: true },
);

prescriptionSchema.index({ patient: 1, createdAt: -1 });
prescriptionSchema.index({ UHID: 1 });
prescriptionSchema.index({ doctor: 1 });
prescriptionSchema.index({ prescriptionDate: -1 });

module.exports = mongoose.model("Prescription", prescriptionSchema);
