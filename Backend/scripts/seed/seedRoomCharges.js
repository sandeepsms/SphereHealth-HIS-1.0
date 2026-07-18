/**
 * scripts/seed/seedRoomCharges.js  (GAP-2 fix)
 *
 * Bed-day + nursing-per-day charges never accrued on a fresh deployment: the
 * per-category daily-charge MATRIX (RoomCategoryCharges, collection
 * `room_category_charges`) shipped with rows for every category but with ALL
 * rates = ₹0. The accrual resolver joins room.roomCategory.categoryCode → that
 * matrix, matches the ₹0 row, and writes a ₹0 (i.e. no) bed/nursing line — so a
 * full IPD stay billed nothing for the bed.
 *
 * This sets a real per-day tariff (bedRent + nursingCharge, + monitoring for
 * ICU/HDU) on each matrix row, keyed by categoryCode. It also tops up the
 * legacy RoomCategory.defaultPricing (the resolver's fallback shape) so both
 * paths agree. IDEMPOTENT: only fills rows whose bedRent is still ₹0 (use
 * --force to overwrite non-zero rows). Run once per deployment:
 *
 *     node scripts/seed/seedRoomCharges.js            # dry run
 *     node scripts/seed/seedRoomCharges.js --apply    # write
 *     node scripts/seed/seedRoomCharges.js --apply --force   # overwrite existing rates
 *
 * Rates are PLACEHOLDERS — a hospital MUST set its own tariff in Admin → Room
 * Category Charges. This only ensures bed-day accrues instead of billing ₹0.
 */
"use strict";

const mongoose = require("mongoose");

// categoryCode → per-day charges. Unmatched codes fall back to GENW.
const RATES = {
  ICU:  { bedRent: 5000, nursingCharge: 1500, monitoringCharge: 2000 },
  HDU:  { bedRent: 4000, nursingCharge: 1200, monitoringCharge: 1500 },
  NICU: { bedRent: 5500, nursingCharge: 1600, monitoringCharge: 2000 },
  CCU:  { bedRent: 5000, nursingCharge: 1500, monitoringCharge: 2000 },
  PVT:  { bedRent: 3000, nursingCharge: 800 },
  DLX:  { bedRent: 4000, nursingCharge: 1000 },
  SUITE:{ bedRent: 6000, nursingCharge: 1200 },
  EMRG: { bedRent: 2000, nursingCharge: 600 },
  PEDI: { bedRent: 2500, nursingCharge: 700 },
  ISO:  { bedRent: 3500, nursingCharge: 900 },
  TRMT: { bedRent: 1000, nursingCharge: 300 },
  SEMI: { bedRent: 1800, nursingCharge: 500 },
  GENW: { bedRent: 1200, nursingCharge: 400 },
};
const ratesFor = (code, name) => {
  const c = String(code || "").toUpperCase();
  if (RATES[c]) return RATES[c];
  const n = String(name || "").toLowerCase();
  if (/icu|intensive/.test(n)) return RATES.ICU;
  if (/private/.test(n))       return RATES.PVT;
  if (/emergency/.test(n))     return RATES.EMRG;
  if (/pedia/.test(n))         return RATES.PEDI;
  if (/deluxe/.test(n))        return RATES.DLX;
  if (/isolation/.test(n))     return RATES.ISO;
  if (/treatment/.test(n))     return RATES.TRMT;
  return RATES.GENW;
};

async function run({ apply = false, force = false } = {}) {
  const RoomCategoryCharges = require("../../models/Admin/RoomCategoryChargesModel");
  const RoomCategory = require("../../models/bedMgmt/roomCategoryModel");

  let mtxUpdated = 0, mtxSkipped = 0, catTopped = 0;
  const log = [];

  // ── 1. the authoritative daily-charge matrix ──
  const rows = await RoomCategoryCharges.find({}).lean();
  for (const r of rows) {
    const cur = Number(r.charges?.bedRent) || 0;
    if (cur > 0 && !force) { mtxSkipped++; log.push(`  = matrix ${r.categoryCode} already priced (bed ₹${cur})`); continue; }
    const rate = ratesFor(r.categoryCode, r.categoryName);
    mtxUpdated++;
    log.push(`  ~ matrix ${r.categoryCode} (${r.categoryName}) → bed ₹${rate.bedRent}, nursing ₹${rate.nursingCharge}${rate.monitoringCharge ? `, monitoring ₹${rate.monitoringCharge}` : ""}`);
    if (apply) {
      const set = { "charges.bedRent": rate.bedRent, "charges.nursingCharge": rate.nursingCharge };
      if (rate.monitoringCharge) set["charges.monitoringCharge"] = rate.monitoringCharge;
      await RoomCategoryCharges.updateOne({ _id: r._id }, { $set: set });
    }
  }

  // ── 2. legacy fallback shape on the RoomCategory doc (belt-and-suspenders) ──
  const cats = await RoomCategory.find({}).lean();
  for (const c of cats) {
    const cur = Number(c.defaultPricing?.perBedDailyRate) || 0;
    if (cur > 0 && !force) continue;
    const rate = ratesFor(c.categoryCode, c.categoryName);
    catTopped++;
    log.push(`  ~ category ${c.categoryCode} defaultPricing → bed ₹${rate.bedRent}, nursing ₹${rate.nursingCharge}`);
    if (apply) await RoomCategory.updateOne({ _id: c._id }, { $set: { "defaultPricing.perBedDailyRate": rate.bedRent, "defaultPricing.nursingCharges": rate.nursingCharge } });
  }

  console.log(log.join("\n"));
  console.log(`\n[seedRoomCharges] ${apply ? "APPLIED" : "DRY RUN"}${force ? " (force)" : ""} — matrix rows priced: ${mtxUpdated}, matrix skipped: ${mtxSkipped}, category fallback topped: ${catTopped}`);
  return { mtxUpdated, mtxSkipped, catTopped };
}

if (require.main === module) {
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/spherehealth";
  mongoose.connect(uri).then(() => run({ apply, force })).then(() => mongoose.disconnect()).then(() => process.exit(0))
    .catch((e) => { console.error("[seedRoomCharges] FAILED:", e.message); process.exit(1); });
}

module.exports = { run };
