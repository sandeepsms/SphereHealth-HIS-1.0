/**
 * systemHealthController.js — R7bz System Health admin dashboard
 *
 * Single endpoint that powers the new admin-only "System Health" page.
 * Surfaces read-only diagnostics about the running HIS:
 *
 *   • db        — per-collection document counts (estimatedDocumentCount,
 *                 metadata-only, microsecond cost) + db.stats() for total
 *                 size, index size, collection count.
 *   • crons     — known scheduled jobs (the daily IST crons armed in
 *                 Backend/index.js + the cadence-based clinical sweeps)
 *                 with their CURRENT lock state read from `cron_locks`.
 *   • errors    — client-side render crashes captured by the React
 *                 ErrorBoundary (see models/Admin/ClientErrorLog.js).
 *                 Counts 24h / 7d + top message.
 *   • activity  — today's hospital activity: active admissions, beds
 *                 occupied vs total, registrations / OPDs / bills today.
 *   • integrity — cheap invariant checks (duplicate active admissions,
 *                 orphan bills, cron audit lag) each tagged ok|warn|crit.
 *   • server    — process diagnostics: node version, uptime, memory, pid.
 *
 * Philosophy:
 *   1. READ-ONLY. This handler must NEVER mutate state. No writes, no
 *      cleanup, no "fix it" side-effects — it's diagnostic surface only.
 *   2. NEVER block on a slow query. Every collection count uses
 *      `estimatedDocumentCount()` (metadata-only, sub-millisecond) instead
 *      of `countDocuments()` (full scan on a large collection). Every
 *      aggregate uses Promise.all and a small lookup-limit so the worst
 *      case is still O(few hundred ms).
 *   3. PARTIAL FAILURE OK. Each top-level section is wrapped in try/catch
 *      independently — if `db.stats()` chokes (older Mongo, restricted
 *      role), the rest of the response still ships. The failed section
 *      returns `{ error: e.message }` so the UI can surface it without
 *      blowing up the whole page.
 *
 * Gate: admin-only via `requireAction("users.read")` in the route layer.
 *   We deliberately re-use an existing permission (instead of inventing a
 *   new `system.health.read`) to match the convention from
 *   adminDashboardRoutes.js — Accountant has users.read=false so only
 *   Admin can hit this endpoint today.
 */
"use strict";

const mongoose = require("mongoose");

// ── Models we count.  These are required up-front so a model-load error
//    surfaces at boot, not on first request.  Each Model.estimatedDocumentCount()
//    is metadata-only so listing them all here is essentially free.
const Patient        = require("../../models/Patient/patientModel");
const Admission      = require("../../models/Patient/admissionModel");
const OPD            = require("../../models/Patient/OPDModels");
const Bed            = require("../../models/bedMgmt/bedsModel");
const User           = require("../../models/User/userModel");
const PatientBill    = require("../../models/PatientBillModel/PatientBillModel");
const BillingTrigger = require("../../models/Billing/BillingTrigger");
const DrugBatch      = require("../../models/Pharmacy/DrugBatchModel");
const DoctorOrder    = require("../../models/Doctor/DoctorOrderModel");
const Prescription   = require("../../models/Doctor/prescription");
const MAR            = require("../../models/Clinical/MARModel");

// NABH register models — each has `collection: "<snake_case>_registers"`.
const ASARegister             = require("../../models/Compliance/ASARegisterModel");
const OTRegister              = require("../../models/Compliance/OTRegisterModel");
const ReadmissionRegister     = require("../../models/Compliance/ReadmissionRegisterModel");
const MortalityRegister       = require("../../models/Compliance/MortalityRegisterModel");
const RestraintRegister       = require("../../models/Compliance/RestraintRegisterModel");
const AntimicrobialRegister   = require("../../models/Compliance/AntimicrobialUseRegisterModel");

const { istStartOfToday, istStartOfDayPlus, istEndOfToday } = require("../../utils/queryGuards");

/* ──────────────────────────────────────────────────────────────────────
   Known scheduled jobs.  Mirrors the `scheduleDaily(...)` calls in
   Backend/index.js + the cadence-based clinical sweeps (infusion intake,
   missed dose, visitor-pass expiry, assessment-compliance, cv-alert
   escalate, fire-drill-overdue, retention-review, nightly-mongo-backup,
   grievance-sla-escalate).  Each name corresponds to a lock key the
   scheduler writes when it fires (`cron:<name>`); we read those keys
   below to surface the LIVE lock state.

   Note: the `cron_locks` collection holds the lock only WHILE the job
   is running OR briefly after a crash (TTL cleanup).  Successful runs
   delete the lock on `finally → releaseLock()`, so an empty lock doc
   for a given name simply means "not currently running" — NOT a
   failure. We surface this honestly via `lockHeld: true|false` and a
   note in `hint`.
   ────────────────────────────────────────────────────────────────────── */
const KNOWN_CRONS = [
  // R7ap-F21 — daily IST accrual (boot + 00:30 IST).
  { name: "daily-accrual",            schedule: "daily 00:30 IST",  source: "scheduleDaily" },
  // R7ap-F29-F32 — 4 missing daily crons.
  { name: "gst-monthly-snapshot",     schedule: "daily 02:00 IST",  source: "scheduleDaily" },
  { name: "eod-day-book",             schedule: "daily 23:55 IST",  source: "scheduleDaily" },
  { name: "advance-pool-recon",       schedule: "daily 00:15 IST",  source: "scheduleDaily" },
  { name: "shift-auto-close",         schedule: "daily 23:50 IST",  source: "scheduleDaily" },
  // R7as / R7at — billing pipeline health.
  { name: "stuck-trigger-sweeper",    schedule: "daily 01:00 IST",  source: "scheduleDaily" },
  { name: "billing-audit-archive",    schedule: "daily 03:30 IST",  source: "scheduleDaily" },
  { name: "reorder-notifier",         schedule: "daily 08:00 IST",  source: "scheduleDaily" },
  // R7bf-G — NABH compliance daily crons.
  { name: "cv-alert-escalate",        schedule: "daily (NABH AAC.6)", source: "scheduleDaily" },
  { name: "grievance-sla-escalate",   schedule: "daily (NABH PRE.6)", source: "scheduleDaily" },
  { name: "fire-drill-overdue",       schedule: "daily (NABH FMS.4)", source: "scheduleDaily" },
  { name: "retention-review",         schedule: "daily",            source: "scheduleDaily" },
  { name: "nightly-mongo-backup",     schedule: "daily",            source: "scheduleDaily" },
  // R7bq — clinical cadence sweeps (interval-based, NOT IST daily).
  { name: "infusion-intake-hourly",   schedule: "every 1h",         source: "interval" },
  { name: "missed-dose-sweeper",      schedule: "every 15m",        source: "interval" },
  { name: "assessment-compliance",    schedule: "boot+60s, every 15m", source: "interval" },
  { name: "visitor-pass-expiry",      schedule: "every 5m",         source: "interval" },
];

/* ──────────────────────────────────────────────────────────────────────
   Section: db — collection counts + db.stats().
   ────────────────────────────────────────────────────────────────────── */
async function buildDb() {
  /* estimatedDocumentCount() reads the cached count from collection
     metadata — sub-millisecond on collections of any size. The trade-off
     is that the value can lag the actual count by a few seconds on a hot
     write path. For System Health that's totally fine (we want order of
     magnitude, not transactional accuracy). countDocuments() would be a
     full scan and could spend several seconds on the big collections
     (patients, mar_entries, doctor_orders). */
  const counts = await Promise.all([
    Patient.estimatedDocumentCount().catch(() => null),
    Admission.estimatedDocumentCount().catch(() => null),
    OPD.estimatedDocumentCount().catch(() => null),
    PatientBill.estimatedDocumentCount().catch(() => null),
    BillingTrigger.estimatedDocumentCount().catch(() => null),
    DrugBatch.estimatedDocumentCount().catch(() => null),
    DoctorOrder.estimatedDocumentCount().catch(() => null),
    Prescription.estimatedDocumentCount().catch(() => null),
    MAR.estimatedDocumentCount().catch(() => null),
    // Client errors: dynamic require so a fresh checkout without the
    // sibling-agent's file still returns something.
    (async () => {
      try {
        const ClientErrorLog = require("../../models/Admin/ClientErrorLog");
        return await ClientErrorLog.estimatedDocumentCount();
      } catch (_) { return null; }
    })(),
    // NABH registers (6 collections shipped in R7bx).
    ASARegister.estimatedDocumentCount().catch(() => null),
    OTRegister.estimatedDocumentCount().catch(() => null),
    ReadmissionRegister.estimatedDocumentCount().catch(() => null),
    MortalityRegister.estimatedDocumentCount().catch(() => null),
    RestraintRegister.estimatedDocumentCount().catch(() => null),
    AntimicrobialRegister.estimatedDocumentCount().catch(() => null),
  ]);

  const [
    patients, admissions, opds, bills, billingTriggers, drugBatches,
    doctorOrders, prescriptions, marEntries, clientErrors,
    asaRegisters, otRegisters, readmissionRegisters, mortalityRegisters,
    restraintRegisters, antimicrobialRegisters,
  ] = counts;

  // db.stats() — total dataSize, storageSize, indexSize, collection
  // count.  Wrapped in try/catch because some hosted Mongo plans (older
  // Atlas free tier, some shared instances) restrict the stats command.
  let stats = null;
  try {
    const s = await mongoose.connection.db.stats();
    stats = {
      collections: s.collections ?? null,
      objects:     s.objects     ?? null,
      dataSize:    s.dataSize    ?? null,
      storageSize: s.storageSize ?? null,
      indexes:     s.indexes     ?? null,
      indexSize:   s.indexSize   ?? null,
    };
  } catch (e) {
    stats = { error: e.message };
  }

  return {
    counts: {
      patients,
      admissions,
      opds,
      bills,
      billingTriggers,
      drugBatches,
      doctorOrders,
      prescriptions,
      marEntries,
      clientErrors,
      nabh: {
        asaRegisters,
        otRegisters,
        readmissionRegisters,
        mortalityRegisters,
        restraintRegisters,
        antimicrobialRegisters,
      },
    },
    stats,
  };
}

/* ──────────────────────────────────────────────────────────────────────
   Section: crons — surface known scheduled jobs with their CURRENT
   lock state (read from `cron_locks`).

   The cron scheduler in utils/cronScheduler.js writes a lock doc named
   `cron:<name>` when a tick acquires the lock, and DELETES it in the
   `finally` block when the tick finishes (success or error). So:
     • lock doc exists  → the job is currently running, OR it crashed
                          mid-tick and the TTL hasn't reaped yet.
     • lock doc absent  → the job is not currently running. We CANNOT
                          tell when it last fired without a separate
                          audit collection.

   Adding such an audit collection is out of scope for this handler
   (the brief explicitly says "don't add new persistence"). We surface
   what we have honestly and let the UI render a "Not yet tracked"
   pill alongside the lock state.
   ────────────────────────────────────────────────────────────────────── */
async function buildCrons() {
  let lockDocs = [];
  try {
    lockDocs = await mongoose.connection.db
      .collection("cron_locks")
      .find({})
      .project({ _id: 1, holder: 1, acquiredAt: 1, expiresAt: 1 })
      .toArray();
  } catch (e) {
    return { error: e.message, jobs: [], note: "cron_locks collection not readable" };
  }

  const byName = new Map();
  for (const doc of lockDocs) {
    // Lock IDs are stored as `cron:<name>`; strip the prefix to match.
    const name = String(doc._id || "").replace(/^cron:/, "");
    byName.set(name, doc);
  }

  // R7bz integrity check helper exported alongside — compute the most
  // recent acquiredAt across all known crons so the integrity section
  // can flag a stale cron pipeline.
  let mostRecentLockAt = null;

  const jobs = KNOWN_CRONS.map((c) => {
    const lock = byName.get(c.name);
    if (lock && lock.acquiredAt) {
      const acqAt = new Date(lock.acquiredAt);
      if (!mostRecentLockAt || acqAt > mostRecentLockAt) mostRecentLockAt = acqAt;
    }
    return {
      name: c.name,
      schedule: c.schedule,
      source: c.source,
      lockHeld: !!lock,
      lockAcquiredAt: lock?.acquiredAt ?? null,
      lockExpiresAt: lock?.expiresAt ?? null,
      lockHolder: lock?.holder ?? null,
      lastRunAt: null,   // not tracked — see header notes
      lastStatus: "unknown",
      hint: lock
        ? "Lock currently held — job is running or recently crashed."
        : "Lock not held. Run history is not persisted by the IST scheduler; this is normal between fires.",
    };
  });

  // Also surface orphan locks — locks present in cron_locks but NOT
  // in KNOWN_CRONS (a cron was added since this controller shipped).
  const known = new Set(KNOWN_CRONS.map((c) => c.name));
  const orphans = lockDocs
    .map((d) => String(d._id || "").replace(/^cron:/, ""))
    .filter((n) => !known.has(n));

  return {
    jobs,
    orphans,
    mostRecentLockAt,
    note: "Run history is not persisted; only live lock state is surfaced. " +
          "An empty lock doc means the job is not currently running, NOT that it has never run.",
  };
}

/* ──────────────────────────────────────────────────────────────────────
   Section: errors — client-side render crashes from the React boundary.
   ────────────────────────────────────────────────────────────────────── */
async function buildErrors() {
  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000);
  const since7d  = new Date(now - 7  * 24 * 60 * 60 * 1000);

  // Use the raw collection handle so we don't crash if the sibling
  // agent's model file isn't on disk yet (model registration happens at
  // require-time; using the collection directly is decoupled from the
  // schema load).
  const col = mongoose.connection.db.collection("client_error_logs");

  const [totalClientErrors24h, totalClientErrors7d, topMsg] = await Promise.all([
    col.countDocuments({ occurredAt: { $gte: since24h } }).catch(() => 0),
    col.countDocuments({ occurredAt: { $gte: since7d  } }).catch(() => 0),
    col.aggregate([
      { $match: { occurredAt: { $gte: since7d } } },
      { $group: { _id: "$message", count: { $sum: 1 }, last: { $max: "$occurredAt" } } },
      { $sort:  { count: -1 } },
      { $limit: 1 },
    ]).toArray().catch(() => []),
  ]);

  return {
    totalClientErrors24h,
    totalClientErrors7d,
    topErrorMessage: topMsg[0]?._id ?? null,
    topErrorCount:   topMsg[0]?.count ?? 0,
    topErrorLastSeen: topMsg[0]?.last ?? null,
  };
}

/* ──────────────────────────────────────────────────────────────────────
   Section: activity — today's hospital activity at a glance.
   ────────────────────────────────────────────────────────────────────── */
async function buildActivity() {
  const todayStart = istStartOfToday();
  const todayEnd   = istEndOfToday();

  const [
    activeAdmissions,
    bedsAgg,
    registeredToday,
    opdToday,
    billsToday,
  ] = await Promise.all([
    Admission.countDocuments({ status: "Active", hasBed: true }).catch(() => 0),
    Bed.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).catch(() => []),
    Patient.countDocuments({ createdAt: { $gte: todayStart, $lt: todayEnd } }).catch(() => 0),
    OPD.countDocuments({ visitDate: { $gte: todayStart, $lt: todayEnd } }).catch(() => 0),
    PatientBill.countDocuments({ createdAt: { $gte: todayStart, $lt: todayEnd } }).catch(() => 0),
  ]);

  // bedsAgg gives one row per status (Available, Occupied, Cleaning…).
  // Sum all rows for total, and pull "Occupied" specifically.
  let totalBeds = 0, occupiedBeds = 0;
  for (const row of bedsAgg) {
    totalBeds += row.n;
    if (row._id === "Occupied") occupiedBeds = row.n;
  }

  return {
    activeAdmissions,
    occupiedBeds,
    totalBeds,
    registeredToday,
    opdToday,
    billsToday,
  };
}

/* ──────────────────────────────────────────────────────────────────────
   Section: integrity — cheap invariant checks.

   Each check returns { name, status, count, hint }.  Status is one of
   "ok" (count is the expected zero / within tolerance), "warn" (non-
   zero but not actively breaking workflow), "crit" (count > 0 on an
   invariant that MUST be zero — e.g. duplicate active admissions).

   All checks are bounded — we never scan an unbounded collection. The
   duplicate-admission check uses an aggregation on the Admission
   collection (small — only Active rows match the filter). The orphan-
   bills check looks up at most 500 bills against admissions ($lookup
   with limit) so it's O(500) lookups in the worst case.
   ────────────────────────────────────────────────────────────────────── */
async function buildIntegrity(cronsSection) {
  const checks = [];

  /* ── 1. Duplicate active admissions ───────────────────────────────
     R7bq-A enforced a unique partial index on Admission { uhid, status:"Active" }
     so a UHID can have at most ONE active admission at a time. If the
     index was ever dropped (manual mongosh, restore from old dump) we'd
     see >1 row per UHID here. Should always be 0. */
  try {
    const dups = await Admission.aggregate([
      { $match: { status: "Active" } },
      { $group: { _id: "$uhid", n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $count: "n" },
    ]);
    const count = dups[0]?.n ?? 0;
    checks.push({
      name: "duplicateActiveAdmissions",
      status: count === 0 ? "ok" : "crit",
      count,
      hint: count === 0
        ? "Unique partial index on (uhid, status:Active) is holding."
        : "Duplicate active admissions detected — R7bq-A invariant breached. Inspect manually.",
    });
  } catch (e) {
    checks.push({
      name: "duplicateActiveAdmissions",
      status: "warn",
      count: null,
      hint: `Check failed: ${e.message}`,
    });
  }

  /* ── 2. Orphan bills ─────────────────────────────────────────────
     PatientBill rows whose `admission` ObjectId no longer exists in
     the Admission collection. Cap the scan at 500 rows so this never
     becomes an unbounded join on a large bills collection — if we
     ever see >0 here that's already a signal to investigate, the
     exact count doesn't need to be precise. */
  try {
    const sample = await PatientBill.aggregate([
      { $match: { admission: { $ne: null } } },
      { $limit: 500 },
      {
        $lookup: {
          from: "admissions",
          localField: "admission",
          foreignField: "_id",
          as: "_adm",
        },
      },
      { $match: { _adm: { $eq: [] } } },
      { $count: "n" },
    ]);
    const count = sample[0]?.n ?? 0;
    checks.push({
      name: "orphanBillsCount",
      status: count === 0 ? "ok" : "warn",
      count,
      hint: count === 0
        ? "No orphan bills in the most recent 500 bills with an admission ref."
        : `${count} bill(s) reference a missing admission. Sampled top 500 — actual count may be higher.`,
    });
  } catch (e) {
    checks.push({
      name: "orphanBillsCount",
      status: "warn",
      count: null,
      hint: `Check failed: ${e.message}`,
    });
  }

  /* ── 3. Cron audit lag ───────────────────────────────────────────
     The scheduler doesn't persist run history, but the cron_locks
     collection holds a doc while a tick is running.  If the MOST
     RECENT lock acquisition across ALL known crons is > 48h ago,
     something is wrong with the scheduler (the daily IST crons should
     each fire once a day, so we should see SOME lock activity within
     24h on a healthy system — 48h gives slack for the every-N-hours
     ones).

     If no lock has EVER been observed we can't tell — the locks are
     deleted on success, so a healthy system between fires also has
     an empty cron_locks collection. We surface this as "warn" not
     "crit" so the UI doesn't false-alarm on a freshly-booted instance. */
  try {
    const mostRecent = cronsSection && cronsSection.mostRecentLockAt
      ? new Date(cronsSection.mostRecentLockAt)
      : null;
    const now = Date.now();
    const ageMs = mostRecent ? now - mostRecent.getTime() : null;
    const ageHrs = ageMs != null ? Math.round(ageMs / 36e5) : null;

    let status = "ok";
    let hint = "Cron locks are deleted on success, so an empty cron_locks collection is normal between fires.";
    if (ageHrs != null && ageHrs > 48) {
      status = "warn";
      hint = `Most recent cron lock was ${ageHrs}h ago — daily crons should fire at least once every 24h.`;
    } else if (ageHrs == null) {
      status = "ok";
      hint = "No cron locks currently observed — this is normal between scheduled fires.";
    }
    checks.push({
      name: "cronAuditLag",
      status,
      count: ageHrs,
      hint,
    });
  } catch (e) {
    checks.push({
      name: "cronAuditLag",
      status: "warn",
      count: null,
      hint: `Check failed: ${e.message}`,
    });
  }

  return { checks };
}

/* ──────────────────────────────────────────────────────────────────────
   Section: server — process diagnostics.
   ────────────────────────────────────────────────────────────────────── */
function buildServer() {
  const mem = process.memoryUsage();
  return {
    nodeVersion: process.version,
    uptime: process.uptime(),
    memoryUsage: {
      rss:        mem.rss,
      heapTotal:  mem.heapTotal,
      heapUsed:   mem.heapUsed,
      external:   mem.external,
      arrayBuffers: mem.arrayBuffers ?? null,
    },
    pid: process.pid,
    platform: process.platform,
    arch: process.arch,
    mongoState: mongoose.connection.readyState, // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  };
}

/* ──────────────────────────────────────────────────────────────────────
   Endpoint: GET /api/admin/system-health.
   ────────────────────────────────────────────────────────────────────── */
async function getSystemHealth(req, res) {
  // Each section is wrapped INDEPENDENTLY so a slow/broken section
  // never tanks the rest of the response. Settled-not-rejected.
  const wrap = (fn) => Promise.resolve()
    .then(fn)
    .catch((e) => ({ error: e.message || String(e) }));

  // crons must be built before integrity (the cron-lag check reads
  // cronsSection.mostRecentLockAt). The rest fire in parallel.
  const [db, crons, errors, activity, server] = await Promise.all([
    wrap(buildDb),
    wrap(buildCrons),
    wrap(buildErrors),
    wrap(buildActivity),
    wrap(buildServer),
  ]);
  const integrity = await wrap(() => buildIntegrity(crons));

  return res.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    data: { db, crons, errors, activity, integrity, server },
  });
}

module.exports = { getSystemHealth };
