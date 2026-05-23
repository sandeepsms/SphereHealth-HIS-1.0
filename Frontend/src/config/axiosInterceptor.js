/**
 * Axios request interceptor — attaches JWT token to every request.
 * Import this once in main.jsx before App renders.
 *
 * R7y: JWT moved from localStorage → sessionStorage. localStorage is
 * shared across every tab of the same origin, so a login in tab A
 * would clobber tab B's session — the entire system effectively
 * collapsed to one active user per browser. sessionStorage is
 * per-tab, allowing the user to keep Receptionist / Doctor / Nurse
 * / Pharmacist / Dietician / Ward Boy sessions side-by-side in six
 * regular tabs of one Chrome window. No incognito acrobatics needed.
 *
 * Migration: on first request after this change ships, if the OLD
 * `localStorage.his_token` is still present and sessionStorage is
 * empty, we copy it across (so existing logged-in users don't get
 * kicked to /login on the very next reload). The localStorage copy
 * is then cleared — single source of truth from there on.
 *
 * R7bm-F9: auto-logout cascade fix. The previous implementation hard-
 * redirected to /login on ANY 401 response from any endpoint. A
 * hospital floor session opens ~25 background polls (bed events, MAR
 * refresh, indent queue, OPD queue, dashboard KPIs); a single transient
 * 401 from a Mongo replica blip / network hiccup / tokenVersion race
 * would punt the user mid-prescription. Replaced with:
 *   - Only HARD-LOGOUT on explicit revocation codes (TOKEN_STALE,
 *     ACCOUNT_INACTIVE, ROLE_CHANGED, USER_DELETED, TOKEN_REVOKED).
 *     These are deliberate server-side terminations.
 *   - On a "naked" 401 (no `code`), require TWO consecutive failures
 *     within 8s before redirecting. A single transient blip resets
 *     the counter on the next 2xx. Login + /auth/me bypass this so
 *     the genuine "session expired on app load" case still works.
 *   - Routes opted in to "background poll" semantics via the request
 *     config flag `_isBackgroundPoll: true` NEVER force a logout — they
 *     just bubble the 401 to the caller (which silently keeps polling
 *     until the situation resolves or the user actively navigates).
 */
import axios from "axios";

const TOKEN_KEY = "his_token";

// Pull the active token. Prefer sessionStorage (per-tab); fall back to
// localStorage once (migration) then promote it into sessionStorage.
export function getAuthToken() {
  try {
    const s = sessionStorage.getItem(TOKEN_KEY);
    if (s) return s;
    const l = localStorage.getItem(TOKEN_KEY);
    if (l) {
      sessionStorage.setItem(TOKEN_KEY, l);
      try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
      return l;
    }
  } catch (_) { /* private-mode browser — fall through */ }
  return null;
}

axios.interceptors.request.use(
  (config) => {
    const token = getAuthToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// R7bm-F9 / R7br: explicit codes the BACKEND uses to signal "session is
// over, nothing the client can do". Anything else 401 is treated as a
// transient blip and given two retries' worth of grace before forcing
// redirect.
//
// R7br expanded this set so EVERY 401 from `authenticate()` carries a code
// — pre-R7br three paths returned naked 401s (no code, missing token,
// generic verify failure) which made the interceptor wait for a second
// 401 before logging out. Now all auth-middleware 401s are immediate
// hard-logouts, and the transient counter only fires for true blips
// (Mongo replica lag in non-auth controllers).
const HARD_LOGOUT_CODES = new Set([
  "TOKEN_STALE",        // tokenVersion mismatch (remote logout / role change)
  "ACCOUNT_INACTIVE",   // user.isActive = false / Terminated / Suspended
  "ROLE_CHANGED",       // role rotated since token was issued
  "USER_DELETED",       // user record gone
  "TOKEN_REVOKED",      // jti in revocation list
  "TOKEN_EXPIRED",      // R7br — natural session end (jwt exp)
  "TOKEN_INVALID",      // R7br — malformed/forged JWT
  "NO_TOKEN",           // R7br — Authorization header missing on a protected route
]);

// R7br: rolling counter for transient 401s. Two within
// `TRANSIENT_WINDOW_MS` trigger the redirect; a single one is swallowed.
// Window widened from 8s → 12s — 8s was too tight for high-latency networks
// (3G/5G in low-bandwidth wards), where a single Mongo blip + retry could
// land back-to-back and force-logout even though both are recoverable.
let _transient401Count = 0;
let _transient401FirstAt = 0;
const TRANSIENT_WINDOW_MS = 12_000;
const TRANSIENT_THRESHOLD = 2;

function _redirectToLogin() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) {}
  try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
  // Don't redirect if we're already on /login (login form 401s are normal)
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
}

axios.interceptors.response.use(
  (response) => {
    // A successful response means the token is still good. Reset the
    // transient counter so an earlier blip doesn't accumulate forever.
    if (_transient401Count > 0) {
      _transient401Count = 0;
      _transient401FirstAt = 0;
    }
    return response;
  },
  (error) => {
    const status = error?.response?.status;
    const url    = error?.config?.url || "";
    const code   = error?.response?.data?.code;
    const isBackgroundPoll = error?.config?._isBackgroundPoll === true;
    // R7au-7: auth-form routes are routes where 401 is an EXPECTED user-
    // error response (wrong password / wrong OTP / expired nonce) — the
    // page itself is the recovery surface. We must NOT increment the
    // transient counter OR force a redirect for these, otherwise two
    // typos within 12s would silently log the user out of the auth-form
    // they're actively typing into. Pre-R7au this only covered /auth/login;
    // R7au expands to change-password + 2FA so the entire auth UX is safe.
    const isAuthFormRoute  =
      url.includes("/auth/login") ||
      url.includes("/auth/change-password") ||
      url.includes("/users/change-password") || // legacy route
      url.includes("/2fa/");

    if (status !== 401 || isAuthFormRoute) {
      return Promise.reject(error);
    }

    // Background polls NEVER force a redirect — caller just keeps polling
    // until a real human action either re-authenticates or surfaces the
    // problem. Prevents the "tab in background for 4 hours kicked the user
    // when they came back" class of complaints.
    if (isBackgroundPoll) {
      return Promise.reject(error);
    }

    // Explicit revocation: server says "this session is dead, period".
    // Redirect immediately so the user re-auths against the new state.
    if (code && HARD_LOGOUT_CODES.has(code)) {
      _redirectToLogin();
      return Promise.reject(error);
    }

    // "Naked" 401 — could be a transient blip (token nearly expired and
    // about to be re-issued by /auth/me, Mongo replica lag, etc.). Need
    // TWO within 8s before we yank the user.
    const now = Date.now();
    if (_transient401Count === 0 || (now - _transient401FirstAt) > TRANSIENT_WINDOW_MS) {
      _transient401Count = 1;
      _transient401FirstAt = now;
    } else {
      _transient401Count += 1;
    }

    if (_transient401Count >= TRANSIENT_THRESHOLD) {
      _redirectToLogin();
    }
    return Promise.reject(error);
  }
);
