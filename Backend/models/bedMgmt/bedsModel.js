const mongoose = require("mongoose");

const BedSchema = new mongoose.Schema(
  {
    bedNumber: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },

    building: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Building",
      required: true,
    },
    buildingName: String,

    floor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Floor",
      required: true,
    },
    floorNumber: String,

    ward: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ward",
      required: true,
    },
    wardName: String,
    wardCode: String,

    // ✅ FIX: Make room required
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true, // ✅ Room is mandatory
    },
    roomNumber: String,
    roomCode: String,

    status: {
      type: String,
      enum: ["Available", "Occupied", "Maintenance", "Blocked", "Reserved"],
      default: "Available",
    },

    // ✅ Optional: Bed type for better categorization
    bedType: {
      type: String,
      enum: ["General", "ICU", "Deluxe", "Semi-Deluxe", "VIP"],
      default: "General",
    },

    // ✅ Optional: Patient reference (when occupied)
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      default: null,
    },

    // ✅ Optional: Admission reference
    admission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission",
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // ✅ Optional: Notes for maintenance or blocking
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// ✅ Compound unique index: bed number unique within room
BedSchema.index({ room: 1, bedNumber: 1 }, { unique: true });

// ✅ Index for filtering by ward and status
BedSchema.index({ ward: 1, status: 1 });

// ✅ Index for finding available beds quickly
BedSchema.index({ building: 1, floor: 1, status: 1 });

// ✅ Index for patient lookup
BedSchema.index({ patient: 1 }, { sparse: true });

module.exports = mongoose.model("Beds", BedSchema);
