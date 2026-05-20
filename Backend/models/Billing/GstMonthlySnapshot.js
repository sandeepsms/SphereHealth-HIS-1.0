// models/Billing/GstMonthlySnapshot.js
// ════════════════════════════════════════════════════════════════════
// R7ar-P1-23/D6-aq-06: GST monthly snapshot — frozen aggregate of the
// previous month's outward supply (PatientBill GENERATED/PARTIAL/PAID)
// + credit notes (refunds). Written once a month on the 1st at 02:00
// IST by the `gst-monthly-snapshot` cron.
//
// Pre-R7ar the cron only counted bills and logged the count. The audit
// register (`/accounts → GST Register`) re-aggregated live from
// PatientBill / CreditNote every page load — so any post-filing
// correction (manual edit, late refund, item add) silently mutated the
// "filed" total. NABH AAC.7 + GST Act §17 expect the registered total
// to be immutable once GSTR-1 is filed.
//
// Workflow:
//   1. Cron runs on the 1st at 02:00 IST → snapshots previous month.
//   2. Accountant reviews on /accounts → matches their GSTR-1 working.
//   3. Accountant clicks "Lock GST Period" → flips `lockedAt` on the
//      snapshot + cascades `periodLocked:true` on every CreditNote in
//      that month range.
//   4. From that moment any refund attempt that targets a locked
//      period rejects with a 423 "Period locked — issue a CN for the
//      current month and inform the patient" hint.
//
// The doc is keyed on `period: "YYYY-MM"` (compound unique). One row per
// month per state combo (we'll have a separate row for IGST vs CGST/SGST
// because the breakdown is what GSTR-1 cares about).
// ════════════════════════════════════════════════════════════════════
const mongoose = require("mongoose");
const Dec = mongoose.Schema.Types.Decimal128;

const GstMonthlySnapshotSchema = new mongoose.Schema(
  {
    // YYYY-MM (IST calendar). Indexed unique so the cron is idempotent —
    // a re-run within the same month no-ops the second write.
    period:        { type: String, required: true, unique: true, trim: true },
    periodStart:   { type: Date,   required: true },
    periodEnd:     { type: Date,   required: true },

    // ── Outward supply (bills) ─────────────────────────────────────
    billsCount:    { type: Number, default: 0 },
    grossSupply:   { type: Dec, default: 0 },   // sum of billItems.netAmount (pre-tax taxable value)
    taxableValue:  { type: Dec, default: 0 },   // same — kept as separate field for GSTR-1 clarity
    cgstOut:       { type: Dec, default: 0 },
    sgstOut:       { type: Dec, default: 0 },
    igstOut:       { type: Dec, default: 0 },
    totalTaxOut:   { type: Dec, default: 0 },   // cgst+sgst+igst

    // ── Credit notes (refund reversals) ────────────────────────────
    creditNotesCount: { type: Number, default: 0 },
    refundTaxableValue: { type: Dec, default: 0 },
    cgstReversed:  { type: Dec, default: 0 },
    sgstReversed:  { type: Dec, default: 0 },
    igstReversed:  { type: Dec, default: 0 },
    totalTaxReversed: { type: Dec, default: 0 },

    // ── Net (for GSTR-1 outward supply) ────────────────────────────
    netTaxableValue: { type: Dec, default: 0 },  // grossSupply - refundTaxableValue
    netCgst:       { type: Dec, default: 0 },
    netSgst:       { type: Dec, default: 0 },
    netIgst:       { type: Dec, default: 0 },
    netTotalTax:   { type: Dec, default: 0 },

    // ── Lifecycle ──────────────────────────────────────────────────
    generatedAt:   { type: Date, default: Date.now },
    // Set when the accountant confirms the period matches their GSTR-1
    // working. Once lockedAt is set, no CN may be issued against this
    // month (the bill-refund flow checks this and routes to current
    // month with a remark).
    lockedAt:      { type: Date, default: null },
    lockedBy:      { type: String, trim: true },
    lockedById:    { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

GstMonthlySnapshotSchema.index({ period: 1 }, { unique: true });
GstMonthlySnapshotSchema.index({ periodStart: 1, periodEnd: 1 });

// Decimal128 → Number on serialise
const { decimalToNumber } = require("../../utils/money");
GstMonthlySnapshotSchema.set("toJSON",   { transform: decimalToNumber });
GstMonthlySnapshotSchema.set("toObject", { transform: decimalToNumber });

module.exports =
  mongoose.models.GstMonthlySnapshot ||
  mongoose.model("GstMonthlySnapshot", GstMonthlySnapshotSchema);
