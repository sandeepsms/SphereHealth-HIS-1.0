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
    age: Number,
    gender: String,
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

    vitals: {
      weight: Number,
      temperature: Number,
      bloodPressure: String,
      pulse: Number,
      respiratoryRate: Number,
      spo2: Number,
    },

    provisionalDiagnosis: { type: String, required: true },

    // ── Medicines ─────────────────────────────────────────────
    medicines: [
      {
        medicineName: { type: String, required: true },
        schedule: String,
        instruction: String,
        route: { type: String, default: "Oral" },
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
