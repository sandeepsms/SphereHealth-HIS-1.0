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
    // R7bd-A-8 / A1-HIGH-9 — visitNumber is `unique:true sparse:true`.
    // Pre-R7bd a newly-instantiated OPDRegistration that failed the
    // pre("validate") visitNumber assignment (counter outage, network blip)
    // produced a `visitNumber: null` row that then collided on the unique
    // index with EVERY OTHER null-visitNumber row. The receptionist saw
    // duplicate-key errors that bore no relation to the actual visit.
    // Sparse means "only enforce uniqueness when the field exists" so
    // documents with null visitNumber can coexist while we retry.
    visitNumber: {
      type: String,
      unique: true,
      sparse: true,
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
    // R7bt-PrintAudit-Phase2: generalExamination + systemicExamination were
    // declared as Object sub-schemas BUT the OPDAssessmentPage form sends
    // them as plain concatenated narrative strings ("Conscious, well-built,
    // afebrile..."). Mongoose silently cast string→Object to null on every
    // save, so the doctor's free-text exam disappeared from the print +
    // discharge summary. Schema-as-String matches what the form sends
    // today; structured findings live in the new `genExam` / `sysExam`
    // sub-docs below.
    generalExamination:  { type: String, default: "" },
    systemicExamination: { type: String, default: "" },

    // ── Structured Gen-Ex / Sys-Ex (checkbox + dropdown shape) ──
    // R7bt-PrintAudit-Phase2: the doctor's form lets them tick standard
    // findings instead of free-typing — these are stored alongside the
    // narrative above. Mixed type kept loose because the form is still
    // evolving (new tick-boxes added per department). Each visit's payload
    // mirrors the JSX `soap.genExam` / `soap.sysExam` shape.
    genExam: {
      built:           { type: String, default: "" },
      nourishment:     { type: String, default: "" },
      consciousness:   { type: String, default: "" },
      orientation:     { type: String, default: "" },
      hydration:       { type: String, default: "" },
      pallor:          { type: String, default: "" },
      pedalEdema:      { type: String, default: "" },
      icterus:         { type: Boolean, default: false },
      cyanosis:        { type: Boolean, default: false },
      clubbing:        { type: Boolean, default: false },
      lymphadenopathy: { type: Boolean, default: false },
      lymphLocation:   { type: String, default: "" },
      jvp:             { type: String, default: "" },
      febrile:         { type: Boolean, default: false },
    },
    sysExam: {
      cvs: {
        s1s2:           { type: String, default: "" },
        murmur:         { type: Boolean, default: false },
        murmurDetails:  { type: String, default: "" },
        rhythm:         { type: String, default: "" },
        other:          { type: String, default: "" },
      },
      rs: {
        airEntry:       { type: String, default: "" },
        breathSounds:   { type: String, default: "" },
        crepts:         { type: Boolean, default: false },
        wheeze:         { type: Boolean, default: false },
        rhonchi:        { type: Boolean, default: false },
        other:          { type: String, default: "" },
      },
      cns: {
        gcs:            { type: String, default: "" },
        speech:         { type: String, default: "" },
        tone:           { type: String, default: "" },
        power:          { type: String, default: "" },
        reflexes:       { type: String, default: "" },
        plantar:        { type: String, default: "" },
        other:          { type: String, default: "" },
      },
      pa: {
        soft:                 { type: Boolean, default: false },
        tender:               { type: Boolean, default: false },
        tenderLocation:       { type: String, default: "" },
        distended:            { type: Boolean, default: false },
        bowelSounds:          { type: String, default: "" },
        organomegaly:         { type: Boolean, default: false },
        organomegalyDetails:  { type: String, default: "" },
        mass:                 { type: Boolean, default: false },
        other:                { type: String, default: "" },
      },
    },

    // ── Diagnosis & Treatment ──
    // R7bt-PrintAudit-Phase2: Three-tier diagnosis (Provisional → Working →
    // Final) + shared ICD-10 code + patientStatus trajectory chip. Form
    // sends them on assessment save; before this fix the whitelist + schema
    // silently dropped working/icd10/patientStatus/etc. so the doctor saw
    // them on screen but they vanished on reload.
    provisionalDiagnosis: { type: String, default: "" },
    workingDiagnosis:     { type: String, default: "" },
    finalDiagnosis:       { type: String, default: "" },
    icd10Code:            { type: String, default: "" },
    icd10Description:     { type: String, default: "" },
    patientStatus:        { type: String, default: "" },
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

    // ── OBG History (female patients / Gynae OPD) ────────────────
    // R7bt-PrintAudit-Phase2: Frontend sends these as FLAT obg*-prefixed
    // fields so prints and discharge summaries can read them without
    // nested traversal. Pre-fix these were silently dropped by the save
    // service whitelist — the doctor's full menstrual / obstetric history
    // never made it to disk. Stored as strings (form sends raw values,
    // dates included, no Mongoose date casting on partially-filled forms).
    obgLmp:             { type: String, default: "" },
    obgEdd:             { type: String, default: "" },
    obgMenarche:        { type: String, default: "" },
    obgCycleLength:     { type: String, default: "" },
    obgFlowDays:        { type: String, default: "" },
    obgRegularity:      { type: String, default: "" },
    obgDysmenorrhea:    { type: String, default: "" },
    obgMenopause:       { type: String, default: "" },
    obgGravida:         { type: String, default: "" },
    obgPara:            { type: String, default: "" },
    obgAbortion:        { type: String, default: "" },
    obgLiving:          { type: String, default: "" },
    obgLastChildBirth:  { type: String, default: "" },
    obgDeliveryMode:    { type: String, default: "" },
    obgObComplications: { type: String, default: "" },
    obgMarried:         { type: String, default: "" },
    obgYearsMarried:    { type: String, default: "" },
    obgContraception:   { type: String, default: "" },
    obgLastPapSmear:    { type: String, default: "" },
    obgLastUSG:         { type: String, default: "" },
    obgPriorSurgery:    { type: String, default: "" },
    obgNotes:           { type: String, default: "" },

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
