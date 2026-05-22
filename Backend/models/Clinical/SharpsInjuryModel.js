/**
 * SharpsInjuryModel.js  (R7bj-F6 / NABH HK-CRIT-1 / HIC.6)
 *
 * Needle-stick / sharps-injury register. HIC.6 mandates a register
 * with the injury details, the source-patient serology consent and
 * results, the post-exposure prophylaxis (PEP) decision tree, and a
 * 6-month follow-up serology window. Pre-R7bj there was nothing —
 * an incident report was filed in IncidentReport (free-text), so the
 * Infection Control Nurse (ICN) could not assemble the HIC.6 evidence
 * pack for NABH audits.
 *
 * Append-only: once injuryDate is set on create, the source/PEP/
 * follow-up arrays can be appended to but earlier rows can't change.
 * The doc itself stays mutable for serology results landing over
 * time; the model relies on dedicated service helpers
 * (markPepStarted / recordSerologyResult / close) to avoid arbitrary
 * back-dating.
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

const SerologyEntrySchema = new Schema(
  {
    _id:   false,
    test:  {
      type: String,
      enum: ["HIV", "HBsAg", "HCV"],
      required: true,
    },
    dueAt:       { type: Date, default: null },
    completedAt: { type: Date, default: null },
    result:      {
      type: String,
      enum: ["NEGATIVE", "POSITIVE", "PENDING", "INDETERMINATE", ""],
      default: "PENDING",
    },
    reportedById:   { type: Schema.Types.ObjectId, ref: "User", default: null },
    reportedByName: { type: String, default: "" },
    notes:          { type: String, default: "" },
  },
);

const SharpsInjurySchema = new Schema(
  {
    // Auto-counter — formatId("SI-YYYY", seq, 4) → "SI-2026-0001"
    incidentNumber: { type: String, required: true, unique: true, index: true },

    // ── Injured staff ────────────────────────────────────────
    injuredById:    { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    injuredByName:  { type: String, required: true, trim: true },
    injuredByRole:  { type: String, default: "" },

    // ── Injury event ─────────────────────────────────────────
    injuryDate:        { type: Date, required: true, default: Date.now, index: true },
    injuryLocation:    { type: String, default: "" },     // "ICU bedside", "Sample collection room", etc.
    injuryDescription: { type: String, default: "" },
    device:            {
      type: String,
      enum: ["HOLLOW_BORE_NEEDLE", "SOLID_NEEDLE", "SCALPEL", "LANCET", "GLASS", "OTHER"],
      required: true,
    },

    // ── Source patient (if known) ────────────────────────────
    source: {
      type: {
        type: String,
        enum: ["KNOWN", "UNKNOWN"],
        default: "UNKNOWN",
      },
      patientUHID:          { type: String, default: "", uppercase: true, trim: true },
      consentForSerology:   { type: Boolean, default: false },
      serologyConsent_date: { type: Date, default: null },
      // Source serology snapshot — populated by ICN once results arrive.
      hiv:   { type: String, enum: ["NEGATIVE", "POSITIVE", "PENDING", "UNKNOWN"], default: "UNKNOWN" },
      hbsag: { type: String, enum: ["NEGATIVE", "POSITIVE", "PENDING", "UNKNOWN"], default: "UNKNOWN" },
      hcv:   { type: String, enum: ["NEGATIVE", "POSITIVE", "PENDING", "UNKNOWN"], default: "UNKNOWN" },
    },

    // ── PEP (post-exposure prophylaxis) ──────────────────────
    pepStatus: {
      offered:     { type: Boolean, default: false },
      offeredAt:   { type: Date, default: null },
      started:     { type: Boolean, default: false },
      startedAt:   { type: Date, default: null },
      regimen:     { type: String, default: "" },         // e.g. "TDF/3TC/DTG for 28d"
      completed:   { type: Boolean, default: false },
      completedAt: { type: Date, default: null },
      declinedReason: { type: String, default: "" },
    },

    // ── Follow-up serology (typically 0 / 6w / 3m / 6m) ──────
    followUpSerology: { type: [SerologyEntrySchema], default: [] },

    // ── Reporting / closure ──────────────────────────────────
    reportedToICAN:   { type: Boolean, default: false },
    reportedToICANAt: { type: Date, default: null },

    status: {
      type: String,
      enum: ["OPEN", "UNDER_FOLLOWUP", "CLOSED"],
      default: "OPEN",
      index: true,
    },
    closedAt:     { type: Date, default: null },
    closedBy:     { type: Schema.Types.ObjectId, ref: "User", default: null },
    closedByName: { type: String, default: "" },
    closureNotes: { type: String, default: "" },

    notes:      { type: String, default: "" },
    hospitalId: { type: Schema.Types.ObjectId, ref: "Hospital", default: null },

    // R7bm-F7 — BMW Rules 2016 §13 / IPC §269 / ICMR HIV-PEP guideline:
    // Sharps-injury records must be retained for at least 5 years from
    // the date of the injury so a regulator audit (or a delayed
    // sero-conversion claim) can reconstruct the exposure timeline.
    // The date is recorded so a future scheduled-purge cron can sweep
    // records past retention WITHOUT a TTL auto-delete (TTL is
    // deliberately omitted — append-only / append-and-then-purge
    // workflows are not equivalent for medico-legal records).
    retainUntil: { type: Date, default: null, index: true },
  },
  { timestamps: true, collection: "sharps_injuries" },
);

SharpsInjurySchema.index({ status: 1, injuryDate: -1 });
SharpsInjurySchema.index({ injuredById: 1, injuryDate: -1 });
SharpsInjurySchema.index({ "source.patientUHID": 1 });

// R7bm-F7 — compute retainUntil = createdAt + 5 years if not set.
// Runs on insert only; updates do not move the retention horizon.
const SHARPS_RETENTION_YEARS = 5;
SharpsInjurySchema.pre("save", function (next) {
  if (this.isNew && !this.retainUntil) {
    const base = this.createdAt || this.injuryDate || new Date();
    const d = new Date(base);
    d.setFullYear(d.getFullYear() + SHARPS_RETENTION_YEARS);
    this.retainUntil = d;
  }
  next();
});

// Once status === "CLOSED" no further mutation except for legal-hold /
// note appends. Re-opening requires a dedicated admin override.
const POST_CLOSE_ALLOWED = new Set([
  "closureNotes",
  "notes",
  "updatedAt",
]);
function _guardPostClose(queryThis) {
  const upd = queryThis.getUpdate() || {};
  const $set = upd.$set || upd;
  const trying = Object.keys($set || {});
  const illegal = trying.filter((k) => !POST_CLOSE_ALLOWED.has(k) && !k.startsWith("$"));
  if (!illegal.length) return;
  return queryThis.model.findOne(queryThis.getQuery()).then((existing) => {
    if (existing && existing.status === "CLOSED") {
      const err = new Error(
        `Sharps-injury record is CLOSED; cannot modify: ${illegal.join(",")}`,
      );
      err.statusCode = 409;
      err.code = "SHARPS_INJURY_CLOSED";
      throw err;
    }
  });
}
SharpsInjurySchema.pre("findOneAndUpdate", function (next) {
  try {
    const p = _guardPostClose(this);
    if (p && typeof p.then === "function") return p.then(() => next()).catch(next);
    next();
  } catch (e) { next(e); }
});
SharpsInjurySchema.pre("updateOne", function (next) {
  try {
    const p = _guardPostClose(this);
    if (p && typeof p.then === "function") return p.then(() => next()).catch(next);
    next();
  } catch (e) { next(e); }
});

module.exports =
  mongoose.models.SharpsInjury ||
  mongoose.model("SharpsInjury", SharpsInjurySchema);
