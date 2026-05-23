// scripts/fixBillNumberIndex.js
// ════════════════════════════════════════════════════════════════════
// R7bp-FIX (audit P0) — billNumber dup-null E11000 cleanup.
//
// PROBLEM
//   Adding a service to an OPD bill crashes with:
//     E11000 duplicate key error collection: spherehealth.patientbills
//     index: billNumber_1 dup key: { billNumber: null }
//
//   ROOT CAUSE: the legacy `billNumber_1` index on patientbills was
//   created as a PLAIN unique index (no sparse, no partialFilterExpression).
//   MongoDB treats `null` as a value in unique indexes, so only ONE
//   document with `billNumber: null` is allowed across the whole
//   collection. The moment a SECOND DRAFT bill (also null) tries to
//   insert, the unique constraint fires and the controller 500s.
//
//   The schema was later updated to declare `sparse: true`, but Mongoose
//   NEVER alters an existing index — it only creates indexes whose name
//   is missing. So the schema declaration was a no-op against the live
//   DB.
//
// FIX
//   1. Drop the legacy `billNumber_1` index.
//   2. Create `billNumber_unique_partial` — a PARTIAL unique index
//      filtered to `{ billNumber: { $type: "string" } }`. This lets
//      unlimited DRAFT bills with null/missing billNumber coexist, while
//      still guaranteeing every finalised bill carries a unique
//      formal-document number (NABH / IT-Rule-46 series invariant).
//
// USAGE
//   DRY-RUN (default — no writes):
//     node Backend/scripts/fixBillNumberIndex.js
//
//   APPLY (drop + recreate):
//     node Backend/scripts/fixBillNumberIndex.js --apply
//
// SAFE
//   - Idempotent: re-running after a successful apply is a no-op
//     (script detects the new index already exists and skips).
//   - Never modifies any PatientBill document — only index metadata.
//   - Surfaces duplicate non-null billNumbers (rare, but possible from
//     concurrent generateFinalBill races) WITHOUT touching them; flags
//     them for manual review.
// ════════════════════════════════════════════════════════════════════

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

const COLL = "patientbills";
const LEGACY_INDEX_NAME = "billNumber_1";
const NEW_INDEX_NAME    = "billNumber_unique_partial";
const NEW_INDEX_KEY     = { billNumber: 1 };
const NEW_INDEX_OPTS    = {
  unique: true,
  partialFilterExpression: { billNumber: { $type: "string" } },
  name: NEW_INDEX_NAME,
};

function log(...a) { console.log(...a); }

async function main() {
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";
  await mongoose.connect(uri);
  log(`[fixBillNumberIndex] mode: ${APPLY ? "APPLY (writes enabled)" : "DRY-RUN (no writes)"}`);
  log(`[fixBillNumberIndex] connected to ${uri}`);

  const db = mongoose.connection.db;
  const coll = db.collection(COLL);

  // ── 0. Snapshot the current state ──────────────────────────────────
  const indexes = await coll.indexes();
  const legacyIdx = indexes.find((i) => i.name === LEGACY_INDEX_NAME);
  const newIdx    = indexes.find((i) => i.name === NEW_INDEX_NAME);

  log("\n── BEFORE ─────────────────────────────────────────────────");
  log(`  ${LEGACY_INDEX_NAME}: ${legacyIdx ? JSON.stringify({
    key: legacyIdx.key,
    unique: legacyIdx.unique,
    sparse: legacyIdx.sparse,
    partialFilterExpression: legacyIdx.partialFilterExpression,
  }) : "(absent)"}`);
  log(`  ${NEW_INDEX_NAME}: ${newIdx ? JSON.stringify({
    key: newIdx.key,
    unique: newIdx.unique,
    partialFilterExpression: newIdx.partialFilterExpression,
  }) : "(absent)"}`);

  const totalBills = await coll.countDocuments({});
  const nullCount  = await coll.countDocuments({ billNumber: null });
  const missingCount = await coll.countDocuments({ billNumber: { $exists: false } });
  const draftNullCount = await coll.countDocuments({
    billNumber: null,
    billStatus: "DRAFT",
  });
  const finalisedWithNumberCount = await coll.countDocuments({
    billNumber: { $type: "string" },
    billStatus: { $in: ["GENERATED", "PARTIAL", "PAID", "REFUNDED"] },
  });
  log(`\n  total bills:                       ${totalBills}`);
  log(`  bills with billNumber=null:        ${nullCount}`);
  log(`  bills missing billNumber field:    ${missingCount}`);
  log(`  DRAFT bills with null billNumber:  ${draftNullCount}`);
  log(`  finalised bills with billNumber:   ${finalisedWithNumberCount}`);

  // ── 1. Duplicate non-null billNumber check (do NOT modify) ────────
  const dupes = await coll.aggregate([
    { $match: { billNumber: { $type: "string" } } },
    { $group: { _id: "$billNumber", n: { $sum: 1 }, ids: { $push: "$_id" }, statuses: { $push: "$billStatus" } } },
    { $match: { n: { $gt: 1 } } },
    { $sort: { _id: 1 } },
  ]).toArray();

  if (dupes.length) {
    log(`\n  ⚠️  DUPLICATE non-null billNumbers detected (${dupes.length}):`);
    dupes.forEach((d) => {
      log(`     billNumber=${d._id} n=${d.n} statuses=[${d.statuses.join(",")}] ids=[${d.ids.join(",")}]`);
    });
    log(`     These rows BLOCK the new partial unique index from building.`);
    log(`     Manual review required — do NOT delete; resequence via a credit-note + reissue flow.`);
    log(`     Aborting to avoid silent data loss.`);
    if (APPLY) {
      log(`     (re-run after resolving duplicates)`);
    }
    await mongoose.disconnect();
    process.exit(dupes.length ? 2 : 0);
  }
  log(`\n  ✓ no duplicate non-null billNumbers — safe to proceed.`);

  // ── 2. Plan ────────────────────────────────────────────────────────
  const plan = [];
  if (legacyIdx) {
    // Drop legacy only when its options DIFFER from what we want; if the
    // legacy index already happens to match the desired partial-unique
    // shape, we leave it alone and just rename via fresh-create later.
    const legacyMatchesDesired =
      legacyIdx.unique &&
      legacyIdx.partialFilterExpression &&
      legacyIdx.partialFilterExpression.billNumber &&
      legacyIdx.partialFilterExpression.billNumber.$type === "string";
    if (!legacyMatchesDesired) {
      plan.push(`DROP index "${LEGACY_INDEX_NAME}" (plain unique — causes E11000 on null)`);
    } else {
      log(`\n  ✓ legacy index already has the desired partial filter — nothing to drop.`);
    }
  }
  if (!newIdx) {
    plan.push(`CREATE index "${NEW_INDEX_NAME}" with partialFilterExpression { billNumber: { $type: "string" } }`);
  } else {
    log(`  ✓ new index "${NEW_INDEX_NAME}" already exists — skip CREATE.`);
  }

  log(`\n── PLAN ──────────────────────────────────────────────────`);
  if (plan.length === 0) {
    log(`  (nothing to do — DB already in target state)`);
    await mongoose.disconnect();
    return;
  }
  plan.forEach((p, i) => log(`  ${i + 1}. ${p}`));

  if (!APPLY) {
    log(`\n[fixBillNumberIndex] DRY-RUN complete. Re-run with --apply to execute.`);
    await mongoose.disconnect();
    return;
  }

  // ── 3. Apply ───────────────────────────────────────────────────────
  log(`\n── APPLY ─────────────────────────────────────────────────`);
  if (legacyIdx) {
    const legacyMatchesDesired =
      legacyIdx.unique &&
      legacyIdx.partialFilterExpression &&
      legacyIdx.partialFilterExpression.billNumber &&
      legacyIdx.partialFilterExpression.billNumber.$type === "string";
    if (!legacyMatchesDesired) {
      log(`  dropping "${LEGACY_INDEX_NAME}"...`);
      await coll.dropIndex(LEGACY_INDEX_NAME);
      log(`    ✓ dropped`);
    }
  }
  if (!newIdx) {
    log(`  creating "${NEW_INDEX_NAME}"...`);
    await coll.createIndex(NEW_INDEX_KEY, NEW_INDEX_OPTS);
    log(`    ✓ created`);
  }

  // ── 4. Verify ──────────────────────────────────────────────────────
  const afterIdx = (await coll.indexes()).find((i) => i.name === NEW_INDEX_NAME);
  log(`\n── AFTER ─────────────────────────────────────────────────`);
  log(`  ${NEW_INDEX_NAME}: ${afterIdx ? JSON.stringify({
    key: afterIdx.key,
    unique: afterIdx.unique,
    partialFilterExpression: afterIdx.partialFilterExpression,
  }) : "(absent — UNEXPECTED, please investigate)"}`);

  const afterNull   = await coll.countDocuments({ billNumber: null });
  const afterFinal  = await coll.countDocuments({
    billNumber: { $type: "string" },
    billStatus: { $in: ["GENERATED", "PARTIAL", "PAID", "REFUNDED"] },
  });
  log(`\n  DRAFT-ish (null billNumber) rows still present: ${afterNull}`);
  log(`  Finalised bills with billNumber:                 ${afterFinal}`);
  log(`\n[fixBillNumberIndex] APPLY complete.`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("[fixBillNumberIndex] FAILED:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
