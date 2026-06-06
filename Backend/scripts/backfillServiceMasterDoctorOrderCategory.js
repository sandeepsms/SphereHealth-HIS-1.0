// scripts/backfillServiceMasterDoctorOrderCategory.js
// ════════════════════════════════════════════════════════════════════
// R7hr-83 Phase A / Agent A4 — One-shot backfill of the new
// ServiceMaster.doctorOrderCategory enum on EXISTING catalog rows.
//
// The Phase A schema change (serviceMasterModel.js) added the field as
// nullable so admins can hand-curate the long tail. But the bulk of
// the catalog can be classified mechanically from existing fields
// (category / serviceType / serviceName) — this script does that pass
// so the doctor-order autocomplete is usable immediately on Day 1
// instead of waiting for someone to tag 3000+ rows by hand.
//
// Inference is FIRST-MATCH from a ranked list of heuristics; whichever
// rule fires first wins. The ranking is deliberate — e.g. "blood
// transfusion" beats "procedure" because a row named "Blood
// Transfusion Service" is more useful tagged BloodTransfusion than as
// a generic Procedure. Likewise medicine/lab beat procedure so a
// PROCEDURE-category row whose name is "CBC" still ends up Lab.
//
// Idempotent: rows where doctorOrderCategory is already set (non-null)
// are skipped. Re-running the script is safe — it will only touch the
// untagged residue (e.g. after a fresh ANH tariff import drops in new
// rows).
//
// Modes:
//   node scripts/backfillServiceMasterDoctorOrderCategory.js           # WRITE
//   node scripts/backfillServiceMasterDoctorOrderCategory.js --dry     # PREVIEW
//
// Output: per-category counts + a list of untagged-residue rows so
// the admin knows what still needs hand-curation.
// ════════════════════════════════════════════════════════════════════

require("dotenv").config();
const mongoose = require("mongoose");

const ServiceMaster = require("../models/ServiceMaster/serviceMasterModel");

const DRY = process.argv.includes("--dry") || process.argv.includes("--dry-run");

// Valid enum (must match schema). Kept here so the script is
// self-checking if the schema enum ever changes — any new enum value
// returned by an inference rule will be assert-rejected before write.
const VALID = new Set([
  "Medication",
  "IV_Fluid",
  "Lab",
  "Radiology",
  "Procedure",
  "BloodTransfusion",
  "Diet",
  "Oxygen",
  "Physiotherapy",
  "Activity",
  "Nursing",
  "Consultation",
]);

// ── First-match inference. Returns one of the enum strings, or null
//    if no rule fires. Order matters: more-specific rules first. ────
function inferCategory(row) {
  const cat   = String(row.category    || "").toUpperCase().trim();
  const stype = String(row.serviceType || "").toLowerCase().trim();
  const name  = String(row.serviceName || "").toLowerCase().trim();

  // ── Highly specific name-based rules first (so a Procedure-category
  //    row called "CBC" or "Blood Transfusion" lands in the right
  //    bucket). ────────────────────────────────────────────────────
  const hasWord = (s, ...words) => words.every(w => s.includes(w));

  // BloodTransfusion — name contains blood+transfusion, or FFP, or platelets
  if (
    hasWord(name, "blood", "transfusion") ||
    /\bffp\b/.test(name) ||
    name.includes("platelets")
  ) {
    return "BloodTransfusion";
  }

  // IV Fluid — name contains IV+fluid, or infusion, or drip
  if (
    hasWord(name, "iv", "fluid") ||
    name.includes("infusion") ||
    name.includes("drip")
  ) {
    return "IV_Fluid";
  }

  // Oxygen — name contains oxygen, O2, nebuliz
  if (
    name.includes("oxygen") ||
    /\bo2\b/.test(name) ||
    name.includes("nebuliz")
  ) {
    return "Oxygen";
  }

  // Physiotherapy — name contains physio or PT (word-bounded)
  if (name.includes("physio") || /\bpt\b/.test(name)) {
    return "Physiotherapy";
  }

  // Diet — name contains diet / meal / nutrition
  if (
    name.includes("diet") ||
    name.includes("meal") ||
    name.includes("nutrition")
  ) {
    return "Diet";
  }

  // Radiology by name (before generic Procedure mapping)
  if (
    stype === "radiology" ||
    name.includes("x-ray") ||
    name.includes("xray") ||
    /\bct\b/.test(name) ||
    /\bmri\b/.test(name) ||
    name.includes("ultrasound") ||
    /\busg\b/.test(name)
  ) {
    return "Radiology";
  }

  // ── Type / category based rules ──────────────────────────────────

  // Medication
  if (stype === "medicine" || stype === "drug" || cat === "MEDICINE") {
    return "Medication";
  }

  // Lab (investigation)
  if (stype === "investigation" || stype === "lab" || cat.includes("LAB")) {
    return "Lab";
  }

  // Consultation (before Procedure so DOCTOR/CONSULTATION rows don't
  // accidentally fall through to Procedure)
  if (cat === "CONSULTATION" || stype === "consultation") {
    return "Consultation";
  }

  // Nursing
  if (stype === "nursing" || cat === "NURSING") {
    return "Nursing";
  }

  // Procedure — OT / PROCEDURE category, excluding consultation
  if (
    stype === "ot" ||
    cat === "OT" ||
    (cat === "PROCEDURE" && stype !== "consultation")
  ) {
    return "Procedure";
  }

  return null;
}

async function main() {
  console.log(
    "[backfillDoctorOrderCategory] connecting to MongoDB",
    DRY ? "(DRY RUN — no writes)" : "(WRITE MODE — pass --dry to preview)",
  );
  await mongoose.connect(
    process.env.MONGODB_URI || "mongodb://localhost:27017/spherehealth",
  );

  const report = {
    scanned: 0,
    alreadyTagged: 0,
    wouldUpdate: 0,
    updated: 0,
    untagged: 0,
    perCategory: {},
    untaggedSample: [], // first 20 untagged rows for operator hand-curation
    invalidInferred: [], // safety net — should never trigger
  };

  try {
    // Stream (cursor) rather than findAll so a 50k-row catalog doesn't
    // blow the heap. Lean for speed; we'll re-fetch the doc only when
    // we need to write.
    const cursor = ServiceMaster.find({}).lean().cursor();

    for (let row = await cursor.next(); row != null; row = await cursor.next()) {
      report.scanned++;

      // Idempotent — skip if already set
      if (row.doctorOrderCategory) {
        report.alreadyTagged++;
        report.perCategory[row.doctorOrderCategory] =
          (report.perCategory[row.doctorOrderCategory] || 0) + 1;
        continue;
      }

      const inferred = inferCategory(row);

      if (!inferred) {
        report.untagged++;
        if (report.untaggedSample.length < 20) {
          report.untaggedSample.push({
            serviceCode: row.serviceCode,
            serviceName: row.serviceName,
            category: row.category,
            serviceType: row.serviceType,
          });
        }
        continue;
      }

      // Self-check: never write a value that isn't in the schema enum.
      if (!VALID.has(inferred)) {
        report.invalidInferred.push({ code: row.serviceCode, inferred });
        continue;
      }

      report.perCategory[inferred] = (report.perCategory[inferred] || 0) + 1;

      if (DRY) {
        report.wouldUpdate++;
      } else {
        await ServiceMaster.updateOne(
          { _id: row._id },
          { $set: { doctorOrderCategory: inferred } },
        );
        report.updated++;
      }
    }
  } finally {
    await mongoose.disconnect();
  }

  console.log("\n────────────────────────────────────────────────────");
  console.log(
    "BACKFILL REPORT — ServiceMaster.doctorOrderCategory",
    DRY ? "(dry run — nothing was written)" : "",
  );
  console.log("  scanned total:    ", report.scanned);
  console.log("  already tagged:   ", report.alreadyTagged, "(skipped — idempotent)");
  if (DRY) {
    console.log("  would update:     ", report.wouldUpdate);
  } else {
    console.log("  updated:          ", report.updated);
  }
  console.log("  untagged residue: ", report.untagged, "(no rule matched — admin must tag manually)");
  console.log("\nPer-category counts (includes already-tagged + newly-tagged):");
  const sortedCats = Object.keys(report.perCategory).sort();
  for (const c of sortedCats) {
    console.log("  ", c.padEnd(20), report.perCategory[c]);
  }

  if (report.untaggedSample.length > 0) {
    console.log("\nUntagged sample (first 20 — needs manual curation):");
    for (const u of report.untaggedSample) {
      console.log(
        "  ",
        (u.serviceCode || "??").padEnd(20),
        "|", (u.category || "-").padEnd(14),
        "|", (u.serviceType || "-").padEnd(14),
        "|", u.serviceName,
      );
    }
  }

  if (report.invalidInferred.length > 0) {
    console.log("\n[!] Inference produced values NOT in the schema enum (script bug):");
    for (const x of report.invalidInferred) {
      console.log("  ", x.code, "→", x.inferred);
    }
  }
  console.log("────────────────────────────────────────────────────");
}

main().catch((e) => {
  console.error(
    "[backfillDoctorOrderCategory] FAILED:",
    e?.stack || e?.message || e,
  );
  process.exit(1);
});
