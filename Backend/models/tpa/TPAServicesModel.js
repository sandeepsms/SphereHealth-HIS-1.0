const mongoose = require("mongoose");

const ServiceSchema = new mongoose.Schema(
  {
    tpaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TPA",
      required: true,
    },
    services: [
      {
        Name: {
          type: String,
          required: [true, "Service name is required"],
          trim: true,
        },
        serviceType: {
          type: String,
          enum: ["fixed", "quantity", "hourly"],
          default: "fixed",
          required: true,
        },
        Amount: {
          type: Number,
          required: [true, "Amount is required"],
          min: [0, "Amount must be positive"],
        },
        // FIX (audit P7-B7): the legacy cap of 20% silently rejected
        // diagnostics + radiology rate cards (commonly 30-50%). Cap raised
        // to 100 (anything above is a data-entry error, not a policy
        // violation). Use a separate `discountOverrideReason` field to
        // flag >50% rates for audit review.
        Discount: {
          type: Number,
          default: 0,
          min: [0, "Discount cannot be negative"],
          max: [100, "Discount cannot exceed 100%"],
        },
        discountOverrideReason: { type: String, default: "" },
        Totalamount: {
          type: Number,
          required: [true, "Total amount is required"],
          min: [0, "Total amount must be positive"],
        },
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

ServiceSchema.index({ tpaId: 1 });
ServiceSchema.index({ isActive: 1 });

ServiceSchema.pre("save", function (next) {
  if (this.services && this.services.length > 0) {
    this.services.forEach((item) => {
      if (item.Amount && item.Discount !== undefined) {
        // Allow up to 100% (audit P7-B7) — was capped to 20 which clipped
        // legitimate diagnostic discounts.
        const discount = Math.max(0, Math.min(item.Discount, 100));
        item.Totalamount = item.Amount - (item.Amount * discount) / 100;
      }
    });
  }
  next();
});

module.exports =
  mongoose.models.TPAServices ||
  mongoose.model("TPAServices", ServiceSchema);
