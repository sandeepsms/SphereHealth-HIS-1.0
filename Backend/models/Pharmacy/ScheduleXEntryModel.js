/**
 * ScheduleXEntryModel.js  (R7bd-E-1 / A2-MED-16)
 *
 * Statutory Schedule-X register for narcotic / psychotropic dispenses.
 * D&C Rule 65 (NDPS Act + Schedule X) requires every hospital pharmacy
 * dispensing a Schedule X drug (most opioids, barbiturates, certain
 * benzodiazepines) to keep a perpetual register with these mandatory
 * columns: date, drug, batch, opening balance, received, dispensed,
 * closing balance, prescription reference, prescriber, patient, witness.
 *
 * Pre-R7bd-E-1 the existing pharmacy register (controllers/.../
 * scheduleHRegister) only covered Schedule H and reconstructed the
 * picture from PharmacySale rows on demand — no separate register, no
 * witness, no daily balance verification, no append-only guarantee.
 * That fails an NDPS audit because:
 *   1. Schedule-H register is NOT a substitute for the Schedule-X
 *      register; they're separate statutory books.
 *   2. NDPS demands a daily reconciliation signed by the pharmacist.
 *   3. Schedule-X dispenses require a SECOND-PERSON witness who must
 *      not be the dispenser.
 *
 * Append-only at the schema level: the pre-save hook rejects updates
 * to any field on an existing document (only `balanceVerifiedBy` /
 * `balanceVerifiedAt` may be set later, and only once — the daily
 * verification lock).
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

const ScheduleXEntrySchema = new Schema(
  {
    // Calendar day this entry belongs to (IST midnight). Indexed so
    // dailyBalance(date) can scan one day's slice without a full table
    // walk once the register grows past a few years.
    date: { type: Date, required: true, index: true },

    drugId:    { type: Schema.Types.ObjectId, ref: "PharmacyDrug", required: true, index: true },
    drugName:  { type: String, required: true, trim: true },
    batchId:   { type: Schema.Types.ObjectId, ref: "PharmacyDrugBatch" },
    batchNo:   { type: String, default: "" },

    // Numeric register columns — opening = closing of the previous day
    // for the same drug + batch. The service is responsible for chaining
    // these (the schema only stores what was computed).
    openingBalance: { type: Number, default: 0, min: 0 },
    received:       { type: Number, default: 0, min: 0 },
    dispensed:      { type: Number, default: 0, min: 0 },
    closingBalance: { type: Number, default: 0, min: 0 },

    // Per-dispense provenance — present on every "dispense" row.
    // Receipt/opening rows leave these blank.
    prescriptionRef: { type: String, default: "" },  // Rx number / DoctorOrder ref
    doctorName:      { type: String, default: "" },
    patientUHID:     { type: String, uppercase: true, trim: true, default: "" },

    // Two-person witness mandated by NDPS for narcotic dispense.
    // The service refuses to record a dispense where witness == dispenser.
    dispensedBy:    { type: String, default: "" },
    dispensedById:  { type: Schema.Types.ObjectId, ref: "User" },
    witnessName:    { type: String, default: "" },
    witnessId:      { type: Schema.Types.ObjectId, ref: "User" },

    // Daily verification — pharmacist locks the day's totals at EOD.
    // Once set, the entire row is sealed (append-only enforcement).
    balanceVerifiedBy:    { type: String, default: "" },
    balanceVerifiedById:  { type: Schema.Types.ObjectId, ref: "User" },
    balanceVerifiedAt:    { type: Date, default: null },

    // Row classification — lets the register UI separate
    // "opening", "receive", "dispense", "verify" events.
    rowType: {
      type: String,
      enum: ["OPENING", "RECEIVE", "DISPENSE", "VERIFY"],
      required: true,
    },

    remarks: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }, // append-only
);

// One row per (date, drug, batch, rowType) for opening/verify; multiple
// dispenses on the same day get separate rows — so no unique compound
// index that would block N dispense rows. We index on the common query
// keys instead.
ScheduleXEntrySchema.index({ date: 1, drugId: 1, batchId: 1 });
ScheduleXEntrySchema.index({ drugId: 1, createdAt: -1 });
ScheduleXEntrySchema.index({ patientUHID: 1, createdAt: -1 });

// ── Append-only guard ────────────────────────────────────────────
// Pre-save rejects any update to an existing document EXCEPT setting
// the verification fields (balanceVerifiedBy/Id/At) — and only when
// they were previously null (verify is a one-shot lock).
ScheduleXEntrySchema.pre("save", function (next) {
  if (this.isNew) return next();
  // Only allow the verify columns to change, and only once.
  const allowed = new Set(["balanceVerifiedBy", "balanceVerifiedById", "balanceVerifiedAt"]);
  const modified = this.modifiedPaths();
  for (const p of modified) {
    if (!allowed.has(p)) {
      return next(new Error(`ScheduleX register is append-only — cannot modify "${p}" after insert`));
    }
  }
  next();
});

// Block findOneAndUpdate / updateOne / updateMany on the model entirely
// (verification goes through .save() on a loaded doc so the pre-save hook
// applies). The statics get overridden below.
function _blockUpdate() {
  throw new Error("ScheduleX register is append-only — use service.recordDispense / verifyBalance");
}
ScheduleXEntrySchema.statics.updateOne   = _blockUpdate;
ScheduleXEntrySchema.statics.updateMany  = _blockUpdate;
ScheduleXEntrySchema.statics.findOneAndUpdate = _blockUpdate;
ScheduleXEntrySchema.statics.findByIdAndUpdate = _blockUpdate;
ScheduleXEntrySchema.statics.deleteOne   = _blockUpdate;
ScheduleXEntrySchema.statics.deleteMany  = _blockUpdate;
ScheduleXEntrySchema.statics.findByIdAndDelete = _blockUpdate;
ScheduleXEntrySchema.statics.findOneAndDelete  = _blockUpdate;

module.exports = mongoose.models.ScheduleXEntry ||
  mongoose.model("ScheduleXEntry", ScheduleXEntrySchema);
