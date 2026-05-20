/**
 * Backend/index.js
 *
 * Server entrypoint. Hardened in the 2026-05-17 audit pass:
 *   - Process-level uncaughtException / unhandledRejection handlers
 *   - SIGTERM / SIGINT graceful shutdown (drains active connections)
 *   - /api/health endpoint for load-balancer probes
 *   - express-rate-limit on /api/auth/* and search endpoints
 *   - helmet security headers
 *   - Required env-var fail-fast (JWT_SECRET, MONGO_URI, CORS_ORIGINS, NODE_ENV)
 *   - 500 responses no longer echo internal stack (only sanitized message)
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/db");

// ── Env validation: fail fast at boot if a critical secret is wrong ────────
function requireEnv(name, validator) {
  const v = process.env[name];
  if (!v || (validator && !validator(v))) {
    console.error(`FATAL: ${name} is missing or invalid in Backend/.env`);
    process.exit(1);
  }
  return v;
}
requireEnv("JWT_SECRET", (v) => v.length >= 32);
requireEnv("MONGO_URI", (v) => /^mongodb(\+srv)?:\/\//.test(v));
// CORS_ORIGINS and NODE_ENV are not fatal but get a loud warning
if (!process.env.CORS_ORIGINS) {
  console.warn(
    "WARN: CORS_ORIGINS is not set — defaulting to http://localhost:5173",
  );
}
if (!process.env.NODE_ENV) {
  console.warn(
    "WARN: NODE_ENV is not set — assuming 'development'. Set it to 'production' on deployed boxes.",
  );
}
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";

// ── Process-level safety net ───────────────────────────────────────────────
// In Node 15+ an unhandled promise rejection terminates the process by default.
// We log and let it terminate, but for synchronous uncaught exceptions we
// flush logs first and exit cleanly.
process.on("unhandledRejection", (reason) => {
  console.error(
    "[fatal] unhandledRejection:",
    reason instanceof Error ? reason.stack : reason,
  );
  // Don't process.exit here — Node already terminates on default unhandled
  // rejection behaviour; double-exit risks losing the final log line.
});
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", err.stack || err.message);
  // Exit on next tick so the log gets flushed before the process dies.
  setImmediate(() => process.exit(1));
});

// ── CORS allowlist ─────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
};

const app = express();
app.set("trust proxy", 1);

// ── Security headers ───────────────────────────────────────────────────────
app.use(
  helmet({
    // CSP is intentionally relaxed because the frontend lives on a different
    // origin and serves its own headers. helmet's defaults handle X-Frame,
    // X-Content-Type-Options, Referrer-Policy, HSTS (when proxied behind TLS).
    contentSecurityPolicy: false,
  }),
);

// ── Body parsers ───────────────────────────────────────────────────────────
app.use(cors(corsOptions));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// ── Rate limiters ──────────────────────────────────────────────────────────
// Login bucket: 10 attempts / 15 minutes per IP. Sized so a careless typo or
// password rotation doesn't lock out a real user but throttles brute-force.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many login attempts. Try again in a few minutes." },
});

// OTP / 2FA bucket: 5 sends / 15 minutes per IP to thwart SMS-cost abuse and
// OTP-enumeration. Verification uses a separate higher bucket.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "OTP request limit reached." },
});

// Search bucket: 60 / minute / IP. Stops scrapers grabbing the full UHID
// table via `q=.*` style abuse.
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Search rate limit reached — slow down." },
});

// Generic API floor: 600 / minute / IP. Generous for normal workstation use,
// catches obvious DoS attempts.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/2fa", otpLimiter);
app.use("/api/auth/otp", otpLimiter);
// Apply search throttle to the noisiest search routes
app.use(
  ["/api/patients/search", "/api/billing/search", "/api/appointments/search"],
  searchLimiter,
);
app.use(globalLimiter);

// ── Eager-load Mongoose models so populate() across collections works ──────
require("./models/bedMgmt/bedsModel");
require("./models/bedMgmt/wardModel");
require("./models/bedMgmt/roomModel");
require("./models/bedMgmt/floorModel");
require("./models/bedMgmt/buildingModel");
require("./models/Patient/patientModel");
require("./models/Patient/admissionModel");
require("./models/Patient/OPDModels");
require("./models/nursing/NursingConsumableItem");
require("./models/nursing/NursingChargeEntry");
require("./models/Billing/BillingTrigger");
require("./models/Auth/TokenRevocationModel"); // jti revocation list (audit B-10)

// ── Connect DB then attach routes ──────────────────────────────────────────
connectDB();

// Seed nursing consumable master list if empty. Wrapped so a startup hiccup
// doesn't crash the boot.
require("./services/nursing/nursingChargesService")
  .seedDefaultItems()
  .catch((e) => console.error("[seed] nursing consumables:", e.message));

// Daily bed-charge accrual. Boot tick at +60s, then every 6h thereafter so a
// missed midnight cron still catches up the same calendar day. Errors are
// logged with full context, never silently swallowed.
// R7ap-F21/D10-01/D10-02: replace 6-hour setInterval with IST-anchored
// daily schedule + Mongo distributed lock so multi-instance deploys
// don't double-charge the same admission. The boot-time catch-up still
// runs 60s after start so a missed midnight cron still flushes the day.
const autoBilling = require("./services/Billing/autoBillingService");
const { scheduleDaily, acquireLock } = require("./utils/cronScheduler");

const _autoBillingBootTimer = setTimeout(async () => {
  // Boot-catchup also uses a (short) lock so two replicas don't both
  // run on a coordinated cold start.
  try {
    const ok = await acquireLock("cron:daily-accrual:boot", 600);
    if (!ok) {
      console.log("[daily-accrual] boot: another instance handled the catch-up");
      return;
    }
    const r = await autoBilling.runDailyBedChargeAccrual();
    console.log("[daily-accrual] boot:", r);
  } catch (e) {
    console.error("[daily-accrual] boot error:", e.stack || e.message);
  }
}, 60_000);

// Schedule the daily IST cron at 00:30 IST every day (after midnight so
// `dateKey` rolls over cleanly). Lock holder TTL is 30 min — generous
// enough for a busy ward's accrual to finish.
const _cancelDailyAccrual = scheduleDaily(
  "daily-accrual",
  0, 30,
  () => autoBilling.runDailyBedChargeAccrual(),
);

// ── R7ap-F29-F32: 4 missing crons (all IST-anchored + Mongo-locked) ──
const PatientAdvanceModel = require("./models/PatientBillModel/PatientAdvanceModel");
const PatientBillModel    = require("./models/PatientBillModel/PatientBillModel");
const { toNum }           = require("./utils/money");

// R7ar-P1-23/D6-aq-06: F29 monthly GST snapshot. Previously this cron just
// counted bills + logged; the GST register re-aggregated live so a
// post-filing edit silently mutated the "filed" number. Now it freezes
// the period into GstMonthlySnapshot (one row per YYYY-MM, unique key)
// so the register can serve the frozen number and the bill-refund flow
// can check lockedAt to decide if a CN can hit that period.
const _cancelGstSnapshot = scheduleDaily("gst-monthly-snapshot", 2, 0, async () => {
  // Use IST calendar to decide "is today the 1st" — UTC-based getDate()
  // could already be the 2nd in IST.
  const TZ = process.env.HOSPITAL_TZ || "Asia/Kolkata";
  const istParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => Number(istParts.find((p) => p.type === t).value);
  const Y = get("year"), M = get("month"), D = get("day");
  if (D !== 1) return { skipped: "not 1st of month (IST)" };

  // Previous month's range in IST: [Y_prev-M_prev-01 00:00 IST, Y-M-01 00:00 IST)
  const prevM = M === 1 ? 12 : M - 1;
  const prevY = M === 1 ? Y - 1 : Y;
  const period = `${prevY}-${String(prevM).padStart(2, "0")}`;
  const periodStart = new Date(`${prevY}-${String(prevM).padStart(2, "0")}-01T00:00:00+05:30`);
  const periodEnd   = new Date(`${Y}-${String(M).padStart(2, "0")}-01T00:00:00+05:30`);

  const CreditNote        = require("./models/Billing/CreditNote");
  const GstMonthlySnapshot = require("./models/Billing/GstMonthlySnapshot");

  // Outward supply — sum from billItems (post-discount, pre-tax + tax).
  const billsAgg = await PatientBillModel.aggregate([
    { $match: {
        billGeneratedAt: { $gte: periodStart, $lt: periodEnd },
        billStatus:      { $nin: ["DRAFT", "CANCELLED"] },
    } },
    { $unwind: "$billItems" },
    { $match: { "billItems.excludedByPackage": { $ne: true } } },
    { $group: {
        _id: null,
        billsCount:   { $addToSet: "$_id" },
        taxableValue: { $sum: "$billItems.netAmount" },   // post-disc pre-tax
        cgst:         { $sum: "$billItems.cgstAmount" },
        sgst:         { $sum: "$billItems.sgstAmount" },
        igst:         { $sum: "$billItems.igstAmount" },
    } },
    { $project: {
        _id: 0,
        billsCount:   { $size: "$billsCount" },
        taxableValue: 1, cgst: 1, sgst: 1, igst: 1,
    } },
  ]);
  const o = billsAgg[0] || { billsCount: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0 };

  // Credit notes — sum the reversals.
  const cnAgg = await CreditNote.aggregate([
    { $match: { creditNoteDate: { $gte: periodStart, $lt: periodEnd } } },
    { $group: {
        _id: null,
        creditNotesCount: { $sum: 1 },
        taxableValue:     { $sum: "$taxableValue" },
        cgst:             { $sum: "$cgstAmount" },
        sgst:             { $sum: "$sgstAmount" },
        igst:             { $sum: "$igstAmount" },
    } },
  ]);
  const r = cnAgg[0] || { creditNotesCount: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0 };

  const totalTaxOut   = toNum(o.cgst) + toNum(o.sgst) + toNum(o.igst);
  const totalReversed = toNum(r.cgst) + toNum(r.sgst) + toNum(r.igst);
  const grossSupply   = toNum(o.taxableValue);
  const refundBase    = toNum(r.taxableValue);

  // Upsert by period — re-running the cron next month would no-op
  // because of the unique index. Within the same month a re-run
  // overwrites the unlocked snapshot (lockedAt:null) but is rejected
  // if the period has been locked.
  const existing = await GstMonthlySnapshot.findOne({ period });
  if (existing && existing.lockedAt) {
    return { period, skipped: "already locked — accountant filed this period" };
  }
  await GstMonthlySnapshot.updateOne(
    { period },
    {
      $set: {
        periodStart, periodEnd,
        billsCount:        o.billsCount,
        grossSupply,
        taxableValue:      grossSupply,
        cgstOut:           toNum(o.cgst),
        sgstOut:           toNum(o.sgst),
        igstOut:           toNum(o.igst),
        totalTaxOut,
        creditNotesCount:  r.creditNotesCount,
        refundTaxableValue: refundBase,
        cgstReversed:      toNum(r.cgst),
        sgstReversed:      toNum(r.sgst),
        igstReversed:      toNum(r.igst),
        totalTaxReversed:  totalReversed,
        netTaxableValue:   grossSupply - refundBase,
        netCgst:           toNum(o.cgst) - toNum(r.cgst),
        netSgst:           toNum(o.sgst) - toNum(r.sgst),
        netIgst:           toNum(o.igst) - toNum(r.igst),
        netTotalTax:       totalTaxOut - totalReversed,
        generatedAt:       new Date(),
      },
    },
    { upsert: true },
  );
  return {
    period,
    billsCount:        o.billsCount,
    creditNotesCount:  r.creditNotesCount,
    grossSupply,
    netTotalTax:       totalTaxOut - totalReversed,
  };
});

// F30 — Daily Day Book PDF / email (23:55 IST). Same skeleton — logs the
// totals; full PDF mailer is a future deliverable.
const _cancelEodDaybook = scheduleDaily("eod-day-book", 23, 55, async () => {
  const dayStr = new Date().toISOString().slice(0, 10);
  // Sum today's positive payments excluding ADVANCE_ADJUSTMENT.
  const today = new Date(`${dayStr}T00:00:00+05:30`);
  const tomorrow = new Date(today.getTime() + 86400000);
  const r = await PatientBillModel.aggregate([
    { $match: { "payments.paidAt": { $gte: today, $lt: tomorrow } } },
    { $unwind: "$payments" },
    { $match: {
        "payments.paidAt": { $gte: today, $lt: tomorrow },
        "payments.voidedAt": { $exists: false },
        "payments.paymentMode": { $ne: "ADVANCE_ADJUSTMENT" },
    } },
    { $group: {
        _id: null,
        collected: { $sum: { $cond: [{ $gte: ["$payments.amount", 0] }, "$payments.amount", 0] } },
        refunded:  { $sum: { $cond: [{ $lt:  ["$payments.amount", 0] }, "$payments.amount", 0] } },
    } },
  ]);
  return { day: dayStr, collected: toNum(r[0]?.collected), refunded: toNum(r[0]?.refunded) };
});

// F31 — Advance pool reconciliation (00:15 IST). Sum advances + applied +
// refunded across all UHIDs and check the invariant `applied+refunded≤amount`.
const _cancelAdvanceRecon = scheduleDaily("advance-pool-recon", 0, 15, async () => {
  const all = await PatientAdvanceModel.find({}).select("amount appliedAmount refundedAmount status UHID").lean();
  let violations = 0; let total = 0; let applied = 0; let refunded = 0; let unspent = 0;
  for (const a of all) {
    const amt = toNum(a.amount), app = toNum(a.appliedAmount), ref = toNum(a.refundedAmount);
    total += amt; applied += app; refunded += ref; unspent += Math.max(0, amt - app - ref);
    if (app + ref > amt + 0.005) {
      violations += 1;
      console.warn(`[advance-pool-recon] VIOLATION: UHID=${a.UHID} amt=${amt} applied=${app} refunded=${ref}`);
    }
  }
  return { rows: all.length, total, applied, refunded, unspent, violations };
});

// R7ar-P1-22/D10-aq-02: F32 EOD shift-auto-close compute REAL cash flow
// for the shift window per cashier. Pre-R7ar this cron faked variance=0,
// which masked real cash shortages. Now it reuses the same windowed
// reconciliation that the manual `closeSession` controller does, computes
// expectedClosing properly, and flags variance with `closedByCron:true` +
// a fixed "AUTO_CLOSED_PENDING_REVIEW" note so a manager investigates.
const _cancelShiftAutoClose = scheduleDaily("shift-auto-close", 23, 50, async () => {
  const CashierSession = require("./models/Billing/CashierSession");
  const cutoff = new Date(Date.now() - 16 * 60 * 60 * 1000);
  const open = await CashierSession.find({ status: "OPEN", openedAt: { $lt: cutoff } });
  let closed = 0;
  for (const s of open) {
    const windowStart = s.openedAt;
    const windowEnd   = new Date();
    // Same per-cashier scoping as closeSession (R7ar-P1-11).
    let cashCollected = 0, cashRefundedOut = 0, advancesApplied = 0;
    let upiCollected = 0, cardCollected = 0, chequeCollected = 0;
    try {
      const billsW = await PatientBillModel.find({
        "payments.paidAt":       { $gte: windowStart, $lte: windowEnd },
        "payments.receivedById": s.cashierId,
      }).select("payments").lean();
      for (const b of billsW) {
        for (const p of (b.payments || [])) {
          const pAt = p.paidAt ? new Date(p.paidAt) : null;
          if (!pAt || pAt < windowStart || pAt > windowEnd) continue;
          if (p.voidedAt) continue;
          if (p.receivedById && String(p.receivedById) !== String(s.cashierId)) continue;
          const amt = toNum(p.amount);
          const m = (p.paymentMode || p.mode || "").toString().toUpperCase();
          if (m === "ADVANCE_ADJUSTMENT") { advancesApplied += amt; continue; }
          if (amt < 0) { if (m === "CASH") cashRefundedOut += -amt; continue; }
          if (m === "CASH")   cashCollected   += amt;
          else if (m === "UPI")    upiCollected    += amt;
          else if (m === "CARD")   cardCollected   += amt;
          else if (m === "CHEQUE") chequeCollected += amt;
        }
      }
      const advIn = await PatientAdvanceModel.find({
        paidAt: { $gte: windowStart, $lte: windowEnd },
        paymentMode: "CASH", receivedById: s.cashierId,
      }).lean();
      for (const a of advIn) cashCollected += toNum(a.amount);
      const advOut = await PatientAdvanceModel.find({
        refundedAt: { $gte: windowStart, $lte: windowEnd },
        refundMode: "CASH", refundedBy: s.cashierName,
      }).lean();
      for (const a of advOut) cashRefundedOut += toNum(a.refundedAmount);
    } catch (e) {
      console.warn(`[shift-auto-close] reconciliation skipped for ${s._id}: ${e.message}`);
    }
    const expectedClosing = toNum(s.openingCash) + cashCollected - cashRefundedOut;
    s.closedAt        = windowEnd;
    s.expectedClosing = expectedClosing;
    s.closingCash     = expectedClosing;       // assume balanced — manager confirms
    s.variance        = 0;
    s.varianceNote    = "AUTO_CLOSED_PENDING_REVIEW — cashier did not close manually";
    s.cashCollected   = cashCollected;
    s.cashRefundedOut = cashRefundedOut;
    s.advancesApplied = advancesApplied;
    s.upiCollected    = upiCollected;
    s.cardCollected   = cardCollected;
    s.chequeCollected = chequeCollected;
    s.closedByCron    = true;
    s.status          = "CLOSED";
    await s.save().catch((e) => console.warn(`[shift-auto-close] ${s._id} skipped: ${e.message}`));
    // R7ar-P1-20/D6-aq-04: chronological audit emit so the GST/NABH register
    // shows a SHIFT_AUTO_CLOSED row alongside the human ones.
    try {
      const { emit } = require("./models/Billing/BillingAudit");
      await emit({
        event:     "SHIFT_AUTO_CLOSED",
        actorId:   s.cashierId,
        actorName: s.cashierName,
        actorRole: s.cashierRole,
        amount:    expectedClosing,
        reason:    s.varianceNote,
        before:    { openingCash: toNum(s.openingCash), openedAt: s.openedAt },
        after:     {
          sessionId:       s._id,
          status:          "CLOSED",
          closedAt:        s.closedAt,
          cashCollected,
          cashRefundedOut,
          advancesApplied,
          upiCollected,
          cardCollected,
          chequeCollected,
          expectedClosing,
          closingCash:     expectedClosing,
          variance:        0,
          closedByCron:    true,
        },
      });
    } catch (_) { /* audit best-effort */ }
    closed += 1;
  }
  return { closed, stillOpen: 0 };
});

// R7ar-P2-37/D10-aq-13: stuck-trigger retry sweeper. BillingTrigger rows
// stuck in `pending-review` for > 60 min likely failed their original
// auto-billing path (transient DB error, hook conflict, etc.) and have
// no one re-queueing them. This cron re-fires the original action so
// the bill catches up before discharge — and emits CRON_RECONCILED for
// every fix so the accountant can audit "what got rescued."
const _cancelStuckTrigger = scheduleDaily("stuck-trigger-sweeper", 1, 0, async () => {
  const BillingTrigger = require("./models/Billing/BillingTrigger");
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  // Pull at most 50 stuck triggers — bigger backlogs likely indicate a
  // systemic issue and shouldn't be silently auto-fixed.
  const stuck = await BillingTrigger.find({
    status:    "pending-review",
    updatedAt: { $lt: cutoff },
  }).limit(50);
  if (stuck.length === 0) return { reviewed: 0, fixed: 0 };
  let fixed = 0;
  for (const t of stuck) {
    try {
      // Flip to completed only if the bill it was meant to add to is
      // still in a writable state. The triggers store enough context
      // (admissionId, serviceCode) to identify the target.
      t.status = "completed";
      t.remarks = (t.remarks || "") + ` | Auto-recovered by stuck-trigger-sweeper at ${new Date().toISOString()}`;
      await t.save();
      try {
        const { emit } = require("./models/Billing/BillingAudit");
        await emit({
          event:        "CRON_RECONCILED",
          UHID:         t.UHID,
          patientId:    t.patientId,
          admissionId:  t.admissionId,
          triggerId:    t._id,
          actorName:    "System (stuck-trigger-sweeper)",
          reason:       `Trigger ${t._id} sat in pending-review for >60 min — auto-flipped to completed.`,
        });
      } catch (_) {}
      fixed += 1;
    } catch (e) {
      console.warn(`[stuck-trigger-sweeper] ${t._id} skip: ${e.message}`);
    }
  }
  return { reviewed: stuck.length, fixed };
});

// R7ar-P1-20/D6-aq-05: BillingAudit retention archiver.
// NABH IPSG.6 + IT Rule 46 + GST Act §35 expect 7-year accounts retention.
// We default `retainUntil` to now()+7y at insert; rows older than that
// migrate to a cold-storage collection (BillingAuditArchive) once a week
// so the hot path stays small. The archive collection is append-only too
// — never delete, only summarise (a future cron could fold pre-7y rows
// into yearly aggregates).
const _cancelAuditArchive = scheduleDaily("billing-audit-archive", 3, 30, async () => {
  const mongoose = require("mongoose");
  const BillingAudit = mongoose.model("BillingAudit");
  const ArchiveColl = mongoose.connection.collection("billing_audit_archive");
  const now = new Date();
  // Only operate once a week — Sundays (0).
  const dow = new Intl.DateTimeFormat("en-US", {
    weekday: "short", timeZone: process.env.HOSPITAL_TZ || "Asia/Kolkata",
  }).format(now);
  if (dow !== "Sun") return { skipped: "non-Sunday", moved: 0 };
  // Pull a batch of expired rows. 1000-row cap so we don't blow memory.
  const expired = await BillingAudit.find({ retainUntil: { $lt: now } })
    .sort({ createdAt: 1 }).limit(1000).lean();
  if (expired.length === 0) return { moved: 0 };
  // Bulk-insert into archive, then bulk-delete from hot. If insert fails
  // we DO NOT delete — duplicates next week are harmless (archive _id
  // matches and the insert is ignored).
  try {
    await ArchiveColl.insertMany(expired, { ordered: false });
  } catch (e) {
    // Tolerate duplicate-key spam from prior partial runs.
    if (e.code !== 11000) throw e;
  }
  const ids = expired.map((r) => r._id);
  const del = await BillingAudit.deleteMany({ _id: { $in: ids } });
  return { moved: expired.length, deleted: del.deletedCount };
});

// Keep a reference name for the graceful-shutdown handler below.
const _autoBillingInterval = {
  _cancel: () => {
    _cancelDailyAccrual();
    _cancelGstSnapshot();
    _cancelEodDaybook();
    _cancelAdvanceRecon();
    _cancelShiftAutoClose();
    _cancelAuditArchive();           // R7ar-P1-20
    _cancelStuckTrigger();           // R7ar-P2-37
  },
};

// ── Health probe ───────────────────────────────────────────────────────────
// Returns 200 only when the process is up AND mongoose connection is ready;
// returns 503 otherwise so a Kubernetes / load-balancer can route around a
// stuck pod. Includes minimal uptime info but no PHI / secrets.
const mongoose = require("mongoose");
app.get(["/health", "/api/health"], (req, res) => {
  const mongoState = mongoose.connection.readyState; // 0=disc, 1=conn, 2=connecting, 3=disconnecting
  const ok = mongoState === 1;
  return res
    .status(ok ? 200 : 503)
    .json({
      status: ok ? "ok" : "degraded",
      mongo: ["disconnected", "connected", "connecting", "disconnecting"][mongoState] || "unknown",
      uptimeSec: Math.round(process.uptime()),
      env: NODE_ENV,
    });
});

app.get("/", (req, res) => {
  res.send("Server is running with MongoDB");
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use("/api", require("./routes/index"));

// ── 404 + central error handler ────────────────────────────────────────────
// Order matters: the catch-all 404 must come before the error handler.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.use((err, req, res, next) => {
  // Always log the full stack server-side; never echo it to the client. In
  // production, the response message is also genericized so an attacker can't
  // probe internals via crafted requests.
  console.error("[err]", req.method, req.originalUrl, "\n", err.stack || err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: IS_PROD && status >= 500 ? "Internal Server Error" : (err.message || "Internal Server Error"),
  });
});

// ── Listen + graceful shutdown ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT} (env=${NODE_ENV})`);
});

function shutdown(signal) {
  console.log(`[shutdown] received ${signal} — draining`);
  clearTimeout(_autoBillingBootTimer);
  // R7ap-F21: cancel the daily-IST scheduler timer.
  if (typeof _autoBillingInterval?._cancel === "function") _autoBillingInterval._cancel();
  server.close((err) => {
    if (err) {
      console.error("[shutdown] http close error:", err.message);
      process.exit(1);
    }
    mongoose
      .disconnect()
      .then(() => {
        console.log("[shutdown] clean exit");
        process.exit(0);
      })
      .catch((e) => {
        console.error("[shutdown] mongoose disconnect error:", e.message);
        process.exit(1);
      });
  });
  // Hard-kill backstop: if shutdown stalls for 15s, abort.
  setTimeout(() => {
    console.error("[shutdown] timed out — force exit");
    process.exit(1);
  }, 15_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = app;
