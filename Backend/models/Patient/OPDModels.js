const mongoose = require("mongoose");

const OPDSchema = new mongoose.Schema(
  {
    patientId: {
      type: String,
      required: true,
    },
    UHID: {
      type: String,
      required: true,
    },
    // Denormalized for display (no populate needed)
    patientName:   { type: String, default: "" },
    contactNumber: { type: String, default: "" },
    age:           { type: String, default: "" },
    gender:        { type: String, default: "" },
    paymentType:   { type: String, enum: ["GENERAL","TPA","CORPORATE","CASH"], default: "GENERAL" },
    visitNumber: {
      type: String,
      unique: true,
    },
    // Patient's sequential visit count (1st OPD, 2nd OPD…)
    patientVisitSeq: {
      type: Number,
      default: 1,
    },
    // Daily token number for queue management
    tokenNumber: {
      type: Number,
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

    // ── Department & Doctor (proper ObjectId refs for filtering) ──
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
    },
    department: {
      type: String, // kept for display / backward-compat
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
    },
    consultantName: {
      type: String,
    },

    // ── Chief Complaint & History ──
    chiefComplaint: {
      type: String,
      required: true,
    },
    complaintDuration: String,
    historyOfPresentIllness: String,
    pastMedicalHistory: String,
    allergyHistory: String,
    currentMedications: String,

    // ── Vitals (entered by Nurse) ──
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
    vitalsStatus: {
      type: String,
      enum: ["Pending", "Done"],
      default: "Pending",
    },
    vitalsEnteredBy: String,
    vitalsEnteredAt: Date,

    // ── Examination ──
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

    // ── Diagnosis & Treatment ──
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

    // ── Follow-up ──
    followUpRequired: { type: Boolean, default: false },
    followUpDate: Date,
    followUpInstructions: String,

    // ── Status ──
    status: {
      type: String,
      enum: ["Waiting", "In Progress", "Completed", "Referred"],
      default: "Waiting",
    },
    referredTo: String,
    doctorNotes: String,

    // ── HOPI — structured History of Present Illness ──
    hopiOnset:              String,
    hopiDurationValue:      String,
    hopiDurationUnit:       String,
    hopiProgression:        String,
    hopiCharacter:          String,
    hopiAssociatedSymptoms: [String],
    hopiAggravating:        String,
    hopiRelieving:          String,

    // ── Chronic Illnesses / Past Medical History ──
    chronicConditions: [{ condition: String, duration: String }],
    chronicOthers:     String,

    // ── SOAP Assessment (Doctor) ──────────────────────────────
    subjectiveNote:  String,   // S — Chief complaint / history
    objectiveNote:   String,   // O — Examination findings
    assessmentNote:  String,   // A — Clinical assessment / differentials
    planNote:        String,   // P — Treatment plan
    assessedBy:      String,   // Doctor who completed the assessment
    assessedAt:      Date,     // When it was saved
  },
  { timestamps: true }
);

OPDSchema.index({ patientId: 1, visitDate: -1 });
OPDSchema.index({ UHID: 1 });
OPDSchema.index({ visitDate: -1 });
OPDSchema.index({ departmentId: 1, visitDate: -1 });
OPDSchema.index({ doctorId: 1, visitDate: -1 });
OPDSchema.index({ vitalsStatus: 1 });

// Use pre("validate") so the auto-generated visit number is populated BEFORE
// Mongoose's required-check runs (consistent with appointment / emergency /
// user models). Atomic sequence via the shared Counter collection — replaces
// the legacy `countDocuments() + 1` race that produced duplicate visitNumbers
// under concurrent OPD registrations.
const { nextSequence } = require("../../utils/counter");

OPDSchema.pre("validate", async function (next) {
  try {
    if (this.isNew) {
      if (!this.visitNumber) {
        const year = new Date().getFullYear();
        const seq = await nextSequence(`opd:${year}`);
        this.visitNumber = `OPD-${year}-${String(seq).padStart(6, "0")}`;
      }
      if (!this.tokenNumber) {
        const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const docKey  = this.doctorId ? String(this.doctorId) : "global";
        this.tokenNumber = await nextSequence(`opd-token:${dateKey}:${docKey}`);
      }
    }
  } catch (err) {
    return next(err);
  }
  next();
});

OPDSchema.pre("save", async function (next) {

  // BMI calculation
  if (this.vitals && this.vitals.weight && this.vitals.height) {
    const h = this.vitals.height / 100;
    this.vitals.bmi = parseFloat((this.vitals.weight / (h * h)).toFixed(2));
  }

  next();
});

module.exports =
  mongoose.models.OPDRegistration ||
  mongoose.model("OPDRegistration", OPDSchema);
