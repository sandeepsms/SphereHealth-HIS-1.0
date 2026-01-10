const mongoose = require("mongoose");

const BillingSchema = new mongoose.Schema(
  {
    billNumber: {
      type: String,
      unique: true,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    admission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission",
      required: true,
    },
    admissionDate: Date,
    dischargeDate: Date,
    totalDays: {
      type: Number,
      default: 1,
    },
    bedCharges: {
      type: Number,
      default: 0,
    },
    additionalServices: [
      {
        serviceName: String,
        quantity: {
          type: Number,
          default: 1,
        },
        pricePerUnit: Number,
        total: Number,
        addedDate: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    investigations: [
      {
        investigationName: String,
        charges: Number,
        performedDate: Date,
      },
    ],
    medications: [
      {
        medicationName: String,
        quantity: Number,
        pricePerUnit: Number,
        total: Number,
      },
    ],
    procedures: [
      {
        procedureName: String,
        charges: Number,
        performedDate: Date,
      },
    ],
    subtotal: {
      type: Number,
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
    },
    tax: {
      type: Number,
      default: 0,
    },
    grandTotal: {
      type: Number,
      default: 0,
    },
    totalPaid: {
      type: Number,
      default: 0,
    },
    balanceDue: {
      type: Number,
      default: 0,
    },
    payments: [
      {
        amount: Number,
        paymentMethod: {
          type: String,
          enum: ["Cash", "Card", "UPI", "Net Banking"],
        },
        paymentDate: {
          type: Date,
          default: Date.now,
        },
        transactionId: String,
      },
    ],
    billStatus: {
      type: String,
      enum: ["Draft", "Paid", "Cancelled"],
      default: "Draft",
    },
    generatedDate: Date,
  },
  {
    timestamps: true,
  }
);

BillingSchema.index({ billNumber: 1 });
BillingSchema.index({ patient: 1 });
BillingSchema.index({ admission: 1 });

BillingSchema.pre("save", async function (next) {
  if (this.isNew && !this.billNumber) {
    const count = await mongoose.model("Billing").countDocuments();
    const year = new Date().getFullYear();
    this.billNumber = `BILL-${year}-${String(count + 1).padStart(6, "0")}`;
  }
  next();
});

BillingSchema.methods.recalculateTotals = function () {
  const servicesTotal = this.additionalServices.reduce(
    (sum, s) => sum + (s.total || 0),
    0
  );
  const investigationsTotal = this.investigations.reduce(
    (sum, i) => sum + (i.charges || 0),
    0
  );
  const medicationsTotal = this.medications.reduce(
    (sum, m) => sum + (m.total || 0),
    0
  );
  const proceduresTotal = this.procedures.reduce(
    (sum, p) => sum + (p.charges || 0),
    0
  );

  this.subtotal =
    this.bedCharges +
    servicesTotal +
    investigationsTotal +
    medicationsTotal +
    proceduresTotal;

  const discountedAmount = this.subtotal - (this.discount || 0);
  this.tax = (discountedAmount * 5) / 100;
  this.grandTotal = discountedAmount + this.tax;
  this.balanceDue = this.grandTotal - (this.totalPaid || 0);

  if (this.balanceDue <= 0) {
    this.billStatus = "Paid";
  }

  return this;
};

BillingSchema.methods.addPayment = function (paymentDetails) {
  this.payments.push(paymentDetails);
  this.totalPaid = this.payments.reduce(
    (sum, payment) => sum + payment.amount,
    0
  );
  this.balanceDue = this.grandTotal - this.totalPaid;

  if (this.balanceDue <= 0) {
    this.billStatus = "Paid";
  }

  return this;
};

module.exports = mongoose.model("Billing", BillingSchema);
