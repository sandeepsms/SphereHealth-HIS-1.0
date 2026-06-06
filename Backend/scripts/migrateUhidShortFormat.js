/**
 * migrateUhidShortFormat.js  (R7ha)
 *
 * Renames every existing UHID from the 8-digit-padded format (UH00000001)
 * to the new short format (UH01) and rewrites the value across every
 * collection that references it. After the sweep, resets the
 * `uhid:global` Counter so the next-created patient picks up UHnn where
 * nn is the patient count + 1 (no gaps, no duplicates).
 *
 * Safe to re-run — the regex match guards against re-mapping already-short
 * UHIDs. Run only when the database has <=N patients (we ran with 7).
 *
 * Run:
 *   node Backend/scripts/migrateUhidShortFormat.js               # DRY-RUN: print mapping + per-collection counts
 *   node Backend/scripts/migrateUhidShortFormat.js --apply       # actually write the updates
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose  = require("mongoose");
const connectDB = require("../config/db");

const APPLY = process.argv.includes("--apply");

// Field names that may carry a patient UHID across the database.
// Found via: grep -rE "UHID\\s*:\\s*\\{\\s*type|patientUHID\\s*:\\s*\\{\\s*type" models/
const UHID_FIELDS = ["UHID", "patientUHID"];

// Field shape for nested fields seen in BillingAudit / printAudit etc.
const NESTED_PATHS = [
  "context.UHID",       // BillingAudit
  "before.UHID",        // ClinicalAudit before/after snapshots
  "after.UHID",
  "context.patientUHID",
];

(async () => {
  await connectDB();
  const db = mongoose.connection.db;

  // ─── 1. Build the old→new mapping for Patient docs ────────────────
  const Patient = require("../models/Patient/patientModel");
  const patients = await Patient.find({}, "_id UHID fullName createdAt").sort({ createdAt: 1 }).lean();
  console.log(`\n  Patients in DB: ${patients.length}\n`);

  if (!patients.length) {
    console.log("  Nothing to migrate.");
    process.exit(0);
  }

  // Only consider the OLD 8-digit-padded format (UH followed by exactly 9-10
  // chars where 8 are zero-padded digits). Already-short UHIDs (UH01) are
  // skipped — script is idempotent.
  const OLD_PAT = /^UH0\d{7,}$/;
  const mapping = new Map();
  let nextSeq = 1;
  for (const p of patients) {
    if (!p.UHID) continue;
    const newUhid = `UH${String(nextSeq).padStart(2, "0")}`;
    if (p.UHID === newUhid) {
      console.log(`  [skip] ${p.UHID} already canonical — ${p.fullName || ""}`);
      nextSeq++;
      continue;
    }
    if (!OLD_PAT.test(p.UHID)) {
      console.log(`  [skip] ${p.UHID} unfamiliar shape — leaving alone (${p.fullName || ""})`);
      continue;
    }
    mapping.set(p.UHID, newUhid);
    console.log(`  ${p.UHID} → ${newUhid}   ${p.fullName || ""}`);
    nextSeq++;
  }

  if (!mapping.size) {
    console.log("\n  All UHIDs already in canonical format. Nothing to do.\n");
    process.exit(0);
  }

  // ─── 2. List all collections and rewrite UHID values across them ─
  const collections = await db.listCollections().toArray();
  console.log(`\n  Sweeping ${collections.length} collections for UHID values to rewrite…\n`);

  let totalUpdated = 0;
  const perColl = [];

  for (const c of collections) {
    if (c.type !== "collection") continue;
    if (c.name.startsWith("system.")) continue;

    const coll = db.collection(c.name);
    let updatedHere = 0;

    for (const [oldUhid, newUhid] of mapping.entries()) {
      // 1) Top-level fields
      for (const f of UHID_FIELDS) {
        const filter = { [f]: oldUhid };
        if (APPLY) {
          const r = await coll.updateMany(filter, { $set: { [f]: newUhid } });
          updatedHere += r.modifiedCount;
        } else {
          const cnt = await coll.countDocuments(filter);
          updatedHere += cnt;
        }
      }
      // 2) Nested paths (audit snapshots)
      for (const path of NESTED_PATHS) {
        const filter = { [path]: oldUhid };
        if (APPLY) {
          const r = await coll.updateMany(filter, { $set: { [path]: newUhid } });
          updatedHere += r.modifiedCount;
        } else {
          const cnt = await coll.countDocuments(filter);
          updatedHere += cnt;
        }
      }
    }

    if (updatedHere) {
      perColl.push({ collection: c.name, count: updatedHere });
      totalUpdated += updatedHere;
    }
  }

  console.log(`  ${APPLY ? "Updated" : "[DRY-RUN] would update"} ${totalUpdated} documents across ${perColl.length} collections:\n`);
  perColl.sort((a, b) => b.count - a.count).forEach(r => {
    console.log(`    ${r.collection.padEnd(40)} ${r.count}`);
  });

  // ─── 3. Reset the uhid:global counter so the next patient is UHnn+1
  if (APPLY) {
    const Counter = require("../models/CounterModel");
    const newSeq = patients.length;  // next patient will pick seq+1
    await Counter.findOneAndUpdate(
      { _id: "uhid:global" },
      { $set: { seq: newSeq } },
      { upsert: true },
    );
    console.log(`\n  ✓ Reset Counter.uhid:global.seq = ${newSeq} (next patient will be UH${String(newSeq+1).padStart(2,"0")})`);
  } else {
    console.log(`\n  [DRY-RUN] would set Counter.uhid:global.seq = ${patients.length}`);
  }

  // ─── 4. Verify Patient sample
  if (APPLY) {
    const after = await Patient.find({}, "UHID fullName").sort({ createdAt: 1 }).limit(20).lean();
    console.log("\n  Patient UHIDs after migration:");
    after.forEach(p => console.log(`    ${p.UHID}  ${p.fullName || ""}`));
  }

  console.log("\n  Done.\n");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
