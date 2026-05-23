/**
 * TdsCertificateModel.js  (R7bh-F6 / R7bg CRIT-A2 / IT Act §194J + §194O)
 *
 * Form 16A is the quarterly TDS certificate the hospital issues to TPA /
 * corporate parties when the hospital DEDUCTED TDS on a TPA reimbursement.
 * (The TPA's IT books reconcile against this via 26AS at year-end.)
 *
 * Pre-R7bh the HIS captured `tdsAmount` on every PatientBill.payments[]
 * row when paymentMode === "TPA_CLAIM" (R7ap-F28) but offered:
 *   • no quarterly aggregation
 *   • no Form 16A generator
 *   • no 26Q export
 *
 * That left the hospital exposed under §194J / §194O / §201 (failure to
 * issue TDS certificate). This model holds the generated certificate
 * snapshots and tracks the TRACES portal acknowledgement.
 *
 * Certificate numbers are auto-generated F16A-{YYYY}-{NNNNNN}.
 */
const mongoose = require("mongoose");
const Dec = mongoose.Schema.Types.Decimal128;
const { decimalToNumber } = require("../../utils/money");

const PaymentRowSchema = new mongoose.Schema(
  {
    _id: false,
    date: { type: Date, required: true },
    paymentRef: { type: String, trim: true, default: "" },
    billNumber: { type: String, trim: true, default: "" },
    amount: { type: Dec, default: 0 },
    tds: { type: Dec, default: 0 },
  },
  { _id: false },
);

const TdsCertificateSchema = new mongoose.Schema(
  {
    // Auto-generated F16A-{YYYY}-{NNNNNN} via utils/counter.
    certificateNumber: { type: String, required: true, unique: true, index: true },

    quarter: {
      type: String,
      enum: ["Q1", "Q2", "Q3", "Q4"],
      required: true,
      index: true,
    },
    financialYear: { type: String, required: true, index: true }, // e.g. "2026-27"

    // ── Counterparty (deductee) ────────────────────────────────
    tpaParty: {
      name: { type: String, trim: true, default: "" },
      address: { type: String, trim: true, default: "" },
      pan: { type: String, trim: true, default: "" },
      gstin: { type: String, trim: true, default: "" },
    },

    // ── Aggregates ─────────────────────────────────────────────
    totalAmountPaid: { type: Dec, default: 0 },
    totalTdsDeducted: { type: Dec, default: 0 },

    // ── Per-payment rows (audit + portal-ready) ────────────────
    paymentRows: { type: [PaymentRowSchema], default: [] },

    // ── Lifecycle ──────────────────────────────────────────────
    generatedAt: { type: Date, default: Date.now },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    generatedByName: { type: String, trim: true, default: "" },

    status: {
      type: String,
      enum: ["DRAFT", "ISSUED", "FILED"],
      default: "DRAFT",
      index: true,
    },
    issuedAt: { type: Date, default: null },
    filedAt: { type: Date, default: null },

    // TRACES portal acknowledgement when the 26Q was filed.
    arnFromTraces: { type: String, trim: true, default: "" },

    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "tds_certificates" },
);

TdsCertificateSchema.index({ financialYear: 1, quarter: 1, "tpaParty.name": 1 });
TdsCertificateSchema.index({ status: 1, generatedAt: -1 });

TdsCertificateSchema.set("toJSON", { transform: decimalToNumber });
TdsCertificateSchema.set("toObject", { transform: decimalToNumber });

module.exports =
  mongoose.models.TdsCertificate ||
  mongoose.model("TdsCertificate", TdsCertificateSchema);
