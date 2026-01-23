const mongoose = require("mongoose");

const ServiceSchema = new mongoose.Schema(
  {
    tpa: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TPA",
      // required: [true, "TPA reference is required"],
    },
    tpaName: {
      type: String,
      // required: [true, "TPA Name is required"],
    },
    tpaCode: {
      type: String,
      // required: [true, "TPA Code is required"],
      unique: true,
      uppercase: true,
    },
    service: [
      {
        Name: {
          type: String,
          required: [true, "Service name is required"],
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
          max: [100, "Discount cannot exceed 100%"],
        },
        Totalamount: {
          type: Number,
          required: [true, "Total amount is required"],
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

// Index for faster queries
ServiceSchema.index({ tpa: 1 });
ServiceSchema.index({ tpaCode: 1 });
ServiceSchema.index({ isActive: 1 });

// Pre-save hook to calculate total amount
ServiceSchema.pre("save", function (next) {
  if (this.service && this.service.length > 0) {
    this.service.forEach((item) => {
      if (item.Amount && item.Discount !== undefined) {
        item.Totalamount = item.Amount - (item.Amount * item.Discount) / 100;
      }
    });
  }
  next();
});

module.exports = mongoose.model("TPAServices", ServiceSchema);
