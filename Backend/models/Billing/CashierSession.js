// models/Billing/CashierSession.js
// ════════════════════════════════════════════════════════════════════
// R7ap-F20/C-13/D6-01: CashierSession — backend persistence for cashier
// shifts. Pre-R7ap the Accounts → Shift / Cashier tab persisted to
// localStorage only, so variance / opening cash / closing cash were lost
// on cache clear, device switch, or any other browser. NABH AAC.7 / IMS.7
// expects per-cashier reconciliation traceable across devices.
//
// One shift = one row. `openedAt` is required on creation, `closedAt`
// flips it from OPEN → CLOSED. Only one OPEN shift per cashier at a time
// (partial unique index below).
// ════════════════════════════════════════════════════════════════════
const mongoose = require("mongoose");
const Dec = mongoose.Schema.Types.Decimal128;

const CashierSessionSchema = new mongoose.Schema(
  {
    cashierId:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    cashierName:   { type: String, trim: true, required: true },
    cashierRole:   { type: String, trim: true },

    // ── Open ──────────────────────────────────────────────────────
    openedAt:      { type: Date, required: true, default: Date.now },
    openingCash:   { type: Dec, required: true, default: 0 },
    openNotes:     { type: String, trim: true },

    // ── Close ─────────────────────────────────────────────────────
    closedAt:      { type: Date, default: null },
    closingCash:   { type: Dec, default: null },
    expectedClosing:{ type: Dec, default: null },     // openingCash + cash collected − cash out
    variance:      { type: Dec, default: null },      // closingCash − expectedClosing
    varianceNote:  { type: String, trim: true },      // mandatory if |variance| > 0
    closeNotes:    { type: String, trim: true },

    // ── Snapshot of the day's cash flow attributed to this cashier ─
    // Populated at close time by querying BillingAudit + PatientAdvance
    // for the cashier in the openedAt → closedAt window.
    cashCollected:    { type: Dec, default: 0 },      // CASH payments + advance deposits
    cashRefundedOut:  { type: Dec, default: 0 },      // bill refunds + advance refunds (cash mode)
    advancesApplied:  { type: Dec, default: 0 },      // internal — for transparency only

    status:        { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN", index: true },
    // R7ar-P1-22/D10-aq-02: when the EOD cron closes a forgotten shift,
    // flag it so a manager can review the variance separately.
    closedByCron:   { type: Boolean, default: false },
    // R7ar-D5-aq-12: per-mode shift snapshot for NABH per-shift reconciliation.
    upiCollected:    { type: Dec, default: 0 },
    cardCollected:   { type: Dec, default: 0 },
    chequeCollected: { type: Dec, default: 0 },
  },
  { timestamps: true },
);

// Only one OPEN shift per cashier at a time.
CashierSessionSchema.index(
  { cashierId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "OPEN" },
    name: "uniq_open_per_cashier",
  },
);
CashierSessionSchema.index({ openedAt: -1 });

// Decimal128 → Number on serialise
const { decimalToNumber } = require("../../utils/money");
CashierSessionSchema.set("toJSON",   { transform: decimalToNumber });
CashierSessionSchema.set("toObject", { transform: decimalToNumber });

module.exports =
  mongoose.models.CashierSession ||
  mongoose.model("CashierSession", CashierSessionSchema);
