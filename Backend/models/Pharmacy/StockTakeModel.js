/**
 * StockTakeModel.js  (R7bd-E-2 / A2-MED-18)
 *
 * Pharmacy cycle-count / stock-take ledger. One document per stock-take
 * EVENT (e.g. "monthly count for narcotics", "quarterly full count");
 * each `lines[]` entry is one batch line counted within that event.
 *
 * Lifecycle:
 *   DRAFT      → service.createCount() pre-fills systemQty per batch
 *   SUBMITTED  → counter walked the shelf + entered physicalQty per line
 *   VERIFIED   → second pharmacist signed off
 *   ADJUSTED   → service.verifyAndAdjust() applied variances to DrugBatch
 *
 * NABH AAC.7 / D&C Rules audit each adjustment to a specific user and
 * variance reason — every line carries `varianceReason` (mandatory when
 * variance != 0) and the parent doc carries `countedBy` / `verifiedBy`.
 *
 * Variance application happens via atomic
 *   DrugBatch.findOneAndUpdate({ _id }, { $inc: { remaining: variance } })
 * in the service so a concurrent dispense doesn't lose the count.
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

const StockTakeLineSchema = new Schema(
  {
    drugId:    { type: Schema.Types.ObjectId, ref: "PharmacyDrug", required: true, index: true },
    drugName:  { type: String, default: "" },
    batchId:   { type: Schema.Types.ObjectId, ref: "PharmacyDrugBatch", required: true, index: true },
    batchNo:   { type: String, default: "" },
    expiryDate: { type: Date, default: null },

    systemQty:    { type: Number, required: true, min: 0 },   // pre-filled from DrugBatch.remaining
    physicalQty:  { type: Number, default: null },             // null = not yet counted
    variance:     { type: Number, default: 0 },                // physicalQty - systemQty
    varianceReason: {
      type: String,
      // Free-text but the UI offers a fixed set so reports can group.
      // Required when variance != 0 (enforced by service, not schema).
      default: "",
    },

    adjustedAt:  { type: Date, default: null },                // when verifyAndAdjust posted this line

    // R7hr-12-S2 (D6-04): per-line actor stamp for the pharmacist who
    // walked the shelf and entered the physical count. Pre-R7hr-12 the
    // physical-count entry was attributed implicitly to countedBy (the
    // creator of the stock-take), so a second-shift pharmacist who
    // actually counted the stock left no trace. NABH AAC.7 SOD relies
    // on this for the verify-time check — verifier must not equal
    // either the creator OR any per-line entrant.
    enteredBy:    { type: String, default: "" },
    enteredById:  { type: Schema.Types.ObjectId, ref: "User", default: null },
    enteredAt:    { type: Date,   default: null },
  },
  { _id: true },
);

const StockTakeSchema = new Schema(
  {
    date:    { type: Date, required: true, index: true },
    title:   { type: String, default: "" },                    // free-text label
    scope:   { type: String, default: "" },                    // e.g. "Narcotics", "Cold-chain", "Full"

    lines:   { type: [StockTakeLineSchema], default: [] },

    status: {
      type: String,
      enum: ["DRAFT", "SUBMITTED", "VERIFIED", "ADJUSTED"],
      default: "DRAFT",
      index: true,
    },

    countedBy:     { type: String, default: "" },
    countedById:   { type: Schema.Types.ObjectId, ref: "User" },
    submittedAt:   { type: Date, default: null },

    verifiedBy:    { type: String, default: "" },
    verifiedById:  { type: Schema.Types.ObjectId, ref: "User" },
    verifiedAt:    { type: Date, default: null },

    adjustedAt:    { type: Date, default: null },
    notes:         { type: String, default: "" },
  },
  { timestamps: true },
);

StockTakeSchema.index({ status: 1, date: -1 });

module.exports = mongoose.models.PharmacyStockTake ||
  mongoose.model("PharmacyStockTake", StockTakeSchema);
