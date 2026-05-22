// models/Pharmacy/KitchenIndentModel.js
// ════════════════════════════════════════════════════════════════════
// R7bj-F2 — KitchenIndent close-loop (R7bi-1-CRIT-10/12/13/16,
// R7bi-DK-CRIT-1/2/3/4, R7bi-KI-CRIT-2).
//
// Pre-R7bb the dietitian created a PatientDietPlan but the kitchen had
// no signal that a meal was due — the plan sat in MongoDB while the
// cook ran on verbal handovers and the previous day's tray list. NABH
// COP.18 + JCI FMS expect a documented diet order → kitchen-receipt
// trail with timestamps and an allergen / texture flag.
//
// Pre-R7bj the indent model only had PENDING/PREPARED/SERVED — there
// was no DELIVERED state, no per-meal cost / billing-trigger
// association, no chain-of-custody on the Ward Boy handover, no
// retention TTL, and no actor trios for prepared/served/delivered.
// R7bi-1-CRIT-13 noted there was no controller at all to flip the
// lifecycle; R7bi-KI-CRIT-2 noted the missing DELIVERED state; the
// DK-CRIT-* findings noted that every meal served was free because the
// kitchen had no billing hook.
//
// R7bj-F2 extends the schema for the close-loop:
//   • DELIVERED added to the state machine (chain of custody)
//   • unitPrice / totalAmount as Decimal128 (per-meal cost; F5 / F-coord
//     will add "DIET_MEAL" / "KitchenIndent" / "Kitchen" / "Ward Boy"
//     to BillingTrigger enums — current emit uses "AutoCharge" + notes)
//   • billingTriggerId back-ref so a void / refund can walk the chain
//   • preparedById/Name + servedById/Name + deliveredById/Name/Role
//     actor trios
//   • retainUntil + TTL index — completed rows reclaimed at 90 days
//   • printCount for duplicate-watermark on the indent slip
//
// Each row = one meal slot for one patient. The dietitian's
// pushToKitchenIndent() service method fans out one row per meal in
// the plan (now atomic via withTransaction + bulkWrite upsert); the
// kitchen marks them PREPARED → SERVED as trays leave; SERVED emits a
// per-meal BillingTrigger; the Ward Boy then marks DELIVERED at the
// bed for the chain-of-custody close.
//
// Model moved Backend/models/Clinical/ → Backend/models/Pharmacy/ per
// R7bj-F2 spec — collection name unchanged (mongoose.model name +
// pluralised) so existing rows are reused.
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
const { toDec, decimalToNumber } = require("../../utils/money");
const Dec = mongoose.Schema.Types.Decimal128;

const KitchenIndentSchema = new mongoose.Schema(
  {
    // ── Source plan ───────────────────────────────────────────────
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "PatientDietPlan",
      required: true,
      index: true,
    },

    // ── Patient identity (denormalised for kitchen UI) ─────────────
    UHID:        { type: String, trim: true, required: true, uppercase: true, index: true },
    patientName: { type: String, trim: true, default: "" },
    admissionId: { type: mongoose.Schema.Types.ObjectId, ref: "Admission", default: null },
    ipdNo:       { type: String, trim: true, default: "" },
    bedNumber:   { type: String, trim: true, default: "" },
    ward:        { type: String, trim: true, default: "" },

    // ── Meal details ─────────────────────────────────────────────
    mealSlot: {
      type: String,
      enum: [
        "EARLY_MORNING", "BREAKFAST", "MID_MORNING",
        "LUNCH", "AFTERNOON_SNACK",
        "DINNER", "BEDTIME", "RT_FEED", "OTHER",
      ],
      required: true,
      index: true,
    },
    mealSlotLabel: { type: String, trim: true, default: "" },        // human label from the plan
    scheduledFor:  { type: Date,   required: true, index: true },    // when the kitchen should serve it
    // R7bj-F2: hospital-IST day key (YYYY-MM-DD) anchored from
    // scheduledFor. Doubles as the upsert dedup dimension for
    // pushToKitchenIndent's bulkWrite — atomic by (planId, mealSlot, dateKey).
    dateKey: { type: String, trim: true, default: "", index: true },
    items: { type: [String], default: [] },                          // meal items en
    instructions: { type: String, trim: true, default: "" },

    // ── Safety flags (used by kitchen staff) ─────────────────────
    allergens:        { type: [String], default: [] },     // structured list
    contraindications:{ type: [String], default: [] },
    targetCalories:   { type: Number, default: null },
    targetProtein:    { type: Number, default: null },
    fluidRestriction: { type: Number, default: null },
    saltRestriction:  { type: Number, default: null },
    foodPreference:   {
      type: String,
      enum: ["vegetarian", "non-vegetarian", "eggetarian", "vegan", "jain", ""],
      default: "",
    },
    swallowingNote:   {
      type: String,
      enum: ["normal", "difficulty", "tube-fed", ""],
      default: "normal",
    },

    // ── Per-meal cost (R7bj-F2 / R7bi-DK-CRIT-1) ─────────────────
    // Stored as Decimal128 so long-stay admissions don't drift on
    // float arithmetic — toJSON unwraps via utils/money.decimalToNumber.
    unitPrice:   { type: Dec, default: () => toDec(0) },
    totalAmount: { type: Dec, default: () => toDec(0) },
    // Back-ref so a void / refund on the trigger can walk back to the
    // indent row (and so the kitchen UI can flag "already billed").
    billingTriggerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "BillingTrigger",
      default: null,
      index: true,
    },

    // ── Lifecycle ────────────────────────────────────────────────
    // R7bj-F2 / R7bi-KI-CRIT-2: DELIVERED added as a chain-of-custody
    // terminal. SERVED = tray left the kitchen, DELIVERED = handed
    // over at the bed by a Ward Boy / nurse.
    status: {
      type: String,
      enum: ["PENDING", "PREPARED", "SERVED", "DELIVERED", "CANCELLED"],
      default: "PENDING",
      index: true,
    },

    // ── Actor trios (R7bj-F2) ────────────────────────────────────
    preparedById:    { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    preparedByName:  { type: String, trim: true, default: "" },
    preparedByRole:  { type: String, trim: true, default: "" },
    preparedAt:      { type: Date, default: null },

    servedById:      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    servedByName:    { type: String, trim: true, default: "" },
    servedByRole:    { type: String, trim: true, default: "" },
    servedAt:        { type: Date, default: null },

    deliveredById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deliveredByName: { type: String, trim: true, default: "" },
    deliveredByRole: { type: String, trim: true, default: "" },
    deliveredAt:     { type: Date, default: null },

    cancelledAt:     { type: Date, default: null },
    cancelledById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelledByName: { type: String, trim: true, default: "" },
    cancelReason:    { type: String, trim: true, default: "" },

    // ── Print metadata (R7bj-F2) ─────────────────────────────────
    printCount: { type: Number, default: 0, min: 0 },

    // ── Retention (R7bj-F2) ──────────────────────────────────────
    // TTL guard — set 90 days after the row reaches a terminal state.
    // Mongo's TTL monitor reclaims the row when retainUntil < now.
    // PENDING/PREPARED rows leave this null so a lingering tray is
    // never silently expired.
    retainUntil: { type: Date, default: null },

    // ── Audit (who pushed the indent) ────────────────────────────
    createdBy:     { type: String, trim: true, default: "" },
    createdById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdByRole: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

KitchenIndentSchema.index({ scheduledFor: 1, status: 1 });
KitchenIndentSchema.index({ UHID: 1, scheduledFor: -1 });
// R7bj-F2 — atomic upsert dedup key for pushToKitchenIndent's bulkWrite.
// (planId, mealSlot, dateKey) is unique per "this plan's meal-slot on
// this calendar day". Pre-R7bj the dedup ran a find-then-update loop
// (R7bi-1-CRIT-10 — race window between dietitian re-clicks). Partial
// filter so cancelled rows can coexist on the same dedup key.
KitchenIndentSchema.index(
  { planId: 1, mealSlot: 1, dateKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      dateKey: { $exists: true, $type: "string" },
      status:  { $in: ["PENDING", "PREPARED", "SERVED", "DELIVERED"] },
    },
    name: "uniq_indent_per_plan_slot_day",
  },
);
// R7bj-F2 — TTL on terminal rows. Mongo deletes the doc once
// `retainUntil` is in the past. Active rows (retainUntil:null) are
// kept indefinitely; the service stamps retainUntil only on
// SERVED/DELIVERED/CANCELLED transitions.
KitchenIndentSchema.index(
  { retainUntil: 1 },
  { expireAfterSeconds: 0, name: "ttl_kitchen_indent_retention" },
);

// R7bj-F2 — serialize Decimal128 money fields back to plain Numbers on
// toJSON / toObject so the wire shape stays unchanged for the kitchen
// console + IPD ledger reads. Without this the frontend's currency
// formatter chokes on { $numberDecimal: "30.00" }.
KitchenIndentSchema.set("toJSON",   { transform: decimalToNumber });
KitchenIndentSchema.set("toObject", { transform: decimalToNumber });

module.exports =
  mongoose.models.KitchenIndent ||
  mongoose.model("KitchenIndent", KitchenIndentSchema);
