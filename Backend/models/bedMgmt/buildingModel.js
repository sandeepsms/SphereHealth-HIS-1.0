const mongoose = require("mongoose");

const BuildingSchema = new mongoose.Schema(
  {
    // Uniqueness enforced via partial indexes below — only across ACTIVE
    // buildings, so soft-deleted ones can be re-created.
    buildingName: { type: String, required: true, trim: true },
    buildingCode: {
      type: String,
      required: true,
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

BuildingSchema.index(
  { buildingCode: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);
BuildingSchema.index(
  { buildingName: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
);

module.exports =
  mongoose.models.Building ||
  mongoose.model("Building", BuildingSchema);
