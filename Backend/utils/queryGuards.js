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

module.exports = {
  escapeRegex,
  safeRegex,
  validateObjectIdParam,
  istStartOfToday,
  istStartOfDayPlus,
};
