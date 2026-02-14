// models/bedMgmt/roomCategoryModel.js
const mongoose = require("mongoose");

const RoomCategorySchema = new mongoose.Schema(
  {
    // ========== BASIC INFO ==========
    categoryName: {
      type: String,
      required: [true, "Category name is required"],
      unique: true,
      trim: true,
    },

    categoryCode: {
      type: String,
      required: [true, "Category code is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
    },

    roomType: {
      type: String,
      enum: [
        "General Ward",
        "ICU",
        "NICU",
        "CCU",
        "HDU",
        "Private Room",
        "Semi-Private",
        "Deluxe",
        "Suite",
        "Emergency",
        "Daycare",
        "Isolation",
        "Maternity",
        "Pediatric",
        "Operation Theatre",
        "Recovery Room",
        "Other",
      ],
      default: "General Ward",
    },

    // ========== PRICING ==========
    defaultPricing: {
      perBedDailyRate: {
        type: Number,
        default: 0,
        min: [0, "Rate cannot be negative"],
      },
      nursingCharges: {
        type: Number,
        default: 0,
        min: [0, "Charges cannot be negative"],
      },
      equipmentCharges: {
        type: Number,
        default: 0,
        min: [0, "Charges cannot be negative"],
      },
      securityDeposit: {
        type: Number,
        default: 0,
        min: [0, "Deposit cannot be negative"],
      },
      currency: {
        type: String,
        default: "INR",
        uppercase: true,
        trim: true,
      },
    },

    // ========== CAPACITY RULES ==========
    minBeds: {
      type: Number,
      default: 1,
      min: 1,
    },

    maxBeds: {
      type: Number,
      default: 10,
      min: 1,
    },

    // ========== DEFAULT AMENITIES ==========
    defaultAmenities: {
      type: [String],
      default: [],
    },

    // ========== CLASSIFICATION ==========
    classification: {
      type: String,
      enum: ["Economy", "Standard", "Premium", "Deluxe", "VIP"],
      default: "Standard",
    },

    // ========== SYSTEM FLAGS ==========
    displayOrder: {
      type: Number,
      default: 999,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // ========== OPTIONAL INFO ==========
    color: {
      type: String,
      default: "#3B82F6",
    },

    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ========== INDEXES ==========
RoomCategorySchema.index({ categoryCode: 1 }, { unique: true });
RoomCategorySchema.index({ isActive: 1, displayOrder: 1 });
RoomCategorySchema.index({ roomType: 1 });

// ========== VIRTUALS ==========
RoomCategorySchema.virtual("totalBaseCost").get(function () {
  if (!this.defaultPricing) return 0;

  const base = this.defaultPricing.perBedDailyRate || 0;
  const nursing = this.defaultPricing.nursingCharges || 0;
  const equipment = this.defaultPricing.equipmentCharges || 0;

  return base + nursing + equipment;
});

RoomCategorySchema.virtual("isCriticalCare").get(function () {
  const criticalTypes = ["ICU", "NICU", "CCU", "HDU"];
  return criticalTypes.includes(this.roomType);
});

// ========== INSTANCE METHODS ==========
RoomCategorySchema.methods.validateBedCount = function (bedCount) {
  if (bedCount < this.minBeds) {
    return {
      valid: false,
      message: `Minimum ${this.minBeds} bed(s) required`,
    };
  }

  if (bedCount > this.maxBeds) {
    return {
      valid: false,
      message: `Maximum ${this.maxBeds} bed(s) allowed`,
    };
  }

  return { valid: true };
};

RoomCategorySchema.methods.getFormattedPricing = function () {
  if (!this.defaultPricing) return "N/A";

  const currency = this.defaultPricing.currency || "INR";
  const rate = this.defaultPricing.perBedDailyRate || 0;

  return `${currency} ${rate.toLocaleString("en-IN")}/day`;
};

// ========== STATIC METHODS ==========
RoomCategorySchema.statics.getActiveCategories = function () {
  return this.find({ isActive: true }).sort({
    displayOrder: 1,
    categoryName: 1,
  });
};

RoomCategorySchema.statics.getCriticalCareCategories = function () {
  return this.find({
    roomType: { $in: ["ICU", "NICU", "CCU", "HDU"] },
    isActive: true,
  }).sort({ displayOrder: 1 });
};

// ========== PRE-SAVE HOOKS ==========
RoomCategorySchema.pre("save", function (next) {
  // Auto-generate category code if not provided
  if (this.isNew && !this.categoryCode) {
    this.categoryCode = this.categoryName
      .toUpperCase()
      .replace(/\s+/g, "_")
      .substring(0, 10);
  }

  // Validate bed count
  if (this.minBeds > this.maxBeds) {
    return next(new Error("Minimum beds cannot exceed maximum beds"));
  }

  next();
});

module.exports = mongoose.model("RoomCategoryModel", RoomCategorySchema);
