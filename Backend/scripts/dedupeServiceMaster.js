// scripts/dedupeServiceMaster.js
// ════════════════════════════════════════════════════════════════════
// SAFE CLEANUP — remove duplicate ServiceMaster entries
//
// These orphan codes were created during catalog seeding before the
// service-code naming convention was settled. The engine never fires
// them — it always queries the categoryCode form (BED-GENW, BED-PVT,
// DOC-SPEC-ICU, etc.) — so the tier-key form (BED-GENERAL,
// BED-PRIVATE, etc.) sits in the catalog as visual noise and breaks
// the "1 service = 1 row" billing UX.
//
// Safety rules:
//   1. Only delete codes confirmed unused in PatientBill.billItems[]
//      AND BillingTrigger (zero refs in EITHER serviceCode OR
//      serviceId fields — symmetric check on both collections).
//   2. Snapshot every row (ServiceMaster + matching ServicePricing)
//      to scripts/dedupe-backup-<timestamp>.json BEFORE any delete
//      so recovery is one mongoimport away.
//   3. Delete ServiceMaster + ServicePricing atomically inside a
//      Mongo transaction when the connection supports it (replica
//      set / mongos). On a standalone Mongo (no txn) the safer-fail
//      order is used: ServiceMaster first, ServicePricing second —
//      so a mid-step failure leaves NO ServiceMaster row claiming
//      pricing that doesn't exist (the dangerous case). Orphan
//      ServicePricing rows are inert because the orphan codes have
//      zero bill refs (precondition checked).
//   4. Print every action to the log for audit.
//   5. Dry-run by default (pass --execute to actually delete).
//
// Run:
//   node scripts/dedupeServiceMaster.js              # preview (safe)
//   node scripts/dedupeServiceMaster.js --execute    # actually delete
// ════════════════════════════════════════════════════════════════════

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const ServiceMaster   = require("../models/ServiceMaster/serviceMasterModel");
const ServicePricing  = require("../models/ServicePricing/ServicePricingModel");
const PatientBill     = require("../models/PatientBillModel/PatientBillModel");
const BillingTrigger  = require("../models/Billing/BillingTrigger");

const EXECUTE = process.argv.includes("--execute");

// Orphan codes that are duplicates of an engine-matching code.
// Each entry: { delete: "the orphan", keep: "the canonical engine-matching code", reason: "why" }
const DUPLICATES = [
  // BED tier-key duplicates → canonical = BED-<categoryCode>
  { delete: "BED-GENERAL",        keep: "BED-GENW",     reason: "Engine fires BED-${categoryCode}; categoryCode=GENW" },
  { delete: "BED-SEMI_PRIVATE",   keep: "BED-SEMI",     reason: "categoryCode=SEMI" },
  { delete: "BED-PRIVATE",        keep: "BED-PVT",      reason: "categoryCode=PVT" },
  { delete: "BED-DELUXE",         keep: "BED-PVT",      reason: "Deluxe shares Private tier in ANH" },

  // NURSING tier-key duplicates → canonical = NURSING-<categoryCode>
  { delete: "NURSING-GENERAL",      keep: "NURSING-GENW",  reason: "Engine fires NURSING-${categoryCode}" },
  { delete: "NURSING-SEMI_PRIVATE", keep: "NURSING-SEMI",  reason: "categoryCode=SEMI" },
  { delete: "NURSING-PRIVATE",      keep: "NURSING-PVT",   reason: "categoryCode=PVT" },
  { delete: "NURSING-DELUXE",       keep: "NURSING-PVT",   reason: "Deluxe shares Private tier" },

  // DOC-SPEC tier-key duplicates → canonical = DOC-SPEC-<categoryCode>
  { delete: "DOC-SPEC-GENERAL",        keep: "DOC-SPEC-GENW",  reason: "Engine fires DOC-SPEC-${categoryCode}" },
  { delete: "DOC-SPEC-SEMI_PRIVATE",   keep: "DOC-SPEC-SEMI",  reason: "categoryCode=SEMI" },
  { delete: "DOC-SPEC-PRIVATE",        keep: "DOC-SPEC-PVT",   reason: "categoryCode=PVT" },

  // DOC-SUPER tier-key duplicates → canonical = DOC-SUPER-<categoryCode>
  { delete: "DOC-SUPER-GENERAL",       keep: "DOC-SUPER-GENW", reason: "Engine fires DOC-SUPER-${categoryCode}" },
  { delete: "DOC-SUPER-SEMI_PRIVATE",  keep: "DOC-SUPER-SEMI", reason: "categoryCode=SEMI" },
  { delete: "DOC-SUPER-PRIVATE",       keep: "DOC-SUPER-PVT",  reason: "categoryCode=PVT" },

  // Old per-OPD specialist seed → canonical = CON-001 (used by engine + already in bills)
  { delete: "OPD-CON-002",  keep: "CON-001",  reason: "OPD-CON-002 is a duplicate Specialist Consultation; engine fires CON-001" },
];

// ── Safer-fail single-row delete (transaction when available, ordered
//    sequential otherwise). Returns { pricingDeleted, mode }. ─────────
async function deleteRowSafely(sm, session, useTx) {
  if (useTx && session) {
    let pricingDeleted = 0;
    await session.withTransaction(async () => {
      const pr = await ServicePricing.deleteMany({ serviceId: sm._id }).session(session);
      pricingDeleted = pr.deletedCount || 0;
      await ServiceMaster.deleteOne({ _id: sm._id }).session(session);
    });
    return { pricingDeleted, mode: "transaction" };
  }
  // Standalone Mongo fallback. Delete ServiceMaster FIRST so a mid-step
  // failure cannot strand a SM row that thinks it still has pricing
  // (the dangerous case — engine would silently fall back to the stale
  // defaultPrice). If the SP cleanup that follows fails, the orphan SP
  // rows are inert: the precondition guarantees zero bills reference
  // them, and getPriceFor returns null without throwing.
  await ServiceMaster.deleteOne({ _id: sm._id });
  const pr = await ServicePricing.deleteMany({ serviceId: sm._id });
  return { pricingDeleted: pr.deletedCount || 0, mode: "ordered-sequential" };
}

async function main() {
  console.log("[dedupe] connecting to MongoDB", EXECUTE ? "(EXECUTE MODE)" : "(DRY RUN — pass --execute to actually delete)");
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/spherehealth");

  // Detect transaction support. Standalone Mongo throws "Transaction
  // numbers are only allowed on a replica set member or mongos" when
  // session.withTransaction is called — so probe the client options
  // up front instead of catching mid-loop.
  const session = await mongoose.startSession().catch(() => null);
  const useTx = !!session && !!(
    session.client?.s?.options?.replicaSet ||
    session.client?.options?.replicaSet
  );

  const report = {
    scanned: 0, deleted: 0, blocked: 0, missing: 0, pricingDeleted: 0,
    txMode: useTx ? "transaction" : "ordered-sequential",
    backupFile: null, items: [],
  };

  try {
    // ── Pre-pass: snapshot every candidate row (and its pricing) into
    //    a JSON file. Even when nothing is deletable today, the file
    //    documents the state-at-time-of-run. ────────────────────────
    const snapshot = { at: new Date().toISOString(), execute: EXECUTE, useTx, rows: [] };
    for (const dup of DUPLICATES) {
      const sm = await ServiceMaster.findOne({ serviceCode: dup.delete }).lean();
      if (!sm) continue;
      const sp = await ServicePricing.find({ serviceId: sm._id }).lean();
      snapshot.rows.push({ delete: dup.delete, keep: dup.keep, reason: dup.reason, serviceMaster: sm, servicePricing: sp });
    }
    if (EXECUTE && snapshot.rows.length > 0) {
      const fname = `dedupe-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const fpath = path.resolve(__dirname, fname);
      fs.writeFileSync(fpath, JSON.stringify(snapshot, null, 2));
      report.backupFile = fpath;
      console.log(`[dedupe] backup written: ${fpath}  (${snapshot.rows.length} rows)`);
    }

    for (const dup of DUPLICATES) {
      report.scanned++;
      const sm = await ServiceMaster.findOne({ serviceCode: dup.delete });
      if (!sm) {
        report.missing++;
        report.items.push({ code: dup.delete, status: "missing", reason: dup.reason });
        continue;
      }

      // Re-verify the canonical exists; refuse to delete if missing — we
      // never want to wipe the only row of a logical service.
      const canonical = await ServiceMaster.findOne({ serviceCode: dup.keep }).lean();
      if (!canonical) {
        report.blocked++;
        report.items.push({ code: dup.delete, status: "blocked-no-canonical", keep: dup.keep, reason: "Canonical code missing" });
        continue;
      }

      // Safety: skip if used in any PatientBill or BillingTrigger.
      // SYMMETRIC check on both collections — match either by string
      // serviceCode OR by ObjectId serviceId. Asymmetric checks miss
      // legacy rows where one of the two fields drifted.
      const billRefs = await PatientBill.countDocuments({
        $or: [ { "billItems.serviceCode": dup.delete }, { "billItems.serviceId": sm._id } ],
      });
      const trigRefs = await BillingTrigger.countDocuments({
        $or: [ { serviceCode: dup.delete }, { serviceId: sm._id } ],
      });
      if (billRefs + trigRefs > 0) {
        report.blocked++;
        report.items.push({ code: dup.delete, status: "blocked-in-use", bills: billRefs, triggers: trigRefs });
        continue;
      }

      if (EXECUTE) {
        try {
          const r = await deleteRowSafely(sm, session, useTx);
          report.deleted++;
          report.pricingDeleted += r.pricingDeleted;
          report.items.push({ code: dup.delete, status: "deleted", keep: dup.keep, pricingDeleted: r.pricingDeleted, txMode: r.mode, reason: dup.reason });
        } catch (e) {
          // One row failed — log it but keep going so the rest of the
          // safe deletions still happen. Backup file is the recovery
          // path if the partial state needs to be reverted.
          report.blocked++;
          report.items.push({ code: dup.delete, status: "error", error: e?.message || String(e) });
        }
      } else {
        const pricing = await ServicePricing.countDocuments({ serviceId: sm._id });
        report.items.push({ code: dup.delete, status: "would-delete", keep: dup.keep, pricing, reason: dup.reason });
      }
    }
  } finally {
    if (session) session.endSession();
    await mongoose.disconnect();
  }

  console.log("\n────────────────────────────────────────────────────");
  console.log("DEDUPE REPORT", EXECUTE ? "" : "(dry run — nothing was deleted)");
  console.log("  scanned:        ", report.scanned);
  console.log("  deleted:        ", report.deleted);
  console.log("  blocked:        ", report.blocked);
  console.log("  missing:        ", report.missing);
  console.log("  pricing deleted:", report.pricingDeleted);
  console.log("  tx mode:        ", report.txMode);
  if (report.backupFile) console.log("  backup file:    ", report.backupFile);
  console.log("\nDetail:");
  for (const i of report.items) {
    const tag = ({
      "deleted":              "[✓]",
      "would-delete":         "[~]",
      "blocked-in-use":       "[!]",
      "blocked-no-canonical": "[!]",
      "missing":              "[·]",
      "error":                "[✗]",
    }[i.status]) || "[?]";
    console.log(
      " ", tag, i.code.padEnd(25),
      i.keep ? "→ keep " + i.keep.padEnd(20) : "                          ",
      "|", i.status,
      i.pricing != null ? `(pricing=${i.pricing})` : "",
      i.bills != null ? `bills=${i.bills} triggers=${i.triggers}` : "",
      i.error ? `[ERR: ${i.error}]` : "",
      i.reason ? "— " + i.reason : "",
    );
  }
  console.log("────────────────────────────────────────────────────");
}

main().catch((e) => {
  // The full stack trace is helpful for an operator-run admin script
  // on the hospital's own box (file paths are local, never PHI). If
  // this script is ever invoked from a centralised logging context,
  // strip the stack here.
  console.error("[dedupe] FAILED:", e?.stack || e?.message || e);
  process.exit(1);
});
