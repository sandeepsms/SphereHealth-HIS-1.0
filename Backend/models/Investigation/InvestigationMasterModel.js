const mongoose = require("mongoose");

// ═══════════════════════════════════════════════════════════════
// INVESTIGATION MASTER MODEL
// Hospital ke sabhi investigations/tests ka catalog
// CBC, LFT, KFT, X-Ray, ECG, MRI — sab yahan
// ═══════════════════════════════════════════════════════════════

const InvestigationMasterSchema = new mongoose.Schema(
  {
    investigationCode: {
      type: String,
      required: [true, "Investigation code required"],
      unique: true,
      uppercase: true,
      trim: true,
      // Format: PATH-001, RAD-001, CARD-001
    },

    investigationName: {
      type: String,
      required: [true, "Investigation name required"],
      trim: true,
    },

    // Pathology / Radiology / Cardiology / Microbiology / Biochemistry / Other
    category: {
      type: String,
      required: true,
      enum: [
        "PATHOLOGY",
        "RADIOLOGY",
        "CARDIOLOGY",
        "MICROBIOLOGY",
        "BIOCHEMISTRY",
        "ENDOSCOPY",
        "ULTRASONOGRAPHY",
        "OTHER",
      ],
      default: "PATHOLOGY",
    },

    subCategory: {
      type: String,
      trim: true,
      // e.g. "Haematology", "Clinical Biochemistry", "CT Scan"
    },

    // Default/base price (CASH) — overridden by InvestigationPricing per TPA
    defaultPrice: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    // Is this a package? e.g. "Full Body Checkup" = CBC + LFT + KFT + ...
    isPackage: {
      type: Boolean,
      default: false,
    },

    // Package mein kaunse tests hain (only if isPackage = true)
    packageTests: [
      {
        investigationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "InvestigationMaster",
        },
        investigationName: String, // denormalized for display
        investigationCode: String,
      },
    ],

    // Sample type for pathology tests
    sampleType: {
      type: String,
      trim: true,
      // e.g. "Blood", "Urine", "Stool", "Sputum", "Swab"
    },

    // Turnaround time in hours
    tatHours: {
      type: Number,
      default: 24,
    },

    // Report available in how many hours
    reportTimeHours: {
      type: Number,
      default: 24,
    },

    isTaxable: { type: Boolean, default: false },
    taxPercentage: { type: Number, default: 0, min: 0, max: 28 },

    availableForTPA: { type: Boolean, default: true },
    requiresDoctorOrder: { type: Boolean, default: true },

    displayOrder: { type: Number, default: 999 },
    isActive: { type: Boolean, default: true },

    description: { type: String, trim: true },
    shortName: { type: String, trim: true }, // CBC, LFT, KFT etc.
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

InvestigationMasterSchema.index({ investigationCode: 1 });
InvestigationMasterSchema.index({ category: 1 });
InvestigationMasterSchema.index({ isActive: 1 });
InvestigationMasterSchema.index({ isPackage: 1 });
InvestigationMasterSchema.index({
  investigationName: "text",
  investigationCode: "text",
  shortName: "text",
});

module.exports =
  mongoose.models.InvestigationMaster ||
  mongoose.model("InvestigationMaster", InvestigationMasterSchema);
