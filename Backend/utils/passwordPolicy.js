/**
 * Backend/utils/passwordPolicy.js
 *
 * R7bb-FIX-A-14: NABH HIC.5 / OWASP-2024 password policy.
 *
 * Per the audit (D9-CRIT-4): the existing 6-char minlength on userModel
 * is a regression and lets `secret`, `password`, `123456` through every
 * admin-reset path. Anchor the floor here so both the user-driven change
 * path and the admin-reset path enforce the same rules.
 *
 * Public API:
 *   validatePassword(pw)            → { ok, reasons[] }
 *   validatePasswordComplexity(pw)  → { ok, message }   (legacy alias)
 *   checkPasswordReuse(pw, history) → { reused }
 *
 * `validatePassword` is the new canonical shape: returns the full list
 * of reasons so the UI can surface every rule the password fails (not
 * just the first one bcrypt happens to reject). The legacy alias is kept
 * for callers that pre-date this revision.
 */
const bcrypt = require("bcryptjs");

// Rules — keep additive. Each entry is { test, reason }.
const RULES = [
  { test: (pw) => pw.length >= 10,        reason: "Must be at least 10 characters" },
  { test: (pw) => /[A-Z]/.test(pw),       reason: "Must contain an uppercase letter" },
  { test: (pw) => /[a-z]/.test(pw),       reason: "Must contain a lowercase letter" },
  { test: (pw) => /[0-9]/.test(pw),       reason: "Must contain a digit" },
  { test: (pw) => /[^a-zA-Z0-9]/.test(pw),reason: "Must contain a special character" },
  { test: (pw) => !/\s/.test(pw),         reason: "Must not contain whitespace" },
];

function validatePassword(pw) {
  if (typeof pw !== "string") return { ok: false, reasons: ["Password must be a string"] };
  const reasons = [];
  for (const r of RULES) {
    if (!r.test(pw)) reasons.push(r.reason);
  }
  return { ok: reasons.length === 0, reasons };
}

// Legacy shape — callers in change-password / adminResetPassword used
// `{ ok, message }`. Map the first reason for backward compatibility.
function validatePasswordComplexity(pw) {
  const v = validatePassword(pw);
  if (v.ok) return { ok: true };
  return { ok: false, message: v.reasons[0] };
}

async function checkPasswordReuse(plain, history = []) {
  for (const entry of (history || []).slice(-5)) {
    if (!entry?.hash) continue;
    if (await bcrypt.compare(plain, entry.hash)) return { reused: true };
  }
  return { reused: false };
}

module.exports = { validatePassword, validatePasswordComplexity, checkPasswordReuse };
