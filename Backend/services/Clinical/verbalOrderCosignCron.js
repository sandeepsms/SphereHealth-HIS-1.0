// services/Clinical/verbalOrderCosignCron.js
// ════════════════════════════════════════════════════════════════════
// R7hr-141 — Daily sweep for uncosigned verbal/telephonic orders that
// have aged past the NABH MOM.7c §3 24-hour cosign window.
//
// What it does (per tick):
//   1. Find DoctorOrders where:
//        isVerbal       = true
//        coSignedBy     IS NULL
//        verbalEnteredAt < (now - 24h)
//      AND (overdueAlertedAt IS NULL OR overdueAlertedAt < now-24h)
//
//      The second clause prevents the cron from re-emitting the same
//      overdue alert every tick — we only re-flag a still-uncosigned
//      verbal order once every 24h so the governance dashboard doesn't
//      see duplicates and the ClinicalAudit trail stays clean.
//
//   2. For each match, emit CLINICAL_AUDIT event
//      VERBAL_ORDER_OVERDUE_COSIGN with full context (which nurse, which
//      doctor, how many hours overdue, what drug). The
//      ClinicalAudit row goes onto the 7y NABH retention floor because
//      uncosigned verbal orders are a survey gap (AAC.7 + MOM.7c).
//
//   3. Stamp `overdueAlertedAt = now` on the order doc so we don't re-
//      alert until 24h have passed again.
//
// Errors are swallowed per-order so one bad row doesn't tank the
// whole sweep — same pattern as infusionIntakeCron (R7gw-B4-T03).
// ════════════════════════════════════════════════════════════════════
const mongoose = require("mongoose");
const { logErr } = require("../../utils/logErr");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function tickOnce() {
  let processed = 0;
  let alerted   = 0;
  let skipped   = 0;

  try {
    const DoctorOrder = mongoose.model("DoctorOrder");
    const { emitClinicalAudit } = require("../Compliance/clinicalAuditService");

    const now = new Date();
    const cutoff = new Date(now.getTime() - ONE_DAY_MS);

    // Find verbal orders that have aged past the 24h cosign window AND
    // either never been alerted before OR last alerted > 24h ago.
    const orders = await DoctorOrder.find({
      isVerbal: true,
      coSignedBy: null,
      verbalEnteredAt: { $lt: cutoff },
      $or: [
        { overdueAlertedAt: null },
        { overdueAlertedAt: { $exists: false } },
        { overdueAlertedAt: { $lt: cutoff } },
      ],
    }).lean();

    for (const order of orders) {
      processed++;
      try {
        const enteredAt = order.verbalEnteredAt ? new Date(order.verbalEnteredAt) : null;
        const hoursOverdue = enteredAt
          ? Math.floor((now.getTime() - enteredAt.getTime()) / 3600000) - 24
          : null;

        // Emit the audit row. Cosign-overdue is a governance flag —
        // hospital QI committee reads it monthly to chase the doctor.
        await emitClinicalAudit({
          event: "VERBAL_ORDER_OVERDUE_COSIGN",
          UHID: order.UHID,
          admissionId: order.admissionId,
          patientId: order.patientId,
          targetType: `DoctorOrder.${order.orderType}`,
          targetId: order._id,
          actor: { _id: "SYSTEM", fullName: "verbal-cosign-cron" },
          after: {
            verbalFromDoctor: order.verbalFromDoctor,
            verbalEnteredByName: order.verbalEnteredByName,
            verbalEnteredAt: order.verbalEnteredAt,
            verbalReason: order.verbalReason,
            hoursOverdue,
            medicineName: order.orderDetails?.medicineName || order.orderDetails?.fluidName || "",
            dose: order.orderDetails?.dose || "",
            rate: order.orderDetails?.rate || "",
          },
          reason: `Verbal order from Dr. ${order.verbalFromDoctor} via nurse ${order.verbalEnteredByName} is ${hoursOverdue !== null ? hoursOverdue + "h" : "?"} OVERDUE for cosign (NABH MOM.7c §3 — flagged for governance review).`,
        });

        // Stamp the alert timestamp so we don't re-alert until another
        // 24h pass without cosign. Use findByIdAndUpdate to bypass the
        // pre('save') ALLOWED_TRANSITIONS check — we're not changing
        // status, just stamping a cron-tracking field.
        await DoctorOrder.findByIdAndUpdate(order._id, { $set: { overdueAlertedAt: now } });
        alerted++;
      } catch (e) {
        skipped++;
        logErr("verbalOrderCosignCron", `tick order=${order?._id}`)(e);
      }
    }
  } catch (e) {
    logErr("verbalOrderCosignCron", "tick")(e);
  }

  return { processed, alerted, skipped };
}

/**
 * Arm the daily sweep at 06:00 IST (when the morning round usually
 * starts — so the chief consultant sees the dashboard with overdue
 * verbal orders before ward round and can cosign).
 *
 * Combines a Mongo distributed lock (only one replica fires the sweep
 * per tick) with the existing scheduleDaily wrapper.
 */
function arm({ hourIST = 6, minuteIST = 0 } = {}) {
  const { scheduleDaily, acquireLock, releaseLock } = require("../../utils/cronScheduler");
  const LOCK = "cron:verbal-cosign-overdue";

  const guardedTick = async () => {
    let acquired = false;
    try {
      acquired = await acquireLock(LOCK, 15 * 60);
      if (!acquired) return null;
      const r = await tickOnce();
      if (r && r.alerted) {
        console.log(`[cron:verbal-cosign-overdue] processed=${r.processed} alerted=${r.alerted} skipped=${r.skipped}`);
      }
      // Heartbeat emit — surveyor needs proof the cron ran daily
      // (NABH AAC.7 — cron silence ≠ no overdue verbal orders;
      // proof of execution must be filed).
      try {
        const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
        await emitBillingAudit({
          event: "CRON_RECONCILED",
          actorName: "System (verbal-cosign-overdue cron)",
          reason: `Verbal-cosign-overdue sweep: processed=${r?.processed || 0} alerted=${r?.alerted || 0} skipped=${r?.skipped || 0}.`,
          after: { kind: "CRON_HEARTBEAT", cron: "verbal-cosign-overdue", ...r, runAt: new Date().toISOString() },
        });
      } catch (e) {
        console.warn("[cron:verbal-cosign-overdue] audit emit failed:", e?.message);
      }
      return r;
    } catch (e) {
      console.error("[cron:verbal-cosign-overdue] tick failed:", e?.message);
      return null;
    } finally {
      if (acquired) { try { await releaseLock(LOCK); } catch (_) {} }
    }
  };

  scheduleDaily("verbal-cosign-overdue", hourIST, minuteIST, guardedTick);

  // Also fire once on boot (after a short delay so models are registered).
  setTimeout(() => {
    guardedTick().catch((e) => console.error("[cron:verbal-cosign-overdue] boot tick failed:", e?.message));
  }, 90_000);

  console.log(`[cron:verbal-cosign-overdue] armed — daily at ${String(hourIST).padStart(2,"0")}:${String(minuteIST).padStart(2,"0")} IST (lock: ${LOCK})`);
}

module.exports = { arm, tickOnce };
