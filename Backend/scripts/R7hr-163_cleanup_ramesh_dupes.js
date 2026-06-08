/**
 * R7hr-163 — Clean up duplicate billing triggers on Ramesh's admission so
 * the IPD Live Ledger shows a clean slate for tomorrow's investor demo.
 *
 * Two known dupes:
 *   1. DOC-MORN-ROUND fired twice on 07 Jun 2026 at 10:11 am — same admission,
 *      same shift, different orderedById (Dr. Sandeep + Sunita Patil-as-Doctor).
 *      Keep the Dr. Sandeep one (real doctor), void the Sunita one.
 *   2. Blood Transfusion Service Charge fired twice on the same NurseNote.
 *      Keep one, void the other.
 *
 * Per R7hr-163, going-forward fixes:
 *   • shift-aware visit cap (autoBillingService.js L1092-1140) prevents
 *     future double-AM rounds.
 *   • NurseNote sourceRef stamp prevents future blood-tx dupes.
 *
 * This script ONLY voids the in-flight Ramesh data so the demo ledger
 * looks clean. Idempotent: rerunning is a no-op once the rows are voided.
 *
 * Usage: node scripts/R7hr-163_cleanup_ramesh_dupes.js
 */

const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const BillingTrigger = require("../models/Billing/BillingTrigger");
const Admission     = require("../models/Patient/admissionModel");

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/spherehealth";
  await mongoose.connect(uri);
  console.log("[R7hr-163-cleanup] connected to", uri);

  // 1) Find Ramesh's admission (UH02, Active).
  const adm = await Admission.findOne({ UHID: "UH02", status: "Active" }).lean();
  if (!adm) {
    console.log("[R7hr-163-cleanup] No active admission for UH02 — exiting clean.");
    await mongoose.disconnect();
    return;
  }
  console.log(`[R7hr-163-cleanup] admission ${adm.admissionNumber} (${adm._id})`);

  let voidedDocRounds = 0;
  let voidedBloodTx   = 0;

  // 2) Doctor Morning Rounds — keep ONE per (dateKey, shift). For demo,
  //    explicitly keep the row where orderedBy contains "Sandeep" if
  //    multiple exist; void the rest as duplicate.
  const allRounds = await BillingTrigger.find({
    admissionId: adm._id,
    serviceCode: { $in: ["DOC-MORN-ROUND", "DOC-EVE-ROUND", "DOC-NIGHT-ROUND"] },
    status: { $nin: ["voided", "cancelled", "skipped"] },
  }).sort({ createdAt: 1 }).lean();

  const grouped = new Map();
  for (const t of allRounds) {
    const key = `${t.dateKey}|${t.serviceCode}|${t.shift || "x"}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(t);
  }

  for (const [key, group] of grouped.entries()) {
    if (group.length < 2) continue;
    // Choose keeper: prefer one whose orderedBy actually looks like a doctor name (matches "Dr." or "Sandeep").
    const keeper = group.find(g => /sandeep|^dr\.?\s/i.test(String(g.orderedBy || ""))) || group[0];
    const dupes = group.filter(g => String(g._id) !== String(keeper._id));
    for (const d of dupes) {
      await BillingTrigger.updateOne(
        { _id: d._id },
        { $set: {
            status: "voided",
            voidedAt: new Date(),
            voidReason: `R7hr-163 cleanup — duplicate ${d.serviceCode} same shift as kept ${keeper._id} (kept "${keeper.orderedBy}" over "${d.orderedBy}")`,
            voidedBy: "System (R7hr-163 cleanup)",
        } },
      );
      voidedDocRounds++;
      console.log(`[R7hr-163-cleanup] voided ${d._id} (${d.serviceCode}, by ${d.orderedBy}) → kept ${keeper._id} (by ${keeper.orderedBy})`);
    }
  }

  // 3) Blood transfusion charges — keep at most one per NurseNote source.
  const bldRows = await BillingTrigger.find({
    admissionId: adm._id,
    serviceCode: { $in: ["NRS-BLD"] },
    status: { $nin: ["voided", "cancelled", "skipped"] },
  }).sort({ createdAt: 1 }).lean();

  const bySource = new Map();
  for (const t of bldRows) {
    const key = String(t.sourceDocumentId || t._id);
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(t);
  }
  for (const [src, group] of bySource.entries()) {
    if (group.length < 2) continue;
    const keeper = group[0];
    for (const d of group.slice(1)) {
      await BillingTrigger.updateOne(
        { _id: d._id },
        { $set: {
            status: "voided",
            voidedAt: new Date(),
            voidReason: `R7hr-163 cleanup — duplicate NRS-BLD on same source ${src}; kept ${keeper._id}`,
            voidedBy: "System (R7hr-163 cleanup)",
        } },
      );
      voidedBloodTx++;
      console.log(`[R7hr-163-cleanup] voided blood-tx dup ${d._id} (source ${src}) → kept ${keeper._id}`);
    }
  }

  console.log(`[R7hr-163-cleanup] DONE — voided ${voidedDocRounds} duplicate doctor rounds + ${voidedBloodTx} duplicate blood-tx charges.`);
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error("[R7hr-163-cleanup] FAILED:", e);
  process.exit(1);
});
