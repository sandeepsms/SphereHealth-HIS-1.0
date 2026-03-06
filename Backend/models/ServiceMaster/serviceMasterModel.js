const mongoose = require("mongoose");

// ═══════════════════════════════════════════════════════════════
// SERVICE MASTER MODEL
// Hospital ki sabhi services ka master catalog
// OPD, IPD, Daycare, Emergency — sab yahan registered hote hain
// serviceCode unique hai: IPD-RM-001, OPD-CON-001, ER-PRC-001
// ═══════════════════════════════════════════════════════════════

const ServiceMasterSchema = new mongoose.Schema(
  {
    serviceCode: {
      type: String,
      required: [true, "Service code required"],
      unique: true,
      uppercase: true,
      trim: true,
    },
    serviceName: {
      type: String,
      required: [true, "Service name required"],
      trim: true,
    },

    // IPD / OPD / EMERGENCY / DAYCARE / COMMON
    domain: {
      type: String,
      required: true,
      enum: ["IPD", "OPD", "EMERGENCY", "DAYCARE", "COMMON"],
      default: "COMMON",
    },

    // Functional category
    category: {
      type: String,
      required: true,
      enum: [
        "REGISTRATION",
        "ROOM",
        "DOCTOR",
        "NURSING",
        "PROCEDURE",
        "OT",
        "ICU",
        "SUPPORT",
        "DISCHARGE",
        "PACKAGE",
        "CONSULTATION",
        "DAYCARE",
        "OTHER",
      ],
    },

    subCategory: { type: String, trim: true },

    // Where this service can be billed
    applicableTo: {
      type: [String],
      enum: ["OPD", "IPD", "DAYCARE", "EMERGENCY", "ALL"],
      default: ["ALL"],
    },

    // How the service is charged
    billingType: {
      type: String,
      required: true,
      enum: [
        "ONE_TIME",
        "PER_DAY",
        "PER_HOUR",
        "PER_VISIT",
        "PER_SESSION",
        "PER_PROCEDURE",
        "PER_UNIT",
      ],
    },

    // Base price (overridden by ServicePricing tariffs)
    defaultPrice: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    // Room rent, nursing → auto-added daily for IPD admissions
    isAutoCharged: { type: Boolean, default: false },

    isTaxable: { type: Boolean, default: false },
    taxPercentage: { type: Number, default: 0, min: 0, max: 28 },

    availableForTPA: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 999 },
    isActive: { type: Boolean, default: true },
    description: { type: String, trim: true },

    // Short label shown in UI: "per day", "per visit", "per hour"
    unitLabel: { type: String, trim: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

ServiceMasterSchema.index({ serviceCode: 1 });
ServiceMasterSchema.index({ category: 1 });
ServiceMasterSchema.index({ domain: 1 });
ServiceMasterSchema.index({ applicableTo: 1 });
ServiceMasterSchema.index({ isActive: 1 });
ServiceMasterSchema.index({ isAutoCharged: 1 });
ServiceMasterSchema.index({ serviceName: "text", serviceCode: "text" });

module.exports =
  mongoose.models.ServiceMaster ||
  mongoose.model("ServiceMaster", ServiceMasterSchema);
