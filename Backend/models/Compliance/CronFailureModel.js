/**
 * CronFailureModel.js  (B4-T05)
 *
 * Audit-grade record of every cron-job execution that threw. Pairs with
 * utils/cronRetry.js which writes one row per failed attempt, schedules an
 * exponentially-backed-off retry (30 → 60 → 120 minutes for attempts 1-3),
 * and finally marks the row `resolved` once the retry succeeds or the
 * permanent-failure ceiling is hit.
 *
 * Why a model and not just logs:
 *   - Cron failures must survive process restarts so the next sweep can pick
 *     them up.
 *   - NABH/IT-audit needs a queryable register of compliance-cron lapses
 *     (CV-alert escalation, grievance SLA, fire-drill overdue, etc.) — the
 *     same way grievance/CV alerts are tracked.
 *   - The compound index on { name, nextRetryAt, resolvedAt } lets the
 *     `dueRetries()` sweep be a single index hit.
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

const CronFailureSchema = new Schema(
  {
    // Cron-job identifier (e.g. "cv-alert-escalate", "grievance-sla-escalate").
    name: { type: String, required: true, index: true },

    // When the failing run occurred. Default to the row's creation time so
    // callers don't need to pass it explicitly.
    runAt: { type: Date, default: Date.now, index: true },

    // Captured error.message and full stack trace for forensic review.
    error: { type: String, default: "" },
    errorStack: { type: String, default: "" },

    // 1-based attempt counter. 0 is invalid (every row represents *a* failed
    // attempt). Hits MAX_RETRIES + 1 → resolution = 'permanent-failure'.
    retryCount: { type: Number, default: 0 },

    // When the retry sweep should pick this row up. null once `resolvedAt`
    // is set so the partial index in dueRetries() naturally skips it.
    nextRetryAt: { type: Date, default: null, index: true },

    // Set when the retry finally succeeded, was manually overridden, or the
    // backoff ladder was exhausted (permanent-failure).
    resolvedAt: { type: Date, default: null },

    resolution: {
      type: String,
      enum: ["retried-success", "permanent-failure", "manual-override"],
      default: null,
    },
  },
  { timestamps: true, collection: "cron_failures" },
);

// Single-shot index for the retry sweep — `dueRetries()` filters on
// resolvedAt:null + nextRetryAt:$lte:now, optionally scoped by name.
CronFailureSchema.index({ name: 1, nextRetryAt: 1, resolvedAt: 1 });

module.exports =
  mongoose.models.CronFailure ||
  mongoose.model("CronFailure", CronFailureSchema);
