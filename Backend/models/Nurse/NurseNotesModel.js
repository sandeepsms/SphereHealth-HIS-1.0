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
    oral:        { type: Number, default: 0, min: 0, max: 20000 },
    ivFluids:    { type: Number, default: 0, min: 0, max: 20000 },
    urineOutput: { type: Number, default: 0, min: 0, max: 20000 },
    otherOutput: { type: Number, default: 0, min: 0, max: 20000 },
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
    painAssessment: { type: String },

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
    signature: { type: String },        // base64 nurse digital signature
    signedByName: { type: String },

    status: { type: String, enum: ["draft", "submitted"], default: "draft" },
    submittedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "NurseStaff" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "NurseStaff" },

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
