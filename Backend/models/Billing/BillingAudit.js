// models/Billing/BillingAudit.js
// ════════════════════════════════════════════════════════════════════
// R7ap-F15/D6-13/D3-13: BillingAudit collection — single chronological
// audit log for EVERY money-touching state change in the HIS.
//
// Pre-R7ap, audit data was scattered:
//   • BillingTrigger only covered IPD auto-charges
//   • bill.adjustmentLog[] only covered settlement/discount
//   • payment.voidedAt/By only covered 15-min undo
//   • PatientAdvance refund fields lived in-row
//   • Refund / Cancel / Apply / TPA / Generate-bill events had NO audit
//
// NABH AAC.7 / IT Rule 46 / GST Act §35 all expect a complete, queryable
// chronological audit trail. This collection is append-only — never
// updated, never deleted (retention enforced by a separate archiver).
//
// Every emitter should call BillingAudit.create({...}) — never bill.save()
// alone — when one of the listed events fires.
// ════════════════════════════════════════════════════════════════════
const mongoose = require("mongoose");

const BillingAuditSchema = new mongoose.Schema(
  {
    // ── What happened ─────────────────────────────────────────────
    event: {
      type: String,
      required: true,
      enum: [
        "BILL_PAYMENT_RECORDED",     // recordPayment
        "BILL_REFUND_ISSUED",        // recordRefund
        "BILL_REFUND_TO_ADVANCE",    // recordRefund creditToAdvance leg
        "BILL_CANCELLED",            // cancelBill
        "BILL_GENERATED",            // DRAFT → GENERATED (billNumber assigned)
        "BILL_FINALIZED",            // generateFinalBill (IPD consolidated)
        "BILL_ITEM_VOIDED",          // voidPayment
        "ADVANCE_CREATED",           // PatientAdvance create
        "ADVANCE_APPLIED",           // applyAdvanceToBill
        "ADVANCE_REFUNDED",          // refundAdvance (R7ao)
        "TPA_PREAUTH_SUBMITTED",     // tpaPreAuthSubmit
        "TPA_APPROVED",              // tpaApprove
        "TPA_DENIED",                // tpaDeny
        "TPA_SETTLED",               // tpaSettle
        "SETTLEMENT_ADJUSTED",       // settlementAdjust (extraDiscount/line edits)
        "ITEM_PRICE_OVERRIDDEN",     // BillingTrigger override
        "ITEM_CANCELLED",            // BillingTrigger cancel
      ],
      index: true,
    },
    // ── Refs (whichever apply) ─────────────────────────────────────
    UHID:        { type: String, uppercase: true, trim: true, index: true },
    patientId:   { type: mongoose.Schema.Types.ObjectId, ref: "Patient" },
    billId:      { type: mongoose.Schema.Types.ObjectId, ref: "PatientBill", index: true },
    billNumber:  { type: String, trim: true, index: true },
    advanceId:   { type: mongoose.Schema.Types.ObjectId, ref: "PatientAdvance", index: true },
    advanceReceiptNumber: { type: String, trim: true },
    paymentId:   { type: mongoose.Schema.Types.ObjectId },    // bill.payments[]._id
    admissionId: { type: mongoose.Schema.Types.ObjectId, ref: "Admission", index: true },
    triggerId:   { type: mongoose.Schema.Types.ObjectId, ref: "BillingTrigger" },

    // ── Money snapshot ─────────────────────────────────────────────
    amount:      { type: mongoose.Schema.Types.Decimal128, default: 0 }, // primary money quantum
    paymentMode: { type: String, trim: true },                           // CASH/UPI/...
    transactionId:{ type: String, trim: true },                          // UPI ref / cheque # / etc.

    // ── Who + why ──────────────────────────────────────────────────
    actorId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    actorName:   { type: String, trim: true },
    actorRole:   { type: String, trim: true },
    reason:      { type: String, trim: true },                           // free-text

    // ── State diff (before/after snapshot — minimal, not full doc) ─
    before:      { type: mongoose.Schema.Types.Mixed },
    after:       { type: mongoose.Schema.Types.Mixed },

    // ── Audit hygiene ──────────────────────────────────────────────
    ipAddress:   { type: String, trim: true },
    userAgent:   { type: String, trim: true },
    // R7ap-F33/D6-19/D10-09: retention metadata. NABH IPSG.6 requires
    // 5-yr clinical / 7-yr accounts retention. `retainUntil` lets a
    // quarterly archiver migrate rows older than the floor into cold
    // storage without breaking audit chains in the meantime.
    retainUntil: { type: Date, default: () => new Date(Date.now() + 7 * 365 * 86400000) }, // 7 years default
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // append-only — no updatedAt
  },
);

// Tax/audit query indexes
BillingAuditSchema.index({ createdAt: -1 });
BillingAuditSchema.index({ event: 1, createdAt: -1 });
BillingAuditSchema.index({ UHID: 1, createdAt: -1 });
BillingAuditSchema.index({ billId: 1, createdAt: -1 });

// Decimal128 → Number on serialise
const { decimalToNumber } = require("../../utils/money");
BillingAuditSchema.set("toJSON",   { transform: decimalToNumber });
BillingAuditSchema.set("toObject", { transform: decimalToNumber });

/**
 * Emit a billing audit row. Best-effort — never throws to the caller,
 * because losing an audit row is not worse than failing the original
 * billing write. All call sites should wrap in `.catch(() => {})` or
 * use this helper which already swallows.
 */
async function emitBillingAudit(payload, { req } = {}) {
  try {
    const row = {
      ...payload,
      actorId:   payload.actorId   || req?.user?._id,
      actorName: payload.actorName || req?.user?.fullName || req?.user?.employeeId,
      actorRole: payload.actorRole || req?.user?.role,
      ipAddress: payload.ipAddress || req?.ip,
      userAgent: payload.userAgent || req?.get?.("user-agent"),
    };
    await mongoose.model("BillingAudit").create(row);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[BillingAudit] emit failed:", e?.message);
  }
}

const BillingAudit = mongoose.models.BillingAudit ||
  mongoose.model("BillingAudit", BillingAuditSchema);

module.exports = BillingAudit;
module.exports.emit = emitBillingAudit;
