/**
 * PharmacyDayCloseModel.js  (R7bh-F4 / R7bg-10-HIGH-5)
 *
 * End-of-day cash close snapshot for the pharmacy module. Previously the
 * schema was defined inline inside `controllers/Pharmacy/pharmacyController.js`
 * which made the audit trail invisible to other consumers (e.g. Day Book
 * aggregators) and made it impossible to add a date-floored unique index
 * to prevent double-close races (two pharmacists clicking "Close Day"
 * concurrently would create two snapshots for the same calendar day).
 *
 * Per R7bg-10-HIGH-5, this model:
 *   • Lives in its own file so any service can require it.
 *   • Carries a unique index on `asOf` (date-floored to IST midnight) so
 *     two upserts for the same day collapse into one row.
 *
 * Use `findOneAndUpdate({ asOf }, { $setOnInsert: {...} }, { upsert: true,
 * new: true })` in the controller — the unique index will reject a second
 * concurrent close and the caller can surface a 409.
 */
const mongoose = require("mongoose");

const PharmacyDayCloseSchema = new mongoose.Schema(
  {
    // The IST-midnight-floored date of the close. Unique index below
    // prevents two snapshots for the same calendar day.
    asOf:           { type: Date, required: true, unique: true },

    closedBy:       { type: String, trim: true, default: "" },
    closedById:     { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedByRole:   { type: String, trim: true, default: "" },
    closedAt:       { type: Date, default: Date.now },

    // Snapshot of the stats payload at close-time.
    drugsCount:     { type: Number, default: 0 },
    batchesInStock: { type: Number, default: 0 },
    stockValue:     { type: Number, default: 0 },
    todaySales:     { type: mongoose.Schema.Types.Mixed, default: {} },
    monthSales:     { type: mongoose.Schema.Types.Mixed, default: {} },
    cashOnHand:     { type: Number, default: 0 },
    varianceNote:   { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

// asOf already has unique:true via the field def above; no need to
// declare it again here.

module.exports =
  mongoose.models.PharmacyDayClose ||
  mongoose.model("PharmacyDayClose", PharmacyDayCloseSchema);
