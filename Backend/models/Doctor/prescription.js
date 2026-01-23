const mongoose = require("mongoose");

const prescriptionSchema = new mongoose.Schema(
  {
    // Patient Info
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    UHID: {
      type: String,
      required: true,
    },

    // Doctor Info
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },

    // Registration Type
    registrationType: {
      type: String,
      enum: ["OPD", "IPD", "Emergency"],
      required: true,
    },

    // Clinical Details
    clinicalDetails: {
      historyOfAllergy: String,
      historyOfPresentIllness: String,
      physicalExamination: String,
    },

    // Vitals
    vitals: {
      weight: String,
      temperature: String,
      bloodPressure: String,
      pulse: String,
    },

    // Diagnosis
    provisionalDiagnosis: {
      type: String,
      required: true,
    },

    // Medicines
    medicines: [
      {
        medicineName: String,
        schedule: String,
        instruction: String,
        route: String,
        days: Number,
      },
    ],

    // Investigations (TPA Services)
    investigations: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "TPAService",
      },
    ],

    // Advice
    advice: String,

    // Referred By
    referredBy: String,

    // Timestamps
    prescriptionDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Prescription", prescriptionSchema);
