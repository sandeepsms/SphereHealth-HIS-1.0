/**
 * GstReturnSnapshotModel.js  (R7bh-F6 / R7bg CRIT-A1 / NABH AAC.7 + GST §37+§39)
 *
 * Frozen export of a finalised GSTR-1 or GSTR-3B return for a given
 * tax period. Pre-R7bh the HIS could compute monthly GST totals (see
 * GstMonthlySnapshot) but had **no portal-shaped JSON export** — the
 * accountant manually copy-pasted figures into the GSTN portal every
 * month. That breaks GST §37 (return filing) + §35 (audit trail) +
 * NABH AAC.7 (financial reconciliation) because there is no auditable
 * artifact recording "what was filed vs what the books said".
 *
 * Workflow:
 *   1. Accountant clicks "Generate GSTR-1" for period 2026-04.
 *      → gstr1Exporter.buildGSTR1JSON(period) builds the portal JSON
 *      → snapshot persisted with filingStatus="DRAFT".
 *   2. Accountant reviews against GstMonthlySnapshot, makes corrections.
 *   3. Clicks "Finalize" → filingStatus="FINALIZED" + locked from edits.
 *   4. Files at portal, receives ARN, clicks "Mark Filed" → filingStatus="FILED"
 *      + filedAt + filedBy + arn set immutably.
 *
 * The doc is append-only after FILED — pre-save guard rejects any
 * mutation once filingStatus="FILED" except the lifecycle write that
 * sets it. Period+returnKind compound unique so re-running the
 * generator overwrites a DRAFT but cannot overwrite a FINALIZED/FILED.
 */
const mongoose = require("mongoose");
const Dec = mongoose.Schema.Types.Decimal128;
const { decimalToNumber } = require("../../utils/money");

const GstReturnSnapshotSchema = new mongoose.Schema(
  {
    // YYYY-MM (IST calendar). Compound unique with returnKind below.
    period:    { type: String, required: true, trim: true, index: true },

    returnKind: {
      type: String,
      enum: ["GSTR-1", "GSTR-3B"],
      required: true,
      index: true,
    },

    // ── Generation ─────────────────────────────────────────────────
    generatedAt:     { type: Date, default: Date.now },
    generatedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    generatedByName: { type: String, trim: true, default: "" },

    // ── Filing lifecycle ───────────────────────────────────────────
    //   DRAFT     — generated but not signed off; can be re-generated
    //   FINALIZED — accountant froze; further regeneration blocked
    //   FILED     — portal accepted; ARN stored; immutable
    filingStatus: {
      type: String,
      enum: ["DRAFT", "FINALIZED", "FILED"],
      default: "DRAFT",
      index: true,
    },
    finalizedAt: { type: Date, default: null },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    filedAt:     { type: Date, default: null },
    filedBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // GSTN portal acknowledgement reference. Set when marking FILED.
    arn:         { type: String, trim: true, default: "" },

    // ── Payload + summary ──────────────────────────────────────────
    // The portal-shaped JSON. Schema-less by design (GSTN releases a new
    // version every few quarters; we capture whatever the exporter built
    // at this point in time so the snapshot stays auditable even after
    // the schema shifts).
    jsonPayload: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    // Lightweight totals for the list view + quick reconciliation against
    // GstMonthlySnapshot. Decimal128 throughout.
    summary: {
      totalTaxable: { type: Dec, default: 0 },
      totalCgst:    { type: Dec, default: 0 },
      totalSgst:    { type: Dec, default: 0 },
      totalIgst:    { type: Dec, default: 0 },
      hsnCount:     { type: Number, default: 0 },
      lineCount:    { type: Number, default: 0 },
    },

    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital", default: null },
  },
  { timestamps: true, collection: "gst_return_snapshots" },
);

// One row per (period, returnKind). The accountant can only have ONE
// active GSTR-1 / GSTR-3B per month — re-running the generator either
// overwrites the DRAFT or refuses (if FINALIZED/FILED).
GstReturnSnapshotSchema.index({ period: 1, returnKind: 1 }, { unique: true });
GstReturnSnapshotSchema.index({ returnKind: 1, filingStatus: 1, period: -1 });
GstReturnSnapshotSchema.index({ filingStatus: 1, generatedAt: -1 });

// ── Append-only guard once FILED ───────────────────────────────────
//
// Per the spec: "Append-only after FILED; pre-save guard." We allow
// the transitions DRAFT → FINALIZED → FILED but once filingStatus
// reaches FILED, no field can be mutated. The exception is the
// rare admin-override path which must explicitly set
// `__bypassFiledGuard = true` on the doc instance.
GstReturnSnapshotSchema.pre("save", function _filedGuard(next) {
  if (!this.isNew) {
    // If the previous filingStatus was FILED and the caller hasn't
    // explicitly opted in to a bypass, reject any modification.
    const wasFiled = this.$__.savedState?.get?.("filingStatus") === "FILED";
    const isFiled  = this.filingStatus === "FILED";
    if (wasFiled && !this.__bypassFiledGuard) {
      return next(new Error("GstReturnSnapshot is FILED and immutable — set __bypassFiledGuard for admin override"));
    }
    // Reject re-generation (jsonPayload change) once finalized.
    if (this.filingStatus === "FINALIZED" && this.isModified("jsonPayload") && !this.__bypassFiledGuard) {
      return next(new Error("Snapshot is FINALIZED — cannot mutate jsonPayload without finalize-reset"));
    }
    // Once FILED, prevent later writes from blanking ARN / filed fields.
    if (isFiled && (this.isModified("filingStatus") || this.isModified("arn")) && !this.__bypassFiledGuard) {
      // Allow the lifecycle transition that originally lands the FILED
      // state itself (i.e. wasFiled=false, isFiled=true). Once filed,
      // any toggle off is blocked above.
      if (wasFiled) {
        return next(new Error("Filed return cannot be unfiled or ARN-rewritten"));
      }
    }
  }
  next();
});

GstReturnSnapshotSchema.set("toJSON",   { transform: decimalToNumber });
GstReturnSnapshotSchema.set("toObject", { transform: decimalToNumber });

module.exports =
  mongoose.models.GstReturnSnapshot ||
  mongoose.model("GstReturnSnapshot", GstReturnSnapshotSchema);
