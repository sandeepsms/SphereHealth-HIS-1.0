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
    consultantName: { type: String },

    department: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },

    soap: {
      subjective: { type: String },
      objective: { type: String },
      assessment: { type: String },
      plan: { type: String } },

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
    signature:    { type: String },                             // base64 PNG
    signedByName: { type: String },
    signedByReg:  { type: String },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" } },
  { timestamps: true, collection: "doctor_notes" },
);

DoctorNotesSchema.index({ patient: 1, visitDate: -1 });
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
