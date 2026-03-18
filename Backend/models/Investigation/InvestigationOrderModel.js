const mongoose = require("mongoose");

// ═══════════════════════════════════════════════════════════════
// INVESTIGATION ORDER MODEL
// Real hospital workflow:
//   1. Doctor ya counter se order create hota hai
//   2. Sample collect hota hai
//   3. Lab report enter karta hai
//   4. Report print hoti hai
//   5. Billing mein charge add hota hai
// ═══════════════════════════════════════════════════════════════

// ── Single test result schema ──────────────────────────────────
const TestResultSchema = new mongoose.Schema(
  {
    parameterName: { type: String, required: true }, // e.g. "Haemoglobin"
    value: { type: String, required: true }, // e.g. "12.5"
    unit: { type: String }, // e.g. "g/dL"
    normalRange: { type: String }, // e.g. "13.0 - 17.0"
    isAbnormal: { type: Boolean, default: false },
    remarks: { type: String },
  },
  { _id: false },
);

// ── Per-test item in an order ──────────────────────────────────
const OrderItemSchema = new mongoose.Schema(
  {
    investigationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvestigationMaster",
      required: true,
    },
    investigationCode: { type: String, required: true },
    investigationName: { type: String, required: true },
    category: { type: String },
    sampleType: { type: String },

    // Pricing at time of order
    chargedPrice: { type: Number, required: true, default: 0 },
    tariffType: {
      type: String,
      enum: ["CASH", "TPA", "CORPORATE"],
      default: "CASH",
    },
    tpaApprovedLimit: { type: Number, default: null },

    // Sample tracking
    sampleStatus: {
      type: String,
      enum: ["PENDING", "COLLECTED", "RECEIVED_AT_LAB", "REJECTED"],
      default: "PENDING",
    },
    sampleCollectedAt: { type: Date },
    sampleCollectedBy: { type: String },
    sampleBarcode: { type: String },
    rejectionReason: { type: String },

    // Result / report
    resultStatus: {
      type: String,
      enum: ["PENDING", "IN_PROGRESS", "COMPLETED", "VERIFIED"],
      default: "PENDING",
    },
    results: [TestResultSchema],
    interpretation: { type: String }, // Doctor ki overall comments
    resultEnteredBy: { type: String },
    resultEnteredAt: { type: Date },
    verifiedBy: { type: String }, // Senior Lab person
    verifiedAt: { type: Date },

    // Billing
    isBilled: { type: Boolean, default: false },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PatientBill",
      default: null,
    },
  },
  { timestamps: true },
);

// ── Main Order Schema ──────────────────────────────────────────
const InvestigationOrderSchema = new mongoose.Schema(
  {
    // Auto-generated order number: INV-20260316-0001
    orderNumber: {
      type: String,
      unique: true,
      sparse: true,
    },

    // Patient
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    UHID: { type: String, required: true, trim: true },
    patientName: { type: String },
    contactNumber: { type: String },

    // Visit context
    visitType: {
      type: String,
      enum: ["OPD", "IPD", "DAYCARE", "EMERGENCY", "WALKIN"],
      default: "OPD",
    },
    admissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission",
      default: null,
    },
    opdVisitId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // Ordering doctor
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      default: null,
    },
    doctorName: { type: String },
    doctorNote: { type: String }, // Clinical notes / reason for test

    // Order source
    orderedBy: {
      type: String,
      enum: ["DOCTOR", "COUNTER", "WALKIN"],
      default: "DOCTOR",
    },

    // Payment
    paymentType: {
      type: String,
      enum: ["CASH", "TPA", "CORPORATE"],
      default: "CASH",
    },
    tpaId: { type: mongoose.Schema.Types.ObjectId, ref: "TPA", default: null },
    tpaName: { type: String, default: null },

    // Tests in this order
    items: [OrderItemSchema],

    // Order-level status
    orderStatus: {
      type: String,
      enum: [
        "PENDING",
        "SAMPLE_COLLECTED",
        "IN_PROGRESS",
        "COMPLETED",
        "CANCELLED",
      ],
      default: "PENDING",
    },

    // Priority
    priority: {
      type: String,
      enum: ["ROUTINE", "URGENT", "STAT"],
      default: "ROUTINE",
    },

    // Billing
    totalAmount: { type: Number, default: 0 },
    isBilled: { type: Boolean, default: false },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PatientBill",
      default: null,
    },

    // Report
    reportPrintedAt: { type: Date },
    reportPrintedBy: { type: String },

    // ── Lab Staff Assignment ──────────────────────────────────
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LabStaff",
      default: null,
    },
    assignedAt: { type: Date },
    assignedBy: { type: String },

    // ── Action Log — har action ka record ────────────────────
    actionLog: [
      {
        action: { type: String },
        performedBy: { type: String },
        staffId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "LabStaff",
          default: null,
        },
        performedAt: { type: Date, default: Date.now },
        remarks: { type: String },
      },
    ],

    notes: { type: String },
    cancelledAt: { type: Date },
    cancelledBy: { type: String },
    cancellationReason: { type: String },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ── Virtual: overall result status ────────────────────────────
InvestigationOrderSchema.virtual("overallResultStatus").get(function () {
  if (!this.items || this.items.length === 0) return "PENDING";
  const statuses = this.items.map((i) => i.resultStatus);
  if (statuses.every((s) => s === "VERIFIED")) return "VERIFIED";
  if (statuses.every((s) => s === "COMPLETED" || s === "VERIFIED"))
    return "COMPLETED";
  if (statuses.some((s) => s === "IN_PROGRESS")) return "IN_PROGRESS";
  return "PENDING";
});

// ── Auto order number ──────────────────────────────────────────
InvestigationOrderSchema.pre("save", async function (next) {
  if (!this.orderNumber) {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
    const prefix = `INV-${dateStr}-`;
    const count = await mongoose.model("InvestigationOrder").countDocuments({
      orderNumber: { $regex: `^${prefix}` },
    });
    this.orderNumber = `${prefix}${String(count + 1).padStart(4, "0")}`;
  }

  // Auto-calculate totalAmount
  this.totalAmount = this.items.reduce(
    (sum, i) => sum + (i.chargedPrice || 0),
    0,
  );

  // Auto-update orderStatus based on items
  if (this.items.length > 0) {
    const sampleStatuses = this.items.map((i) => i.sampleStatus);
    const resultStatuses = this.items.map((i) => i.resultStatus);

    if (resultStatuses.every((s) => s === "VERIFIED" || s === "COMPLETED")) {
      this.orderStatus = "COMPLETED";
    } else if (resultStatuses.some((s) => s === "IN_PROGRESS")) {
      this.orderStatus = "IN_PROGRESS";
    } else if (
      sampleStatuses.some((s) => s === "COLLECTED" || s === "RECEIVED_AT_LAB")
    ) {
      this.orderStatus = "SAMPLE_COLLECTED";
    }
  }

  next();
});

InvestigationOrderSchema.index({ UHID: 1 });
InvestigationOrderSchema.index({ orderNumber: 1 });
InvestigationOrderSchema.index({ orderStatus: 1 });
InvestigationOrderSchema.index({ doctorId: 1 });
InvestigationOrderSchema.index({ createdAt: -1 });
InvestigationOrderSchema.index({ "items.resultStatus": 1 });

module.exports =
  mongoose.models.InvestigationOrder ||
  mongoose.model("InvestigationOrder", InvestigationOrderSchema);
