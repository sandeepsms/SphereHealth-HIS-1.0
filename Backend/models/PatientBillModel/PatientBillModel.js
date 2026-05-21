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
    // R7c-HIGH-3 (BILL-HIGH-03): taxPercent is restricted to the valid
    // Indian GST slabs (0 / 0.25 / 3 / 5 / 12 / 18 / 28). The previous
    // schema (`type: Number, default: 0`) would silently accept a typo
    // like 180 instead of 18 and over-tax the patient 10×. The enum is
    // a hard server-side guard — any client-side validation can sit on
    // top of it but won't be the only defence.
    taxPercent: {
      type: Number,
      default: 0,
      enum: {
        values: [0, 0.25, 3, 5, 12, 18, 28],
        message: "taxPercent {VALUE} is not a valid GST slab (0, 0.25, 3, 5, 12, 18, 28)",
      },
    },
    taxAmount: { type: Dec, default: () => toDec(0) },
    // R7ap-F18/D6-03/D6-04: GST Act §31 requires HSN/SAC code on every
    // tax invoice line. 9993 is the SAC for "human-health services"
    // (default for clinical services). Pharmacy lines override with their
    // drug-class HSN. Field is optional so legacy line items don't fail
    // validation; new emitters set it.
    hsnSacCode:    { type: String, trim: true, default: null },
    // R7ap-F18: CGST/SGST/IGST split needed for GSTR-1 inter-state vs
    // intra-state reporting. Default to taxAmount/2 (intra-state) at save
    // time. IGST populated only when placeOfSupply != hospital state.
    cgstAmount:    { type: Dec, default: () => toDec(0) },
    sgstAmount:    { type: Dec, default: () => toDec(0) },
    igstAmount:    { type: Dec, default: () => toDec(0) },
    // R7ap-F36/D5-08: when an ANH package is attached mid-stay, the
    // per-line bed/nursing/etc. items existing on the bill must NOT be
    // double-counted alongside the package bundle. Set this flag at
    // attach time; the revenue aggregator + receipt totals skip excluded
    // items. The attach action is the only thing that should set this.
    excludedByPackage: { type: Boolean, default: false },

    appliedTariff: {
      type: String,
      enum: ["CASH", "TPA", "CORPORATE"],
      default: "CASH" },

    isAutoCharged: { type: Boolean, default: false },
    chargeDate: { type: Date, default: Date.now },
    remarks: { type: String, trim: true },

    // Round-trip link back to the BillingTrigger that fired this line.
    // Set whenever autoBillingService converts a trigger → bill item so a
    // later undo/override (Phase A endpoints) can find + edit the exact
    // bill row without scanning for serviceCode matches. Optional — manual
    // line items added by the receptionist won't have a trigger.
    triggerId: { type: mongoose.Schema.Types.ObjectId, ref: "BillingTrigger" },

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

    // ── Order lifecycle (NABH AAC.5 — order-to-completion audit) ──
    // For services that have a delivery step (lab tests, imaging, minor
    // procedures, OT consumables, physiotherapy sessions, etc.) the doctor
    // raises an ORDER first; the actual charge only lands on the patient's
    // bill once the lab / radiologist / proceduralist confirms completion.
    // This prevents two failure modes the audit caught:
    //   (1) Patient billed for a test the lab never actually ran.
    //   (2) Doctor cancels an order after billing → bill shows the charge
    //       but the work was never done.
    //
    // Field semantics:
    //   undefined / "Completed"  → billable now. Counted in bill totals.
    //   "Ordered"                → in queue, waiting for the executing
    //                              team. NOT counted in grossAmount /
    //                              netAmount / balance.
    //   "InProgress"             → executing team has picked it up.
    //                              Still not billable.
    //   "Cancelled"              → never executed; excluded from totals
    //                              forever, kept for audit trail.
    //
    // Backward compat: existing items predating this field have no
    // orderStatus → treated as "Completed" so legacy bills behave
    // exactly as before. Default is intentionally omitted so the field
    // stays undefined unless the writer explicitly opts in.
    orderStatus: {
      type: String,
      enum: ["Ordered", "InProgress", "Completed", "Cancelled"],
    },
    orderedAt:     { type: Date },
    orderedBy:     { type: String, trim: true },
    orderedByRole: { type: String, trim: true },
    expectedCompletionAt: { type: Date },
    completedAt:     { type: Date },
    completedBy:     { type: String, trim: true },
    completedByRole: { type: String, trim: true },
    cancelledAt:     { type: Date },
    cancelReason:    { type: String, trim: true },
  },
  { _id: true },
);

// Helper — a bill item is BILLABLE (contributes to totals) when its order
// lifecycle is either complete OR not used at all (legacy items, walk-in
// charges that were paid upfront, auto-charges like bed days). Pending
// orders (Ordered / InProgress) and Cancelled orders are excluded.
function isItemBillable(item) {
  return !item.orderStatus || item.orderStatus === "Completed";
}

// ── Payment record ─────────────────────────────────────────────
const PaymentSchema = new mongoose.Schema(
  {
    amount: { type: Dec, required: true },
    paymentMode: {
      type: String,
      required: true,
      // ADVANCE_ADJUSTMENT — a previously-collected UHID-level
      // PatientAdvance is being consumed into this bill. The
      // transactionId carries the source PatientAdvance.receiptNumber
      // so the receipt + audit log can trace the money trail without
      // double-counting (cashier never physically touched cash again).
      enum: ["CASH", "CARD", "UPI", "CHEQUE", "ONLINE", "TPA_CLAIM", "ADVANCE_ADJUSTMENT"] },
    transactionId: { type: String, trim: true },
    paidAt: { type: Date, default: Date.now },
    receivedBy: { type: String, trim: true },
    remarks: { type: String, trim: true },
    // 15-min reversal audit (cashier-typo undo). When a payment is
    // voided, the original row stays in place (audit immutability)
    // and a NEGATIVE payment row is pushed alongside it; the void*
    // fields on the original row record who voided + when + why so
    // a receipt re-print or audit replay reads cleanly.
    voidedAt:     { type: Date },
    voidedBy:     { type: String, trim: true },
    voidedByRole: { type: String, trim: true },
    voidReason:   { type: String, trim: true },
    // R7ap-F28/D6-17: TDS deducted at source on TPA / corporate remittances.
    // Hospital books need the GROSS approved amount + the TDS deducted +
    // the NET amount actually received in the account to reconcile 26AS at
    // year-end. Pre-R7ap only the net was captured.
    tdsAmount:           { type: Dec, default: () => toDec(0) },
    tdsCertificateNo:    { type: String, trim: true },
    tdsSection:          { type: String, trim: true, default: null },  // 194J / 194I / etc.
  },
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
      // SERVICE = walk-in service-only bill (lab tests / imaging / vaccination /
      // procedure with no OPD visit or IPD admission attached). Was previously
      // being mislabeled as "OPD" by the reception Services tab — audit caught
      // it. Keep at the end of the list so existing data doesn't need
      // migration; the reception bill list groups by visitType and stat
      // reports filter on this column.
      enum: ["OPD", "IPD", "DAYCARE", "EMERGENCY", "SERVICE"] },

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

    // R7ap-F18/D6-04/D6-05: GST Act §31 + GSTR-1 schema fields. Pre-R7ap
    // hospital service GST couldn't be filed via the HIS — no field for
    // customer GSTIN (B2B / corporate panel ITC claim), no placeOfSupply
    // (intra-state vs IGST disambiguation), no split between CGST/SGST/IGST.
    // Default placeOfSupply to the hospital state (intra-state assumption);
    // emitters that detect inter-state patients override.
    placeOfSupply:    { type: String, trim: true, default: null }, // state code (e.g. "29" for KA)
    customerGstin:    { type: String, trim: true, default: null, uppercase: true },
    customerLegalName:{ type: String, trim: true, default: null },
    customerAddress:  { type: String, trim: true, default: null },
    // Bill-level CGST/SGST/IGST aggregates (sum across billItems[]). Pre-save
    // computes them by summing item-level fields so they stay in sync.
    cgstAmount:       { type: Dec, default: () => toDec(0) },
    sgstAmount:       { type: Dec, default: () => toDec(0) },
    igstAmount:       { type: Dec, default: () => toDec(0) },

    // Sum of net+tax for line items still in Ordered / InProgress state —
    // i.e. work the doctor has booked but the executing team hasn't yet
    // confirmed complete. Surfaced on the bill UI as "Pending Orders" so
    // the patient (and the cashier) can see what's coming once those
    // orders land. Excluded from grossAmount / patientPayableAmount /
    // balanceAmount so the patient is never asked to pay for it yet.
    pendingOrdersAmount:  { type: Dec, default: () => toDec(0) },

    // ── Settlement-time adjustment (post-generation) ──────
    // The receptionist can apply an extra bill-level discount at
    // settlement time — e.g. patient is bargaining, doctor approves a
    // courtesy waiver, or a calculation needs to round off. Stored as
    // an absolute Decimal128 amount so we can support either a flat
    // ₹ value or the result of a percentage applied at save time.
    // Reduces netAmount + patientPayableAmount in the pre-save hook;
    // never goes negative. Every change is captured in adjustmentLog
    // for NABH audit.
    extraDiscount:        { type: Dec, default: () => toDec(0) },
    extraDiscountReason:  { type: String, trim: true },
    extraDiscountBy:      { type: String, trim: true },

    // Append-only audit trail for any post-generation edit (line item
    // qty/price change, extra discount). Each entry captures who, when,
    // why, plus a before/after snapshot so we can reconstruct the bill
    // state at any point in time.
    adjustmentLog: [
      {
        at:      { type: Date, default: Date.now },
        by:      { type: String, trim: true },
        type:    { type: String, enum: ["LINE_EDIT", "EXTRA_DISCOUNT", "BOTH"], default: "BOTH" },
        reason:  { type: String, trim: true },
        before:  { type: mongoose.Schema.Types.Mixed },
        after:   { type: mongoose.Schema.Types.Mixed },
      },
    ],

    // ── Payments ──────────────────────────────────────────
    payments: [PaymentSchema],

    // ── Status ────────────────────────────────────────────
    // R7aw-FIX-8/D7: GENERATING is a short-lived intermediate state used
    // by generateFinalBill to serialise concurrent generate calls via a
    // findOneAndUpdate(DRAFT → GENERATING) CAS claim. Always flips to
    // GENERATED inside the same request (or rolls back to DRAFT on
    // validation failure). Reads ignore it (treated as a pending DRAFT).
    billStatus: {
      type: String,
      enum: ["DRAFT", "GENERATING", "GENERATED", "PARTIAL", "PAID", "CANCELLED", "REFUNDED"],
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
    // R7bb-FIX-E-15 / D3-HIGH-2: maker-checker on TPA approval. The
    // user who SUBMITTED the preauth cannot also APPROVE the claim —
    // otherwise a single TPA Coordinator can move from preauth straight
    // to approval with no second eye. The controller refuses if
    // req.user._id === tpaPreAuthSubmittedById on tpaApprove.
    tpaPreAuthSubmittedBy:   { type: String, trim: true, default: null },
    tpaPreAuthSubmittedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    tpaPreAuthSubmittedAt:   { type: Date, default: null },
    tpaApprovedBy:           { type: String, trim: true, default: null },
    tpaApprovedById:         { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    tpaApprovedAt:           { type: Date, default: null },

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

// ── Recalc helper ───────────────────────────────────────────────
// R7b: extracted from the pre-save hook so other code paths
// (settlementAdjust, audit log "after" snapshots) can mirror what the
// hook would compute WITHOUT triggering an extra save. Pure mutation
// of `this` — totals + per-item snapshots are written in place; the
// caller decides when to persist.
PatientBillSchema.methods.recalcTotals = function () {
  // Recalculate totals from items
  if (this.billItems && this.billItems.length > 0) {
    let gross = 0,
      disc = 0,
      tax = 0,
      tpaPay = 0,
      ptPay = 0;
    // Pending orders (Ordered / InProgress) accumulate into a parallel
    // bucket so the UI can show "₹X coming once those orders complete"
    // without affecting what the patient owes right now.
    let pendingNet = 0;

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

      // Per-item snapshot fields stay accurate for ALL items (including
      // pending orders) so the UI can render the row's expected total.
      // Only the bill-level aggregates differ.
      item.grossAmount    = toDec(gAmt);
      item.discountAmount = toDec(dAmt);
      item.netAmount      = toDec(nAmt);
      item.taxAmount      = toDec(tAmt);
      // R7ap-F35/D6-04/D6-16: CGST/SGST/IGST split. Default intra-state
      // (placeOfSupply blank or matches hospital state) → 50/50 CGST+SGST.
      // Inter-state (placeOfSupply differs) → 100% IGST. Bill-level
      // placeOfSupply is the single source — items inherit from parent.
      // R7au-FIX-7/D6-HIGH-C7: also treat a non-zero bill-level
      // `igstAmount` as an inter-state marker for LEGACY bills imported
      // without `placeOfSupply` (pre-F18 data). Without this, recalcTotals
      // re-derives 50/50 CGST/SGST and silently zeros out the legacy
      // IGST — register/snapshot under-reports inter-state IGST.
      const _hosp = (this.constructor?.HOSPITAL_STATE_CODE || process.env.HOSPITAL_STATE_CODE || "").trim();
      const _legacyIgst = this.igstAmount != null && Number(this.igstAmount.toString ? this.igstAmount.toString() : this.igstAmount) > 0;
      const _isInterState =
        (_hosp && this.placeOfSupply && String(this.placeOfSupply).trim() !== _hosp) ||
        _legacyIgst;
      if (_isInterState) {
        item.cgstAmount = toDec(0);
        item.sgstAmount = toDec(0);
        item.igstAmount = toDec(tAmt);
      } else {
        item.cgstAmount = toDec(tAmt / 2);
        item.sgstAmount = toDec(tAmt / 2);
        item.igstAmount = toDec(0);
      }

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

      // Skip non-billable items (Ordered / InProgress / Cancelled) from
      // the bill aggregate. Backward-compat: missing orderStatus is
      // treated as Completed via isItemBillable() so legacy bills behave
      // identically to before this field was introduced.
      //
      // R7ar-P0-4/D1-aq-01: ALSO skip items marked excludedByPackage —
      // these are pre-package per-line charges (bed, nursing, doctor visit)
      // that have been superseded by an attached ANH package. Pre-R7ar
      // recalcTotals ignored the flag → receipts double-counted.
      if (isItemBillable(item) && !item.excludedByPackage) {
        gross  += gAmt;
        disc   += dAmt;
        tax    += tAmt;
        tpaPay += tpaShare;
        ptPay  += ptShare;
      } else if (item.orderStatus !== "Cancelled") {
        // Cancelled items contribute to NOTHING — pending bucket captures
        // only Ordered + InProgress (the "coming soon" charges).
        pendingNet += lineTotal;
      }
    });

    this.pendingOrdersAmount = toDec(pendingNet);

    // Settlement-time extra discount — capped at the patient share so the
    // patient never owes a negative amount, and to totalDiscount so the
    // "Discount" KPI on receipts reflects the true concession given. We
    // apply the cap before mutating ptPay so the math stays consistent
    // even when the cashier types a huge round-off by accident.
    const extra = Math.min(Math.max(0, toNum(this.extraDiscount) || 0), ptPay);

    this.grossAmount          = toDec(gross);
    this.totalDiscount        = toDec(disc + extra);
    this.taxAmount            = toDec(tax);
    this.netAmount            = toDec(gross - disc + tax - extra);
    this.tpaPayableAmount     = toDec(tpaPay);
    this.patientPayableAmount = toDec(ptPay - extra);
    // R7ap-F35: aggregate item-level CGST/SGST/IGST into bill-level fields.
    // Driven by placeOfSupply (set above per-item). Used by GSTR-1 export.
    const _hosp = process.env.HOSPITAL_STATE_CODE || "";
    const _isInter = _hosp && this.placeOfSupply && String(this.placeOfSupply).trim() !== _hosp;
    if (_isInter) {
      this.cgstAmount = toDec(0);
      this.sgstAmount = toDec(0);
      this.igstAmount = toDec(tax);
    } else {
      this.cgstAmount = toDec(tax / 2);
      this.sgstAmount = toDec(tax / 2);
      this.igstAmount = toDec(0);
    }
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
};

// ── Pre-save: bill number (for non-DRAFT) + recalculate all totals ─
// R7at-FIX-11/D1-CRIT-NEW: pre-R7at this hook burned a billNumber on EVERY
// new bill — including DRAFTs. Then `generateFinalBill` overwrote it with
// a fresh `generateBillNumber()` call. Net effect: every finalized bill
// consumed TWO sequence positions, plus every cancelled DRAFT orphaned
// one number — IT-Rule-46 gap-less series invariant broken on every
// bill. The fix: only burn a billNumber when the bill is created in a
// non-DRAFT state (rare — most paths create DRAFT first then call
// generateFinalBill); DRAFT bills get their number at finalisation only.
PatientBillSchema.pre("save", async function (next) {
  if (this.isNew && !this.billNumber && this.billStatus && this.billStatus !== "DRAFT") {
    const year = new Date().getFullYear();
    const seq  = await nextSeqBill(`bill:${year}`);
    this.billNumber = `BILL-${year}-${String(seq).padStart(6, "0")}`;
  }
  this.recalcTotals();
  next();
});

PatientBillSchema.index({ UHID: 1 });
PatientBillSchema.index({ patient: 1 });
PatientBillSchema.index({ admission: 1 });
PatientBillSchema.index({ billStatus: 1 });
PatientBillSchema.index({ visitType: 1 });
PatientBillSchema.index({ billDate: -1 });
PatientBillSchema.index({ tpa: 1 });
// R7t: Revenue-breakdown reports filter `billStatus != DRAFT` and sort by
// createdAt — this compound covers that scan. Same for the dashboard
// "today's bills" feed.
PatientBillSchema.index({ billStatus: 1, createdAt: -1 });
PatientBillSchema.index({ UHID: 1, billStatus: 1, createdAt: -1 });

// R7ap-F14/D1-12/D8-01/D8-05: compound indexes for dashboard hot paths.
//   {paidAt, billStatus}        — todayRevenue (`$unwind payments` aggregate)
//   {billStatus, paymentType, billDate} — listBills filter+sort
//   {paymentType, tpaClaimStatus, updatedAt} — getTPACases
// Previously these queries did in-memory sorts / picked partial indexes;
// at 10k bills/mo the All Bills tab took 800ms-2s, TPA tab 500ms-2s.
PatientBillSchema.index({ paidAt: -1, billStatus: 1 });
PatientBillSchema.index({ billStatus: 1, paymentType: 1, billDate: -1 });
PatientBillSchema.index({ paymentType: 1, tpaClaimStatus: 1, updatedAt: -1 });
// R7at-FIX-13/D8-HIGH-R7as-2: index on `billGeneratedAt` (immutable bill
// finalisation timestamp). R7as-FIX-6 switched the hospital GST register
// + snapshot cron to filter by this field, but no index existed — every
// monthly tax query did a collscan over 50k-200k rows. Compound with
// billStatus covers the `$nin: [DRAFT, CANCELLED]` predicate.
PatientBillSchema.index({ billGeneratedAt: -1, billStatus: 1 });

// payments.paidAt is the new attribution field for getCollectionSummary.
// Multikey index lets the query pick up bills with any payment row in the
// day window without scanning the full collection.
PatientBillSchema.index({ "payments.paidAt": -1 });

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

// Companion index for OPD/Service/Walk-in DRAFTs where `admission` is null
// — the index above treats {null, null} pairs as distinct, so without
// this second guard two receptionists could simultaneously POST
// /api/billing/create for the same OPD patient and end up with split
// drafts. Filters on both DRAFT status AND admission=null so it doesn't
// fight with the admission-scoped index above.
PatientBillSchema.index(
  { UHID: 1, visitType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      billStatus: "DRAFT",
      admission: null,
    },
  }
);

// Enable optimistic concurrency — every save() bumps __v and refuses to
// overwrite a stale snapshot. recordPayment uses this with a retry loop so
// two cashiers taking payment from the same bill at the same instant can't
// silently clobber each other's payment row.
PatientBillSchema.set("optimisticConcurrency", true);

module.exports =
  mongoose.models.PatientBill ||
  mongoose.model("PatientBill", PatientBillSchema);
