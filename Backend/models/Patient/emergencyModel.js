const mongoose = require("mongoose");

const EmergencySchema = new mongoose.Schema(
  {
    patientId: {
      type: String,
      required: true,
      ref: "Patient",
    },
    UHID: {
      type: String,
      required: true,
    },
    emergencyNumber: {
      type: String,
      unique: true,
    },
    arrivalDate: {
      type: Date,
      default: Date.now,
    },
    arrivalMode: {
      type: String,
      enum: ["Ambulance", "Walk-in", "Police", "Referred", "Other"],
      required: true,
    },
    triageCategory: {
      type: String,
      enum: ["Critical", "Emergency", "Urgent", "Semi-urgent", "Non-urgent"],
      required: true,
    },
    triageTime: {
      type: Date,
      default: Date.now,
    },
    isMLC: {
      type: Boolean,
      default: false,
    },
    mlcNumber: String,
    policeStation: String,
    informedPolice: Boolean,
    consultantIncharge: {
      type: String,
      required: true,
    },
    presentingComplaints: {
      type: String,
      required: true,
    },
    complaintDuration: String,
    historyOfPresentIllness: String,
    pastMedicalHistory: String,
    surgicalHistory: String,
    allergyHistory: String,
    currentMedications: String,
    familyHistory: String,
    vitals: {
      weight: Number,
      temperature: Number,
      bloodPressure: String,
      pulse: Number,
      respiratoryRate: Number,
      oxygenSaturation: Number,
      painScore: {
        type: Number,
        min: 0,
        max: 10,
      },
      glasgowComaScale: Number,
    },
    generalExamination: {
      levelOfConsciousness: String,
      nutritionalStatus: String,
      pallor: String,
      icterus: String,
      cyanosis: String,
      clubbing: String,
      lymphNodes: String,
      pedalEdema: String,
    },
    respiratorySystem: {
      inspection: String,
      breathSounds: String,
      addedSounds: String,
      percussionNote: String,
      tracheaPosition: String,
      findings: String,
    },
    cardiovascularSystem: {
      heartRate: Number,
      heartRhythm: String,
      heartSounds: String,
      murmur: {
        present: Boolean,
        timing: String,
        location: String,
        radiation: String,
      },
      peripheralPulses: String,
      jvp: String,
      findings: String,
    },
    abdomen: {
      inspection: String,
      tenderness: String,
      locationOfTenderness: String,
      organomegaly: [String],
      bowelSounds: String,
      ascites: String,
      findings: String,
    },
    centralNervousSystem: {
      consciousnessLevel: String,
      orientation: String,
      motorSystem: {
        focalDeficit: Boolean,
        affectedSide: String,
        tone: String,
      },
      reflexes: {
        deepTendonReflexes: String,
        plantarReflex: String,
        side: String,
      },
      cranialNerves: String,
      speech: String,
      sensorySystem: String,
      findings: String,
    },
    neurologicalDeficits: {
      hemiparesis: Boolean,
      hemiplegia: Boolean,
      paraparesis: Boolean,
      paraplegia: Boolean,
      quadriparesis: Boolean,
      quadriplegia: Boolean,
      details: String,
    },
    provisionalDiagnosis: {
      type: String,
      required: true,
    },
    finalDiagnosis: String,
    investigationsOrdered: [
      {
        testName: String,
        urgency: {
          type: String,
          enum: ["Stat", "Urgent", "Routine"],
          default: "Urgent",
        },
        orderedDate: Date,
        status: String,
        result: String,
      },
    ],
    treatmentGiven: {
      medications: [
        {
          medicineName: String,
          dosage: String,
          route: String,
          frequency: String,
          givenAt: Date,
        },
      ],
      procedures: [
        {
          procedureName: String,
          performedBy: String,
          performedAt: Date,
          notes: String,
        },
      ],
      ivFluids: String,
      oxygenTherapy: String,
      other: String,
    },
    dietAdvice: String,
    restraintsUsed: {
      physical: Boolean,
      chemical: Boolean,
      details: String,
      reason: String,
    },
    possibleRisks: String,
    fallRisk: {
      type: String,
      enum: ["Low", "Medium", "High"],
    },
    disposition: {
      type: String,
      enum: [
        "Admitted",
        "Discharged",
        "Referred",
        "Left Against Medical Advice",
        "Absconded",
        "Expired",
        "Observation",
      ],
      required: true,
    },
    admission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission",
    },
    dischargeDate: Date,
    dischargeInstructions: String,
    referredTo: {
      hospital: String,
      department: String,
      reason: String,
    },
    doctorNotes: String,
    nursingNotes: [
      {
        time: Date,
        note: String,
        recordedBy: String,
      },
    ],
    status: {
      type: String,
      enum: [
        "Active",
        "Under Observation",
        "Admitted",
        "Discharged",
        "Completed",
      ],
      default: "Active",
    },
  },
  {
    timestamps: true,
  }
);

EmergencySchema.index({ patientId: 1, arrivalDate: -1 });
EmergencySchema.index({ UHID: 1 });
EmergencySchema.index({ triageCategory: 1 });
EmergencySchema.index({ status: 1 });
EmergencySchema.index({ arrivalDate: -1 });

EmergencySchema.pre("save", async function (next) {
  if (this.isNew && !this.emergencyNumber) {
    const count = await mongoose.model("Emergency").countDocuments();
    const year = new Date().getFullYear();
    this.emergencyNumber = `ER-${year}-${String(count + 1).padStart(6, "0")}`;
  }
  next();
});

module.exports = mongoose.model("Emergency", EmergencySchema);
