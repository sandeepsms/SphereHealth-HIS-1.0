/**
 * signatureImg.js — R7hr(DEFER-13)
 * ONE source of truth for rendering a signer's digital-signature image in
 * the print builders (doctor notes / nurse notes / initial assessments).
 *
 * Was 5 hand-rolled copies across three builders — and they had DRIFTED:
 * the doctor-note footer was security-hardened in R7hr-251 to reject
 * external http(s) sources (tracking-pixel / referer-leak vector on a
 * printed medical record), but the nurse footer and all three inline
 * variants still allowed them. Consolidating applies the hardened policy
 * everywhere: data:image/ and local /uploads/ only. Legit signatures are
 * always one of those (useDigitalSignature stores data-URLs; server-side
 * stamps use /uploads paths).
 */

// Attribute-safe escaping (the src lands inside an HTML attribute).
import { escapeHtml as esc } from "./htmlEscape";  // R7hr(DEDUP) — shared 5-char escaper

export const isSafeSigSrc = (src) =>
  typeof src === "string" && !!src &&
  (src.startsWith("data:image/") || src.startsWith("/uploads/"));

/** Small inline image appended to a prose "✓ signed" line. */
export const sigImgInline = (src) => isSafeSigSrc(src)
  ? `<br/><img src="${esc(src)}" alt="Signature" style="max-height:36px;max-width:200px;margin-top:4px;border:1px solid #e2e8f0;background:#fff;padding:2px;border-radius:3px"/>`
  : "";

/** Right-aligned block for the formal "authenticated" signature panel. */
export const sigImgPanel = (src) => isSafeSigSrc(src)
  ? `<div style="margin-left:auto;text-align:center;flex:none"><img src="${esc(src)}" alt="Signature" style="max-height:38px;max-width:170px;border:1px solid #e2e8f0;background:#fff;padding:2px 8px;border-radius:5px"/><div style="font-size:8px;color:#94a3b8;letter-spacing:.5px;text-transform:uppercase;margin-top:2px">e-signature</div></div>`
  : "";
