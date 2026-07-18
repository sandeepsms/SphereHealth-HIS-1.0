/**
 * scripts/seed/seedInvestigationCatalog.js  (GAP-1 fix)
 *
 * A fresh deployment ships with almost no lab masters (observed: only CBC), so
 * a doctor cannot order the common workup labs — including the pancreatitis-
 * defining panel (serum lipase / amylase / calcium / LFT / RFT). Those could
 * only be free-texted into a doctor-order: no structured result, no reference
 * range, no critical-value alert, no per-test billing.
 *
 * This seeds a baseline investigation catalog with parameters, reference +
 * critical ranges (so the R9-045 panic-value alert works out of the box), and a
 * CASH InvestigationPricing row per test (so the charge accrues). IDEMPOTENT:
 * matches on investigationName (case-insensitive) and skips existing masters;
 * only tops up a missing pricing row. Run once per deployment:
 *
 *     node scripts/seed/seedInvestigationCatalog.js            # dry run
 *     node scripts/seed/seedInvestigationCatalog.js --apply    # write
 *
 * Ranges are conservative adult defaults (Tietz / common lab references) — a lab
 * MUST review + adjust for its own methods/analysers/population. This only makes
 * the tests orderable + safe-by-default, not a substitute for validated limits.
 */
"use strict";

const mongoose = require("mongoose");

const R = (low, high, criticalLow = null, criticalHigh = null) => ({
  sex: "ANY", ageMinYears: 0, ageMaxYears: 200, low, high, criticalLow, criticalHigh,
  text: (low != null || high != null) ? `${low ?? ""} - ${high ?? ""}`.trim() : "",
});

// name, category, sampleType, price, parameters[{name, unit, ranges[]}]
const CATALOG = [
  { name: "Serum Lipase", category: "BIOCHEMISTRY", sampleType: "Serum", price: 500,
    parameters: [{ name: "Lipase", unit: "U/L", ranges: [R(10, 140, null, 600)] }] },
  { name: "Serum Amylase", category: "BIOCHEMISTRY", sampleType: "Serum", price: 400,
    parameters: [{ name: "Amylase", unit: "U/L", ranges: [R(25, 125, null, 600)] }] },
  { name: "Serum Calcium", category: "BIOCHEMISTRY", sampleType: "Serum", price: 200,
    parameters: [{ name: "Calcium", unit: "mg/dL", ranges: [R(8.5, 10.5, 6.5, 13)] }] },
  { name: "Serum Electrolytes", category: "BIOCHEMISTRY", sampleType: "Serum", price: 400,
    parameters: [
      { name: "Sodium", unit: "mmol/L", ranges: [R(135, 145, 120, 160)] },
      { name: "Potassium", unit: "mmol/L", ranges: [R(3.5, 5.1, 2.8, 6.2)] },
      { name: "Chloride", unit: "mmol/L", ranges: [R(98, 107, 80, 120)] },
    ] },
  { name: "Liver Function Test (LFT)", category: "BIOCHEMISTRY", sampleType: "Serum", price: 600,
    parameters: [
      { name: "Total Bilirubin", unit: "mg/dL", ranges: [R(0.2, 1.2, null, 15)] },
      { name: "SGOT (AST)", unit: "U/L", ranges: [R(5, 40)] },
      { name: "SGPT (ALT)", unit: "U/L", ranges: [R(7, 56)] },
      { name: "Alkaline Phosphatase", unit: "U/L", ranges: [R(44, 147)] },
      { name: "Albumin", unit: "g/dL", ranges: [R(3.5, 5.0)] },
    ] },
  { name: "Renal Function Test (RFT)", category: "BIOCHEMISTRY", sampleType: "Serum", price: 500,
    parameters: [
      { name: "Blood Urea", unit: "mg/dL", ranges: [R(15, 40, null, 200)] },
      { name: "Serum Creatinine", unit: "mg/dL", ranges: [R(0.7, 1.3, null, 7.4)] },
      { name: "Uric Acid", unit: "mg/dL", ranges: [R(3.5, 7.2)] },
    ] },
  { name: "Random Blood Sugar (RBS)", category: "BIOCHEMISTRY", sampleType: "Serum", price: 80,
    parameters: [{ name: "Glucose", unit: "mg/dL", ranges: [R(70, 140, 40, 500)] }] },
  { name: "Serum Lactate", category: "BIOCHEMISTRY", sampleType: "Serum", price: 350,
    parameters: [{ name: "Lactate", unit: "mmol/L", ranges: [R(0.5, 2.2, null, 4)] }] },
  { name: "C-Reactive Protein (CRP)", category: "BIOCHEMISTRY", sampleType: "Serum", price: 400,
    parameters: [{ name: "CRP", unit: "mg/L", ranges: [R(0, 6)] }] },
  { name: "Serum Magnesium", category: "BIOCHEMISTRY", sampleType: "Serum", price: 250,
    parameters: [{ name: "Magnesium", unit: "mg/dL", ranges: [R(1.7, 2.4, 1.0, 4.7)] }] },
];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

async function run({ apply = false } = {}) {
  const InvestigationMaster = require("../../models/Investigation/InvestigationMasterModel");
  const InvestigationPricing = require("../../models/Investigation/InvestigationPricingModel");
  let created = 0, pricingAdded = 0, skipped = 0;
  const log = [];

  const existing = await InvestigationMaster.find({}).select("investigationName").lean();
  const seen = new Set(existing.map((e) => norm(e.investigationName)));

  for (const t of CATALOG) {
    if (seen.has(norm(t.name))) {
      skipped++;
      log.push(`  = exists, skip: ${t.name}`);
      // still ensure a pricing row exists
      const m = await InvestigationMaster.findOne({ investigationName: new RegExp(`^${t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).select("_id").lean();
      if (m) {
        const hasPrice = await InvestigationPricing.exists({ investigationId: m._id, tariffType: "CASH" });
        if (!hasPrice) {
          pricingAdded++;
          log.push(`  + pricing (CASH ₹${t.price}) for existing ${t.name}`);
          if (apply) await InvestigationPricing.create({ investigationId: m._id, tariffType: "CASH", price: t.price, finalPrice: t.price, discount: 0, isActive: true, effectiveFrom: new Date("2026-01-01") });
        }
      }
      continue;
    }
    created++;
    log.push(`  + master: ${t.name} (${t.category}, ₹${t.price}, ${t.parameters.length} param)`);
    if (apply) {
      const doc = new InvestigationMaster({
        investigationName: t.name, category: t.category, sampleType: t.sampleType,
        performedAt: "INTERNAL", defaultPrice: t.price, isActive: true,
        parameters: t.parameters.map((p, i) => ({ name: p.name, unit: p.unit, displayOrder: i + 1, referenceRanges: p.ranges })),
      });
      await doc.save(); // pre-save generates investigationCode (BIO-00N)
      pricingAdded++;
      await InvestigationPricing.create({ investigationId: doc._id, tariffType: "CASH", price: t.price, finalPrice: t.price, discount: 0, isActive: true, effectiveFrom: new Date("2026-01-01") });
    }
  }

  console.log(log.join("\n"));
  console.log(`\n[seedInvestigationCatalog] ${apply ? "APPLIED" : "DRY RUN"} — masters created: ${created}, pricing rows: ${pricingAdded}, skipped(existing): ${skipped}`);
  return { created, pricingAdded, skipped };
}

if (require.main === module) {
  const apply = process.argv.includes("--apply");
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/spherehealth";
  mongoose.connect(uri).then(() => run({ apply })).then(() => mongoose.disconnect()).then(() => process.exit(0))
    .catch((e) => { console.error("[seedInvestigationCatalog] FAILED:", e.message); process.exit(1); });
}

module.exports = { run, CATALOG };
