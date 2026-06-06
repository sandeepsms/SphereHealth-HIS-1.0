// Nurse/models/nurseNotesModel.js
// References: Patient, NurseStaff, Doctor, Department, DoctorNotes models

const mongoose = require("mongoose");

// Clinical sanity bounds — anything outside these is almost certainly a
// keypad slip, not a real vital, and triggering a downstream alert on a
// `pulse: -100` or `temp: NaN` is patient-safety unsound. Wide enough to
// admit genuine extremes (neonatal HR, hyperthermia, severe hypotension)
// while rejecting impossible data. Security/safety audit 2026-05-17 A-03.
const NurseVitalsSchema = new mongoose.Schema(
  {
    bp: {
      systolic:  { type: Number, min: 30,  max: 300 },
      diastolic: { type: Number, min: 10,  max: 250 },
    },
    pulse:      { type: Number, min: 0,   max: 300 },
    temp:       { type: Number, min: 25,  max: 45 },
    rr:         { type: Number, min: 0,   max: 80 },
    spo2:       { type: Number, min: 0,   max: 100 },
    bloodSugar: { type: Number, min: 0,   max: 1500 },
  },
  { _id: false },
);

const OrderExecutionSchema = new mongoose.Schema(
  {
    doctorNoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorNotes",
      required: true,
    },
    orderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    instruction: { type: String, required: true },
    type: { type: String },
    status: {
      type: String,
      enum: ["done", "skipped", "partial"],
      required: true,
      default: "done",
    },
    executedAt: { type: Date, default: Date.now },
    remarks: { type: String },
  },
  { _id: true },
);

// Intake/Output in ml. `min: 0` keeps the I/O sheet sane — a nurse cannot
// "give back" 500ml of oral feed or "uncatheterise" 200ml of urine. Upper
// bound is generous so a 24-hour cumulative entry isn't rejected.
// Patient-safety audit 2026-05-17 A-04.
const IOSchema = new mongoose.Schema(
  {
    oral:             { type: Number, default: 0, min: 0, max: 20000 },
    ivFluids:         { type: Number, default: 0, min: 0, max: 20000 },
    urineOutput:      { type: Number, default: 0, min: 0, max: 20000 },
    otherOutput:      { type: Number, default: 0, min: 0, max: 20000 },
    // R7fp — additional I/O channels the nursing UI was already sending
    // but the schema silently dropped (Mongoose strips unknown fields).
    // NG-tube output, IV med-fluids, surgical drain, blood loss/products,
    // emesis must persist so the 24-hour I/O totalisation and the print
    // sheet show the true balance.
    nasogastricOutput:{ type: Number, default: 0, min: 0, max: 20000 },
    ivMedFluids:      { type: Number, default: 0, min: 0, max: 20000 },
    drainOutput:      { type: Number, default: 0, min: 0, max: 20000 },
    bloodLoss:        { type: Number, default: 0, min: 0, max: 20000 },
    bloodProducts:    { type: Number, default: 0, min: 0, max: 20000 },
    emesis:           { type: Number, default: 0, min: 0, max: 20000 },
    notes: { type: String },
  },
  { _id: false },
);

const NurseNotesSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: false, // allow saving even if patient ObjectId lookup fails
      index: true,
    },
    patientName: { type: String },
    patientUHID: { type: String, index: true },
    ipdNo: { type: String, required: false, index: true },

    // R7hr-89-A2 — admissionId is the join key for the partial-unique
    // "one Initial Assessment per admission" guard below. The schema
    // previously stripped this field silently; declaring it lets the
    // (admissionId, noteType) partial-unique index actually function
    // and gives the patient-history aggregator a second join lane.
    admissionId: { type: mongoose.Schema.Types.ObjectId, ref: "Admission", index: true, default: null },

    noteDate: { type: Date, required: true, default: Date.now },
    shift: {
      type: String,
      enum: ["morning", "evening", "night", "general"],
      default: "general",
    },

    nurse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NurseStaff",
      required: false, // NurseStaff and Users are separate — not always linked
    },
    nurseName: { type: String },
    nurseStaffId: { type: String },
    nurseEmployeeId: { type: String },
    nurseDesignation: { type: String },

    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
    doctorName: { type: String },
    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },

    generalCondition: {
      conscious: { type: Boolean, default: false },
      oriented: { type: Boolean, default: false },
      cooperative: { type: Boolean, default: false },
      drowsy: { type: Boolean, default: false },
      unconscious: { type: Boolean, default: false },
    },

    vitals: NurseVitalsSchema,
    painScore: { type: Number, min: 0, max: 10, default: 0 },
    // R7fp — painAssessment is BOTH a structured payload from the
    // pain-assessment page (PQRST + interventions) AND a free-text
    // narrative from the daily note form. String type rejected the
    // structured payload on save; promote to Mixed so either shape
    // round-trips intact.
    painAssessment: { type: mongoose.Schema.Types.Mixed },

    // R7fp — IV infusion payload (rate / fluid / additives / site swap)
    // sent by the IV-infusion subform. Previously dropped because the
    // schema had no field for it.
    ivInfusion: { type: mongoose.Schema.Types.Mixed },

    ivLine: {
      site: { type: String },
      condition: {
        type: String,
        enum: ["Patent", "Swollen", "Redness", "Removed", "Not applicable"],
        default: "Patent",
      },
      notes: { type: String },
    },

    intakeOutput: IOSchema,
    ordersExecuted: [OrderExecutionSchema],

    nursingCare: {
      positionChanged: { type: Boolean, default: false },
      morningHygiene: { type: Boolean, default: false },
      bedsoreCheck: { type: Boolean, default: false },
      catheterCare: { type: Boolean, default: false },
      woundDressing: { type: Boolean, default: false },
      patientEducation: { type: Boolean, default: false },
      otherCare: { type: String },
    },

    remarks: { type: String },

    // ── Note type identifier (vitals, pain, wound, neuro, mews, initial, etc.) ──
    noteType: { type: String, default: "general" },

    // ── Module-specific structured data (stored as-is for any note type) ──
    // Covers: neuroAssessment, painAssessment, woundCare, skinAssessment,
    //         fallRisk, procedure, bloodTransfusion, ivInfusion, discharge,
    //         mewsScore, dailyAssessment, initialAssessment, carePlan,
    //         nutritionalAssessment, patientEducation, etc.
    noteData: { type: mongoose.Schema.Types.Mixed, default: {} },

    // ── Tags / flags ──
    tags: [{ type: String }],
    isCriticalEvent: { type: Boolean, default: false },
    // R7az-D2-MED-7: cap signature payload (~150KB).
    signature: { type: String, maxlength: [200000, "signature too large (max 200,000 chars ≈ 150KB)"] },
    signedByName: { type: String },
    // R7go — Hospital employee ID of the signer (User.employeeId, e.g.
    // NUR-26-00001). Surfaced next to the name in patient panel + printed
    // Complete File. May differ from nurseEmployeeId when an admin or
    // charge nurse co-signs another nurse's note.
    signedByEmpId: { type: String },

    // R7az-D2-MED-8: append-only nurse confirmation history for the
    // "doctor's order confirmed by nurse" flow on this note. Each
    // confirmSingleOrder push lands here instead of overwriting prior
    // confirmations (which used to lose the trail entirely).
    nurseConfirmations: [{
      _id:       false,
      nurseId:   { type: mongoose.Schema.Types.ObjectId, ref: "NurseStaff" },
      nurseName: { type: String, trim: true },
      orderId:   { type: mongoose.Schema.Types.ObjectId },
      doctorNoteId: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorNotes" },
      ts:        { type: Date, default: Date.now },
      status:    { type: String },
      remarks:   { type: String, trim: true },
    }],

    status: { type: String, enum: ["draft", "submitted", "amended"], default: "draft" },
    submittedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "NurseStaff" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "NurseStaff" },

    // ── Amendment trail (R7hr-72-A2, NABH HIC.7) ─────────────────────
    // Each POST /:id/amend pushes one entry here BEFORE the whitelisted
    // fields are mutated. Append-only — the audit row carries the
    // pre-mutation snapshot so a surveyor can replay the timeline of
    // every post-submission edit. Mirror of DoctorNote.amendments[] (A1).
    amendments: [{
      _id: false,
      at:        { type: Date, default: Date.now },
      by:        { type: mongoose.Schema.Types.ObjectId, ref: "NurseStaff" },
      byName:    { type: String, trim: true },
      byEmpId:   { type: String, trim: true },
      byRole:    { type: String, trim: true },
      reason:    { type: String, trim: true },
      fields:    [{ type: String }],
      before:    { type: mongoose.Schema.Types.Mixed },
      after:     { type: mongoose.Schema.Types.Mixed },
    }],

    // ── Addendum chain (R7az-D2-HIGH-4, NABH HIC.7) ──────────────────
    // SUBMITTED notes are append-only — corrections create a new doc
    // with originalNoteId + supersedesNoteId set instead of mutating.
    originalNoteId:    { type: mongoose.Schema.Types.ObjectId, ref: "NurseNotes", default: null, index: true },
    supersedesNoteId:  { type: mongoose.Schema.Types.ObjectId, ref: "NurseNotes", default: null },
    isAddendum:        { type: Boolean, default: false, index: true },

    // ── Late-entry / retroactive note (NABH HIC.6 — backdated entries) ──
    // When a nurse note is added AFTER the admission has been discharged
    // (e.g. the discharge was finalized prematurely and the handover note
    // was missed), we permit the entry but flag it as retroactive so the
    // audit trail is unambiguous. Reason is REQUIRED on late-entry — NABH
    // surveyors look for documented justification on any backdated
    // clinical record. `lateEntryAt` is the wall-clock time the entry was
    // actually typed (vs `noteDate` which is the clinical date being
    // documented); having both lets us prove the timing on audit.
    lateEntry:        { type: Boolean, default: false, index: true },
    lateEntryReason:  { type: String, trim: true },
    lateEntryAt:      { type: Date },
    lateEntryBy:      { type: String, trim: true },
    lateEntryByRole:  { type: String, trim: true },
  },
  { timestamps: true, collection: "nurse_notes" },
);

NurseNotesSchema.index({ patient: 1, noteDate: -1 });
NurseNotesSchema.index({ ipdNo: 1, noteDate: -1 });
NurseNotesSchema.index({ nurse: 1, noteDate: -1 });
NurseNotesSchema.index({ ipdNo: 1, shift: 1, noteDate: -1 });

// ── R7hr-89-A2: one Initial Assessment per admission (NABH AAC.1) ──
// Two partial-unique indexes (admissionId is sometimes blank on legacy /
// pre-resolution rows, so a single index on it would let duplicates slip
// through whenever the admission lookup misses). The pre('save') hook
// below converts the resulting E11000 into a typed
// DUPLICATE_INITIAL_ASSESSMENT error so the controller can surface a
// clean 409 instead of a stringly-typed Mongo write error.
//
// Primary lane keyed on admissionId — used when the service resolves the
// active admission. Named so the service layer can detect the right
// index by name in the E11000 path.
NurseNotesSchema.index(
  { admissionId: 1, noteType: 1 },
  {
    name: "uniq_initial_per_admission",
    unique: true,
    partialFilterExpression: {
      noteType: "initial",
      admissionId: { $type: "objectId" },
    },
  },
);
// Fallback lane keyed on ipdNo for the (still common) case where the
// admission lookup missed and admissionId landed null. Guards against a
// second Initial Assessment slipping through on the same admission
// number.
NurseNotesSchema.index(
  { ipdNo: 1, noteType: 1 },
  {
    name: "uniq_initial_per_ipd",
    unique: true,
    partialFilterExpression: {
      noteType: "initial",
      ipdNo: { $type: "string", $gt: "" },
    },
  },
);

// ── R7hr-89-A2: DUPLICATE_INITIAL_ASSESSMENT pre-save guard ──────────
// The partial-unique indexes above prevent a second Initial Assessment
// from landing on the same admission at the storage layer, but the raw
// E11000 a duplicate triggers is opaque ("E11000 duplicate key error
// collection: nurse_notes index: uniq_initial_per_admission ..."). This
// hook surfaces a typed error the service / controller can match on so
// the API returns a clean 409 with code: DUPLICATE_INITIAL_ASSESSMENT.
//
// Mirror of DoctorNotes A1 (R7hr-89-A1) — same error shape, same code,
// so the front-end can show a single "Initial Assessment already exists
// for this admission" toast regardless of which note type collided.
NurseNotesSchema.post("save", function (err, doc, next) {
  // Mongoose dispatches the err-handling form of the post('save') hook
  // for unique-index violations. We translate E11000 on either of the
  // two IA-uniqueness indexes only — every other duplicate-key event
  // (legacy compound indexes, future ones) passes through untouched.
  if (
    err &&
    err.name === "MongoServerError" &&
    err.code === 11000 &&
    (err.message?.includes("uniq_initial_per_admission") ||
      err.message?.includes("uniq_initial_per_ipd"))
  ) {
    const e = new Error(
      "Initial Assessment already exists for this admission (NABH AAC.1 — one per admission)",
    );
    e.code = "DUPLICATE_INITIAL_ASSESSMENT";
    e.statusCode = 409;
    return next(e);
  }
  return next(err);
});

// Post-save: update DoctorNotes order statuses automatically
NurseNotesSchema.post("save", async function (doc) {
  if (doc.status !== "submitted" || !doc.ordersExecuted?.length) return;
  const DoctorNotes = mongoose.model("DoctorNotes");

  for (const exec of doc.ordersExecuted) {
    try {
      await DoctorNotes.updateOne(
        {
          _id: new mongoose.Types.ObjectId(exec.doctorNoteId.toString()),
          "orders._id": new mongoose.Types.ObjectId(exec.orderId.toString()),
        },
        {
          $set: {
            "orders.$.nurseStatus": exec.status,
            "orders.$.nurseConfirmedBy": doc.nurse,
            "orders.$.nurseConfirmedAt": exec.executedAt || new Date(),
            "orders.$.nurseRemarks": exec.remarks || "",
          },
        },
      );
    } catch (e) {
      console.error("nurseNotesModel post-save error:", e.message);
    }
  }
});

NurseNotesSchema.virtual("totalIntake").get(function () {
  return (this.intakeOutput?.oral || 0) + (this.intakeOutput?.ivFluids || 0);
});
NurseNotesSchema.virtual("totalOutput").get(function () {
  return (
    (this.intakeOutput?.urineOutput || 0) +
    (this.intakeOutput?.otherOutput || 0)
  );
});

// ✅ FIX:
module.exports =
  mongoose.models.NurseNotes || mongoose.model("NurseNotes", NurseNotesSchema);
