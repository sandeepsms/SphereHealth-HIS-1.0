// scripts/dropBedAdmissionField.js
// ════════════════════════════════════════════════════════════════════
// R7bd-A-14 / A1-MED-17 — One-shot migration to remove the dead
// `Bed.admission` field from the beds collection.
//
// HISTORY: bedsModel.js previously declared TWO ObjectId refs both
// pointing at Admission — `admission` (never written by any code path)
// and `currentAdmission` (the one admissionService actually populated).
// The dead field accumulated null values on every new bed and confused
// audits ("which one is real?"). R7bd-A removes the schema declaration.
// This migration backfills any straggling non-null `admission` values
// into `currentAdmission` first (defensive — should be a no-op in prod)
// then $unsets `admission` on every bed so the field disappears from
// MongoDB entirely.
//
// USAGE:
//   node Backend/scripts/dropBedAdmissionField.js
//
// IDEMPOTENT: re-running is safe; the second pass finds 0 rows with
// `admission` set and does nothing.
// ════════════════════════════════════════════════════════════════════

const mongoose = require("mongoose");
const path     = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  "mongodb://localhost:27017/spherehealth";

async function run() {
  console.log(`[dropBedAdmissionField] connecting to ${MONGO_URI}`);
  await mongoose.connect(MONGO_URI);

  // Use the raw collection so we can $unset a field that no longer
  // exists in the Mongoose schema. (Mongoose would reject `admission`
  // in an UpdateMany after R7bd-A.)
  const beds = mongoose.connection.db.collection("beds");

  // Step 1: copy any non-null `admission` into `currentAdmission` when
  // `currentAdmission` is missing/null. Bulk-write so we touch each
  // doc once.
  const stragglers = await beds.find({
    admission: { $ne: null, $exists: true },
    $or: [{ currentAdmission: null }, { currentAdmission: { $exists: false } }],
  }).toArray();
  if (stragglers.length) {
    console.log(`[dropBedAdmissionField] copying ${stragglers.length} straggler admission → currentAdmission`);
    const ops = stragglers.map((b) => ({
      updateOne: {
        filter: { _id: b._id },
        update: { $set: { currentAdmission: b.admission } },
      },
    }));
    await beds.bulkWrite(ops, { ordered: false });
  } else {
    console.log("[dropBedAdmissionField] no stragglers to copy");
  }

  // Step 2: $unset `admission` on every bed (whether it was null or set).
  const result = await beds.updateMany(
    { admission: { $exists: true } },
    { $unset: { admission: "" } },
  );
  console.log(`[dropBedAdmissionField] $unset admission on ${result.modifiedCount} beds`);

  // Step 3: drop any old index that referenced `admission` (defensive —
  // R7bd-A's schema never declared one but a hand-rolled index may exist).
  try {
    const indexes = await beds.indexes();
    for (const idx of indexes) {
      if (idx.key && Object.prototype.hasOwnProperty.call(idx.key, "admission")) {
        console.log(`[dropBedAdmissionField] dropping legacy index ${idx.name}`);
        await beds.dropIndex(idx.name);
      }
    }
  } catch (e) {
    console.warn(`[dropBedAdmissionField] index sweep skipped: ${e.message}`);
  }

  await mongoose.disconnect();
  console.log("[dropBedAdmissionField] done");
}

run().catch((e) => {
  console.error("[dropBedAdmissionField] FAILED:", e);
  process.exit(1);
});
