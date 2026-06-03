// Doctor/models/doctorNotesModel.js
// References: Patient, Doctor, Department, NurseStaff models

const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "medication",
        "iv_fluid",
        "investigation",
        "procedure",
        "diet",
        "other",
      ],
      default: "other" },
    instruction: { type: String, trim: true, default: "" },
    route: { type: String },           // free-form — no enum restriction
    frequency: { type: String },
    duration: { type: String },
    notes: { type: String },

    // IV dilution / vehicle — doctor specifies diluent when ordering injectable drugs
    dilutionVolume: { type: Number },      // ml  e.g. 100
    dilutionFluid:  { type: String },      // e.g. "NS 0.9%", "DNS", "D5W", "RL"

    // Written back by nurseNotesService when nurse confirms
    nurseStatus: {
      type: String,
      enum: ["pending", "done", "skipped", "partial"],
      default: "pending" },
    nurseConfirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NurseStaff" },
    nurseConfirmedAt: { type: Date },
    nurseRemarks: { type: String } },
  { _id: true },
);

const VitalsSchema = new mongoose.Schema(
  {
    bp: { systolic: Number, diastolic: Number },
    pulse: Number,
    temp: Number,
    rr: Number,
    spo2: Number },
  { _id: false },
);

const DoctorNotesSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      index: true,
      // Not strictly required — ipdNo + patientUHID are the primary keys for IPD notes
    },
    patientName: { type: String },
    patientUHID: { type: String },
    ipdNo: { type: String, required: true },

    // R7bv — admissionId is referenced by the
    // `{ admissionId: 1, visitDate: -1 }` compound index below but was
    // never declared as a schema field, so strict-mode Mongoose silently
    // stripped it on every save and the patient-history aggregator's
    // `$or: [{admissionId}, {ipdNo}]` clause never matched a doctor note
    // on the admissionId branch. Adding the field here makes the index
    // useful and gives the aggregator a second join key.
    admissionId: { type: mongoose.Schema.Types.ObjectId, ref: "Admission", index: true, default: null },

    visitDate: { type: Date, required: true, default: Date.now },
    shift: {
      type: String,
      enum: ["morning", "afternoon", "evening", "night"],
      default: "morning" },

    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User" },
    doctorName: { type: String },
    doctorId: { type: String },
    doctorRegNo: { type: String },
    // R7go — Hospital employee ID (User.employeeId, e.g. DOC-26-00001).
    // Surfaced next to the doctor's name in the patient panel + printed
    // Complete File so every signed note is traceable to a specific
    // staff record without joining back to the User collection. NABH AAC.7
    // audit-trail requirement; kept denormalized for print speed.
    doctorEmpId: { type: String },
    consultantName: { type: String },

    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },

    // R7u: cap each SOAP field at 50K chars. Real progress notes are <2K
    // chars; the cap prevents a pasted base64 attachment or runaway
    // copy-paste from bloating the document beyond Mongo's 16MB limit.
    soap: {
      subjective: { type: String, maxlength: [50000, "subjective too long (max 50,000 chars)"] },
      objective:  { type: String, maxlength: [50000, "objective too long (max 50,000 chars)"] },
      assessment: { type: String, maxlength: [50000, "assessment too long (max 50,000 chars)"] },
      plan:       { type: String, maxlength: [50000, "plan too long (max 50,000 chars)"] } },

    vitals: VitalsSchema,
    investigations: [{ type: String }],
    orders: [OrderSchema],
    provisionalDiagnosis: { type: String },
    workingDiagnosis:     { type: String },
    finalDiagnosis:       { type: String },
    icd10Code:            { type: String },
    icd10Description:     { type: String },
    // SNOMED CT clinical-finding code — emitted by FHIR export when present.
    // Optional; ICD-10 stays the primary registry identifier.
    snomedCode:           { type: String, default: "" },
    snomedDisplay:        { type: String, default: "" },

    status: {
      type: String,
      enum: ["draft", "signed", "amended"],
      default: "draft" },
    signedAt: { type: Date },

    // Extended NABH fields
    // FIX (audit P11-B1): noteType is now an enum so the frontend can't slip
    // a junk value through and end up with un-bucketed notes that no view
    // filter ever matches. Keep "general" as the default since older notes
    // were created without a type and validate cleanly against it.
    noteType: {
      type: String,
      enum: [
        "general",
        "admission",
        // R7g: "initial" is the NABH COP.1 first contact note — distinct
        // from "admission" (administrative) and "progress" (daily). The
        // frontend's Initial Assessment modal posts this value; without
        // it, save fails enum validation silently.
        "initial",
        "progress",
        "daily",
        "icu",
        "procedure",
        "consultation",
        "assessment",
        "discharge",
        "death",
        "amendment",
        "operative",
        "preop",
        "postop",
      ],
      default: "general",
    },
    isCritical:   { type: Boolean, default: false },
    tags:         [{ type: String }],
    noteDetails:  { type: mongoose.Schema.Types.Mixed },        // ICU/procedure/consultation specifics
    patientStatus:{ type: String },

    // Digital signature
    // R7az-D2-MED-7: cap signature payload at ~150KB (200KB base64) so a
    // pasted full-page image can't bloat the doctor_notes collection.
    // A genuine signature stroke encodes well under 50KB.
    signature:    { type: String, maxlength: [200000, "signature too large (max 200,000 chars ≈ 150KB)"] },
    signedByName: { type: String },
    signedByReg:  { type: String },
    // R7go — Hospital employee ID of the signer (may differ from doctorEmpId
    // when an admin or consultant signs on behalf of a resident). Surfaced
    // in the SIGNED & SUBMITTED footer alongside the name.
    signedByEmpId: { type: String },
    // R7fw-FIX1 — handover-sign provenance. Set when the signer is not the
    // original author (consultant signing a resident's draft, admin
    // signing a doctor's stale draft, etc.). The print signature row
    // reads "Signed by Dr. X (Reg …) on behalf of Dr. Y" so the
    // delegation is unambiguous in court / NABH audit review.
    handoverFromName: { type: String, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // ── Late-entry metadata (R7az-D2-CRIT-6, NABH HIC.6) ─────────────
    // Set server-side in doctorNotesService when (now - visitDate) > 4h.
    // Reason is required; lateEntryAt is the wall-clock typing time.
    lateEntry:        { type: Boolean, default: false, index: true },
    lateEntryReason:  { type: String,  trim: true },
    lateEntryAt:      { type: Date },

    // ── Addendum chain (R7az-D2-HIGH-4, NABH HIC.7) ──────────────────
    // SIGNED notes are immutable. An "edit" creates a new document
    // pointing back to the original via originalNoteId (root of the
    // chain) and the doc it directly supersedes (supersedesNoteId).
    // isAddendum lets list queries filter the latest revision.
    originalNoteId:    { type: mongoose.Schema.Types.ObjectId, ref: "DoctorNotes", default: null, index: true },
    supersedesNoteId:  { type: mongoose.Schema.Types.ObjectId, ref: "DoctorNotes", default: null },
    isAddendum:        { type: Boolean, default: false, index: true },

    // ── Verbal-order scaffold (R7az-D10-MED-3) ─────────────────────────
    // Out-of-scope for this round (24h co-sign enforcement deferred —
    // belongs on DoctorOrder which is owned by Agent C). These fields
    // exist on DoctorNotes so verbal-order doctor notes can be marked
    // and a co-sign workflow added later without a schema migration.
    // TODO(verbal-order): enforce 24h co-sign window in a follow-up.
    isVerbal:    { type: Boolean, default: false },
    coSignedBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    coSignedAt:  { type: Date, default: null } },
  { timestamps: true, collection: "doctor_notes" },
);

// R7az-D2-CRIT-6 validator: visitDate older than the late-entry window
// (4h) without lateEntry=true + reason is rejected at the schema layer.
// Defence-in-depth — the service also enforces this, but a direct
// .save() path (tests, scripts) must not slip past either.
DoctorNotesSchema.pre("validate", function (next) {
  try {
    if (!this.isNew) return next();
    const vt = this.visitDate ? new Date(this.visitDate).getTime() : null;
    if (!vt) return next();
    const ageMs = Date.now() - vt;
    if (ageMs > 4 * 60 * 60 * 1000 && !this.lateEntry) {
      return next(new Error(
        "DoctorNote visitDate is more than 4h in the past — set lateEntry=true + lateEntryReason (NABH HIC.6)",
      ));
    }
    if (this.lateEntry && !(this.lateEntryReason && String(this.lateEntryReason).trim())) {
      return next(new Error("lateEntryReason is required when lateEntry=true (NABH HIC.6)"));
    }
  } catch (e) {
    return next(e);
  }
  next();
});

DoctorNotesSchema.index({ patient: 1, visitDate: -1 });
DoctorNotesSchema.index({ patientUHID: 1, visitDate: -1 });
DoctorNotesSchema.index({ ipdNo: 1, visitDate: -1 });
DoctorNotesSchema.index({ doctor: 1, visitDate: -1 });
DoctorNotesSchema.index({ "orders.nurseStatus": 1 });
// Mirror of NurseNotes — drives the "this doctor's morning rounds on
// this admission today" query that the rounds-board page issues for
// every admission load. Audit C-04 (round-13 close-out).
DoctorNotesSchema.index({ ipdNo: 1, shift: 1, visitDate: -1 });
DoctorNotesSchema.index({ admissionId: 1, visitDate: -1 });

// All pending orders for a patient — used by nurse
DoctorNotesSchema.statics.getAllPendingOrders = async function (ipdNo) {
  const notes = await this.find({
    ipdNo,
    "orders.nurseStatus": "pending",
    status: "signed" })
    .populate("doctor", "personalInfo doctorId")
    .lean();

  const pending = [];
  notes.forEach((n) => {
    n.orders
      .filter((o) => o.nurseStatus === "pending")
      .forEach((o) => {
        pending.push({
          ...o,
          noteId: n._id,
          visitDate: n.visitDate,
          doctorName: n.doctorName,
          doctorId: n.doctorId });
      });
  });
  return pending;
};

DoctorNotesSchema.virtual("pendingOrdersCount").get(function () {
  return this.orders.filter((o) => o.nurseStatus === "pending").length;
});

module.exports =
  mongoose.models.DoctorNotes ||
  mongoose.model("DoctorNotes", DoctorNotesSchema);
