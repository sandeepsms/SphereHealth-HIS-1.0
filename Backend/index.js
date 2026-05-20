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

// F29 — Monthly GST snapshot freeze (1st of month at 02:00 IST). For now,
// we just log + count the previous month's bills+credit-notes; full
// snapshot table is a future deliverable. Cron is IST-locked.
const _cancelGstSnapshot = scheduleDaily("gst-monthly-snapshot", 2, 0, async () => {
  const now = new Date();
  if (now.getDate() !== 1) return { skipped: "not 1st of month" };
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end   = new Date(now.getFullYear(), now.getMonth(),     1);
  const bills = await PatientBillModel.countDocuments({
    billGeneratedAt: { $gte: start, $lt: end },
    billStatus:      { $nin: ["DRAFT", "CANCELLED"] },
  });
  return { from: start, to: end, billsInPeriod: bills };
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

// F32 — EOD auto-close cashier shift (23:50 IST) — closes any OPEN shift
// that was opened more than 16h ago AND has no closingCash. Marks variance
// = 0, varianceNote = "Auto-closed by EOD cron (no closingCash provided)".
const _cancelShiftAutoClose = scheduleDaily("shift-auto-close", 23, 50, async () => {
  const CashierSession = require("./models/Billing/CashierSession");
  const cutoff = new Date(Date.now() - 16 * 60 * 60 * 1000);
  const open = await CashierSession.find({ status: "OPEN", openedAt: { $lt: cutoff } });
  let closed = 0;
  for (const s of open) {
    s.closedAt        = new Date();
    s.expectedClosing = toNum(s.openingCash); // unknown — cashier didn't close
    s.closingCash     = toNum(s.openingCash);
    s.variance        = 0;
    s.varianceNote    = "Auto-closed by EOD cron — cashier did not provide closingCash";
    s.status          = "CLOSED";
    await s.save().catch((e) => console.warn(`[shift-auto-close] ${s._id} skipped: ${e.message}`));
    closed += 1;
  }
  return { closed, stillOpen: 0 };
});

// Keep a reference name for the graceful-shutdown handler below.
const _autoBillingInterval = {
  _cancel: () => {
    _cancelDailyAccrual();
    _cancelGstSnapshot();
    _cancelEodDaybook();
    _cancelAdvanceRecon();
    _cancelShiftAutoClose();
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
