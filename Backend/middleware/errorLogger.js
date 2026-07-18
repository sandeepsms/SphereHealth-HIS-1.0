// middleware/errorLogger.js
// ════════════════════════════════════════════════════════════════════
// R7bx-3 — Structured error-logger Express middleware.
//
// Catches every error that bubbles up to the central error handler
// (anything `next(err)`'d by a route/controller plus anything thrown
// inside an async controller wrapped by `express-async-errors` /
// Express 5's built-in async support) and writes:
//   • A JSON line to logs/errors-YYYY-MM-DD.log (rotated by date so
//     no single file balloons indefinitely).
//   • An identical line to stderr so the existing pm2 / systemd log
//     tail still sees it.
//
// PHI redaction: hospital data is regulated under NABH IPSG.6 +
// DPDPA — we MUST NOT spill raw patient bodies into a flat log file
// that an ops engineer might tail with no need-to-know. We strip
// obvious PHI keys from req.body before serialisation; the list is
// intentionally broad (false positives are harmless, missed leaks
// are not).
//
// To enable Sentry / Datadog APM as well, set SENTRY_DSN and
// uncomment the marked block below.
// ════════════════════════════════════════════════════════════════════
"use strict";

const fs   = require("fs");
const path = require("path");

// Resolve the log directory once at module-load. We try (in order):
//   1. process.env.LOG_DIR
//   2. <BackendRoot>/logs
// and create whichever path was selected if it doesn't exist. Boot
// must not crash if mkdir fails (read-only FS, permission glitch);
// we log to stderr and fall back to in-memory only.
const _BACKEND_ROOT = path.join(__dirname, "..");
const LOG_DIR = process.env.LOG_DIR || path.join(_BACKEND_ROOT, "logs");
let _logDirReady = false;
function ensureLogDir() {
  if (_logDirReady) return true;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    _logDirReady = true;
    return true;
  } catch (e) {
    console.error(`[errorLogger] cannot create log dir ${LOG_DIR}: ${e.message}`);
    return false;
  }
}
ensureLogDir();

// Per-day rotation. The cache holds today's WriteStream so we don't
// open/close on every request; midnight rollover happens lazily the
// first time a request lands after the date string flips.
let _currentDateKey = null;
let _currentStream = null;
function getStreamForToday() {
  if (!_logDirReady) return null;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const key = `${y}-${m}-${d}`;
  if (key === _currentDateKey && _currentStream) return _currentStream;
  // Close old stream if any.
  if (_currentStream) {
    try { _currentStream.end(); } catch (_) { /* best-effort */ }
  }
  const file = path.join(LOG_DIR, `errors-${key}.log`);
  try {
    _currentStream = fs.createWriteStream(file, { flags: "a" });
    _currentDateKey = key;
    return _currentStream;
  } catch (e) {
    console.error(`[errorLogger] cannot open ${file}: ${e.message}`);
    _currentStream = null;
    _currentDateKey = null;
    return null;
  }
}

// Keys that may carry PHI. Broad on purpose. Anything matching is
// replaced with "[REDACTED]" before serialisation. Nested objects
// get a recursive sweep too.
const PHI_KEYS = new Set([
  "password", "newPassword", "oldPassword", "currentPassword", "passwordConfirm",
  "otp", "token", "refreshToken", "accessToken", "jwt", "bearerToken",
  "ssn", "aadhaar", "aadhaarNumber", "panNumber", "passportNumber",
  "patientName", "name", "fullName", "firstName", "lastName", "middleName",
  "fatherName", "motherName", "spouseName", "guardianName",
  "phone", "mobile", "mobileNumber", "phoneNumber", "altPhone", "altMobile",
  "email", "emailId",
  "address", "addressLine1", "addressLine2", "city", "state", "pincode", "zip",
  "dob", "dateOfBirth", "age",
  "diagnosis", "complaint", "chiefComplaint", "history", "notes", "vitals",
  "prescription", "medication", "drug", "drugName",
  // Identifier-shaped fields we don't need in the log.
  "UHID", "uhid", "ipdNo", "opdNo", "admissionNumber", "billNumber",
]);
const PHI_MAX_DEPTH = 6;
function redactPHI(value, depth) {
  if (depth > PHI_MAX_DEPTH) return "[…]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    // Cap array length so a 10 k-element list doesn't blow the log line.
    return value.slice(0, 20).map((v) => redactPHI(v, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (PHI_KEYS.has(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactPHI(v, depth + 1);
      }
    }
    return out;
  }
  if (typeof value === "string") {
    // Strings longer than 500 chars get truncated so a base64 payload doesn't
    // fill the file.
    return value.length > 500 ? value.slice(0, 500) + "…[truncated]" : value;
  }
  return value;
}

// Truncate a stack trace so a deep node_modules trace doesn't fill the
// line. 4 KB is plenty to identify the call site.
function truncateStack(stack) {
  if (!stack || typeof stack !== "string") return null;
  if (stack.length <= 4000) return stack;
  return stack.slice(0, 4000) + "\n…[stack truncated]";
}

// R9-FIX(R9-089): the request body/query/params are PHI-redacted before persist,
// but the raw URL was logged verbatim — and identifiers travel IN the path
// (/patients/UH07, /billing/<objectId>/generate, /emergency/EMG-26-01). Scrub
// id-shaped path segments and drop the query string (already captured, redacted,
// as requestQuery) so a UHID/patient id never lands in the plain error log.
function scrubRoutePath(u) {
  if (!u) return null;
  const path = String(u).split("?")[0];
  const scrubbed = path.split("/").map((seg) => {
    if (!seg) return seg;
    if (/^[0-9a-fA-F]{24}$/.test(seg)) return ":id";       // Mongo ObjectId
    if (/^UH\d+$/i.test(seg)) return ":uhid";              // UHID
    if (/^\d+$/.test(seg)) return ":n";                    // pure-numeric id
    if (/\d{4,}/.test(seg)) return ":ref";                // coded ref w/ long digit run (BILL-26-0001, EMG-26-01…)
    return seg;
  }).join("/");
  return String(u).includes("?") ? `${scrubbed}?[redacted]` : scrubbed;
}

function safeJSONStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    // Circular ref / BigInt etc. — fall back to a minimal envelope.
    return JSON.stringify({ _serialiseError: e.message, raw: String(obj).slice(0, 200) });
  }
}

/**
 * Express error-handling middleware. Mount it AFTER all routes.
 * Signature is (err, req, res, next) — Express identifies an error
 * handler by arity.
 *
 * Behaviour:
 *  • Logs structured JSON to logs/errors-YYYY-MM-DD.log + stderr.
 *  • Sets req.errorLogId so a downstream production error responder can
 *    surface it back to the client ("Error ID: abc123") without leaking
 *    the stack itself.
 *  • Does NOT send a response — the existing central error handler in
 *    Backend/index.js owns the response shape. We're a logger, not a
 *    responder.
 */
function errorLoggerMiddleware(err, req, res, next) {
  try {
    // err shape varies — JSON parse error, mongoose validation, plain Error.
    const statusCode = err?.status || err?.statusCode || 500;

    // Build the line. Numeric status, error name, message, truncated
    // stack, route/method, user fingerprint (no PII — just id/role),
    // PHI-stripped body.
    const errorLogId = `err_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const line = {
      timestamp: new Date().toISOString(),
      errorLogId,
      level: statusCode >= 500 ? "error" : "warn",
      route: scrubRoutePath(req?.originalUrl || req?.url), // R9-FIX(R9-089): id-scrubbed
      method: req?.method || null,
      statusCode,
      userId: req?.user?.id || req?.user?._id || null,
      userRole: req?.user?.role || null,
      employeeId: req?.user?.employeeId || null,
      errorName: err?.name || "Error",
      // R7hr-241 (audit: PHI in error logs) — Mongoose validation / dup-key
      // errors embed field values; mask emails + long digit runs before persist.
      errorMessage: (typeof err?.message === "string" ? err.message : String(err))
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
        .replace(/\b\d{6,}\b/g, "[num]")
        .slice(0, 1000),
      errorStack: truncateStack(err?.stack),
      requestBody: redactPHI(req?.body, 0),
      requestQuery: redactPHI(req?.query, 0),
      requestParams: redactPHI(req?.params, 0),
    };

    // Attach ID so the central error handler in index.js (or any future
    // responder) can surface it to the client for support tickets.
    if (req) req.errorLogId = errorLogId;

    const payload = safeJSONStringify(line);

    // Console mirror — keeps the existing pm2/journalctl tail intact.
    if (statusCode >= 500) {
      console.error(`[err] ${payload}`);
    } else {
      console.warn(`[warn] ${payload}`);
    }

    // File sink (best-effort — failures here MUST NOT mask the original
    // error from reaching the responder).
    const stream = getStreamForToday();
    if (stream) {
      try {
        stream.write(payload + "\n");
      } catch (e) {
        console.error(`[errorLogger] write failed: ${e.message}`);
      }
    }

    // ────────────────────────────────────────────────────────────────
    // To enable Sentry, set SENTRY_DSN env var and uncomment the block
    // below. (`@sentry/node` is not currently in package.json — install
    // it first with `npm install @sentry/node`.)
    // ────────────────────────────────────────────────────────────────
    // if (process.env.SENTRY_DSN) {
    //   const Sentry = require("@sentry/node");
    //   Sentry.withScope((scope) => {
    //     scope.setTag("route", line.route);
    //     scope.setTag("method", line.method);
    //     scope.setUser({ id: line.userId, role: line.userRole });
    //     scope.setContext("request", {
    //       body: line.requestBody,
    //       query: line.requestQuery,
    //       params: line.requestParams,
    //       errorLogId,
    //     });
    //     Sentry.captureException(err);
    //   });
    // }
  } catch (loggerErr) {
    // If WE blow up, fall through silently — never break the chain on
    // a logger fault.
    console.error(`[errorLogger] internal fault: ${loggerErr?.message}`);
  }
  // Hand off to the next error handler (the central one in index.js).
  return next(err);
}

// Graceful shutdown — flush + close the stream so the last few entries
// aren't lost on SIGTERM.
function closeOnExit() {
  if (_currentStream) {
    try { _currentStream.end(); } catch (_) { /* best-effort */ }
    _currentStream = null;
    _currentDateKey = null;
  }
}
process.on("SIGTERM", closeOnExit);
process.on("SIGINT",  closeOnExit);

module.exports = errorLoggerMiddleware;
module.exports.LOG_DIR    = LOG_DIR;
module.exports.redactPHI  = redactPHI;
module.exports.closeOnExit = closeOnExit;
