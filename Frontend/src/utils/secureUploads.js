/**
 * secureUploads.js — helpers for rendering JWT-protected `/uploads/...` files
 * inside HTML that can't send an Authorization header.
 *
 * Backend serves /uploads behind the same JWT check as the API
 * (Backend/routes/Files/uploadsRoutes.js). React surfaces use
 * <SecureImage> — but two render paths can't:
 *
 *   1. The per-type note-card builders (buildDoctorNoteCardHtml /
 *      buildNurseNoteCardHtml) return raw HTML strings injected via
 *      dangerouslySetInnerHTML — a plain <img src="/uploads/…"> inside
 *      them fires an unauthenticated request → 401.
 *   2. Print windows (window.open + document.write) — same problem, plus
 *      the printed copy must be self-contained.
 *
 * So: `inlineUploadsInHtml(html)` finds every src="/uploads/…", fetches each
 * through axios (the global interceptor attaches the Bearer token — the fetch
 * happens in the AUTHENTICATED calling tab), converts the blob to a data: URL
 * and swaps it in. Data URLs survive document.write, print, and save-as-PDF.
 *
 * A module-level cache keeps this cheap: the same signature image repeats on
 * dozens of notes in a Complete File — it's fetched once per session.
 */
import { useEffect, useState } from "react";
import axios from "axios";

// src → Promise<dataUrl|null>. Promise-cached so 40 concurrent cards asking
// for the same signature trigger exactly one request.
const _cache = new Map();

export function fetchUploadAsDataUrl(src) {
  if (typeof src !== "string" || !src.startsWith("/uploads/")) {
    return Promise.resolve(null);
  }
  if (_cache.has(src)) return _cache.get(src);
  const p = axios
    .get(src, { responseType: "blob" })
    .then(
      (res) =>
        new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result || "") || null);
          fr.onerror = () => resolve(null);
          fr.readAsDataURL(res.data);
        }),
    )
    .catch(() => {
      // Don't poison the cache with a transient failure (expired token,
      // network blip) — allow a retry on the next render.
      _cache.delete(src);
      return null;
    });
  _cache.set(src, p);
  return p;
}

// Matches src="/uploads/…" | src='/uploads/…' in builder HTML. The builders
// escapeHtml() their srcs, so quotes inside the path can't break the match.
const UPLOADS_SRC_RE = /src=(["'])(\/uploads\/[^"']+)\1/g;

/** Does this HTML reference any protected /uploads file at all? (fast path) */
export function htmlHasUploads(html) {
  return typeof html === "string" && html.includes('src="/uploads/');
}

/**
 * Replace every /uploads img src in `html` with an authenticated data: URL.
 * Failures leave that src untouched (the <img> degrades to a broken/empty
 * frame — same as pre-auth behaviour). Never rejects.
 */
export async function inlineUploadsInHtml(html) {
  if (typeof html !== "string" || !html.includes("/uploads/")) return html;
  const srcs = new Set();
  for (const m of html.matchAll(UPLOADS_SRC_RE)) srcs.add(m[2]);
  if (srcs.size === 0) return html;
  const resolved = new Map();
  await Promise.all(
    [...srcs].map(async (s) => {
      const dataUrl = await fetchUploadAsDataUrl(s);
      if (dataUrl) resolved.set(s, dataUrl);
    }),
  );
  if (resolved.size === 0) return html;
  return html.replace(UPLOADS_SRC_RE, (full, q, src) =>
    resolved.has(src) ? `src=${q}${resolved.get(src)}${q}` : full,
  );
}

/**
 * React hook for dangerouslySetInnerHTML call sites. Returns the input
 * unchanged when it references no /uploads file (sync fast path — the
 * common case, signatures are data: URLs today); otherwise returns the
 * HTML with /uploads srcs blanked while the authenticated fetch runs,
 * then the inlined version. Blanking first means the browser never fires
 * a doomed unauthenticated /uploads request from the raw markup.
 */
export function useInlinedUploadsHtml(html) {
  const needsWork = htmlHasUploads(html);
  const [inlined, setInlined] = useState(null);

  useEffect(() => {
    if (!needsWork) return undefined;
    let alive = true;
    setInlined(null);
    inlineUploadsInHtml(html).then((out) => {
      if (alive) setInlined(out);
    });
    return () => {
      alive = false;
    };
  }, [html, needsWork]);

  if (!needsWork) return html;
  if (inlined) return inlined;
  // Pending: strip the protected srcs so no unauthenticated request fires.
  return html.replace(UPLOADS_SRC_RE, 'src=""');
}
