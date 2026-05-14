/**
 * PharmacySaleModel.js
 * One row per dispensing transaction. Items[] holds the actual drugs
 * sold and which batch each unit came from (FIFO chosen at sale time).
 */
const mongoose = require("mongoose");

const SALE_ITEM = new mongoose.Schema(
  {
    drugId:     { type: mongoose.Schema.Types.ObjectId, ref: "PharmacyDrug", required: true },
    drugName:   { type: String, required: true },
    batchId:    { type: mongoose.Schema.Types.ObjectId, ref: "PharmacyDrugBatch", default: null },
    batchNo:    { type: String, default: "" },
    expiryDate: { type: Date, default: null },

    quantity:   { type: Number, required: true, min: 1 },
    unitPrice:  { type: Number, required: true, min: 0 },
    gstRate:    { type: Number, default: 12 },
    discountPercent: { type: Number, default: 0 },

    grossAmount:    { type: Number, default: 0 },     // qty * unit
    discountAmount: { type: Number, default: 0 },
    taxableAmount:  { type: Number, default: 0 },
    gstAmount:      { type: Number, default: 0 },
    netAmount:      { type: Number, default: 0 },     // taxable + gst
  },
  { _id: true }
);

const PharmacySaleSchema = new mongoose.Schema(
  {
    billNumber: { type: String, default: "", index: true, unique: true, sparse: true },

    // Patient (optional — walk-in sales allowed)
    patientUHID: { type: String, default: "" },
    patientName: { type: String, default: "" },
    contactNumber:{ type: String, default: "" },
    age:         { type: Number, default: null },
    gender:      { type: String, default: "" },
    doctorName:  { type: String, default: "" },

    // Source
    saleType: {
      type: String,
      enum: ["OPD","IPD","Walk-in","Homecare"],
      default: "Walk-in",
      index: true,
    },
    admissionId:    { type: mongoose.Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
    admissionNumber:{ type: String, default: "" },           // denormalised for quick search/display
    prescriptionRef:{ type: String, default: "" },

    items:       { type: [SALE_ITEM], default: [] },

    // Totals
    subTotal:        { type: Number, default: 0 },
    totalDiscount:   { type: Number, default: 0 },
    totalTaxable:    { type: Number, default: 0 },
    totalGst:        { type: Number, default: 0 },
    roundOff:        { type: Number, default: 0 },
    grandTotal:      { type: Number, default: 0 },

    // Payment
    paymentMode: { type: String, enum: ["Cash","Card","UPI","Mixed","Credit"], default: "Cash" },
    amountPaid:  { type: Number, default: 0 },
    balanceDue:  { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["Completed","Refunded","Cancelled","Hold"],
      default: "Completed",
      index: true,
    },

    createdBy:   { type: String, default: "" },
    createdById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    remarks:     { type: String, default: "" },
  },
  { timestamps: true }
);

PharmacySaleSchema.index({ createdAt: -1 });

module.exports = mongoose.model("PharmacySale", PharmacySaleSchema);
