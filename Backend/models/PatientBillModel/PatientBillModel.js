const mongoose = require("mongoose");
const { toNum, toDec, decimalToNumber } = require("../../utils/money");
const Dec = mongoose.Schema.Types.Decimal128;

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
    // Money fields use Decimal128 so storage doesn't drift (see utils/money.js).
    // Percentages stay Number — they're not currency.
    unitPrice: { type: Dec, required: true },
    grossAmount: { type: Dec, default: () => toDec(0) },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    discountAmount: { type: Dec, default: () => toDec(0) },
    netAmount: { type: Dec, default: () => toDec(0) },

    // TPA split (filled only when paymentType === TPA)
    // tpaPercent: when > 0, recomputed every save as `lineTotal * pct/100`.
    //             Use this when the policy covers a percentage of the bill.
    // tpaPayableAmount: caller-supplied absolute amount; used when tpaPercent
    //             is 0/unset. Capped at lineTotal so patientPayable never
    //             goes negative if discounts shrink lineTotal below the cap.
    tpaPercent:        { type: Number, default: 0, min: 0, max: 100 },
    tpaPayableAmount:  { type: Dec, default: () => toDec(0) },
    patientPayableAmount: { type: Dec, default: () => toDec(0) },

    // Tax
    isTaxable: { type: Boolean, default: false },
    taxPercent: { type: Number, default: 0 },
    taxAmount: { type: Dec, default: () => toDec(0) },

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
    amount: { type: Dec, required: true },
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
    // sparse so multiple DRAFT bills (no billNumber yet) don't collide on
    // the unique index. Only finalised bills get a billNumber.
    billNumber: { type: String, unique: true, sparse: true },

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
    grossAmount:          { type: Dec, default: () => toDec(0) },
    totalDiscount:        { type: Dec, default: () => toDec(0) },
    taxAmount:            { type: Dec, default: () => toDec(0) },
    netAmount:            { type: Dec, default: () => toDec(0) },
    tpaPayableAmount:     { type: Dec, default: () => toDec(0) },
    patientPayableAmount: { type: Dec, default: () => toDec(0) },
    advancePaid:          { type: Dec, default: () => toDec(0) },
    balanceAmount:        { type: Dec, default: () => toDec(0) },

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
    tpaApprovedAmount: { type: Dec, default: () => toDec(0) },

    // ── Dates & Audit ─────────────────────────────────────
    billDate: { type: Date, default: Date.now },
    billGeneratedAt: { type: Date },
    paidAt: { type: Date },
    generatedBy: { type: String, trim: true },
    remarks: { type: String, trim: true } },
  {
    timestamps: true,
    // Serialize Decimal128 → Number on the wire so the existing frontend
    // (which does .toFixed(), arithmetic, etc.) keeps working as-is. The
    // database still stores the precise Decimal128 value — only the JSON
    // representation is flattened.
    toJSON:   { virtuals: true, transform: decimalToNumber },
    toObject: { virtuals: true, transform: decimalToNumber } },
);

// Atomic bill-number sequence via shared Counter (replaces race-prone
// countDocuments). Generator stays in pre("save") — billNumber isn't
// `required`, so validation order is irrelevant here.
const { nextSequence: nextSeqBill } = require("../../utils/counter");

// ── Pre-save: bill number + recalculate all totals ─────────────
PatientBillSchema.pre("save", async function (next) {
  if (this.isNew && !this.billNumber) {
    const year = new Date().getFullYear();
    const seq  = await nextSeqBill(`bill:${year}`);
    this.billNumber = `BILL-${year}-${String(seq).padStart(6, "0")}`;
  }

  // Recalculate totals from items
  if (this.billItems && this.billItems.length > 0) {
    let gross = 0,
      disc = 0,
      tax = 0,
      tpaPay = 0,
      ptPay = 0;

    // Money fields are Decimal128 at rest; convert to Number for arithmetic,
    // then back to Decimal128 (with 2-dp rounding) before writing. Accumulators
    // stay Number for speed and convert at the end.
    this.billItems.forEach((item) => {
      const unit = toNum(item.unitPrice);
      const qty  = toNum(item.quantity);
      const gAmt = unit * qty;
      const dAmt = (gAmt * toNum(item.discountPercent)) / 100;
      const nAmt = gAmt - dAmt;
      const tAmt = item.isTaxable ? (nAmt * toNum(item.taxPercent)) / 100 : 0;
      const lineTotal = nAmt + tAmt;

      item.grossAmount    = toDec(gAmt);
      item.discountAmount = toDec(dAmt);
      item.netAmount      = toDec(nAmt);
      item.taxAmount      = toDec(tAmt);

      let tpaShare = 0;
      let ptShare = lineTotal;
      if (this.paymentType === "TPA") {
        if (toNum(item.tpaPercent) > 0) {
          // Percentage-based: recompute fresh from the (possibly-changed) lineTotal.
          tpaShare = (lineTotal * toNum(item.tpaPercent)) / 100;
        } else {
          // Caller-supplied absolute cap; clamp at lineTotal so the patient
          // side can never go negative when discounts shrink the total.
          tpaShare = Math.min(toNum(item.tpaPayableAmount), lineTotal);
        }
        ptShare = Math.max(0, lineTotal - tpaShare);
      } else {
        tpaShare = 0;
        ptShare = lineTotal;
      }
      item.tpaPayableAmount     = toDec(tpaShare);
      item.patientPayableAmount = toDec(ptShare);

      gross  += gAmt;
      disc   += dAmt;
      tax    += tAmt;
      tpaPay += tpaShare;
      ptPay  += ptShare;
    });

    this.grossAmount          = toDec(gross);
    this.totalDiscount        = toDec(disc);
    this.taxAmount            = toDec(tax);
    this.netAmount            = toDec(gross - disc + tax);
    this.tpaPayableAmount     = toDec(tpaPay);
    this.patientPayableAmount = toDec(ptPay);
  }

  // Recalculate balance. Payment rows can be negative (refunds), so totalPaid
  // is a net figure. When the bill is fully refunded or cancelled, force the
  // balance to zero — the receptionist shouldn't see a "balance due" on a
  // closed-out bill.
  const totalPaid = this.payments.reduce((s, p) => s + toNum(p.amount), 0);
  this.advancePaid = toDec(totalPaid);
  if (this.billStatus === "REFUNDED" || this.billStatus === "CANCELLED") {
    this.balanceAmount = toDec(0);
  } else {
    this.balanceAmount = toDec(Math.max(0, toNum(this.patientPayableAmount) - totalPaid));
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

// FIX (audit P6-B1): partial unique index that prevents two concurrent
// getOrCreateDraftBill() callers from materialising two DRAFT rows for the
// same patient+visitType+admission. Previously the find-then-insert pattern
// was race-prone and on a busy ward we ended up with split draft bills that
// auto-billing kept hitting at random.
//
// `admission` is included in the key — for OPD the admission field is null,
// and {null, null} pairs are treated as distinct under default indexes, so we
// have a separate guard below for OPD without admission.
PatientBillSchema.index(
  { UHID: 1, visitType: 1, admission: 1 },
  { unique: true, partialFilterExpression: { billStatus: "DRAFT" } }
);

// Enable optimistic concurrency — every save() bumps __v and refuses to
// overwrite a stale snapshot. recordPayment uses this with a retry loop so
// two cashiers taking payment from the same bill at the same instant can't
// silently clobber each other's payment row.
PatientBillSchema.set("optimisticConcurrency", true);

module.exports =
  mongoose.models.PatientBill ||
  mongoose.model("PatientBill", PatientBillSchema);
