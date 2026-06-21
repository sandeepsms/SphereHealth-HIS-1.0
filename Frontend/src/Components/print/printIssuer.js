// Components/print/printIssuer.js
// ════════════════════════════════════════════════════════════════════
// R7cf — Single source of truth for the "Digital signature" stamp that
// every printed document carries instead of the old empty signature
// lines. Reads the minimal user snapshot AuthContext mirrors into
// sessionStorage on login (key `his_user`). Print windows are opened
// via `window.open()` from the parent tab and therefore inherit that
// sessionStorage, so the stamp lands on first paint without any
// network round-trip.
//
// Returned shape — all strings, ready to render:
//   {
//     name:        "Dr. Sandeep Kumar",
//     employeeId:  "DR-2024-003",
//     role:        "Doctor",
//     department:  "General Medicine",
//     designation: "Senior Consultant",
//     when:        "24 May 2026, 09:14 PM",
//     isoAt:       "2026-05-24T15:44:13.000Z",
//   }
// When sessionStorage is empty (rare — pre-login bookmarks, expired
// session) we still return a stable object so the stamp can render a
// neutral "Hospital staff · <time>" line instead of crashing.
// ════════════════════════════════════════════════════════════════════
"use strict";

const USER_KEY = "his_user";

export function readStoredUser() {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    return (u && typeof u === "object") ? u : null;
  } catch (_) {
    return null;
  }
}

/** Format an ISO/Date value with the short IST-style stamp used on prints. */
export function fmtPrintTime(d) {
  try {
    const t = d ? new Date(d) : new Date();
    if (Number.isNaN(t.getTime())) return "";
    return t.toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return ""; }
}

/**
 * Compose a print-issuer object. Caller may pass:
 *   - explicit `issuer` (wins everything — e.g. doctor sign-and-submit
 *     stamps the doctor of record, NOT the receptionist who clicked
 *     "reprint")
 *   - explicit `signedAt` (the canonical sign timestamp; reprints still
 *     show the original sign time)
 * Falls back to the stored user + "now" otherwise.
 */
export function buildPrintIssuer(opts = {}) {
  const explicit = opts.issuer || {};
  const u = readStoredUser() || {};
  const name        = explicit.name        || explicit.fullName  || u.fullName || "Hospital staff";
  const employeeId  = explicit.employeeId  || u.employeeId       || "";
  const role        = explicit.role        || u.role             || "";
  const department  = explicit.department  || u.department       || "";
  const designation = explicit.designation || u.designation      || "";
  const at          = opts.signedAt        || explicit.signedAt  || new Date();
  return {
    name,
    employeeId,
    role,
    department,
    designation,
    when:  fmtPrintTime(at),
    isoAt: new Date(at).toISOString(),
  };
}

/**
 * Build a small HTML string for the inline-window.open() print paths
 * (ReceptionBilling, CompletePatientFile, ConsentForm, MAR, DoctorNotes
 * etc. — they don't render React in the popup, they write a template
 * string). Same data shape as the PrintShell stamp, just stringified.
 *
 * Pass-through for `escapeHtml` so each page can reuse its existing
 * escaper without forcing a shared util import.
 */
export function buildPrintIssuerHtml(opts = {}) {
  const escape = typeof opts.escapeHtml === "function"
    ? opts.escapeHtml
    : (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const i = buildPrintIssuer(opts);
  // R7hr-168 — `i.department` sometimes holds an unpopulated Mongo ObjectId
  // (24 hex chars) because the JWT actor snapshot stored in sessionStorage
  // carries department as a ref id, not a populated name. Rendering that
  // raw hex string in the "Consultant · <hex> · ID: DOC-…" line on every
  // print is a public-facing leak of an internal id. Filter it out — if
  // the field doesn't look like a human-readable department label, drop
  // it from the meta strip.
  const _isObjectIdLike = (v) =>
    typeof v === "string" && /^[0-9a-fA-F]{24}$/.test(v.trim());
  const _deptOk = i.department && !_isObjectIdLike(i.department) ? i.department : null;
  const meta = [
    i.designation || i.role,
    _deptOk,
    i.employeeId && `ID: ${i.employeeId}`,
  ].filter(Boolean).map(escape).join(" · ");
  return `
    <div class="pr-digsig" style="display:inline-flex;flex-direction:column;gap:2px;padding:8px 14px;border:1px dashed #94a3b8;border-radius:8px;background:#f8fafc;font-size:10.5px;color:#0f172a;line-height:1.35">
      <div style="display:inline-flex;align-items:center;gap:6px;color:#16a34a;font-weight:700;font-size:9.5px;letter-spacing:.6px">
        <span>✓</span><span>DIGITALLY ISSUED</span>
      </div>
      <div style="font-weight:700;font-size:11.5px;color:#0f172a">${escape(i.name)}</div>
      ${meta ? `<div style="font-size:9.5px;color:#475569">${meta}</div>` : ""}
      <div style="font-size:9.5px;color:#64748b">Signed ${escape(i.when)}</div>
    </div>
  `;
}
