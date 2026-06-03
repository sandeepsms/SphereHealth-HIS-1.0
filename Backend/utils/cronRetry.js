/**
 * cronRetry.js  (B4-T05)
 *
 * Thin retry helper around CronFailureModel. Pattern:
 *
 *   try {
 *     await runCronJob();
 *   } catch (err) {
 *     await recordCronFailure('my-cron', err);
 *   }
 *
 *   // …elsewhere, on a sweep…
 *   for (const row of await dueRetries()) {
 *     try {
 *       await rerunCronJob(row.name);
 *       await markRetrySuccess(row._id);
 *     } catch (err) {
 *       await recordCronFailure(row.name, err, row);
 *     }
 *   }
 *
 * Backoff ladder: 30 → 60 → 120 minutes (attempts 1, 2, 3). Attempt 4 is
 * recorded as resolution='permanent-failure' and is *not* re-queued.
 */
const CronFailure = require("../models/Compliance/CronFailureModel");

const MAX_RETRIES = 3;
const BACKOFF_MINUTES = [30, 60, 120];

async function recordCronFailure(name, error, prevAttempt = null) {
  const retryCount = (prevAttempt?.retryCount || 0) + 1;
  if (retryCount > MAX_RETRIES) {
    await CronFailure.create({
      name,
      error: error.message,
      errorStack: error.stack,
      retryCount,
      resolvedAt: new Date(),
      resolution: "permanent-failure",
    });
    return { permanent: true };
  }
  const minutesAhead = BACKOFF_MINUTES[retryCount - 1] || 240;
  const nextRetryAt = new Date(Date.now() + minutesAhead * 60 * 1000);
  const row = await CronFailure.create({
    name,
    error: error.message,
    errorStack: error.stack,
    retryCount,
    nextRetryAt,
  });
  return { permanent: false, nextRetryAt, rowId: row._id };
}

async function dueRetries(now = new Date()) {
  return CronFailure.find({ resolvedAt: null, nextRetryAt: { $lte: now } })
    .sort({ nextRetryAt: 1 })
    .limit(50)
    .lean();
}

async function markRetrySuccess(rowId) {
  await CronFailure.findByIdAndUpdate(rowId, {
    resolvedAt: new Date(),
    resolution: "retried-success",
  });
}

module.exports = {
  recordCronFailure,
  dueRetries,
  markRetrySuccess,
  MAX_RETRIES,
  BACKOFF_MINUTES,
};
