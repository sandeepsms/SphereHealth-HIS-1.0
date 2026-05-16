const mongoose = require("mongoose");

const EmergencySchema = new mongoose.Schema(
  {
    // Proper ObjectId ref so populate works reliably across queries.
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Patient",
    },
    UHID: {
      type: String,
      required: true,
    },
    // Denormalised so the queue/board can render without populate too
    patientName: { type: String },
    age:         { type: Number },
    gender:      { type: String, enum: ["Male", "Female", "Other"] },
    contactNumber: { type: String },
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
    // Filled in by the doctor after examination — not required at intake.
    provisionalDiagnosis: {
      type: String,
      default: "",
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
    // Disposition is decided at the END of the ER stay (doctor sets it).
    // At intake (receptionist's call) it's not known — so not required.
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
        "Pending",
      ],
      default: "Pending",
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

// Atomic sequence via Counter — replaces `countDocuments()+1` race.
const { nextSequence: nextSeqER } = require("../../utils/counter");

EmergencySchema.pre("validate", async function (next) {
  if (this.isNew && !this.emergencyNumber) {
    try {
      const year = new Date().getFullYear();
      const seq  = await nextSeqER(`emergency:${year}`);
      this.emergencyNumber = `ER-${year}-${String(seq).padStart(6, "0")}`;
    } catch (err) {
      return next(err);
    }
  }
  next();
});

module.exports =
  mongoose.models.Emergency ||
  mongoose.model("Emergency", EmergencySchema);
