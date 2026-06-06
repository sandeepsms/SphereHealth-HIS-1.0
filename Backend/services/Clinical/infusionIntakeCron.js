// services/Clinical/infusionIntakeCron.js
// ════════════════════════════════════════════════════════════════════
// R7bq-4 — Hourly sweep that writes one intake row per running
// IV_Fluid infusion. NABH MOM.4 / COP.16 require running infusions to
// be reflected in the I/O chart in near-real-time, not just at the end
// of the bag.
//
// Algorithm (per tick):
//   1. Find DoctorOrders where:
//        orderType   = "IV_Fluid"
//        status      ∈ {"Active", "InProgress"}
//        infusionStarted   IS NOT NULL
//        infusionStopped   IS NULL OR > now
//
//   2. For each order, parse the rate (ml/hr) from orderDetails.rate
//      (or .currentRate if the nurse changed it). Skip if it doesn't
//      parse to a positive number.
//
//   3. Compute hourBucket = top of THIS hour (UTC). Each order gets
//      at most one row per hourBucket — the partial unique index on
//      IntakeOutputEntry enforces this.
//
//   4. Compute "remaining" = orderDetails.totalVolume − (sum of prior
//      INFUSION_CRON rows for this order). If <= 0, mark the order
//      Completed (best-effort, non-fatal) and skip.
//
//   5. Else write min(rate, remaining) ml as the volumeML for this row.
//
// Errors are swallowed per-order so one bad row doesn't tank the
// whole sweep.
// ════════════════════════════════════════════════════════════════════
const mongoose = require("mongoose");
const { logErr } = require("../../utils/logErr");

/** Parse "50 ml/hr" → 50; "50ml/hr" → 50; "abc" → NaN. */
function parseRate(v) {
  if (v === null || v === undefined) return NaN;
  const s = String(v).replace(/[^\d.\-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Round `d` down to the start of its hour, return ISO string. */
function hourBucketOf(d) {
  const t = new Date(d);
  t.setMinutes(0, 0, 0);
  return t.toISOString();
}

async function tickOnce() {
  let processed = 0;
  let written = 0;
  let skipped = 0;
  let completed = 0;

  try {
    const DoctorOrder = mongoose.model("DoctorOrder");
    const IntakeOutputEntry = mongoose.model("IntakeOutputEntry");
    const ioService = require("./intakeOutputService");

    const now = new Date();
    const bucket = hourBucketOf(now);

    const orders = await DoctorOrder.find({
      orderType: "IV_Fluid",
      status:    { $in: ["Active", "InProgress"] },
      infusionStarted: { $ne: null, $exists: true },
      $or: [{ infusionStopped: null }, { infusionStopped: { $exists: false } }],
    }).lean();

    // R7hr-12-S3: Collapse per-order N+1 aggregation into a single $in query
    // grouped by meta.orderId, then look up per-order via Map inside the loop.
    // Previously each running infusion triggered its own aggregation round-trip;
    // at 50+ concurrent IV infusions that became a measurable sweep cost. The
    // partial compound index on { meta.orderId, meta.hourBucket } with
    // partialFilterExpression source=INFUSION_CRON still serves this single
    // grouped aggregation efficiently.
    const orderIds = orders.map((o) => o._id);
    const infusedByOrder = new Map();
    if (orderIds.length > 0) {
      try {
        const aggAll = await IntakeOutputEntry.aggregate([
          {
            $match: {
              source: "INFUSION_CRON",
              voided: { $ne: true },
              "meta.orderId": { $in: orderIds },
            },
          },
          { $group: { _id: "$meta.orderId", sum: { $sum: "$volumeML" } } },
        ]);
        for (const row of aggAll || []) {
          // _id may be ObjectId; stringify for consistent Map lookups regardless
          // of how the order._id is shaped downstream.
          infusedByOrder.set(String(row._id), row.sum || 0);
        }
      } catch (e) {
        // Non-fatal: fall through with empty Map; per-order loop will treat each
        // as alreadyInfused=0 and continue. The partial unique index on
        // (meta.orderId, meta.hourBucket) still prevents double-writes.
        logErr("infusionIntakeCron", "prior-infusion sum aggregation")(e);
      }
    }

    for (const order of orders) {
      processed++;
      try {
        // 1) Rate — prefer currentRate (nurse-edited) over the doctor's original.
        const rate = parseRate(order.currentRate || order.orderDetails?.rate);
        if (!rate || rate <= 0) { skipped++; continue; }

        // 2) Total volume sanity — if doctor didn't enter, default to large so
        // we don't accidentally stop the infusion prematurely.
        const total = parseRate(order.orderDetails?.totalVolume) || Infinity;

        // 3) How much have we logged from this order so far?
        // R7hr-12-S3: Map lookup replaces per-order aggregation (see batch above).
        const alreadyInfused = infusedByOrder.get(String(order._id)) || 0;

        // 4) Remaining capacity — never write past totalVolume.
        const remaining = total - alreadyInfused;
        if (remaining <= 0) {
          // Mark the order as Completed and let the nurse confirm. Best-effort,
          // non-throwing. Use load + .save() so the DoctorOrderModel pre('save')
          // hook enforces ALLOWED_TRANSITIONS — findByIdAndUpdate would bypass
          // the state machine entirely and let an already-Stopped/Cancelled
          // order flip back to Completed.
          try {
            const orderDoc = await DoctorOrder.findById(order._id);
            if (orderDoc && orderDoc.status !== "Completed") {
              orderDoc.status = "Completed";
              orderDoc.infusionStopped = now;
              orderDoc.stopReason = "Total volume infused (auto by cron)";
              orderDoc.statusChangedAt = now;
              orderDoc.completedAt = now;
              orderDoc.auditLog.push({
                step: "Infusion auto-stopped — totalVolume reached",
                doneBy: "SYSTEM",
                doneAt: now,
                notes: `cron sweep at ${bucket} — sum=${alreadyInfused}, total=${total}`,
              });
              await orderDoc.save();
              completed++;
              // Emit a clinical audit row so the surveyor can trace the
              // auto-stop back to the cron sweep. Non-blocking — never let
              // an audit failure unwind the status change.
              try {
                const { emitClinicalAudit } = require("../Compliance/clinicalAuditService");
                await emitClinicalAudit({
                  event: "STATUS_CHANGE",
                  targetType: "DoctorOrder",
                  targetId: orderDoc._id,
                  UHID: orderDoc.UHID,
                  admissionId: orderDoc.admissionId,
                  patientId: orderDoc.patientId,
                  actor: { _id: "SYSTEM", fullName: "infusion-intake-cron" },
                  after: { status: "Completed", reason: "Total volume infused (auto by cron)" },
                });
              } catch (_) { /* silent */ }
            }
          } catch (e) { /* leave as-is; nurse will see Completed flag next tick */ }
          continue;
        }

        // 5) Cap this hour's row at min(rate, remaining).
        const thisHour = Math.min(rate, remaining);
        const entry = await ioService.recordHourlyInfusionIntake({
          order,
          hourBucket: bucket,
          ratePerHour: thisHour,
        });
        if (entry) written++;
      } catch (e) {
        logErr("infusionIntakeCron", `tick order=${order?._id}`)(e);
      }
    }
  } catch (e) {
    logErr("infusionIntakeCron", "tick")(e);
  }

  return { processed, written, skipped, completed };
}

/**
 * Arm the hourly sweep. Returns a cancel function.
 *
 * First tick fires immediately on arm (so we don't wait an hour
 * on server boot to backfill the current bucket). Subsequent ticks
 * fire every 60 minutes.
 *
 * Idempotency at the row layer (uniq_infusion_hour_bucket index)
 * means we can't accidentally double-write even if multiple instances
 * of the cron tick the same bucket — the second one upserts to the
 * existing row.
 */
function arm({ intervalMs = 60 * 60 * 1000 } = {}) {
  // B4-T03 — multi-replica safety: wrap each tick in a 15-min distributed
  // lock so only one instance per cluster actually sweeps a given hour
  // bucket. Combined with the partial unique index on IntakeOutputEntry
  // this is belt-and-suspenders: the lock keeps idle replicas out of the
  // sweep entirely; the index keeps the row layer honest if two ticks
  // race the same bucket from different processes.
  const { acquireLock, releaseLock } = require("../../utils/cronScheduler");
  const LOCK = "cron:infusion-intake";

  const guardedTick = async (label) => {
    let acquired = false;
    try {
      acquired = await acquireLock(LOCK, 15 * 60);
      if (!acquired) {
        // Another replica is sweeping this bucket; quiet skip.
        return null;
      }
      const r = await tickOnce();
      if (r && (r.written || r.completed)) {
        console.log(`[cron:infusion-intake] ${label} processed=${r.processed} written=${r.written} completed=${r.completed} skipped=${r.skipped}`);
      }
      // Heartbeat audit — best-effort, never throws into the cron.
      try {
        const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
        await emitBillingAudit({
          event: "CRON_RECONCILED",
          actorName: "System (infusion-intake-cron)",
          reason: `Infusion intake sweep ${label}: processed=${r?.processed || 0} written=${r?.written || 0} completed=${r?.completed || 0} skipped=${r?.skipped || 0}.`,
          after: { kind: "CRON_HEARTBEAT", cron: "infusion-intake", label, ...r, runAt: new Date().toISOString() },
        });
      } catch (e) {
        console.warn("[cron:infusion-intake] audit emit failed:", e?.message);
      }
      return r;
    } catch (e) {
      console.error(`[cron:infusion-intake] ${label} failed:`, e?.message);
      return null;
    } finally {
      if (acquired) { try { await releaseLock(LOCK); } catch (_) {} }
    }
  };

  // Fire once at arm-time so the current hour gets a row immediately,
  // even if the server was restarted mid-hour.
  guardedTick("first tick").catch((e) => console.error("[cron:infusion-intake] first tick failed:", e?.message));

  const interval = setInterval(() => {
    guardedTick("tick").catch((e) => console.error("[cron:infusion-intake] tick failed:", e?.message));
  }, intervalMs);

  if (typeof interval.unref === "function") interval.unref();
  console.log("[cron:infusion-intake] armed — every 60 min (lock: cron:infusion-intake)");

  return () => clearInterval(interval);
}

module.exports = { arm, tickOnce, hourBucketOf, parseRate };
