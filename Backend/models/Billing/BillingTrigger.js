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
  //
  // R7az-CRIT-1 (D6-CRIT-1): "MAR_RESERVATION" is the canonical sourceType
  // for the pharmacy-side reservation row written by onIndentReleased.
  // Pre-R7az that path wrote sourceType:"MAR" (same enum the MAR-admin
  // path wrote) and the dedup query in onMARAdministration searched for
  // ["PharmacyIndent","INDENT","PHARM_RELEASE"] — none of which matched,
  // so every MAR-given dose was billed a second time on top of the indent
  // release. New rule: pharmacy reservation → "MAR_RESERVATION"; the
  // MAR administration path → "MAR"; the dedup query specifically looks
  // for "MAR_RESERVATION" to detect "this drug was already billed at
  // dispense".
  sourceType: {
    type: String,
    enum: ["NurseNote","DoctorNote","DoctorAssessment","MAR","MAR_RESERVATION","InvestigationOrder",
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
// R7ap-F10/D7-04/D10-02: PARTIAL UNIQUE on (admissionId, serviceCode, dateKey)
// for active daily charges. Previously this index was non-unique so the
// `dailyDedup` helper had a read-then-write race — cron + manual at the
// same instant could both pass findOne and both create, double-charging
// the patient's bed/nursing for that day. Multi-instance deploy made it
// worse — N replicas would N-times-charge.
//
// The partial filter limits the unique constraint to "live" rows so that
// cancelled/voided/skipped triggers can coexist on the same dedup key
// without blocking a legitimate re-creation.
BillingTriggerSchema.index(
  { admissionId: 1, serviceCode: 1, dateKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      dateKey: { $exists: true, $type: "string" },
      status:  { $in: ["completed", "billed", "pending", "pending-review"] },
      // R7au-FIX-9/D7-HIGH-C9: scope this single-instance daily index to
      // rows that DON'T use the multi-doctor pattern. Doctor-round
      // triggers (dedupByDoctor=true / orderedById set) need their own
      // partial-unique that includes orderedById so two consultants on
      // the same day each get their own NABH multi-disciplinary line.
      orderedById: { $exists: false },
    },
    name: "uniq_daily_charge",
  },
);
// R7au-FIX-9/D7-HIGH-C9: separate partial-unique for doctor-round charges
// so Dr. A's and Dr. B's same-day rows coexist (each with distinct
// orderedById) but a SINGLE doctor doesn't double-book.
BillingTriggerSchema.index(
  { admissionId: 1, serviceCode: 1, dateKey: 1, orderedById: 1 },
  {
    unique: true,
    partialFilterExpression: {
      dateKey:     { $exists: true, $type: "string" },
      orderedById: { $exists: true },
      status:      { $in: ["completed", "billed", "pending", "pending-review"] },
    },
    name: "uniq_daily_charge_per_doctor",
  },
);
// Legacy index kept for the query shape used elsewhere (status filter inside).
BillingTriggerSchema.index({ admissionId: 1, serviceCode: 1, dateKey: 1, status: 1 });
BillingTriggerSchema.index({ admissionId: 1, sourceType: 1, createdAt: -1 });
// R7t: speeds up "pending review" sweeps + per-admission status queries.
// The IPD ledger page hits this on every load to find stuck triggers.
BillingTriggerSchema.index({ status: 1, createdAt: -1 });
BillingTriggerSchema.index({ admissionId: 1, status: 1, createdAt: -1 });
// R7bf-J/A8-HIGH-1: compound index for IPDLedger's unfiltered audit-trail
// read (no status, no sourceType — just admissionId + sort). Pre-R7bf
// this fell back to the {admissionId,sourceType,createdAt} index which
// scanned all sourceTypes per admission — fine at small scale but slow
// at long-stay-ICU cardinalities (~1k+ triggers per admission).
BillingTriggerSchema.index({ admissionId: 1, createdAt: -1 });

module.exports = mongoose.model("BillingTrigger", BillingTriggerSchema);
