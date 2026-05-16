// models/Clinical/MARModel.js
// NABH Standard: MOM.4 — Medication Administration Record

const mongoose = require("mongoose");

const AdministrationEntrySchema = new mongoose.Schema(
  {
    scheduledTime: { type: String, trim: true },
    actualTime: { type: Date },
    status: {
      type: String,
      enum: ["GIVEN", "HELD", "REFUSED", "NOT_AVAILABLE", "MISSED"],
      required: true },
    administeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NurseStaff" },
    nurseName: { type: String, trim: true },
    nurseStaffId: { type: String },
    batchNumber: { type: String, trim: true },
    reason: { type: String, trim: true },
    remarks: { type: String } },
  { _id: true }
);

const MARMedicationSchema = new mongoose.Schema(
  {
    medicineName: { type: String, required: true, trim: true },
    genericName: { type: String, trim: true },
    dose: { type: String, trim: true },
    unit: { type: String, trim: true },
    route: {
      type: String,
      enum: ["Oral", "IV", "IM", "SC", "SL", "Topical", "Inhalation", "Rectal", "Other"],
      default: "Oral" },
    frequency: { type: String, trim: true },
    scheduledTimes: [{ type: String, trim: true }],
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    prescribedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
    prescribedByName: { type: String, trim: true },
    doctorNoteId: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorNotes" },
    isHighAlert: { type: Boolean, default: false },
    isLASA: { type: Boolean, default: false },
    specialInstructions: { type: String },
    isActive: { type: Boolean, default: true },
    discontinuedAt: { type: Date },
    discontinuedBy: { type: String },
    discontinueReason: { type: String },
    administrations: [AdministrationEntrySchema] },
  { _id: true }
);

const MARSchema = new mongoose.Schema(
  {
    // ── Patient & Admission ──────────────────────────────────
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true },
    UHID: { type: String, required: true, trim: true },
    patientName: { type: String, trim: true },
    admissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission" },
    ipdNo: { type: String, required: true },

    // ── MAR Date ─────────────────────────────────────────────
    date: { type: Date, required: true, index: true },

    // ── Medications ──────────────────────────────────────────
    medications: [MARMedicationSchema],

    // ── Allergy Alert ────────────────────────────────────────
    allergies: [{ type: String, trim: true }],
    allergyAlertAcknowledged: { type: Boolean, default: false },

    // ── Status ───────────────────────────────────────────────
    status: {
      type: String,
      enum: ["ACTIVE", "CLOSED"],
      default: "ACTIVE" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "NurseStaff" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "NurseStaff" } },
  { timestamps: true, collection: "medication_administration_records" }
);

MARSchema.index({ UHID: 1, date: -1 });
MARSchema.index({ ipdNo: 1, date: -1 });
MARSchema.index({ admissionId: 1, date: -1 });

module.exports =
  mongoose.models.MAR || mongoose.model("MAR", MARSchema);
