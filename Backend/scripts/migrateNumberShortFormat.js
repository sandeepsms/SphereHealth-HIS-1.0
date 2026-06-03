/**
 * migrateNumberShortFormat.js  (R7hb)
 *
 * Renames existing OPD admissionNumber + OPD visitNumber + bill numbers
 * from the long legacy formats to the short formats:
 *
 *   admissionNumber: OPD-YYYYMMDD-NNNN → OPD-YY-NN
 *   visitNumber:     OPD-YYYY-NNNNNN   → OPD-YY-NN
 *   billNumber:      BILL-YYYY-NNNNNN  → BILL-YY-NN
 *
 * For each table the script:
 *   1. fetches all docs with the legacy prefix sorted by createdAt asc
 *   2. assigns sequential short numbers within the same year
 *   3. sweeps every collection that stores the old value as a foreign
 *      string and rewrites it
 *   4. resets the Counter rows so newly-generated numbers continue
 *      from the right sequence
 *
 * Safe to re-run — guards against re-mapping already-short values.
 *
 * Run:
 *   node Backend/scripts/migrateNumberShortFormat.js          # dry-run
 *   node Backend/scripts/migrateNumberShortFormat.js --apply  # apply
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose  = require("mongoose");
const connectDB = require("../config/db");

const APPLY = process.argv.includes("--apply");

// Fields that may carry the migrated identifiers across collections.
const VISIT_FIELDS = [
  "admissionNumber", "ipdNo", "visitNo", "visitNumber",
  "opdNumber",
];
const BILL_FIELDS = ["billNumber"];

// Nested paths (audit snapshots).
const NESTED_VISIT_PATHS = [
  "context.admissionNumber", "context.visitNumber",
  "before.admissionNumber",  "before.visitNumber",
  "after.admissionNumber",   "after.visitNumber",
];
const NESTED_BILL_PATHS = [
  "context.billNumber", "before.billNumber", "after.billNumber",
];

const LEGACY_OPD_ADM    = /^OPD-\d{8}-\d{4}$/;            // OPD-YYYYMMDD-NNNN
const LEGACY_OPD_VISIT  = /^OPD-\d{4}-\d{6}$/;            // OPD-YYYY-NNNNNN
const LEGACY_BILL       = /^BILL-\d{4}-\d{6}$/;           // BILL-YYYY-NNNNNN

function shortYear(d) {
  return String(new Date(d).getFullYear()).slice(-2);
}

async function buildMapping(coll, field, legacyRe, prefixBuilder) {
  const all = await coll.find({ [field]: { $regex: legacyRe.source } }, { projection: { _id: 1, [field]: 1, createdAt: 1 } })
    .sort({ createdAt: 1 }).toArray();
  const perYear = new Map();
  const mapping = new Map();
  for (const doc of all) {
    const old = doc[field];
    if (!legacyRe.test(old)) continue;
    const yy = shortYear(doc.createdAt);
    const counter = (perYear.get(yy) || 0) + 1;
    perYear.set(yy, counter);
    const newVal = `${prefixBuilder(yy)}${String(counter).padStart(2, "0")}`;
    mapping.set(old, newVal);
  }
  return { mapping, perYear };
}

async function sweepCollections(db, mapping, fields, nestedPaths) {
  const collections = await db.listCollections().toArray();
  let totalUpdated = 0;
  const perColl = [];

  for (const c of collections) {
    if (c.type !== "collection") continue;
    if (c.name.startsWith("system.")) continue;

    const coll = db.collection(c.name);
    let updatedHere = 0;

    for (const [oldVal, newVal] of mapping.entries()) {
      for (const f of fields) {
        const filter = { [f]: oldVal };
        if (APPLY) {
          const r = await coll.updateMany(filter, { $set: { [f]: newVal } });
          updatedHere += r.modifiedCount;
        } else {
          updatedHere += await coll.countDocuments(filter);
        }
      }
      for (const path of nestedPaths) {
        const filter = { [path]: oldVal };
        if (APPLY) {
          const r = await coll.updateMany(filter, { $set: { [path]: newVal } });
          updatedHere += r.modifiedCount;
        } else {
          updatedHere += await coll.countDocuments(filter);
        }
      }
    }

    if (updatedHere) {
      perColl.push({ collection: c.name, count: updatedHere });
      totalUpdated += updatedHere;
    }
  }

  return { totalUpdated, perColl };
}

(async () => {
  await connectDB();
  const db = mongoose.connection.db;

  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║  R7hb — short-format migration                 ║");
  console.log("║  ", APPLY ? "APPLY MODE" : "DRY-RUN", "                                  ║");
  console.log("╚════════════════════════════════════════════════╝\n");

  const admColl  = db.collection("admissions");
  const opdReg   = db.collection("opdregistrations");
  const billColl = db.collection("patientbills");

  // ─── 1. Build mappings ──────────────────────────────────────────
  console.log("Building mappings…\n");

  const { mapping: admMap, perYear: admPerYear } =
    await buildMapping(admColl, "admissionNumber", LEGACY_OPD_ADM, (yy) => `OPD-${yy}-`);
  const { mapping: visMap, perYear: visPerYear } =
    await buildMapping(opdReg, "visitNumber", LEGACY_OPD_VISIT, (yy) => `OPD-${yy}-`);
  const { mapping: billMap, perYear: billPerYear } =
    await buildMapping(billColl, "billNumber", LEGACY_BILL, (yy) => `BILL-${yy}-`);

  if (!admMap.size && !visMap.size && !billMap.size) {
    console.log("  Nothing to migrate. All numbers already canonical.\n");
    process.exit(0);
  }

  console.log("  OPD admission numbers (admissions.admissionNumber):");
  admMap.forEach((n, o) => console.log(`    ${o.padEnd(22)} → ${n}`));
  console.log("\n  OPD visit numbers (opdregistrations.visitNumber):");
  visMap.forEach((n, o) => console.log(`    ${o.padEnd(22)} → ${n}`));
  console.log("\n  Bill numbers (patientbills.billNumber):");
  billMap.forEach((n, o) => console.log(`    ${o.padEnd(22)} → ${n}`));
  console.log("");

  // ─── 2. Update the source tables ─────────────────────────────────
  if (APPLY) {
    for (const [oldV, newV] of admMap.entries()) {
      await admColl.updateMany({ admissionNumber: oldV }, { $set: { admissionNumber: newV } });
    }
    for (const [oldV, newV] of visMap.entries()) {
      await opdReg.updateMany({ visitNumber: oldV }, { $set: { visitNumber: newV } });
    }
    for (const [oldV, newV] of billMap.entries()) {
      await billColl.updateMany({ billNumber: oldV }, { $set: { billNumber: newV } });
    }
  }

  // ─── 3. Sweep foreign references across all collections ─────────
  console.log("Sweeping foreign-key references…\n");

  const visitMap = new Map([...admMap, ...visMap]);
  const visitRes = await sweepCollections(db, visitMap, VISIT_FIELDS, NESTED_VISIT_PATHS);
  const billRes  = await sweepCollections(db, billMap, BILL_FIELDS, NESTED_BILL_PATHS);

  const allColls = new Map();
  [...visitRes.perColl, ...billRes.perColl].forEach(r => {
    allColls.set(r.collection, (allColls.get(r.collection) || 0) + r.count);
  });
  const sorted = [...allColls.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  ${APPLY ? "Updated" : "[DRY-RUN] would update"} ${visitRes.totalUpdated + billRes.totalUpdated} documents across ${sorted.length} collections:\n`);
  sorted.forEach(([name, n]) => console.log(`    ${name.padEnd(40)} ${n}`));

  // ─── 4. Reset counters ──────────────────────────────────────────
  if (APPLY) {
    const Counter = require("../models/CounterModel");
    for (const [yy, n] of admPerYear.entries()) {
      await Counter.findOneAndUpdate({ _id: `opd-admission:${yy}` }, { $set: { seq: n } }, { upsert: true });
      console.log(`\n  ✓ Counter opd-admission:${yy} = ${n}`);
    }
    for (const [yy, n] of visPerYear.entries()) {
      await Counter.findOneAndUpdate({ _id: `opd-visit:${yy}` }, { $set: { seq: n } }, { upsert: true });
      console.log(`  ✓ Counter opd-visit:${yy} = ${n}`);
    }
    for (const [yy, n] of billPerYear.entries()) {
      await Counter.findOneAndUpdate({ _id: `bill:${yy}` }, { $set: { seq: n } }, { upsert: true });
      console.log(`  ✓ Counter bill:${yy} = ${n}`);
    }
  }

  // ─── 5. Verify
  if (APPLY) {
    console.log("\nFinal sample:\n");
    const adms = await admColl.find({}, { projection: { admissionNumber: 1 } }).sort({ createdAt: 1 }).toArray();
    const bills = await billColl.find({ billNumber: { $ne: null } }, { projection: { billNumber: 1 } }).sort({ createdAt: 1 }).toArray();
    const regs = await opdReg.find({}, { projection: { visitNumber: 1 } }).sort({ createdAt: 1 }).toArray();
    console.log("  Admissions:");      adms.forEach(d => console.log("    " + d.admissionNumber));
    console.log("\n  OPD registrations:"); regs.forEach(d => console.log("    " + d.visitNumber));
    console.log("\n  Bills:");          bills.forEach(d => console.log("    " + d.billNumber));
  }

  console.log("\n  Done.\n");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
