const mongoose = require("mongoose");

const prescriptionSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },

    UHID: {
      type: String,
      required: true,
    },

    patientName: {
      type: String,
      // required: true,
    },

    age: {
      type: Number,
      default: 0,
    },

    gender: {
      type: String,
    },

    contactNumber: {
      type: String,
    },

    fatherName: {
      type: String,
    },

    department: {
      type: String,
    },

    date: {
      type: String,
    },

    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },

    referredBy: {
      type: String,
    },

    registrationType: {
      type: String,
      enum: ["OPD", "IPD", "Emergency"],
      default: "OPD",
    },

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
    },

    provisionalDiagnosis: {
      type: String,
      required: true,
    },

    medicines: [
      {
        medicineName: String,
        schedule: String,
        instruction: String,
        route: String,
        days: Number,
      },
    ],

    investigations: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "TPAServices",
      },
    ],

    advice: {
      type: String,
    },

    prescriptionDate: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Prescription", prescriptionSchema);
