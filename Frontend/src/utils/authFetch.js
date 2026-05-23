// utils/authFetch.js
// Drop-in `fetch` replacement that attaches the JWT from sessionStorage
// to the Authorization header. Use this anywhere we'd otherwise call
// `fetch()` against an authenticated API endpoint.
//
// Why not just use axios everywhere? Some endpoints stream (SSE) or
// upload files and the raw fetch / EventSource API is cleaner.
//
// R7bh-F9 / R7bg-10-HIGH-6 — Token storage is sessionStorage-only
// (per R7y migration). The legacy `localStorage.his_token` fallback
// chain was a stale safety net that kept the cross-tab session-bleed
// vector alive: if a script ever managed to write to localStorage,
// every tab on the origin would suddenly authenticate as that user.
// A one-time module-load cleanup wipes any leftover localStorage
// copy so subsequent reads have nothing to fall back to.

if (typeof window !== "undefined") {
  try { localStorage.removeItem("his_token"); } catch (_) { /* private-mode browser */ }
}

export function authToken() {
  try { return sessionStorage.getItem("his_token") || ""; } catch { return ""; }
}

export default function authFetch(url, options = {}) {
  const token = authToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, { ...options, headers });
}
