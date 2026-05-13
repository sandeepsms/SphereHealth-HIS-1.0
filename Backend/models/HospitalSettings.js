const mongoose = require("mongoose");

const HospitalSettingsSchema = new mongoose.Schema(
  {
    /* ── Identity ─────────────────────────────────────────────── */
    hospitalName:  { type: String, default: "SphereHealth Hospital" },
    tagline:       { type: String, default: "NABH Accredited Multi-Specialty Hospital" },
    logo:          { type: String, default: "" },   // base64 data-URI or URL
    logoWidth:     { type: Number, default: 120 },  // px

    /* ── Address ──────────────────────────────────────────────── */
    addressLine1:  { type: String, default: "" },
    addressLine2:  { type: String, default: "" },
    city:          { type: String, default: "" },
    state:         { type: String, default: "" },
    pincode:       { type: String, default: "" },
    country:       { type: String, default: "India" },

    /* ── Contact ──────────────────────────────────────────────── */
    phone1:        { type: String, default: "" },
    phone2:        { type: String, default: "" },
    email:         { type: String, default: "" },
    website:       { type: String, default: "" },
    fax:           { type: String, default: "" },

    /* ── Legal / Accreditation ────────────────────────────────── */
    gstin:         { type: String, default: "" },
    registrationNo:{ type: String, default: "" },
    nabh:          { type: Boolean, default: true },
    nabl:          { type: Boolean, default: false },
    rohiniId:      { type: String, default: "" },
    panNumber:     { type: String, default: "" },

    /* ── ABDM (Ayushman Bharat Digital Mission) IDs ───────────
       Required for FHIR bundle export to be ingested by ABDM PHR. */
    hfrId:         { type: String, default: "" },  // Health Facility Registry ID
    fhirEnabled:   { type: Boolean, default: true },

    /* ── Print / Header Settings ──────────────────────────────── */
    printHeaderColor:  { type: String, default: "#1e293b" },
    printAccentColor:  { type: String, default: "#1d4ed8" },
    showLogoInPrint:   { type: Boolean, default: true },
    showTaglineInPrint:{ type: Boolean, default: true },

    /* ── Bill Footer ──────────────────────────────────────────── */
    billFooterNote: { type: String, default: "Thank you for choosing our hospital." },
    termsLine1:     { type: String, default: "This is a computer-generated bill and does not require a physical signature." },
    termsLine2:     { type: String, default: "All charges are as per the approved hospital tariff. Payments once made are non-refundable." },
    termsLine3:     { type: String, default: "For queries, contact the Billing Department." },

    /* ── Bank Details (for receipts) ─────────────────────────── */
    bankName:      { type: String, default: "" },
    accountNo:     { type: String, default: "" },
    ifscCode:      { type: String, default: "" },
    bankBranch:    { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("HospitalSettings", HospitalSettingsSchema);
