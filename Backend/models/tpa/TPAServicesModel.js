const mongoose = require("mongoose");

const ServiceSchema = new mongoose.Schema(
  {
    tpa: {
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
        Discount: {
          type: Number,
          default: 0,
          min: [0, "Discount cannot be negative"],
          max: [20, "Discount cannot exceed 20%"],
        },
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

// ✅ Indexes
ServiceSchema.index({ tpa: 1 });
ServiceSchema.index({ isActive: 1 });

ServiceSchema.pre("save", function (next) {
  if (this.services && this.services.length > 0) {
    this.services.forEach((item) => {
      if (item.Amount && item.Discount !== undefined) {
        const discount = Math.min(item.Discount, 20);
        item.Totalamount = item.Amount - (item.Amount * discount) / 100;
      }
    });
  }
  next();
});

module.exports = mongoose.model("TPAServices", ServiceSchema);
