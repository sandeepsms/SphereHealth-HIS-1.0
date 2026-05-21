// models/Pharmacy/PharmacyVendorReturnModel.js
// ════════════════════════════════════════════════════════════════════
// R7bb-FIX-E-11/D6-HIGH-1: PharmacyVendorReturn — record a batch return
// to the supplier (expired, damaged, recalled, short-shipped).
//
// Why: pre-R7bb the only way to reduce DrugBatch.remaining on a return-
// to-vendor was a manual stock adjustment, which left no audit trail of
// WHO returned WHAT to WHICH vendor on WHICH date and WHY. D&C Rules
// (Forms 6/6A) and GST Act §34 (debit note from the buyer side) both
// require this trail for inspection.
//
// Each row = one return event. Decrements DrugBatch.remaining +
// increments DrugBatch.vendorReturned, emits a BillingAudit row, and
// (in future) feeds the supplier debit-note generator.
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const PharmacyVendorReturnSchema = new mongoose.Schema(
  {
    // ── References ────────────────────────────────────────────────
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "PharmacyDrugBatch",
      required: true,
      index: true,
    },
    drugId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "PharmacyDrug",
      required: true,
      index: true,
    },
    drugName:    { type: String, trim: true, default: "" },
    batchNo:     { type: String, trim: true, default: "" },

    // Vendor — free-text fallback for legacy data, ObjectId when known.
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "PharmacySupplier",
      default: null,
    },
    vendorName: { type: String, trim: true, default: "" },

    // ── Return details ───────────────────────────────────────────
    qty: {
      type: Number,
      required: true,
      min: [1, "qty must be at least 1"],
    },
    reason: {
      type: String,
      enum: ["EXPIRED", "DAMAGED", "RECALL", "SHORT_SHIPMENT", "QUALITY_FAIL", "OTHER"],
      default: "EXPIRED",
      index: true,
    },
    expiryDate:    { type: Date, default: null },          // batch expiry at time of return
    debitNoteNo:   { type: String, trim: true, default: "" },
    debitNoteDate: { type: Date, default: null },

    // Optional free-text reason / inspector remarks
    remarks: { type: String, trim: true, default: "" },

    // ── Audit ────────────────────────────────────────────────────
    returnedAt: { type: Date, default: Date.now, index: true },
    returnedBy: { type: String, trim: true, default: "" },
    returnedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    returnedByRole: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

PharmacyVendorReturnSchema.index({ vendor: 1, returnedAt: -1 });
PharmacyVendorReturnSchema.index({ drugId: 1, returnedAt: -1 });

module.exports =
  mongoose.models.PharmacyVendorReturn ||
  mongoose.model("PharmacyVendorReturn", PharmacyVendorReturnSchema);
