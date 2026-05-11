const mongoose = require("mongoose");

// ═══════════════════════════════════════════════════════════════
// PATIENT BILL MODEL
// OPD / IPD / Daycare / Emergency — sab ke liye ek model
// Primary lookup: UHID (patient ka unique ID)
//
// TPA split billing:
//   netAmount = tpaPayableAmount + patientPayableAmount
//   TPA portion → tpaClaimStatus track hota hai
//   Patient portion → normal payments mein aata hai
//
// Bill lifecycle:
//   DRAFT → GENERATED → PARTIAL → PAID
//                     ↘ CANCELLED / REFUNDED
// ═══════════════════════════════════════════════════════════════

// ── Individual bill line item ──────────────────────────────────
const BillItemSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: "ServiceMaster" },
    serviceCode: { type: String, trim: true },
    serviceName: { type: String, required: true, trim: true },
    category: { type: String, trim: true },
    billingType: {
      type: String,
      enum: [
        "ONE_TIME",
        "PER_DAY",
        "PER_HOUR",
        "PER_VISIT",
        "PER_SESSION",
        "PER_PROCEDURE",
        "PER_UNIT",
      ] },
    quantity: { type: Number, default: 1, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    grossAmount: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    discountAmount: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },

    // TPA split (filled only when paymentType === TPA)
    tpaPayableAmount: { type: Number, default: 0 },
    patientPayableAmount: { type: Number, default: 0 },

    // Tax
    isTaxable: { type: Boolean, default: false },
    taxPercent: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },

    appliedTariff: {
      type: String,
      enum: ["CASH", "TPA", "CORPORATE"],
      default: "CASH" },

    isAutoCharged: { type: Boolean, default: false },
    chargeDate: { type: Date, default: Date.now },
    remarks: { type: String, trim: true },

    // ── AI Billing Intelligence ──────────────────────────────────
    // Who added this charge — source role
    addedBySource: {
      type: String,
      enum: ["Doctor", "Nurse", "Lab", "Radiology", "Reception", "AI-Confirmed", "Auto"],
      default: "Reception" },
    addedBy: { type: String, trim: true },     // name of who added it
    addedByRole: { type: String, trim: true },  // role label for display
    aiSuggested: { type: Boolean, default: false }, // was this charge suggested by AI?
    aiReason: { type: String, trim: true },    // clinical justification from AI
  },
  { _id: true },
);

// ── Payment record ─────────────────────────────────────────────
const PaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true },
    paymentMode: {
      type: String,
      required: true,
      enum: ["CASH", "CARD", "UPI", "CHEQUE", "ONLINE", "TPA_CLAIM"] },
    transactionId: { type: String, trim: true },
    paidAt: { type: Date, default: Date.now },
    receivedBy: { type: String, trim: true },
    remarks: { type: String, trim: true } },
  { _id: true },
);

// ── Main bill ─────────────────────────────────────────────────
const PatientBillSchema = new mongoose.Schema(
  {
    // BILL-2026-000001 (auto-generated)
    billNumber: { type: String, unique: true },

    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true },

    // Primary lookup key — never changes for a patient
    UHID: { type: String, required: true },

    // Linked for IPD / Daycare bills
    admission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission",
      default: null },
    admissionNumber: { type: String, default: null },

    visitType: {
      type: String,
      required: true,
      enum: ["OPD", "IPD", "DAYCARE", "EMERGENCY"] },

    // ── Payment Info ───────────────────────────────────────
    paymentType: {
      type: String,
      enum: ["CASH", "TPA", "CORPORATE"],
      default: "CASH" },
    tpa: { type: mongoose.Schema.Types.ObjectId, ref: "TPA", default: null },
    tpaName: { type: String, default: null },

    // ── Items ─────────────────────────────────────────────
    billItems: [BillItemSchema],

    // ── Calculated totals (recalculated on every save) ────
    grossAmount: { type: Number, default: 0 },
    totalDiscount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    netAmount: { type: Number, default: 0 },
    tpaPayableAmount: { type: Number, default: 0 },
    patientPayableAmount: { type: Number, default: 0 },
    advancePaid: { type: Number, default: 0 },
    balanceAmount: { type: Number, default: 0 },

    // ── Payments ──────────────────────────────────────────
    payments: [PaymentSchema],

    // ── Status ────────────────────────────────────────────
    billStatus: {
      type: String,
      enum: ["DRAFT", "GENERATED", "PARTIAL", "PAID", "CANCELLED", "REFUNDED"],
      default: "DRAFT" },

    // ── TPA Claim tracking ────────────────────────────────
    tpaClaimStatus: {
      type: String,
      enum: [
        "NOT_APPLICABLE",
        "PENDING",
        "SUBMITTED",
        "APPROVED",
        "REJECTED",
        "PARTIAL_APPROVED",
      ],
      default: "NOT_APPLICABLE" },
    tpaClaimNumber: { type: String, trim: true },
    tpaApprovedAmount: { type: Number, default: 0 },

    // ── Dates & Audit ─────────────────────────────────────
    billDate: { type: Date, default: Date.now },
    billGeneratedAt: { type: Date },
    paidAt: { type: Date },
    generatedBy: { type: String, trim: true },
    remarks: { type: String, trim: true } },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true } },
);

// ── Pre-save: bill number + recalculate all totals ─────────────
PatientBillSchema.pre("save", async function (next) {
  // Auto bill number
  if (this.isNew && !this.billNumber) {
    const count = await this.constructor.countDocuments();
    const year = new Date().getFullYear();
    this.billNumber = `BILL-${year}-${String(count + 1).padStart(6, "0")}`;
  }

  // Recalculate totals from items
  if (this.billItems && this.billItems.length > 0) {
    let gross = 0,
      disc = 0,
      tax = 0,
      tpaPay = 0,
      ptPay = 0;

    this.billItems.forEach((item) => {
      item.grossAmount = item.unitPrice * item.quantity;
      item.discountAmount = (item.grossAmount * item.discountPercent) / 100;
      item.netAmount = item.grossAmount - item.discountAmount;
      item.taxAmount = item.isTaxable
        ? (item.netAmount * item.taxPercent) / 100
        : 0;

      const lineTotal = item.netAmount + item.taxAmount;

      if (this.paymentType === "TPA") {
        item.patientPayableAmount = lineTotal - item.tpaPayableAmount;
      } else {
        item.tpaPayableAmount = 0;
        item.patientPayableAmount = lineTotal;
      }

      gross += item.grossAmount;
      disc += item.discountAmount;
      tax += item.taxAmount;
      tpaPay += item.tpaPayableAmount;
      ptPay += item.patientPayableAmount;
    });

    this.grossAmount = gross;
    this.totalDiscount = disc;
    this.taxAmount = tax;
    this.netAmount = gross - disc + tax;
    this.tpaPayableAmount = tpaPay;
    this.patientPayableAmount = ptPay;
  }

  // Recalculate balance. Payment rows can be negative (refunds), so totalPaid
  // is a net figure. When the bill is fully refunded or cancelled, force the
  // balance to zero — the receptionist shouldn't see a "balance due" on a
  // closed-out bill.
  const totalPaid = this.payments.reduce((s, p) => s + p.amount, 0);
  this.advancePaid = totalPaid;
  if (this.billStatus === "REFUNDED" || this.billStatus === "CANCELLED") {
    this.balanceAmount = 0;
  } else {
    this.balanceAmount = Math.max(0, this.patientPayableAmount - totalPaid);
  }

  next();
});

PatientBillSchema.index({ UHID: 1 });
PatientBillSchema.index({ patient: 1 });
PatientBillSchema.index({ admission: 1 });
PatientBillSchema.index({ billStatus: 1 });
PatientBillSchema.index({ visitType: 1 });
PatientBillSchema.index({ billDate: -1 });
PatientBillSchema.index({ tpa: 1 });

module.exports =
  mongoose.models.PatientBill ||
  mongoose.model("PatientBill", PatientBillSchema);
