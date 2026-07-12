// _e2e_reset.js — surgical patient-data reset for the E2E acceptance run.
// PRESERVES masters/config/inventory (explicit allowlist below); WIPES every
// other (patient / clinical / transactional / operational / register) collection;
// clears counters so numbering restarts short (UH01, BILL-26-01, …); frees beds;
// and drops the legacy plain-unique billNumber_1 index (dup-null E11000 landmine)
// if it still exists. Run:  node scripts/_e2e_reset.js --apply
"use strict";
require("dotenv").config();
const mongoose = require("mongoose");

// Anything NOT in this set gets wiped. Kept: identity, catalogs/masters,
// pharmacy + facility inventory, hospital config. `counters` is handled
// specially (wiped, to reset numbering).
const PRESERVE = new Set([
  // identity / org / config
  "users", "doctors", "nursestaffs", "departments", "buildings", "floors",
  "wards", "rooms", "beds", "roomcategorymodels", "room_category_charges",
  "hospitals", "hospitalsettings", "hospitalcharges", "wardshifts",
  // catalogs / masters
  "servicemasters", "servicepricings", "investigationmasters",
  "investigationpricings", "nursingconsumableitems", "dietplantemplates",
  "labcustompanels", "icd10codes", "icd10metas", "icd10pcscodes",
  "icd10pcsmetas", "insurerformtemplates", "tpas", "tpaservices",
  "pincodemasters", "credentials",
  // pharmacy inventory (NOT patient-facing transactional)
  "drugs", "drugbatches", "pharmacydrugs", "pharmacydrugbatches",
  "pharmacysettings", "pharmacysuppliers", "pharmacyhsnmasters", "suppliers",
  "pharmacyparsedinvoices", "grns", "purchaseorders", "purchasereturns",
  "stockledgers",
  // facility masters
  "equipment", "chemicalinventories", "pestcontrolschedules",
  // mongo internals
  "system.indexes",
]);

(async () => {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const cols = (await db.listCollections().toArray()).map((c) => c.name).sort();

  const toWipe = cols.filter((n) => n !== "counters" && !PRESERVE.has(n));
  let totalDocs = 0, wipedCols = 0;
  const nonEmpty = [];
  for (const n of toWipe) {
    const cnt = await db.collection(n).countDocuments();
    if (cnt > 0) nonEmpty.push(`${n}(${cnt})`);
    totalDocs += cnt;
    if (apply && cnt > 0) { await db.collection(n).deleteMany({}); wipedCols++; }
  }

  // counters — wipe so every sequence restarts at 1 (short numbering).
  const counterCnt = await db.collection("counters").countDocuments();
  if (apply) await db.collection("counters").deleteMany({});

  // beds — free every bed back to Available.
  let bedsFreed = 0;
  if (apply) {
    const r = await db.collection("beds").updateMany({}, {
      $set: { status: "Available" },
      $unset: { currentPatient: "", currentAdmission: "", reservedFor: "", "housekeeping.state": "" },
    });
    bedsFreed = r.modifiedCount;
  }

  // Restock pharmacy batches — the E2E IPD flow's indent-release consumes stock
  // (quantityOut↑ / remaining↓) but the reset preserves inventory, so batches
  // deplete across repeated runs and eventually 409 INSUFFICIENT_STOCK. Restore
  // every batch to full (remaining = quantityIn, quantityOut = 0).
  let batchesRestocked = 0;
  if (apply) {
    const cols = new Set((await db.listCollections().toArray()).map((c) => c.name));
    for (const c of ["pharmacydrugbatches", "drugbatches"]) {
      if (!cols.has(c)) continue;
      const rows = await db.collection(c).find({}, { projection: { quantityIn: 1, quantity: 1 } }).toArray();
      for (const r of rows) {
        const full = r.quantityIn ?? r.quantity ?? 0;
        await db.collection(c).updateOne({ _id: r._id }, { $set: { quantityOut: 0, remaining: full } });
      }
      batchesRestocked += rows.length;
    }
  }

  // legacy plain-unique billNumber_1 index → drop (dup-null E11000 landmine).
  let idxDropped = "n/a";
  try {
    const idx = await db.collection("patientbills").indexes();
    if (idx.some((i) => i.name === "billNumber_1")) {
      if (apply) { await db.collection("patientbills").dropIndex("billNumber_1"); idxDropped = "dropped"; }
      else idxDropped = "present (would drop)";
    } else idxDropped = "already absent";
  } catch (_) { idxDropped = "patientbills missing"; }

  console.log(`\n${apply ? "APPLIED" : "DRY-RUN"} — patient-data reset`);
  console.log(`  collections wiped:        ${apply ? wipedCols : toWipe.length} (${totalDocs} docs)`);
  console.log(`  counters cleared:         ${counterCnt}`);
  console.log(`  beds freed to Available:  ${apply ? bedsFreed : "(pending)"}`);
  console.log(`  legacy billNumber_1 idx:  ${idxDropped}`);
  console.log(`  masters preserved:        ${PRESERVE.size} collection types`);
  console.log(`  non-empty wiped (top):    ${nonEmpty.slice(0, 30).join(", ")}`);
  if (!apply) console.log(`\n  Re-run with --apply to execute.`);
  await mongoose.disconnect();
  process.exit(0);
})();
