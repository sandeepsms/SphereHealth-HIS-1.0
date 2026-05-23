// scripts/closePastMissedDoses.js
// ════════════════════════════════════════════════════════════════════
// R7bq-J1 — One-time backfill for stuck InProgress doctor orders.
//
// Walks every active DoctorOrder (status ∈ Pending/Acknowledged/
// Active/InProgress) across all UHIDs, finds AR entries where:
//   - status === "pending"
//   - !isStatDose
//   - scheduledDate < today-midnight
// → flips to "missed", appends an auditLog entry, emits ClinicalAudit
// MAR_DOSE_MISSED.
//
// Then re-evaluates the completion check for each touched order and
// flips status → Completed if:
//   - every non-STAT AR row is in {given, skipped, refused, missed}
//   - frequency !== "Continuous"
//   - order.endDate is null OR endDate <= startOfToday (course window
//     has closed). Legacy orders without endDate use the pre-J1
//     terminal-status-only rule.
//
// Usage:
//   node scripts/closePastMissedDoses.js            # dry-run (default)
//   node scripts/closePastMissedDoses.js --apply    # write changes
//   node scripts/closePastMissedDoses.js --uhid=UH00000029   # filter by UHID
//
// Reports: total orders scanned, total slots flipped, total orders
// transitioned to Completed, per-UHID summary.
// ════════════════════════════════════════════════════════════════════
require("dotenv").config();
const path = require("path");
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const uhidArg = process.argv.find(a => a.startsWith("--uhid="));
const UHID_FILTER = uhidArg ? uhidArg.split("=")[1] : null;

function pad(s, n) {
  s = String(s == null ? "" : s);
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function iso(d) {
  if (!d) return "—";
  try { return new Date(d).toISOString(); } catch (_) { return String(d); }
}

(async () => {
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/spherehealth";
  console.log(`[closePastMissedDoses] connecting → ${uri}`);
  console.log(`[closePastMissedDoses] mode = ${APPLY ? "APPLY (writes enabled)" : "DRY RUN (no writes)"}`);
  if (UHID_FILTER) console.log(`[closePastMissedDoses] UHID filter = ${UHID_FILTER}`);
  await mongoose.connect(uri);
  console.log(`[closePastMissedDoses] connected.\n`);

  const DoctorOrder = require(path.join(__dirname, "..", "models", "Doctor", "DoctorOrderModel"));
  let emitClinicalAudit = null;
  try {
    ({ emitClinicalAudit } = require(path.join(__dirname, "..", "services", "Compliance", "clinicalAuditService")));
  } catch (_) { /* non-critical */ }

  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  console.log(`[closePastMissedDoses] todayMidnight = ${iso(startOfToday)}\n`);

  const filter = {
    status: { $in: ["Pending", "Acknowledged", "Active", "InProgress"] },
    "administrationRecord.0": { $exists: true },
  };
  if (UHID_FILTER) filter.UHID = UHID_FILTER;

  const orders = await DoctorOrder.find(filter);
  console.log(`[closePastMissedDoses] found ${orders.length} active orders with AR entries to scan\n`);

  /* ── pass 1: flip past pending → missed ────────────────────────── */
  const perUHID = {};   // uhid → { scanned, flipped, completed }
  let totalScanned = 0;
  let totalFlipped = 0;
  let ordersTouched = 0;
  const touchedOrderIds = [];

  for (const order of orders) {
    totalScanned++;
    const uhid = order.UHID || "(no-UHID)";
    perUHID[uhid] = perUHID[uhid] || { scanned: 0, flipped: 0, completed: 0, completedDetails: [] };
    perUHID[uhid].scanned++;

    const ar = order.administrationRecord || [];
    let orderChanged = false;
    const flippedSlots = [];

    for (let i = 0; i < ar.length; i++) {
      const row = ar[i];
      if (!row) continue;
      if (row.status !== "pending") continue;
      if (row.isStatDose === true) continue;
      if (!row.scheduledDate) continue;
      const sched = new Date(row.scheduledDate);
      if (!(sched < startOfToday)) continue;

      flippedSlots.push({ i, scheduledTime: row.scheduledTime, scheduledDate: sched });

      if (APPLY) {
        row.status = "missed";
        row.notes = row.notes
          ? `${row.notes} | Auto-marked missed at end-of-day (backfill)`
          : "Auto-marked missed at end-of-day (backfill)";
        order.auditLog.push({
          step: `MAR slot auto-missed (${row.scheduledTime} on ${sched.toISOString().slice(0,10)}) — backfill`,
          doneBy: "SYSTEM",
          doneAt: new Date(),
          notes: "closePastMissedDoses backfill script",
        });
        if (emitClinicalAudit) {
          emitClinicalAudit({
            event: "MAR_DOSE_MISSED",
            UHID: order.UHID,
            admissionId: order.admissionId,
            patientId: order.patientId,
            patientName: order.patientName,
            targetType: "DoctorOrder.AR",
            targetId: order._id,
            before: { status: "pending", scheduledTime: row.scheduledTime, scheduledDate: sched },
            after:  { status: "missed", autoMarked: true, backfill: true },
            reason: "Backfill — closePastMissedDoses",
            actor: { _id: null, fullName: "SYSTEM", role: "System" },
          }).catch(() => {});
        }
      }
      orderChanged = true;
      totalFlipped++;
      perUHID[uhid].flipped++;
    }

    if (orderChanged) {
      ordersTouched++;
      touchedOrderIds.push(order._id);
      if (APPLY) {
        try {
          await order.save();
        } catch (e) {
          console.error(`[closePastMissedDoses] save failed order=${order._id}:`, e.message);
          continue;
        }
      }
      const drug = order.orderDetails?.medicineName || order.orderDetails?.displayName || order.orderType;
      console.log(`  • ${pad(uhid, 14)} ${pad(drug, 32)} [${order._id}]  flipped ${flippedSlots.length} slot(s)`);
      flippedSlots.forEach(s => {
        console.log(`      AR[${s.i}]  ${iso(s.scheduledDate)}  time=${s.scheduledTime}`);
      });
    }
  }

  /* ── pass 2: re-evaluate completion check on touched orders ────── */
  console.log("\n--- pass 2: re-evaluating completion check ---\n");
  let totalCompleted = 0;

  for (const oid of touchedOrderIds) {
    const order = await DoctorOrder.findById(oid);
    if (!order) continue;
    const uhid = order.UHID || "(no-UHID)";

    if (order.status === "Completed" || order.status === "Cancelled" || order.status === "Stopped") {
      continue;
    }
    if (order.orderDetails?.frequency === "Continuous") {
      continue;
    }

    const regularRecords = (order.administrationRecord || []).filter(r => !r.isStatDose);
    const regularDone = regularRecords.length > 0
      && regularRecords.every(r => ["given", "skipped", "refused", "missed"].includes(r.status));

    const courseWindowClosed = order.endDate
      ? new Date(order.endDate) <= startOfToday
      : true;

    if (regularDone && courseWindowClosed) {
      const drug = order.orderDetails?.medicineName || order.orderDetails?.displayName || order.orderType;
      console.log(`  → COMPLETED  ${pad(uhid, 14)} ${pad(drug, 32)} [${order._id}]`);
      totalCompleted++;
      perUHID[uhid].completed++;
      perUHID[uhid].completedDetails.push({ drug, id: String(order._id) });
      if (APPLY) {
        try {
          order.status = "Completed";
          order.completedBy = order.completedBy || "SYSTEM";
          order.completedAt = order.completedAt || new Date();
          order.auditLog.push({
            step: "Order auto-completed (backfill — all AR slots terminal & course window closed)",
            doneBy: "SYSTEM",
            doneAt: new Date(),
            notes: `closePastMissedDoses backfill — regular slots=${regularRecords.length}, endDate=${iso(order.endDate)}`,
          });
          await order.save();
        } catch (e) {
          console.error(`[closePastMissedDoses] complete-flip failed order=${order._id}:`, e.message);
        }
      }
    }
  }

  /* ── summary ────────────────────────────────────────────────────── */
  console.log("\n" + "═".repeat(72));
  console.log(" SUMMARY");
  console.log("═".repeat(72));
  console.log(`mode             : ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`orders scanned   : ${totalScanned}`);
  console.log(`orders touched   : ${ordersTouched}`);
  console.log(`AR slots flipped : ${totalFlipped}`);
  console.log(`orders completed : ${totalCompleted}`);
  console.log("\nper-UHID:");
  console.log(pad("UHID", 18) + pad("scanned", 10) + pad("flipped", 10) + "completed");
  console.log("-".repeat(50));
  Object.entries(perUHID).sort().forEach(([uhid, s]) => {
    if (s.flipped === 0 && s.completed === 0) return;
    console.log(pad(uhid, 18) + pad(s.scanned, 10) + pad(s.flipped, 10) + s.completed);
    s.completedDetails.forEach(d => console.log(`                                              · ${d.drug}`));
  });

  if (!APPLY) {
    console.log("\n[closePastMissedDoses] DRY RUN — no writes performed. Re-run with --apply to commit.");
  }

  await mongoose.disconnect();
  console.log("\n[closePastMissedDoses] done.");
})().catch(async (e) => {
  console.error("[closePastMissedDoses] ERROR:", e);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
