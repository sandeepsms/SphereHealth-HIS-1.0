// scripts/dedupeDoctorOrders.js
// ════════════════════════════════════════════════════════════════════
// R7bq-J2 — one-off cleanup for the "duplicate doctor orders" bug.
//
// CONTEXT:
//   Pre-R7bq-J2 the POST /doctor-orders route had no idempotency guard.
//   Double-clicks, network retries, and React's async state update gap
//   could each result in 2..N identical DoctorOrder rows being created
//   for the same (UHID, medicineName, dose, frequency) within seconds.
//   The diagStuckOrders.js script confirmed at least 4 such clusters for
//   UH00000029:
//     • Pantoprazole BD × 2 (both InProgress, today)
//     • Ringer Lactate IV × 2 (both Active, today)
//     • Ringer Lactate + KCl × 2 (both Completed, today)
//     • Inj Ceftriaxone BD × 2 (both Completed, today)
//
//   The server-side 30s window dedupe in doctorOrderRoutes.js prevents
//   future duplicates; this script cleans up the historical clusters
//   already in the DB.
//
// WHAT THIS SCRIPT DOES:
//   1. Finds every (UHID, orderType, medicineName, dose, frequency)
//      cluster where >1 DoctorOrder rows exist with non-terminal
//      status (i.e. NOT Cancelled / Stopped), orderedAt within a 5min
//      window of each other, and priority != "STAT".
//   2. For each cluster, picks the OLDEST row as the keeper (it carries
//      the most clinical data — nurse acks, AR entries, audit log).
//   3. For each LOSER:
//      • Reassigns referencing rows in:
//          - medication_administration_records (MAR.medications[].doctorOrderId)
//          - billingtriggers (sourceDocumentId where sourceDocumentModel="DoctorOrder")
//          - pharmacyindents (items[].doctorOrderId)
//          - intake_output_entries (meta.orderId AND sourceRefId)
//        to point at the keeper instead.
//      • Soft-marks MAR.medications rows whose doctorOrderId was the
//        loser as `isActive: false` with discontinueReason="Duplicate
//        order merged".
//      • Flips the loser's status to "Cancelled" with stopReason,
//        mergedInto, stoppedAt, stoppedBy stamped for audit.
//      • Appends an auditLog entry on the loser so the merge is
//        traceable inside the DoctorOrder doc itself.
//   4. NEVER physically deletes a record. Soft-cancel + mergedInto
//      means everything is auditable and rollbackable.
//
// USAGE:
//   node Backend/scripts/dedupeDoctorOrders.js                  (DRY-RUN by default)
//   node Backend/scripts/dedupeDoctorOrders.js --apply          (actually mutate)
//   node Backend/scripts/dedupeDoctorOrders.js --verbose        (more per-row output)
//   node Backend/scripts/dedupeDoctorOrders.js --uhid=UH00000029 (limit to one UHID)
//   node Backend/scripts/dedupeDoctorOrders.js --window=300     (cluster window in seconds, default 300 = 5min)
//
// SAFE TO RE-RUN. Idempotent — losers are picked up by the orderedAt-
// proximity + non-terminal-status filter, and once cancelled they
// drop out of the next run.
// ════════════════════════════════════════════════════════════════════

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const APPLY   = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

function argValue(name, fallback) {
  const pref = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(pref));
  return found ? found.slice(pref.length) : fallback;
}

const ONLY_UHID  = argValue("uhid", null);
const WINDOW_SEC = parseInt(argValue("window", "300"), 10); // default 5 min cluster window

const CANCEL_REASON_PREFIX = "Duplicate order — merged into";

function log(...args)  { console.log(...args); }
function logv(...args) { if (VERBOSE) console.log(...args); }

// ─── Helpers ──────────────────────────────────────────────────────────

// Pick the oldest (by orderedAt) order in a cluster as the keeper. Ties
// resolved by createdAt, then by _id ordering. Doing it by-orderedAt
// rather than ref-count because for these clusters the *first* one
// usually carries the most downstream wiring (MAR seed happened on
// create, the loser was added seconds later and never matured).
function pickKeeper(orders) {
  return [...orders].sort((a, b) => {
    const ao = (a.orderedAt || a.createdAt || new Date(0)).getTime();
    const bo = (b.orderedAt || b.createdAt || new Date(0)).getTime();
    if (ao !== bo) return ao - bo;
    const ac = (a.createdAt || new Date(0)).getTime();
    const bc = (b.createdAt || new Date(0)).getTime();
    if (ac !== bc) return ac - bc;
    return String(a._id).localeCompare(String(b._id));
  })[0];
}

// Reassign all referencing rows from loser → keeper. Returns counts.
async function reassignReferences(loser, keeper, dryRun) {
  const summary = {};
  const lId = loser._id;
  const kId = keeper._id;

  // 1. MAR.medications[].doctorOrderId — repoint AND soft-mark losers'
  //    rows so the nurse sees a single med row, not two.
  try {
    const matchMar = { "medications.doctorOrderId": lId };
    const c = await mongoose.connection.db
      .collection("medication_administration_records")
      .countDocuments(matchMar);
    summary["mar.medications.repoint"] = c;
    if (!dryRun && c) {
      // Soft-mark the loser's MAR row(s) inactive (so nurses see only the
      // keeper row on the chart) and then repoint doctorOrderId to keeper
      // so the audit trail still threads back to a live order.
      const softMark = await mongoose.connection.db
        .collection("medication_administration_records")
        .updateMany(
          matchMar,
          {
            $set: {
              "medications.$[m].isActive": false,
              "medications.$[m].discontinueReason": "Duplicate order merged",
              "medications.$[m].discontinuedAt": new Date(),
              "medications.$[m].discontinuedBy": "SYSTEM (dedupe script)",
            },
          },
          { arrayFilters: [{ "m.doctorOrderId": lId }] },
        );
      const repoint = await mongoose.connection.db
        .collection("medication_administration_records")
        .updateMany(
          matchMar,
          { $set: { "medications.$[m].doctorOrderId": kId } },
          { arrayFilters: [{ "m.doctorOrderId": lId }] },
        );
      logv(`    mar soft-mark matched ${softMark.matchedCount} modified ${softMark.modifiedCount}`);
      logv(`    mar repoint   matched ${repoint.matchedCount} modified ${repoint.modifiedCount}`);
    }
  } catch (e) {
    console.warn(`    mar reassign error: ${e.message}`);
    summary["mar.medications.repoint"] = `ERROR: ${e.message}`;
  }

  // 2. BillingTrigger — sourceDocumentId is the DoctorOrder _id when the
  //    sourceDocumentModel is "DoctorOrder". Repoint to keeper.
  try {
    const filter = { sourceDocumentId: lId, sourceDocumentModel: "DoctorOrder" };
    const c = await mongoose.connection.db
      .collection("billingtriggers").countDocuments(filter);
    summary["billingtriggers.sourceDocumentId"] = c;
    if (!dryRun && c) {
      const r = await mongoose.connection.db
        .collection("billingtriggers")
        .updateMany(filter, { $set: { sourceDocumentId: kId } });
      logv(`    billingtriggers matched ${r.matchedCount} modified ${r.modifiedCount}`);
    }
  } catch (e) {
    console.warn(`    billingtriggers reassign error: ${e.message}`);
    summary["billingtriggers.sourceDocumentId"] = `ERROR: ${e.message}`;
  }

  // 3. PharmacyIndent — items[].doctorOrderId.
  try {
    const filter = { "items.doctorOrderId": lId };
    const c = await mongoose.connection.db
      .collection("pharmacyindents").countDocuments(filter);
    summary["pharmacyindents.items.doctorOrderId"] = c;
    if (!dryRun && c) {
      const r = await mongoose.connection.db
        .collection("pharmacyindents")
        .updateMany(
          filter,
          { $set: { "items.$[i].doctorOrderId": kId } },
          { arrayFilters: [{ "i.doctorOrderId": lId }] },
        );
      logv(`    pharmacyindents matched ${r.matchedCount} modified ${r.modifiedCount}`);
    }
  } catch (e) {
    console.warn(`    pharmacyindents reassign error: ${e.message}`);
    summary["pharmacyindents.items.doctorOrderId"] = `ERROR: ${e.message}`;
  }

  // 4. IntakeOutputEntry — meta.orderId (used by INFUSION_CRON + MAR
  //    auto-rows) and sourceRefId (when sourceRefType="DoctorOrder").
  try {
    const filterMeta = { "meta.orderId": lId };
    const cMeta = await mongoose.connection.db
      .collection("intake_output_entries").countDocuments(filterMeta);
    summary["intake_output_entries.meta.orderId"] = cMeta;
    if (!dryRun && cMeta) {
      const r = await mongoose.connection.db
        .collection("intake_output_entries")
        .updateMany(filterMeta, { $set: { "meta.orderId": kId } });
      logv(`    io meta.orderId matched ${r.matchedCount} modified ${r.modifiedCount}`);
    }
  } catch (e) {
    console.warn(`    intake_output_entries(meta) reassign error: ${e.message}`);
    summary["intake_output_entries.meta.orderId"] = `ERROR: ${e.message}`;
  }
  try {
    const filterRef = { sourceRefId: lId, sourceRefType: "DoctorOrder" };
    const cRef = await mongoose.connection.db
      .collection("intake_output_entries").countDocuments(filterRef);
    summary["intake_output_entries.sourceRefId"] = cRef;
    if (!dryRun && cRef) {
      const r = await mongoose.connection.db
        .collection("intake_output_entries")
        .updateMany(filterRef, { $set: { sourceRefId: kId } });
      logv(`    io sourceRefId matched ${r.matchedCount} modified ${r.modifiedCount}`);
    }
  } catch (e) {
    console.warn(`    intake_output_entries(sourceRefId) reassign error: ${e.message}`);
    summary["intake_output_entries.sourceRefId"] = `ERROR: ${e.message}`;
  }

  return summary;
}

// Soft-cancel a loser order: Cancelled + stopReason + mergedInto +
// auditLog entry. Uses the raw collection so we can stamp the
// non-schema `mergedInto` field and bypass any state-machine guard
// (the keeper has already absorbed all references at this point).
async function softCancelLoser(loser, keeper, dryRun) {
  const reason = `${CANCEL_REASON_PREFIX} ${keeper._id}`;
  if (dryRun) return { soft_cancel: "DRY-RUN" };
  const now = new Date();
  const auditEntry = {
    step: "Duplicate order merged",
    doneBy: "SYSTEM (dedupe script)",
    doneAt: now,
    notes: `Merged into keeper ${keeper._id} (orderedAt ${keeper.orderedAt?.toISOString?.() || "?"})`,
  };
  await mongoose.connection.db.collection("doctor_orders").updateOne(
    { _id: loser._id },
    {
      $set: {
        status: "Cancelled",
        stopReason: reason,
        stoppedAt: now,
        stoppedBy: "SYSTEM (dedupe script)",
        mergedInto: keeper._id,
        updatedAt: now,
      },
      $push: { auditLog: auditEntry },
    },
  );
  return { soft_cancel: "DONE" };
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";
  await mongoose.connect(uri);
  log(`[dedupeDoctorOrders] mode: ${APPLY ? "APPLY (writes enabled)" : "DRY-RUN (no writes)"}`);
  log(`[dedupeDoctorOrders] cluster window: ${WINDOW_SEC}s`);
  if (ONLY_UHID) log(`[dedupeDoctorOrders] limited to UHID: ${ONLY_UHID}`);

  const DoctorOrder = require("../models/Doctor/DoctorOrderModel");

  // 1. Find candidate clusters via aggregation: same (UHID, orderType,
  //    medicineName, dose, frequency) where >1 non-terminal rows exist.
  //    Time-proximity filtering happens after we materialise each cluster
  //    since aggregation can't easily do "within 5 minutes of each other".
  const matchStage = {
    orderType: { $in: ["Medication", "IV_Fluid"] },
    status: { $nin: ["Cancelled", "Stopped"] },
    priority: { $ne: "STAT" },
  };
  if (ONLY_UHID) matchStage.UHID = ONLY_UHID;

  const clusters = await DoctorOrder.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: {
          UHID: "$UHID",
          orderType: "$orderType",
          medicineName: "$orderDetails.medicineName",
          dose: "$orderDetails.dose",
          frequency: "$orderDetails.frequency",
        },
        count: { $sum: 1 },
        ids: { $push: "$_id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { "_id.UHID": 1, "_id.medicineName": 1 } },
  ]);

  log(`[dedupeDoctorOrders] found ${clusters.length} candidate cluster(s) (count>1, non-terminal, non-STAT).`);
  if (clusters.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const overall = {
    clustersExamined:    0,
    clustersProcessed:   0,
    losersCancelled:     0,
    referencesReassigned: 0,
    perCollection: {},
    perUHID: {},
  };

  for (const cluster of clusters) {
    overall.clustersExamined += 1;
    const { UHID, orderType, medicineName, dose, frequency } = cluster._id;
    const orders = await DoctorOrder.find({ _id: { $in: cluster.ids } })
      .sort({ orderedAt: 1, createdAt: 1 }).lean();

    if (orders.length < 2) continue;

    // Time-proximity filter: only treat as duplicates if the spread is
    // within WINDOW_SEC seconds. (Same drug ordered 3 days apart is
    // legitimate continuation, not a click-storm dupe.)
    const earliest = orders[0].orderedAt || orders[0].createdAt;
    const latest   = orders[orders.length - 1].orderedAt || orders[orders.length - 1].createdAt;
    const spreadSec = Math.round((new Date(latest).getTime() - new Date(earliest).getTime()) / 1000);
    if (spreadSec > WINDOW_SEC) {
      logv(`  skip ${UHID} ${medicineName} (${orderType}) — spread ${spreadSec}s > ${WINDOW_SEC}s window`);
      continue;
    }

    log(`\n── UHID ${UHID} | ${orderType} | ${medicineName} | dose=${dose || "—"} | freq=${frequency || "—"} ──`);
    log(`   ${orders.length} rows within ${spreadSec}s spread:`);
    orders.forEach((o) => {
      log(`     ${o._id}  orderedAt=${o.orderedAt?.toISOString?.() || o.createdAt?.toISOString?.() || "—"}  status=${o.status}  AR=${(o.administrationRecord || []).length}`);
    });

    const keeper = pickKeeper(orders);
    const losers = orders.filter((o) => String(o._id) !== String(keeper._id));
    log(`   → KEEPER: ${keeper._id}`);
    losers.forEach((l) => log(`   → LOSER:  ${l._id}`));

    overall.perUHID[UHID] = overall.perUHID[UHID] || { clusters: 0, losers: 0 };
    overall.perUHID[UHID].clusters += 1;

    for (const loser of losers) {
      log(`   Reassigning references from loser ${loser._id} → keeper ${keeper._id}...`);
      const reassignSummary = await reassignReferences(loser, keeper, !APPLY);
      const summaryLine = Object.entries(reassignSummary)
        .filter(([_, v]) => v && v !== 0)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      log(`     reassigned: ${summaryLine || "(no referencing rows)"}`);
      for (const [k, v] of Object.entries(reassignSummary)) {
        if (typeof v === "number") {
          overall.perCollection[k] = (overall.perCollection[k] || 0) + v;
          overall.referencesReassigned += v;
        }
      }

      const cancelResult = await softCancelLoser(loser, keeper, !APPLY);
      log(`     soft-cancel: ${cancelResult.soft_cancel || "?"}`);
      if (APPLY) {
        overall.losersCancelled += 1;
        overall.perUHID[UHID].losers += 1;
      } else {
        overall.perUHID[UHID].losers += 1; // count in dry-run for reporting
      }
    }

    overall.clustersProcessed += 1;
  }

  // 2. Final report.
  log(`\n══════════════════════════════════════════════════════════`);
  log(`[dedupeDoctorOrders] ${APPLY ? "APPLIED" : "DRY-RUN"} summary:`);
  log(`  clusters examined:     ${overall.clustersExamined}`);
  log(`  clusters processed:    ${overall.clustersProcessed}`);
  log(`  losers ${APPLY ? "cancelled" : "would be cancelled"}: ${overall.perUHID
        ? Object.values(overall.perUHID).reduce((a, b) => a + (b.losers || 0), 0)
        : 0}`);
  log(`  references ${APPLY ? "reassigned" : "would be reassigned"}: ${overall.referencesReassigned}`);
  log(`  per-collection:`);
  Object.entries(overall.perCollection)
    .sort(([, a], [, b]) => b - a)
    .forEach(([k, v]) => log(`    ${k.padEnd(40)} ${v}`));
  log(`  per-UHID:`);
  Object.entries(overall.perUHID)
    .sort(([, a], [, b]) => (b.losers || 0) - (a.losers || 0))
    .forEach(([uhid, v]) => log(`    ${uhid.padEnd(14)} clusters=${v.clusters}  losers=${v.losers}`));
  log(`══════════════════════════════════════════════════════════`);
  if (!APPLY) {
    log(`\nThis was a DRY-RUN. Re-run with --apply to commit the changes.`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("[dedupeDoctorOrders] FAILED:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
