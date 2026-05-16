/**
 * migrate-money-decimal128.js
 *
 * One-shot backfill: convert all Number-typed money fields in PatientBill and
 * PharmacySale documents to MongoDB Decimal128 so the on-disk type matches
 * the new schema. Mongoose auto-casts on read/save so this is technically
 * optional — the DB will gradually migrate as docs are touched — but running
 * this proactively gives you a coherent dataset and lets later aggregations
 * assume Decimal128 throughout.
 *
 * Usage (from Backend/):
 *   node scripts/migrate-money-decimal128.js                    # dry-run
 *   node scripts/migrate-money-decimal128.js --apply            # write changes
 *
 * Idempotent: re-running after a successful pass is a no-op because the
 * fields are already Decimal128. Safe to interrupt and resume.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { Decimal128 } = mongoose.Types;

const APPLY = process.argv.includes("--apply");

const BILL_ITEM_MONEY = [
  "unitPrice",
  "grossAmount",
  "discountAmount",
  "netAmount",
  "tpaPayableAmount",
  "patientPayableAmount",
  "taxAmount",
];
const BILL_MONEY = [
  "grossAmount",
  "totalDiscount",
  "taxAmount",
  "netAmount",
  "tpaPayableAmount",
  "patientPayableAmount",
  "advancePaid",
  "balanceAmount",
  "tpaApprovedAmount",
];

function asDec(v) {
  if (v == null) return Decimal128.fromString("0.00");
  if (v && v._bsontype === "Decimal128") return v;
  const n = Number(v);
  return Decimal128.fromString((Number.isFinite(n) ? n : 0).toFixed(2));
}

async function migratePatientBills(db) {
  const coll = db.collection("patientbills");
  const cursor = coll.find({}, { projection: { _id: 1, billItems: 1, payments: 1, ...Object.fromEntries(BILL_MONEY.map((k) => [k, 1])) } });
  let scanned = 0, touched = 0;
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned++;
    const set = {};
    for (const k of BILL_MONEY) {
      if (doc[k] != null && doc[k]._bsontype !== "Decimal128") {
        set[k] = asDec(doc[k]);
      }
    }
    if (Array.isArray(doc.billItems)) {
      doc.billItems.forEach((item, i) => {
        for (const k of BILL_ITEM_MONEY) {
          if (item?.[k] != null && item[k]._bsontype !== "Decimal128") {
            set[`billItems.${i}.${k}`] = asDec(item[k]);
          }
        }
      });
    }
    if (Array.isArray(doc.payments)) {
      doc.payments.forEach((p, i) => {
        if (p?.amount != null && p.amount._bsontype !== "Decimal128") {
          set[`payments.${i}.amount`] = asDec(p.amount);
        }
      });
    }
    if (Object.keys(set).length) {
      touched++;
      if (APPLY) await coll.updateOne({ _id: doc._id }, { $set: set });
    }
  }
  return { scanned, touched };
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI not set");
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log(`[migrate] ${APPLY ? "APPLY" : "DRY RUN"} — connected`);
  const db = mongoose.connection.db;

  const bills = await migratePatientBills(db);
  console.log(`[migrate] patientbills: scanned ${bills.scanned}, would-update ${bills.touched}`);

  await mongoose.disconnect();
  console.log(`[migrate] done${APPLY ? " (changes written)" : " (dry run — re-run with --apply)"}`);
}

main().catch((err) => {
  console.error("[migrate] error:", err);
  process.exit(1);
});
