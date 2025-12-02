const mongoose = require("mongoose");

const FloorSchema = new mongoose.Schema(
  {
    building: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Building",
      required: true,
    },
    buildingName: String,
    floorNumber: { type: String, required: true },
    floorName: { type: String, required: true, trim: true },
    totalWards: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

FloorSchema.index({ building: 1, floorNumber: 1 });
module.exports = mongoose.model("Floor", FloorSchema);
