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

module.exports = { escapeRegex, safeRegex, validateObjectIdParam };
