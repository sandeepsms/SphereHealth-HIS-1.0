// scripts/readmitUH01Today.js
// ════════════════════════════════════════════════════════════════════
// R7hr-92 — Re-admit UH01 (Badal Sharma) under IPD-26-01 with the
// CURRENT timestamp (today + now).
//
// User asked: "isko readmit kro isi IP number k sath, aaj or abhi ke
// time me". The same admission row is updated in-place — same IPD
// number, same UHID, same _id — but the admissionDate is bumped to
// `new Date()` so the "Day N" counter resets to Day 1 and every
// downstream clinical surface shows the patient as freshly admitted
// today.
// ════════════════════════════════════════════════════════════════════

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const TARGET_UHID = "UH01";
const TARGET_IPD  = "IPD-26-01";

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/spherehealth";
  console.log(`[readmitUH01Today] connecting to ${uri}`);
  await mongoose.connect(uri);

  require("../models/Patient/admissionModel");
  const Admission = mongoose.models.Admission;
  if (!Admission) {
    console.error("[readmitUH01Today] FATAL — Admission model not registered.");
    process.exit(1);
  }

  const adm = await Admission.findOne({
    $or: [
      { admissionNumber: TARGET_IPD },
      { ipdNo: TARGET_IPD },
    ],
  });
  if (!adm) {
    console.error(`[readmitUH01Today] FATAL — Admission ${TARGET_IPD} not found.`);
    process.exit(1);
  }

  const before = {
    _id:          String(adm._id),
    UHID:         adm.UHID || adm.patientUHID,
    ipd:          adm.admissionNumber || adm.ipdNo,
    name:         adm.patientName,
    admissionDate:adm.admissionDate,
    status:       adm.status,
  };

  // bump admission date to now
  const now = new Date();
  adm.admissionDate = now;
  // re-arm any state that says "still active"
  if (typeof adm.status !== "undefined") adm.status = adm.status || "Active";
  if (typeof adm.dischargeDate !== "undefined") adm.dischargeDate = null;
  // dischargeWorkflow may exist as a sub-doc; clear discharge flags so
  // the patient surfaces as freshly admitted (not Discharged Today).
  if (adm.dischargeWorkflow) {
    adm.dischargeWorkflow.stage = adm.dischargeWorkflow.stage === "Completed" ? "Not Started" : adm.dischargeWorkflow.stage;
    adm.dischargeWorkflow.dischargedAt = null;
  }

  await adm.save();

  console.log("\nBEFORE:", before);
  console.log("AFTER : admissionDate =", now.toISOString(), "  status =", adm.status);
  console.log(`\n[readmitUH01Today] ✓ UH01 re-admitted under ${TARGET_IPD} at ${now.toLocaleString("en-IN")} IST`);

  await mongoose.disconnect();
})().catch(err => {
  console.error("[readmitUH01Today] FATAL:", err);
  process.exit(1);
});
