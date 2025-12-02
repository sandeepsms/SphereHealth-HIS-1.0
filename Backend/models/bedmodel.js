const mongoose = require("mongoose");
const bedSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    ward: String,
    type: { type: String, default: "General" },
    status: {
      type: String,
      enum: ["available", "occupied", "maintenance"],
      default: "available",
    },
    patient: {
      name: String,
      age: Number,
    },
    notes: String,
    floor: {
      type: String,
      required: true,
    },

    hourlyCharge: { type: Number, default: 0 },
    transfer: { String },
    TotalCharge: { type: Number, default: 0 },

    // ✅ ADD THIS FIELD
    patientUHID: { type: String, default: null },
    startingTime: { type: Date, default: null },
  },
  { timestamps: true }
);
module.exports = mongoose.model("Bed", bedSchema);
