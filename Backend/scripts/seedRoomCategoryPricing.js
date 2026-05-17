/**
 * seedRoomCategoryPricing.js
 *
 * Idempotent one-shot seeder that sets sensible Indian-hospital default
 * pricing on RoomCategory documents whose `defaultPricing` is still zero.
 *
 * Why this exists: the new event-driven billing engine prices bed +
 * nursing daily charges from `roomCategory.defaultPricing.perBedDailyRate`
 * and `.nursingCharges`. If a category was created without pricing, the
 * billing engine correctly bills ₹0 — which looks like "AI billing isn't
 * tracking" to the user. Run this once after first install to give every
 * existing category a starting point.
 *
 * Usage:
 *   node Backend/scripts/seedRoomCategoryPricing.js
 *
 * Skips categories where ANY of bedRate / nursing / equipment / deposit
 * is already non-zero (treats that category as already configured).
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const RoomCategory = require("../models/bedMgmt/roomCategoryModel");

// Match by categoryCode (preferred) or by roomType (fallback for custom codes).
// All rates are in INR per day.
const DEFAULTS_BY_CODE = {
  ICU:  { bed: 3500, nursing: 1500, equipment: 500, deposit: 25000 },
  PVT:  { bed: 2500, nursing:  800, equipment: 200, deposit: 15000 },
  PEDI: { bed: 1200, nursing:  600, equipment: 150, deposit: 10000 },
  GENW: { bed:  600, nursing:  300, equipment:  50, deposit:  5000 },
  EMRG: { bed:  800, nursing:  400, equipment: 100, deposit:  3000 },
  TRMT: { bed:  400, nursing:  200, equipment:  50, deposit:  2000 },
};

const DEFAULTS_BY_TYPE = {
  "ICU":           { bed: 3500, nursing: 1500, equipment: 500, deposit: 25000 },
  "NICU":          { bed: 4000, nursing: 1800, equipment: 600, deposit: 30000 },
  "CCU":           { bed: 4000, nursing: 1800, equipment: 600, deposit: 30000 },
  "HDU":           { bed: 2800, nursing: 1200, equipment: 400, deposit: 20000 },
  "Private Room":  { bed: 2500, nursing:  800, equipment: 200, deposit: 15000 },
  "Semi-Private":  { bed: 1500, nursing:  500, equipment: 100, deposit: 10000 },
  "Deluxe":        { bed: 4500, nursing: 1000, equipment: 300, deposit: 20000 },
  "Suite":         { bed: 8000, nursing: 1500, equipment: 500, deposit: 30000 },
  "Pediatric":     { bed: 1200, nursing:  600, equipment: 150, deposit: 10000 },
  "Maternity":     { bed: 2000, nursing:  900, equipment: 250, deposit: 15000 },
  "Isolation":     { bed: 2500, nursing: 1000, equipment: 300, deposit: 15000 },
  "Recovery Room": { bed:  500, nursing:  300, equipment: 100, deposit:  2000 },
  "Emergency":     { bed:  800, nursing:  400, equipment: 100, deposit:  3000 },
  "Daycare":       { bed:  600, nursing:  250, equipment:  50, deposit:  2000 },
  "Operation Theatre": { bed: 0, nursing: 0, equipment: 0, deposit: 0 }, // priced per procedure
  "General Ward":  { bed:  600, nursing:  300, equipment:  50, deposit:  5000 },
  "Other":         { bed:  500, nursing:  250, equipment:  50, deposit:  2000 },
};

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) { console.error("MONGO_URI missing in .env"); process.exit(1); }
  await mongoose.connect(uri);

  const cats = await RoomCategory.find({ isActive: true });
  let updated = 0, skipped = 0, unmatched = 0;

  for (const c of cats) {
    const dp = c.defaultPricing || {};
    const anyNonZero = (dp.perBedDailyRate > 0) || (dp.nursingCharges > 0)
                    || (dp.equipmentCharges > 0) || (dp.securityDeposit > 0);
    if (anyNonZero) { skipped++; continue; }

    const def = DEFAULTS_BY_CODE[c.categoryCode] || DEFAULTS_BY_TYPE[c.roomType];
    if (!def) {
      console.warn(`[seed] no defaults for ${c.categoryCode}/${c.roomType} — skipping`);
      unmatched++;
      continue;
    }

    c.defaultPricing = {
      perBedDailyRate:  def.bed,
      nursingCharges:   def.nursing,
      equipmentCharges: def.equipment,
      securityDeposit:  def.deposit,
      currency: "INR",
    };
    await c.save();
    updated++;
    console.log(`[seed] ${c.categoryCode} (${c.roomType}) — bed=₹${def.bed} nursing=₹${def.nursing} equip=₹${def.equipment} deposit=₹${def.deposit}`);
  }

  console.log(`\n✅ done — updated:${updated} skipped:${skipped} unmatched:${unmatched}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
