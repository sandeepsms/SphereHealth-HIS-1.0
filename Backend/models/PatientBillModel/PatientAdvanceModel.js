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
    UHID:       { type: String, required: true, uppercase: true, trim: true, index: true },
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
    refundedAt:     { type: Date, default: null },
    refundedBy:     { type: String, trim: true, default: null },
    refundReason:   { type: String, trim: true, default: null },

    // ── Notes (free text) ──────────────────────────────────────────
    remarks: { type: String, trim: true, default: null },
  },
  { timestamps: true },
);

// ── Virtual: remaining balance (amount - appliedAmount) ─────────────
// Decimal128 needs explicit Number() conversion because subtraction
// on Decimal128 objects yields NaN.
PatientAdvanceSchema.virtual("remainingAmount").get(function () {
  const total   = Number(this.amount?.toString?.() ?? this.amount ?? 0);
  const applied = Number(this.appliedAmount?.toString?.() ?? this.appliedAmount ?? 0);
  return Math.max(0, +(total - applied).toFixed(2));
});
PatientAdvanceSchema.set("toJSON",   { virtuals: true });
PatientAdvanceSchema.set("toObject", { virtuals: true });

// ── Receipt-number generator: ADV-YYYY-NNNNNN ─────────────────────
PatientAdvanceSchema.pre("save", async function (next) {
  if (!this.isNew || this.receiptNumber) return next();
  try {
    const year = new Date().getFullYear();
    const prefix = `ADV-${year}-`;
    const last = await this.constructor
      .findOne({ receiptNumber: { $regex: `^${prefix}` } })
      .sort({ receiptNumber: -1 })
      .lean();
    const seq = last ? (parseInt(last.receiptNumber.slice(-6), 10) || 0) + 1 : 1;
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

module.exports =
  mongoose.models.PatientAdvance ||
  mongoose.model("PatientAdvance", PatientAdvanceSchema);
