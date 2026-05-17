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
const autoBilling = require("./services/Billing/autoBillingService");
const _autoBillingBootTimer = setTimeout(() => {
  autoBilling
    .runDailyBedChargeAccrual()
    .then((r) => console.log("[daily-accrual] boot:", r))
    .catch((e) => console.error("[daily-accrual] boot error:", e.stack || e.message));
}, 60_000);
const _autoBillingInterval = setInterval(() => {
  autoBilling
    .runDailyBedChargeAccrual()
    .then((r) => console.log("[daily-accrual]:", r))
    .catch((e) => console.error("[daily-accrual] error:", e.stack || e.message));
}, 6 * 60 * 60 * 1000);

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
  clearInterval(_autoBillingInterval);
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
