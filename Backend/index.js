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
// R7au-FIX-13/D3-HIGH: the actual 2FA mount in routes/index.js:166 is
// `/api/2fa` (no /auth prefix), so the limiter above only protected
// the never-mounted /api/auth/2fa path. SMS-cost abuse + OTP
// enumeration were possible. Now both prefixes are throttled.
app.use("/api/2fa",      otpLimiter);
// Apply search throttle to the noisiest search routes
app.use(
  ["/api/patients/search", "/api/billing/search", "/api/appointments/search"],
  searchLimiter,
);
app.use(globalLimiter);

// R7av-FIX-14/D2-MED-3 + R7bj-F10/5-HIGH-2: Cache-Control on PHI endpoints.
// Pre-R7av no PHI route emitted Cache-Control headers — shared proxy /
// browser-back could leak patient data. We blanket every PHI path with
// `no-store, private` so intermediaries don't cache and a logout
// browser-back can't replay the page.
//
// R7bj-F10 extends the list per R7bi-5-HIGH-2 — visitor-pass, gate-log,
// dietitian patient plans, ward tasks, housekeeping ops, incidents,
// physio session (R7bj-F1), kitchen indent + adverse food reactions
// (R7bj-F2) all leak PHI (UHID, name, photo) on cached responses if a
// shared workstation's browser-back is used after logout.
app.use([
  // Core PHI surfaces (R7av).
  "/api/patients", "/api/billing", "/api/admissions",
  "/api/mar", "/api/doctor-orders", "/api/doctor-notes", "/api/nursing-notes",
  "/api/mlc", "/api/vitals", "/api/discharge", "/api/patient-file",
  "/api/cashier-sessions", "/api/auth/me", "/api/auth/signature",
  // R7bj-F10 / R7bi-5-HIGH-2 — new PHI paths.
  "/api/visitor-passes",
  "/api/gate-log",
  "/api/dietitian/patient",
  "/api/ward-tasks",
  "/api/housekeeping",
  "/api/incidents",
  // R7bj-F1 — physio plan / session (PHI: diagnosis + therapy notes)
  "/api/physio",
  // R7bj-F2 — kitchen indent + food reactions (PHI: per-patient diet card)
  "/api/kitchen-indent",
  "/api/food-reactions",
  // R7bm-F2 / R7bl-5-HIGH-1 — additional PHI / regulated surfaces.
  "/api/cold-chain",
  "/api/bmw-manifest",
  "/api/code-response",
  "/api/sharps-injury",
  "/api/tax-returns",
  "/api/tds",
], (req, res, next) => {
  res.set("Cache-Control", "no-store, private");
  next();
});

// ── Eager-load Mongoose models so populate() across collections works ──────
// R7bh-F3 / R7bg-1-CRIT-8: Hospital MUST be registered before any controller
// that does `populate("hospitalId")` is loaded. Six R7bf-G schemas
// (PrintAudit, CriticalValueAlert, ADRReport, Grievance, Credential,
// FireDrill) ref "Hospital" — without an eager require the first
// populate() call throws MissingSchemaError. Registered first in this
// block on purpose so any later require chain inherits the registration.
require("./models/HospitalModel");
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
// R7bh-F6: Tax models eager-load so /api/tax-returns + /api/tds
// controllers can resolve refs at first request.
require("./models/Tax/GstReturnSnapshotModel");
require("./models/Tax/TdsCertificateModel");

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
const { scheduleDaily, acquireLock, releaseLock } = require("./utils/cronScheduler");

// R7at-FIX-1/D10-HIGH-1+2: boot-catchup now uses the SAME lock name as
// the daily cron (`cron:daily-accrual`, not the divergent `:boot`
// variant) so a cold-start crossing 00:30 IST doesn't race the
// scheduled tick. Lock is also explicitly released in `finally` so a
// successful boot-catchup doesn't sit on the lock for the full 600s
// TTL — pre-R7at a manual operator re-trigger within 10 min was blocked.
const _autoBillingBootTimer = setTimeout(async () => {
  const _BOOT_LOCK = "cron:daily-accrual";
  let acquired = false;
  try {
    acquired = await acquireLock(_BOOT_LOCK, 600);
    if (!acquired) {
      console.log("[daily-accrual] boot: another instance handled the catch-up");
      return;
    }
    const r = await autoBilling.runDailyBedChargeAccrual();
    console.log("[daily-accrual] boot:", r);
  } catch (e) {
    console.error("[daily-accrual] boot error:", e.stack || e.message);
  } finally {
    if (acquired) {
      try { await releaseLock(_BOOT_LOCK); } catch (_) { /* best-effort */ }
    }
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

  // R7bf-H / A6-CRIT-1: outward supply now includes BOTH hospital service
  // GST (PatientBill.billItems) AND pharmacy GST (PharmacySale.items).
  // Pre-R7bf the snapshot under-reported by ~30-40% of turnover (the
  // entire pharmacy slice) — every monthly GSTR-1 filed was missing
  // pharmacy sales. The aggregateGSTForMonth helper $unionWith-merges the
  // two streams so this cron and the live register read the same number.
  const gst = require("./services/Reports/gstService");
  const combined = await gst.aggregateGSTForMonth(periodStart, periodEnd);
  // bill count is still hospital-only — GSTR-1 line 4A counts INVOICES,
  // not items. Pharmacy invoice count tracked separately via bySource.
  const hospitalBillsCountAgg = await PatientBillModel.aggregate([
    { $match: {
        billGeneratedAt: { $gte: periodStart, $lt: periodEnd },
        billStatus:      { $nin: ["DRAFT", "CANCELLED"] },
    } },
    { $count: "n" },
  ]);
  const PharmacySaleModel = require("./models/Pharmacy/PharmacySaleModel");
  const pharmacyBillsCountAgg = await PharmacySaleModel.aggregate([
    { $match: {
        createdAt: { $gte: periodStart, $lt: periodEnd },
        status:    { $nin: ["Cancelled"] },
    } },
    { $count: "n" },
  ]);
  const o = {
    billsCount:      (hospitalBillsCountAgg[0]?.n || 0) + (pharmacyBillsCountAgg[0]?.n || 0),
    taxableValue:    combined.grossTotals.taxableValue,
    cgst:            combined.grossTotals.cgst,
    sgst:            combined.grossTotals.sgst,
    igst:            combined.grossTotals.igst,
  };

  // R7au-FIX-6/D6-CRIT-C4: GSTR-1 CDNR attribution. A CN reverses GST
  // against the ORIGINAL bill's tax period, not the CN's own date. If
  // the original bill is in period P and the CN was issued in period
  // P+1 (the normal case for a late refund), GSTR-1 wants the reversal
  // in P's outward supply (Schedule 9, CDNR section), not P+1's.
  //
  // Pre-R7au we matched `creditNoteDate ∈ [periodStart, periodEnd)`
  // which under-counted P's reversals whenever a CN was issued late.
  // Worse: a CN issued at 00:00-01:59 IST on day-1 of P+1 (before the
  // 02:00 IST cron fires) had creditNoteDate in P+1 but should reverse
  // P's tax — that's the 2-hour misattribution window agents flagged.
  //
  // Fix: join via originalBillNumber → PatientBill.billGeneratedAt
  // (immutable, set at DRAFT→GENERATED) so we attribute by the bill's
  // period regardless of when the CN was issued. The $lookup is
  // limited to CNs created in a wide outer window (period start to
  // now+1d) so we don't scan every CN ever.
  const cnAgg = await CreditNote.aggregate([
    { $match: { creditNoteDate: { $gte: periodStart, $lt: new Date() } } },
    { $lookup: {
        from: "patientbills",
        localField: "originalBillNumber",
        foreignField: "billNumber",
        as: "_bill",
        pipeline: [{ $project: { billGeneratedAt: 1 } }],
    } },
    { $addFields: {
        _attributionDate: {
          $ifNull: [{ $arrayElemAt: ["$_bill.billGeneratedAt", 0] }, "$creditNoteDate"],
        },
    } },
    { $match: { _attributionDate: { $gte: periodStart, $lt: periodEnd } } },
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
        // R7bf-H / A6-CRIT-1: persist hospital vs pharmacy split.
        bySource: {
          hospital: {
            taxableValue: combined.bySource.hospital.taxableValue,
            taxAmount:    combined.bySource.hospital.taxAmount,
            itemCount:    combined.bySource.hospital.itemCount,
          },
          pharmacy: {
            taxableValue: combined.bySource.pharmacy.taxableValue,
            taxAmount:    combined.bySource.pharmacy.taxAmount,
            itemCount:    combined.bySource.pharmacy.itemCount,
          },
        },
        generatedAt:       new Date(),
      },
    },
    { upsert: true },
  );
  // R7at-FIX-2/D10-HIGH-3: emit CRON_RECONCILED audit row so the GSTR-1
  // reconciliation feed shows "system froze period YYYY-MM at HH:MM IST".
  // Pre-R7at the snapshot freeze was invisible in the audit register —
  // NABH AAC.7 + GST §35 expect provenance for every period freeze.
  try {
    const { emit } = require("./models/Billing/BillingAudit");
    await emit({
      event:        "CRON_RECONCILED",
      actorName:    "System (gst-monthly-snapshot)",
      amount:       totalTaxOut - totalReversed,
      reason:       `GST period ${period} frozen — ${o.billsCount} bill(s), ${r.creditNotesCount} CN(s), net tax ₹${(totalTaxOut - totalReversed).toFixed(2)}`,
      after:        {
        period, periodStart, periodEnd,
        billsCount:       o.billsCount,
        creditNotesCount: r.creditNotesCount,
        grossSupply,
        netTotalTax:      totalTaxOut - totalReversed,
      },
    });
  } catch (e) {
    console.warn(`[gst-monthly-snapshot] audit emit failed: ${e.message}`);
  }
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
// R7at-FIX-3/D10-MED-1: dayStr now derived from IST calendar (not UTC).
// Pre-R7at `new Date().toISOString().slice(0,10)` returned the UTC date,
// which at 23:55 IST = 18:25 UTC same day still resolved correctly — but
// a DST/leap-second drift or a host with wrong clock could ship the cron
// off-by-one. Mirroring the GST cron's Intl approach removes the drift.
const _cancelEodDaybook = scheduleDaily("eod-day-book", 23, 55, async () => {
  const TZ = process.env.HOSPITAL_TZ || "Asia/Kolkata";
  const istParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const yy = istParts.find((p) => p.type === "year")?.value;
  const mm = istParts.find((p) => p.type === "month")?.value;
  const dd = istParts.find((p) => p.type === "day")?.value;
  const dayStr = `${yy}-${mm}-${dd}`;
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
//
// R7bf-J/A8-CRIT-3: cursor-based iteration. Pre-R7bf this loaded EVERY
// PatientAdvance into memory at once — at 5 k advances × 12 audit
// versions/row it spiked RSS to ~800 MB at 02:00 IST and OOM-killed the
// process. Now we stream via .cursor({ batchSize: 200 }) so the working
// set stays bounded regardless of collection size.
const _cancelAdvanceRecon = scheduleDaily("advance-pool-recon", 0, 15, async () => {
  let rows = 0, violations = 0, total = 0, applied = 0, refunded = 0, unspent = 0;
  const cursor = PatientAdvanceModel
    .find({})
    .select("amount appliedAmount refundedAmount status UHID")
    .lean()
    .cursor({ batchSize: 200 });
  for await (const a of cursor) {
    rows += 1;
    const amt = toNum(a.amount), app = toNum(a.appliedAmount), ref = toNum(a.refundedAmount);
    total += amt; applied += app; refunded += ref; unspent += Math.max(0, amt - app - ref);
    if (app + ref > amt + 0.005) {
      violations += 1;
      console.warn(`[advance-pool-recon] VIOLATION: UHID=${a.UHID} amt=${amt} applied=${app} refunded=${ref}`);
    }
  }
  return { rows, total, applied, refunded, unspent, violations };
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
    // R7at-FIX-4/D10-MED-2: do NOT force `closingCash = expectedClosing`
    // and `variance = 0`. Pre-R7at this masked real cash shortages — any
    // dashboard filtering on `variance != 0` would never see the row.
    // Now leave both NULL so the manager review queue can identify
    // un-verified auto-closes by `closedByCron:true` instead. The note
    // is explicit so an operator filtering on varianceNote contains
    // "UNVERIFIED" also catches the queue.
    s.closingCash     = null;
    s.variance        = null;
    s.varianceNote    = "UNVERIFIED — auto-closed by cron; cashier did not close manually. Manager must count drawer + reconcile.";
    s.cashCollected   = cashCollected;
    s.cashRefundedOut = cashRefundedOut;
    s.advancesApplied = advancesApplied;
    s.upiCollected    = upiCollected;
    s.cardCollected   = cardCollected;
    s.chequeCollected = chequeCollected;
    s.closedByCron    = true;
    s.status          = "CLOSED";
    // R7at-FIX-5/D10-LOW-1: track save success so we skip the audit emit
    // when save fails — pre-R7at a misleading "SHIFT_AUTO_CLOSED" row
    // landed even when the session was still OPEN.
    let _saved = true;
    await s.save().catch((e) => {
      _saved = false;
      console.warn(`[shift-auto-close] ${s._id} skipped: ${e.message}`);
    });
    if (!_saved) { continue; }
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

// R7ar-P2-37/D10-aq-13: stuck-trigger ALERT sweeper.
//
// R7as-FIX-2/D10-crit-1: pre-R7as this cron silently flipped pending-review
// → completed WITHOUT re-running the auto-billing path that should have
// created the bill line. Net effect was silent revenue leakage — the
// trigger looked "done" but no charge ever landed. The fix here is to
// keep the trigger in pending-review and emit a CRON_RECONCILED audit
// row so the operator dashboard / accountant report surfaces the stuck
// batch for human review. The trigger can then be re-fired through the
// normal autoBilling code-path with full validation, not from inside a
// cron that doesn't have the doctor/nurse context to retry safely.
const _cancelStuckTrigger = scheduleDaily("stuck-trigger-sweeper", 1, 0, async () => {
  const BillingTrigger = require("./models/Billing/BillingTrigger");
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  // Pull at most 50 stuck triggers — bigger backlogs likely indicate a
  // systemic issue that needs a human-in-the-loop investigation.
  const stuck = await BillingTrigger.find({
    status:    "pending-review",
    updatedAt: { $lt: cutoff },
  }).limit(50).select("_id UHID patientId admissionId serviceCode triggerType createdAt updatedAt remarks").lean();
  // R7aw-FIX-6/R7at-backlog: in addition to the pending-review backlog,
  // emit a one-line health view counting EVERY long-stuck row across
  // statuses so the operator sees at-a-glance whether the sweeper is
  // tackling a small flicker or a systemic outage. Light aggregation
  // (status-only count, cutoff filter) — single round-trip.
  let perStatus = {};
  let totalStuck = 0;
  try {
    const grouped = await BillingTrigger.aggregate([
      { $match: { updatedAt: { $lt: cutoff }, status: { $in: ["pending", "pending-review", "error", "skipped"] } } },
      { $group: { _id: "$status", c: { $sum: 1 } } },
    ]);
    grouped.forEach((g) => { perStatus[g._id] = g.c; totalStuck += g.c; });
  } catch (e) {
    // Health-summary aggregation is best-effort — the alert path still runs.
    console.warn(`[stuck-trigger-sweeper] health aggregation failed: ${e.message}`);
  }
  if (stuck.length === 0) return { alerted: 0, totalStuck, perStatus };
  // Single aggregated audit row — flooding the audit feed with N rows per
  // tick is noisy and the operator just needs the count + the worst case.
  try {
    const { emit } = require("./models/Billing/BillingAudit");
    const oldest = stuck.reduce((a, b) =>
      new Date(a.updatedAt) < new Date(b.updatedAt) ? a : b);
    await emit({
      event:        "CRON_RECONCILED",
      actorName:    "System (stuck-trigger-sweeper)",
      reason:       `${stuck.length} BillingTrigger row(s) stuck in pending-review > 60 min (totalStuck across statuses: ${totalStuck}). Oldest: trigger ${oldest._id} (admission ${oldest.admissionId}, code ${oldest.serviceCode}, last touched ${new Date(oldest.updatedAt).toISOString()}). Review via /billing-audit-trail.`,
      after:        {
        stuckCount:    stuck.length,
        totalStuck,                  // R7aw-FIX-6: at-a-glance health metric
        perStatus,                   // R7aw-FIX-6: per-status breakdown
        oldestTriggerId: oldest._id,
        oldestUpdatedAt: oldest.updatedAt,
        sampleTriggers:  stuck.slice(0, 5).map((t) => ({
          _id: t._id, admissionId: t.admissionId, code: t.serviceCode, type: t.triggerType,
        })),
      },
    });
  } catch (e) {
    console.warn(`[stuck-trigger-sweeper] audit emit failed: ${e.message}`);
  }
  return { alerted: stuck.length, totalStuck, perStatus };
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

// R7bd-E-3 / A2-MED-17: low-stock reorder notifier. Runs at 08:00 IST
// daily — early enough that procurement sees the list before the
// supplier desk closes. Reuses the same aggregation as
// pharmacyController.alerts.lowStock so the figures match the on-screen
// pharmacy dashboard. Notifier is a stub (logs + audit row) until real
// SMS/email/Slack wiring lands.
const _cancelReorderNotifier = scheduleDaily("reorder-notifier", 8, 0, async () => {
  try {
    const DrugBatchM = require("./models/Pharmacy/DrugBatchModel");
    const DrugM      = require("./models/Pharmacy/DrugModel");
    const reorder    = require("./services/Notification/reorderNotifier");

    const rollup = await DrugBatchM.aggregate([
      { $match: { isActive: true, remaining: { $gt: 0 } } },
      { $group: { _id: "$drugId", drugName: { $first: "$drugName" }, totalRemaining: { $sum: "$remaining" }, batchCount: { $sum: 1 } } },
      { $lookup: { from: "pharmacydrugs", localField: "_id", foreignField: "_id", as: "drug" } },
      { $unwind: { path: "$drug", preserveNullAndEmptyArrays: true } },
      { $match: { $expr: { $lt: ["$totalRemaining", { $ifNull: ["$drug.reorderLevel", 10] }] } } },
      { $project: { _id: 0, drugId: "$_id", drugName: { $ifNull: ["$drug.name", "$drugName"] },
                    totalRemaining: 1, batchCount: 1,
                    reorderLevel: { $ifNull: ["$drug.reorderLevel", 10] } } },
      { $sort: { totalRemaining: 1 } },
    ]);

    // Out-of-stock items have no batches at all — still surface them so
    // procurement knows to expedite the next purchase order.
    const zeroStock = await DrugM.find({ isActive: true }).lean();
    const stockDocs = await DrugBatchM.aggregate([
      { $match: { isActive: true, remaining: { $gt: 0 } } },
      { $group: { _id: "$drugId" } },
    ]);
    const stockedIds = new Set(stockDocs.map((s) => String(s._id)));
    const outOfStock = zeroStock
      .filter((d) => !stockedIds.has(String(d._id)))
      .map((d) => ({ drugId: d._id, drugName: d.name, totalRemaining: 0, batchCount: 0, reorderLevel: d.reorderLevel || 10 }));

    const items = [...rollup, ...outOfStock];
    const out = await reorder.notifyLowStock(items, []);
    return { items: items.length, sent: out.sent, channel: out.channel };
  } catch (e) {
    console.error("[reorder-notifier] cron error:", e.stack || e.message);
    return { error: e.message };
  }
});

// ── R7bf-G — NABH compliance crons (A5-CRIT-1 + A5-CRIT-6) ─────
//
// Two new background workers ship with this cycle:
//   • critical-value-alert escalator — every 5 min IST. Walks OPEN
//     CriticalValueAlert rows whose age has crossed slaMinutes and
//     flips them to ESCALATED so the on-duty team's UI bell flags
//     the breach. Uses setInterval + the existing Mongo distributed
//     lock (`cron:cv-alert-escalate`) so a multi-replica deploy
//     doesn't double-fire. NOT IST-anchored (5-min cadence drifts
//     trivially); lock TTL is 4 min so a peer can pick up promptly
//     if the holder dies.
//
//   • expire-credentials — daily at 02:00 IST. Flips any VERIFIED
//     Credential whose expiryDate has passed to EXPIRED. Idempotent
//     bulk updateMany — safe to re-run.
const _CRIT_ALERT_LOCK = "cron:cv-alert-escalate";
let _cvAlertInterval = null;
try {
  const criticalValueAlerter = require("./services/Notification/criticalValueAlerter");
  // First tick fires 2 min after boot to give the rest of the harness
  // time to settle; then every 5 min on the dot. Lock TTL 4 min — short
  // enough that a crashed holder doesn't block the next tick for long.
  _cvAlertInterval = setInterval(async () => {
    let acquired = false;
    try {
      acquired = await acquireLock(_CRIT_ALERT_LOCK, 4 * 60);
      if (!acquired) return;
      const r = await criticalValueAlerter.escalateOverdue();
      if (r && (r.escalated || 0) > 0) {
        console.log(`[cron:cv-alert-escalate] escalated ${r.escalated}/${r.scanned} open alerts`);
      }
    } catch (e) {
      console.error("[cron:cv-alert-escalate] error:", e.stack || e.message);
    } finally {
      if (acquired) { try { await releaseLock(_CRIT_ALERT_LOCK); } catch (_) {} }
    }
  }, 5 * 60_000);
  // Don't keep the event loop alive purely for this timer.
  if (typeof _cvAlertInterval.unref === "function") _cvAlertInterval.unref();
} catch (e) {
  console.error("[cron:cv-alert-escalate] failed to register:", e.message);
}

const _cancelExpireCredentials = scheduleDaily("expire-credentials", 2, 0, async () => {
  try {
    const ctrl = require("./controllers/HR/credentialController");
    const r = await ctrl.expireCredentials();
    return r;
  } catch (e) {
    console.error("[cron:expire-credentials] error:", e.stack || e.message);
    return { error: e.message };
  }
});

// R7bm-F8 / R7bl close-out — pre-expiry credential notifier. Runs daily
// at 09:00 IST (after the 02:00 expire-credentials flip but before the
// hospital day starts at scale). Sends graduated reminders at T-30 / T-7 /
// T-0 days so staff and HR see the expiry coming instead of getting
// blocked at the door at 09:30 because their IAP/NMC/FSSAI/BMW credential
// quietly ran out overnight. scheduleDaily wraps the call in the same
// distributed-lock so multi-replica deploys don't double-email.
const _cancelPreExpiryEmail = scheduleDaily("credential-pre-expiry-email", 9, 0, async () => {
  try {
    const cron = require("./jobs/preExpiryEmailCron");
    return await cron.runPreExpirySweep();
  } catch (e) {
    console.error("[cron:credential-pre-expiry-email] error:", e.stack || e.message);
    return { error: e.message };
  }
});

// ── R7bh-F6 — accountant regulatory + NABH workflow crons ────────
//
//   • grievance-sla-escalate — every hour. Flips OPEN/IN_PROGRESS
//     grievances past their slaHours window to ESCALATED. Uses the
//     same setInterval + distributed-lock pattern as the cv-alert
//     escalator so multi-replica deploys don't double-fire.
//     (NABH PRE.6.)
//   • fire-drill-overdue — daily @ 03:00 IST. Flips SCHEDULED drills
//     whose scheduledDate has passed to OVERDUE. (NABH FMS.4.)
//   • retention-review — daily @ 04:00 IST. Scans PatientBill /
//     DoctorNote / MAR / DischargeSummary / ConsentForm / Prescription
//     for documents older than the NABH IMS.3 retention floor. Writes
//     a summary row to BillingAudit; no auto-purge.
//
const _GRIEVANCE_SLA_LOCK = "cron:grievance-sla-escalate";
let _grievanceSlaInterval = null;
try {
  const grievanceSlaCron = require("./services/Quality/grievanceSlaCron");
  // Tick every 30 min (cadence requirement: hourly per spec but 30-min
  // ticks pick up SLA breaches faster while still being bounded). Lock
  // TTL 25 min so a stalled holder doesn't block the next tick for long.
  _grievanceSlaInterval = setInterval(async () => {
    let acquired = false;
    try {
      acquired = await acquireLock(_GRIEVANCE_SLA_LOCK, 25 * 60);
      if (!acquired) return;
      const r = await grievanceSlaCron.runSlaEscalation();
      if (r && (r.escalated || 0) > 0) {
        console.log(`[cron:grievance-sla-escalate] escalated ${r.escalated}/${r.scanned} open ticket(s)`);
      }
    } catch (e) {
      console.error("[cron:grievance-sla-escalate] error:", e.stack || e.message);
    } finally {
      if (acquired) { try { await releaseLock(_GRIEVANCE_SLA_LOCK); } catch (_) {} }
    }
  }, 30 * 60_000);
  if (typeof _grievanceSlaInterval.unref === "function") _grievanceSlaInterval.unref();
} catch (e) {
  console.error("[cron:grievance-sla-escalate] failed to register:", e.message);
}

const _cancelFireDrillOverdue = scheduleDaily("fire-drill-overdue", 3, 0, async () => {
  try {
    const cron = require("./services/Compliance/fireDrillOverdueCron");
    return await cron.runOverdueSweep();
  } catch (e) {
    console.error("[cron:fire-drill-overdue] error:", e.stack || e.message);
    return { error: e.message };
  }
});

const _cancelRetentionReview = scheduleDaily("retention-review", 4, 0, async () => {
  try {
    const svc = require("./services/MRD/retentionEnforcer");
    return await svc.runRetentionReview();
  } catch (e) {
    console.error("[cron:retention-review] error:", e.stack || e.message);
    return { error: e.message };
  }
});

// R7bj-F9 — visitor-pass expiry every 5 min (moves expensive updateMany off
// the visitorPassController hot path). Stale passes auto-flip Active → Expired
// with autoExpiredAt stamp. setInterval (not IST-anchored cron) — cadence-based.
const _cancelVisitorPassExpiry = (() => {
  const { expireStalePasses } = require("./services/Compliance/visitorPassExpiryCron");
  const interval = setInterval(() => { expireStalePasses().catch(() => {}); }, 5 * 60 * 1000);
  if (typeof interval.unref === "function") interval.unref();
  console.log("[cron:visitor-pass-expiry] armed — every 5 min");
  return () => clearInterval(interval);
})();

// R7bq-4 — hourly intake sweep for running IV infusions. Walks every
// active IV_Fluid order with infusionStarted set + infusionStopped
// unset, and writes one IntakeOutputEntry row per (orderId, hourBucket)
// using the doctor-ordered ml/hr rate. Idempotent via partial unique
// index on intake_output_entries, so a restart mid-hour can't duplicate
// rows. Stops automatically when totalVolume is reached.
const _cancelInfusionIntakeCron = (() => {
  const { arm } = require("./services/Clinical/infusionIntakeCron");
  return arm({ intervalMs: 60 * 60 * 1000 });
})();

// R7bq-J1 — daily missed-dose sweep. Every 15 min, finds AR slots
// with status="pending" whose scheduledDate is before today-midnight
// and flips them to "missed" so the order-completion check can flip
// the parent DoctorOrder InProgress → Completed once the course window
// closes. Pre-J1, a past-day pending slot blocked the lifecycle forever
// (NABH MOM.4 violation — "every dose must be accounted for").
const _cancelMissedDoseCron = (() => {
  const { arm } = require("./services/Clinical/missedDoseCron");
  return arm({ intervalMs: 15 * 60 * 1000 });
})();

// R7bn-5 / D6-fix — twice-daily assessment compliance sweeper. Every 15 min
// the sweeper flips status to OVERDUE / DUE_SOON for any assessment whose
// nextDueAt has slipped past now. Frontend reads these via the
// /api/compliance/assessment-status/:admissionId endpoint to render
// red OVERDUE badges on the Nursing/Doctor Notes header.
//
// R7bw — Boot seed + per-tick seed. Pre-R7bw the collection only grew
// when an assessment was actually saved, so freshly admitted patients
// (and the hospital on day 1 of running the cron) had zero rows. The
// seed pass walks every Active admission and upserts the EXPECTED_TUPLES
// so the OVERDUE flip can fire on the very first sweep.
const _cancelAssessmentComplianceSweeper = (() => {
  const { sweepOverdue, seedAllActiveAdmissions } = require("./services/Compliance/assessmentComplianceService");
  const tick = async () => {
    try {
      const seed = await seedAllActiveAdmissions();
      if (seed?.inserted) {
        console.log(`[cron:assessment-compliance] seeded ${seed.inserted} new rows across ${seed.admissions} active admissions`);
      }
      const r = await sweepOverdue();
      if (r?.overdue || r?.dueSoon) {
        console.log(`[cron:assessment-compliance] overdue+=${r.overdue} dueSoon+=${r.dueSoon}`);
      }
    } catch (e) {
      console.error("[cron:assessment-compliance] tick failed:", e?.message);
    }
  };
  // One-shot boot run (60s after start so mongoose connection is up) +
  // recurring 15-min cron.
  setTimeout(() => { tick(); }, 60 * 1000);
  const interval = setInterval(tick, 15 * 60 * 1000);
  if (typeof interval.unref === "function") interval.unref();
  console.log("[cron:assessment-compliance] armed — boot+60s, then every 15 min");
  return () => clearInterval(interval);
})();

// R7bx-2 — nightly mongodump backup. Runs at 02:30 IST every day with
// the same distributed lock pattern as every other daily cron so a
// multi-replica deploy doesn't double-write the same archive name. The
// child process is spawned by scripts/backupMongoDB.js — backup failures
// are logged but never crash the server (the script returns a structured
// error which the cron wrapper logs).
const _cancelNightlyMongoBackup = scheduleDaily("nightly-mongo-backup", 2, 30, async () => {
  try {
    const { runBackup } = require("./scripts/backupMongoDB");
    return await runBackup();
  } catch (e) {
    console.error("[cron:nightly-mongo-backup] error:", e.stack || e.message);
    return { error: e.message };
  }
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
    _cancelReorderNotifier();        // R7bd-E-3
    _cancelExpireCredentials();      // R7bf-G / A5-CRIT-6
    _cancelPreExpiryEmail();         // R7bm-F8 / R7bl close-out
    if (_cvAlertInterval) clearInterval(_cvAlertInterval); // R7bf-G / A5-CRIT-1
    // R7bh-F6 — new crons
    if (_grievanceSlaInterval) clearInterval(_grievanceSlaInterval);
    _cancelFireDrillOverdue();
    _cancelRetentionReview();
    _cancelVisitorPassExpiry();
    _cancelAssessmentComplianceSweeper();   // R7bn-5
    _cancelInfusionIntakeCron();            // R7bq-4
    _cancelMissedDoseCron();                // R7bq-J1
    _cancelNightlyMongoBackup();            // R7bx-2
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

// R7bx-3 — structured error logger. Mounted AFTER all routes but BEFORE
// the central 500 responder so every err that reaches the chain is
// captured to logs/errors-YYYY-MM-DD.log + console with PHI redaction.
// The middleware calls next(err) so the existing 500 responder still
// owns the response shape.
app.use(require("./middleware/errorLogger"));

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
// R7au-1: fallback port aligned with Frontend/src/config/api.js + .env. If
// PORT env var fails to load (process spawned without env, hot-reload glitch),
// Backend would listen on 5000 while Frontend hits 5050 → all API calls fail
// → recurrent-logout symptom. Keep both sides in lock-step on 5050.
const PORT = process.env.PORT || 5050;
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
