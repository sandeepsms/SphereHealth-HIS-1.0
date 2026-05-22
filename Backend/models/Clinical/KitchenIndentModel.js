// models/Clinical/KitchenIndentModel.js
// ════════════════════════════════════════════════════════════════════
// R7bb-FIX-E-9/D6-CRIT-6: KitchenIndent — Dietitian-to-kitchen handoff.
//
// Pre-R7bb the dietitian created a PatientDietPlan but the kitchen had
// no signal that a meal was due — the plan sat in MongoDB while the
// cook ran on verbal handovers and the previous day's tray list. NABH
// COP.18 + JCI FMS expect a documented diet order → kitchen-receipt
// trail with timestamps and an allergen / texture flag.
//
// Each row = one meal slot for one patient. The dietitian's
// pushToKitchenIndent() service method fans out one row per meal in
// the plan; the kitchen marks them PREPARED → SERVED as trays leave.
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");

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

    // ── Lifecycle ────────────────────────────────────────────────
    status: {
      type: String,
      enum: ["PENDING", "PREPARED", "SERVED", "CANCELLED"],
      default: "PENDING",
      index: true,
    },
    preparedAt:   { type: Date, default: null },
    servedAt:     { type: Date, default: null },
    cancelledAt:  { type: Date, default: null },

    cancelReason: { type: String, trim: true, default: "" },

    // ── Audit (who pushed the indent) ────────────────────────────
    createdBy:     { type: String, trim: true, default: "" },
    createdById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdByRole: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

KitchenIndentSchema.index({ scheduledFor: 1, status: 1 });
KitchenIndentSchema.index({ UHID: 1, scheduledFor: -1 });

module.exports =
  mongoose.models.KitchenIndent ||
  mongoose.model("KitchenIndent", KitchenIndentSchema);
