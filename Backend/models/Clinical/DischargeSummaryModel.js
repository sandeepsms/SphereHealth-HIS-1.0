// models/Clinical/DischargeSummaryModel.js
// NABH Standard: AAC.5, COP.2 — Discharge Summary

const mongoose = require("mongoose");

const MedicationOnDischargeSchema = new mongoose.Schema(
  {
    medicineName: { type: String, required: true, trim: true },
    dose: { type: String, trim: true },
    route: { type: String, trim: true },
    frequency: { type: String, trim: true },
    duration: { type: String, trim: true },
    remarks: { type: String } },
  { _id: true }
);

const InvestigationSummarySchema = new mongoose.Schema(
  {
    testName: { type: String, trim: true },
    result: { type: String, trim: true },
    date: { type: Date },
    remarks: { type: String } },
  { _id: true }
);

const ProcedureSchema = new mongoose.Schema(
  {
    procedureName: { type: String, trim: true },
    date: { type: Date },
    performedBy: { type: String, trim: true },
    notes: { type: String } },
  { _id: true }
);

const DischargeSummarySchema = new mongoose.Schema(
  {
    // ── Patient & Admission Info ──────────────────────────────
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true },
    UHID: { type: String, required: true, trim: true },
    patientName: { type: String, trim: true },
    age: { type: String },
    gender: { type: String },
    contactNumber: { type: String },

    admissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission" },
    ipdNo: { type: String, index: true },
    admissionDate: { type: Date },
    dischargeDate: { type: Date },

    // ── Treating Team ────────────────────────────────────────
    attendingDoctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor" },
    doctorName: { type: String, trim: true },
    doctorRegNo: { type: String },
    department: { type: String, trim: true },
    consultants: [{ type: String, trim: true }],

    // ── Diagnosis ────────────────────────────────────────────
    admittingDiagnosis: { type: String, trim: true },
    finalDiagnosis: { type: String, trim: true },
    icdCode: { type: String, trim: true },
    comorbidities: [{ type: String, trim: true }],

    // ── Clinical Narrative ───────────────────────────────────
    historyOfPresentIllness: { type: String },
    courseInHospital: { type: String },
    significantFindings: { type: String },

    // ── Investigations ───────────────────────────────────────
    investigationsSummary: [InvestigationSummarySchema],

    // ── Procedures / Surgeries ───────────────────────────────
    proceduresDone: [ProcedureSchema],

    // ── Condition & Discharge ────────────────────────────────
    conditionOnDischarge: {
      type: String,
      enum: ["Stable", "Improved", "Unchanged", "Deteriorated", "Critical", "LAMA", "Expired"],
      default: "Stable" },
    totalDaysAdmitted: { type: Number, default: 0 },

    // ── Discharge Instructions ───────────────────────────────
    medicationsOnDischarge: [MedicationOnDischargeSchema],
    dietAdvice: { type: String },
    activityAdvice: { type: String },
    woundCareInstructions: { type: String },
    specialInstructions: { type: String },
    restrictionsAndPrecautions: { type: String },

    // ── Follow Up ────────────────────────────────────────────
    followUpRequired: { type: Boolean, default: true },
    followUpDate: { type: Date },
    followUpDoctor: { type: String, trim: true },
    followUpDepartment: { type: String, trim: true },
    followUpInstructions: { type: String },

    // ── Emergency Warnings ───────────────────────────────────
    emergencyWarnings: { type: String },

    // ── Status & Workflow ────────────────────────────────────
    status: {
      type: String,
      enum: ["draft", "finalized"],
      default: "draft" },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
    finalizedByName: { type: String },
    finalizedAt: { type: Date },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor" } },
  { timestamps: true, collection: "discharge_summaries" }
);

DischargeSummarySchema.index({ UHID: 1, createdAt: -1 });
DischargeSummarySchema.index({ admissionId: 1 });
DischargeSummarySchema.index({ status: 1, createdAt: -1 });

module.exports =
  mongoose.models.DischargeSummary ||
  mongoose.model("DischargeSummary", DischargeSummarySchema);
