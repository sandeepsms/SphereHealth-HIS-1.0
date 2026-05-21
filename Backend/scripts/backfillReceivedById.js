// scripts/backfillReceivedById.js
// ════════════════════════════════════════════════════════════════════
// R7bb-FIX-B-1/D7-CRIT-1: one-off backfill for legacy PatientBill.payments
// rows that were written BEFORE PaymentSchema.receivedById existed.
// Each pre-R7bb row carries only `receivedBy` (free-text employee name);
// the cashier shift report joins on `receivedById` (ObjectId), so legacy
// rows are invisible to per-cashier tallies.
//
// What this script does (when run manually):
//   1. Walk every PatientBill with at least one `payments[]` row where
//      `receivedById` is null AND `receivedBy` is non-empty.
//   2. Try to resolve `receivedBy` → User._id by case-insensitive match
//      against `User.fullName` (and `User.employeeId` as a fallback).
//   3. When a unique match is found, set `payments[i].receivedById` on
//      the bill (NO other field touched). When zero / multiple matches
//      are found, write to a dry-run report only — never guess.
//   4. Report counters: bills_walked, rows_filled, rows_ambiguous,
//      rows_unresolved.
//
// THIS IS A MANUAL SCRIPT — DO NOT WIRE IT TO A CRON.
//   • Run only after R7bb-FIX-B-1 has shipped (i.e. PaymentSchema has the
//     field AND new writes are populating it). Without that, every
//     restart re-burns the same null rows.
//   • Run in a maintenance window — the walk + save is sequential and
//     touches every PatientBill (no atomic per-row update because the
//     payments[] subdoc array doesn't expose a stable filter).
//   • Run with `node Backend/scripts/backfillReceivedById.js --dry-run`
//     first to see how many rows are resolvable. Take the dry-run report
//     to HR / Accountant for sign-off, THEN run without --dry-run.
//   • The script is idempotent — re-running on an already-backfilled
//     row is a no-op.
//
// ════════════════════════════════════════════════════════════════════

require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";

  console.log(`[backfillReceivedById] mode=${dryRun ? "DRY-RUN" : "WRITE"}`);
  console.log(`[backfillReceivedById] connecting to ${uri}`);
  await mongoose.connect(uri);

  const User = require("../models/User/userModel");
  const PatientBill = require("../models/PatientBillModel/PatientBillModel");

  const report = {
    bills_walked:     0,
    rows_scanned:     0,
    rows_filled:      0,
    rows_ambiguous:   0,   // multiple users with same name — refuse
    rows_unresolved:  0,   // no user matched
    rows_already_set: 0,   // idempotent skip
    samples:          [],   // first 20 unresolved/ambiguous names for review
  };

  // Build a name → user lookup table ONCE.
  const users = await User.find({}, { _id: 1, fullName: 1, employeeId: 1 }).lean();
  const byName = new Map();           // normalized name → [{_id, ...}]
  const byEmp  = new Map();           // employeeId → user
  for (const u of users) {
    const k = String(u.fullName || "").trim().toLowerCase();
    if (k) {
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(u);
    }
    if (u.employeeId) byEmp.set(String(u.employeeId).trim(), u);
  }

  const cursor = PatientBill.find(
    { "payments.0": { $exists: true } },
    { payments: 1, billNumber: 1, UHID: 1 },
  ).cursor();

  for await (const bill of cursor) {
    report.bills_walked += 1;
    let touched = false;
    for (const p of bill.payments || []) {
      report.rows_scanned += 1;
      if (p.receivedById) { report.rows_already_set += 1; continue; }
      const raw = String(p.receivedBy || "").trim();
      if (!raw) { report.rows_unresolved += 1; continue; }

      // Try employeeId first (exact match), then fullName (lowercase).
      let candidate = byEmp.get(raw) || null;
      if (!candidate) {
        const list = byName.get(raw.toLowerCase()) || [];
        if (list.length === 1) candidate = list[0];
        else if (list.length > 1) {
          report.rows_ambiguous += 1;
          if (report.samples.length < 20) {
            report.samples.push({ billNumber: bill.billNumber, receivedBy: raw, matchCount: list.length });
          }
          continue;
        }
      }
      if (!candidate) {
        report.rows_unresolved += 1;
        if (report.samples.length < 20) {
          report.samples.push({ billNumber: bill.billNumber, receivedBy: raw, matchCount: 0 });
        }
        continue;
      }
      p.receivedById = candidate._id;
      report.rows_filled += 1;
      touched = true;
    }
    if (touched && !dryRun) {
      try {
        await bill.save();
      } catch (e) {
        console.warn(`[backfillReceivedById] save failed for ${bill.billNumber}: ${e.message}`);
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("[backfillReceivedById] fatal:", e);
  process.exit(1);
});
