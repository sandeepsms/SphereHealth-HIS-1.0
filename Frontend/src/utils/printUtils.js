// utils/printUtils.js
// ════════════════════════════════════════════════════════════════════
// R7bf-F: shared helpers for the print pipeline (A4 audit).
//
// Exports:
//   numberToIndianWords(n)  — INR amount-in-words ("Five Lakh Twenty
//                              Three Thousand Two Hundred Forty Rupees
//                              and Fifty Paise Only").
//   toNum(field)            — Decimal128 wire-shape → JS Number unwrap
//                              (mirrors money.js but cheap to import
//                              from print-context).
//   recordPrintAudit({...}) — POSTs to /api/print-audit, returns
//                              { printCount, isDuplicate }. Best-effort;
//                              never throws. Caller should `await` it
//                              BEFORE `window.print()` so the watermark
//                              has the correct count when rendering.
//   getPrintCount({...})    — GET probe (used to decide DUPLICATE
//                              before opening the preview).
//   absoluteLogoUrl(src)    — A4-MED-2: rewrites relative logo paths
//                              to absolute URLs (VITE_API_BASE_URL).
//   ESCPOS_FEED_CUT         — A4-MED-4: ESC/POS bytes for paper feed +
//                              cut (thermal printer trailer).
// ════════════════════════════════════════════════════════════════════

import { API_BASE_URL } from "../config/api";
import authFetch from "./authFetch";

/* ── Decimal128 unwrap ───────────────────────────────────────────── */
export function toNum(field) {
  if (field == null) return 0;
  if (typeof field === "number") return Number.isFinite(field) ? field : 0;
  if (typeof field === "string") {
    const n = Number(field);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof field === "object") {
    if (field.$numberDecimal != null) {
      const n = Number(field.$numberDecimal);
      return Number.isFinite(n) ? n : 0;
    }
    if (typeof field.toString === "function") {
      const n = Number(field.toString());
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

/* ── Indian rupees → words ──────────────────────────────────────────
   Pre-R7bf the print pipeline had a `Components/print/amountWords.js`
   that handled the rupee leg only. GST Rules §46 mandates the FULL
   value "X Rupees and Y Paise Only" on a tax invoice — so a fresh
   helper that includes paise. amountWords.js's amountInWords is kept
   for legacy receipts; new tax-invoice templates should call the
   helper below.
─────────────────────────────────────────────────────────────────── */
const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under1000(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return (TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "")).trim();
  return ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + under1000(n % 100) : "");
}

function intToWordsIndian(num) {
  num = Math.max(0, Math.floor(num));
  if (num === 0) return "Zero";
  let n = num;
  const parts = [];
  if (n >= 10000000) { parts.push(under1000(Math.floor(n / 10000000)) + " Crore");  n %= 10000000; }
  if (n >= 100000)   { parts.push(under1000(Math.floor(n / 100000))   + " Lakh");   n %= 100000;   }
  if (n >= 1000)     { parts.push(under1000(Math.floor(n / 1000))     + " Thousand"); n %= 1000;   }
  if (n > 0)         { parts.push(under1000(n)); }
  return parts.join(" ");
}

/**
 * "₹4,523.50" → "Rupees Four Thousand Five Hundred Twenty-Three and Fifty Paise Only".
 * Negative values return "Negative ..." (refund / credit-note totals).
 */
export function numberToIndianWords(amount) {
  const v = toNum(amount);
  if (v === 0) return "Rupees Zero Only";
  const neg = v < 0;
  const abs = Math.abs(v);
  const rupees = Math.floor(abs);
  // Round paise to avoid floating-point noise (0.999999 → 100 paise).
  const paise  = Math.round((abs - rupees) * 100);

  let words = "Rupees " + intToWordsIndian(rupees);
  if (paise > 0) {
    words += " and " + intToWordsIndian(paise) + " Paise";
  }
  words += " Only";
  return (neg ? "Negative " : "") + words;
}

/* ── Logo absolute URL — A4-MED-2 ───────────────────────────────────
   Relative logo paths break on staging (https://staging.example.com/
   tries to load https://staging.example.com/uploads/logo.png — usually
   404 because uploads live on the API host). Rewrite to absolute using
   the API base URL. Untouched if the input already looks absolute
   (http/https/data: URI).
─────────────────────────────────────────────────────────────────── */
export function absoluteLogoUrl(src) {
  if (!src) return "";
  const s = String(src);
  if (/^(https?:)?\/\//i.test(s)) return s;
  if (/^data:/i.test(s)) return s;
  // API_BASE_URL is "http://host:port/api" — strip the /api suffix to
  // reach the host root, since logos are typically served at /uploads.
  const base = (API_BASE_URL || "")
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");
  if (!base) return s;
  return base + (s.startsWith("/") ? s : "/" + s);
}

/* ── ESC/POS thermal trailer — A4-MED-4 ─────────────────────────────
   Encoded as a string of bytes. Sent at the END of a print payload
   when `thermal=true`. Sequence:
     ESC d 5  — feed 5 lines (clear the print head past the cut bar)
     GS V 0   — full cut
   The browser print path can't actually emit raw bytes — this is
   meant for the kiosk-mode thermal-printer wrapper (where the
   browser hands the document to a service worker that POSTs to the
   local print daemon). Exported as a string so the wrapper can
   include it verbatim.
─────────────────────────────────────────────────────────────────── */
export const ESCPOS_FEED_CUT = "\x1b\x64\x05\x1d\x56\x00";

/* ── /api/print-audit wire ──────────────────────────────────────────
   recordPrintAudit() — POSTs the event + returns the post-bump count.
   Both calls are best-effort (1.5s timeout, never throws). On failure
   they return printCount: 1 so the caller can still print without the
   DUPLICATE banner.
─────────────────────────────────────────────────────────────────── */
async function _withTimeout(promise, ms = 1500) {
  return await Promise.race([
    promise,
    new Promise((res) => setTimeout(() => res({ ok: false, _timeout: true }), ms)),
  ]);
}

/**
 * Record a print event. Call this IMMEDIATELY BEFORE window.print().
 * @returns Promise<{ success, printCount, isDuplicate }>
 */
export async function recordPrintAudit({
  entityType,
  entityId,
  entityNumber,
  printSource = "client",
  UHID,
  patientName,
}) {
  // Skip if entityId missing — happens during demo / preview mode.
  if (!entityType || !entityId) {
    return { success: false, printCount: 1, isDuplicate: false };
  }
  try {
    // API_BASE_URL already ends with /api in the canonical config
    const r = await _withTimeout(
      authFetch(`${API_BASE_URL}/print-audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType, entityId, entityNumber,
          printSource, UHID, patientName,
        }),
      }),
      1500,
    );
    if (r && r.ok) {
      const j = await r.json();
      return {
        success: !!j.success,
        printCount: Number(j.printCount) || 1,
        isDuplicate: !!j.isDuplicate,
      };
    }
  } catch (_e) { /* swallow — never block print */ }
  return { success: false, printCount: 1, isDuplicate: false };
}

/**
 * Probe the current print count for an entity. Used to decide whether
 * the preview should already render the DUPLICATE watermark (i.e.
 * before the user even confirms print).
 */
export async function getPrintCount({ entityType, entityId }) {
  if (!entityType || !entityId) return { printCount: 0, isDuplicate: false };
  try {
    const url = `${API_BASE_URL}/print-audit/count?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`;
    const r = await _withTimeout(authFetch(url), 1500);
    if (r && r.ok) {
      const j = await r.json();
      return {
        printCount: Number(j.printCount) || 0,
        isDuplicate: !!j.isDuplicate,
      };
    }
  } catch (_e) { /* swallow */ }
  return { printCount: 0, isDuplicate: false };
}

export default {
  numberToIndianWords,
  toNum,
  recordPrintAudit,
  getPrintCount,
  absoluteLogoUrl,
  ESCPOS_FEED_CUT,
};
