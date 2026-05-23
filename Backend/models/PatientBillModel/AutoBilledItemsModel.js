// models/PatientBillModel/AutoBilledItemsModel.js
//
// Tracks recurring auto-billable items tied to an admission (bed charges,
// nursing charges, etc.). The daily cron `BillingService.runDailyAutoCharges`
// iterates active rows and appends a fresh charge to the patient's draft bill
// for each day the admission remains active. On daycare → IPD conversion the
// existing rows are deactivated and replaced by `setupAutoChargesForAdmission`.
//
// Callsites: services/Billing/billingService.js
//   - findOne   (dedupe before create)            ~line 361
//   - create    (setupAutoChargesForAdmission)    ~line 375
//   - updateMany(daycare → IPD conversion)        ~line 412
//   - find      (daily cron)                      ~line 509

const mongoose = require("mongoose");
const { toDec, decimalToNumber } = require("../../utils/money");
const Dec = mongoose.Schema.Types.Decimal128;

const AutoBilledItemsSchema = new mongoose.Schema(
  {
    admission: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admission",
      required: true,
      index: true,
    },
    admissionNumber: { type: String, index: true },
    UHID: { type: String, required: true, index: true },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },

    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceMaster",
      required: true,
    },
    serviceCode: { type: String, required: true },
    serviceName: { type: String, required: true },

    // How the item is repeated. Mirrors ServiceMaster.billingType values that
    // are eligible for auto-billing.
    billingType: {
      type: String,
      enum: ["PER_DAY", "PER_HOUR", "PER_UNIT", "ONE_TIME", "PER_VISIT"],
      default: "PER_DAY",
    },

    // R7bh-F3 / R7bg-1-CRIT-7: money fields stored as Decimal128 so per-day
    // accrual doesn't drift on long-stay admissions. min:0 is enforced
    // server-side via toNum at write sites (Decimal128 has no native min).
    unitPrice: { type: Dec, required: true, default: () => toDec(0) },

    appliedTariff: {
      type: String,
      enum: ["CASH", "TPA", "CORPORATE"],
      default: "CASH",
    },
    tpaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TPA",
      default: null,
    },

    startDate: { type: Date, required: true, default: Date.now },
    endDate: { type: Date, default: null },

    // Cron checks this flag — set false when the admission is discharged or
    // when daycare converts to IPD (rows are replaced by new ones).
    isActive: { type: Boolean, default: true, index: true },

    lastBilledDate: { type: Date, default: null },
    lastBilledBillId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PatientBill",
      default: null,
    },
    totalBilledCount: { type: Number, default: 0 },
    // R7bh-F3 / R7bg-1-CRIT-7: Decimal128 for the running sum of every
    // accrual posted for this auto-bill row. Same drift rationale as
    // unitPrice above.
    totalBilledAmount: { type: Dec, default: () => toDec(0) },
  },
  { timestamps: true },
);

// Dedupe lookup used by setupAutoChargesForAdmission.
AutoBilledItemsSchema.index(
  { admission: 1, service: 1, isActive: 1 },
);

// Daily cron sweep — pulls active rows whose lastBilledDate < today.
AutoBilledItemsSchema.index({ isActive: 1, lastBilledDate: 1 });

// R7bh-F3 / R7bg-1-CRIT-7: serialize Decimal128 money back to JS Numbers
// so existing consumers (billing summaries, IPD ledger row mappers) keep
// reading plain numbers off the wire.
AutoBilledItemsSchema.set("toJSON",   { transform: decimalToNumber });
AutoBilledItemsSchema.set("toObject", { transform: decimalToNumber });

module.exports =
  mongoose.models.AutoBilledItems ||
  mongoose.model("AutoBilledItems", AutoBilledItemsSchema);
