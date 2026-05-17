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

    // ── AI Billing Intelligence ──────────────────────────────────
    // Searchable keywords for AI charge matching
    // e.g. ["diabetes", "blood sugar", "BSL", "DM"]
    aiTags: { type: [String], default: [] },

    // Who can add this service to a bill
    chargeableBy: {
      type: [String],
      enum: ["Doctor", "Nurse", "Lab", "Radiology", "Reception", "Auto"],
      default: ["Doctor", "Reception"],
    },

    // Functional service type for AI categorisation
    serviceType: {
      type: String,
      enum: [
        "consultation",
        "room",
        "nursing",
        "procedure",
        "investigation",
        "radiology",
        "package",
        "ot",
        "icu",
        "medicine",
        "consumable",
        "other",
      ],
      default: "other",
    },

    // ── ANH tariff: 3-tier package pricing ─────────────────────────
    // Packages (surgical / medical-management) and room-tier rates
    // come from the hospital's published rate card with three columns:
    //   General Ward / Twin-Sharing (Semi-Private) / Private (Deluxe / ICU)
    // The patient's admitted room category picks the tier; CASH default
    // uses generalWard. Fields are optional — only populated for rows
    // imported from the tariff workbook.
    tierPricing: {
      generalWard: { type: Number, min: 0 },   // lowest tier (CASH default)
      semiPrivate: { type: Number, min: 0 },   // middle tier
      private:     { type: Number, min: 0 },   // top tier (also ICU/Deluxe)
    },

    // Free-text from the tariff workbook — what's included / excluded
    // in this package. Surfaced on the bill so receptionists and TPA
    // reviewers see exactly what the package covers.
    inclusions: { type: String, trim: true },
    exclusions: { type: String, trim: true },

    // Cap on admission length the package covers (MMP packages = 3 days).
    // Auto-billing uses this to know when to switch from package PER_DAY
    // to non-package per-day room + nursing accrual.
    maxLOSDays: { type: Number, min: 0 },

    // Diagnosis / procedure keywords used to match a package to a new
    // admission. e.g. ["bronchitis","wheeze","cough"] for MMP-2
    // (Acute Bronchitis). Free-form — supplied during import.
    diagnosisTags: { type: [String], default: [] },

    // Speciality / department the package belongs to — e.g. "Cardiology",
    // "ENT", "General Surgery". Helps UI grouping and report filters.
    speciality: { type: String, trim: true },

    // Tariff package code from the source workbook (ABHI / ANH /
    // hospital-specific). Lets us track which catalog version a row
    // came from for audit and future re-imports.
    tariffSource: { type: String, trim: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

ServiceMasterSchema.index({ category: 1 });
ServiceMasterSchema.index({ domain: 1 });
ServiceMasterSchema.index({ applicableTo: 1 });
ServiceMasterSchema.index({ isActive: 1 });
ServiceMasterSchema.index({ isAutoCharged: 1 });
ServiceMasterSchema.index({ serviceName: "text", serviceCode: "text" });

module.exports =
  mongoose.models.ServiceMaster ||
  mongoose.model("ServiceMaster", ServiceMasterSchema);
