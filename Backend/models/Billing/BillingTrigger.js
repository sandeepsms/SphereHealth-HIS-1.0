const mongoose = require("mongoose");
const { toDec, decimalToNumber } = require("../../utils/money");
const Dec = mongoose.Schema.Types.Decimal128;

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
  // R7bh-F3 / R7bg-1-CRIT-6: money fields stored as Decimal128 so server-side
  // arithmetic doesn't drift on long-stay admissions (IEEE-754 floats lose
  // a cent per ~100 saves at ICU-tier rates). toJSON unwraps them back to
  // numbers via utils/money.decimalToNumber, so wire shape is unchanged.
  unitPrice:    { type: Dec, default: () => toDec(0) },
  totalAmount:  { type: Dec, default: () => toDec(0) },

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
  // R7bj-F5 / R7bi-6-TBA-MED-1: enum extended to cover the new chargeable
  // event types fired by support-staff agents (Physiotherapist, Dietician,
  // Housekeeping, Security, Ward Boy, Kitchen). The `kind` set lives here on
  // sourceType (the BillingTrigger.kind concept maps onto this field — there
  // is no separate `kind` column on the schema). New PHYSIO_*/DIET_*/HK_*/
  // SEC_*/WB_* values are added so the new emitters can land without
  // tripping the schema enum validator.
  sourceType: {
    type: String,
    enum: ["NurseNote","DoctorNote","DoctorAssessment","MAR","MAR_RESERVATION","InvestigationOrder",
           "Equipment","CarePlan","Discharge","Procedure","DoctorVisit","Manual","AutoCharge",
           "Admission","BedCharge","Emergency",
           // R7bj-F5 / R7bi-6-TBA-MED-1: support-staff kinds
           "PHYSIO_SESSION","DIET_MEAL","DIET_CONSULT",
           "HK_LINEN","HK_LAUNDRY","HK_BMW",
           "SEC_VISITOR_PASS","WB_TRANSPORT",
           // R7en — Per-room-category daily charges. One sourceType
           // covers all 8 line items (bed, nursing, doctor visit, RMO,
           // monitoring, dietetics, housekeeping, linen) so the audit
           // trail can filter "all room-matrix accruals" cleanly. The
           // existing "BedCharge" remains for legacy backfills + the
           // PER_DAY package route (which keeps that label for now).
           "DailyRoomAccrual"],
    required: true },
  sourceDocumentId:    { type: mongoose.Schema.Types.ObjectId },
  sourceDocumentModel: String, // "NurseNote", "DoctorNote", "MAR", etc.

  // ── ORDER trail (who advised/ordered) ──────────────────────
  orderedBy:     String,   // Doctor/Nurse name
  orderedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  // R7bj-F5 / R7bi-6-TBA-MED-1: enum extended for support-staff roles. The
  // new ICU-billing event emitters (Physiotherapist, Dietician, Housekeeping,
  // Security, Ward Boy, Kitchen) carry these role labels — pre-R7bj they
  // failed enum validation and the trigger silently fell back to "System",
  // breaking actor attribution in the audit trail.
  orderedByRole: { type: String, enum: ["Doctor","Nurse","System","Lab","Receptionist","Admin","Pharmacist","Accountant","Cron",
                                          "Physiotherapist","Dietician","Housekeeping","Security","Ward Boy","Kitchen","Lab Technician","MRD"], default: "System" },
  orderedAt:     { type: Date, default: Date.now },
  orderDetails:  String,   // "Ordered CBC for monitoring" / "IV Cannulation performed"

  // ── COMPLETION trail (who completed the task) ───────────────
  completedBy:     String,
  completedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  completedByRole: { type: String, enum: ["Doctor","Nurse","System","Lab","Receptionist","Admin","Pharmacist","Accountant","Cron",
                                            "Physiotherapist","Dietician","Housekeeping","Security","Ward Boy","Kitchen","Lab Technician","MRD"] },
  completedAt:     Date,
  completionNotes: String,

  // ── TRIGGER ATTRIBUTION (R7bh-F3 / R7bg-1-CRIT-6 / NABH-CRIT-A3) ───
  // Pre-R7bh the trigger had orderedBy/completedBy but no single
  // "who fired this trigger" pair — for cron-emitted bed/nursing/package
  // rows the orderedBy field was literally "System" and there was no
  // way to distinguish a cron emit from a service-layer emit in the
  // audit trail. NABH (and any internal incident review) needs the
  // emitting actor stamped on every charge row.
  triggeredBy:     { type: String, default: null },                                       // display name
  triggeredById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  triggeredByRole: { type: String, default: null },                                        // Doctor|Nurse|Receptionist|System|Cron|Pharmacist|Admin

  // ── BILLING trail ───────────────────────────────────────────
  billId:     { type: mongoose.Schema.Types.ObjectId, ref: "PatientBill" },
  billItemId: { type: mongoose.Schema.Types.ObjectId },
  billedAt:   Date,
  billedBy:   String,

  // ── Status lifecycle ─────────────────────────────────────────
  // B4-T08: "queued" / "applied" extend the lifecycle for the Stuck
  // Triggers retry endpoint. queued = retry in flight (controller has
  // accepted /triggers/:id/retry, service-layer accrual is running);
  // applied = a previously pending-review trigger has now been re-fired
  // and landed on the bill. We keep "billed" as the terminal state for
  // the original auto-charge path so the audit trail can distinguish
  // "billed on first fire" from "billed after a manual retry".
  status: {
    type: String,
    enum: ["pending","in_progress","completed","billed","cancelled","voided","skipped","pending-review","queued","applied"],
    default: "pending" },
  // When addItemToBill silently returns null (closed bill, validation
  // error inside save(), etc.), we used to mark the trigger "completed"
  // with no billId/billItemId — a silent data loss. Now those land in
  // `status: "pending-review"` with the reason captured here so the
  // operator can retry from the IPD Live Ledger's Stuck Triggers list.
  reviewReason:  String,
  reviewedAt:    Date,
  reviewedBy:    String,
  // B4-T08: Stuck-trigger retry stamps. retriedAt is set the moment the
  // controller flips status from "pending-review" → "queued"; retriedBy
  // captures the operator (User._id) so the audit trail ties the manual
  // retry to a person. Both stay sticky once written so multiple retries
  // can replay via the BillingAudit STUCK_TRIGGER_RETRIED rows.
  retriedAt:     Date,
  retriedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User" },

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
  // R7bj-F5 / R7bi-6-TBA-CRIT-2: store as Decimal128 (was Number) so the
  // sticky-original snapshot matches the precision of the live unitPrice/
  // totalAmount fields. Without this, IEEE-754 drift could make an
  // override comparison fail (originally 300.00 stored as 299.999999…)
  // and the audit comparison "originally ₹X" would render incorrectly.
  // The toJSON unwrap below (decimalToNumber) walks recursively so the
  // wire shape is unchanged for the IPD ledger.
  originalUnitPrice: { type: Dec, default: () => toDec(0) },
  originalQuantity:  { type: Dec, default: () => toDec(0) },
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
      // B4-T08: include queued/applied in the dedup so a re-fired stuck
      // trigger (status flipped via /triggers/:id/retry) doesn't get
      // duplicated by a concurrent cron tick for the same dateKey.
      status:  { $in: ["completed", "billed", "pending", "pending-review", "queued", "applied"] },
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
      // B4-T08: include queued/applied — see uniq_daily_charge note above.
      status:      { $in: ["completed", "billed", "pending", "pending-review", "queued", "applied"] },
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
// R7hr-12-S3 / D10-09: compound index on (status, updatedAt) backs the
// daily stuck-trigger sweeper in index.js (`status:"pending-review",
// updatedAt:{ $lt: cutoff }` + the multi-status `$in` aggregate). Without
// it the 01:00 IST cron falls back to {status,createdAt} for the equality
// then in-memory filters on updatedAt; the multi-status aggregate is
// near-collscan. At 1M+ rows that's 10-30s/run, blocking other writes.
BillingTriggerSchema.index({ status: 1, updatedAt: 1 });
// R7bf-J/A8-HIGH-1: compound index for IPDLedger's unfiltered audit-trail
// read (no status, no sourceType — just admissionId + sort). Pre-R7bf
// this fell back to the {admissionId,sourceType,createdAt} index which
// scanned all sourceTypes per admission — fine at small scale but slow
// at long-stay-ICU cardinalities (~1k+ triggers per admission).
BillingTriggerSchema.index({ admissionId: 1, createdAt: -1 });

// R7bh-F3 / R7bg-1-CRIT-6: serialize Decimal128 money fields back to plain
// JS Numbers on toJSON / toObject so the wire shape stays unchanged for
// the IPDLedger / audit endpoints. Without this, unitPrice/totalAmount
// would land in the JSON as { $numberDecimal: "300.00" } and break the
// frontend's currency formatting.
BillingTriggerSchema.set("toJSON",   { transform: decimalToNumber });
BillingTriggerSchema.set("toObject", { transform: decimalToNumber });

module.exports = mongoose.model("BillingTrigger", BillingTriggerSchema);
