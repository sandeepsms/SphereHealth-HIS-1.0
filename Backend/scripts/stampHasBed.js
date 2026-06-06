// scripts/stampHasBed.js
// R7hr-94 — Backfill the `hasBed: true` flag on Active IPD admissions
// that have a bedId but were created via a bypass path (direct insert,
// legacy admit, etc.) and so are missing the indexed boolean that the
// /admissions/active?hasBed=true filter relies on.
//
// Without `hasBed: true`, the DoctorNotes / NurseNotes sidebars
// (which always pass hasBed=true to exclude OPD rows) skip the
// admission entirely → "0 active" even though the patient is admitted.
//
// Safe to re-run — idempotent: only flips rows where the flag is
// missing or false.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/spherehealth";
  await mongoose.connect(uri);

  require("../models/Patient/admissionModel");
  const Admission = mongoose.models.Admission;

  // Target: status=Active, has a bedId, but hasBed != true
  const filter = {
    status: "Active",
    bedId:  { $exists: true, $ne: null },
    $or:    [{ hasBed: { $exists: false } }, { hasBed: { $ne: true } }],
  };

  const before = await Admission.find(filter).select("UHID admissionNumber ipdNo patientName bedNumber hasBed").lean();
  console.log(`[stampHasBed] Found ${before.length} bed-occupied Active admission(s) missing hasBed=true:`);
  before.forEach(a => console.log(`  ${a.UHID || "?"} · ${a.admissionNumber || a.ipdNo} · ${a.patientName} · bed=${a.bedNumber} · hasBed=${a.hasBed}`));

  if (before.length === 0) {
    console.log("\n[stampHasBed] Nothing to backfill. Exiting.");
    await mongoose.disconnect();
    return;
  }

  const res = await Admission.updateMany(filter, { $set: { hasBed: true } });
  console.log(`\n[stampHasBed] ✓ updated ${res.modifiedCount} row(s) → hasBed=true`);

  await mongoose.disconnect();
})().catch(err => { console.error("[stampHasBed] FATAL:", err); process.exit(1); });
