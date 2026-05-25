// scripts/backfillAdmissionWardName.js
// ════════════════════════════════════════════════════════════════════
// R7bi-1: one-off backfill for legacy Admissions that pre-date the
// denormalised `wardName` field on the Admission schema.
//
// Pre-R7bi the Admission schema carried `wardId` (ref → Ward) but no
// `wardName`. Reads on hot paths (Doctor / Nursing patient header,
// charts, pharmacy slips) had to either populate the Ward at query
// time or display "—" if the caller skipped populate. As of R7bi the
// schema carries `wardName` and every bed-assign / bed-transfer write
// stamps it. This script copies wardName from the Ward collection into
// every legacy admission that has a wardId but a blank wardName.
//
// USAGE:
//   node Backend/scripts/backfillAdmissionWardName.js            (apply)
//   node Backend/scripts/backfillAdmissionWardName.js --dry-run  (preview)
//
// Idempotent — re-running on a backfilled admission is a no-op.
// ════════════════════════════════════════════════════════════════════

require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";
  await mongoose.connect(uri);

  const Admission = require("../models/Patient/admissionModel");
  const Ward      = require("../models/bedMgmt/wardModel");

  // Pull every admission missing wardName but carrying wardId.
  const candidates = await Admission.find({
    wardId: { $ne: null },
    $or: [{ wardName: { $exists: false } }, { wardName: "" }, { wardName: null }],
  }).select("_id wardId wardName").lean();

  console.log(`[wardName-backfill] candidates: ${candidates.length}`);
  if (candidates.length === 0) {
    await mongoose.disconnect();
    return;
  }

  // Build a wardId → wardName map in one shot.
  const wardIds = [...new Set(candidates.map((a) => String(a.wardId)))];
  const wards = await Ward.find({ _id: { $in: wardIds } })
    .select("_id wardName")
    .lean();
  const map = new Map(wards.map((w) => [String(w._id), w.wardName || ""]));

  let filled = 0, missing = 0;
  for (const a of candidates) {
    const name = map.get(String(a.wardId));
    if (!name) { missing++; continue; }
    if (!dryRun) {
      await Admission.updateOne({ _id: a._id }, { $set: { wardName: name } });
    }
    filled++;
  }

  console.log(`[wardName-backfill] ${dryRun ? "DRY-RUN " : ""}filled: ${filled}, ward-not-found: ${missing}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[wardName-backfill] failed:", err);
  process.exit(1);
});
