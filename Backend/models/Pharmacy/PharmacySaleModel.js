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

    // ── Patient credit ledger (signed amount the pharmacy OWES the patient).
    //   Positive value = pharmacy is holding patient's money:
    //     • over-payment at counter (amountPaid > grandTotal)
    //     • refund issued via "Credit-note" or "Adjusted" mode (not paid in cash)
    //   Reset to 0 when settled back to the patient (cash payout / next bill).
    //   Kept separate from balanceDue so neither field clamps the other.
    patientCredit: { type: Number, default: 0 },
    patientCreditLog: {
      type: [ new mongoose.Schema({
        amount:    { type: Number, required: true },     // positive = credit added, negative = settled
        reason:    { type: String, default: "" },        // "Over-payment", "Refund (Credit-note)", "Settled to patient"
        refSlip:   { type: String, default: "" },        // bill no / refund slip / payout ref
        at:        { type: Date, default: Date.now },
        byName:    { type: String, default: "" },
        byId:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      }, { _id: true }) ],
      default: [],
    },

    status: {
      type: String,
      enum: ["Completed","Partial-Return","Refunded","Cancelled","Hold"],
      default: "Completed",
      index: true,
    },

    // ── Returns / refunds — every partial return appends a record here.
    //   refundSlipNumber  REF-PHM-YYYYMMDD-NNNN, issued by Counter
    //   refundedItems[]   {{ saleItemId, drugId, drugName, batchId, batchNo,
    //                       quantity, unitPrice, gstRate, discountPercent,
    //                       grossAmount, discountAmount, taxableAmount,
    //                       gstAmount, netAmount }}
    //   refundAmount     total returned to customer (sum of items' netAmount)
    //   refundMode       Cash / Card / UPI / Adjusted / Credit-note
    //   reason           optional free-text
    // Existing items[] is kept unchanged so the original tax invoice
    // can always be reprinted. Net-of-returns figures are computed from
    // items[] - sum(returns[].refundedItems[]).
    returns: {
      type: [ new mongoose.Schema({
        refundSlipNumber: { type: String, default: "" },
        refundedItems:    { type: Array, default: [] },
        refundAmount:     { type: Number, default: 0 },
        refundTaxable:    { type: Number, default: 0 },
        refundGst:        { type: Number, default: 0 },
        refundDiscount:   { type: Number, default: 0 },
        refundMode:       { type: String, enum: ["Cash","Card","UPI","Adjusted","Credit-note"], default: "Cash" },
        refundedAt:       { type: Date, default: Date.now },
        refundedBy:       { type: String, default: "" },
        refundedById:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reason:           { type: String, default: "" },
        notes:            { type: String, default: "" },
      }, { _id: true, timestamps: true }) ],
      default: [],
    },

    createdBy:   { type: String, default: "" },
    createdById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    remarks:     { type: String, default: "" },
  },
  { timestamps: true }
);

PharmacySaleSchema.index({ createdAt: -1 });

module.exports = mongoose.model("PharmacySale", PharmacySaleSchema);
