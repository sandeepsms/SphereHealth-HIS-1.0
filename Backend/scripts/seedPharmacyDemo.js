/**
 * seedPharmacyDemo.js  (R7ho)
 *
 * Fresh stock for the OPD prescription demo flow. Three jobs:
 *   1. Upsert SKUs the existing seeds are missing — Drotaverine 80 mg,
 *      Norfloxacin 400 mg, Bifilac probiotic, ORS sachet (WHO formula).
 *   2. Add a fresh batch (qty 1000, expiry +6 months) for every drug
 *      that appears in the AGE-demo Rx so the "Dispense All" modal
 *      flips from "out of stock" to ready-to-sell.
 *   3. Top-up batches for the broader OPD formulary (50 common drugs)
 *      so future demos don't keep falling off zero stock.
 *
 * Idempotent. Re-running just adds another batch with a unique batch
 * number suffixed with the run timestamp, so the FEFO queue always
 * has a fresh head batch.
 *
 * Run:
 *   node Backend/scripts/seedPharmacyDemo.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const connectDB = require("../config/db");

const Drug      = require("../models/Pharmacy/DrugModel");
const DrugBatch = require("../models/Pharmacy/DrugBatchModel");

// ── Missing SKUs to upsert ────────────────────────────────────────
const MISSING_SKUS = [
  {
    name: "Drotaverine 80mg",
    genericName: "Drotaverine HCl",
    brandName: "Drotin DS",
    manufacturer: "Walter Bushnell",
    form: "Tablet", strength: "80mg", pack: "10 tabs/strip",
    category: "Gastro", schedule: "H", hsnCode: "30049099",
    gstRate: 12, reorderLevel: 80, defaultSalePrice: 14,
  },
  {
    name: "Norfloxacin 400mg",
    genericName: "Norfloxacin",
    brandName: "Norflox-400",
    manufacturer: "Cipla",
    form: "Tablet", strength: "400mg", pack: "10 tabs/strip",
    category: "Antibiotic", schedule: "H", hsnCode: "30049099",
    gstRate: 12, reorderLevel: 80, defaultSalePrice: 9,
  },
  {
    name: "Bifilac (probiotic)",
    genericName: "Lactobacillus + Streptococcus + Bifidobacterium",
    brandName: "Bifilac",
    manufacturer: "Tablets India",
    form: "Capsule", strength: "Probiotic blend", pack: "10 caps/strip",
    category: "Gastro", schedule: "OTC", hsnCode: "30049099",
    gstRate: 12, reorderLevel: 60, defaultSalePrice: 18,
  },
  {
    name: "ORS Sachet WHO",
    genericName: "Oral Rehydration Salts",
    brandName: "ORS-Lite",
    manufacturer: "FDC",
    form: "Powder", strength: "WHO formula", pack: "Sachet 21g",
    category: "Gastro", schedule: "OTC", hsnCode: "30049099",
    gstRate: 5, reorderLevel: 200, defaultSalePrice: 18,
  },
];

// ── Drugs that appear in the AGE Rx — must have ≥1 fresh batch. ──
// Lookup is by NAME (post form-prefix-strip), matching how the
// Dispense All matcher resolves prescriptions.
const RX_DRUGS = [
  "Pantoprazole 40mg",
  "Ondansetron 4mg",
  "Drotaverine 80mg",
  "Norfloxacin 400mg",
  "Bifilac (probiotic)",
  "Paracetamol 500mg",
  "ORS Sachet WHO",
];

// ── Top-up list — common OPD drugs that get re-stocked every run so
// demo prescriptions always have stock. Names match the existing
// seedPharmacy.js master rows. ─────────────────────────────────────
const TOPUP_LIST = [
  "Paracetamol 500mg", "Paracetamol 650mg",
  "Pantoprazole 40mg", "Pantoprazole 40mg Inj",
  "Ondansetron 4mg", "Ondansetron 4mg Inj", "Ondansetron 8mg",
  "Drotaverine 40mg", "Drotaverine 80mg",
  "Norfloxacin 400mg",
  "Bifilac (probiotic)",
  "ORS Powder", "ORS Sachet WHO",
  "Amoxicillin + Clavulanate 625mg",
  "Azithromycin 500mg",
  "Cefixime 200mg",
  "Diclofenac 50mg",
  "Ibuprofen 400mg",
  "Cetirizine 10mg",
  "Levocetirizine 5mg",
  "Montelukast 10mg",
  "Metformin 500mg",
  "Telmisartan 40mg",
  "Amlodipine 5mg",
  "Atorvastatin 10mg",
  "Levothyroxine 50mcg",
  "Multivitamin",
  "Vitamin D3 60K",
  "Iron + Folic Acid",
  "Calcium + Vitamin D3",
];

const TOPUP_QTY = 1000;          // units per fresh batch
const EXPIRY_MONTHS = 8;         // 8 months from today

(async () => {
  await connectDB();
  console.log("→ R7ho — Fresh demo pharmacy stock\n");

  // 1) Upsert missing SKUs
  const upserted = [];
  for (const spec of MISSING_SKUS) {
    const existing = await Drug.findOne({ name: spec.name }).lean();
    if (existing) {
      console.log(`  ✓ exists: ${spec.name}`);
      continue;
    }
    const drug = await Drug.create({ ...spec, createdBy: "seedPharmacyDemo" });
    upserted.push(drug.name);
    console.log(`  + created: ${drug.name} (${drug.brandName})`);
  }
  console.log(`\n→ Upserted ${upserted.length} new SKUs.\n`);

  // 2) Fresh batches for RX_DRUGS + TOPUP_LIST (union, de-duped)
  const unionList = [...new Set([...RX_DRUGS, ...TOPUP_LIST])];
  const runStamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + EXPIRY_MONTHS);

  let added = 0, skipped = 0;
  for (const drugName of unionList) {
    const drug = await Drug.findOne({ name: drugName }).lean();
    if (!drug) {
      console.log(`  ✗ master missing: ${drugName} (skipped)`);
      skipped++;
      continue;
    }
    const batchNo = `DEMO-${runStamp}-${drug._id.toString().slice(-4)}`;
    // Skip if this exact batch was already created (idempotency).
    const dup = await DrugBatch.findOne({ drugId: drug._id, batchNo }).lean();
    if (dup) {
      console.log(`  ⊜ batch exists: ${drugName} [${batchNo}]`);
      continue;
    }
    const mrp        = Number(drug.defaultSalePrice || 0) || 10;
    const salePrice  = mrp; // post-discount equal to MRP for demo
    const purchase   = Math.max(0.5, Math.round(mrp * 0.65 * 100) / 100);
    await DrugBatch.create({
      drugId:       drug._id,
      drugName:     drug.name,
      batchNo,
      expiryDate:   expiry,
      mfgDate:      new Date(),
      quantityIn:   TOPUP_QTY,
      quantityOut:  0,
      vendorReturned: 0,
      remaining:    TOPUP_QTY,
      purchaseRate: purchase,
      mrp:          mrp,
      salePrice:    salePrice,
      supplierName: "MediCorp Distributors",
      grnNumber:    `GRN-${runStamp}`,
      invoiceNo:    `INV-DEMO-${runStamp}`,
      invoiceDate:  new Date(),
      location:     "Main Pharmacy",
      isActive:     true,
      createdBy:    "seedPharmacyDemo",
    });
    added++;
    console.log(`  + batch: ${drugName} → ${TOPUP_QTY} units [${batchNo}] exp ${expiry.toLocaleDateString("en-IN")}`);
  }

  console.log(`\n✓ Fresh batches added: ${added} | skipped (no master): ${skipped}`);
  console.log("✓ Done. The Dispense All modal should now find stock for all AGE-Rx drugs.\n");
  process.exit(0);
})();
