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
    // R7hr(NABH-P3.4) — gap-less per-payment receipt serial (REC-YY-N,
    // FY-keyed like BILL). Minted by billingService.generatePaymentReceipt
    // Number for cashier-collected money (recordPayment, bulk-collect
    // legs, discharge waterfall). ADVANCE_ADJUSTMENT rows carry none —
    // that money was receipted at deposit time (ADV-…) and this is an
    // internal transfer, not new money in.
    receiptNumber: { type: String, trim: true, index: true },
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
    // BILL-2026-000001 (auto-generated on finalisation only)
    //
    // R7bp-FIX (audit P0 — billNumber dup-null E11000): the unique index
    // is declared SEPARATELY below as a PARTIAL index filtered to
    // `{ billNumber: { $type: "string" } }`. We deliberately do NOT use
    // `unique: true` here because:
    //   1. Field-level `unique: true` generates a plain unique index that
    //      treats `null` as a value — only ONE null is allowed across the
    //      whole collection. With multiple concurrent DRAFT bills (no
    //      billNumber yet) the second insert blows up with E11000.
    //   2. `sparse: true` is not enough either — sparse only skips
    //      documents where the FIELD IS ABSENT. A document with
    //      `billNumber: null` is still indexed and still collides.
    //   3. A partial filter on `$type: "string"` indexes only documents
    //      where billNumber is an actual assigned string — so multiple
    //      null/absent DRAFT bills coexist freely, while finalised bills
    //      remain uniquely numbered (IT-Rule-46 gap-less invariant
    //      preserved by the Counter sequence).
    //
    // Migration script `scripts/fixBillNumberIndex.js` drops the legacy
    // `billNumber_1` plain-unique index from existing databases and
    // creates this partial replacement. Mongoose only creates indexes
    // declared in code if the index NAME is missing — once the legacy
    // index is dropped, Mongoose auto-builds the new partial one on
    // next syncIndexes() (or the migration script does it explicitly).
    billNumber: { type: String, default: null },

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

    // R7bw — exact-match linkage to the OPDRegistration document (visitNumber)
    // OR the IPD admission's visit identifier. Pre-R7bw PatientBill had NO
    // per-visit FK, so the patient-history aggregator (getOPDHistory) was
    // forced to do a same-day-proximity join (`chargeDate ≈ visit.visitDate`)
    // to attach bill items to a specific OPD visit. That mis-pooled bill
    // items across visits whenever a patient had > 1 OPD visit on the same
    // calendar day (return-visit, multi-department, OPD→IPD-conversion-day).
    //
    // For OPD bills `visitId === OPDRegistration.visitNumber` (e.g.
    // "OPD-2026-000123"). For IPD/DAYCARE/EMERGENCY bills the field MAY be
    // populated with admission.admissionNumber by future work, but the
    // primary join key for those bills remains the `admission` ObjectId
    // ref — visitId is included on those rows only as a denormalised
    // shortcut for clients that filter by string identifier (mirrors the
    // DoctorOrder.visitId convention).
    //
    // Indexed so the aggregator's `{ UHID, visitType, visitId }` lookup is
    // covered by an index instead of collscanning all OPD bills per UHID.
    visitId: { type: String, index: true, default: null },

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
    // R7hr(NABH-P3.1) — invoice round-off (standard GST invoice
    // presentation): the patient share is rounded to the nearest rupee in
    // recalcTotals and the signed difference lives here (−0.50..+0.49),
    // rendered as its own "Round Off" line on the tax invoice. TPA share
    // stays exact — insurers settle to the paisa.
    roundOffAmount:       { type: Dec, default: () => toDec(0) },
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
      default: "DRAFT",
      // R7bp-FIX (audit Dim 4): a FINAL bill must carry a billNumber.
      // The pre-save hook already burns a number when a non-DRAFT bill
      // is inserted; this validator is a belt-and-braces check so an
      // accidental status-flip on an existing DRAFT (e.g. a controller
      // bypassing finaliseBill) can't produce a finalised PatientBill
      // without an IT-Rule-46 series number.
      //
      // Path validators that need access to a sibling field use `this`
      // (the document). Returns true when the invariant holds, false
      // when it's violated. Implemented as `validate: { validator }`
      // rather than a pre-save hook so it composes cleanly with
      // existing pre-save logic (recalcTotals, write-off guard) and
      // can be skipped by `{ validateBeforeSave: false }` paths that
      // legitimately want to bypass it (the GENERATING → DRAFT
      // rollback inside generateFinalBill is one such case).
      validate: {
        validator: function (status) {
          // DRAFT, GENERATING, CANCELLED can have null billNumber.
          // GENERATED / PARTIAL / PAID / REFUNDED must have a string billNumber.
          const finalised = ["GENERATED", "PARTIAL", "PAID", "REFUNDED"];
          if (!finalised.includes(status)) return true;
          return typeof this.billNumber === "string" && this.billNumber.length > 0;
        },
        message:
          "billNumber is required when billStatus is GENERATED/PARTIAL/PAID/REFUNDED " +
          "(IT-Rule-46 gap-less series — formal bills must carry a number).",
      },
    },

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
        "SETTLED_WRITEOFF",    // TPA paid short, hospital absorbed gap via writeOffAmount
      ],
      default: "NOT_APPLICABLE" },
    tpaClaimNumber: { type: String, trim: true },
    tpaApprovedAmount: { type: Dec, default: () => toDec(0) },
    // R7hr(NABH-P3.5) — structured pre-auth capture. Insurers issue a
    // distinct pre-auth/AL number and a sanctioned amount BEFORE the final
    // claim approval; both previously squatted on tpaClaimNumber /
    // tpaPayableAmount, so the desk couldn't show "sanctioned vs claimed
    // vs approved" side by side.
    tpaPreAuthNumber: { type: String, trim: true, default: "" },
    tpaPreAuthAmount: { type: Dec, default: () => toDec(0) },
    // R7hr(TPA-P2) — insurer query → reply loop. Insurers raise queries on
    // submitted claims (missing docs, clarification); pre-P2 that exchange
    // lived in phone calls and the claim silently rotted. Each query is a
    // row here; replying logs the response; a REJECTED claim re-submits via
    // the existing tpa-preauth-submit route (ALLOWED_FROM includes
    // REJECTED). Open queries surface on the TPA Desk + MIS.
    tpaQueryLog: [
      {
        raisedAt:   { type: Date, default: Date.now },
        queryText:  { type: String, trim: true },
        recordedBy: String,            // staff who logged the insurer's query
        recordedByRole: String,
        repliedAt:  Date,
        replyText:  { type: String, trim: true },
        repliedBy:  String,
        status:     { type: String, enum: ["OPEN", "REPLIED"], default: "OPEN" },
      },
    ],
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

    // ── TPA write-off (R7bm-F6 / META-5) ──────────────────
    // When TPA reconciliation comes back short (approved ₹10,000, settled
    // ₹9,950), the hospital may choose to ABSORB the residual rather than
    // pursue the patient for it. This is a write-off — semantically
    // different from a denial. The TPA register renders "approved ₹X,
    // settled ₹Y, wrote off ₹Z" without double-counting denials.
    //
    // Pre-R7bm the controller (billingController.tpaSettle) was writing
    // these fields onto the bill, but the schema didn't declare them —
    // Mongoose strict-mode silently dropped them, losing the audit
    // trail. Now declared as proper Decimal128 (money) + audit fields.
    //
    // Append-only semantics enforced by the pre-save guard below:
    // writeOffAmount can only GROW (multiple partial settlements may
    // accrue write-offs on a single bill); it cannot decrease or be
    // cleared without an admin force (caught by Mongoose schema +
    // controller-level checks, not enforced here).
    writeOffAmount: { type: Dec, default: () => toDec(0) },
    writeOffReason: { type: String, trim: true, default: null },
    writeOffBy:     { type: String, trim: true, default: null },
    writeOffAt:     { type: Date, default: null },

    // ── Dates & Audit ─────────────────────────────────────
    billDate: { type: Date, default: Date.now },
    billGeneratedAt: { type: Date },
    paidAt: { type: Date },
    generatedBy: { type: String, trim: true },
    remarks: { type: String, trim: true },
    // R7bf-F / A4-CRIT-4 + A4-CRIT-5: atomically incremented on every
    // print/reprint. Source of truth for the DUPLICATE watermark
    // (count > 1 → watermark renders).  Defaults to 0; the PrintAudit
    // POST `$inc`s it to 1 on the first print.
    printCount: { type: Number, default: 0, min: 0 } },
  {
    timestamps: true,
    // Serialize Decimal128 → Number on the wire so the existing frontend
    // (which does .toFixed(), arithmetic, etc.) keeps working as-is. The
    // database still stores the precise Decimal128 value — only the JSON
    // representation is flattened.
    toJSON:   { virtuals: true, transform: decimalToNumber },
    toObject: { virtuals: true, transform: decimalToNumber } },
);

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
    this.tpaPayableAmount     = toDec(tpaPay);
    // R7hr(NABH-P3.1) — round the PATIENT share to the nearest rupee
    // (standard GST invoice presentation; fractional paise arise from %
    // discounts, 5% room-rent GST, half-day prorations). The signed
    // difference is stored on roundOffAmount and printed as its own line.
    // netAmount absorbs the same delta so gross − disc + tax − extra +
    // roundOff == tpaShare + rounded patient share stays an identity.
    // TPA share stays exact (insurers settle to the paisa); balanceAmount
    // below derives from the ROUNDED patient share, so cash dues are
    // always collectible whole-ish rupees. Whole-rupee bills get
    // roundOff = 0 — zero visible change for existing data.
    const _ptExact   = ptPay - extra;
    const _ptRounded = Math.round(_ptExact);
    const _roundOff  = +(_ptRounded - _ptExact).toFixed(2);
    this.roundOffAmount       = toDec(_roundOff);
    this.patientPayableAmount = toDec(_ptRounded);
    this.netAmount            = toDec(gross - disc + tax - extra + _roundOff);
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
// R7bm-F6 / META-5 — snapshot writeOffAmount on document load so the
// pre-save append-only guard can compare against the pre-mutation value.
// Mongoose doesn't expose a stable "previous value" API for embedded
// Decimal128 across all driver versions, so we keep our own snapshot.
PatientBillSchema.post("init", function () {
  try {
    this._priorWriteOffAmount = toNum(this.writeOffAmount);
  } catch (_) {
    this._priorWriteOffAmount = 0;
  }
});

// R7hr(NABH-P1.2) — number-minting fallback for bills CREATED directly in a
// non-DRAFT state. Two fixes in one:
//   (1) It now delegates to the SAME generator the service layer uses. The
//       old fallback minted `BILL-YYYY-NNNNNN` off its own counter key
//       (`bill:${YYYY}`) while generateBillNumber mints `BILL-YY-NN` off
//       `bill:${YY}` — two independent series in two formats, and the short
//       series was invisible to sequenceAudit. One generator ⇒ one gap-less
//       series (IT Rule 46 / §44AB).
//   (2) It runs in pre("validate"), not pre("save"). Mongoose validates
//       BEFORE pre-save hooks, and the R7bp path-validator ("non-DRAFT ⇒
//       billNumber present") therefore rejected the document before the old
//       pre-save fallback ever got to mint — the fallback was dead code and
//       direct non-DRAFT creation always ValidationError'd. Minting in
//       pre("validate") restores the safety net: number first, validator
//       passes, invariant intact.
// Lazy require: billingService requires this model at load, so a top-level
// import here would be circular; at validate time both modules are loaded.
PatientBillSchema.pre("validate", async function (next) {
  try {
    if (this.isNew && !this.billNumber && this.billStatus && this.billStatus !== "DRAFT") {
      const { generateBillNumber } = require("../../services/Billing/billingService");
      this.billNumber = await generateBillNumber();
    }
    next();
  } catch (e) {
    next(e);
  }
});

PatientBillSchema.pre("save", async function (next) {

  // R7bm-F6 / META-5 — append-only guard on writeOffAmount.
  // Write-offs represent finance-team approved residual absorption on
  // TPA short-pays; once stamped, they are part of the GST register's
  // CDNR-adjacent narrative and CANNOT be silently reversed (that would
  // re-open the patient's liability without a counter-entry). The only
  // legal mutation is monotonic increase (additional shortfalls on
  // later partial settlements accrue onto the same bill). To clear or
  // reduce a write-off, the cashier MUST go through a credit-note /
  // reversal flow that emits its own audit row.
  if (!this.isNew && this.isModified("writeOffAmount")) {
    const prior = Number(this._priorWriteOffAmount) || 0;
    const now   = toNum(this.writeOffAmount);
    if (prior > 0 && now + 0.0001 < prior) {
      const err = new Error(
        `writeOffAmount is append-only: cannot decrease ${prior.toFixed(2)} → ${now.toFixed(2)}. ` +
        `Issue a credit note / reversal instead.`,
      );
      err.code = "WRITEOFF_APPEND_ONLY";
      err.statusCode = 409;
      err.status = 409;
      return next(err);
    }
    // When a new write-off lands (amount grew) and the caller forgot to
    // stamp the audit timestamp, fill it in defensively. writeOffBy is
    // intentionally NOT fabricated here — the controller is the
    // authoritative source for "who authorised this absorption" and a
    // null actor must surface in the GST register rather than be hidden
    // behind a "System" placeholder.
    if (now > prior && !this.writeOffAt) {
      this.writeOffAt = new Date();
    }
  }

  this.recalcTotals();

  // Refresh the snapshot for any subsequent save() within the same
  // request lifecycle (e.g. tpaSettle → save → secondary mutation).
  this._priorWriteOffAmount = toNum(this.writeOffAmount);
  next();
});

// R7bp-FIX (audit P0 — billNumber dup-null E11000): partial unique index.
// Only enforces uniqueness on documents where billNumber is an actual
// string. DRAFT bills carrying `billNumber: null` (or missing the field
// entirely) are excluded from the index — they can coexist freely, which
// is what NABH / Indian-healthcare practice expects: bill numbers are
// formal financial-document identifiers, only stamped at finalisation.
//
// Named explicitly so the migration script can drop the legacy
// `billNumber_1` plain-unique index and Mongoose syncIndexes() can
// reconcile by NAME on next startup.
PatientBillSchema.index(
  { billNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { billNumber: { $type: "string" } },
    name: "billNumber_unique_partial",
  },
);

PatientBillSchema.index({ UHID: 1 });
PatientBillSchema.index({ patient: 1 });
PatientBillSchema.index({ admission: 1 });
PatientBillSchema.index({ billStatus: 1 });
PatientBillSchema.index({ visitType: 1 });
PatientBillSchema.index({ billDate: -1 });
PatientBillSchema.index({ tpa: 1 });
// R7bw — exact-match patient-history aggregator lookup: `{ UHID, visitType,
// visitId }`. Single-field `visitId` index above covers cross-UHID admin
// queries; this compound covers the per-patient OPD-history call which is
// hot on the OPD History tab. Order matches selectivity (UHID first cuts
// the document set ~10000x).
// R7t: Revenue-breakdown reports filter `billStatus != DRAFT` and sort by
// createdAt — this compound covers that scan. Same for the dashboard
// "today's bills" feed.
PatientBillSchema.index({ billStatus: 1, createdAt: -1 });
PatientBillSchema.index({ UHID: 1, billStatus: 1, createdAt: -1 });
PatientBillSchema.index({ UHID: 1, visitType: 1, visitId: 1 });

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

// R7bh-F1 (R7bg-9-CRIT-5): sparse index on payments.voidedAt. Day Book
// + IncomeService + DashboardsController each evaluate
// `$or:[{"payments.paidAt": dayWindow}, {"payments.voidedAt": dayWindow}]`
// for the reversed-refund leg (so a void on day D shows up in D's
// collection). Pre-R7bh that branch fell back to COLLSCAN — the only
// payments.* indexes covered paidAt. Sparse so existing un-voided
// payments don't bloat the index; multikey across the embedded array.
PatientBillSchema.index(
  { "payments.voidedAt": -1 },
  { sparse: true, name: "payment_voidedAt_sparse" },
);

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

// R7bf-I / A7-HIGH-2 + A7-HIGH-3 — billStatus state-machine guard.
// Pre-R7bf nothing prevented a controller from flipping a PAID bill back
// to PARTIAL (the canonical "discount after payment" workaround that
// silently downgraded the ledger) or REFUNDED → GENERATED (which would
// double-charge the patient). The registry now treats PAID / REFUNDED /
// CANCELLED as terminal; admin force flag + audit row is required to
// override. The discount-after-payment workflow MUST instead create a
// CreditNote / refund row.
const { attachStatusGuard: _pbGuard } = require("../../utils/statusTransitionGuard");
_pbGuard(PatientBillSchema, { modelName: "PatientBill", field: "billStatus" });

// R7bf-I / A7-HIGH-3 — DRAFT bill cannot be deleted while a BillingTrigger
// references it. Pre-R7bf the DRAFT-deletion endpoint hard-deleted the
// PatientBill row; any BillingTrigger.linkedBillId still pointing at it
// was orphaned (the trigger said "billed" but the bill was gone, so the
// autoBilling reconciler never re-fired the charge).
async function _refuseDeleteIfTriggersReference(next) {
  try {
    const filter = (this.getFilter && this.getFilter()) || (this.getQuery && this.getQuery()) || {};
    const id = filter._id || filter.id;
    if (!id) return next();
    if (this.model && this.model.modelName === "PatientBill") {
      let BillingTrigger;
      try { BillingTrigger = require("../Billing/BillingTrigger"); } catch (_) { /* circular-load tolerant */ }
      if (!BillingTrigger) return next();
      // R7bh-F1 / META-2 (R7bg-6-CRIT-6): query field is `billId`, not
      // `linkedBillId`. Pre-R7bh `linkedBillId` returned 0 unconditionally
      // (no such field exists on BillingTrigger), so the guard never
      // tripped and bills with linked triggers could be hard-deleted —
      // leaving orphaned charges and breaking the autoBilling reconciler.
      const refCount = await BillingTrigger.countDocuments({ billId: id }).catch(() => 0);
      if (refCount > 0) {
        const err = new Error(
          `Cannot delete bill — ${refCount} BillingTrigger row(s) reference it. ` +
          `Cancel the bill instead (billStatus: CANCELLED) or detach the triggers first.`,
        );
        err.code = "BILL_HAS_LINKED_TRIGGERS";
        err.statusCode = 409;
        err.status = 409;
        return next(err);
      }
    }
    next();
  } catch (e) { next(e); }
}
PatientBillSchema.pre("findOneAndDelete", _refuseDeleteIfTriggersReference);
PatientBillSchema.pre("deleteOne",        _refuseDeleteIfTriggersReference);

module.exports =
  mongoose.models.PatientBill ||
  mongoose.model("PatientBill", PatientBillSchema);
