/**
 * RoomCategoryChargesModel.js — R7en
 *
 * Per-room-category daily-charges matrix. Mirrors the per-doctor
 * `consultationFee` pattern set by R7dp (DoctorChargesPage) but
 * applied to IPD bed categories. Each row describes ONE bed category
 * (General Ward / Semi-Private / Private / Deluxe / ICU / HDU /
 * Suite / NICU …) and carries the daily price for every per-day
 * line item the auto-billing cron currently emits as a single
 * "BED" + "NURSING" pair.
 *
 * After this model lands, the daily cron in autoBillingService.js
 * (runDailyBedChargeAccrual → flushDailyChargesForAdmission) walks
 * this matrix instead of the legacy ServiceMaster BED-x / NURSING-x
 * rows — emitting one BillingTrigger per non-zero line item per day.
 *
 * Half-day proration (NABH-style billing):
 *   - chargingRule "Full"              → full charge every day
 *   - chargingRule "HalfOnAdmission"   → 0.5× on Day 1, 1× thereafter
 *   - chargingRule "HalfOnDischarge"   → 1× until day before discharge,
 *                                        0.5× on discharge day
 *   - chargingRule "HalfBoth" (default)→ 0.5× on Day 1 AND 0.5× on
 *                                        discharge day, 1× interior days
 *
 * Dedup safety: the existing `dailyDedup` guard on BillingTrigger
 * (compound on admissionId + serviceCode + dateKey) still applies,
 * so even with 8 line items per category the same day re-running the
 * cron is idempotent.
 *
 * Collection name `room_category_charges` (snake_case) matches the
 * existing `client_error_logs`, `antimicrobial_use_registers` etc.
 * convention used by R7bz onwards.
 */
"use strict";
const mongoose = require("mongoose");
const { Schema } = mongoose;

// ──────────────────────────────────────────────────────────────────
// Charge line-item subdoc — every field is per-day INR. The category
// rows where a line item is zero simply skip emitting that trigger
// (so a General Ward row doesn't fire a "monitoringCharge" trigger
// every day). All amounts are bare Number; we don't use Decimal128
// here because the cron resolver coerces with toNum() before writing
// to BillingTrigger / BillItem anyway.
// ──────────────────────────────────────────────────────────────────
const ChargesSchema = new Schema(
  {
    bedRent:           { type: Number, default: 0, min: 0 }, // daily room rent
    nursingCharge:     { type: Number, default: 0, min: 0 }, // daily nursing
    doctorVisitCharge: { type: Number, default: 0, min: 0 }, // daily ward round
    rmoCharge:         { type: Number, default: 0, min: 0 }, // resident MO
    monitoringCharge:  { type: Number, default: 0, min: 0 }, // ICU/HDU/NICU
    dieteticsCharge:   { type: Number, default: 0, min: 0 }, // clinical dietetics
    housekeepingCharge:{ type: Number, default: 0, min: 0 }, // room cleaning
    linenCharge:       { type: Number, default: 0, min: 0 }, // laundry / linen
  },
  { _id: false },
);

const RoomCategoryChargesSchema = new Schema(
  {
    // categoryCode is the join key — the cron resolver maps the
    // populated `room.roomCategory.categoryCode` to a row here.
    // Stored uppercase for case-insensitive lookups; existing
    // categories use codes like GENW, SEMI, PVT, DELUXE, ICU, HDU,
    // NICU, SUITE.
    categoryCode: {
      type: String,
      required: [true, "Category code is required"],
      uppercase: true,
      trim: true,
    },

    // Display label shown on the admin grid + on the bill line
    // ("Bed Charge — Private (Day 3)"). Kept distinct from
    // categoryCode so the operator can rename without breaking
    // the cron's lookup.
    categoryName: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
    },

    charges: { type: ChargesSchema, default: () => ({}) },

    // Half-day proration policy for this category. Matches the
    // common Indian hospital convention (HalfBoth) by default so the
    // bill aligns with NABH AAC.7 + the legacy IPD billing software
    // most hospitals are migrating from.
    chargingRule: {
      type: String,
      enum: ["Full", "HalfOnAdmission", "HalfOnDischarge", "HalfBoth"],
      default: "HalfBoth",
    },

    // Effective-date window. effectiveTo:null means "current row".
    // The cron filter is `active:true AND effectiveTo:null` so a
    // historical price change can be archived (set effectiveTo) and
    // a new row created without losing the audit trail.
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo:   { type: Date, default: null },

    active:        { type: Boolean, default: true },

    // Audit trio — populated by controller from req.user. Mirrors
    // the convention used by hospitalChargesController / doctorService.
    createdBy:     { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdByName: { type: String, default: "" },
    updatedBy:     { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedByName: { type: String, default: "" },

    // Free-text note shown as a tooltip on the grid (e.g. "Includes
    // central-line monitoring; review on 30-Jun" — operator hint
    // only, never used by billing).
    notes: { type: String, default: "", trim: true },
  },
  {
    timestamps: true,
    collection: "room_category_charges",
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ──────────────────────────────────────────────────────────────────
// Indexes
//   - Unique on categoryCode for active rows so a duplicate seed run
//     doesn't shadow the live row. partialFilterExpression mirrors
//     the same trick used in RoomCategoryModel.
//   - Compound (active, categoryCode) accelerates the cron lookup
//     (one query per admission per cron tick).
// ──────────────────────────────────────────────────────────────────
RoomCategoryChargesSchema.index(
  { categoryCode: 1 },
  { unique: true, partialFilterExpression: { active: true, effectiveTo: null } },
);
RoomCategoryChargesSchema.index({ active: 1, categoryCode: 1 });

// ──────────────────────────────────────────────────────────────────
// Virtual: totalDailyCharge — sum of all line items. Useful for the
// KPI strip on the admin grid ("Avg daily total for an ICU bed").
// ──────────────────────────────────────────────────────────────────
RoomCategoryChargesSchema.virtual("totalDailyCharge").get(function () {
  const c = this.charges || {};
  return (
    (c.bedRent           || 0) +
    (c.nursingCharge     || 0) +
    (c.doctorVisitCharge || 0) +
    (c.rmoCharge         || 0) +
    (c.monitoringCharge  || 0) +
    (c.dieteticsCharge   || 0) +
    (c.housekeepingCharge|| 0) +
    (c.linenCharge       || 0)
  );
});

module.exports =
  mongoose.models.RoomCategoryCharges ||
  mongoose.model("RoomCategoryCharges", RoomCategoryChargesSchema);
