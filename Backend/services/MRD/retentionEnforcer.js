/**
 * services/MRD/retentionEnforcer.js  (R7bh-F6 / R7bg CRIT-A5 / NABH IMS.3)
 *
 * NABH IMS.3 + IT Act §44AA expect document-retention floors:
 *   • Bills / financial records — 8 years
 *   • Clinical records (DoctorNote, MAR, DischargeSummary, ConsentForm,
 *     Prescription) — 5 years
 *
 * Pre-R7bh only BillingAudit had a `retainUntil` field — every other
 * document collection grew unbounded. The right migration is:
 *   1. Add `retentionStatus` field on each model — owned by the
 *      respective model files (deferred).
 *   2. Daily cron computes the candidate set (documents older than the
 *      retention floor) and writes a SUMMARY row to BillingAudit.
 *   3. An admin reviews the summary + decides what to archive — no auto-
 *      purge (NABH explicitly disallows automatic destruction of
 *      clinical records without legal-team sign-off).
 *
 * This service implements step 2 — it scans + summarises but DOES NOT
 * mutate documents. It is safe to re-run; idempotent because the
 * BillingAudit row is a separate event each time.
 */
"use strict";

const mongoose = require("mongoose");

// Retention floors in days. 8 years / 5 years per NABH IMS.3.
const FLOORS = {
  bills: 8 * 365,
  clinical: 5 * 365,
};

// Candidate collections + fields. The cron uses the model name to look
// up via mongoose.model() so a missing model (older deployments) is
// gracefully skipped.
const TARGETS = [
  {
    label: "PatientBill",
    model: "PatientBill",
    floorDays: FLOORS.bills,
    dateField: "billGeneratedAt",
  },
  {
    label: "DoctorNote",
    model: "DoctorNotes",
    floorDays: FLOORS.clinical,
    dateField: "createdAt",
  },
  {
    label: "MAR",
    model: "MAR",
    floorDays: FLOORS.clinical,
    dateField: "createdAt",
  },
  {
    label: "DischargeSummary",
    model: "DischargeSummary",
    floorDays: FLOORS.clinical,
    dateField: "createdAt",
  },
  {
    label: "ConsentForm",
    model: "ConsentForm",
    floorDays: FLOORS.clinical,
    dateField: "createdAt",
  },
  {
    label: "Prescription",
    model: "Prescription",
    floorDays: FLOORS.clinical,
    dateField: "createdAt",
  },
  // R7hr-12-S2 (D8-05): Add pharmacy collections to the retention sweep so
  // NABH IMS.3 / D&C Rule §65 / NDPS Rule 65 floors are visible in the
  // daily CRON_RECONCILED audit row. Without these entries the cron's
  // summary row falsely implies the hospital's pharmacy stack is being
  // scanned. PharmacySale + DrugBatch + PharmacyVendorReturn ride the
  // 8-year billing floor (financial records). ScheduleXEntry is appended
  // under NDPS Rule 65 — practical archive floor of 10y (8y * 1.25);
  // surveyors treat NDPS retention as effectively perpetual so this is
  // the queue-to-archive trigger, NOT a destruction trigger (review still
  // requires admin sign-off — see no-auto-purge note at top of file).
  {
    label: "PharmacySale",
    model: "PharmacySale",
    floorDays: FLOORS.bills,
    dateField: "createdAt",
  },
  {
    label: "ScheduleXEntry",
    model: "ScheduleXEntry",
    floorDays: Math.round(FLOORS.bills * 1.25), // ~10y NDPS Rule 65
    dateField: "createdAt",
  },
  {
    label: "DrugBatch",
    model: "PharmacyDrugBatch",
    floorDays: FLOORS.bills,
    dateField: "createdAt",
  },
  {
    label: "PharmacyVendorReturn",
    model: "PharmacyVendorReturn",
    floorDays: FLOORS.bills,
    dateField: "returnedAt",
  },
];

function _modelOrNull(name) {
  try {
    return mongoose.model(name);
  } catch (_) {
    return null;
  }
}

/**
 * Scan retention candidates + emit a BillingAudit summary row.
 */
async function runRetentionReview() {
  const now = Date.now();
  const breakdown = {};
  let totalCandidates = 0;

  for (const t of TARGETS) {
    const Model = _modelOrNull(t.model);
    if (!Model) {
      breakdown[t.label] = { skipped: "model-not-registered" };
      continue;
    }
    const cutoff = new Date(now - t.floorDays * 86400000);
    try {
      const filter = { [t.dateField]: { $lt: cutoff } };
      // Cap counts at 1M to avoid expensive `countDocuments` on huge
      // collections; the goal is a directional figure for the
      // admin queue, not a precise audit.
      const candidates = await Model.estimatedDocumentCount?.() != null
        ? await Model.countDocuments(filter).maxTimeMS?.(5000).catch(() => -1)
        : await Model.countDocuments(filter).catch(() => -1);
      breakdown[t.label] = {
        floorDays: t.floorDays,
        cutoff: cutoff.toISOString(),
        candidates: typeof candidates === "number" && candidates >= 0 ? candidates : "timeout",
      };
      if (typeof candidates === "number" && candidates > 0) totalCandidates += candidates;
    } catch (e) {
      breakdown[t.label] = { error: e.message };
    }
  }

  // Emit a single summary row to BillingAudit. Uses CRON_RECONCILED event
  // since the enum doesn't yet include RETENTION_REVIEW. The `reason`
  // string carries the human-readable summary; the `after` blob carries
  // the per-target breakdown the admin can drill into.
  try {
    const { emitBillingAudit } = require("../../models/Billing/BillingAudit");
    await emitBillingAudit({
      event: "CRON_RECONCILED",
      actorName: "System (retention-review)",
      reason: `Retention review: ${totalCandidates} document(s) older than the NABH IMS.3 floor across ${TARGETS.length} collections. No auto-purge — admin queue only.`,
      after: {
        kind: "RETENTION_REVIEW",
        totalCandidates,
        runAt: new Date().toISOString(),
        breakdown,
      },
    });
  } catch (e) {
    console.warn("[retention-review] audit emit failed:", e.message);
  }

  return { totalCandidates, breakdown };
}

/**
 * Boot-time sanity check (R7gv / B4-T07 Part B).
 *
 * Returns one row per expected retention model: `{ name, ok, reason? }`.
 * A row is `ok:false` when the model name isn't registered with mongoose
 * (typo in the TARGETS list, or the model file isn't required anywhere
 * by app bootstrap) or when a no-op `find().limit(0)` round-trips an
 * error (collection missing, index corruption, auth, etc.). Caller is
 * expected to console.warn any failures so the retention cron doesn't
 * fail silently every night for weeks at 04:00 IST.
 */
async function startupSelfTest() {
  // R7hr-12-S2 (D8-05): mirror the pharmacy additions in TARGETS above so
  // boot-time sanity flags a typo / missing model bootstrap require for
  // any of the four new pharmacy retention targets.
  const KNOWN_MODELS = [
    'DoctorNotes',
    'MAR',
    'ConsentForm',
    'PatientBill',
    'DischargeSummary',
    'Prescription',
    'PharmacySale',
    'ScheduleXEntry',
    'PharmacyDrugBatch',
    'PharmacyVendorReturn',
  ];
  const results = [];
  for (const name of KNOWN_MODELS) {
    const Model = mongoose.modelNames().includes(name) ? mongoose.model(name) : null;
    if (!Model) { results.push({ name, ok: false, reason: 'model-not-registered' }); continue; }
    try { await Model.find({}).limit(0).lean(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, reason: e.message }); }
  }
  return results;
}

module.exports = { runRetentionReview, FLOORS, TARGETS, startupSelfTest };
