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
    // R7hr-31: MRP snapshot from the batch (DrugBatch.mrp) at dispense
    // time. The bill print shows MRP alongside Rate so the customer sees
    // the discount-off-MRP signal — Legal Metrology Rules expect MRP on
    // every retail bill. Snapshotting here (not reading the batch live)
    // preserves the MRP-at-billing-time even if mfg later revises it.
    mrp:        { type: Number, default: 0, min: 0 },

    quantity:   { type: Number, required: true, min: 1 },
    unitPrice:  { type: Dec, required: true },
    // R7ct — HSN/SAC code snapshot. Captured from DrugMaster.hsnCode at
    // dispense time so a historical sale still shows the HSN that was in
    // force when it was billed, even if the drug master HSN is later
    // changed (e.g. CBIC reclassifies a product). GSTR-1 line 12
    // HSN-summary block reads this column.
    hsnCode:    { type: String, default: "" },
    // R7hr-12-S2 (D8-07): per-item prescriber identity snapshot. Sch H/H1/X
    // dispense requires the script-writer's name + MCI/state-council
    // registration number on the statutory register (D&C Form 2 / Sch H1).
    // Per-item because a single sale may carry items from multiple
    // prescribers; if blank, the top-level prescriberName /
    // prescriberRegistrationNo on the sale doc is the authority. Captured
    // at dispense time from the Doctor master when the prescriber resolves.
    prescriberName:             { type: String, default: "" },
    prescriberRegistrationNo:   { type: String, default: "" },
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
    // R7hr-12-S2 (D8-07): top-level prescriber registration number for
    // Schedule H / H1 / X register completeness. D&C Form 2 + Schedule H1
    // register explicitly mandate "the name, address and registration
    // number of the prescriber" for every prescription-mandatory dispense.
    // Auto-populated from Doctor master at dispense time when the prescriber
    // resolves; otherwise required from req.body for H/H1/X items. Kept as
    // free-text (not ref) because legacy/external prescribers don't have
    // Doctor master rows but still must carry their MCI/state-council reg.
    prescriberRegistrationNo: { type: String, default: "", trim: true },

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

    // R7hr-23: D&C Rules 65 — when a Walk-in counter dispense includes
    // any Schedule H / H1 / X drug, the pharmacist must preserve a
    // photocopy of the prescription for 5 years. The frontend opens an
    // attestation modal that captures prescriber + Rx ref + a checkbox
    // signed by the pharmacist on duty; this flag snapshots that
    // attestation on the sale doc itself so the Sch-H register and any
    // inspector audit can verify the photocopy-retention claim per sale.
    // Backend dispense controller refuses Sch H/H1/X Walk-in lines when
    // this is falsy (code RX_PHOTOCOPY_REQUIRED). OPD/IPD/Homecare sales
    // are exempt — the prescription is already on the patient file in
    // those flows.
    rxPhotocopyPreserved: { type: Boolean, default: false, index: true },

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
    // R7hr-5: "Advance" lets a sale that was settled entirely from the
    // patient's advance pool surface the correct top-level mode so prints
    // and analytics don't mis-label it as "Cash" or "Credit".
    paymentMode: { type: String, enum: ["Cash","Card","UPI","Mixed","Credit","Advance"], default: "Cash" },
    amountPaid:  { type: Dec, default: () => toDec(0) },
    balanceDue:  { type: Dec, default: () => toDec(0) },
    // R7hp-2: structured payment-mode metadata.
    // - Card sales capture last-4 + cardholder name (PCI-DSS safe — no PAN).
    // - UPI sales capture txnRef (UTR / VPA / PSP reference).
    // - Mixed sales carry a splits[] array — Cash + Card + UPI portions
    //   with per-row amount + ref. The sum must equal amountPaid; the
    //   service trusts the client today, hard-enforces in a follow-up.
    paymentDetails: {
      type: new mongoose.Schema({
        cardLast4:       { type: String, default: "" },
        cardHolderName:  { type: String, default: "" },
        upiTxnRef:       { type: String, default: "" },
        splits: {
          type: [ new mongoose.Schema({
            mode:   { type: String, enum: ["Cash","Card","UPI"], required: true },
            amount: { type: Dec, default: () => toDec(0) },
            txnRef: { type: String, default: "" },
          }, { _id: false }) ],
          default: [],
        },
      }, { _id: false }),
      default: () => ({ cardLast4: "", cardHolderName: "", upiTxnRef: "", splits: [] }),
    },
    // R7hp-1: pharmacist counter identity for the bill footer.
    counter: { type: String, default: "" },
    // R7cu — Credit-collection log. Every payment received AFTER the
    // original dispense (i.e. against an IPD/Credit sale that was
    // booked with balanceDue > 0) appends a row here so the pharmacy
    // has an auditable per-payment trail rather than just an
    // incremented amountPaid. Mirrors the patientCreditLog pattern but
    // tracks money coming IN (credit collections) instead of OUT
    // (over-payment refunds). Discharge gate reads balanceDue, not
    // this array — array is for receipts + audit only.
    collectionLog: {
      type: [{
        _id: false,
        amount:        { type: Dec, required: true },
        // R7hr-5: "Advance" mode lets the pharmacist apply patient
        // advance against an outstanding pharmacy bill — the row's
        // sourceAdvanceId then back-references the PatientAdvance row
        // we consumed so audit / refund flows can walk the link.
        mode:          { type: String, enum: ["Cash","Card","UPI","Mixed","Credit","Advance"], default: "Cash" },
        txnRef:        { type: String, default: "" },
        receiptNumber: { type: String, default: "" }, // PHM-COLL-... if generated
        collectedAt:   { type: Date, default: Date.now },
        collectedBy:   { type: String, default: "" },
        collectedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        // R7hr-5: optional back-link to the PatientAdvance row this
        // collection consumed (only set when mode === "Advance").
        sourceAdvanceId: { type: mongoose.Schema.Types.ObjectId, ref: "PatientAdvance", default: null },
        notes:         { type: String, default: "" },
      }],
      default: [],
    },

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

    // R7hr-12-S3 (D1-02): cancel audit anchor. Pre-fix, cancelSale wrote
    // `cancelledById`/`cancelledByName`/`cancelledAt` via $set on findOneAndUpdate
    // but the schema declared none of these paths — Mongoose default strict
    // mode silently stripped them, leaving the status flip and balanceDue
    // zeroing in place but losing the actor/timestamp on the doc itself.
    // Audit redundancy in ClinicalAudit + remarks + (admin-override) BillingAudit
    // already covered the NABH AAC.7 trail, but per-bill schema-hygiene matters
    // (mirrors PharmacyIndentModel / KitchenIndentModel / PatientBillModel which
    // all declare these fields explicitly). cancelReason added so a future UI
    // dropdown ("Wrong patient", "Customer changed mind", etc.) lands cleanly.
    cancelledById:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelledByName:{ type: String, default: "" },
    cancelledAt:    { type: Date, default: null },
    cancelReason:   { type: String, default: "" },

    // R7hr-12-S3 (D7-06): encounter context snapshot at billing time. Pre-fix,
    // PharmacySale persisted only patientUHID + admissionNumber — bed / ward /
    // attending consultant lived only on the live Admission doc, so a re-print
    // after a bed transfer or consultant change showed the CURRENT context, not
    // the encounter context at issue time. GST §31 expects a tax invoice to
    // snapshot the buyer's address (i.e. bed) at issue, not retro-hydrate from
    // a live source. Denormalised here at dispense for IPD/Homecare sales;
    // walk-in / OPD legitimately leave these blank and the printable falls
    // back to "—". Schema additions are zero-risk for legacy rows (default "").
    bedNumber:      { type: String, default: "" },
    wardName:       { type: String, default: "" },
    consultantName: { type: String, default: "" },
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

// R7hr-12 (D1-01): enable optimistic concurrency so every save() includes
// the __v guard. Without this, retryVersionError wrappers in pharmacyController
// (collectCredit, applyAdvanceToSale fallback, cancelSale credit-update) were
// dead code — concurrent cashiers/terminals collecting on the same sale
// silently last-writer-wins on amountPaid/balanceDue/patientCredit/paymentMode
// while the collectionLog $push survives, producing an over-recorded audit
// trail and under-recorded accounting. Mirrors PatientBillModel.js:793.
PharmacySaleSchema.set("optimisticConcurrency", true);

// R7hr-12-S3 (D1-09): conditional-required for patientUHID + admissionNumber
// on IPD/Homecare sales. Defence-in-depth alongside the controller checks in
// pharmacyController.createSale (L709/L719) so any future write path (direct
// service call, migration, console fix) still anchors IPD/Homecare dispenses
// to a patient. NABH MOM.4 expects every IPD pharmacy dispense to link to a
// patient identity; blank UHID rows break the R7hr-10 IPD Ledger dedup key
// (admissionNumber + UHID) and disappear from outstanding lists. Walk-in /
// OPD legitimately allow blanks (anonymous counter sale), so a blanket
// `required: true` would break those flows — pre('validate') hook is the
// right granularity.
PharmacySaleSchema.pre("validate", function (next) {
  if (this.saleType === "IPD" || this.saleType === "Homecare") {
    if (!this.patientUHID || !String(this.patientUHID).trim()) {
      return next(new Error("patientUHID required for IPD/Homecare sales"));
    }
    if (!this.admissionNumber || !String(this.admissionNumber).trim()) {
      return next(new Error("admissionNumber required for IPD/Homecare sales"));
    }
  }
  next();
});

PharmacySaleSchema.index({ createdAt: -1 });
// R7ap-F14/D8-07: pharmacyController.gstSummary filters by status + createdAt
// — the previous single-field createdAt index forced a COLLSCAN over the
// status filter. Compound covers it.
PharmacySaleSchema.index({ status: 1, createdAt: -1 });
// TD-1 — patient-file coverage loads every patient's sales via
// { $or: [{ UHID }, { patientUHID }] } sorted by createdAt; patientUHID had
// no index so each Complete File load COLLSCANned this high-volume
// collection. Compound serves the filter + sort in one pass (walk-in blank
// UHIDs cluster under "" — fine, they're never queried by patient).
PharmacySaleSchema.index({ patientUHID: 1, createdAt: -1 });
// R7hr-12-S2 (D10-02): pharmacyController.listIpdCreditAdmissions runs
// `Sale.find({ saleType: $in, status: $in, admissionId: $ne null })` on every
// IPD-credit-pill open. Pre-fix only single-field indexes existed on
// saleType/admissionId/status, forcing the planner to pick one and filter
// the rest in memory (effectively partial collection scan). Compound
// covers all three predicates so the query hits a single B-tree walk
// proportional to the result-size not the full sales history.
PharmacySaleSchema.index({ status: 1, saleType: 1, admissionId: 1 });

// R7hr-33 (audit P1-2): compound index for the R7hr-28 walk-in patient
// lookup. The aggregation matches {saleType:{Walk-in,Homecare}, contactNumber:
// /^digits/, status:{Completed,Partial-Return,Supplemented}} sorted by
// createdAt desc. Without this index the regex hits a full collection
// scan on every keystroke (typing 4-7 digits then debouncing fires 1-3
// queries through 250 ms debounce). Order matters: contactNumber leads
// because its regex is the most selective predicate (prefix-anchored
// after R7hr-33), then saleType partitions by 2-bucket cardinality,
// finally createdAt sorts within the match set.
PharmacySaleSchema.index(
  { contactNumber: 1, saleType: 1, createdAt: -1 },
  { name: "walkin_lookup_v1" },
);

module.exports = mongoose.model("PharmacySale", PharmacySaleSchema);
