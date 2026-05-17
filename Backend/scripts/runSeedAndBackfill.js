// scripts/runSeedAndBackfill.js
// One-shot script: run the ServiceMaster seeder + sweep historic patients
// whose registration never landed a billing trigger. Idempotent — re-running
// is safe. Used to fix the gap closed by `feat(billing): auto-fire OPD/
// Emergency bill on patient registration` (commit 0b7373a).
//
// Run from worktree:
//   node scripts/runSeedAndBackfill.js
//
// Connects to MongoDB using the same .env as index.js, runs both jobs,
// prints a summary, exits.

require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";
  console.log("[script] connecting to", uri.replace(/\/\/[^@]*@/, "//***@"));
  await mongoose.connect(uri);

  // ── 1. Seed ServiceMaster (idempotent — skips existing codes) ───────────
  console.log("\n[script] === seedServices ===");
  const { seedServices } = require("../seeders/serviceMasterSeeder");
  const seedResult = await seedServices();
  console.log("[seed] result:", seedResult);

  // ── 2. Backfill registration bills for any OPD patient with visits but
  //       no PatientBill row. Mirrors the controller endpoint logic.       ──
  console.log("\n[script] === backfillRegistrationBills ===");
  const Patient     = require("../models/Patient/patientModel");
  const PatientBill = require("../models/PatientBillModel/PatientBillModel");
  const OPDService  = require("../services/Patient/OPDService");

  const patients = await Patient.find({
    isActive: true,
    registrationType: "OPD",
    totalOPDVisits: { $gt: 0 },
  }).select("_id UHID fullName department doctor paymentType registrationType").lean();

  const report = { scanned: patients.length, alreadyHadBill: 0, backfilled: 0, skippedNoDoctor: 0, errored: 0, items: [] };

  for (const p of patients) {
    try {
      const hasBill = await PatientBill.exists({ UHID: p.UHID });
      if (hasBill) {
        report.alreadyHadBill++;
        continue;
      }
      if (!p.doctor) {
        report.skippedNoDoctor++;
        report.items.push({ UHID: p.UHID, name: p.fullName, status: "skipped-no-doctor" });
        continue;
      }
      await OPDService.createOPDVisit({
        patientId:      p._id,
        UHID:           p.UHID,
        departmentId:   p.department,
        doctorId:       p.doctor,
        chiefComplaint: "Registration backfill (auto)",
        visitDate:      new Date(),
        visitType:      "OPD",
        paymentType:    p.paymentType || "GENERAL",
      });
      report.backfilled++;
      report.items.push({ UHID: p.UHID, name: p.fullName, status: "backfilled" });
    } catch (e) {
      report.errored++;
      report.items.push({ UHID: p.UHID, name: p.fullName, status: "error", error: e?.message });
    }
  }

  console.log("[backfill] result:");
  console.log("  scanned:        ", report.scanned);
  console.log("  alreadyHadBill: ", report.alreadyHadBill);
  console.log("  backfilled:     ", report.backfilled);
  console.log("  skippedNoDoctor:", report.skippedNoDoctor);
  console.log("  errored:        ", report.errored);
  for (const i of report.items) console.log("   -", i.UHID, "·", i.name, "→", i.status, i.error ? `[${i.error}]` : "");

  await mongoose.disconnect();
  console.log("\n[script] done.");
}

main().catch((e) => {
  console.error("[script] FAILED:", e?.stack || e?.message || e);
  process.exit(1);
});
