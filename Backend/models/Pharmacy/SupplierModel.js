/**
 * SupplierModel.js
 * Pharmacy supplier / distributor master.
 */
const mongoose = require("mongoose");

const SupplierSchema = new mongoose.Schema(
  {
    name:          { type: String, required: true, trim: true, index: true },
    contactPerson: { type: String, default: "" },
    phone:         { type: String, default: "" },
    email:         { type: String, default: "" },
    address:       { type: String, default: "" },
    city:          { type: String, default: "" },
    state:         { type: String, default: "" },
    pincode:       { type: String, default: "" },

    gstin:         { type: String, default: "" },
    panNumber:     { type: String, default: "" },
    drugLicenseNo: { type: String, default: "" },
    bankAccount:   { type: String, default: "" },
    ifscCode:      { type: String, default: "" },

    creditDays:    { type: Number, default: 30 },
    isActive:      { type: Boolean, default: true, index: true },

    createdBy:     { type: String, default: "" },
    updatedBy:     { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PharmacySupplier", SupplierSchema);
