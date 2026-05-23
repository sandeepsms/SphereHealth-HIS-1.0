// scripts/dedupeActiveAdmissions.js
// ════════════════════════════════════════════════════════════════════
// R7bo-Bug-A — one-off cleanup script for the "duplicate active
// admissions per UHID" data-integrity bug.
//
// CONTEXT (see admissionModel.js R7bo-Bug-A comment):
//   Pre-R7bo it was possible to land in the DB with two or more
//   `status:"Active"` Admission rows for the same UHID:
//     • admissionService.createAdmission has had a per-patient guard
//       since R7bd-A-6 (Apr 2026), but the OPDService and ER→IPD-bridge
//       paths call Admission.create() directly and DO NOT.
//     • OPD visits weren't auto-completed at end-of-day, so a patient
//       seen on Mon could come in as a fresh OPD on Tue and end up
//       with two `OPD` admission rows both Active.
//     • A legacy ADM-YYMMNNNN row could remain Active while a new
//       IPD-YY-NN row was created via the ER bridge.
//
//   Different frontend pages (Doctor Notes vs Nursing Notes vs Billing)
//   pick "the active admission" via different queries (hasBed=true vs
//   UHID-only vs visitId-from-OPD), so they each grabbed a DIFFERENT
//   admission and disagreed on the patient state. Orders placed against
//   one admission didn't show in the other.
//
// WHAT THIS SCRIPT DOES:
//   1. Finds every UHID with >1 status:"Active" Admission.
//   2. For each cluster, ranks the admissions by clinical-data weight
//      and picks the heaviest as the KEEPER. Tie-breakers: hasBed=true
//      wins; then `admissionType="Planned"|"Emergency"` over "OPD";
//      then earliest admissionDate (the original, not the dupe).
//   3. For each LOSER:
//      • Reassigns every referencing row (DoctorOrder, DoctorNote,
//        NurseNote, BillingTrigger, PatientBill, NursingAssessment,
//        DiabeticChart, DischargeSummary, PainAssessmentRegister,
//        MAR, VitalSheet, etc.) to point at the KEEPER's _id /
//        admissionNumber / ipdNo so no clinical data is orphaned.
//      • Flips the loser to status:"Cancelled" with cancelReason
//        and mergedInto fields documenting the merge.
//      • Frees the loser's bed (if it had one) so bed-management
//        doesn't show two patients in one bed after the merge.
//   4. Backfill: if the keeper still uses the legacy ADM-YYMMNNNN
//      admissionNumber format, leave it alone — the cleanup focuses on
//      data correctness; admission-number reformatting belongs in a
//      separate one-off (and would break every existing reference
//      we didn't already remap).
//   5. NEVER physically deletes a record. Soft-cancel + mergedInto
//      means everything is auditable and rollbackable.
//
// USAGE:
//   node Backend/scripts/dedupeActiveAdmissions.js            (DRY-RUN by default)
//   node Backend/scripts/dedupeActiveAdmissions.js --apply    (actually mutate)
//
// SAFE TO RE-RUN. Idempotent — if a cluster has only one Active row
// after a prior run, it's skipped.
// ════════════════════════════════════════════════════════════════════

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

// Soft-cancel sentinel — we add cancellationReason + mergedInto on the
// loser docs so audit can reconstruct which keeper absorbed which.
const CANCEL_REASON_PREFIX = "Duplicate active admission — merged into";

// Augment the Admission schema's `cancellationReason` field via the raw
// collection write below so we don't have to extend the model (the
// `cancelReason` field already exists on AdmissionSchema; we'll also
// stamp `mergedInto` as a Mixed/ObjectId field on the raw doc).

// ─── Helpers ──────────────────────────────────────────────────────────

function log(...args) { console.log(...args); }
function logv(...args) { if (VERBOSE) console.log(...args); }

// Score one admission for "keeper-worthiness". Higher = more real.
function scoreAdmission(adm, refCounts) {
  let score = 0;
  // Bed > bedless. A bed assignment is the strongest signal it's real IPD.
  if (adm.hasBed) score += 1000;
  if (adm.bedId)  score += 500; // hasBed flag + bedId both set is the ideal case

  // Both initial assessments completed → patient was actually clinically processed.
  if (adm.initialAssessment?.doctorCompleted) score += 200;
  if (adm.initialAssessment?.nurseCompleted)  score += 200;

  // Reference counts from referring collections.
  score += (refCounts.doctorOrders   || 0) * 50;
  score += (refCounts.doctorNotes    || 0) * 50;
  score += (refCounts.nurseNotes     || 0) * 50;
  score += (refCounts.nursingAssess  || 0) * 25;
  score += (refCounts.billingTriggers|| 0) * 10;
  score += (refCounts.patientBills   || 0) * 30;
  score += (refCounts.diabeticCharts || 0) * 15;
  score += (refCounts.dischargeSummaries || 0) * 100;
  score += (refCounts.painAssessmentRegisters || 0) * 10;
  score += (refCounts.vitalSheets    || 0) * 10;
  score += (refCounts.mar            || 0) * 25;

  // Admission type: IPD-class wins over OPD walk-ins.
  if (adm.admissionType === "Planned" || adm.admissionType === "Emergency") score += 50;
  else if (adm.admissionType === "Day Care" || adm.admissionType === "Daycare") score += 20;
  // OPD class gets 0 — it's the lightweight stub.

  // Older row wins on ties — the original, not the second-created dupe.
  // We subtract milliseconds-since-2020 / 1e10 so newer rows lose by a hair.
  const ms = (adm.createdAt || adm.admissionDate || new Date()).getTime();
  score -= (ms - new Date("2020-01-01").getTime()) / 1e10;

  return score;
}

async function countReferences(adm, models) {
  const idObj = adm._id;
  const idStr = String(adm._id);
  const an    = adm.admissionNumber;

  // Each count is best-effort — empty collection → 0.
  const counts = {};
  const checks = [
    ["doctorOrders",            "doctor_orders",            { visitId: an }],
    ["doctorNotes",             "doctor_notes",             { ipdNo: an }],
    ["nurseNotes",              "nurse_notes",              { ipdNo: an }],
    ["nursingAssess",           "nursingassessments",       { admissionId: idObj }],
    ["billingTriggers",         "billingtriggers",          { admissionId: idObj }],
    ["patientBills",            "patientbills",             { admission: idObj }],
    ["diabeticCharts",          "diabeticcharts",           { admissionId: idObj }],
    ["dischargeSummaries",      "discharge_summaries",      { admissionId: idObj }],
    ["painAssessmentRegisters", "pain_assessment_registers", { admissionId: idObj }],
    ["vitalSheets",             "vitalsheets",              { $or: [{ admission: idObj }, { ipdNo: an }] }],
    ["mar",                     "medication_administration_records", { admissionId: idObj }],
  ];
  for (const [k, coll, filter] of checks) {
    try {
      counts[k] = await mongoose.connection.db.collection(coll).countDocuments(filter);
    } catch (_) { counts[k] = 0; }
  }
  // For doctorOrders, also try idStr in case some rows used the
  // ObjectId-string form (legacy emergencyService stub created with
  // visitId stamped as ObjectId.toString() — we observed only the
  // admissionNumber form for UH00000029, but be defensive).
  try {
    counts.doctorOrders += await mongoose.connection.db.collection("doctor_orders")
      .countDocuments({ visitId: idStr });
  } catch (_) {}
  return counts;
}

// Reassign all referencing rows from loser → keeper. Returns a summary
// of how many docs were touched in each collection.
async function reassignReferences(loser, keeper, dryRun) {
  const summary = {};
  const lId   = loser._id;
  const lIdS  = String(loser._id);
  const lAn   = loser.admissionNumber;
  const kId   = keeper._id;
  const kIdS  = String(keeper._id);
  const kAn   = keeper.admissionNumber;

  // Each entry: collection, filter (matches loser), update ($set toward keeper)
  // Keep ipdNo/admissionNumber/visitId STRING denorms in sync with the
  // keeper's admissionNumber so the various frontend pages all land on
  // the same record.
  const ops = [
    {
      coll: "doctor_orders",
      filter: { $or: [{ visitId: lAn }, { visitId: lIdS }] },
      update: { $set: { visitId: kAn } },
    },
    {
      coll: "doctor_notes",
      filter: { ipdNo: lAn },
      update: { $set: { ipdNo: kAn } },
    },
    {
      coll: "nurse_notes",
      filter: { ipdNo: lAn },
      update: { $set: { ipdNo: kAn } },
    },
    {
      coll: "nursingassessments",
      filter: { admissionId: lId },
      update: { $set: { admissionId: kId } },
    },
    {
      coll: "billingtriggers",
      filter: { admissionId: lId },
      update: { $set: { admissionId: kId } },
    },
    {
      coll: "patientbills",
      filter: { admission: lId },
      update: { $set: { admission: kId, admissionNumber: kAn } },
    },
    {
      coll: "diabeticcharts",
      filter: { admissionId: lId },
      update: { $set: { admissionId: kId, admissionNumber: kAn } },
    },
    {
      coll: "discharge_summaries",
      filter: { admissionId: lId },
      update: { $set: { admissionId: kId, ipdNo: kAn } },
    },
    {
      coll: "pain_assessment_registers",
      filter: { admissionId: lId },
      update: { $set: { admissionId: kId } },
    },
    {
      coll: "vitalsheets",
      filter: { $or: [{ admission: lId }, { ipdNo: lAn }] },
      update: { $set: { admission: kId, ipdNo: kAn } },
    },
    {
      coll: "medication_administration_records",
      filter: { admissionId: lId },
      update: { $set: { admissionId: kId } },
    },
  ];

  for (const op of ops) {
    try {
      const c = await mongoose.connection.db.collection(op.coll).countDocuments(op.filter);
      if (c === 0) { summary[op.coll] = 0; continue; }
      summary[op.coll] = c;
      if (!dryRun) {
        const res = await mongoose.connection.db
          .collection(op.coll)
          .updateMany(op.filter, op.update);
        logv(`    ${op.coll}: matched ${res.matchedCount} modified ${res.modifiedCount}`);
      }
    } catch (e) {
      console.warn(`    ${op.coll}: reassign error: ${e.message}`);
      summary[op.coll] = `ERROR: ${e.message}`;
    }
  }
  return summary;
}

// Flip a loser admission to Cancelled with mergedInto + cancelReason.
// Also free its bed if it had one (so bed-mgmt doesn't show double-occupancy).
async function softCancelLoser(loser, keeper, dryRun) {
  const reason = `${CANCEL_REASON_PREFIX} ${keeper._id}`;
  if (dryRun) return { soft_cancel: "DRY-RUN" };

  // Use the raw collection so we (a) bypass the state-machine guard
  // that may forbid Active → Cancelled on an admission with active
  // dependencies (we just cleared them in reassignReferences above),
  // and (b) get to write the `mergedInto` ad-hoc field even though the
  // schema doesn't declare it.
  const now = new Date();
  await mongoose.connection.db.collection("admissions").updateOne(
    { _id: loser._id },
    {
      $set: {
        status: "Cancelled",
        cancelReason: reason,
        cancelledAt: now,
        mergedInto:  keeper._id,
        mergedAt:    now,
        updatedAt:   now,
      },
    },
  );

  // Free the bed if the loser was holding one.
  if (loser.bedId) {
    try {
      await mongoose.connection.db.collection("beds").updateOne(
        { _id: loser.bedId, currentAdmission: loser._id },
        {
          $set: {
            status: "Available",
            currentAdmission: null,
            patient: null,
            updatedAt: now,
          },
        },
      );
    } catch (e) {
      console.warn(`  bed release for loser ${loser._id} failed: ${e.message}`);
    }
  }
  return { soft_cancel: "DONE" };
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";
  await mongoose.connect(uri);
  log(`[dedupeActiveAdmissions] mode: ${APPLY ? "APPLY (writes enabled)" : "DRY-RUN (no writes)"}`);

  const Admission = require("../models/Patient/admissionModel");

  // 1. Find duplicates.
  const clusters = await Admission.aggregate([
    { $match: { status: "Active" } },
    {
      $group: {
        _id: "$UHID",
        count: { $sum: 1 },
        ids: { $push: "$_id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  log(`[dedupeActiveAdmissions] found ${clusters.length} UHID(s) with >1 Active admission.`);
  if (clusters.length === 0) {
    await mongoose.disconnect();
    return;
  }

  // 2. Process each cluster.
  const overallSummary = {
    clustersProcessed: 0,
    losersCancelled:   0,
    referencesReassigned: 0,
    perCollection: {},
  };

  for (const cluster of clusters) {
    log(`\n── UHID ${cluster._id} — ${cluster.count} Active admissions ──`);

    const admissions = await Admission.find({ _id: { $in: cluster.ids } }).lean();

    // Score each.
    const ranked = [];
    for (const adm of admissions) {
      const refCounts = await countReferences(adm, { Admission });
      const score = scoreAdmission(adm, refCounts);
      ranked.push({ adm, refCounts, score });
      log(`  ${adm._id} (${adm.admissionNumber}, ${adm.admissionType}, hasBed=${adm.hasBed}) score=${score.toFixed(2)}`);
      log(`    refs: ` + Object.entries(refCounts).map(([k, v]) => `${k}=${v}`).join(" "));
    }

    // Highest score wins.
    ranked.sort((a, b) => b.score - a.score);
    const keeper = ranked[0].adm;
    const losers = ranked.slice(1).map((r) => r.adm);

    log(`  → KEEPER:  ${keeper._id} (${keeper.admissionNumber})`);
    losers.forEach((l) =>
      log(`  → LOSER:   ${l._id} (${l.admissionNumber}) — merge into keeper`),
    );

    // 3. Reassign + soft-cancel each loser.
    for (const loser of losers) {
      log(`  Reassigning references from loser ${loser._id} → keeper ${keeper._id}...`);
      const reassignSummary = await reassignReferences(loser, keeper, !APPLY);
      log(`    reassigned: ` + Object.entries(reassignSummary)
        .filter(([_, v]) => v && v !== 0)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ") || "    (no referencing rows)");
      for (const [k, v] of Object.entries(reassignSummary)) {
        if (typeof v === "number") {
          overallSummary.perCollection[k] = (overallSummary.perCollection[k] || 0) + v;
          overallSummary.referencesReassigned += v;
        }
      }

      const cancelResult = await softCancelLoser(loser, keeper, !APPLY);
      log(`    soft-cancel: ${cancelResult.soft_cancel || "?"}`);
      if (APPLY) overallSummary.losersCancelled += 1;
    }

    overallSummary.clustersProcessed += 1;
  }

  // 4. Final report.
  log(`\n══════════════════════════════════════════════════════════`);
  log(`[dedupeActiveAdmissions] ${APPLY ? "APPLIED" : "DRY-RUN"} summary:`);
  log(`  clusters processed:    ${overallSummary.clustersProcessed}`);
  log(`  losers ${APPLY ? "cancelled" : "would be cancelled"}: ${APPLY ? overallSummary.losersCancelled : "(see per-cluster output)"}`);
  log(`  references ${APPLY ? "reassigned" : "would be reassigned"}: ${overallSummary.referencesReassigned}`);
  log(`  per-collection:`);
  Object.entries(overallSummary.perCollection)
    .sort(([, a], [, b]) => b - a)
    .forEach(([k, v]) => log(`    ${k.padEnd(28)} ${v}`));
  log(`══════════════════════════════════════════════════════════`);
  if (!APPLY) {
    log(`\nThis was a DRY-RUN. Re-run with --apply to commit the changes.`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("[dedupeActiveAdmissions] FAILED:", err);
  process.exit(1);
});
