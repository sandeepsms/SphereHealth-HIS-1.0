const mongoose = require("mongoose");
const RoomSchema = new mongoose.Schema(
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
    ward: { type: mongoose.Schema.Types.ObjectId, ref: "Ward", required: true },
    wardName: String,
    wardCode: String,
    roomNumber: { type: String, required: true },
    roomCode: { type: String, required: true, unique: true, uppercase: true },
    totalBeds: { type: Number, required: true, min: 1 },
    bedRange: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// RoomSchema.index({ ward: 1 });
// RoomSchema.index({ roomCode: 1 });
module.exports = mongoose.model("Room", RoomSchema);
