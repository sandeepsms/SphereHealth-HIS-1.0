/**
 * HospitalSettings.js — singleton config for the whole HIS.
 *
 * Loose schema by design: every property is optional with a safe
 * default. The Settings page sends the whole document on save; new
 * properties just round-trip naturally.
 */
const mongoose = require("mongoose");

/* Reusable nested sub-schemas — kept _id-less so they round-trip
   cleanly in the JSON payload from the React form. */
const AccreditationSub = new mongoose.Schema({
  name: { type: String, default: "" },          // NABH, NABL, JCI, ISO 9001 …
  certNumber: { type: String, default: "" },
  issuedBy: { type: String, default: "" },
  issuedOn: { type: Date, default: null },
  expiresOn: { type: Date, default: null },
  showOnPrint: { type: Boolean, default: true },
}, { _id: true });

const ContactSub = new mongoose.Schema({
  label: { type: String, default: "" },         // Reception, Pharmacy, Lab, Billing, Emergency
  phone: { type: String, default: "" },
  email: { type: String, default: "" },
  notes: { type: String, default: "" },
}, { _id: true });

const BankAccountSub = new mongoose.Schema({
  bankName: { type: String, default: "" },
  accountNo: { type: String, default: "" },
  accountHolder: { type: String, default: "" },
  accountType: { type: String, enum: ["Savings", "Current", "NRO", "NRE"], default: "Current" },
  ifscCode: { type: String, default: "" },
  bankBranch: { type: String, default: "" },
  swiftCode: { type: String, default: "" },
  isPrimary: { type: Boolean, default: false },
  notes: { type: String, default: "" },
}, { _id: true });

const LicenceSub = new mongoose.Schema({
  label: { type: String, default: "" },         // Drug Licence, Blood Bank, BMW, Fire NOC, Pollution, ESI, PF, Professional Tax …
  number: { type: String, default: "" },
  issuedBy: { type: String, default: "" },
  issuedOn: { type: Date, default: null },
  expiresOn: { type: Date, default: null },
  notes: { type: String, default: "" },
}, { _id: true });

const SignatureSub = new mongoose.Schema({
  role: { type: String, default: "" },          // Authorised Signatory, Medical Superintendent, Billing Manager
  name: { type: String, default: "" },
  imageDataUrl: { type: String, default: "" },  // base64 PNG
  showOn: { type: [String], default: [] },       // ["bill","prescription","certificate"]
}, { _id: true });

const HospitalSettingsSchema = new mongoose.Schema(
  {
    /* ───────────────────────────────────────────────────────────
       1. IDENTITY & BRANDING
       ─────────────────────────────────────────────────────────── */
    hospitalName:    { type: String, default: "SphereHealth Hospital" },
    tagline:         { type: String, default: "NABH Accredited Multi-Specialty Hospital" },
    taglineLocal:    { type: String, default: "" },           // optional regional-language tagline
    logo:            { type: String, default: "" },            // header logo
    logoWidth:       { type: Number, default: 120 },
    secondaryLogo:   { type: String, default: "" },            // watermark / footer logo
    letterheadBanner:{ type: String, default: "" },            // optional banner image strip across letterhead
    hospitalType:    { type: String, enum: ["Private", "Government", "Trust", "Society", "Clinic"], default: "Private" },
    establishedYear: { type: Number, default: null },
    bedCount:        { type: Number, default: 0 },
    missionStatement:{ type: String, default: "" },
    aboutBlurb:      { type: String, default: "" },
    operatingHours:  { type: String, default: "24×7 emergency · OPD 9 AM – 9 PM" },

    /* ───────────────────────────────────────────────────────────
       1b. OPERATIONS — structured operating hours (R7bx item 7)
       The free-text `operatingHours` above still drives print
       headers; these structured fields back the OPS tab in the
       Hospital Config Wizard. Print code reads `operatingHours`
       first and falls back to opdStartTime/opdEndTime when blank.
       ─────────────────────────────────────────────────────────── */
    opdStartTime:    { type: String, default: "09:00" },  // 24h "HH:MM"
    opdEndTime:      { type: String, default: "21:00" },
    emergency24x7:   { type: Boolean, default: true },

    /* Admin / Owner contact — surfaced in the Wizard so the HIS
       knows who to escalate to. Not printed by default. */
    adminName:       { type: String, default: "" },
    adminPhone:      { type: String, default: "" },
    adminEmail:      { type: String, default: "" },

    /* NABH accreditation — explicit top-level mirrors of the
       `accreditations[]` array entry so the Wizard's NABH tab can
       round-trip a single value without resorting to array index
       management. The `accreditations[]` array remains the source
       of truth for multi-cert displays (NABL/JCI/ISO alongside). */
    nabhCertNumber:  { type: String, default: "" },
    nabhValidUntil:  { type: Date,   default: null },
    /* R7fq — print-shell enrichments. NABH-style header + footer
       blocks consumed by Frontend/src/templates/PrintShell.jsx. */
    nabhLogo:        { type: String, default: "" },            // URL or data-uri to accreditation badge image
    nabhSinceDate:   { type: String, default: "" },            // e.g. "Since June 16, 2008"
    taglineLeft:     { type: String, default: "" },            // small print under the left logo
    taglineRight:    { type: String, default: "" },            // small print under the right NABH badge
    helpline24x7:    { type: String, default: "" },            // surfaced in the emergency banner
    homeCareBrand:   { type: String, default: "" },            // e.g. "MaxAtHome"
    homeCarePhone:   { type: String, default: "" },
    printDisclaimer: { type: String, default: "This is a computer generated document and does not require any signature." },
    preparedByDefault:{ type: String, default: "" },           // counter-staff name fallback for prepared-by signature zone
    socials: {
      facebook:  { type: String, default: "" },
      instagram: { type: String, default: "" },
      linkedin:  { type: String, default: "" },
      twitter:   { type: String, default: "" },
      youtube:   { type: String, default: "" },
    },
    accreditations: { type: [AccreditationSub], default: [] }, // NABH/NABL/JCI/ISO with cert + expiry
    nabh:          { type: Boolean, default: true },           // kept for back-compat with print code
    nabl:          { type: Boolean, default: false },

    /* ───────────────────────────────────────────────────────────
       2. ADDRESS & CONTACT
       ─────────────────────────────────────────────────────────── */
    addressLine1:  { type: String, default: "" },
    addressLine2:  { type: String, default: "" },
    city:          { type: String, default: "" },
    state:         { type: String, default: "" },
    pincode:       { type: String, default: "" },
    country:       { type: String, default: "India" },
    googleMapsUrl: { type: String, default: "" },
    latitude:      { type: String, default: "" },
    longitude:     { type: String, default: "" },
    serviceAreas:  { type: [String], default: [] },            // ["Sonipat","Panipat","Karnal"]

    phone1:           { type: String, default: "" },           // primary
    phone2:           { type: String, default: "" },           // secondary
    emergencyPhone:   { type: String, default: "" },
    whatsappBusiness: { type: String, default: "" },
    tollFreeNumber:   { type: String, default: "" },
    fax:              { type: String, default: "" },
    email:            { type: String, default: "" },           // primary
    billingEmail:     { type: String, default: "" },
    supportEmail:     { type: String, default: "" },
    website:          { type: String, default: "" },
    patientPortalUrl: { type: String, default: "" },

    departmentContacts: { type: [ContactSub], default: [] },   // Reception, Pharmacy, Lab, Billing, Emergency, …

    /* ───────────────────────────────────────────────────────────
       3. LEGAL & REGISTRATION
       ─────────────────────────────────────────────────────────── */
    // Tax IDs
    gstin:        { type: String, default: "" },
    panNumber:    { type: String, default: "" },
    tanNumber:    { type: String, default: "" },               // TDS account
    cinNumber:    { type: String, default: "" },               // for Pvt Ltd hospitals
    // R7bx item 7 — GST registration STATE (separate from the address.state)
    // is what GSTR-1 / GSTR-3B filings key off. Default to "" so admin
    // populates it via the Wizard's Tax tab.
    gstRegState:  { type: String, default: "" },
    // R7bx item 7 — Default HSN/SAC code applied to bill rows where the
    // charge master row didn't specify one. SAC=services, HSN=goods.
    defaultHsnSac:{ type: String, default: "9993" },           // 9993 = healthcare services

    // Hospital registrations
    registrationNo: { type: String, default: "" },             // state health-dept registration
    registrationAuthority: { type: String, default: "" },
    registrationExpires:   { type: Date,   default: null },
    rohiniId:    { type: String, default: "" },                // IRDA-issued for insurance
    societyRegNo:{ type: String, default: "" },                // for Society/Trust hospitals
    trustDeedRef:{ type: String, default: "" },

    // Statutory codes
    epfNumber: { type: String, default: "" },
    esiNumber: { type: String, default: "" },
    professionalTaxRegNo: { type: String, default: "" },

    // ABDM / India digital health
    hfrId:        { type: String, default: "" },               // Health Facility Registry
    abhaAddress:  { type: String, default: "" },               // hospital ABHA / Sandbox
    fhirEnabled:  { type: Boolean, default: true },

    // Medical-specific licences (separate so they can have expiries)
    licences: { type: [LicenceSub], default: [] },             // Drug, Blood Bank, BMW, Fire, Pollution, Lift, etc.

    // Back-compat fields (kept so print code that reads them still works)
    drugLicenseNumber: { type: String, default: "" },
    drugLicenseNo:     { type: String, default: "" },          // alias
    fssaiNumber:       { type: String, default: "" },

    /* ───────────────────────────────────────────────────────────
       4. PRINT & FOOTER
       ─────────────────────────────────────────────────────────── */
    // Header layout
    printHeaderColor:  { type: String, default: "#1e293b" },
    printAccentColor:  { type: String, default: "#1d4ed8" },
    printHeaderAlign:  { type: String, enum: ["left","center","right"], default: "left" },
    printHeaderHeight: { type: Number, default: 80 },          // mm-ish
    showLogoInPrint:   { type: Boolean, default: true },
    showTaglineInPrint:{ type: Boolean, default: true },
    showAccreditationBadges: { type: Boolean, default: true },
    showContactInHeader: { type: Boolean, default: true },
    showAddressInHeader: { type: Boolean, default: true },

    // Watermark
    watermarkText:    { type: String, default: "" },           // "CONFIDENTIAL", "DRAFT", etc.
    watermarkOpacity: { type: Number, default: 0.08 },
    watermarkImage:   { type: String, default: "" },

    // Page settings
    defaultPaperSize: { type: String, enum: ["A4","A5","Letter","Legal"], default: "A4" },
    defaultMarginMm:  { type: Number, default: 12 },
    showPageNumbers:  { type: Boolean, default: true },
    showQrOnBills:    { type: Boolean, default: false },
    qrPayloadType:    { type: String, enum: ["billUrl","upiLink","none"], default: "billUrl" },

    /* ───────────────────────────────────────────────────────────
       R7ft: Patient-file print theme — 5 design templates.
       Admin picks one in Hospital Settings; CompleteIPDFile.jsx
       delegates rendering to the chosen theme component.
         • narrative — Apollo/Fortis discharge-letter prose
         • timeline  — chronological day-diary feed
         • executive — Max/Tirath 2-col dense brief
         • audit     — NABH inspector tabular
         • editorial — Glossy VIP magazine layout
       All 5 themes consume the same normalized data shape so swapping
       is just-a-render-difference, never a data-fetch difference.
       Default is "narrative" — best mix of brand impression + read-
       ability + page-count for tier-2/3 hospitals.
       ─────────────────────────────────────────────────────────── */
    patientFilePrintTheme: {
      type: String,
      enum: ["narrative","timeline","executive","audit","editorial"],
      default: "narrative",
    },

    // Bill footer
    billFooterNote: { type: String, default: "Thank you for choosing our hospital." },
    termsLine1:     { type: String, default: "This is a computer-generated bill and does not require a physical signature." },
    termsLine2:     { type: String, default: "All charges are as per the approved hospital tariff. Payments once made are non-refundable." },
    termsLine3:     { type: String, default: "For queries, contact the Billing Department." },
    refundPolicy:   { type: String, default: "" },
    latePaymentPolicy: { type: String, default: "" },

    // Signatures + seal
    signatures:    { type: [SignatureSub], default: [] },
    hospitalSeal:  { type: String, default: "" },              // base64 PNG

    /* ───────────────────────────────────────────────────────────
       5. BANK & PAYMENT DETAILS
       ─────────────────────────────────────────────────────────── */
    // Multi-account support
    bankAccounts:  { type: [BankAccountSub], default: [] },

    // Back-compat single bank (still read by some print code)
    bankName:      { type: String, default: "" },
    accountNo:     { type: String, default: "" },
    accountHolderName: { type: String, default: "" },          // R7bx item 7
    ifscCode:      { type: String, default: "" },
    bankBranch:    { type: String, default: "" },

    // UPI / digital payment
    upiId:         { type: String, default: "" },
    upiQrImage:    { type: String, default: "" },              // base64 PNG of QR
    upiHandlerName:{ type: String, default: "" },

    // Cheque
    chequePayableTo:{ type: String, default: "" },
    chequeDeliveryAddress: { type: String, default: "" },

    // Payment gateway (display only — actual secrets stay in env)
    paymentGatewayProvider: { type: String, enum: ["", "Razorpay", "Stripe", "PayU", "CCAvenue", "Cashfree"], default: "" },
    paymentGatewayKeyId:    { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("HospitalSettings", HospitalSettingsSchema);
