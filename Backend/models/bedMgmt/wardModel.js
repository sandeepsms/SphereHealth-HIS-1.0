const mongoose = require("mongoose");
const WardSchema = new mongoose.Schema(
  {
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
    floorName: String,
    wardName: { type: String, required: true, trim: true },
    wardCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    wardType: {
      type: String,
      enum: [
        "ICU",
        "Private",
        "Semi-Private",
        "General",
        "Emergency",
        "Male Ward",
        "Female Ward",
        "Pediatric",
      ],
    },
    totalRooms: { type: Number, default: 0, min: 0 },
    totalBeds: { type: Number, required: true, min: 1 },
    hourlyCharge: { type: Number, default: 0 },
    dailyCharge: { type: Number, default: 0 },
    facilities: [String],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// WardSchema.index({ building: 1, floor: 1 });
// WardSchema.index({ wardCode: 1 });
module.exports = mongoose.model("Ward", WardSchema);
