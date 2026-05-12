const mongoose = require("mongoose");

const BillingTriggerSchema = new mongoose.Schema({
  // ── Patient context ─────────────────────────────────────────
  admissionId:  { type: mongoose.Schema.Types.ObjectId, ref: "Admission" },
  opdVisitId:   { type: mongoose.Schema.Types.ObjectId, ref: "OPD" },
  patientId:    { type: mongoose.Schema.Types.ObjectId, ref: "Patient" },
  UHID:         { type: String, index: true },
  patientType:  { type: String, enum: ["OPD","IPD","EMERGENCY","DAYCARE","ICU"], default: "IPD" },

  // ── Service being charged ───────────────────────────────────
  serviceId:    { type: mongoose.Schema.Types.ObjectId, ref: "ServiceMaster" },
  serviceCode:  String,
  serviceName:  String,
  quantity:     { type: Number, default: 1 },
  unitPrice:    { type: Number, default: 0 },
  totalAmount:  { type: Number, default: 0 },

  // ── Clinical source ─────────────────────────────────────────
  // "Admission", "BedCharge", "Emergency" are fired by autoBillingService
  // for registration / bed-day / ER-triage charges — without them, those
  // events silently fail validation and patients are billed nothing.
  sourceType: {
    type: String,
    enum: ["NurseNote","DoctorNote","DoctorAssessment","MAR","InvestigationOrder",
           "Equipment","CarePlan","Discharge","Procedure","DoctorVisit","Manual","AutoCharge",
           "Admission","BedCharge","Emergency"],
    required: true },
  sourceDocumentId:    { type: mongoose.Schema.Types.ObjectId },
  sourceDocumentModel: String, // "NurseNote", "DoctorNote", "MAR", etc.

  // ── ORDER trail (who advised/ordered) ──────────────────────
  orderedBy:     String,   // Doctor/Nurse name
  orderedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  orderedByRole: { type: String, enum: ["Doctor","Nurse","System","Lab","Receptionist"], default: "System" },
  orderedAt:     { type: Date, default: Date.now },
  orderDetails:  String,   // "Ordered CBC for monitoring" / "IV Cannulation performed"

  // ── COMPLETION trail (who completed the task) ───────────────
  completedBy:     String,
  completedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  completedByRole: { type: String, enum: ["Doctor","Nurse","System","Lab","Receptionist"] },
  completedAt:     Date,
  completionNotes: String,

  // ── BILLING trail ───────────────────────────────────────────
  billId:     { type: mongoose.Schema.Types.ObjectId, ref: "PatientBill" },
  billItemId: { type: mongoose.Schema.Types.ObjectId },
  billedAt:   Date,
  billedBy:   String,

  // ── Status lifecycle ─────────────────────────────────────────
  status: {
    type: String,
    enum: ["pending","in_progress","completed","billed","cancelled","voided","skipped"],
    default: "pending" },

  // ── Flags ────────────────────────────────────────────────────
  autoCharged:          { type: Boolean, default: false },
  requiresConfirmation: { type: Boolean, default: false },
  isDailyCharge:        { type: Boolean, default: false },
  dateKey:              { type: String, index: true }, // YYYY-MM-DD dedup key

  // ── Metadata ─────────────────────────────────────────────────
  shift:      String,
  department: String,
  notes:      String }, {
  timestamps: true });

// Compound index for daily dedup
BillingTriggerSchema.index({ admissionId: 1, serviceCode: 1, dateKey: 1, status: 1 });
BillingTriggerSchema.index({ admissionId: 1, sourceType: 1, createdAt: -1 });

module.exports = mongoose.model("BillingTrigger", BillingTriggerSchema);
