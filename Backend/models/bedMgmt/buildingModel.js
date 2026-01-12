const mongoose = require("mongoose");

const BuildingSchema = new mongoose.Schema(
  {
    buildingName: { type: String, required: true, unique: true, trim: true },
    buildingCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    totalFloors: { type: Number, required: true, min: 1 },
    floors: [{ floorNumber: String, floorName: String }],
    address: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

// BuildingSchema.index({ buildingCode: 1 });
// BuildingSchema.index({ isActive: 1 });

module.exports = mongoose.model("Building", BuildingSchema);
