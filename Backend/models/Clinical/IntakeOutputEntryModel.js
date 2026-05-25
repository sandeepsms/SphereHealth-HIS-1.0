// models/Clinical/IntakeOutputEntryModel.js
// ════════════════════════════════════════════════════════════════════
// R7bq-3 / R7bq-4 — Fluid Intake / Output ledger.
//
// One row per fluid event for an admission. Replaces the old
// NurseNotes.intakeOutput aggregate (which folded a whole shift into
// one number) because we now need timestamped, auditable, per-event
// entries to support:
//
//   - MAR auto-feed (R7bq-3) — when a medication dose marked GIVEN
//     carries a dilution volume, we push one IN row stamped from the
//     Treatment Chart.
//
//   - Running-infusion auto-feed (R7bq-4) — a 1h cron walks every
//     active IV_Fluid order and writes one IN row per hour using
//     the doctor-ordered ratePerHour. Stops when infusionStopped is
//     set or totalVolume is hit.
//
//   - Manual entries — the nurse "Intake / Output" chip still writes
//     here directly (source: "MANUAL").
//
//   - Output rows — urine, drain, NG, emesis, blood loss (source:
//     "MANUAL" for now; future scope: catheter / drain auto-meters).
//
// Indexed by admissionId + ts so the I/O chart UI + print can pull a
// day's rows in one ranged query.
// ════════════════════════════════════════════════════════════════════
const mongoose = require("mongoose");

const IntakeOutputEntrySchema = new mongoose.Schema(
  {
    admissionId: { type: mongoose.Schema.Types.ObjectId, ref: "Admission", required: true, index: true },
    UHID:        { type: String, required: true, index: true },
    patientName: { type: String, default: "" },

    direction:   { type: String, enum: ["IN", "OUT"], required: true, index: true },
    ts:          { type: Date,   default: Date.now,   required: true, index: true },
    volumeML:    { type: Number, required: true, min: 0, max: 20000 },

    // What kind of fluid (IN: NS / RL / D5W / Oral / Blood / TPN / etc.
    // OUT: Urine / Drain / NG / Emesis / Stool / BloodLoss / Other)
    fluidType:   { type: String, default: "" },

    // Source provenance — drives the badge in the UI and the audit
    // trail. NABH MOM.4 requires every fluid entry to be traceable to
    // a written order or a documented nursing action.
    source: {
      type: String,
      enum: [
        "MANUAL",            // nurse "Intake / Output" chip
        "MAR",               // medication dose given (with dilution)
        "INFUSION_CRON",     // 1h cron sweep over running IV_Fluid orders
        "BLOOD_TRANSFUSION", // blood/component started/stopped
        "ORAL_INTAKE",       // dietary chart hook (future)
        "CATHETER",          // catheter meter hook (future)
        "DRAIN",             // drain output (future)
      ],
      default: "MANUAL",
      required: true,
      index: true,
    },

    // Reference to the originating record (order/note) — lets the UI
    // jump back to the order that drove the entry.
    sourceRefType: { type: String, default: "" },   // "DoctorOrder" | "NurseNote" | etc.
    sourceRefId:   { type: mongoose.Schema.Types.ObjectId, default: null },

    // Free-text label shown in the I/O grid. e.g.
    //   "Inj Ceftriaxone 1g in 100ml NS over 30 min"
    //   "Maintenance IV — RL 50 ml/hr (auto-hourly)"
    //   "Urine output (manual)"
    label: { type: String, default: "" },

    notes: { type: String, default: "" },

    // Who recorded it. For auto rows this is "SYSTEM".
    recordedBy: {
      id:   { type: mongoose.Schema.Types.ObjectId, default: null },
      name: { type: String, default: "" },
      role: { type: String, default: "" },
    },

    // Source-specific blob — e.g. for MAR: { doseId, scheduledTime,
    // drugName }; for INFUSION_CRON: { orderId, ratePerHour, hourBucket }
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Soft-cancel so a wrong auto-entry can be voided without losing
    // the audit trail. Cron writers respect `voided:true` and won't
    // duplicate.
    voided:     { type: Boolean, default: false, index: true },
    voidedBy:   { type: String,  default: "" },
    voidedAt:   { type: Date,    default: null },
    voidReason: { type: String,  default: "" },
  },
  { timestamps: true, collection: "intake_output_entries" }
);

// Compound index: admission + day window — the most common read.
IntakeOutputEntrySchema.index({ admissionId: 1, ts: -1 });
IntakeOutputEntrySchema.index({ UHID: 1, ts: -1 });

// Prevent INFUSION_CRON duplicates for the same order + hour bucket
// (defensive against cron re-running mid-tick). Partial index — only
// the rows that actually carry meta.hourBucket get the constraint.
IntakeOutputEntrySchema.index(
  { "meta.orderId": 1, "meta.hourBucket": 1 },
  {
    unique: true,
    partialFilterExpression: { source: "INFUSION_CRON" },
    name: "uniq_infusion_hour_bucket",
  }
);

// Same idea for MAR: one row per (orderId, doseId).
IntakeOutputEntrySchema.index(
  { "meta.orderId": 1, "meta.doseId": 1 },
  {
    unique: true,
    partialFilterExpression: { source: "MAR" },
    name: "uniq_mar_dose",
  }
);

module.exports = mongoose.model("IntakeOutputEntry", IntakeOutputEntrySchema);
