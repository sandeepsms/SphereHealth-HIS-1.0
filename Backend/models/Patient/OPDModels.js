const mongoose = require("mongoose");

const OPDSchema = new mongoose.Schema(
  {
    patientId: {
      type: String,
      required: true,
      ref: "TestPatient",
    },
    UHID: {
      type: String,
      required: true,
    },
    visitNumber: {
      type: String,
      unique: true,
    },
    visitDate: {
      type: Date,
      default: Date.now,
    },
    visitType: {
      type: String,
      enum: ["First Visit", "Follow-up", "Routine Checkup"],
      default: "First Visit",
    },
    consultantName: {
      type: String,
      required: true,
    },
    department: {
      type: String,
      required: true,
    },
    chiefComplaint: {
      type: String,
      required: true,
    },
    complaintDuration: String,
    historyOfPresentIllness: String,
    pastMedicalHistory: String,
    allergyHistory: String,
    currentMedications: String,
    vitals: {
      weight: Number,
      height: Number,
      bmi: Number,
      temperature: Number,
      bloodPressure: String,
      pulse: Number,
      respiratoryRate: Number,
      oxygenSaturation: Number,
    },
    generalExamination: {
      consciousness: String,
      nutritionalStatus: String,
      pallor: { type: String, enum: ["Present", "Absent"] },
      icterus: { type: String, enum: ["Present", "Absent"] },
      cyanosis: { type: String, enum: ["Present", "Absent"] },
      clubbing: { type: String, enum: ["Present", "Absent"] },
      lymphadenopathy: { type: String, enum: ["Present", "Absent"] },
      edema: { type: String, enum: ["Present", "Absent"] },
    },
    systemicExamination: {
      cardiovascular: String,
      respiratory: String,
      abdomen: String,
      centralNervousSystem: String,
      musculoskeletal: String,
    },
    provisionalDiagnosis: String,
    finalDiagnosis: String,
    investigationsOrdered: [
      {
        testName: String,
        orderedDate: Date,
        status: {
          type: String,
          enum: ["Pending", "Completed", "Cancelled"],
          default: "Pending",
        },
      },
    ],
    prescribedMedications: [
      {
        medicineName: String,
        dosage: String,
        frequency: String,
        duration: String,
        instructions: String,
      },
    ],
    advice: String,
    dietaryRecommendations: String,
    followUpRequired: {
      type: Boolean,
      default: false,
    },
    followUpDate: Date,
    followUpInstructions: String,
    status: {
      type: String,
      enum: ["Active", "Completed", "Referred"],
      default: "Active",
    },
    referredTo: String,
    doctorNotes: String,
  },
  {
    timestamps: true,
  }
);

OPDSchema.index({ patientId: 1, visitDate: -1 });
OPDSchema.index({ UHID: 1 });
OPDSchema.index({ visitNumber: 1 });
OPDSchema.index({ visitDate: -1 });

OPDSchema.pre("save", async function (next) {
  if (this.isNew && !this.visitNumber) {
    const count = await mongoose.model("OPD").countDocuments();
    const year = new Date().getFullYear();
    this.visitNumber = `OPD-${year}-${String(count + 1).padStart(6, "0")}`;
  }

  if (this.vitals.weight && this.vitals.height) {
    const heightInMeters = this.vitals.height / 100;
    this.vitals.bmi = (
      this.vitals.weight /
      (heightInMeters * heightInMeters)
    ).toFixed(2);
  }

  next();
});

module.exports = mongoose.model("OPD", OPDSchema);
