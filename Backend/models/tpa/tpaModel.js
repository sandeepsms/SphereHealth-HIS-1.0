const mongoose = require("mongoose");

const roomChargeSchema = new mongoose.Schema(
  {
    roomCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RoomCategoryModel",
      required: [true, "Room category is required"],
    },
    categoryName: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
    },
    doctorVisit: {
      type: Number,
      default: 0,
      min: [0, "Doctor visit charge cannot be negative"],
      validate: {
        validator: Number.isFinite,
        message: "Doctor visit charge must be a valid number",
      },
    },
    nursingCharge: {
      type: Number,
      default: 0,
      min: [0, "Nursing charge cannot be negative"],
      validate: {
        validator: Number.isFinite,
        message: "Nursing charge must be a valid number",
      },
    },
    roomRent: {
      type: Number,
      default: 0,
      min: [0, "Room rent cannot be negative"],
      validate: {
        validator: Number.isFinite,
        message: "Room rent must be a valid number",
      },
    },
    rmoCharge: {
      type: Number,
      default: 0,
      min: [0, "RMO charge cannot be negative"],
      validate: {
        validator: Number.isFinite,
        message: "RMO charge must be a valid number",
      },
    },
  },
  { _id: false },
);

const TPASchema = new mongoose.Schema(
  {
    tpaName: {
      type: String,
      required: [true, "TPA name is required"],
      trim: true,
      minlength: [2, "TPA name must be at least 2 characters"],
      maxlength: [100, "TPA name cannot exceed 100 characters"],
    },
    tpaCode: {
      type: String,
      required: [true, "TPA code is required"],
      // Uniqueness enforced via partial index at bottom — only across
      // ACTIVE TPAs, so soft-deleted codes can be re-issued.
      uppercase: true,
      trim: true,
      minlength: [2, "TPA code must be at least 2 characters"],
      maxlength: [20, "TPA code cannot exceed 20 characters"],
      match: [
        /^[A-Z0-9_-]+$/,
        "TPA code can only contain uppercase letters, numbers, hyphens and underscores",
      ],
    },
    contactPerson: {
      type: String,
      trim: true,
      maxlength: [100, "Contact person name cannot exceed 100 characters"],
    },
    phone: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          return !v || /^[6-9]\d{9}$/.test(v);
        },
        message: "Please provide a valid 10-digit Indian phone number",
      },
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      validate: {
        validator: function (v) {
          return !v || /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/.test(v);
        },
        message: "Please provide a valid email address",
      },
    },
    address: {
      type: String,
      trim: true,
      maxlength: [500, "Address cannot exceed 500 characters"],
    },
    roomCharges: {
      type: [roomChargeSchema],
      validate: {
        validator: function (v) {
          // Check for duplicate room categories
          const categoryIds = v.map((rc) => rc.roomCategory.toString());
          return categoryIds.length === new Set(categoryIds).size;
        },
        message: "Duplicate room categories are not allowed",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes for better query performance
TPASchema.index({ isActive: 1 });
TPASchema.index({ tpaName: 1 });
TPASchema.index({ "roomCharges.roomCategory": 1 });
// Partial unique on tpaCode — only across ACTIVE TPAs (Audit-Pass-7 fix).
TPASchema.index(
  { tpaCode: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

// Pre-save middleware to ensure tpaCode is uppercase
TPASchema.pre("save", function (next) {
  if (this.tpaCode) {
    this.tpaCode = this.tpaCode.toUpperCase().trim();
  }
  next();
});

// Virtual for total room categories
TPASchema.virtual("totalRoomCategories").get(function () {
  return this.roomCharges?.length || 0;
});

// Instance method to get charges for a specific room category
TPASchema.methods.getRoomCharges = function (roomCategoryId) {
  return this.roomCharges.find(
    (rc) => rc.roomCategory.toString() === roomCategoryId.toString(),
  );
};

// Instance method to calculate total daily charge for a room
TPASchema.methods.calculateDailyTotal = function (roomCategoryId) {
  const charges = this.getRoomCharges(roomCategoryId);
  if (!charges) return 0;

  return (
    (charges.doctorVisit || 0) +
    (charges.nursingCharge || 0) +
    (charges.roomRent || 0) +
    (charges.rmoCharge || 0)
  );
};

// Static method to find active TPAs
TPASchema.statics.findActive = function () {
  return this.find({ isActive: true }).populate("roomCharges.roomCategory");
};

// Static method to find TPA by code
TPASchema.statics.findByCode = function (code) {
  return this.findOne({ tpaCode: code.toUpperCase() }).populate(
    "roomCharges.roomCategory",
  );
};

module.exports = mongoose.models.TPA || mongoose.model("TPA", TPASchema);
