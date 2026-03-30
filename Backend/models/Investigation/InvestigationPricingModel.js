const mongoose = require("mongoose");

// Pricing per investigation per tariff:
//   CASH      → all patients (auto-created from defaultPrice)
//   TPA       → per TPA company (auto-created for all TPAs)
//   CORPORATE → corporate patients
//
// Fallback: TPA → CASH

const InvestigationPricingSchema = new mongoose.Schema(
  {
    investigationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvestigationMaster",
      required: true,
    },

    tariffType: {
      type: String,
      required: true,
      enum: ["CASH", "TPA", "CORPORATE"],
      default: "CASH",
    },

    tpaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TPA",
      default: null,
    },

    tpaName: {
      type: String,
      default: null,
    },

    corporateName: {
      type: String,
      default: null,
    },

    price: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0, max: 100 },
    finalPrice: { type: Number, required: true },

    // Max TPA will pay — patient pays the rest
    tpaApprovedLimit: { type: Number, default: null },

    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Auto-calculate finalPrice before save
InvestigationPricingSchema.pre("save", function (next) {
  this.finalPrice = this.price - (this.price * (this.discount || 0)) / 100;
  next();
});

// Static: get effective price with TPA → CASH fallback
InvestigationPricingSchema.statics.getPriceFor = async function (
  investigationId,
  tariffType = "CASH",
  tpaId = null,
) {
  const query = {
    investigationId,
    tariffType,
    isActive: true,
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: new Date() } }],
  };
  if (tariffType === "TPA" && tpaId) query.tpaId = tpaId;

  const pricing = await this.findOne(query).sort({ effectiveFrom: -1 });

  // Fallback to CASH
  if (!pricing && tariffType === "TPA") {
    return this.getPriceFor(investigationId, "CASH");
  }

  return pricing;
};

InvestigationPricingSchema.index({ investigationId: 1, tariffType: 1 });
InvestigationPricingSchema.index({ investigationId: 1, tpaId: 1 });
InvestigationPricingSchema.index({ isActive: 1 });

module.exports =
  mongoose.models.InvestigationPricing ||
  mongoose.model("InvestigationPricing", InvestigationPricingSchema);
