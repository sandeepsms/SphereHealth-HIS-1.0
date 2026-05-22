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

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    // If 401 from server (expired/invalid token), clear session and redirect to login
    if (error?.response?.status === 401) {
      const isLoginRoute = error?.config?.url?.includes("/auth/login");
      if (!isLoginRoute) {
        try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) {}
        try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);
