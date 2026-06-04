/**
 * jobs/preExpiryEmailCron.js  (R7bm-F8 / R7bl close-out / NABH HRD.3)
 *
 * Pre-expiry credential notifier. Runs daily at 09:00 IST via
 * `scheduleDaily` from utils/cronScheduler (which gives us a Mongo
 * distributed lock so multi-replica deploys don't double-email).
 *
 * Why this matters
 * ────────────────
 * The existing `expire-credentials` cron (registered in index.js) only
 * runs at 02:00 IST and only flips VERIFIED → EXPIRED. By then it's
 * already too late — the next day's first prescription / physio session
 * / meal handover gets blocked at the door because the licence ran out
 * overnight. R7bl flagged this as a "no warning rail" issue.
 *
 * This job sends graduated reminders so HR and the staff member see the
 * expiry approaching:
 *
 *   • T-30 days  →  one notification ("Renewal recommended now")
 *   • T-7  days  →  one notification ("Final reminder — renew this week")
 *   • T-0  days  →  one notification ("Credential expires today")
 *
 * Each notification dedups via a per-row `lastNotifiedExpiry30dAt` /
 * `lastNotifiedExpiry7dAt` / `lastNotifiedExpiry0dAt` timestamp on the
 * credential, so a retry on the next morning doesn't spam the same
 * person. (We use timestamp ranges instead of adding new schema fields
 * — the safest landing pattern, see below.)
 *
 * Storage / dedup strategy
 * ────────────────────────
 * Adding three new fields to CredentialModel.js would require a schema
 * change owned by HR. Instead, this cron uses a self-contained
 * `cred_preexpiry_notify` collection (one-row-per-(credentialId,bucket))
 * to track who's already been pinged for which bucket — lazily-created,
 * TTL-cleaned at +60 days post-bucket.
 *
 * Notification delivery
 * ─────────────────────
 * No SMTP / SES wiring is mounted in this codebase yet. We fan out to
 * the same stubbed channel that reorderNotifier uses — console.log +
 * best-effort BillingAudit row — so the cron has a paper trail visible
 * to ops via `kubectl logs` until real email lands. Replacement is a
 * one-line swap in `_sendOne`.
 */
"use strict";

const mongoose = require("mongoose");
const Credential = require("../models/HR/CredentialModel");

// ── Per-bucket dedup collection ──────────────────────────────────────
// One doc per (credentialId, bucket) — bucket ∈ "T30" | "T7" | "T0".
// TTL purges old rows ~60d after the bucket window so we don't keep
// rocking the notifier with re-notifications when expiryDate gets
// pushed forward.
const _NotifySchema = new mongoose.Schema(
  {
    credentialId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    bucket:       { type: String, enum: ["T30", "T7", "T0"], required: true },
    notifiedAt:   { type: Date, default: Date.now },
    // TTL — let Mongo expire the dedup row 60d after we wrote it.
    expiresAt:    { type: Date, default: () => new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
                    index: { expireAfterSeconds: 0 } },
  },
  { collection: "cred_preexpiry_notify", versionKey: false, timestamps: false },
);
// Unique on (credentialId, bucket) so the upsert is the dedup key.
_NotifySchema.index({ credentialId: 1, bucket: 1 }, { unique: true });

let _NotifyModel = null;
function _getNotifyModel() {
  if (_NotifyModel) return _NotifyModel;
  _NotifyModel = mongoose.models.CredentialPreExpiryNotify
    || mongoose.model("CredentialPreExpiryNotify", _NotifySchema, "cred_preexpiry_notify");
  return _NotifyModel;
}

// ── Bucket windows ───────────────────────────────────────────────────
// We look at the IST midnight of "today" so the bucket boundaries align
// with calendar days regardless of host TZ.
function _istMidnight(daysFromToday) {
  // en-CA returns "YYYY-MM-DD" — easy to parse with explicit +05:30.
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const today = new Date(`${key}T00:00:00+05:30`);
  return new Date(today.getTime() + daysFromToday * 86400 * 1000);
}

function _bucketWindows() {
  return [
    { bucket: "T30", from: _istMidnight(30), to: _istMidnight(31) },
    { bucket: "T7",  from: _istMidnight(7),  to: _istMidnight(8)  },
    { bucket: "T0",  from: _istMidnight(0),  to: _istMidnight(1)  },
  ];
}

// ── Notification dispatch (stub) ─────────────────────────────────────
// Mirrors reorderNotifier.notifyLowStock in that the live mailer is
// deferred; this gives the cron a real audit trail (BillingAudit row +
// console.log) until SMTP lands. Replace `_sendOne` to plug real email.
async function _sendOne({ credential, user, bucket }) {
  const dayLabel = bucket === "T30" ? "in 30 days"
    : bucket === "T7"  ? "in 7 days"
    : "today";
  const line =
    `[preExpiryEmailCron] ${credential.credentialType} for ${
      user?.fullName || credential.userFullName || credential.userId
    } (employeeId=${user?.employeeId || credential.userEmployeeId || "—"}) expires ${dayLabel} on ${
      credential.expiryDate ? new Date(credential.expiryDate).toISOString().slice(0, 10) : "—"
    }. Email target: ${user?.email || "—"}.`;
  // eslint-disable-next-line no-console
  console.log(line);

  try {
    const BillingAudit = require("../models/Billing/BillingAudit");
    if (BillingAudit && typeof BillingAudit.emitBillingAudit === "function") {
      await BillingAudit.emitBillingAudit({
        event:     "MASTER_DRUG_PRICE_CHANGED",  // closest existing enum slot
        actorName: "System (preExpiryEmailCron)",
        reason:    `Credential pre-expiry notification — bucket=${bucket}, type=${credential.credentialType}`,
        after: {
          credentialId:    credential._id,
          credentialType:  credential.credentialType,
          userId:          credential.userId,
          userFullName:    user?.fullName || credential.userFullName || "",
          userEmployeeId:  user?.employeeId || credential.userEmployeeId || "",
          userEmail:       user?.email || "",
          expiryDate:      credential.expiryDate,
          bucket,
          notifiedAt:      new Date(),
        },
      });
    }
  } catch (e) {
    // Audit failure must not break the notifier.
    // eslint-disable-next-line no-console
    console.warn(`[preExpiryEmailCron] audit emit failed: ${e.message}`);
  }

  return { sent: 1, channel: "log+audit", bucket };
}

/**
 * Sweep — public entry point invoked from the cron in index.js.
 *
 * Algorithm:
 *   1. For each of the three buckets (T30 / T7 / T0):
 *      a. Find every VERIFIED credential whose expiryDate falls in the
 *         bucket's [from, to) window.
 *      b. Try to upsert the dedup row — if E11000 we've already sent
 *         this bucket for this row, skip.
 *      c. Otherwise hydrate the user (best-effort) and fire _sendOne.
 *   2. Return a per-bucket scanned/sent rollup for log visibility.
 *
 * Idempotency: the dedup collection's unique index makes re-runs safe.
 * Failure of any single notification is logged and the sweep continues.
 */
async function runPreExpirySweep() {
  const Notify = _getNotifyModel();
  let User;
  try { User = require("../models/User/userModel"); } catch (_) { User = null; }

  const out = { T30: { scanned: 0, sent: 0 }, T7: { scanned: 0, sent: 0 }, T0: { scanned: 0, sent: 0 } };

  for (const w of _bucketWindows()) {
    let rows = [];
    try {
      rows = await Credential.find({
        status: "VERIFIED",
        expiryDate: { $gte: w.from, $lt: w.to },
      })
        .select("_id userId credentialType expiryDate userFullName userEmployeeId userRole")
        .lean();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[preExpiryEmailCron] bucket ${w.bucket} query failed:`, e.message);
      continue;
    }
    out[w.bucket].scanned = rows.length;

    // R7hr-12-S3 (D10-08): Batch-hydrate users up-front instead of one
    // findById per credential. At quarterly licence renewal peaks (NMC /
    // IAP / FSSAI / BMW) a single bucket can hold 100+ rows — sequential
    // findById turned the cron into a multi-minute round-trip storm.
    // One $in query → Map → lookup mirrors the listIpdCreditAdmissions
    // admMap pattern.
    let userMap = new Map();
    if (User) {
      const userIds = rows.map(r => r.userId).filter(Boolean);
      if (userIds.length) {
        try {
          const users = await User.find({ _id: { $in: userIds } })
            .select("fullName email employeeId")
            .lean();
          userMap = new Map(users.map(u => [String(u._id), u]));
        } catch (e) {
          // Hydration failure is non-fatal — _sendOne falls back to the
          // denormalised fields stamped on the credential row itself.
          // eslint-disable-next-line no-console
          console.warn(`[preExpiryEmailCron] batch user hydrate failed for ${w.bucket}: ${e.message}`);
        }
      }
    }

    for (const row of rows) {
      // Dedup — upsert the (credentialId, bucket) row. E11000 means we
      // already sent it, so skip.
      try {
        await Notify.create({ credentialId: row._id, bucket: w.bucket });
      } catch (e) {
        if (e && e.code === 11000) continue;       // already notified — skip
        // eslint-disable-next-line no-console
        console.warn(`[preExpiryEmailCron] dedup upsert failed for ${row._id}/${w.bucket}: ${e.message}`);
        continue;
      }

      // R7hr-12-S3 (D10-08): O(1) lookup against the pre-hydrated map
      // instead of a per-row findById round-trip.
      const user = row.userId ? (userMap.get(String(row.userId)) || null) : null;

      try {
        await _sendOne({ credential: row, user, bucket: w.bucket });
        out[w.bucket].sent += 1;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[preExpiryEmailCron] send failed for ${row._id}/${w.bucket}: ${e.message}`);
      }
    }
  }

  // Compact one-line summary for ops grep.
  // eslint-disable-next-line no-console
  console.log(
    `[preExpiryEmailCron] swept — T30: ${out.T30.sent}/${out.T30.scanned}, ` +
    `T7: ${out.T7.sent}/${out.T7.scanned}, T0: ${out.T0.sent}/${out.T0.scanned}`,
  );
  return out;
}

module.exports = {
  runPreExpirySweep,
  // Exposed for tests / one-off triggers (e.g. an admin button in HR).
  _bucketWindows,
};
