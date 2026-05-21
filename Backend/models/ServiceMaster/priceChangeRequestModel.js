// models/ServiceMaster/priceChangeRequestModel.js
// ════════════════════════════════════════════════════════════════════
// R7bb-FIX-E-16/D3-HIGH-3: ServiceMaster price-change maker-checker.
//
// Pre-R7bb any Admin could push a ServiceMaster price update directly,
// instantly changing every downstream bill, package, and TPA rate.
// A single fat-finger (₹500 → ₹5000) on a high-volume service silently
// inflates every new bill until a cashier notices — a financial-
// control gap flagged by D3-HIGH-3.
//
// Two-tier policy:
//   • Δ < ₹500 AND |Δ%| ≤ 10  → direct update (low-risk)
//   • Δ ≥ ₹500 OR  |Δ%| > 10  → priceChangeRequest doc, requires a
//                                DIFFERENT Admin to approve via
//                                POST /services/price-change-requests/:id/approve
//
// The request carries the proposed value(s) + the previous snapshot so
// the approver sees exactly what they're sanctioning. On approve, the
// ServiceMaster row is updated and a MASTER_SERVICE_PRICING_UPDATED
// audit row lands in BillingAudit.
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const PriceChangeRequestSchema = new mongoose.Schema(
  {
    // ── References ────────────────────────────────────────────────
    serviceMaster: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "ServiceMaster",
      required: true,
      index: true,
    },
    serviceCode: { type: String, trim: true, uppercase: true, required: true, index: true },
    serviceName: { type: String, trim: true, default: "" },

    // ── Change details ───────────────────────────────────────────
    // We allow either a flat defaultPrice change or a tierPricing change.
    // Stored as Mixed so callers can supply only the fields they intend
    // to change without forcing a full snapshot.
    before: {
      defaultPrice: { type: Number, default: 0 },
      tierPricing:  { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    after: {
      defaultPrice: { type: Number, default: 0 },
      tierPricing:  { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    delta:        { type: Number, default: 0 },     // (after.defaultPrice − before.defaultPrice)
    deltaPercent: { type: Number, default: 0 },     // |delta / before| * 100

    reason: { type: String, trim: true, default: "" },

    // ── Maker ────────────────────────────────────────────────────
    requestedBy: { type: String, trim: true, default: "" },
    requestedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "User",
      required: true,
      index: true,
    },
    requestedByRole: { type: String, trim: true, default: "" },
    requestedAt:     { type: Date, default: Date.now },

    // ── Checker ──────────────────────────────────────────────────
    status: {
      type: String,
      enum: ["PENDING_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"],
      default: "PENDING_APPROVAL",
      index: true,
    },
    approvedBy: { type: String, trim: true, default: "" },
    approvedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "User",
      default: null,
    },
    approvedByRole: { type: String, trim: true, default: "" },
    approvedAt:     { type: Date, default: null },
    rejectionReason:{ type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

PriceChangeRequestSchema.index({ status: 1, createdAt: -1 });
PriceChangeRequestSchema.index({ serviceMaster: 1, status: 1 });

module.exports =
  mongoose.models.ServiceMasterPriceChangeRequest ||
  mongoose.model("ServiceMasterPriceChangeRequest", PriceChangeRequestSchema);
