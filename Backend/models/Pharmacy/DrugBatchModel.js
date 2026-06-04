/**
 * DrugBatchModel.js
 * One document per physical batch received via a GRN (Goods Receipt Note).
 * Stock is consumed FIFO by expiry within a drug — earliest expiry first.
 */
const mongoose = require("mongoose");

const DrugBatchSchema = new mongoose.Schema(
  {
    drugId:       { type: mongoose.Schema.Types.ObjectId, ref: "PharmacyDrug", required: true, index: true },
    drugName:     { type: String, default: "" },   // denormalized for quick lookup

    // R7hr-12-S3 (D1-12): keep `required: true` so the API still rejects
    // missing batchNo at the surface, but the (drugId, batchNo) unique
    // index below uses a partialFilterExpression that only kicks in when
    // batchNo is a non-empty string. Together they prevent the cryptic
    // E11000 the GRN clerk used to see when two batches arrived with
    // whitespace-only batchNo (trimmed to '') for the same drug.
    batchNo:      { type: String, required: true, trim: true },
    expiryDate:   { type: Date, required: true, index: true },
    mfgDate:      { type: Date, default: null },

    quantityIn:   { type: Number, required: true, min: 0 },      // received
    quantityOut:  { type: Number, default: 0,    min: 0 },       // dispensed/lost
    // R7bb-FIX-E-11/D6-HIGH-1: separate counter for stock returned
    // to the supplier (expired, damaged, recalled). Subtracted from
    // remaining alongside quantityOut so dispense and vendor-return
    // both deplete the same available pool. Kept distinct so the
    // expiry / D&C registers can tell "we returned 60 strips to the
    // supplier" apart from "we dispensed 60 strips to patients".
    vendorReturned: { type: Number, default: 0, min: 0 },
    remaining:    { type: Number, default: 0,    min: 0 },       // computed: in - out - vendorReturned

    purchaseRate: { type: Number, default: 0 },     // per unit, pre-GST
    mrp:          { type: Number, default: 0 },
    salePrice:    { type: Number, default: 0 },     // per-unit selling rate (post-discount, pre-GST)

    supplierId:   { type: mongoose.Schema.Types.ObjectId, ref: "PharmacySupplier", default: null },
    supplierName: { type: String, default: "" },
    grnNumber:    { type: String, default: "" },
    invoiceNo:    { type: String, default: "" },
    invoiceDate:  { type: Date,   default: null },

    location:     { type: String, default: "Main Pharmacy" },    // for multi-store later

    isActive:     { type: Boolean, default: true, index: true },
    createdBy:    { type: String, default: "" },
  },
  { timestamps: true }
);

DrugBatchSchema.index({ drugId: 1, expiryDate: 1, remaining: 1 });
// R7hr-12-S3 (D1-12): partial filter so the compound unique only fires for
// non-empty batchNo. Previously a blank/whitespace batchNo (some suppliers
// don't print one on the strip) trimmed to '' and the *second* such GRN
// for the same drug failed with E11000 — confusing the GRN clerk into
// thinking they had a real duplicate. With the partial filter, multiple
// "no batch number" GRNs for the same drug are allowed; the moment a real
// batchNo is recorded the dedupe is enforced.
DrugBatchSchema.index(
  { drugId: 1, batchNo: 1 },
  { unique: true, partialFilterExpression: { batchNo: { $type: "string", $gt: "" } } },
);
// R7hr-12-S2 (D8-06): unique grnNumber so the monotonic Counter-driven
// GRN sequence (pharmacyController.recordGRN) detects collisions and the
// D&C "sequential purchase register" assumption holds. Partial filter
// expression skips legacy rows with empty grnNumber so the new index
// doesn't collide on the pre-fix Math.random()-suffix history.
DrugBatchSchema.index(
  { grnNumber: 1 },
  { unique: true, partialFilterExpression: { grnNumber: { $gt: "" } } },
);

// Auto-compute remaining on save.
// R7bb-FIX-E-11: include vendorReturned in the consumption side so a
// batch fully returned to the supplier shows remaining: 0 even if
// quantityOut hasn't moved (no patient dispenses on a returned batch).
DrugBatchSchema.pre("save", function (next) {
  this.remaining = Math.max(0, (this.quantityIn || 0) - (this.quantityOut || 0) - (this.vendorReturned || 0));
  next();
});

module.exports = mongoose.model("PharmacyDrugBatch", DrugBatchSchema);
