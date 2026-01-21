// ============================================
// TPA MODEL
// ============================================
// models/tpa/tpaModel.js
const mongoose = require("mongoose");

const TPASchema = new mongoose.Schema(
  {
    tpaName: {
      type: String,
      // required: [true, "TPAsssssssssss name is required"],
      trim: true,
    },

    tpaCode: {
      type: String,
      // required: [true, "TPA code is requiredsssssssssss"],
      unique: true,
      uppercase: true,
      trim: true,
    },
    contactPerson: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      // required: [true, "Phone number is requiredssssssss"],
      match: [/^[0-9]{10}$/, "Valid 10 digit phone number required"],
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
TPASchema.index({ tpaCode: 1 });
TPASchema.index({ isActive: 1 });
TPASchema.index({ tpaName: "text" });

module.exports = mongoose.models.TPA || mongoose.model("TPA", TPASchema);
