const mongoose = require("mongoose");

const HospitalChargesSchema = new mongoose.Schema(
  {
    tpa: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TPA",
    },
    tpaName: {
      type: String,
      required: true,
    },
    tpaCode: {
      type: String,
      required: true,
      uppercase: true,
    },

    // Hospital Charges Array
    charges: [
      {
        chargeName: {
          type: String,
          required: true,
        },
        chargeType: {
          type: String,
          enum: [
            "OPD",
            "IPD_BED",
            "ICU_BED",
            "EMERGENCY",
            "NURSE",
            "DOCTOR_VISIT",
            "OPERATION_THEATER",
            "AMBULANCE",
            "DRESSING",
            "INJECTION",
            "OTHER",
          ],
          required: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
        discount: {
          type: Number,
          default: 0,
          min: 0,
          max: 100,
        },
        totalAmount: {
          type: Number,
          required: true,
        },
        perUnit: {
          type: String,
          enum: ["one time", "per day", "per visit"],
          default: "one time",
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

HospitalChargesSchema.pre("save", function (next) {
  if (this.charges && this.charges.length > 0) {
    this.charges.forEach((charge) => {
      charge.totalAmount =
        charge.amount - (charge.amount * charge.discount) / 100;
    });
  }
  next();
});

module.exports = mongoose.model("HospitalCharges", HospitalChargesSchema);
