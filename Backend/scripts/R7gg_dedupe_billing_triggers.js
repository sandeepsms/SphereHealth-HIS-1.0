// R7gg — One-off cleanup for the BillingTrigger duplicate explosion.
//
// Symptom on Badal admission (6a193e0eed2429852cbf9853):
//   - 36,925 BillingTrigger rows all pointing to the SAME
//     NursingChargeEntry (one Foley Catheter ₹300 × 1).
//   - IPD Live Ledger byCategory shows EQUIP = ₹1.10 crore / 32k lines.
//   - Reception Billing Counter froze loading the same payload.
//
// Root cause patched in services/Billing/autoBillingService.js:
//   onEquipmentCharged now checks for an existing trigger with the same
//   sourceDocumentId before creating; bails out if one exists. So no
//   new duplicates will be created.
//
// This script cleans the historical mess:
//   For each (sourceDocumentModel, sourceDocumentId) bucket, keep the
//   single earliest BillingTrigger row. Delete the rest. Logs counts
//   per bucket so the operator can audit.
//
// Usage:
//   node scripts/R7gg_dedupe_billing_triggers.js          # dry run
//   node scripts/R7gg_dedupe_billing_triggers.js --apply  # do it

const mongoose = require("mongoose");
require("dotenv").config();

const APPLY = process.argv.includes("--apply");

(async () => {
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";
  await mongoose.connect(uri);
  console.log("[R7gg] connected.", APPLY ? "APPLY MODE" : "DRY RUN");

  const BillingTrigger = require("../models/Billing/BillingTrigger");

  // Find buckets where the same source produced >1 trigger.
  const dupBuckets = await BillingTrigger.aggregate([
    { $match: { sourceDocumentId: { $ne: null } } },
    {
      $group: {
        _id: { src: "$sourceDocumentId", model: "$sourceDocumentModel" },
        n: { $sum: 1 },
        ids: { $push: { id: "$_id", at: "$createdAt" } },
      },
    },
    { $match: { n: { $gt: 1 } } },
    { $sort: { n: -1 } },
  ]);

  console.log(`[R7gg] found ${dupBuckets.length} polluted source documents.`);
  let totalDuplicates = 0;
  const topRows = [];
  for (const b of dupBuckets) {
    const dupCount = b.n - 1;
    totalDuplicates += dupCount;
    if (topRows.length < 10) {
      topRows.push({
        src: b._id.src.toString(),
        model: b._id.model,
        total: b.n,
        toDelete: dupCount,
      });
    }
  }
  console.log("[R7gg] top 10 polluted sources:");
  console.table(topRows);
  console.log(`[R7gg] total duplicate triggers to remove: ${totalDuplicates}`);

  if (!APPLY) {
    console.log("[R7gg] dry run — pass --apply to actually delete.");
    await mongoose.disconnect();
    return;
  }

  // Apply: for each bucket, keep the earliest (smallest createdAt),
  // delete every other id.
  let deleted = 0;
  for (const b of dupBuckets) {
    const sorted = b.ids.slice().sort((a, b) => new Date(a.at) - new Date(b.at));
    const keep = sorted[0].id;
    const drop = sorted.slice(1).map((x) => x.id);
    if (drop.length === 0) continue;
    const res = await BillingTrigger.deleteMany({ _id: { $in: drop } });
    deleted += res.deletedCount || 0;
  }
  console.log(`[R7gg] deleted ${deleted} duplicate triggers across ${dupBuckets.length} polluted sources.`);

  await mongoose.disconnect();
})().catch((e) => {
  console.error("[R7gg] FATAL:", e);
  process.exit(1);
});
