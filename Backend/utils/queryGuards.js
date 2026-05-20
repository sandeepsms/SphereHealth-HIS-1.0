/**
 * utils/queryGuards.js
 *
 * Defensive helpers for user-supplied input that hits MongoDB. Created after
 * the 2026-05-17 security audit found unescaped `$regex` in three search
 * endpoints (Backend findings B-01 / B-02 / B-03), which let a caller pass
 * a regex like `.*` and dump entire collections.
 */

/**
 * Escapes the dozen regex meta-characters so a search string is treated as a
 * literal substring. Pair with `$options: "i"` for case-insensitive contains.
 * Returns "" for null/undefined so the resulting query is empty rather than
 * matching everything.
 */
function escapeRegex(str) {
  if (str == null) return "";
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a safe `{ $regex, $options }` shape from a user string. Trims, caps
 * length to 80 chars (anything longer is almost certainly abuse), and
 * escapes regex metacharacters.
 */
function safeRegex(str) {
  const escaped = escapeRegex(String(str || "").trim().slice(0, 80));
  return { $regex: escaped, $options: "i" };
}

/**
 * Express middleware that 400s on a malformed Mongo ObjectId param BEFORE
 * the controller calls `findById` and throws CastError → 500. Usage:
 *   router.get("/:id", validateObjectIdParam("id"), ctrl.getById);
 * Created after the 2026-05-17 audit found ~15 controllers blindly trusting
 * `req.params.id` (finding C-08).
 */
function validateObjectIdParam(paramName = "id") {
  const mongoose = require("mongoose");
  return (req, res, next) => {
    const v = req.params[paramName];
    if (!v || !mongoose.isValidObjectId(String(v))) {
      return res.status(400).json({
        success: false,
        message: `Invalid ${paramName} — expected MongoDB ObjectId`,
        param: paramName,
      });
    }
    next();
  };
}

/**
 * Hospital-timezone date helpers — anchor on the IST calendar day rather
 * than the server's UTC instant. India is UTC+5:30, so any naive
 * `new Date()` boundary drifts by 5h30m relative to the IST midnight a
 * pharmacist / clinician actually cares about. Override the timezone via
 * `HOSPITAL_TZ` env var for non-India deploys. Patient-safety / business
 * audit F-04 (initial in fifoConsume) + F-04 follow-ups (listBatches +
 * alerts in pharmacyController).
 */
const HOSPITAL_TZ = process.env.HOSPITAL_TZ || "Asia/Kolkata";
const _DAY_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: HOSPITAL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
});

/** Returns the UTC instant that marks "start of today" in the hospital TZ. */
function istStartOfToday(now = new Date()) {
  const key = _DAY_KEY_FMT.format(now);
  // IST is UTC+5:30; making the offset explicit so the host's clock-skew
  // doesn't leak in. Override HOSPITAL_TZ + this offset together when
  // deploying elsewhere.
  return new Date(`${key}T00:00:00+05:30`);
}

/** Returns the UTC instant that marks "start of N days from today" in the hospital TZ. */
function istStartOfDayPlus(days, now = new Date()) {
  const base = istStartOfToday(now);
  return new Date(base.getTime() + days * 86400000);
}

/**
 * R7ar-P1-9/D3-aq-05/D3-aq-06: parse a hospital-date query param.
 * Returns `null` for missing, throws for malformed input. Use to reject
 * `?from=abc` before it becomes `new Date("abc") = Invalid Date` which
 * silently becomes a wide-open query.
 *
 * Accepts only the strict ISO `YYYY-MM-DD` shape. Anchors at IST start-of-day.
 */
function parseHospitalDate(str, { endOfDay = false } = {}) {
  if (str == null || str === "") return null;
  const s = String(str).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const err = new Error(`Invalid date "${s}" — expected YYYY-MM-DD`);
    err.status = 400;
    err.code = "INVALID_DATE";
    throw err;
  }
  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00";
  const offset = "+05:30";  // IST anchor — match HOSPITAL_TZ
  const d = new Date(`${s}${suffix}${offset}`);
  if (Number.isNaN(d.getTime())) {
    const err = new Error(`Invalid date "${s}" — could not parse`);
    err.status = 400;
    throw err;
  }
  return d;
}

/**
 * Parse a from/to range with sanity guards. Defaults to last 30 days IST
 * when both missing. Caps window to 366 days. Throws on `from > to`.
 */
function parseHospitalDateRange(fromStr, toStr, { maxDays = 366, defaultDays = 30 } = {}) {
  let from = parseHospitalDate(fromStr);
  let to   = parseHospitalDate(toStr, { endOfDay: true });
  if (!to)   to   = new Date();
  if (!from) from = new Date(to.getTime() - defaultDays * 86400000);
  if (from > to) {
    const err = new Error(`Invalid range: from (${fromStr}) must be ≤ to (${toStr})`);
    err.status = 400;
    throw err;
  }
  const days = (to - from) / 86400000;
  if (days > maxDays) {
    const err = new Error(`Date range too wide: ${days.toFixed(0)} days exceeds max ${maxDays}`);
    err.status = 400;
    throw err;
  }
  return { from, to };
}

module.exports = {
  escapeRegex,
  safeRegex,
  validateObjectIdParam,
  istStartOfToday,
  istStartOfDayPlus,
  parseHospitalDate,        // R7ar-P1-9
  parseHospitalDateRange,   // R7ar-P1-9
};
