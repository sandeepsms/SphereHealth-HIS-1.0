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
        // R7ar-P1-20/D6-aq-04: cashier shift lifecycle. The shift table
        // is the audit anchor for variance/handover; pre-R7ar opens and
        // closes left no chronological trace in BillingAudit, so the
        // GST/NABH register was missing the "who held the till at 21:00"
        // line. Each event captures actor + variance + variance reason.
        "SHIFT_OPENED",              // cashierSession.openSession
        "SHIFT_CLOSED",              // cashierSession.closeSession (manual)
        "SHIFT_AUTO_CLOSED",         // shift-auto-close cron in index.js
        // R7ar-P1-20/D10-aq-04: cron lifecycle. We don't audit every
        // tick (would flood the table) — only the discrete outputs:
        // a day-end snapshot, a successful auto-close, a recon delta.
        "CRON_RECONCILED",           // advance-recon / receipt-gap cron found+fixed
        "OVERAGE_DETECTED",          // P1-24 dischargeOverage trigger
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
    // R7aw-FIX-5/D6-MED-6: default is the floor (7y) but the pre-save
    // hook below trims it per-event-class so non-financial rows don't
    // bloat the hot collection. Payment/refund stay at 7y (GST Act §35);
    // routine/system rows drop to 1y/3y respectively.
    retainUntil: { type: Date, default: () => new Date(Date.now() + 7 * 365 * 86400000) }, // 7 years default (max)
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // append-only — no updatedAt
  },
);

// R7aw-FIX-5/D6-MED-6: per-event-class retention. Pre-fix every audit row
// sat 7 years regardless of class — the routine/system events (lookups,
// cron reconciliations, shift open/close) bloated the hot collection
// although they're not GST-Act §35 mandated.
//   • Payment / refund / generation     → 7y (GST Act §35 + IT Rule 46)
//   • Admin / system events             → 3y (NABH internal-audit floor)
//   • Routine reads / lookups / lifecycle → 1y (operational only)
const _FINANCIAL_EVENTS = new Set([
  "BILL_PAYMENT_RECORDED",
  "BILL_REFUND_ISSUED",
  "BILL_REFUND_TO_ADVANCE",
  "BILL_CANCELLED",
  "BILL_GENERATED",
  "BILL_FINALIZED",
  "BILL_ITEM_VOIDED",
  "ADVANCE_CREATED",
  "ADVANCE_APPLIED",
  "ADVANCE_REFUNDED",
  "TPA_PREAUTH_SUBMITTED",
  "TPA_APPROVED",
  "TPA_DENIED",
  "TPA_SETTLED",
  "SETTLEMENT_ADJUSTED",
  "ITEM_PRICE_OVERRIDDEN",
  "ITEM_CANCELLED",
]);
const _ADMIN_EVENTS = new Set([
  "SHIFT_OPENED",
  "SHIFT_CLOSED",
  "SHIFT_AUTO_CLOSED",
  "CRON_RECONCILED",
  "OVERAGE_DETECTED",
]);
function _retainYearsFor(event) {
  if (_FINANCIAL_EVENTS.has(event)) return 7;
  if (_ADMIN_EVENTS.has(event))     return 3;
  return 1; // routine / unknown — default to 1y so the hot collection stays lean
}
BillingAuditSchema.pre("save", function (next) {
  // Only adjust retainUntil for new docs that didn't get an explicit
  // override (the default schema timestamp). A caller-supplied future
  // date (e.g. an extended-retention legal hold) is preserved.
  if (this.isNew) {
    const years = _retainYearsFor(this.event);
    const target = new Date(Date.now() + years * 365 * 86400000);
    // Tolerance: if a caller passed a value within 5 minutes of "now+7y"
    // (i.e. the default fired), we override; otherwise we keep theirs.
    const defaultDriftMs = 5 * 60 * 1000;
    const defaultTarget  = Date.now() + 7 * 365 * 86400000;
    const curr = this.retainUntil?.getTime?.() ?? 0;
    if (!this.retainUntil || Math.abs(curr - defaultTarget) < defaultDriftMs) {
      this.retainUntil = target;
    }
  }
  next();
});

// Tax/audit query indexes
BillingAuditSchema.index({ createdAt: -1 });
BillingAuditSchema.index({ event: 1, createdAt: -1 });
BillingAuditSchema.index({ UHID: 1, createdAt: -1 });
BillingAuditSchema.index({ billId: 1, createdAt: -1 });
// R7at-FIX-14/D8-MED-3: TTL index on retainUntil. Pre-R7at the field
// was declared with a 7-year default but Mongo never auto-expired old
// rows — the audit-archive Sunday cron handled cold-storage migration
// but if it stalled, the hot collection grew unbounded. This TTL acts
// as a safety net so retainUntil>now docs are reaped within ~60s of
// expiry even when the archiver is down.
BillingAuditSchema.index({ retainUntil: 1 }, { expireAfterSeconds: 0 });

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
// R7ar-P2-40/D1-aq-11: cap before/after blob size. A single audit row
// holding the full bill snapshot (50 line items × deep BillItem objects)
// can balloon past 16 KB and (a) bloat the audit collection, (b) push
// the doc near Mongo's 16 MB limit on chatty IPDs. The cap keeps each
// blob under 12 KB stringified — well below the 16 KB threshold the
// MongoDB driver pre-flights at write time.
const _AUDIT_BLOB_CAP = 12 * 1024;
function _capBlob(v) {
  if (v == null || typeof v !== "object") return v;
  try {
    const s = JSON.stringify(v);
    if (s.length <= _AUDIT_BLOB_CAP) return v;
    // Truncate by dropping array items + deep keys. Keep top-level scalars.
    const summarised = {};
    for (const [k, val] of Object.entries(v)) {
      if (val == null) continue;
      if (Array.isArray(val)) {
        summarised[k] = { _length: val.length, _truncated: true, sample: val.slice(0, 2) };
      } else if (typeof val === "object") {
        const sub = JSON.stringify(val);
        summarised[k] = sub.length > 256 ? { _truncated: true, size: sub.length } : val;
      } else {
        summarised[k] = val;
      }
    }
    summarised._original_bytes = s.length;
    return summarised;
  } catch (_) {
    return { _truncated: true, _reason: "JSON-stringify failed" };
  }
}

async function emitBillingAudit(payload, { req } = {}) {
  try {
    const row = {
      ...payload,
      before:    _capBlob(payload.before),
      after:     _capBlob(payload.after),
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
