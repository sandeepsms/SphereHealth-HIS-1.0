/**
 * seedPharmacyDemoFull.js (R7hr-62)
 *
 * Investor-demo emergency restock. Adds a single fresh DEMO batch to
 * EVERY active drug in the master so the pharmacy module looks alive
 * for a live demo (no zero-stock holes, no empty FEFO queues, no
 * out-of-stock toasts mid-walkthrough).
 *
 * Per drug:
 *   - qty:        1000
 *   - expiry:     +12 months
 *   - mfg:        today
 *   - mrp/sale:   drug.defaultSalePrice (or ₹10 fallback)
 *   - purchase:   0.6 × mrp
 *   - batchNo:    DEMO-{YYYYMMDDHHmm}-{drug._id.last4}
 *
 * Idempotent — re-running with the same minute timestamp will hit the
 * dup-batchNo guard and skip. Cross-day reruns just lay another fresh
 * head batch (FEFO will use the older one first, harmless).
 *
 * Run:
 *   node Backend/scripts/seedPharmacyDemoFull.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const connectDB = require("../config/db");

const Drug      = require("../models/Pharmacy/DrugModel");
const DrugBatch = require("../models/Pharmacy/DrugBatchModel");

const QTY            = 1000;
const EXPIRY_MONTHS  = 12;
const FALLBACK_PRICE = 10;

(async () => {
  await connectDB();
  console.log("\n→ R7hr-62 — Investor demo emergency restock — all drugs\n");

  const drugs = await Drug.find({ isActive: true }).lean();
  console.log(`  Found ${drugs.length} active drugs in master.`);

  const runStamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const expiry   = new Date();
  expiry.setMonth(expiry.getMonth() + EXPIRY_MONTHS);

  let added = 0, skipped = 0, failed = 0;
  for (const drug of drugs) {
    const batchNo = `DEMO-${runStamp}-${drug._id.toString().slice(-4)}`;
    try {
      const dup = await DrugBatch.findOne({ drugId: drug._id, batchNo }).lean();
      if (dup) { skipped++; continue; }

      const mrp        = Number(drug.defaultSalePrice || 0) || FALLBACK_PRICE;
      const salePrice  = mrp;
      const purchase   = Math.max(0.5, Math.round(mrp * 0.6 * 100) / 100);

      await DrugBatch.create({
        drugId:     drug._id,
        drugName:   drug.name,
        batchNo,
        expiryDate: expiry,
        mfgDate:    new Date(),
        // Schema computes `remaining = quantityIn - quantityOut - vendorReturned`
        // in pre('save'), so we only need to set quantityIn — leave the rest
        // at their schema defaults (0) and the hook fills remaining=QTY.
        quantityIn: QTY,
        purchasePrice: purchase,
        mrp,
        salePrice,
        gstRate:    drug.gstRate || 12,
        supplierName: "Demo Distributor",
        isActive:   true,
      });
      added++;
    } catch (e) {
      failed++;
      if (failed <= 5) console.log(`  ✗ ${drug.name}: ${e.message}`);
    }
  }

  console.log(`\n  ✓ Batches added: ${added}`);
  console.log(`  ⊜ Skipped (dup): ${skipped}`);
  if (failed) console.log(`  ✗ Failed:        ${failed}`);

  // Live totals
  const totalBatches = await DrugBatch.countDocuments({ isActive: true });
  const inStock      = await DrugBatch.countDocuments({ isActive: true, remaining: { $gt: 0 } });
  const valueAgg     = await DrugBatch.aggregate([
    { $match: { isActive: true, remaining: { $gt: 0 } } },
    { $group: { _id: null, v: { $sum: { $multiply: ["$remaining", { $ifNull: ["$salePrice", "$mrp"] }] } } } },
  ]);
  const stockValue = Math.round(valueAgg[0]?.v || 0);

  console.log("\n  Live totals:");
  console.log(`    Batches total:       ${totalBatches}`);
  console.log(`    Batches with stock:  ${inStock}`);
  console.log(`    Stock value:         ₹${stockValue.toLocaleString("en-IN")}\n`);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
