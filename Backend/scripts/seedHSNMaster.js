/**
 * seedHSNMaster.js — R7hr-50
 *
 * Seeds the canonical HSN → GST table with common pharma + hospital
 * supply codes per CBIC notifications. Idempotent — re-running upserts
 * by `code` so existing rows aren't duplicated.
 *
 * GST rates here follow CBIC Notification 1/2017-CT(R) as amended:
 * - Life-saving / specific schedule drugs: 5%
 * - General medicaments + surgical: 12%
 * - Most medical devices / diagnostics: 12% or 18%
 * - Cosmetic / non-medical: 18%
 *
 * Reference: https://cbic-gst.gov.in/gst-goods-services-rates.html
 *
 * Usage:
 *   cd C:/Spherehealth/Backend && node scripts/seedHSNMaster.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const HSNMaster = require("../models/Pharmacy/HSNMasterModel");

// Curated list. Extend as new HSN codes appear in invoices.
const SEED = [
  // Pharmaceuticals — Chapter 30
  { code: "3001", description: "Glands & other organs for organo-therapeutic uses; heparin", gstRate: 12, category: "Medicines" },
  { code: "3002", description: "Human/animal blood; vaccines; toxins; cultures of micro-organisms", gstRate: 5,  category: "Medicines" },
  { code: "30021200", description: "Antisera and other blood fractions", gstRate: 5, category: "Medicines" },
  { code: "30022000", description: "Vaccines for human medicine", gstRate: 5, category: "Medicines" },
  { code: "3003", description: "Medicaments — two or more constituents — not put up for retail", gstRate: 12, category: "Medicines" },
  { code: "3004", description: "Medicaments — for therapeutic / prophylactic uses — retail packs", gstRate: 12, category: "Medicines" },
  { code: "30041010", description: "Penicillin formulations (oral)", gstRate: 12, category: "Medicines" },
  { code: "30042000", description: "Other antibiotics — oral/parenteral", gstRate: 12, category: "Medicines" },
  { code: "30043100", description: "Insulin formulations", gstRate: 5, category: "Medicines" },
  { code: "30049011", description: "Paracetamol-based formulations (oral)", gstRate: 12, category: "Medicines" },
  { code: "30049012", description: "Diclofenac / Ibuprofen NSAIDs (oral)", gstRate: 12, category: "Medicines" },
  { code: "30049013", description: "Antacid / Gastric formulations (oral)", gstRate: 12, category: "Medicines" },
  { code: "30049014", description: "Antihypertensive formulations (oral)", gstRate: 12, category: "Medicines" },
  { code: "30049015", description: "Antibiotic formulations — Amoxicillin etc.", gstRate: 12, category: "Medicines" },
  { code: "30049019", description: "Other formulations (oral) — fallback for 3004 99", gstRate: 12, category: "Medicines" },
  { code: "30049051", description: "Anti-cancer (oncology) formulations", gstRate: 5,  category: "Medicines" },
  { code: "30049053", description: "Anti-tuberculosis formulations", gstRate: 5, category: "Medicines" },
  { code: "30049057", description: "Anti-HIV antiretroviral formulations", gstRate: 5,  category: "Medicines" },
  { code: "30049063", description: "Cardiac formulations (oral)", gstRate: 12, category: "Medicines" },
  { code: "30049065", description: "Antidiabetic (non-insulin) oral formulations", gstRate: 12, category: "Medicines" },
  { code: "30049069", description: "Other parenteral / injectable medicaments", gstRate: 12, category: "Medicines" },
  { code: "30049099", description: "Medicaments — other / not elsewhere classified", gstRate: 12, category: "Medicines" },
  { code: "3005", description: "Wadding / gauze / bandages — impregnated", gstRate: 12, category: "Consumable" },
  { code: "3006", description: "Pharmaceutical goods — sterile, surgical, contraceptive", gstRate: 12, category: "Consumable" },
  { code: "30062000", description: "Blood-grouping reagents", gstRate: 12, category: "Diagnostic" },
  { code: "30063000", description: "Opacifying preparations for X-ray", gstRate: 12, category: "Diagnostic" },

  // Optical / medical devices — Chapter 90
  { code: "9018", description: "Instruments / appliances used in medical / surgical sciences", gstRate: 12, category: "Equipment" },
  { code: "90181200", description: "Ultrasonic scanning apparatus", gstRate: 12, category: "Equipment" },
  { code: "90181300", description: "MRI apparatus", gstRate: 12, category: "Equipment" },
  { code: "90181410", description: "Scintigraphic apparatus", gstRate: 12, category: "Equipment" },
  { code: "90183100", description: "Syringes — with/without needles", gstRate: 12, category: "Consumable" },
  { code: "90183200", description: "Tubular metal needles + needles for sutures", gstRate: 12, category: "Consumable" },
  { code: "90183900", description: "Other catheters, cannulae and the like", gstRate: 12, category: "Consumable" },
  { code: "9019", description: "Mechano-therapy / ozone / oxygen apparatus", gstRate: 12, category: "Equipment" },
  { code: "9021", description: "Orthopedic appliances; splints / fractures appliances; prosthetics", gstRate: 5, category: "Equipment" },
  { code: "9022", description: "Apparatus based on X-rays / alpha-beta-gamma radiation", gstRate: 12, category: "Equipment" },

  // Disinfectants & hygiene — Chapter 34
  { code: "3401", description: "Soap; surface-active products for soap-substitute use", gstRate: 18, category: "Consumable" },
  { code: "3402", description: "Organic surface-active agents — detergents / cleaning prep", gstRate: 18, category: "Consumable" },
  { code: "3808", description: "Disinfectants / pesticides / fungicides — for human hygiene use", gstRate: 18, category: "Consumable" },

  // Common ward/OT consumables
  { code: "3923", description: "Plastic containers / closures / stoppers for pharma", gstRate: 18, category: "Consumable" },
  { code: "4015", description: "Rubber surgical gloves / examination gloves", gstRate: 12, category: "Consumable" },
  { code: "6210", description: "Surgical gowns / drapes — non-woven", gstRate: 12, category: "Consumable" },
  { code: "6307", description: "Made-up textile articles — face masks, surgical caps", gstRate: 5, category: "Consumable" },

  // Stationery used in pharmacy — for non-drug GRN items
  { code: "4820", description: "Registers, ledger books, exercise books — paper stationery", gstRate: 18, category: "Other" },
];

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017/sphereHealth";
  await mongoose.connect(uri);
  console.log(`[seedHSNMaster] connected to ${uri.split("@").pop()}`);

  let inserted = 0, updated = 0;
  for (const row of SEED) {
    const r = await HSNMaster.findOneAndUpdate(
      { code: row.code },
      { $set: { ...row, isActive: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (r.createdAt && new Date() - new Date(r.createdAt) < 5000) inserted++;
    else updated++;
  }
  console.log(`[seedHSNMaster] inserted/touched: ${inserted}, updated: ${updated}, total: ${SEED.length}`);

  // R7hr-50 — backfill existing Drugs that have an hsnCode but no master row.
  const Drug = require("../models/Pharmacy/DrugModel");
  const drugsWithHsn = await Drug.find({ hsnCode: { $exists: true, $ne: "" } }, "hsnCode gstRate").lean();
  let fixed = 0;
  for (const d of drugsWithHsn) {
    const master = await HSNMaster.findOne({ code: d.hsnCode }).lean();
    if (master && master.gstRate !== d.gstRate) {
      await Drug.updateOne({ _id: d._id }, { $set: { gstRate: master.gstRate } });
      fixed++;
    }
  }
  console.log(`[seedHSNMaster] backfilled ${fixed} Drug rows where gstRate diverged from HSN master`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error("[seedHSNMaster] FAILED:", err);
  process.exit(1);
});
