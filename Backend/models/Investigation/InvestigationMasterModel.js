const mongoose = require("mongoose");

const InvestigationMasterSchema = new mongoose.Schema(
  {
    // Auto-generated: PATH-001, RAD-001, CARD-001
    investigationCode: {
      type: String,
      unique: true,
      uppercase: true,
      trim: true,
    },

    investigationName: {
      type: String,
      required: [true, "Investigation name is required"],
      trim: true,
    },

    shortName: {
      type: String,
      trim: true,
    },

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
    },

    // INTERNAL  → hospital lab only
    // EXTERNAL  → always referred outside
    // BOTH      → either option
    performedAt: {
      type: String,
      enum: ["INTERNAL", "EXTERNAL", "BOTH"],
      default: "INTERNAL",
    },

    defaultPrice: {
      type: Number,
      required: [true, "Default price is required"],
      min: 0,
      default: 0,
    },

    sampleType: {
      type: String,
      trim: true,
    },

    tatHours: {
      type: Number,
      default: 24,
    },

    isPackage: { type: Boolean, default: false },
    packageTests: [
      {
        investigationId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "InvestigationMaster",
        },
        investigationName: String,
        investigationCode: String,
      },
    ],

    isTaxable: { type: Boolean, default: false },
    taxPercentage: { type: Number, default: 0, min: 0, max: 28 },
    availableForTPA: { type: Boolean, default: true },
    requiresDoctorOrder: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 999 },
    isActive: { type: Boolean, default: true },
    description: { type: String, trim: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ── Auto-generate investigationCode before save ────────────────
// Format: PATH-001, RAD-001, CARD-001, MICRO-001 etc.
const CATEGORY_PREFIX = {
  PATHOLOGY: "PATH",
  RADIOLOGY: "RAD",
  CARDIOLOGY: "CARD",
  MICROBIOLOGY: "MICRO",
  BIOCHEMISTRY: "BIO",
  ENDOSCOPY: "ENDO",
  ULTRASONOGRAPHY: "USG",
  OTHER: "OTH",
};

InvestigationMasterSchema.pre("save", async function (next) {
  if (!this.investigationCode) {
    const prefix = CATEGORY_PREFIX[this.category] || "INV";
    // R7au-FIX-2/D1-CRIT-C3: atomic counter (same pattern as User
    // employeeId + Patient UHID). Pre-R7au the `countDocuments({regex}) + 1`
    // pattern raced under concurrent bulk-import — second insert hit
    // E11000 on unique investigationCode. Counter is per-prefix so
    // PATH/RAD/CARD series stay independent.
    const { nextSequence } = require("../../utils/counter");
    const seed = await mongoose.model("InvestigationMaster").countDocuments({
      investigationCode: { $regex: `^${prefix}-` },
    });
    const seq = await nextSequence(`invmaster:${prefix}`, seed);
    this.investigationCode = `${prefix}-${String(seq).padStart(3, "0")}`;
  }
  next();
});

InvestigationMasterSchema.index({ category: 1 });
InvestigationMasterSchema.index({ performedAt: 1 });
InvestigationMasterSchema.index({ isActive: 1 });
InvestigationMasterSchema.index({
  investigationName: "text",
  investigationCode: "text",
  shortName: "text",
});

module.exports =
  mongoose.models.InvestigationMaster ||
  mongoose.model("InvestigationMaster", InvestigationMasterSchema);
