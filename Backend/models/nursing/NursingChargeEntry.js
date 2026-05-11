/**
 * NursingChargeEntry — one record per item used per shift.
 * Daily-dedup is enforced at the service layer:
 *   if chargeOncePerDay=true, only one entry per (admissionId + itemId + dateKey) is kept.
 */

const mongoose = require("mongoose");

const NursingChargeEntrySchema = new mongoose.Schema(
  {
    admissionId: { type: mongoose.Schema.Types.ObjectId, ref: "Admission", required: true },
    patientId:   { type: mongoose.Schema.Types.ObjectId, ref: "Patient",   required: true },
    UHID:        { type: String, required: true, index: true },

    itemId:      { type: mongoose.Schema.Types.ObjectId, ref: "NursingConsumableItem", required: true },
    itemName:    { type: String, required: true },
    category:    { type: String },
    unitPrice:   { type: Number, required: true },
    quantity:    { type: Number, default: 1, min: 1 },
    totalAmount: { type: Number },          // unitPrice * quantity

    // "2026-04-15"  — used for daily dedup query without timezone drift
    dateKey:     { type: String, required: true, index: true },

    shift:       { type: String, enum: ["morning", "afternoon", "evening", "night"], required: true },
    chargedBy:   { type: String, required: true },  // nurse name
    chargedById: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // voided if nurse removes the entry before billing is finalised
    status:      { type: String, enum: ["active", "voided"], default: "active" },
    voidReason:  { type: String },

    // set to true once pushed to main billing ledger
    billed:      { type: Boolean, default: false } },
  { timestamps: true }
);

// Compound unique index — prevents duplicate active charges for same item same day same admission
NursingChargeEntrySchema.index(
  { admissionId: 1, itemId: 1, dateKey: 1, status: 1 },
  { unique: false }   // unique enforced in service via findOne check, not DB constraint
);

NursingChargeEntrySchema.pre("save", function (next) {
  this.totalAmount = this.unitPrice * (this.quantity || 1);
  next();
});

module.exports =
  mongoose.models.NursingChargeEntry ||
  mongoose.model("NursingChargeEntry", NursingChargeEntrySchema);
