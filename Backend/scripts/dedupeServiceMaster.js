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
//      AND BillingTrigger (zero refs in either).
//   2. Delete the matching ServicePricing rows in the same call so no
//      orphan pricing rows are left behind.
//   3. Print every deletion to the log for audit.
//   4. Dry-run by default (pass --execute to actually delete).
//
// Run:
//   node scripts/dedupeServiceMaster.js              # preview (safe)
//   node scripts/dedupeServiceMaster.js --execute    # actually delete
// ════════════════════════════════════════════════════════════════════

require("dotenv").config();
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

async function main() {
  console.log("[dedupe] connecting to MongoDB", EXECUTE ? "(EXECUTE MODE)" : "(DRY RUN — pass --execute to actually delete)");
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/spherehealth");

  const report = { scanned: 0, deleted: 0, blocked: 0, missing: 0, pricingDeleted: 0, items: [] };

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
    const billRefs = await PatientBill.countDocuments({
      $or: [ { "billItems.serviceCode": dup.delete }, { "billItems.serviceId": sm._id } ],
    });
    const trigRefs = await BillingTrigger.countDocuments({ serviceCode: dup.delete });
    if (billRefs + trigRefs > 0) {
      report.blocked++;
      report.items.push({ code: dup.delete, status: "blocked-in-use", bills: billRefs, triggers: trigRefs });
      continue;
    }

    if (EXECUTE) {
      const pr = await ServicePricing.deleteMany({ serviceId: sm._id });
      await ServiceMaster.deleteOne({ _id: sm._id });
      report.deleted++;
      report.pricingDeleted += pr.deletedCount || 0;
      report.items.push({ code: dup.delete, status: "deleted", keep: dup.keep, pricingDeleted: pr.deletedCount || 0, reason: dup.reason });
    } else {
      const pricing = await ServicePricing.countDocuments({ serviceId: sm._id });
      report.items.push({ code: dup.delete, status: "would-delete", keep: dup.keep, pricing, reason: dup.reason });
    }
  }

  console.log("\n────────────────────────────────────────────────────");
  console.log("DEDUPE REPORT", EXECUTE ? "" : "(dry run — nothing was deleted)");
  console.log("  scanned:        ", report.scanned);
  console.log("  deleted:        ", report.deleted);
  console.log("  blocked:        ", report.blocked);
  console.log("  missing:        ", report.missing);
  console.log("  pricing deleted:", report.pricingDeleted);
  console.log("\nDetail:");
  for (const i of report.items) {
    const tag = ({ "deleted": "[✓]", "would-delete": "[~]", "blocked-in-use": "[!]", "blocked-no-canonical": "[!]", "missing": "[·]" }[i.status]) || "[?]";
    console.log(" ", tag, i.code.padEnd(25), "→ keep " + (i.keep || "?").padEnd(20), "|", i.status, i.pricing != null ? `(pricing=${i.pricing})` : "", i.bills != null ? `bills=${i.bills} triggers=${i.triggers}` : "", i.reason ? "— " + i.reason : "");
  }
  console.log("────────────────────────────────────────────────────");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error("[dedupe] FAILED:", e?.stack || e?.message || e);
  process.exit(1);
});
