// models/Lab/LabQCLogModel.js
// ════════════════════════════════════════════════════════════════════
// R7bb-FIX-E-8/D6-CRIT-5: LabQCLog — Quality-Control log for lab
// equipment running daily control samples (Bio-Rad, Levey-Jennings).
//
// NABH AAC.3 + ISO 15189 require labs to run a known-value control
// sample on each analyzer per shift / per day and retain those QC
// records for at least 2 years. Pre-R7bb the HIS had no place for
// this — labs were keeping paper logs that didn't tie to a result
// trail, leaving every routine biochem run effectively un-validated
// from the auditor's perspective.
//
// Each row = one QC event. The PASS/FAIL flag drives a downstream
// alert: when a control fails, no patient result against that
// equipment in that shift may be released until the corrective run
// passes (enforced at the order-verify endpoint in a later cycle).
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");

const LabQCLogSchema = new mongoose.Schema(
  {
    // ── Equipment ────────────────────────────────────────────────
    // equipmentId is optional — many small labs run controls per
    // bench / per chemistry analyzer without a registered asset id.
    // equipmentName is required so any QC row is human-readable.
    equipmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "Equipment",
      default: null,
      index: true,
    },
    equipmentName: { type: String, trim: true, required: true },

    // ── Control sample identification ────────────────────────────
    controlSampleLot: { type: String, trim: true, default: "" },
    controlLevel:     {
      type: String,
      enum: ["LOW", "NORMAL", "HIGH", "PATHOLOGICAL", "OTHER"],
      default: "NORMAL",
    },
    analyte:          { type: String, trim: true, default: "" },  // e.g. "Glucose", "Hb"
    expectedValue:    { type: Number, default: null },
    expectedRangeLow: { type: Number, default: null },
    expectedRangeHigh:{ type: Number, default: null },
    unit:             { type: String, trim: true, default: "" },

    actualValue:      { type: Number, default: null },

    // ── Result ───────────────────────────────────────────────────
    result: {
      type: String,
      enum: ["PASS", "FAIL"],
      required: true,
      index: true,
    },
    // Westgard rule violated (R7bb leaves this free-text for MVP).
    westgardRule:     { type: String, trim: true, default: "" },
    correctiveAction: { type: String, trim: true, default: "" },

    // ── Audit ────────────────────────────────────────────────────
    performedAt: { type: Date, default: Date.now, required: true, index: true },
    performedBy: { type: String, trim: true, default: "" },
    performedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  "User",
      default: null,
    },
    performedByRole: { type: String, trim: true, default: "" },
    shift: {
      type: String,
      enum: ["MORNING", "EVENING", "NIGHT", "OTHER"],
      default: "MORNING",
    },

    notes:       { type: String, trim: true, default: "" },

    // ── Retention ────────────────────────────────────────────────
    // NABH AAC.3 + ISO 15189: minimum 2 years; we default to 3y to
    // align with the BillingAudit admin-class retention floor.
    retainUntil: {
      type: Date,
      default: () => new Date(Date.now() + 3 * 365 * 86400000),
    },
  },
  { timestamps: true },
);

LabQCLogSchema.index({ equipmentName: 1, performedAt: -1 });
LabQCLogSchema.index({ result: 1, performedAt: -1 });

// TTL on retainUntil so the collection auto-prunes once the legal
// retention floor passes. (Single source of truth — `index: true` on
// the field is omitted to avoid a duplicate-index warning.)
LabQCLogSchema.index({ retainUntil: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.LabQCLog ||
  mongoose.model("LabQCLog", LabQCLogSchema);
