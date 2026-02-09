const mongoose = require("mongoose");

const BillingSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    UHID: {
      type: String,
      required: true,
      index: true,
    },
    patientName: {
      type: String,
      required: true,
    },
    prescription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Prescription",
    },
    tpa: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TPA",
    },
    tpaName: {
      type: String,
      default: "Normal",
    },
    tpaCode: {
      type: String,
    },
    billingType: {
      type: String,
      enum: ["OPD", "IPD", "Emergency", "Investigation"],
      required: true,
    },
    hospitalChargesRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HospitalCharges",
    },
    selectedCharges: [
      {
        chargeId: String,
        chargeName: String,
        chargeType: String,
        baseAmount: Number,
        discount: { type: Number, default: 0 },
        finalAmount: Number,
        quantity: { type: Number, default: 1 },
        perUnit: {
          type: String,
          enum: ["one time", "per day", "per visit"],
          default: "one time",
        },
        isActive: { type: Boolean, default: true },
      },
    ],
    investigations: [
      {
        serviceRef: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "TPAServices",
        },
        serviceName: String,
        baseAmount: Number,
        discount: { type: Number, default: 0 },
        finalAmount: Number,
        performedInHouse: { type: Boolean, default: true },
        outsideDetails: {
          reason: String,
          suggestedLab: String,
          estimatedCost: Number,
        },
        isActive: { type: Boolean, default: true },
      },
    ],
    additionalItems: [
      {
        description: String,
        baseAmount: Number,
        discount: { type: Number, default: 0 },
        finalAmount: Number,
      },
    ],
    financials: {
      chargesSubtotal: { type: Number, default: 0 },
      investigationsSubtotal: { type: Number, default: 0 },
      additionalSubtotal: { type: Number, default: 0 },
      subtotal: { type: Number, default: 0 },
      discountPercent: { type: Number, default: 0, min: 0, max: 100 },
      discountAmount: { type: Number, default: 0 },
      taxPercent: { type: Number, default: 0 },
      taxAmount: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      paid: { type: Number, default: 0 },
      balance: { type: Number, default: 0 },
    },
    payments: [
      {
        amount: { type: Number, required: true },
        method: {
          type: String,
          enum: ["Cash", "Card", "UPI", "NetBanking", "Cheque"],
          required: true,
        },
        transactionId: String,
        status: {
          type: String,
          enum: ["pending", "success", "failed"],
          default: "success",
        },
        paidAt: { type: Date, default: Date.now },
      },
    ],
    status: {
      type: String,
      enum: ["draft", "generated", "partial", "paid", "cancelled"],
      default: "draft",
      index: true,
    },
    billNumber: {
      type: String,
      unique: true,
      sparse: true,
    },
    generatedAt: Date,
    notes: String,
    metadata: {
      cancellationReason: String,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

BillingSchema.index({ patient: 1, createdAt: -1 });
BillingSchema.index({ billNumber: 1 });
BillingSchema.index({ status: 1 });

BillingSchema.pre("save", function (next) {
  this.financials.chargesSubtotal = this.selectedCharges
    .filter((c) => c.isActive)
    .reduce((sum, c) => sum + c.finalAmount * c.quantity, 0);

  this.financials.investigationsSubtotal = this.investigations
    .filter((i) => i.performedInHouse && i.isActive)
    .reduce((sum, i) => sum + i.finalAmount, 0);

  this.financials.additionalSubtotal = this.additionalItems.reduce(
    (sum, item) => sum + item.finalAmount,
    0,
  );

  this.financials.subtotal =
    this.financials.chargesSubtotal +
    this.financials.investigationsSubtotal +
    this.financials.additionalSubtotal;

  this.financials.discountAmount =
    (this.financials.subtotal * this.financials.discountPercent) / 100;

  const afterDiscount =
    this.financials.subtotal - this.financials.discountAmount;

  this.financials.taxAmount =
    (afterDiscount * this.financials.taxPercent) / 100;

  this.financials.total = afterDiscount + this.financials.taxAmount;

  const successfulPayments = this.payments.filter(
    (p) => p.status === "success",
  );
  this.financials.paid = successfulPayments.reduce(
    (sum, p) => sum + p.amount,
    0,
  );

  this.financials.balance = this.financials.total - this.financials.paid;

  if (this.financials.balance <= 0 && this.financials.paid > 0) {
    this.status = "paid";
  } else if (this.financials.paid > 0 && this.financials.balance > 0) {
    this.status = "partial";
  }

  next();
});

BillingSchema.methods.generateBillNumber = async function () {
  const year = new Date().getFullYear().toString().slice(-2);
  const month = String(new Date().getMonth() + 1).padStart(2, "0");

  const count = await this.constructor.countDocuments({
    createdAt: {
      $gte: new Date(new Date().getFullYear(), 0, 1),
    },
  });

  const sequence = String(count + 1).padStart(5, "0");
  this.billNumber = `BL${year}${month}${sequence}`;
  this.generatedAt = new Date();
  this.status = "generated";

  return this.billNumber;
};

BillingSchema.methods.addPayment = async function (paymentData) {
  this.payments.push({
    amount: paymentData.amount,
    method: paymentData.method,
    transactionId: paymentData.transactionId || "",
    status: paymentData.status || "success",
  });

  await this.save();
  return this;
};

BillingSchema.methods.markInvestigationExternal = function (
  investigationId,
  details,
) {
  const investigation = this.investigations.id(investigationId);
  if (!investigation) return null;

  investigation.performedInHouse = false;
  investigation.isActive = false;
  investigation.outsideDetails = {
    reason: details.reason,
    suggestedLab: details.suggestedLab,
    estimatedCost: details.estimatedCost || investigation.finalAmount,
  };

  return investigation;
};

BillingSchema.methods.cancel = function (reason) {
  if (this.status === "paid") {
    throw new Error("Cannot cancel a fully paid bill");
  }

  this.status = "cancelled";
  this.metadata.cancellationReason = reason;

  return this;
};

BillingSchema.virtual("outsideInvestigations").get(function () {
  return this.investigations
    .filter((inv) => !inv.performedInHouse)
    .map((inv) => ({
      serviceName: inv.serviceName,
      reason: inv.outsideDetails?.reason,
      suggestedLab: inv.outsideDetails?.suggestedLab,
      estimatedCost: inv.outsideDetails?.estimatedCost,
    }));
});

BillingSchema.virtual("paymentSummary").get(function () {
  const summary = {
    total: this.financials.paid,
    methods: {},
    transactions: this.payments.filter((p) => p.status === "success").length,
  };

  this.payments
    .filter((p) => p.status === "success")
    .forEach((payment) => {
      summary.methods[payment.method] =
        (summary.methods[payment.method] || 0) + payment.amount;
    });

  return summary;
});

module.exports = mongoose.model("Billing", BillingSchema);
