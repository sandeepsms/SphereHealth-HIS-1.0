/**
 * ScheduleXBalanceModel.js  (R7bh-F4 / R7bg-10-CRIT-2)
 *
 * Atomic per-drug running balance for Schedule-X (NDPS narcotics).
 *
 * Pre-R7bh, `scheduleXRegister.recordDispense` computed the live balance
 * by reading every prior ScheduleXEntry row for the (drug, batch) and
 * subtracting today's dispenses — a textbook TOCTOU. Two concurrent
 * dispenses could both see "balance = 10, requesting 7" and both
 * insert. The register would then sit at -4 — illegal under the
 * NDPS Act and a hard audit fail at the next regulator inspection.
 *
 * The new pattern:
 *   1. On receipt (GRN of a Schedule-X drug):
 *        await ScheduleXBalance.findOneAndUpdate(
 *          { drugId },
 *          { $inc: { balance: receivedQty } },
 *          { upsert: true, new: true },
 *        );
 *   2. On dispense (Schedule-X registration entry):
 *        const updated = await ScheduleXBalance.findOneAndUpdate(
 *          { drugId, balance: { $gte: qty } },     // ← CAS predicate
 *          { $inc: { balance: -qty } },
 *          { new: true },
 *        );
 *        if (!updated) throw 409 INSUFFICIENT_REGISTER_BALANCE;
 *
 * The findOneAndUpdate is atomic at the Mongo level — two concurrent
 * dispensers cannot both win the predicate. One walks away with the
 * balance, the other gets null and surfaces a 409.
 */
const mongoose = require("mongoose");

const ScheduleXBalanceSchema = new mongoose.Schema(
  {
    drugId:  { type: mongoose.Schema.Types.ObjectId, ref: "PharmacyDrug", required: true, unique: true, index: true },
    balance: { type: Number, default: 0 },
    // Audit pointers (best-effort; not critical for the CAS itself)
    lastUpdatedBy:   { type: String, default: "" },
    lastUpdatedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    lastUpdatedAt:   { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports =
  mongoose.models.ScheduleXBalance ||
  mongoose.model("ScheduleXBalance", ScheduleXBalanceSchema);
