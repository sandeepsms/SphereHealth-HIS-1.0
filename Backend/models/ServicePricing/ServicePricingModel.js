const mongoose = require("mongoose");

// ═══════════════════════════════════════════════════════════════
// SERVICE PRICING MODEL
// Ek hi service ke liye multiple tariffs:
//
//   CASH      → Normal cash patient rate
//   TPA       → Insurance patient rate (per TPA company)
//   CORPORATE → Corporate empanelled patient rate
//
// Example:
//   CBC Test  CASH       = ₹500
//   CBC Test  HDFC TPA   = ₹350  (TPA approved limit ₹300 — baaki ₹50 patient pays)
//   CBC Test  STAR TPA   = ₹400
//
// Fallback: Agar TPA pricing na mile → CASH price use hoga
// ═══════════════════════════════════════════════════════════════

const ServicePricingSchema = new mongoose.Schema(
  {
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceMaster",
      required: [true, "Service reference required"],
    },

    tariffType: {
      type: String,
      required: true,
      enum: ["CASH", "TPA", "CORPORATE"],
      default: "CASH",
    },

    // Populated only when tariffType === "TPA"
    tpaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TPA",
      default: null,
    },

    corporateName: { type: String, trim: true, default: null },

    // Billed amount
    price: { type: Number, required: true, min: 0 },

    // Discount on billed price
    discount: { type: Number, default: 0, min: 0, max: 100 },

    // Auto-calculated: price - (price * discount / 100)
    finalPrice: { type: Number, required: true },

    // Max amount TPA will pay (excess is patient's responsibility)
    tpaApprovedLimit: { type: Number, default: null },

    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// ── Auto-calculate finalPrice before save ──
ServicePricingSchema.pre("save", function (next) {
  if (this.price !== undefined && this.discount !== undefined) {
    this.finalPrice = this.price - (this.price * this.discount) / 100;
  }
  next();
});

ServicePricingSchema.index({ serviceId: 1, tariffType: 1 });
ServicePricingSchema.index({ serviceId: 1, tpaId: 1 });
ServicePricingSchema.index({ tpaId: 1 });
ServicePricingSchema.index({ isActive: 1 });

// ── Static: fetch effective price with TPA → CASH fallback ──
ServicePricingSchema.statics.getPriceFor = async function (
  serviceId,
  tariffType = "CASH",
  tpaId = null,
) {
  const query = {
    serviceId,
    tariffType,
    isActive: true,
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: new Date() } }],
  };
  if (tariffType === "TPA" && tpaId) query.tpaId = tpaId;

  const pricing = await this.findOne(query).sort({ effectiveFrom: -1 });

  // Fallback to CASH if TPA-specific pricing not configured
  if (!pricing && tariffType === "TPA") {
    return this.getPriceFor(serviceId, "CASH");
  }

  return pricing;
};

module.exports =
  mongoose.models.ServicePricing ||
  mongoose.model("ServicePricing", ServicePricingSchema);
