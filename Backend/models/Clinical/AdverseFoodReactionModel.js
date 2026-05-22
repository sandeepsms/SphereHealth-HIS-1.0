// models/Clinical/AdverseFoodReactionModel.js
// ════════════════════════════════════════════════════════════════════
// R7bj-F2 / R7bi-KI-CRIT-1 — Adverse Food Reaction register (NABH COP.21).
//
// Pre-R7bj the system tracked adverse drug reactions (ADRReportModel)
// but had nowhere to log a food-allergen incident — a patient reacting
// to a tray-served meal (peanut, gluten, shellfish, …) lived in
// freeform nurse notes only. NABH COP.21 + JCI FMS expect a documented
// food-ADR register with the meal item, suspected allergen, severity,
// onset window, action taken, outcome, and linkage back to the
// KitchenIndent row that served the suspect tray.
//
// Append-only auditTrail — every state mutation pushes one entry,
// never rewrites past ones — so a regulator review walks the row from
// OPEN → CLOSED / ESCALATED without losing detail.
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const AuditEntrySchema = new mongoose.Schema(
  {
    action:   String,             // "CREATED" | "UPDATED" | "CLOSED" | "ESCALATED" | "REOPENED"
    at:       { type: Date, default: Date.now },
    byName:   String,
    byRole:   String,
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reason:   String,
  },
  { _id: false },
);

const AdverseFoodReactionSchema = new mongoose.Schema(
  {
    // ── Patient identity ───────────────────────────────────────
    patientUHID:  { type: String, required: true, uppercase: true, trim: true, index: true },
    patientName:  { type: String, trim: true, default: "" },
    admissionId:  { type: mongoose.Schema.Types.ObjectId, ref: "Admission", default: null },

    // ── Source meal (close-loop to KitchenIndent) ──────────────
    // The suspect tray. Optional — a freshly admitted patient may
    // react to a meal brought from outside before the diet plan is
    // pushed, in which case the row stands alone.
    // Indexed via schema.index({ kitchenIndentId: 1 }) below — keeping
    // it off the inline definition avoids the Mongoose duplicate-index
    // warning at startup.
    kitchenIndentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "KitchenIndent",
      default: null,
    },
    mealItem:          { type: String, trim: true, default: "" },
    suspectedAllergen: { type: String, trim: true, default: "" },

    // ── Reaction details ───────────────────────────────────────
    reactionDescription: { type: String, trim: true, required: true },
    severity: {
      type: String,
      enum: ["MILD", "MODERATE", "SEVERE", "ANAPHYLAXIS"],
      required: true,
      index: true,
    },
    onsetMinutesAfterMeal: { type: Number, default: null },

    // ── Reporter trail ─────────────────────────────────────────
    reportedById:   { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reportedByName: { type: String, trim: true, default: "" },
    reportedByRole: { type: String, trim: true, default: "" },
    reportedAt:     { type: Date, default: Date.now },

    // ── Response trail ─────────────────────────────────────────
    actionTaken: { type: String, trim: true, default: "" },
    outcome: {
      type: String,
      enum: ["RESOLVED", "ONGOING", "REFERRED_TO_DOC", "ESCALATED"],
      default: "ONGOING",
    },
    // R7bj-F2 — link the doctor / nurse note that captured the
    // clinical response. No strict ref because either DoctorNotes
    // or NurseNotes can be the linked entity; the controller side
    // disambiguates by `linkedClinicalNoteModel` if needed.
    linkedClinicalNote: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "DoctorNotes",
      default: null,
    },

    // ── Lifecycle ──────────────────────────────────────────────
    status: {
      type: String,
      enum: ["OPEN", "CLOSED", "ESCALATED"],
      default: "OPEN",
      index: true,
    },

    // ── Multi-hospital scope ──────────────────────────────────
    hospitalId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    // ── Append-only audit trail ────────────────────────────────
    auditTrail: { type: [AuditEntrySchema], default: () => [] },
  },
  { timestamps: true },
);

AdverseFoodReactionSchema.index({ patientUHID: 1, reportedAt: -1 });
AdverseFoodReactionSchema.index({ kitchenIndentId: 1 });
AdverseFoodReactionSchema.index({ status: 1, severity: 1 });

module.exports =
  mongoose.models.AdverseFoodReaction ||
  mongoose.model("AdverseFoodReaction", AdverseFoodReactionSchema);
