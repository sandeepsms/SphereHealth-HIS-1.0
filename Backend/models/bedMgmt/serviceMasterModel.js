// models/bedMgmt/serviceMasterModel.js
const mongoose = require("mongoose");

const ServiceMasterSchema = new mongoose.Schema(
  {
    serviceName: {
      type: String,
      required: [true, "Service name is required"],
      unique: true,
      trim: true,
    },

    serviceCode: {
      type: String,
      required: [true, "Service code is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
    },

    category: {
      type: String,
      enum: [
        "Room Facilities",
        "Medical Equipment",
        "Nursing Services",
        "Consultation",
        "Laboratory",
        "Radiology",
        "Procedures",
        "Surgery",
        "Pharmacy",
        "Dietary",
        "Other Services",
      ],
      required: true,
    },

    basePrice: {
      type: Number,
      required: [true, "Base price is required"],
      min: 0,
    },

    unit: {
      type: String,
      enum: ["Per Day", "Per Hour", "Per Session", "Per Unit", "One-time"],
      default: "Per Day",
    },

    taxRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    isSystemService: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

ServiceMasterSchema.index({ serviceCode: 1 });
ServiceMasterSchema.index({ category: 1, isActive: 1 });

module.exports = mongoose.model("ServiceMaster", ServiceMasterSchema);
