const mongoose = require("mongoose");

const TestResultSchema = new mongoose.Schema(
  {
    parameterName: { type: String, required: true },
    value: { type: String, required: true },
    unit: { type: String },
    normalRange: { type: String },
    isAbnormal: { type: Boolean, default: false },
    remarks: { type: String },
  },
  { _id: false },
);

const OrderItemSchema = new mongoose.Schema(
  {
    investigationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InvestigationMaster",
      required: true,
    },
    investigationCode: { type: String },
    investigationName: { type: String, required: true },
    category: { type: String },
    sampleType: { type: String },
    // LOINC code for FHIR DiagnosticReport / Observation export. Optional —
    // emitted on the bundle if present, free-text fallback otherwise.
    loincCode:    { type: String, default: "" },
    loincDisplay: { type: String, default: "" },

    // INTERNAL → hospital lab, EXTERNAL → outside lab
    performedAt: {
      type: String,
      enum: ["INTERNAL", "EXTERNAL"],
      default: "INTERNAL",
    },

    // External lab details
    externalLabName: { type: String, default: null },
    externalLabAddress: { type: String, default: null },
    externalReportRef: { type: String, default: null },

    chargedPrice: { type: Number, default: 0 },
    tariffType: {
      type: String,
      enum: ["CASH", "TPA", "CORPORATE"],
      default: "CASH",
    },
    tpaApprovedLimit: { type: Number, default: null },

    // Sample (only for INTERNAL)
    sampleStatus: {
      type: String,
      enum: ["PENDING", "COLLECTED", "RECEIVED_AT_LAB", "REJECTED", "N/A"],
      default: "PENDING",
    },
    sampleCollectedAt: { type: Date },
    sampleCollectedBy: { type: String },
    sampleBarcode: { type: String },
    rejectionReason: { type: String },

    // Result
    resultStatus: {
      type: String,
      enum: ["PENDING", "IN_PROGRESS", "COMPLETED", "VERIFIED"],
      default: "PENDING",
    },
    results: [TestResultSchema],
    interpretation: { type: String },
    resultEnteredBy: { type: String },
    resultEnteredAt: { type: Date },
    verifiedBy: { type: String },
    verifiedAt: { type: Date },

    isBilled: { type: Boolean, default: false },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PatientBill",
      default: null,
    },
  },
  { timestamps: true },
);

const InvestigationOrderSchema = new mongoose.Schema(
  {
    // Auto-generated: INV-20260319-0001
    orderNumber: { type: String, unique: true, sparse: true },

    // Source
    prescriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Prescription",
      default: null,
    },

    // Patient — required
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: [true, "Patient ID is required"],
    },
    UHID: {
      type: String,
      required: [true, "UHID is required"],
      trim: true,
      uppercase: true,
    },
    patientName: { type: String },
    contactNumber: { type: String },

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

    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      default: null,
    },
    doctorName: { type: String },
    doctorNote: { type: String },

    orderedBy: {
      type: String,
      enum: ["DOCTOR", "COUNTER", "WALKIN"],
      default: "DOCTOR",
    },

    paymentType: {
      type: String,
      enum: ["CASH", "TPA", "CORPORATE"],
      default: "CASH",
    },
    tpaId: { type: mongoose.Schema.Types.ObjectId, ref: "TPA", default: null },
    tpaName: { type: String, default: null },

    items: [OrderItemSchema],

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

    priority: {
      type: String,
      enum: ["ROUTINE", "URGENT", "STAT"],
      default: "ROUTINE",
    },

    totalAmount: { type: Number, default: 0 },
    internalTestsCount: { type: Number, default: 0 },
    externalTestsCount: { type: Number, default: 0 },

    isBilled: { type: Boolean, default: false },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PatientBill",
      default: null,
    },

    reportPrintedAt: { type: Date },
    reportPrintedBy: { type: String },

    actionLog: [
      {
        action: { type: String },
        performedBy: { type: String },
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

// Atomic order number via shared Counter.
const { nextSequence: nextSeqInv } = require("../../utils/counter");

// Auto order number + totals
InvestigationOrderSchema.pre("save", async function (next) {
  if (!this.orderNumber) {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const seq     = await nextSeqInv(`investigation:${dateStr}`);
    this.orderNumber = `INV-${dateStr}-${String(seq).padStart(4, "0")}`;
  }

  this.totalAmount = this.items.reduce((s, i) => s + (i.chargedPrice || 0), 0);
  this.internalTestsCount = this.items.filter(
    (i) => i.performedAt === "INTERNAL",
  ).length;
  this.externalTestsCount = this.items.filter(
    (i) => i.performedAt === "EXTERNAL",
  ).length;

  next();
});

InvestigationOrderSchema.index({ UHID: 1 });
InvestigationOrderSchema.index({ orderStatus: 1 });
InvestigationOrderSchema.index({ prescriptionId: 1 });
InvestigationOrderSchema.index({ createdAt: -1 });

module.exports =
  mongoose.models.InvestigationOrder ||
  mongoose.model("InvestigationOrder", InvestigationOrderSchema);
