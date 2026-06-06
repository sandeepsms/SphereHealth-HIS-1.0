/**
 * R7hr-90 — Idempotent cleanup of existing duplicate Initial Assessments.
 *
 * Per (admission, role) keeps the earliest signed IA doc as the keeper.
 * For every later duplicate:
 *   - computes a field-level diff vs the keeper across clinical fields,
 *   - pushes an entry into keeper.amendments[] (preserving signedBy/At
 *     as the amendedBy/At, reason tagged R7hr-90),
 *   - fills any blank field on the keeper with the duplicate's value
 *     (so no clinical evidence is silently dropped),
 *   - sets keeper.status = 'amended' (so it surfaces in the IA
 *     Amendments register from R7hr-89),
 *   - tombstones the duplicate with supersededBy: keeper._id, OR
 *     hard-deletes it if --hard-delete is passed.
 *
 * Default mode is --dry. Pass --apply to actually write.
 *
 * Usage:
 *   node Backend/scripts/dedupeInitialAssessments.js               # dry-run report (default)
 *   node Backend/scripts/dedupeInitialAssessments.js --apply       # writes the amendments + tombstones
 *   node Backend/scripts/dedupeInitialAssessments.js --apply --hard-delete  # also removes duplicate docs
 *
 * Re-running after --apply should report 0 duplicates (idempotent).
 *
 * R7hr-90 follow-up to R7hr-89 — must run BEFORE the partial-unique
 * indexes can come online; otherwise index build fails with E11000.
 */

require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");

const APPLY       = process.argv.includes("--apply");
const HARD_DELETE = process.argv.includes("--hard-delete");
const DRY         = !APPLY;

// Clinical fields we diff. Skip metadata (_id, createdAt, updatedAt, __v,
// signature, signedAt, signedByName, signedByReg, supersededBy, etc.).
const DOCTOR_CLINICAL_FIELDS = [
  "provisionalDiagnosis", "workingDiagnosis", "finalDiagnosis",
  "icd10Code", "icd10Description", "patientStatus",
  "soap", "vitals", "investigations", "orders", "noteDetails",
  "tags", "isCritical",
];
const NURSE_CLINICAL_FIELDS = [
  "vitals", "painScore", "painAssessment", "intakeOutput", "ivLine",
  "ivInfusion", "generalCondition", "nursingCare", "ordersExecuted",
  "noteData", "tags", "remarks", "isCriticalEvent",
];

function isBlank(v) {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

function eq(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== "object" || typeof b !== "object") return false;
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch { return false; }
}

function buildDiff(keeper, dup, fields) {
  const out = [];
  for (const f of fields) {
    const k = keeper?.[f]; const d = dup?.[f];
    if (!eq(k, d)) out.push({ field: f, oldValue: k, newValue: d });
  }
  return out;
}

function unionMerge(keeper, dup, fields) {
  // If the keeper has a blank value but the duplicate has data, fill it.
  let changed = 0;
  for (const f of fields) {
    if (isBlank(keeper[f]) && !isBlank(dup[f])) {
      keeper[f] = dup[f];
      keeper.markModified?.(f);
      changed++;
    }
  }
  return changed;
}

async function processCollection({ ModelName, modelPath, role, clinicalFields }) {
  const Model = require(modelPath);
  const report = {
    role,
    totalInitialDocs: 0,
    groupsScanned: 0,
    duplicateGroups: 0,
    duplicatesFolded: 0,
    tombstoned: 0,
    hardDeleted: 0,
    errors: [],
    sampleGroups: [],
  };

  report.totalInitialDocs = await Model.countDocuments({ noteType: "initial" });

  // Aggregate groups by (admissionId || ipdNo)
  const groups = await Model.aggregate([
    { $match: { noteType: "initial" } },
    {
      $group: {
        _id: {
          // Prefer admissionId; fall back to ipdNo if admissionId is null
          key: { $ifNull: ["$admissionId", "$ipdNo"] },
        },
        ids: { $push: "$_id" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  report.groupsScanned = groups.length;
  report.duplicateGroups = groups.length;

  for (const g of groups) {
    try {
      // Pull all docs in the group, sort by signedAt asc then createdAt asc
      const docs = await Model.find({ _id: { $in: g.ids } })
        .sort({ signedAt: 1, createdAt: 1 });
      if (docs.length < 2) continue;
      const keeper = docs[0];
      const dups   = docs.slice(1);

      const groupSummary = {
        groupKey: String(g._id.key || "—"),
        keeperId: String(keeper._id),
        foldedIds: [],
        diffSizes: [],
      };

      // Make sure keeper has an amendments array
      if (!Array.isArray(keeper.amendments)) keeper.amendments = [];

      for (const dup of dups) {
        const diff = buildDiff(keeper, dup, clinicalFields);
        const amendment = {
          amendedAt:     dup.signedAt || dup.createdAt || new Date(),
          amendedBy:     dup.signedById || dup.createdBy || null,
          amendedById:   dup.signedByEmpId || dup.amendedById || "",
          amendedByName: dup.signedByName || dup.signedBy?.name || "",
          amendedByRole: role === "Doctor" ? "Doctor" : "Nurse",
          reason: "R7hr-90 dedupe — earlier system created duplicate IA records on re-sign; folded the duplicate into amendments[] of the earliest signed doc.",
          changes: diff,
        };
        keeper.amendments.push(amendment);
        groupSummary.foldedIds.push(String(dup._id));
        groupSummary.diffSizes.push(diff.length);

        // Union-merge clinical data so the keeper ends up with everything
        unionMerge(keeper, dup, clinicalFields);

        report.duplicatesFolded++;
      }

      if (APPLY) {
        keeper.status = "amended";
        await keeper.save();
        // Handle the duplicates
        for (const dup of dups) {
          if (HARD_DELETE) {
            await Model.deleteOne({ _id: dup._id });
            report.hardDeleted++;
          } else {
            await Model.updateOne(
              { _id: dup._id },
              { $set: { supersededBy: keeper._id, status: "superseded" } },
              { strict: false } // supersededBy / "superseded" status may not be on the strict schema
            );
            report.tombstoned++;
          }
        }
      }

      if (report.sampleGroups.length < 5) report.sampleGroups.push(groupSummary);
    } catch (err) {
      report.errors.push({ groupKey: String(g._id.key || "—"), message: err.message });
    }
  }

  return report;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/spherehealth";
  console.log(`[dedupeInitialAssessments] mode=${DRY ? "DRY-RUN (no writes)" : "APPLY"}${HARD_DELETE ? " + HARD-DELETE" : ""}`);
  console.log(`[dedupeInitialAssessments] connecting to ${uri}`);
  await mongoose.connect(uri);

  const doctorReport = await processCollection({
    ModelName: "DoctorNote",
    modelPath: "../models/Doctor/DoctorNotesModel",
    role: "Doctor",
    clinicalFields: DOCTOR_CLINICAL_FIELDS,
  });

  const nurseReport = await processCollection({
    ModelName: "NurseNote",
    modelPath: "../models/Nurse/NurseNotesModel",
    role: "Nurse",
    clinicalFields: NURSE_CLINICAL_FIELDS,
  });

  console.log("\n────────────────────────────────────────────────────────");
  console.log(`DEDUPE REPORT — Initial Assessments  (${DRY ? "DRY RUN — nothing was written" : "WRITES APPLIED"})`);
  for (const r of [doctorReport, nurseReport]) {
    console.log(`\n  ${r.role} side`);
    console.log(`    total initial docs:    ${r.totalInitialDocs}`);
    console.log(`    duplicate groups:      ${r.duplicateGroups}`);
    console.log(`    duplicates folded:     ${r.duplicatesFolded}`);
    if (APPLY) {
      console.log(`    tombstoned (soft):     ${r.tombstoned}`);
      console.log(`    hard-deleted:          ${r.hardDeleted}`);
    }
    if (r.errors.length) {
      console.log(`    errors:                ${r.errors.length}`);
      r.errors.slice(0, 3).forEach(e => console.log(`      · ${e.groupKey} → ${e.message}`));
    }
    if (r.sampleGroups.length) {
      console.log(`    sample groups (first ${r.sampleGroups.length}):`);
      r.sampleGroups.forEach(g => {
        console.log(`      key=${g.groupKey}  keeper=${g.keeperId}  folded=${g.foldedIds.length} dup(s)  diffSizes=[${g.diffSizes.join(",")}]`);
      });
    }
  }
  console.log("────────────────────────────────────────────────────────");

  if (DRY) {
    console.log("\nTo actually apply:   node Backend/scripts/dedupeInitialAssessments.js --apply");
    console.log("To also hard-delete: node Backend/scripts/dedupeInitialAssessments.js --apply --hard-delete");
  } else {
    console.log("\nDone. Re-run to confirm idempotency (should report 0 duplicate groups on the second pass).");
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error("[dedupeInitialAssessments] FATAL:", err);
  process.exit(1);
});
