// models/Nursing/shiftHandoverModel.js

const mongoose = require("mongoose");

const ShiftHandoverSchema = new mongoose.Schema(
  {
    admissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission",
      required: true,
    },
    uhid: { type: String, required: true },

    fromShift: {
      type: String,
      enum: ["morning", "evening", "night"],
      required: true,
    },
    toShift: {
      type: String,
      enum: ["morning", "evening", "night"],
      required: true,
    },
    date: { type: Date, required: true },

    outgoingNurse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NurseStaff",
      required: true,
    },
    incomingNurse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NurseStaff",
      required: true,
    },

    patientStatus: {
      overallCondition: {
        type: String,
        enum: ["stable", "needs_observation", "critical"],
        required: true,
      },
      consciousness: {
        type: String,
        enum: ["conscious", "drowsy", "unconscious"],
        required: true,
      },
    },

    // VitalSheet se auto-pull hoga
    vitalsSnapshot: {
      pulse: { type: Number },
      bp: { type: String },
      rr: { type: Number },
      temp: { type: Number },
      spo2: { type: Number },
      takenAt: { type: String },
    },

    // Traceability ke liye
    vitalSheetRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VitalSheet",
    },

    intakeOutput: {
      ivIntake: {
        type: String,
        enum: ["nil", "<500ml", "500-1000ml", ">1000ml"],
        default: "nil",
      },
      oralIntake: {
        type: String,
        enum: ["nil", "poor", "adequate"],
        default: "nil",
      },
      urineOutput: {
        type: String,
        enum: ["adequate", "low", "nil"],
        default: "adequate",
      },
      drainOutput: {
        type: String,
        enum: ["nil", "minimal", "significant"],
        default: "nil",
      },
      stool: {
        type: String,
        enum: ["normal", "loose", "absent"],
        default: "normal",
      },
    },

    medicationsDevices: [
      {
        item: { type: String, required: true },
        status: { type: String, required: true },
        explanation: { type: String, default: "" },
      },
    ],

    pendingTasks: {
      type: [String],
      enum: ["none", "dressing", "medication_due", "doctor_review"],
      default: ["none"],
    },
    specialInstructions: { type: String, default: "" },

    verification: {
      outgoingNurseSign: { type: String },
      incomingNurseSign: { type: String },
      doctorInformed: { type: Boolean, default: false },
      verifiedAt: { type: Date },
    },

    informedDoctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
    },
  },
  { timestamps: true },
);

ShiftHandoverSchema.index(
  { admissionId: 1, date: 1, fromShift: 1 },
  { unique: true },
);
ShiftHandoverSchema.index({ uhid: 1 });
ShiftHandoverSchema.index({ outgoingNurse: 1 });
ShiftHandoverSchema.index({ incomingNurse: 1 });

module.exports =
  mongoose.models.ShiftHandover ||
  mongoose.model("ShiftHandover", ShiftHandoverSchema);
