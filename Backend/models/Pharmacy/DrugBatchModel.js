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

    batchNo:      { type: String, required: true, trim: true },
    expiryDate:   { type: Date, required: true, index: true },
    mfgDate:      { type: Date, default: null },

    quantityIn:   { type: Number, required: true, min: 0 },      // received
    quantityOut:  { type: Number, default: 0,    min: 0 },       // dispensed/lost
    remaining:    { type: Number, default: 0,    min: 0 },       // computed: in - out

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
DrugBatchSchema.index({ drugId: 1, batchNo: 1 }, { unique: true });

// Auto-compute remaining on save.
DrugBatchSchema.pre("save", function (next) {
  this.remaining = Math.max(0, (this.quantityIn || 0) - (this.quantityOut || 0));
  next();
});

module.exports = mongoose.model("PharmacyDrugBatch", DrugBatchSchema);
