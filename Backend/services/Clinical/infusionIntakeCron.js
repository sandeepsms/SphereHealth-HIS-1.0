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
        const aggResult = await IntakeOutputEntry.aggregate([
          {
            $match: {
              source: "INFUSION_CRON",
              "meta.orderId": order._id,
              voided: { $ne: true },
            },
          },
          { $group: { _id: null, sum: { $sum: "$volumeML" } } },
        ]);
        const alreadyInfused = aggResult?.[0]?.sum || 0;

        // 4) Remaining capacity — never write past totalVolume.
        const remaining = total - alreadyInfused;
        if (remaining <= 0) {
          // Mark the order as Completed and let the nurse confirm. Best-effort,
          // non-throwing.
          try {
            await DoctorOrder.findByIdAndUpdate(order._id, {
              $set: {
                status: "Completed",
                infusionStopped: now,
                stopReason: "Total volume infused (auto by cron)",
              },
              $push: {
                auditLog: {
                  step: "Infusion auto-stopped — totalVolume reached",
                  doneBy: "SYSTEM",
                  doneAt: now,
                  notes: `cron sweep at ${bucket} — sum=${alreadyInfused}, total=${total}`,
                },
              },
            });
            completed++;
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
  // Fire once at arm-time so the current hour gets a row immediately,
  // even if the server was restarted mid-hour.
  tickOnce().then((r) => {
    if (r.written || r.completed) {
      console.log(`[cron:infusion-intake] first tick processed=${r.processed} written=${r.written} completed=${r.completed} skipped=${r.skipped}`);
    }
  }).catch((e) => console.error("[cron:infusion-intake] first tick failed:", e?.message));

  const interval = setInterval(() => {
    tickOnce()
      .then((r) => {
        if (r.written || r.completed) {
          console.log(`[cron:infusion-intake] tick processed=${r.processed} written=${r.written} completed=${r.completed} skipped=${r.skipped}`);
        }
      })
      .catch((e) => console.error("[cron:infusion-intake] tick failed:", e?.message));
  }, intervalMs);

  if (typeof interval.unref === "function") interval.unref();
  console.log("[cron:infusion-intake] armed — every 60 min");

  return () => clearInterval(interval);
}

module.exports = { arm, tickOnce, hourBucketOf, parseRate };
