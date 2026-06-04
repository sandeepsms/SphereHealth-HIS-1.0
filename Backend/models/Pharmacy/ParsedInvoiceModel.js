/**
 * ParsedInvoiceModel.js
 *
 * R7hr-16: Append-only audit log of every supplier-invoice parse attempt
 * (success or fail). This is NOT an accounting ledger — the actual stock
 * movement still goes through POST /grn → DrugBatchModel; ParsedInvoice
 * only records the pre-flight LLM-driven parse so we can:
 *   - de-duplicate uploads (fileHash)
 *   - re-show a parse without re-spending the LLM token budget
 *   - link an upload to the GRN batches it eventually became
 *     (appliedToGrnBatchIds) for forward / reverse traceability
 *   - debug bad parses post-hoc (rawText + error)
 *
 * Money fields in `extracted.totals` are DISPLAY-ONLY summaries lifted
 * from the source invoice — they are never used for accounting math,
 * so plain Number is intentional. Anything that flows into a real
 * batch goes through the existing /grn controller which already uses
 * the canonical Number-per-batch shape (see DrugBatchModel.js).
 *
 * Lifecycle:
 *   parsed   → freshly LLM-parsed (or failed; status='parsed' even on
 *              fail so the audit row still lands, with `error` populated)
 *   applied  → operator confirmed and the rows were posted via /grn;
 *              appliedAt + appliedToGrnBatchIds populated
 *   rejected → operator dismissed the parse without applying
 *
 * The model is write-once for the parse step and updated exactly once
 * on apply / reject. No pre-save hooks, no virtuals, no toJSON transform
 * — there are no Decimal128 columns to unwrap and the audit row is the
 * source of truth as-stored.
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

// R7hr-16: line-match candidate sub-shape (declared inline in the
// parent schema below — kept loose so the matcher service can grow
// extra scoring fields without a migration).

// R7hr-16: per-line resolution of an extracted invoice line against
// the PharmacyDrug master. `matchedDrugId` is null when the matcher
// couldn't pick a confident winner; the operator then picks from
// `alternatives` in the UI.
const LineMatchSchema = new Schema(
  {
    _id: false,
    extractedName:   { type: String, default: "" },
    matchedDrugId:   { type: Schema.Types.ObjectId, ref: "PharmacyDrug", default: null },
    matchedDrugName: { type: String, default: "" },
    confidence:      { type: Number, default: 0, min: 0, max: 1 },
    alternatives: [{
      _id:      false,
      drugId:   { type: Schema.Types.ObjectId, ref: "PharmacyDrug", default: null },
      drugName: { type: String, default: "" },
      score:    { type: Number, default: 0 },
    }],
  },
  { _id: false },
);

// R7hr-16: supplier resolution shape. `method` records HOW we matched
// (GSTIN exact > NAME fuzzy > NONE) so the operator can decide whether
// to trust the auto-pick or override.
const SupplierMatchSchema = new Schema(
  {
    _id: false,
    matchedSupplierId:   { type: Schema.Types.ObjectId, ref: "PharmacySupplier", default: null },
    matchedSupplierName: { type: String, default: "" },
    confidence:          { type: Number, default: 0, min: 0, max: 1 },
    method:              { type: String, enum: ["GSTIN", "NAME", "NONE"], default: "NONE" },
  },
  { _id: false },
);

const ParsedInvoiceSchema = new Schema(
  {
    // R7hr-16: sha256 of the raw upload bytes (hex). Caller computes via
    //   crypto.createHash('sha256').update(buffer).digest('hex')
    // Indexed so we can short-circuit a re-parse if the same file lands
    // a second time within the dedupe window.
    fileHash:       { type: String, required: true, index: true },
    fileType:       { type: String, enum: ["JSON", "PDF"], required: true },
    sourceFilename: { type: String, default: "" },   // sanitised multer filename

    // R7hr-16: extracted PDF text, hard-capped to keep doc <16 MB and
    // leave headroom for `extracted` + `lineMatches`. Empty for JSON
    // uploads (we kept the structured payload in `extracted` instead).
    rawText: {
      type: String,
      default: "",
      // Defence-in-depth — the parser controller also truncates, but we
      // refuse to persist anything over the cap.
      maxlength: 200000,
    },

    // R7hr-16: loose Mixed so the parser/LLM can append new fields
    // (e.g. discount lines, freight, round-off) without a migration.
    // The SHAPE the parser writes is:
    //   {
    //     supplier: { name, gstin, address },
    //     invoiceNo: String, invoiceDate: Date,
    //     lines: [{
    //       extractedName, hsn, batch, expiry,
    //       qty, mrp, purchaseRate, discount, gstPct, total,
    //       rawLineText
    //     }],
    //     totals: { taxable, gst, gross },
    //   }
    // All money fields under `totals` are display-only — see header.
    extracted: { type: Schema.Types.Mixed, default: {} },

    // R7hr-16: per-line drug-master resolution. Length matches
    // extracted.lines length on a clean parse.
    lineMatches: { type: [LineMatchSchema], default: [] },

    // R7hr-16: supplier-master resolution. Single object (one invoice =
    // one supplier).
    supplierMatch: { type: SupplierMatchSchema, default: () => ({}) },

    // R7hr-16: lifecycle. Indexed for the "unapplied parses" queue.
    status: {
      type: String,
      enum: ["parsed", "applied", "rejected"],
      default: "parsed",
      index: true,
    },

    uploadedById:   { type: Schema.Types.ObjectId, default: null },
    uploadedByName: { type: String, default: "" },

    // R7hr-16: filled exactly once on transition to 'applied'.
    appliedAt:             { type: Date, default: null },
    appliedToGrnBatchIds: [{ type: Schema.Types.ObjectId, ref: "PharmacyDrugBatch" }],

    // R7hr-16: populated when the parse itself failed (LLM error,
    // malformed JSON, unreadable PDF). The audit row still lands with
    // status='parsed' so we can see what we tried.
    error: { type: String, default: "" },
  },
  { timestamps: true },
);

// R7hr-16: compound index — covers the common "have we seen this file
// before?" lookup (fileHash + most-recent-first). The standalone
// fileHash index on the field above is kept for raw membership tests.
ParsedInvoiceSchema.index({ fileHash: 1, createdAt: -1 });

// R7hr-16: serves the future "unapplied parses queue" UI — find rows
// where status='parsed' (or 'rejected') sorted newest first.
ParsedInvoiceSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("PharmacyParsedInvoice", ParsedInvoiceSchema);
