/**
 * clientErrorRoutes.js — R7bz
 *
 * Receives client-side React render crashes captured by the
 * ErrorBoundary at /Frontend/src/Components/ErrorBoundary.jsx and
 * exposes admin endpoints for inspecting them on the System Health
 * page (sibling agent's work).
 *
 *   POST /api/client-errors           — soft-auth, body { message, stack, componentStack,
 *                                       label, url, userAgent, timestamp }
 *   GET  /api/client-errors           — Admin (users.read), paginated last 100
 *   GET  /api/client-errors/grouped   — Admin (users.read), aggregated by message
 *
 * MOUNT INSTRUCTIONS (for whoever wires this in Backend/index.js):
 *   const clientErrorRoutes = require("./routes/Admin/clientErrorRoutes");
 *   app.use("/api/client-errors", clientErrorRateLimit, clientErrorRoutes);
 *
 * Rate limit applied at index.js mount via clientErrorRateLimit middleware
 * from rateLimitAuth.js — DO NOT import or apply the rate limit here.
 * Whoever mounts the route is responsible for adding the limiter (sibling
 * agent creates the middleware).
 *
 * Why no requireAction on POST: a crash often happens BEFORE auth resolves
 * (e.g. login page render crash, axios interceptor throw, expired-token
 * 401 redirect mid-render). We use `attemptAuth` instead so when a user is
 * logged in we still capture their identity, but anonymous reports are
 * accepted too. Abuse risk is mitigated by the rate limit at the mount.
 *
 * Why users.read on the read endpoints: there is no dedicated "errors.read"
 * permission in config/permissions.js yet, and only Admin needs to look at
 * the crash log. users.read is Admin-only per the existing config, so it's
 * the closest existing match — we can introduce errors.read later without
 * breaking this gate.
 */
"use strict";

const express = require("express");
const router = express.Router();

const { authenticate, attemptAuth, requireAction } = require("../../middleware/auth");
const ClientErrorLog = require("../../models/Admin/ClientErrorLog");
// `redactPHI` is exported from errorLogger.js (see module.exports there).
// Defensive second-pass sanitisation of the message before save — the
// frontend already strips obvious PHI, but a second layer is cheap.
const { redactPHI } = require("../../middleware/errorLogger");

// Helper — clamp a string to N chars (or empty if not a string).
function clamp(s, n) {
  if (typeof s !== "string") return "";
  return s.length > n ? s.slice(0, n) : s;
}

// Run a single string through redactPHI. redactPHI returns the value
// unchanged for strings (just truncates to 500 chars), but if the string
// itself happens to contain a JSON-ish payload it's still bounded — that
// extra safety is the whole point of running this here.
function sanitiseString(s) {
  try {
    const raw = redactPHI(s, 0);
    const out = typeof raw === "string" ? raw : String(raw ?? "");
    // R7hr-252 (audit: redactPHI only truncates strings) — also mask embedded
    // emails + long digit runs (phone / Aadhaar / UHID-shaped) before persist.
    return out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]").replace(/\b\d{6,}\b/g, "[num]");
  } catch (_) {
    return clamp(s, 2000);
  }
}

/* ── POST /api/client-errors ──
   Body schema (all optional except `message`):
     message:        String, max 2000
     stack:          String, max 2000
     componentStack: String, max 2000
     label:          String, ≤ 200
     url:            String, max 500
     userAgent:      String, max 500
     timestamp:      ISO string (ignored — server occurredAt is set here)

   Returns: 201 { success:true, errorLogId } on success.
            415 if Content-Type is not application/json.
            400 if message is missing/empty.
            500 on persistence failure (but logs to console — never lose the report).
*/
router.post("/", attemptAuth, async (req, res) => {
  try {
    // Enforce JSON body. Express's json parser only fires on this CT, so
    // an XML / form-encoded blob would arrive with an empty req.body and
    // we'd reject as "missing message" — but a clearer 415 helps clients
    // diagnose mis-configured fetch calls.
    const ct = String(req.headers["content-type"] || "").toLowerCase();
    if (!ct.includes("application/json")) {
      return res.status(415).json({
        success: false,
        message: "Content-Type: application/json required",
      });
    }

    const body = req.body || {};
    const rawMessage = typeof body.message === "string" ? body.message.trim() : "";
    if (!rawMessage) {
      return res.status(400).json({
        success: false,
        message: "Field `message` is required",
      });
    }

    const doc = {
      // Truncate first, then sanitise — sanitiseString returns ≤500 chars
      // (redactPHI behaviour), but we keep the clamp() call as a final
      // ceiling in case the helper changes.
      message:        clamp(sanitiseString(rawMessage), 2000),
      stack:          clamp(sanitiseString(body.stack), 2000),
      componentStack: clamp(sanitiseString(body.componentStack), 2000),
      label:          clamp(typeof body.label === "string" ? body.label : "", 200),
      url:            clamp(typeof body.url === "string" ? body.url : "", 500),
      userAgent:      clamp(typeof body.userAgent === "string" ? body.userAgent : "", 500),
      // attemptAuth populates req.user when a valid bearer token is
      // present — anonymous crashes (login page, expired session) leave
      // both fields null, which the schema permits.
      userId:    req.user?._id || req.user?.id || null,
      userRole:  req.user?.role || null,
      ip:        clamp(req.ip || req.headers["x-forwarded-for"] || "", 100),
      occurredAt: new Date(),
    };

    const saved = await ClientErrorLog.create(doc);
    return res.status(201).json({ success: true, errorLogId: String(saved._id) });
  } catch (err) {
    // We deliberately don't let a persistence failure propagate — losing
    // a single error report is fine, but a 500 on this endpoint could
    // make the frontend retry-storm. Log and 200-soft so the boundary
    // moves on.
    console.error("[clientErrorRoutes] save failed:", err?.message || err);
    return res.status(202).json({
      success: false,
      message: "Error report received but could not be persisted",
    });
  }
});

/* ── GET /api/client-errors ──
   Admin-only. Returns the last 100 errors ordered by occurredAt desc.
   Supports ?limit=N (max 100, default 100) and ?skip=M for paging. */
router.get("/", authenticate, requireAction("users.read"), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 100);
    const skip  = Math.max(parseInt(req.query.skip,  10) || 0, 0);
    const rows = await ClientErrorLog.find({})
      .sort({ occurredAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    console.error("[clientErrorRoutes] list failed:", err?.message || err);
    return res.status(500).json({ success: false, message: "Failed to list client errors" });
  }
});

/* ── GET /api/client-errors/grouped ──
   Admin-only. Aggregates by `message` so the System Health page can show:
     { message, count, lastOccurredAt, lastLabel, lastUrl }
   sorted by count desc (most-frequent crashes first). */
router.get("/grouped", authenticate, requireAction("users.read"), async (req, res) => {
  try {
    const rows = await ClientErrorLog.aggregate([
      {
        $sort: { occurredAt: -1 },
      },
      {
        $group: {
          _id: "$message",
          count: { $sum: 1 },
          lastOccurredAt: { $max: "$occurredAt" },
          lastLabel: { $first: "$label" },
          lastUrl:   { $first: "$url" },
          lastUserRole: { $first: "$userRole" },
        },
      },
      {
        $project: {
          _id: 0,
          message: "$_id",
          count: 1,
          lastOccurredAt: 1,
          lastLabel: 1,
          lastUrl: 1,
          lastUserRole: 1,
        },
      },
      { $sort: { count: -1, lastOccurredAt: -1 } },
      { $limit: 100 },
    ]);
    return res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    console.error("[clientErrorRoutes] grouped failed:", err?.message || err);
    return res.status(500).json({ success: false, message: "Failed to aggregate client errors" });
  }
});

module.exports = router;
