const mongoose = require("mongoose");

const BillingTriggerSchema = new mongoose.Schema({
  // ── Patient context ─────────────────────────────────────────
  admissionId:  { type: mongoose.Schema.Types.ObjectId, ref: "Admission" },
  // OPD visit model is registered as "OPDRegistration" (see
  // Patient/OPDModels.js). The old `ref: "OPD"` would throw
  // MissingSchemaError on any populate("opdVisitId") call.
  opdVisitId:   { type: mongoose.Schema.Types.ObjectId, ref: "OPDRegistration" },
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
  orderedByRole: { type: String, enum: ["Doctor","Nurse","System","Lab","Receptionist","Admin","Pharmacist","Accountant"], default: "System" },
  orderedAt:     { type: Date, default: Date.now },
  orderDetails:  String,   // "Ordered CBC for monitoring" / "IV Cannulation performed"

  // ── COMPLETION trail (who completed the task) ───────────────
  completedBy:     String,
  completedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  completedByRole: { type: String, enum: ["Doctor","Nurse","System","Lab","Receptionist","Admin","Pharmacist","Accountant"] },
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
    enum: ["pending","in_progress","completed","billed","cancelled","voided","skipped","pending-review"],
    default: "pending" },
  // When addItemToBill silently returns null (closed bill, validation
  // error inside save(), etc.), we used to mark the trigger "completed"
  // with no billId/billItemId — a silent data loss. Now those land in
  // `status: "pending-review"` with the reason captured here so the
  // operator can retry from the IPD Live Ledger's Stuck Triggers list.
  reviewReason:  String,
  reviewedAt:    Date,
  reviewedBy:    String,

  // ── Flags ────────────────────────────────────────────────────
  autoCharged:          { type: Boolean, default: false },
  requiresConfirmation: { type: Boolean, default: false },
  isDailyCharge:        { type: Boolean, default: false },
  dateKey:              { type: String, index: true }, // YYYY-MM-DD dedup key

  // ── Void / Override audit ───────────────────────────────────
  // A trigger that fired in error (wrong patient, duplicate, doctor
  // never actually examined) can be VOIDED — within a 15-min window
  // for Receptionists; any time for Accountants. Voiding flips
  // status→voided and removes the matching bill line.
  voidedAt:        Date,
  voidedBy:        String,
  voidedByRole:    String,
  voidReason:      String,
  // Override = "the charge is correct, just the qty/price isn't" —
  // edits the bill item in place and logs the before→after into
  // overrideHistory so the audit trail can replay every change.
  // originalUnitPrice / originalQuantity are sticky from the very
  // first fire so we can show "originally ₹400, now ₹300" even
  // after multiple edits.
  originalUnitPrice: Number,
  originalQuantity:  Number,
  overrideHistory: [{
    field:        String,                 // "unitPrice" / "quantity" / "totalAmount"
    oldValue:     mongoose.Schema.Types.Mixed,
    newValue:     mongoose.Schema.Types.Mixed,
    reason:       String,
    changedBy:    String,
    changedByRole: String,
    changedById:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    changedAt:    { type: Date, default: Date.now },
  }],

  // ── Metadata ─────────────────────────────────────────────────
  shift:      String,
  department: String,
  notes:      String }, {
  timestamps: true });

// Compound index for daily dedup
BillingTriggerSchema.index({ admissionId: 1, serviceCode: 1, dateKey: 1, status: 1 });
BillingTriggerSchema.index({ admissionId: 1, sourceType: 1, createdAt: -1 });
// R7t: speeds up "pending review" sweeps + per-admission status queries.
// The IPD ledger page hits this on every load to find stuck triggers.
BillingTriggerSchema.index({ status: 1, createdAt: -1 });
BillingTriggerSchema.index({ admissionId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("BillingTrigger", BillingTriggerSchema);
