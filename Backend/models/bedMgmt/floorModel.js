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

// FIX (audit P7-B1): partial unique on (building, floorNumber) for active
// floors. Without this, two operators creating "Floor 3" on the same building
// from different terminals produce duplicates that confuse Room creation
// downstream (which floor does Room 301 belong to?). Soft-deleted floors
// remain re-creatable thanks to the partial filter. (This index supersedes
// the plain non-unique one — only one index declaration per key set is
// permitted by Mongoose.)
FloorSchema.index(
  { building: 1, floorNumber: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);
module.exports = mongoose.models.Floor || mongoose.model("Floor", FloorSchema);
