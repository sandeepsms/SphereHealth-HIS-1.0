// utils/authFetch.js
// Drop-in `fetch` replacement that attaches the JWT from localStorage
// to the Authorization header. Use this anywhere we'd otherwise call
// `fetch()` against an authenticated API endpoint.
//
// Why not just use axios everywhere? Some endpoints stream (SSE) or
// upload files and the raw fetch / EventSource API is cleaner.

export function authToken() {
  try { return (sessionStorage.getItem("his_token") || localStorage.getItem("his_token")) || ""; } catch { return ""; }
}

export default function authFetch(url, options = {}) {
  const token = authToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, { ...options, headers });
}
