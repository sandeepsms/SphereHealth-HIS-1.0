// utils/phiRedactor.js
// ═══════════════════════════════════════════════════════════════
// PHI / PII redactor for arbitrary payloads.
//
// The PatientActivityLog before/after snapshots can contain free-text
// fields the user typed (notes, remarks). If those fields hold an Aadhaar
// number, PAN, phone, or email, we must NOT keep the raw value in the
// audit collection — that turns the audit table into a PHI leak risk
// under DPDP Act 2023 + ISO 27001.
//
// The redactor walks a value recursively, replaces matches with a stable
// hash suffix so audit reviewers can still confirm "this is the same
// Aadhaar that appeared in another row" without leaking the digits.
//
// Patterns covered:
//   • Indian Aadhaar:   12 digits, possibly XXXX XXXX XXXX
//   • Indian PAN:        10-char, [A-Z]{5}[0-9]{4}[A-Z]
//   • Phone (10 digits): starts 6-9
//   • Email:             RFC-ish — local@host.tld
//   • Credit card-ish:   13-19 digit run separated by spaces/dashes
//
// Never redacts patient-name / UHID / DOB — those are intentionally
// stored on the audit row.
// ═══════════════════════════════════════════════════════════════

const crypto = require("crypto");

const MAX_DEPTH = 8;
const MAX_STRING = 4096;

const AADHAAR_RE = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
const PAN_RE     = /\b[A-Z]{5}\d{4}[A-Z]\b/g;
const PHONE_RE   = /\b[6-9]\d{9}\b/g;
const EMAIL_RE   = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const CARD_RE    = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}\b/g;

function tail(str) {
  // 6-char hash suffix — enough for cross-reference, too short to brute force.
  return crypto.createHash("sha1").update(String(str)).digest("hex").slice(0, 6);
}

function redactString(s) {
  if (typeof s !== "string") return s;
  if (s.length > MAX_STRING) s = s.slice(0, MAX_STRING) + "…[truncated]";
  return s
    .replace(AADHAAR_RE, (m) => `[AADHAAR:${tail(m)}]`)
    .replace(PAN_RE,     (m) => `[PAN:${tail(m)}]`)
    .replace(EMAIL_RE,   (m) => `[EMAIL:${tail(m)}]`)
    .replace(CARD_RE,    (m) => `[CARD:${tail(m)}]`)
    .replace(PHONE_RE,   (m) => `[PHONE:${tail(m)}]`);
}

function redact(value, depth = 0) {
  if (value == null) return value;
  if (depth >= MAX_DEPTH) return "[depth-capped]";
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // Whitelist clinical keys that must NOT be redacted even if they look
      // numeric-y (e.g. dose, BP, lab-result-id).
      if (["dose","route","frequency","mlrNumber","UHID","admissionNumber","billNumber"].includes(k)) {
        out[k] = v;
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

module.exports = { redact, redactString };
