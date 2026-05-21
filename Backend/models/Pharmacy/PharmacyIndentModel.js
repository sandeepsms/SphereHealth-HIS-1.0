/**
 * PharmacyIndentModel.js
 *
 * Nurse → Pharmacy drug-request workflow. Each indent is one request
 * (one or many drugs) for one admitted patient. Lifecycle:
 *
 *   Raised → Acknowledged → PartiallyReleased → Released
 *         ↘ Cancelled
 *
 * The pharmacist's live-queue page polls list endpoints filtered by
 * status + urgency; STAT indents float to the top (red banner + audio
 * chime on the frontend). On Release, a PharmacySale is created and
 * each item's `reservationTriggerId` points at a "RESV-<drug>" BillingTrigger
 * (status: pending) — the patient's interim bill shows it as a reserved
 * line that hasn't been finalised. When the nurse marks the matching
 * MAR dose as GIVEN, the auto-billing service flips the reservation to
 * `billed`. If MAR records HELD / REFUSED / NOT_AVAILABLE, the
 * reservation is voided + the stock is returned to the dispensing batch.
 */
const mongoose = require("mongoose");
const { nextSequence } = require("../../utils/counter");

// ── One drug requested in this indent ─────────────────────────────
const IndentItemSchema = new mongoose.Schema({
  // Drug identity (ServiceMaster / DrugMaster ref + flat snapshot so
  // we can render the indent even if the master row is renamed later).
  drugId:        { type: mongoose.Schema.Types.ObjectId, ref: "Drug" },
  drugCode:      { type: String, trim: true },
  drugName:      { type: String, required: true, trim: true },
  form:          { type: String, trim: true },   // Tab / Cap / Syp / Inj / etc.
  dose:          { type: String, trim: true },   // "500 mg", "10 ml"
  route:         { type: String, trim: true },   // Oral / IV / IM / SC

  // Quantities — requestedQty is what the nurse asked for; issuedQty is
  // what the pharmacist actually dispensed (may be less if low stock,
  // or after a substitution). Both are simple Number counts of units
  // (tablets, ampoules, sachets) — granular split happens at the
  // PharmacyBatch level via FIFO/FEFO.
  requestedQty:  { type: Number, required: true, min: 1 },
  issuedQty:     { type: Number, default: 0, min: 0 },
  // R7az-MED-6 (D7-MED-6): typed batch reference for traceability +
  // recall queries. `batchNumber` (string mirror) kept for display so
  // print receipts / older clients keep working without a join.
  batchId:       { type: mongoose.Schema.Types.ObjectId, ref: "PharmacyDrugBatch" },
  batchNumber:   { type: String, trim: true },   // set on release (display mirror)

  // R7az-CRIT-5/D7-CRIT-3: per-batch dispense ledger. When the release
  // path splits a single requested quantity across multiple FEFO-ordered
  // batches (earliest expiry first), each batch's contribution lands as
  // a `picked` row so the audit trail can prove FEFO compliance and so
  // a future recall can reach every patient who received a specific
  // batch. populated only on release.
  picked: [
    {
      batchId:    { type: mongoose.Schema.Types.ObjectId, ref: "PharmacyDrugBatch", required: true },
      batchNo:    { type: String, trim: true },
      qty:        { type: Number, required: true, min: 0 },
      expiryDate: { type: Date },
      pickedAt:   { type: Date, default: Date.now },
    },
  ],

  // Where the indent line came from. Doctor-prescribed lines link back
  // to the prescription so the audit trail can prove the nurse didn't
  // invent a request — `doctorOrderId` makes this enforceable. Manual
  // lines carry a `reason` instead (emergency consumable, etc.).
  sourceType:    { type: String, enum: ["DoctorOrder", "Manual"], required: true },
  doctorOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorOrder" },
  reason:        { type: String, trim: true },

  // Billing crumbs — wired by autoBillingService on release + MAR.
  //   reservationTriggerId — pending RESV-* trigger created at release
  //   finalTriggerId       — promoted MAR trigger when nurse marks GIVEN
  //   returnTriggerId      — set when MAR rejects + stock returns
  reservationTriggerId: { type: mongoose.Schema.Types.ObjectId, ref: "BillingTrigger" },
  finalTriggerId:       { type: mongoose.Schema.Types.ObjectId, ref: "BillingTrigger" },
  unitPriceSnapshot:    { type: Number, default: 0 },

  // Substitution audit — pharmacist swapped Brand-X for Brand-Y (same
  // molecule, in-stock alternative). The orig*/ replaced* pair keeps the
  // request intact so the doctor sees what was actually given.
  substitutedFrom:      { type: String, trim: true },
  substitutedFromCode:  { type: String, trim: true },
  substitutionReason:   { type: String, trim: true },

  notes:         { type: String, trim: true },
}, { _id: true });

// ── Indent header ─────────────────────────────────────────────────
const PharmacyIndentSchema = new mongoose.Schema({
  // IND-2026-000001 — auto-generated, year-scoped via shared Counter.
  indentNumber:  { type: String, unique: true, sparse: true },

  // Patient context. UHID is the durable lookup key; admission ref is
  // optional for OPD/Daycare indents that don't have a bed assigned.
  UHID:          { type: String, required: true, index: true },
  patientId:     { type: mongoose.Schema.Types.ObjectId, ref: "Patient" },
  patientName:   { type: String, trim: true },
  admissionId:   { type: mongoose.Schema.Types.ObjectId, ref: "Admission" },
  admissionNumber: { type: String, trim: true },
  // Snapshot of bed / ward at indent time — patient may transfer beds
  // between raise and release; the pharmacist needs to know which ward
  // to deliver to even if the bed changed mid-shift.
  wardName:      { type: String, trim: true },
  bedNumber:     { type: String, trim: true },

  // Items in this indent (1..N)
  items:         { type: [IndentItemSchema], default: [] },

  // Urgency drives sort order + visual treatment in the pharmacist's
  // queue. STAT = patient deteriorating, fire-and-forget tone alert
  // and red border. Urgent = within 30 min. Routine = next batch.
  urgency:       { type: String, enum: ["Routine", "Urgent", "STAT"], default: "Routine" },

  // Lifecycle. PartiallyReleased fires when issuedQty < requestedQty
  // for any item — the rest stays open for a second-release pass.
  status:        { type: String,
                   enum: ["Raised", "Acknowledged", "PartiallyReleased", "Released", "Cancelled"],
                   default: "Raised", index: true },

  // Who-when audit fields. Each transition stamps name + role + ts;
  // the user's _id is captured where available for revocability.
  raisedBy:      { type: String, trim: true, required: true },
  raisedById:    { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  raisedByRole:  { type: String, trim: true },
  raisedAt:      { type: Date, default: Date.now },

  acknowledgedBy:    { type: String, trim: true },
  acknowledgedById:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  acknowledgedAt:    { type: Date },

  releasedBy:    { type: String, trim: true },
  releasedById:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  releasedAt:    { type: Date },
  pharmacySaleId:{ type: mongoose.Schema.Types.ObjectId, ref: "PharmacySale" },

  cancelledBy:   { type: String, trim: true },
  cancelledById: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  cancelledAt:   { type: Date },
  cancelReason:  { type: String, trim: true },

  // Free-text notes — nurse adds patient context ("CKD pt, avoid
  // nephrotoxic"), pharmacist replies via item-level notes for
  // substitution rationale.
  notes:         { type: String, trim: true },
}, { timestamps: true });

// ── Pre-save: auto-number ─────────────────────────────────────────
PharmacyIndentSchema.pre("save", async function (next) {
  if (this.isNew && !this.indentNumber) {
    try {
      const year = new Date().getFullYear();
      const seq  = await nextSequence(`indent:${year}`);
      this.indentNumber = `IND-${year}-${String(seq).padStart(6, "0")}`;
    } catch (e) {
      return next(e);
    }
  }
  next();
});

// Compound + helper indexes — the pharmacist's live queue page sorts
// by urgency desc + raisedAt asc (newest STATs first, then chronological
// within each urgency tier).
PharmacyIndentSchema.index({ status: 1, urgency: 1, raisedAt: 1 });
PharmacyIndentSchema.index({ admissionId: 1, status: 1 });
PharmacyIndentSchema.index({ UHID: 1, raisedAt: -1 });

module.exports =
  mongoose.models.PharmacyIndent ||
  mongoose.model("PharmacyIndent", PharmacyIndentSchema);
