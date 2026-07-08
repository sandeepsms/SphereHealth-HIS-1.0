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
        // R7hr-12 (D4-01): emitted when a pharmacy sale that had been
        // settled from the patient's advance pool is cancelled — the
        // advance debit is REVERSED (appliedAmount decremented, the
        // matching appliedTo[] row $pull'd) so the patient's unspent
        // advance balance is restored and the books no longer double-
        // count the same money (once as advance-spent, once as
        // PharmacySale.patientCredit).
        "ADVANCE_APPLY_REVERSED",
        "ADVANCE_REFUNDED",          // refundAdvance (R7ao)
        "TPA_PREAUTH_SUBMITTED",     // tpaPreAuthSubmit
        "TPA_APPROVED",              // tpaApprove
        "TPA_DENIED",                // tpaDeny
        "TPA_SETTLED",               // tpaSettle
        "SETTLEMENT_ADJUSTED",       // settlementAdjust (extraDiscount/line edits)
        "ITEM_PRICE_OVERRIDDEN",     // BillingTrigger override
        "ITEM_CANCELLED",            // BillingTrigger cancel
        // R7bj-F5 / R7bi-6-TBA-CRIT-1: BillingTrigger lifecycle events. Pre-R7bj
        // every trigger emit/add/void/dedup-skip/pending-review left no audit row
        // (only the resulting bill mutation was logged) — so a 3 AM cron firing
        // a phantom bed-day charge that later got auto-billed produced ONE audit
        // row for the bill item but ZERO for the trigger. NABH AAC.7 + GST Act §35
        // want the originating clinical event in the chronological log too.
        "TRIGGER_EMITTED",           // _emitTrigger / autoBillingService.createTrigger success
        "ITEM_ADDED",                // addItemToBill success (trigger → bill line)
        "TRIGGER_VOIDED",            // undoTrigger / cancelTrigger / onMARNonAdminister
        "ORDER_CANCELLED",           // onOrderCancelled cascade summary
        "TRIGGER_DEDUPED",           // dailyDedup or pre-dedup skip
        "TRIGGER_PENDING_REVIEW",    // stuck trigger flagged for manual review
        // B4-T08: STUCK_TRIGGER_RETRIED is fired by the /triggers/:id/retry
        // endpoint whenever a pending-review trigger is manually re-fired.
        // The row's `after` captures the new status (applied or pending-review)
        // and the new reviewReason if the retry didn't clear it, so an
        // accountant can replay every retry attempt without spelunking logs.
        "STUCK_TRIGGER_RETRIED",     // /triggers/:id/retry — Stuck Triggers tile re-fire
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
        // R7bb-C/D7-HIGH-3: user-admin lifecycle. UserActivityLog is the
        // primary store for these but a thin BillingAudit row gives the
        // accountant a single chronological view across finance + admin
        // events (NABH AAC.7 wants ONE auditable timeline).
        "USER_CREATED",
        "USER_UPDATED",
        "USER_TERMINATED",
        "USER_REACTIVATED",
        "USER_PASSWORD_RESET",
        "USER_LOCKED",
        "USER_UNLOCKED",
        "USER_ROLE_CHANGED",
        // R7bb-C/D7-HIGH-4: master-data lifecycle. Pre-R7bb a Master
        // service / drug-price change left no audit row — opens a vector
        // for an insider to silently inflate a service cost mid-shift.
        "MASTER_SERVICE_CREATED",
        "MASTER_SERVICE_UPDATED",
        "MASTER_DEPARTMENT_CREATED",
        "MASTER_DEPARTMENT_UPDATED",
        "MASTER_DRUG_PRICE_CHANGED",
        // R7hr(NABH-P2.1) — audit blind spots closed. The NABH re-audit
        // found three money-relevant flows missing from the chronological
        // log (AAC.7 wants ONE auditable timeline):
        //   • order complete/cancel on a GENERATED/PARTIAL bill changes the
        //     patient's billable total but emitted nothing;
        //   • TPA_REFUND_PENDING_INSURER was being emitted by recordRefund
        //     but was absent from this enum, so validation silently DROPPED
        //     every row (the one case an insurer-recovery marker mattered);
        //   • pharmacy sale money-in only reached ClinicalAudit.
        "BILL_ITEM_ORDER_COMPLETED", // completeBillItemOrder — line becomes payable
        "BILL_ITEM_ORDER_CANCELLED", // cancelBillItemOrder — line excluded from payable
        "TPA_REFUND_PENDING_INSURER",// recordRefund TPA_CLAIM leg (was silently dropped)
        "PHARMACY_SALE_RECORDED",    // pharmacy dispense/sale money-in
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
  // R7hr-12 (D4-01): pharmacy-sale-cancel-driven reverse leg rides the
  // 7y financial retention floor (mirror of ADVANCE_APPLIED).
  "ADVANCE_APPLY_REVERSED",
  "ADVANCE_REFUNDED",
  "TPA_PREAUTH_SUBMITTED",
  "TPA_APPROVED",
  "TPA_DENIED",
  "TPA_SETTLED",
  "SETTLEMENT_ADJUSTED",
  "ITEM_PRICE_OVERRIDDEN",
  "ITEM_CANCELLED",
  // R7bj-F5 / R7bi-6-TBA-CRIT-1: trigger lifecycle events that are
  // money-affecting (emit/add/void/cancel) ride the 7y financial floor.
  // TRIGGER_DEDUPED is intentionally NOT here — those are routine cron
  // skips and would bloat the hot collection at ICU cardinalities.
  "TRIGGER_EMITTED",
  "ITEM_ADDED",
  "TRIGGER_VOIDED",
  "ORDER_CANCELLED",
  "TRIGGER_PENDING_REVIEW",
  // B4-T08: STUCK_TRIGGER_RETRIED rides 7y retention — a successful retry
  // materially changes the bill (line item added) so GST Act §35 applies.
  "STUCK_TRIGGER_RETRIED",
]);
const _ADMIN_EVENTS = new Set([
  "SHIFT_OPENED",
  "SHIFT_CLOSED",
  "SHIFT_AUTO_CLOSED",
  "CRON_RECONCILED",
  "OVERAGE_DETECTED",
  // R7bb-C: user-admin + master-data audit rows. 3y NABH internal-audit
  // floor — not GST-Act-bound but useful for HR + master-list reviews.
  "USER_CREATED",
  "USER_UPDATED",
  "USER_TERMINATED",
  "USER_REACTIVATED",
  "USER_PASSWORD_RESET",
  "USER_LOCKED",
  "USER_UNLOCKED",
  "USER_ROLE_CHANGED",
  "MASTER_SERVICE_CREATED",
  "MASTER_SERVICE_UPDATED",
  "MASTER_DEPARTMENT_CREATED",
  "MASTER_DEPARTMENT_UPDATED",
  "MASTER_DRUG_PRICE_CHANGED",
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

// R7ax-FIX-OOM: export the model AND the emit helper as TWO module fields.
// Pre-R7ax we did `module.exports = BillingAudit; module.exports.emit = …`
// which *clobbered* the inherited `EventEmitter.prototype.emit` on the model
// itself. Mongoose's `Model.init()` calls `this.emit("index", err)` and
// `this.emit("index-single-done", …)` internally during the very first
// index-sync. With our clobbered `emit`, those internal calls landed in
// `emitBillingAudit("index", err)` — the function spread the string `"index"`
// into a doc, called `mongoose.model("BillingAudit").create(…)`, which
// triggered a fresh save → pre-save hook → another index sync → another
// `emit("index")` → … runaway recursion that allocated ~500 MB then OOMed
// the entire process within ~15 s of the first `/api/billing/audit` hit
// (and of every other code path that touched BillingAudit, including the
// auto-archive cron and every `emit({event:"…"})` call site at runtime).
// Keeping the model export pristine, attaching the helper as `module.exports.emit`
// on the EXPORTS object only works because `module.exports` is the model
// object itself — so the property landed on the model. Splitting into
// `{ Model, emit }` keeps the model's prototype methods intact.
module.exports = BillingAudit;
module.exports.emitBillingAudit = emitBillingAudit;
// Back-compat: every existing caller does `const { emit } = require(".../BillingAudit")`.
// Expose under that name too, but ONLY if Mongoose's own `emit` is still the
// EventEmitter prototype method (i.e. nothing on the model has overridden it).
// Using Object.defineProperty so the value is non-writable and won't be
// accidentally re-clobbered, while keeping it discoverable on the model.
if (BillingAudit.emit === Object.getPrototypeOf(BillingAudit).emit) {
  // Safe path: attach `emit` as a *separate function reference*, not as a
  // property that overrides the prototype's emit. Callers using
  // `BillingAudit.emit({event:"…"})` get our helper; Mongoose's internal
  // `this.emit("index")` continues to resolve to the inherited prototype.
  // We do this via a function that disambiguates by signature: first arg
  // is an object payload (our caller) → helper; first arg is a string
  // (Mongoose's internal `emit(eventName, …)`) → delegate to EventEmitter.
  const _protoEmit = Object.getPrototypeOf(BillingAudit).emit;
  BillingAudit.emit = function emitDispatch(arg, ...rest) {
    if (typeof arg === "string") {
      return _protoEmit.call(this, arg, ...rest);
    }
    return emitBillingAudit(arg, ...rest);
  };
}
