// models/PatientBillModel/PatientAdvanceModel.js
// ════════════════════════════════════════════════════════════════════
// PATIENT ADVANCE — UHID-level prepayment ledger
//
// Used when a patient deposits money BEFORE bills exist (typical for
// IPD admission deposit — receptionist takes ₹10,000 at the desk
// before the room is allocated, before any charges have accrued).
//
// Each row = one deposit event. Tracks:
//   - WHO collected (receivedBy, receivedById) for audit
//   - WHEN (paidAt)
//   - HOW (paymentMode + transactionId)
//   - HOW MUCH still unspent (amount - appliedAmount = remaining)
//   - WHERE the money went when applied (appliedTo[] — bill refs)
//
// Lifecycle: ACTIVE → PARTIALLY_APPLIED → FULLY_APPLIED. A user can
// also REFUND an unapplied advance (status REFUNDED).
//
// Why a separate collection, not just inflating Admission.advancePaid:
//   1. Per-admission scalars can't carry mode/txn-id/audit
//   2. Multiple advance deposits over an admission's life
//      (e.g. ₹10K on day 1, another ₹15K on day 5 as bills grow)
//      need separate rows so each receipt is reproducible
//   3. Refunds of advances need their own audit trail
//   4. Reports want collected-vs-applied separately for cash recon
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const PatientAdvanceSchema = new mongoose.Schema(
  {
    // ── Anchor ──────────────────────────────────────────────────────
    // R7ar-P2-39/D1-aq-15: UHID format guard. Reject malformed values at
    // save time so a stray service code can't accidentally land in the
    // UHID slot. Lenient because legacy data exists in varying formats.
    UHID:       {
      type: String, required: true, uppercase: true, trim: true, index: true,
      match: [/^[A-Z][A-Z0-9\-]{3,}$/i, "UHID must look like UHID-NN-NNN or similar identifier"],
    },
    patientId:  { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    // Optional: admission this deposit is earmarked for. Empty when
    // it's a general "credit on UHID" not tied to any visit yet.
    admission:  { type: mongoose.Schema.Types.ObjectId, ref: "Admission", default: null },

    // ── Receipt number — auto-generated, unique ────────────────────
    receiptNumber: { type: String, unique: true, sparse: true },

    // ── Money + mode ───────────────────────────────────────────────
    amount:        { type: mongoose.Schema.Types.Decimal128, required: true, min: 0 },
    paymentMode:   {
      type: String,
      required: true,
      enum: ["CASH", "CARD", "UPI", "CHEQUE", "ONLINE"],
    },
    transactionId: { type: String, trim: true, default: null }, // UPI ref / card auth / cheque no
    bankName:      { type: String, trim: true, default: null }, // for cheque / online

    // ── Audit who-took-it ──────────────────────────────────────────
    receivedBy:     { type: String, required: true, trim: true },   // employee name
    receivedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    receivedByRole: { type: String, trim: true, default: null },
    paidAt:         { type: Date, default: Date.now, required: true },

    // ── Application tracking ───────────────────────────────────────
    // appliedAmount accumulates as the advance is consumed by bills.
    // Each application pushes a row into appliedTo[].
    appliedAmount: { type: mongoose.Schema.Types.Decimal128, default: 0, min: 0 },
    appliedTo: [{
      billId:        { type: mongoose.Schema.Types.ObjectId, ref: "PatientBill", required: true },
      billNumber:    { type: String, trim: true },
      amount:        { type: mongoose.Schema.Types.Decimal128, required: true, min: 0 },
      appliedAt:     { type: Date, default: Date.now },
      appliedBy:     { type: String, trim: true },
      appliedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      billPaymentId: { type: mongoose.Schema.Types.ObjectId, default: null }, // the inserted Bill.payments[] _id
    }],

    // ── Status (derived but persisted for indexed queries) ─────────
    // ACTIVE             — nothing applied yet (full balance available)
    // PARTIALLY_APPLIED  — some applied, some remaining
    // FULLY_APPLIED      — appliedAmount === amount, remaining = 0
    // REFUNDED           — money returned to patient (terminal)
    // CANCELLED          — voided before any application (terminal)
    status: {
      type: String,
      enum: ["ACTIVE", "PARTIALLY_APPLIED", "FULLY_APPLIED", "REFUNDED", "CANCELLED"],
      default: "ACTIVE",
      index: true,
    },

    // ── Refund / cancel trail ──────────────────────────────────────
    // R7ao: refundedAmount tracks how much was actually returned to the
    // patient (the unspent remainder). Lets us refund a PARTIALLY_APPLIED
    // deposit without losing the applied-to-bills history.
    refundedAt:            { type: Date, default: null },
    refundedBy:            { type: String, trim: true, default: null },
    refundedById:          { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    refundReason:          { type: String, trim: true, default: null },
    refundedAmount:        { type: mongoose.Schema.Types.Decimal128, default: 0, min: 0 },
    refundMode:            { type: String, trim: true, default: null }, // CASH/UPI/BANK_TRANSFER
    refundTransactionId:   { type: String, trim: true, default: null },
    // R7bb-FIX-E-3 / D3-CRIT-3: Admin-only override slot. When a refund
    // is requested by the same cashier who took the deposit, the service
    // throws SAME_ACTOR; an Admin can second-sign via this field to
    // unblock the workflow (Admin role stamped here, refundedById carries
    // the original cashier). Pre-R7bb there was no audit anchor for the
    // override at all — Admin would just refund as themselves, losing
    // the link to the original collector.
    approvedById:          { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedBy:            { type: String, trim: true, default: null },
    approvedAt:            { type: Date, default: null },

    // ── Notes (free text) ──────────────────────────────────────────
    remarks: { type: String, trim: true, default: null },

    // R7ar-P0-5/D5-aq-01: when a bill refund is credited-to-advance (the
    // R7c "refund stays inside the hospital" flow), the resulting
    // PatientAdvance row is NOT new cash inflow — it's an internal
    // transfer of bill money into the advance pool. Day Book Cash In
    // must exclude these rows or they double-count alongside the bill's
    // negative payment row (which is already counted as billRefundsOut).
    isRefundCredit: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    // R7ap-F8/D7-01/D1-05: optimistic concurrency — every save now
    // includes the __v guard so two concurrent `apply` writes can't both
    // succeed last-writer-wins. Catches the race that the retry loop in
    // patientAdvanceService.applyAdvanceToBill was designed to handle
    // but couldn't fire because no version was being checked.
    optimisticConcurrency: true,
  },
);

// R7ap-F8: invariant guard — appliedAmount + refundedAmount must never
// exceed amount. A schema validator catches off-by-one races that slipped
// past the predicate filter (defence-in-depth — should never fire if the
// atomic findOneAndUpdate path is correct).
PatientAdvanceSchema.pre("validate", function (next) {
  const total    = Number(this.amount?.toString?.()         ?? this.amount         ?? 0);
  const applied  = Number(this.appliedAmount?.toString?.()  ?? this.appliedAmount  ?? 0);
  const refunded = Number(this.refundedAmount?.toString?.() ?? this.refundedAmount ?? 0);
  if (applied + refunded > total + 0.005) {
    return next(new Error(
      `Advance ${this.receiptNumber || this._id}: applied (${applied}) + refunded (${refunded}) ` +
      `would exceed total (${total}). Invariant violation — concurrent write?`,
    ));
  }
  next();
});

// ── Virtual: remaining balance (amount - appliedAmount - refundedAmount) ─────────────
// Decimal128 needs explicit Number() conversion because subtraction
// on Decimal128 objects yields NaN.
// R7ao: subtract refundedAmount so a REFUNDED row shows 0 remaining
// (otherwise Apply Advance would still try to consume already-refunded money).
PatientAdvanceSchema.virtual("remainingAmount").get(function () {
  const total    = Number(this.amount?.toString?.() ?? this.amount ?? 0);
  const applied  = Number(this.appliedAmount?.toString?.() ?? this.appliedAmount ?? 0);
  const refunded = Number(this.refundedAmount?.toString?.() ?? this.refundedAmount ?? 0);
  return Math.max(0, +(total - applied - refunded).toFixed(2));
});
PatientAdvanceSchema.set("toJSON",   { virtuals: true });
PatientAdvanceSchema.set("toObject", { virtuals: true });

// ── Receipt-number generator: ADV-YYYY-NNNNNN ─────────────────────
// R7ab: atomic. Previous find-then-insert race: two concurrent
// createAdvance calls both found last=ADV-2026-000123, both computed
// seq=124, both wrote ADV-2026-000124 → one succeeded, the OTHER threw
// E11000 because `receiptNumber` is unique+sparse — the deposit failed
// at the desk with a cryptic "duplicate key" error. nextSequence is
// the shared atomic counter used elsewhere; we seed from the existing
// max on first call so legacy receipts aren't re-issued.
const { nextSequence: nextSeqAdv } = require("../../utils/counter");
const CounterModelForAdv = require("../CounterModel");
PatientAdvanceSchema.pre("save", async function (next) {
  if (!this.isNew || this.receiptNumber) return next();
  try {
    const year = new Date().getFullYear();
    const prefix = `ADV-${year}-`;
    const key = `advance:receipt:${year}`;
    // Seed from existing max ONCE (first time this year's counter is touched).
    const existing = await CounterModelForAdv.findOne({ _id: key }).lean();
    let seed = null;
    if (!existing) {
      const last = await this.constructor
        .findOne({ receiptNumber: { $regex: `^${prefix}` } })
        .sort({ receiptNumber: -1 })
        .lean();
      seed = last ? (parseInt(last.receiptNumber.slice(-6), 10) || 0) : 0;
    }
    const seq = await nextSeqAdv(key, seed);
    this.receiptNumber = `${prefix}${String(seq).padStart(6, "0")}`;
    next();
  } catch (e) { next(e); }
});

// ── Status auto-update on appliedAmount change ─────────────────────
PatientAdvanceSchema.pre("save", function (next) {
  if (this.status === "REFUNDED" || this.status === "CANCELLED") return next();
  const total   = Number(this.amount?.toString?.() ?? this.amount ?? 0);
  const applied = Number(this.appliedAmount?.toString?.() ?? this.appliedAmount ?? 0);
  if (applied <= 0)             this.status = "ACTIVE";
  else if (applied >= total)    this.status = "FULLY_APPLIED";
  else                          this.status = "PARTIALLY_APPLIED";
  next();
});

PatientAdvanceSchema.index({ UHID: 1, status: 1 });
PatientAdvanceSchema.index({ admission: 1, status: 1 });
PatientAdvanceSchema.index({ paidAt: -1 });
// R7ap-F14/D1-13: compound index for FIFO sort in apply-advance flow.
PatientAdvanceSchema.index({ UHID: 1, paidAt: -1 });
// R7ap-F14: dashboard hits this for "advance refunds in date range" query.
PatientAdvanceSchema.index({ status: 1, refundedAt: -1 });

module.exports =
  mongoose.models.PatientAdvance ||
  mongoose.model("PatientAdvance", PatientAdvanceSchema);
