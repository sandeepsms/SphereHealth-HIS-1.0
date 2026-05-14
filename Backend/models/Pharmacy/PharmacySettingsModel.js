/**
 * PharmacySettingsModel.js — singleton config for the pharmacy module.
 *
 * mode:
 *   "in-house"    → invoices print with hospital header/footer
 *                   (the existing /api/hospital-settings doc is used).
 *   "outsourced"  → invoices print with this doc's header/footer instead,
 *                   so a third-party pharmacy can legally bill under its
 *                   own GSTIN / drug-license / trade name.
 *
 * Always exactly one doc — controller upserts on { _id: "default" }.
 */
const mongoose = require("mongoose");

const PharmacySettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "default" },

    mode: { type: String, enum: ["in-house", "outsourced"], default: "in-house" },

    // Identity (only used when mode === "outsourced")
    pharmacyName:    { type: String, default: "Hospital Pharmacy" },
    tagline:         { type: String, default: "" },
    logo:            { type: String, default: "" },   // data-url or http url
    showLogoInPrint: { type: Boolean, default: true },
    showTagline:     { type: Boolean, default: true },

    // Address
    addressLine1: { type: String, default: "" },
    addressLine2: { type: String, default: "" },
    city:         { type: String, default: "" },
    state:        { type: String, default: "" },
    pincode:      { type: String, default: "" },
    country:      { type: String, default: "India" },

    // Contact
    phone1:  { type: String, default: "" },
    phone2:  { type: String, default: "" },
    email:   { type: String, default: "" },
    website: { type: String, default: "" },

    // Regulatory / tax
    gstin:           { type: String, default: "" },
    panNumber:       { type: String, default: "" },
    drugLicenseNo:   { type: String, default: "" },
    drugLicenseExp:  { type: Date,   default: null },
    fssaiNumber:     { type: String, default: "" },

    // Bank (printed on invoice footer for credit / pay-later customers)
    bankName:    { type: String, default: "" },
    bankAccount: { type: String, default: "" },
    ifscCode:    { type: String, default: "" },
    bankBranch:  { type: String, default: "" },
    upiId:       { type: String, default: "" },

    // Design
    headerColor:    { type: String, default: "#ea580c" },   // primary header band
    accentColor:    { type: String, default: "#c2410c" },   // totals + emphasis

    // Invoice footer text
    footerNote: { type: String, default: "" },
    termsLine1: { type: String, default: "Goods once sold are not returnable unless seal is intact (within 7 days)." },
    termsLine2: { type: String, default: "Store medicines as per pack instructions." },
    termsLine3: { type: String, default: "Subject to local jurisdiction." },

    // Whether to display "in-house" or "outsourced" badge on the invoice
    showModeBadge: { type: Boolean, default: false },

    updatedBy: { type: String, default: "" },
  },
  { timestamps: true, _id: false }
);

module.exports = mongoose.model("PharmacySettings", PharmacySettingsSchema);
