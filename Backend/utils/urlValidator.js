/**
 * urlValidator.js — R7bj-F10. Reusable URL-string validator for any
 * Mongoose schema or controller that accepts an attachment / photo /
 * scan as a STRING (vs. a binary upload through `safeUpload`).
 *
 * Why
 *   Pre-R7bj a number of schemas accepted `[String]` URL arrays straight
 *   from `req.body`:
 *     • IncidentReport.attachments
 *     • mortuary handover scan
 *     • diet card photoUrl
 *     • visitor-pass photoUrl (already has its own validator — kept for
 *       backwards-compat; new callers should consult `isSafeUrl` here)
 *     • spillage / treatment photos
 *   None of them rejected `javascript:`, `data:`, or `file:` schemes.
 *   An attacker who controlled any of these fields could ship a stored-
 *   XSS payload that fires when an admin opens the patient file and
 *   clicks the thumbnail (R7bi-10-X-CRIT-1, R7bi-7-HIGH-8).
 *
 * Policy
 *   • Allow `http:` and `https:` absolute URLs (the staging hospital
 *     deployment still serves a few legacy assets over HTTP — once
 *     production is fully behind TLS we can drop `http:`).
 *   • Allow a small, audited set of LOCAL path prefixes — anything
 *     served by the same Express app under `/uploads/...`,
 *     `/attachments/...`, or `/images/...`. These are the directories
 *     `safeUpload` writes to.
 *   • Reject every other scheme. Specifically blocks `javascript:`,
 *     `data:`, `file:`, `vbscript:`, `mailto:`, `tel:`, and any
 *     unknown / typo'd protocol.
 *   • Cap length at 2 kB so a megabyte-long data URL can't get stuffed
 *     into a string field as a DoS vector.
 *   • Cap arrays at 10 entries so a controller that accepts a list of
 *     URLs can't be used to bloat the document.
 *
 * Usage
 *   const { isSafeUrl, isSafeUrlArray } = require("../utils/urlValidator");
 *   if (!isSafeUrl(req.body.photoUrl)) return res.status(400)...;
 *
 *   Inside a Mongoose schema:
 *     photoUrl: { type: String, validate: { validator: isSafeUrl,
 *       message: "photoUrl rejected — scheme or path not allowed" } }
 */
"use strict";

const SAFE_SCHEMES = new Set(["https:", "http:"]);

// Whitelisted local-path prefixes. Anything outside this list is
// treated as an unknown route and rejected even though it has no
// scheme — prevents a value like `/etc/passwd` slipping through.
const HOSPITAL_PATH_PREFIXES = [
  "/uploads/",
  "/attachments/",
  "/images/",
  "/static/",
];

const MAX_URL_LENGTH = 2000;
const MAX_ARRAY_LENGTH = 10;

/**
 * Return true iff `s` is a string we are willing to render as an
 * `href` / `src` attribute on the frontend.
 */
function isSafeUrl(s) {
  if (typeof s !== "string") return false;
  if (s.length === 0) return false;
  if (s.length > MAX_URL_LENGTH) return false;

  // Local hospital-served path — always safe.
  if (HOSPITAL_PATH_PREFIXES.some((p) => s.startsWith(p))) return true;

  // Anything else must parse as a URL with an allowed scheme.
  try {
    const u = new URL(s);
    return SAFE_SCHEMES.has(u.protocol);
  } catch (_) {
    // Not a valid absolute URL and not a whitelisted local path → reject.
    return false;
  }
}

/**
 * Validate an array of URL strings. Returns true iff every entry is
 * safe AND the array length is within the cap.
 */
function isSafeUrlArray(arr) {
  if (!Array.isArray(arr)) return false;
  if (arr.length > MAX_ARRAY_LENGTH) return false;
  return arr.every(isSafeUrl);
}

/**
 * Filter helper for controllers that want to drop bad entries silently
 * (rather than 400-reject the whole request). Returns a NEW array
 * containing only the safe URLs.
 */
function filterSafeUrls(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(isSafeUrl).slice(0, MAX_ARRAY_LENGTH);
}

module.exports = {
  isSafeUrl,
  isSafeUrlArray,
  filterSafeUrls,
  SAFE_SCHEMES,
  HOSPITAL_PATH_PREFIXES,
  MAX_URL_LENGTH,
  MAX_ARRAY_LENGTH,
};
