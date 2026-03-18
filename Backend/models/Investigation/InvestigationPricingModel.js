const mongoose = require("mongoose");

// ═══════════════════════════════════════════════════════════════
// INVESTIGATION PRICING MODEL
// Per investigation, per tariff type pricing
//
// Hierarchy (highest priority first):
//   1. Doctor override   — specific patient ke liye doctor ne set kiya
//   2. TPA pricing       — TPA patient ke liye
//   3. CASH pricing      — default (auto-created from defaultPrice)
//
// Fallback: TPA → CASH
// ═══════════════════════════════════════════════════════════════

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

    // Only for TPA tariff
    tpaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TPA",
      default: null,
    },

    corporateName: { type: String, trim: true, default: null },

    price: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0, max: 100 },
    finalPrice: { type: Number, required: true },

    // Max TPA will pay — excess is patient's responsibility
    tpaApprovedLimit: { type: Number, default: null },

    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// ── Auto-calculate finalPrice before save ──
InvestigationPricingSchema.pre("save", function (next) {
  if (this.price !== undefined && this.discount !== undefined) {
    this.finalPrice = this.price - (this.price * this.discount) / 100;
  }
  next();
});

InvestigationPricingSchema.index({ investigationId: 1, tariffType: 1 });
InvestigationPricingSchema.index({ investigationId: 1, tpaId: 1 });
InvestigationPricingSchema.index({ isActive: 1 });

// ── Static: fetch effective price with TPA → CASH fallback ──
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

  // Fallback to CASH if TPA-specific pricing not found
  if (!pricing && tariffType === "TPA") {
    return this.getPriceFor(investigationId, "CASH");
  }

  return pricing;
};

module.exports =
  mongoose.models.InvestigationPricing ||
  mongoose.model("InvestigationPricing", InvestigationPricingSchema);
