/**
 * PharmacySaleModel.js
 * One row per dispensing transaction. Items[] holds the actual drugs
 * sold and which batch each unit came from (FIFO chosen at sale time).
 *
 * ───────────────────────────────────────────────────────────────────────
 * R7bh-F2 (R7bg-1-CRIT-1/12/13/14, R7bg-1-CRIT-2/META-1, R7bg-1-HIGH-1):
 *   - All money fields migrated Number → Decimal128 (matches R7c
 *     PatientBill migration; see Backend/models/PatientBillModel/
 *     PatientBillModel.js and Backend/utils/money.js for the canonical
 *     pattern).
 *   - SALE_ITEM gets per-line CGST/SGST/IGST split (in addition to the
 *     legacy `gstAmount` aggregate kept for backward compat) so GSTR-1
 *     line 12 (HSN summary) can reconcile pharmacy under-supply rows
 *     against the buyer's intra-vs-inter-state taxonomy.
 *   - Top-level adds `placeOfSupply` (state code) + `customerGstin`
 *     (B2B ITC claim) — required by GST Act §31 / §34 + GSTR-1 schema.
 *   - `printCount` field added so the R7bf-F PrintAudit pipeline can
 *     `$inc` it on every reprint and the DUPLICATE watermark renders.
 *   - `gstRate` constrained to the valid Indian GST slabs to defang
 *     decimal-typo over/under-taxation (180 instead of 18 etc.).
 *   - `toJSON` / `toObject` transform unwraps Decimal128 → Number so
 *     the frontend (and all the report aggregators that do `.toFixed()`
 *     etc.) keep working unchanged.
 *
 * Backward-compat note:
 *   Mongoose Decimal128 schema columns accept Number on READ from old
 *   docs — older PharmacySale rows persisted as Number will deserialise
 *   without complaint. Re-saving such a doc will normalise it to
 *   Decimal128 via the toDec() helper.
 */
const mongoose = require("mongoose");
const { toDec, decimalToNumber } = require("../../utils/money");
const Dec = mongoose.Schema.Types.Decimal128;

const SALE_ITEM = new mongoose.Schema(
  {
    drugId:     { type: mongoose.Schema.Types.ObjectId, ref: "PharmacyDrug", required: true },
    drugName:   { type: String, required: true },
    batchId:    { type: mongoose.Schema.Types.ObjectId, ref: "PharmacyDrugBatch", default: null },
    batchNo:    { type: String, default: "" },
    expiryDate: { type: Date, default: null },

    quantity:   { type: Number, required: true, min: 1 },
    unitPrice:  { type: Dec, required: true },
    // R7ct — HSN/SAC code snapshot. Captured from DrugMaster.hsnCode at
    // dispense time so a historical sale still shows the HSN that was in
    // force when it was billed, even if the drug master HSN is later
    // changed (e.g. CBIC reclassifies a product). GSTR-1 line 12
    // HSN-summary block reads this column.
    hsnCode:    { type: String, default: "" },
    // R7bg-1-HIGH-1: constrain gstRate to the legal Indian slabs. The
    // previous `default: 12, type: Number` would silently accept a
    // decimal typo (180 instead of 18) and over-tax the patient by 10x.
    // 0.25% covers rough/sketched diamonds in DGFT; harmless to include
    // here for symmetry with PatientBillModel.taxPercent.
    gstRate:    {
      type: Number,
      default: 12,
      enum: {
        values: [0, 0.25, 3, 5, 12, 18, 28],
        message: "gstRate {VALUE} is not a valid GST slab (0, 0.25, 3, 5, 12, 18, 28)",
      },
    },
    discountPercent: { type: Number, default: 0 },

    grossAmount:    { type: Dec, default: () => toDec(0) },     // qty * unit
    discountAmount: { type: Dec, default: () => toDec(0) },
    taxableAmount:  { type: Dec, default: () => toDec(0) },
    // gstAmount stays as the aggregate per-line tax (legacy callers
    // already populate it). New cgst/sgst/igst columns split it so the
    // GSTR-1 emitter can pick the right column without re-deriving from
    // placeOfSupply on every read.
    gstAmount:      { type: Dec, default: () => toDec(0) },
    cgstAmount:     { type: Dec, default: () => toDec(0) },
    sgstAmount:     { type: Dec, default: () => toDec(0) },
    igstAmount:     { type: Dec, default: () => toDec(0) },
    netAmount:      { type: Dec, default: () => toDec(0) },     // taxable + gst
  },
  { _id: true }
);

const PharmacySaleSchema = new mongoose.Schema(
  {
    billNumber: { type: String, default: "", index: true, unique: true, sparse: true },

    // Patient (optional — walk-in sales allowed)
    patientUHID: { type: String, default: "" },
    patientName: { type: String, default: "" },
    contactNumber:{ type: String, default: "" },
    age:         { type: Number, default: null },
    gender:      { type: String, default: "" },
    doctorName:  { type: String, default: "" },

    // Source
    saleType: {
      type: String,
      enum: ["OPD","IPD","Walk-in","Homecare"],
      default: "Walk-in",
      index: true,
    },
    admissionId:    { type: mongoose.Schema.Types.ObjectId, ref: "Admission", default: null, index: true },
    admissionNumber:{ type: String, default: "" },           // denormalised for quick search/display
    prescriptionRef:{ type: String, default: "" },

    items:       { type: [SALE_ITEM], default: [] },

    // Totals
    subTotal:        { type: Dec, default: () => toDec(0) },
    totalDiscount:   { type: Dec, default: () => toDec(0) },
    totalTaxable:    { type: Dec, default: () => toDec(0) },
    totalGst:        { type: Dec, default: () => toDec(0) },
    roundOff:        { type: Dec, default: () => toDec(0) },
    grandTotal:      { type: Dec, default: () => toDec(0) },

    // R7bh-F2 / R7bg-1-CRIT-12: GST Act §31 fields. placeOfSupply drives
    // the intra-state (CGST+SGST) vs inter-state (IGST) split downstream
    // in gstService.js + the bill-level cgst/sgst/igst rollups below.
    // Default null is the legacy/intra-state assumption — gstService
    // falls back to hospital state when placeOfSupply is blank.
    placeOfSupply:    { type: String, default: null, trim: true },
    // Customer GSTIN for B2B / corporate panel ITC claim. Stored
    // upper-cased (GSTIN is case-insensitive at registration but the
    // GSTR-1 schema wants upper).
    customerGstin:    { type: String, default: null, trim: true, uppercase: true },
    // Bill-level CGST/SGST/IGST aggregates (sum across items[]). Pharmacy
    // sale recalc paths (if any controller adds one later) should sum
    // item.cgst/sgst/igstAmount into these. Kept independent of
    // `totalGst` so legacy callers that only touch totalGst still work.
    cgstAmount:       { type: Dec, default: () => toDec(0) },
    sgstAmount:       { type: Dec, default: () => toDec(0) },
    igstAmount:       { type: Dec, default: () => toDec(0) },

    // Payment
    paymentMode: { type: String, enum: ["Cash","Card","UPI","Mixed","Credit"], default: "Cash" },
    amountPaid:  { type: Dec, default: () => toDec(0) },
    balanceDue:  { type: Dec, default: () => toDec(0) },

    // ── Patient credit ledger (signed amount the pharmacy OWES the patient).
    //   Positive value = pharmacy is holding patient's money:
    //     • over-payment at counter (amountPaid > grandTotal)
    //     • refund issued via "Credit-note" or "Adjusted" mode (not paid in cash)
    //   Reset to 0 when settled back to the patient (cash payout / next bill).
    //   Kept separate from balanceDue so neither field clamps the other.
    patientCredit: { type: Dec, default: () => toDec(0) },
    patientCreditLog: {
      type: [ new mongoose.Schema({
        amount:    { type: Dec, required: true },        // positive = credit added, negative = settled
        reason:    { type: String, default: "" },        // "Over-payment", "Refund (Credit-note)", "Settled to patient"
        refSlip:   { type: String, default: "" },        // bill no / refund slip / payout ref
        at:        { type: Date, default: Date.now },
        byName:    { type: String, default: "" },
        byId:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      }, { _id: true }) ],
      default: [],
    },

    status: {
      type: String,
      enum: ["Completed","Partial-Return","Refunded","Cancelled","Hold","Supplemented"],
      default: "Completed",
      index: true,
    },

    // ── Returns / refunds — every partial return appends a record here.
    //   refundSlipNumber  REF-PHM-YYYYMMDD-NNNN, issued by Counter
    //   refundedItems[]   {{ saleItemId, drugId, drugName, batchId, batchNo,
    //                       quantity, unitPrice, gstRate, discountPercent,
    //                       grossAmount, discountAmount, taxableAmount,
    //                       gstAmount, netAmount }}
    //   refundAmount     total returned to customer (sum of items' netAmount)
    //   refundMode       Cash / Card / UPI / Adjusted / Credit-note
    //   reason           optional free-text
    // Existing items[] is kept unchanged so the original tax invoice
    // can always be reprinted. Net-of-returns figures are computed from
    // items[] - sum(returns[].refundedItems[]).
    returns: {
      type: [ new mongoose.Schema({
        refundSlipNumber: { type: String, default: "" },
        refundedItems:    { type: Array, default: [] },
        refundAmount:     { type: Dec, default: () => toDec(0) },
        refundTaxable:    { type: Dec, default: () => toDec(0) },
        refundGst:        { type: Dec, default: () => toDec(0) },
        refundDiscount:   { type: Dec, default: () => toDec(0) },
        refundMode:       { type: String, enum: ["Cash","Card","UPI","Adjusted","Credit-note"], default: "Cash" },
        refundedAt:       { type: Date, default: Date.now },
        refundedBy:       { type: String, default: "" },
        refundedById:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reason:           { type: String, default: "" },
        notes:            { type: String, default: "" },
      }, { _id: true, timestamps: true }) ],
      default: [],
    },

    // ── Supplementary invoices (debit notes) — every "missed item added
    //   after-the-fact" appends a record here. Sequential slip number
    //   SUP-PHM-YYYYMMDD-NNNN, mirror shape to returns[] but for ADDED items.
    //
    //   addedItems[]   {{ drugId, drugName, batchId, batchNo, expiryDate,
    //                     quantity, unitPrice, gstRate, discountPercent,
    //                     grossAmount, discountAmount, taxableAmount,
    //                     gstAmount, netAmount }}
    //   addedTotal     total billable for the addendum (sum of items' netAmount)
    //   paymentMode    how the patient settled the addendum (Cash/Card/...)
    //   amountPaid     paid against the addendum at counter
    //   reason         free text — "missed Ondansetron at counter", "doc added one more drug"
    //
    //   Original items[] is NEVER mutated — GST law requires the original
    //   tax invoice be reprintable as-issued. Effective totals are
    //   computed at read time: items[] + sum(supplements[].addedItems[]) - sum(returns[].refundedItems[]).
    supplements: {
      type: [ new mongoose.Schema({
        supplementSlipNumber: { type: String, default: "" },
        addedItems:    { type: Array, default: [] },
        addedSubTotal: { type: Dec, default: () => toDec(0) },
        addedDiscount: { type: Dec, default: () => toDec(0) },
        addedTaxable:  { type: Dec, default: () => toDec(0) },
        addedGst:      { type: Dec, default: () => toDec(0) },
        addedTotal:    { type: Dec, default: () => toDec(0) },
        paymentMode:   { type: String, enum: ["Cash","Card","UPI","Mixed","Credit"], default: "Cash" },
        amountPaid:    { type: Dec, default: () => toDec(0) },
        balanceDue:    { type: Dec, default: () => toDec(0) },
        addedAt:       { type: Date, default: Date.now },
        addedBy:       { type: String, default: "" },
        addedById:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        reason:        { type: String, default: "" },
        notes:         { type: String, default: "" },
      }, { _id: true, timestamps: true }) ],
      default: [],
    },

    // R7bh-F2 / R7bg-1-CRIT-2 / META-1: atomically incremented on every
    // print/reprint. Source of truth for the DUPLICATE watermark
    // (count > 1 → watermark renders) on the pharmacy tax invoice.
    // Defaults to 0; PrintAudit `$inc`s it to 1 on the first print.
    // Mirrors the PatientBill / PatientAdvance shape.
    printCount: { type: Number, default: 0, min: 0 },

    createdBy:   { type: String, default: "" },
    createdById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    remarks:     { type: String, default: "" },
  },
  {
    timestamps: true,
    // R7bh-F2: serialize Decimal128 → Number on the wire so the existing
    // frontend (which does .toFixed(), arithmetic, etc.) keeps working as-is.
    // The database still stores the precise Decimal128 value — only the JSON
    // representation is flattened. Mirrors PatientBillModel transform.
    toJSON:   { virtuals: true, transform: decimalToNumber },
    toObject: { virtuals: true, transform: decimalToNumber },
  }
);

PharmacySaleSchema.index({ createdAt: -1 });
// R7ap-F14/D8-07: pharmacyController.gstSummary filters by status + createdAt
// — the previous single-field createdAt index forced a COLLSCAN over the
// status filter. Compound covers it.
PharmacySaleSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("PharmacySale", PharmacySaleSchema);
