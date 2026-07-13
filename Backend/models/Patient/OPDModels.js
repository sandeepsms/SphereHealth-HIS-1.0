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

    // R7dq — Consultation fee charged for this specific visit.
    // Set by the receptionist (auto-filled from doctor's opdFirst /
    // opdFollowup rate via the R7dp wiring, with manual override).
    // autoBillingService.onOPDRegistered uses this as unitPriceOverride
    // when materialising the OPD-CON line item on the patient bill, so
    // the bill amount always matches what the receptionist showed the
    // patient. Pre-R7dq this field was on the wire but Mongoose silently
    // dropped it (not in schema) → bill amount was ServiceMaster default
    // (₹500) regardless of what the receptionist actually charged.
    consultationFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Optional UI hint stored alongside so the bill line + audit trail
    // can show "First visit" vs "Follow-up" vs "MLC" rate context.
    feeType: {
      type: String,
      enum: ["opdFirst", "opdFollowup", "emergency", "mlc", "ipdCrossConsult", ""],
      default: "",
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
    // R7hf — BP split into systolic+diastolic numbers (the legacy
    // `bloodPressure: "120/80"` string is auto-composed in
    // OPDService.updateVitals so every existing print template /
    // discharge consumer keeps working without change).
    // Random blood sugar added with capillary/venous + fasting context
    // so the auto-emitted NABH RBS Register row carries full provenance.
    vitals: {
      weight: Number,
      height: Number,
      bmi: Number,
      temperature: Number,
      bloodPressure: String,             // legacy "S/D" string (auto-composed)
      bloodPressureSystolic:  Number,    // mmHg
      bloodPressureDiastolic: Number,    // mmHg
      pulse: Number,
      respiratoryRate: Number,
      oxygenSaturation: Number,
      // ── Random Blood Sugar (RBS / GRBS) — auto-feeds NABH RBS register
      bloodSugarRandom: Number,          // numeric reading
      bloodSugarUnit: { type: String, enum: ["mg/dL", "mmol/L"], default: "mg/dL" },
      bloodSugarSampleType: {
        type: String,
        enum: ["capillary", "venous", "arterial", "unknown", ""],
        default: "",
      },
      bloodSugarFasting: {
        type: String,
        // Random covers GRBS; Fasting and PostPrandial swing the readingType
        enum: ["Random", "Fasting", "PostPrandial", ""],
        default: "",
      },
      bloodSugarNotes: { type: String, default: "" },
      bloodSugarTakenAt: Date,
    },
    vitalsStatus: {
      type: String,
      enum: ["Pending", "Done"],
      default: "Pending",
    },
    vitalsEnteredBy: String,
    vitalsEnteredAt: Date,
    // PD-03 — Nurse audit trio for the OPD Rx Nurse Pre-Assessment
    // sign-off footer. The print template reads these via the
    // OPDAssessmentPage caller and renders Date / Time / Employee ID /
    // Signature image in the footer row. Pre-PD-03 the writer
    // (NurseOPDQueuePage) never stamped them, so the footer always
    // showed "—" for those columns even when the nurse legitimately
    // took the vitals. Additive — pre-fix visits keep working since
    // these are optional strings.
    vitalsEnteredByEmployeeId: { type: String, default: "" },
    vitalsEnteredBySignature:  { type: String, default: "" },

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
        // R7bu — meal-status capture (Before food / After food / With food /
        // Bedtime). Pre-fix the form sent this on every Rx row but the
        // schema had no field, so Mongoose silently dropped it — Pharmacy /
        // MAR / print receipt never saw "before/after food", an instruction
        // patients routinely follow incorrectly without prompting. The
        // hydration mapper in OPDAssessmentPage now round-trips this back
        // into the form state, and the print payload reads it from here.
        mealStatus: { type: String, default: "" }, // "Before food" / "After food" / "With food" / "Bedtime"
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
    // R7hi — pain-toggle + general-HOPI fields. `hopiPainPresent` swaps
    // the form's mode on screen and gates the SOCRATES-style pain
    // fields above; the three narrative fields below apply to both
    // modes (fever / cough / fatigue / etc. → general path).
    hopiPainPresent:        { type: Boolean, default: false },
    hopiNarrative:          String,
    hopiTreatmentTried:     String,
    hopiResponseSoFar:      String,

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

    // ── Doctor's Digital Signature (per-visit snapshot) ─────────────
    // R7bu — Pre-fix the doctor's signature data URL was only forwarded to
    // the print popup. If the doctor logged out / refreshed / cleared cache,
    // every past visit reprinted with a blank signature box. We now stamp
    // the signature ON the visit at save time so reprints of historical
    // visits keep the original signature even if the doctor has since
    // changed it (or never has it cached again). Saved as a base64 data URL
    // to mirror what useDigitalSignature exposes. doctorSignedAt is set the
    // first time a signature is recorded on a visit.
    doctorSignatureImage: { type: String, default: "" }, // base64 data URL
    doctorSignedAt:       { type: Date,   default: null },

    // R7cj — Post-signature addendum notes. Once the doctor signs the
    // assessment, the structured form (Hx, exam, Dx, Rx, etc.) is locked
    // for medico-legal traceability. But a doctor may need to add a
    // follow-up observation (lab result came in, patient called back
    // with new symptom, family clarification). We APPEND to this array
    // — never overwrite — so the full timeline is preserved per NABH
    // AAC.4 (re-assessment) + MCI Reg 1.4.2 (signed-by + at).
    additionalNotes: {
      type: [{
        _id:        false,
        note:       { type: String, required: true, trim: true, maxlength: 4000 },
        addedAt:    { type: Date,   default: Date.now },
        addedBy:    { type: String, default: "" },     // user's full name
        addedById:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        addedByRole:{ type: String, default: "" },     // "Doctor" usually
      }],
      default: [],
    },

    // ── Post-signature assessment amendments (D8) ───────────────
    // Once the doctor signs (doctorSignatureImage stamped), the structured
    // assessment is medico-legally immutable: a subsequent /assessment POST is
    // blocked with a typed 409 (OPD_ASSESSMENT_SIGNED) UNLESS it carries an
    // explicit amendReason. When it does, the overwrite is allowed and captured
    // here append-only (never overwritten) — mirroring DoctorNotesModel
    // .amendments (NABH IMS.2 / MCI Reg 1.4.2). The original doctorSignedAt
    // attestation is preserved; only the structured fields the doctor re-sent
    // change.
    assessmentAmendments: {
      type: [{
        _id:         false,
        amendedAt:   { type: Date,   default: Date.now },
        reason:      { type: String, default: "", trim: true, maxlength: 1000 },
        amendedBy:   { type: String, default: "" },    // doctor's full name
        amendedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      }],
      default: [],
    },
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
        // R7hb — Short OPD visit number: OPD-YY-NN. Pre-R7hb this was
        // OPD-YYYY-NNNNNN which read poorly on every receipt + ledger
        // row. Year-keyed counter so fiscal-year tracking still works.
        const yy = String(new Date().getFullYear()).slice(-2);
        const seq = await nextSequence(`opd-visit:${yy}`);
        this.visitNumber = `OPD-${yy}-${String(seq).padStart(2, "0")}`;
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
