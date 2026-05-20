// models/Billing/CreditNote.js
// ════════════════════════════════════════════════════════════════════
// R7ap-F19/C-08/D6-07: CreditNote — GST-Act §34 compliant credit notes
// emitted on every PatientBill refund. Pre-R7ap a bill refund silently
// adjusted bill.payments[] but never wrote a credit-note doc, so when the
// GST month was filed (GSTR-1 outward supply) the refund of a ₹118 bill
// in the next month left a phantom GST liability of ₹18 on the books.
//
// Schema mirrors the GSTR-1 CDNR (credit-debit notes registered) section.
// Cross-referenced to original PatientBill via billId + originalBillNumber.
// Sequential gap-less CN-YYYY-NNNNNN via the same atomic counter pattern
// used by PatientAdvance receipts.
// ════════════════════════════════════════════════════════════════════
const mongoose = require("mongoose");
const { nextSequence } = require("../../utils/counter");
const CounterModel = require("../CounterModel");
const Dec = mongoose.Schema.Types.Decimal128;

const CreditNoteSchema = new mongoose.Schema(
  {
    creditNoteNumber: { type: String, unique: true, sparse: true },   // CN-YYYY-NNNNNN
    creditNoteDate:   { type: Date, default: Date.now, required: true },

    // Refs
    billId:           { type: mongoose.Schema.Types.ObjectId, ref: "PatientBill", required: true, index: true },
    originalBillNumber: { type: String, trim: true, required: true, index: true },
    UHID:             { type: String, uppercase: true, trim: true, required: true, index: true },
    patientId:        { type: mongoose.Schema.Types.ObjectId, ref: "Patient" },

    // Money
    refundAmount:     { type: Dec, required: true },   // gross refund (incl. tax)
    taxableValue:     { type: Dec, default: 0 },        // pre-tax portion
    taxAmount:        { type: Dec, default: 0 },        // total tax reversed
    cgstAmount:       { type: Dec, default: 0 },
    sgstAmount:       { type: Dec, default: 0 },
    igstAmount:       { type: Dec, default: 0 },

    // Reason class — drives the GSTR-1 reason code on the CDNR row.
    // 01 Sales return, 02 Post sale discount, 03 Deficiency in services,
    // 04 Correction in invoice, 05 Change in POS, 06 Finalization, 07 Other.
    reasonCode:       { type: String, enum: ["01", "02", "03", "04", "05", "06", "07"], default: "07" },
    reasonText:       { type: String, trim: true },

    refundMode:       { type: String, trim: true },     // CASH / UPI / TPA_CLAIM / ADVANCE_ADJUSTMENT
    refundTransactionId: { type: String, trim: true },

    // Audit
    issuedBy:         { type: String, trim: true },
    issuedById:       { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    issuedByRole:     { type: String, trim: true },

    // R7ap-F19: month-close guard — set once the period is sealed for
    // GSTR-1 filing (no more new notes can target that month). Currently
    // toggled manually by Accountant via /accounts UI when files are
    // uploaded to the portal.
    periodLocked:     { type: Boolean, default: false },
  },
  { timestamps: true },
);

CreditNoteSchema.index({ creditNoteDate: -1 });
CreditNoteSchema.index({ UHID: 1, creditNoteDate: -1 });

// Decimal128 → Number on serialise
const { decimalToNumber } = require("../../utils/money");
CreditNoteSchema.set("toJSON",   { transform: decimalToNumber });
CreditNoteSchema.set("toObject", { transform: decimalToNumber });

// Atomic sequential CN number per calendar year — gap-less per Income Tax
// Rule 46 / GST Rule 53. Mirrors the PatientAdvance receipt counter.
CreditNoteSchema.pre("save", async function (next) {
  if (!this.isNew || this.creditNoteNumber) return next();
  try {
    // R7at-FIX-8/D6-MED-3+D6-R7at-NEW-1: derive year from
    // `this.creditNoteDate` via IST formatter, not server-clock UTC. The
    // R7as period-lock override stamps `T00:00:00+05:30` — on a UTC host
    // near year-rollover (Dec 31 18:30 UTC = Jan 1 IST), the prefix
    // would land in year Y while creditNoteDate is in Y+1, breaking
    // IT-Rule-46 gap-less series AND the sequence-audit which filters
    // by prefix `^CN-${year}-`.
    const TZ     = process.env.HOSPITAL_TZ || "Asia/Kolkata";
    const cnDate = this.creditNoteDate || new Date();
    const year   = Number(new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric",
    }).format(cnDate));
    const prefix = `CN-${year}-`;
    const key    = `creditnote:${year}`;
    const existing = await CounterModel.findOne({ _id: key }).lean();
    let seed = null;
    if (!existing) {
      const last = await this.constructor
        .findOne({ creditNoteNumber: { $regex: `^${prefix}` } })
        .sort({ creditNoteNumber: -1 })
        .lean();
      seed = last ? (parseInt(last.creditNoteNumber.slice(-6), 10) || 0) : 0;
    }
    const seq = await nextSequence(key, seed);
    this.creditNoteNumber = `${prefix}${String(seq).padStart(6, "0")}`;
    next();
  } catch (e) { next(e); }
});

module.exports =
  mongoose.models.CreditNote ||
  mongoose.model("CreditNote", CreditNoteSchema);
