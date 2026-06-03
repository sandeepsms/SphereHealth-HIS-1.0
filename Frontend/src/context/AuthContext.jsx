import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../config/api";
import { roleCan, roleSeesModule, homePathForRole } from "../config/permissions";
import { getAuthToken } from "../config/axiosInterceptor";

const AuthContext = createContext(null);

// R7y: JWT lives in sessionStorage (per-tab) so the user can hold
// six different role sessions side-by-side in one Chrome window.
// See axiosInterceptor.js for the migration logic.
const TOKEN_KEY = "his_token";
// R7cf: also persist a minimal user snapshot so popup print windows
// (PrintShell + inline window.open() handlers) can render the digital-
// signature stamp without making a /me round-trip. sessionStorage is
// shared with new-window children of the same tab, so the stamp lands
// even on first paint.
const USER_KEY  = "his_user";
const setStoredUser = (u) => {
  try {
    if (!u) { sessionStorage.removeItem(USER_KEY); return; }
    // Only the small subset the signature stamp + downstream code reads.
    const minimal = {
      id:         u._id || u.id || null,
      fullName:   u.fullName || u.name || "",
      employeeId: u.employeeId || "",
      role:       u.role || "",
      department: u.department || u.doctorDetails?.department || "",
      designation: u.designation || u.doctorDetails?.designation || "",
    };
    sessionStorage.setItem(USER_KEY, JSON.stringify(minimal));
  } catch (_) {}
};
const clearStoredUser = () => { try { sessionStorage.removeItem(USER_KEY); } catch (_) {} };
const setStoredToken = (t) => {
  try { sessionStorage.setItem(TOKEN_KEY, t); } catch (_) {}
  // Also clear any stale localStorage copy so the migration path
  // doesn't keep resurrecting an old token.
  try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
};
const clearStoredToken = () => {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) {}
  try { localStorage.removeItem(TOKEN_KEY); } catch (_) {}
};

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);   // current user object
  // R7f: when role === "Doctor", backend /api/auth/me also returns the
  // linked Doctor collection profile (id + doctorId). Frontend uses this
  // for "am I the consultant of record?" checks because Admission stores
  // `attendingDoctorId` as the Doctor collection's _id (NOT the User _id).
  const [doctorProfile, setDoctorProfile] = useState(null);
  const [token, setToken]     = useState(() => getAuthToken());
  const [loading, setLoading] = useState(true);   // initial session check
  // R7bb-E/S2 / D8-MED — Surface password-change banner when backend
  // sends `mustChangePassword: true` on /auth/login or /auth/me.
  // Consumers can read `mustChangePassword` from context and route
  // accordingly. We also expose a quick-modal flag controlled by the
  // ChangePasswordPrompt component below.
  const [mustChangePassword, setMustChangePassword] = useState(false);

  /* ── Restore session on mount ──
   * R7bu — Pre-R7bu the catch block nuked the session on ANY error.
   * That meant a single transient blip on the first /auth/me of a
   * fresh page load (Mongo replica lag, backend cold-start, network
   * burp) silently logged the user out. Combined with React strict-
   * mode double-mounting in dev + every route change re-running this
   * effect, users saw "baar baar logout" symptoms.
   *
   * Now only nuke the session on definitive hard-logout codes from
   * the backend. Transient errors keep the stored token in place and
   * keep the in-memory user from the previous render so the UI stays
   * logged in. Next foreground API call will surface the real state.
   */
  const HARD_LOGOUT_CODES = new Set([
    "TOKEN_STALE", "ACCOUNT_INACTIVE", "ROLE_CHANGED",
    "USER_DELETED", "TOKEN_REVOKED", "TOKEN_EXPIRED", "TOKEN_INVALID",
  ]);

  // R7bu — decode JWT payload locally (no signature check, no network).
  // Used on transient /auth/me failure so we can keep a minimal `user`
  // state in memory while the backend recovers. ProtectedRoute guards
  // gate on user being truthy — without this they kick to /login even
  // though the token is still valid in storage.
  const _decodeJwtPayloadUnsafe = (jwt) => {
    try {
      const parts = String(jwt || "").split(".");
      if (parts.length !== 3) return null;
      // base64url → base64; pad to length multiple of 4
      let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      const json = atob(b64);
      const payload = JSON.parse(json);
      if (payload.exp && payload.exp * 1000 < Date.now()) return null; // expired
      return payload;
    } catch (_) { return null; }
  };
  useEffect(() => {
    // R7au-2: cancellation flag — pre-R7au the restore() promise had no
    // cancel path. If the user clicked Login while restore() was still
    // pending (cold backend, slow Mongo), the restore catch could fire
    // AFTER login() succeeded and silently overwrite the new user with the
    // JWT-decoded fallback (or null on a hard-logout code). Symptom: user
    // saw login succeed, navigated home, then 200ms later got kicked to
    // /login or saw a stale user. Now every setState in this effect is
    // guarded by `cancelled` so a late-arriving response is dropped.
    let cancelled = false;
    const restore = async () => {
      const saved = getAuthToken();
      if (!saved) { if (!cancelled) setLoading(false); return; }
      try {
        const res = await axios.get(API_ENDPOINTS.AUTH_ME, {
          headers: { Authorization: `Bearer ${saved}` },
          // R7bu: flag as background poll so the global interceptor's
          // transient-counter doesn't accumulate this call against a
          // user-initiated foreground action that may follow.
          _isBackgroundPoll: true,
        });
        if (cancelled) return; // R7au-2
        setUser(res.data.user);
        setStoredUser(res.data.user); // R7cf: keep print-window mirror fresh
        setDoctorProfile(res.data.doctorProfile || null);
        // R7bb-E/S2 — /auth/me may also surface mustChangePassword
        // (e.g. admin forced a reset after the user logged in).
        if (res.data.mustChangePassword || res.data.user?.mustChangePassword) {
          setMustChangePassword(true);
        }
        setToken(saved);
      } catch (err) {
        if (cancelled) return; // R7au-2 — swallow late failures after login/unmount
        // R7bu: only nuke the session on a definitive auth-end signal
        // from the backend (HARD_LOGOUT_CODES). Anything else — network
        // timeout, 5xx, Mongo blip, CORS preflight, backend restart —
        // is recoverable; keep the token so the next foreground request
        // either succeeds or surfaces a real auth code.
        const status = err?.response?.status;
        const code   = err?.response?.data?.code;
        const isHardLogout = status === 401 && code && HARD_LOGOUT_CODES.has(code);
        if (isHardLogout) {
          clearStoredToken();
          setToken(null);
          setUser(null);
          setDoctorProfile(null);
          setMustChangePassword(false);
        } else {
          // Transient — keep token + reconstruct a minimal user from
          // the JWT payload so ProtectedRoute guards (which gate on
          // user being truthy) don't kick the user to /login while
          // the backend recovers. Next foreground /auth/me success
          // will replace this with the canonical server-side user.
          const payload = _decodeJwtPayloadUnsafe(saved);
          if (payload?.id) {
            // R7au-5: synthesize firstName/lastName from fullName so
            // chrome components that still read user.firstName don't
            // render "undefined undefined" while running on the JWT
            // fallback user. Best-effort split — single-word fullName
            // (e.g. "Admin") goes to firstName with empty lastName.
            const nameParts = String(payload.fullName || "").trim().split(/\s+/);
            const _firstName = nameParts[0] || "";
            const _lastName  = nameParts.slice(1).join(" ") || "";
            setUser({
              _id: payload.id,
              id: payload.id,
              role: payload.role,
              employeeId: payload.employeeId,
              fullName: payload.fullName || "",
              firstName: _firstName, // R7au-5
              lastName:  _lastName,  // R7au-5
              tokenVersion: payload.tokenVersion,
              mustChangePassword: payload.mustChangePassword === true,
              _restoredFromJwt: true, // diagnostic flag
            });
          }
          setToken(saved);
          // eslint-disable-next-line no-console
          console.warn("[auth] /auth/me restore failed (transient, keeping session):", status, code, err?.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    restore();
    return () => { cancelled = true; };
  }, []);

  /* ── Login ── */
  const login = useCallback(async (email, password) => {
    const res = await axios.post(API_ENDPOINTS.AUTH_LOGIN, { email, password });
    const { token: t, user: u, doctorProfile: dp, mustChangePassword: mcp } = res.data;
    setStoredToken(t); // R7y: writes to sessionStorage (per-tab)
    setToken(t);
    // R7bc — defensive backfill for tokenVersion (and isActive) on the
    // login user object. The backend was already fixed to include both
    // fields, but older deployments or in-flight cached client builds
    // may still hit a backend that doesn't send them. Decode the JWT we
    // just received and pull tokenVersion from its payload as a fallback
    // — same value the backend's authenticate middleware will compare
    // against on subsequent requests, so the frontend's refreshIfStale
    // focus-poll won't compare undefined → 0 against fresh.tokenVersion
    // and force-logout the user on a tab switch / screenshot.
    const hydratedUser = { ...u };
    if (hydratedUser.tokenVersion === undefined) {
      const payload = _decodeJwtPayloadUnsafe(t);
      if (payload && payload.tokenVersion !== undefined) {
        hydratedUser.tokenVersion = payload.tokenVersion;
      }
    }
    if (hydratedUser.isActive === undefined) hydratedUser.isActive = true;
    setUser(hydratedUser);
    setStoredUser(hydratedUser); // R7cf: mirror to sessionStorage for print windows
    // R7bb-E/S2 — Backend can return `mustChangePassword: true` either at
    // top-level or nested on user. The ChangePasswordPrompt below will
    // block the UI until it's cleared. Login flow still completes (token
    // is set) so the user can change their password without re-auth.
    if (mcp || u?.mustChangePassword) setMustChangePassword(true);
    else setMustChangePassword(false);

    // R7bx item 8 — MCI Regulation 1.4.2 awareness. Doctors with no MCI
    // registration number on file cannot sign any clinical document
    // (server-side hard-block). Surface a sticky warning on login so the
    // doctor knows to open Settings → Doctor Profile and add the number
    // BEFORE attempting their first sign-and-submit of the session.
    if (hydratedUser?.role === "Doctor") {
      const regNo = String(hydratedUser.doctorDetails?.registrationNumber || "").trim();
      if (!regNo) {
        toast.warn(
          "Your MCI registration number is missing. Add it via 'My Profile' before signing any prescription, OPD note, or discharge summary (MCI Regulation 1.4.2).",
          { autoClose: 12000, toastId: "mci-reg-missing" },
        );
      }
    }
    // login response may not include doctorProfile (older clients);
    // re-fetch /me right after so the value is hydrated for any role check.
    if (dp) {
      setDoctorProfile(dp);
    } else if (u?.role === "Doctor") {
      try {
        const me = await axios.get(API_ENDPOINTS.AUTH_ME, { headers: { Authorization: `Bearer ${t}` } });
        setDoctorProfile(me.data?.doctorProfile || null);
      } catch { /* non-fatal */ }
    }
    // R7fs: tell HospitalSettingsProvider (and any other auth-aware
    // singletons) that we now have a valid JWT — they can re-fetch
    // private data. Even though the hospital-settings GET is public
    // post-R7fs, this event also covers the case where admin edited
    // the settings just before this user logged in, so their session
    // pulls the freshest copy instead of whatever the unauthenticated
    // first-paint fetch saw.
    try { window.dispatchEvent(new CustomEvent("his:auth-changed", { detail: { kind: "login" } })); } catch { /* non-fatal */ }
    return u;
  }, []);

  /* ── Logout ──
     Sweeps every PHI-tinged cache (nursing assessments, reception drafts,
     break-glass tokens) from local + session storage so the next user on
     a shared terminal can't open DevTools and harvest the previous user's
     patient context. Security audit 2026-05-17 finding E-01 / E-02. */
  const logout = useCallback(() => {
    clearStoredToken(); // R7y: scrubs both sessionStorage + any stale localStorage
    // PHI prefixes used by NABH nursing pages + reception autosave +
    // break-glass justifications. Keep this list in sync with whatever
    // pages call localStorage.setItem with a patient-scoped key.
    const phiPrefixes = ["nabh_", "his_patient_", "his_admission_", "rc_", "sphereai_"];
    for (const store of [window.localStorage, window.sessionStorage]) {
      try {
        const keys = Object.keys(store);
        for (const k of keys) {
          if (phiPrefixes.some((p) => k.startsWith(p))) store.removeItem(k);
          if (k.startsWith("break-glass:")) store.removeItem(k);
        }
      } catch {
        // private-mode browser may throw on storage access — ignore
      }
    }
    // R7bb-FIX-D-22 / D8-HIGH-7 — Cross-tab logout broadcast. Token lives
    // in sessionStorage (per-tab), so other tabs can't see ours being
    // cleared. Pulse a localStorage signal whose only purpose is to fire
    // a 'storage' event in every other tab — they'll catch it and tear
    // down their own session in the focus/storage effect above. Use a
    // changing value (Date.now) so consecutive logouts still fire the
    // event even if the key already exists.
    try { localStorage.setItem("his_logout_signal", String(Date.now())); } catch (_) {}
    try { localStorage.removeItem("his_logout_signal"); } catch (_) {}
    setToken(null);
    setUser(null);
    clearStoredUser(); // R7cf: drop the print-window mirror on logout
    setDoctorProfile(null);
    setMustChangePassword(false);
    // R7fs: notify HospitalSettingsProvider that auth state changed so
    // it can re-pull a clean copy on the login screen (hospital identity
    // is public branding, but the listener stays symmetric with login).
    try { window.dispatchEvent(new CustomEvent("his:auth-changed", { detail: { kind: "logout" } })); } catch { /* non-fatal */ }
  }, []);

  /* ── R7bb-E/S2 — 401-with-code interceptor ──
     Backend sweeps stale tokens (rotated secret, role changed, account
     deactivated) by returning 401 with a `code` field. axiosInterceptor
     in /config already redirects to /login on plain 401, but it doesn't
     show a toast or distinguish the cause. We layer an extra response
     interceptor here so the user gets a meaningful "Session terminated"
     toast on TOKEN_STALE / ACCOUNT_INACTIVE / ROLE_CHANGED before the
     hard redirect. We attach exactly once via a ref so React StrictMode
     doesn't double-bind.

     R7bb — Honor the `_isBackgroundPoll: true` request flag here, mirroring
     the global axiosInterceptor in /config. Pre-R7bb this interceptor fired
     logout() on EVERY hard-logout 401 — including background polls fired
     by the focus / visibilitychange listeners on tab switch. Symptom:
     when a user Alt-Tabbed away and came back, the focus listener kicked
     off /auth/me as a background poll; if the backend's 60s LRU cache lag
     (or any other transient race) made that one /auth/me return TOKEN_STALE,
     this interceptor ripped the session away even though the global
     interceptor would have correctly swallowed it. Now both interceptors
     agree: background polls NEVER trigger an automatic logout. The
     user's next foreground action will surface the real auth state. */
  const interceptorRef = useRef(null);
  useEffect(() => {
    if (interceptorRef.current != null) return;
    interceptorRef.current = axios.interceptors.response.use(
      (resp) => resp,
      (error) => {
        const status = error?.response?.status;
        const code   = error?.response?.data?.code;
        const isBackgroundPoll = error?.config?._isBackgroundPoll === true;
        // R7bb — bail before the toast + logout so background polls
        // (focus refresh, idle ping, etc.) never punt the user.
        if (isBackgroundPoll) {
          return Promise.reject(error);
        }
        if (status === 401 && (code === "TOKEN_STALE" || code === "ACCOUNT_INACTIVE" || code === "ROLE_CHANGED")) {
          // logout() scrubs PHI caches, the generic axios interceptor in
          // /config then hard-redirects to /login. Show the toast first so
          // it has a chance to render before navigation.
          try {
            toast.error("Your session has been terminated. Please log in again.", { autoClose: 5000 });
          } catch (_) {}
          try { logout(); } catch (_) {}
        }
        return Promise.reject(error);
      },
    );
    return () => {
      // Don't actually eject — the interceptor must live for the app's
      // lifetime. Cleaning up here would re-add it on every remount.
    };
    // logout is stable (useCallback []), safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── R7bb-FIX-D-15 / D5-MED-2 — Role-change & termination refresh ──
     Two surfaces catch a stale session before the user does damage:
       1. window 'focus' — when the user switches back to the tab, re-fetch
          /auth/me. If role or tokenVersion changed (Admin promoted /
          deactivated the user), force-logout so they re-auth into the
          new role.
       2. 'storage' event — another tab logged out; mirror that here
          (cross-tab logout, see D-22 below). Token is in sessionStorage
          (per-tab) so we use a localStorage signal key for cross-tab
          coordination: any tab calling logout writes
          `his_logout_signal = <Date.now()>` to localStorage, every other
          tab picks it up via the 'storage' event.
     Both effects share the same role+tokenVersion compare. */
  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    // R7br: dedup /auth/me calls. Rapid Alt+Tab can fire 4+ focus events in
    // a second; without this guard each fires a parallel /auth/me, all four
    // landing close together — if Mongo replica lag returns even one
    // transient 401, the interceptor's counter trips immediately. Shared
    // promise across concurrent callers; reset to null on settle.
    let inFlight = null;
    const refreshIfStale = async () => {
      const t = getAuthToken();
      if (!t) return;
      if (inFlight) return inFlight;       // another call already in flight
      inFlight = (async () => {
      try {
        // R7bm-F9: mark as background poll so a transient 401 from /auth/me
        // (mongo replica blip, network hiccup) doesn't punt the user. The
        // interceptor's transient counter still handles persistent failures
        // — they'll redirect once the user actively navigates.
        const res = await axios.get(API_ENDPOINTS.AUTH_ME, {
          headers: { Authorization: `Bearer ${t}` },
          _isBackgroundPoll: true,
        });
        if (cancelled) return;
        const fresh = res.data?.user;
        if (!fresh) return;
        const roleChanged    = fresh.role !== user.role;
        const tokenChanged   = (fresh.tokenVersion ?? 0) !== (user.tokenVersion ?? 0);
        const becameInactive = fresh.isActive === false;
        if (roleChanged || tokenChanged || becameInactive) {
          try {
            toast.warn(
              becameInactive
                ? "Your account was deactivated. Please log in again."
                : roleChanged
                  ? "Your role was updated. Please log in again to refresh permissions."
                  : "Your session was rotated. Please log in again.",
              { autoClose: 6000 },
            );
          } catch (_) {}
          try { logout(); } catch (_) {}
          // Hard redirect so React state, route guards and module cache
          // all reload against the new role.
          try { window.location.href = "/login"; } catch (_) {}
        } else if (user._restoredFromJwt) {
          // R7bv — we were running on JWT-decoded minimal user data
          // (backend was down when the page loaded). Now that /auth/me
          // succeeded, replace with the canonical server-side user so
          // fullName, doctorProfile, etc. show up properly. Same path
          // hydrates doctorProfile that the restore() catch couldn't
          // fetch.
          setUser(fresh);
          if (res.data?.doctorProfile) setDoctorProfile(res.data.doctorProfile);
        }
      } catch (_) {
        // R7bm-F9: transient errors are deliberately swallowed here.
        // A real session termination will surface on the user's next
        // foreground action via the global interceptor (TOKEN_STALE etc.).
      }
      })().finally(() => { inFlight = null; });
      return inFlight;
    };

    // R7bc — Debounce focus refresh to 5 minutes. Pre-R7bc every focus
    // event (tab switch, Alt+Tab, screenshot-tool dismissal, OS popup
    // dismissal, etc.) fired /auth/me. Even after R7bb cleaned up the
    // interceptor side and R7bc gave login a tokenVersion, polling on
    // every focus is still wasteful and any backend hiccup during the
    // poll could surface as a disruption. We genuinely only need the
    // staleness check when the user has been away long enough that an
    // admin could realistically have changed their role / deactivated
    // them — 5 minutes is more than enough.
    let lastFocusRefreshAt = 0;
    const FOCUS_REFRESH_DEBOUNCE_MS = 5 * 60 * 1000;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefreshAt < FOCUS_REFRESH_DEBOUNCE_MS) return;
      lastFocusRefreshAt = now;
      refreshIfStale();
    };
    const onStorage = (e) => {
      // R7bb-FIX-D-22 / D8-HIGH-7 — cross-tab logout signal. When ANY
      // tab logs out it writes `his_logout_signal`; every other tab
      // sees the storage event and tears down its own session.
      if (e.key === "his_logout_signal") {
        try { logout(); } catch (_) {}
        try { window.location.href = "/login"; } catch (_) {}
      }
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
    // logout is stable; depend on user identity so an actual login swap
    // restarts the listener bound against the new user object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.tokenVersion, user?._id]);

  /* ── R7bb-FIX-D-23 / D8-MED-1 — 30-minute idle timer ──
     Force-logout after 30 minutes with no mouse, keyboard or touch
     activity. Resets on any input. Idle is computed in real time off a
     timestamp ref so we don't reset a setTimeout on every keystroke
     (which would thrash). A single interval ticks once a minute and
     compares wall-clock difference.

     R7au-3: pre-R7au this fired INSTANTLY when a laptop woke from a
     >30min sleep — `setInterval` doesn't tick while the OS is suspended
     but `Date.now()` keeps walking forward, so the first tick after wake
     found a 30min+ gap and force-logged-out before the user even saw the
     screen. Two defenses:
       1) visibilitychange + focus listeners bump idleRef when the tab
          regains focus — treats "user came back to the tab" as activity.
       2) gap-detection on the interval itself — if more than 90s elapsed
          since the previous tick (laptop was almost certainly asleep),
          treat the gap as suspension, NOT inactivity: bump idleRef to
          "now" instead of firing logout. Genuine 30min idle ticks every
          60s without these gaps, so the inactivity logout still fires
          for actually-idle users. */
  const idleRef = useRef(Date.now());
  useEffect(() => {
    if (!user) return;
    const IDLE_MS = 30 * 60 * 1000; // 30 min
    const TICK_MS = 60 * 1000;
    const SUSPEND_GAP_MS = 90 * 1000; // R7au-3: gap > 90s = OS suspend, not idle
    const bump = () => { idleRef.current = Date.now(); };
    const evts = ["mousedown", "mousemove", "keydown", "touchstart", "wheel", "scroll"];
    for (const ev of evts) window.addEventListener(ev, bump, { passive: true });
    // R7au-3: tab-return events also count as activity. Without these the
    // user could Alt+Tab away for 31 minutes and get instantly logged out
    // when they came back — same root cause as the suspend/wake case.
    const onVisibility = () => { if (!document.hidden) bump(); };
    const onFocus = () => bump();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    idleRef.current = Date.now(); // reset on (re-)login
    let _lastTickAt = Date.now(); // R7au-3: suspend-gap detector

    const id = setInterval(() => {
      const now = Date.now();
      const gap = now - _lastTickAt;
      _lastTickAt = now;
      // R7au-3: a tick gap >90s almost always means the OS was suspended
      // (lid closed, sleep, hibernate) — Date.now() walked but setInterval
      // did not. Treat that as a wake event, not as accumulated idle time.
      if (gap > SUSPEND_GAP_MS) {
        idleRef.current = now;
        // eslint-disable-next-line no-console
        console.info("[auth] idle timer: detected", Math.round(gap / 1000), "s gap (probable suspend) — resetting idle window");
        return;
      }
      if (now - idleRef.current >= IDLE_MS) {
        try {
          toast.info("Logged out due to 30 minutes of inactivity.", { autoClose: 5000 });
        } catch (_) {}
        try { logout(); } catch (_) {}
        try { window.location.href = "/login"; } catch (_) {}
      }
    }, TICK_MS);

    return () => {
      clearInterval(id);
      for (const ev of evts) window.removeEventListener(ev, bump);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id]);

  /* ── Role helpers ── */
  const hasRole     = useCallback((...roles) => user && roles.includes(user.role), [user]);
  const isAdmin     = useCallback(() => hasRole("Admin"), [hasRole]);
  // Fine-grained: can the current user perform a named action?
  const can         = useCallback((action) => user && roleCan(user.role, action), [user]);
  // Should the sidebar / top-level navigation show this module?
  const seesModule  = useCallback((moduleId) => user && roleSeesModule(user.role, moduleId), [user]);
  // Where should this role be sent on login / "Home"?
  const homePath    = user ? homePathForRole(user.role) : "/login";

  return (
    <AuthContext.Provider value={{ user, doctorProfile, token, loading, login, logout, hasRole, isAdmin, can, seesModule, homePath, mustChangePassword, clearMustChangePassword: () => setMustChangePassword(false) }}>
      {children}
      {/* R7bb-E/S2 — Modal-style password-change prompt. Renders on top
          of the app when backend says the password must rotate. Closing
          requires a successful PUT /users/change-password. */}
      {user && mustChangePassword && <ChangePasswordPrompt />}
    </AuthContext.Provider>
  );
}

/* ─── R7bb-E/S2 — Forced password change modal ─────────────────
   A blocking overlay shown when /auth/login or /auth/me returns
   mustChangePassword: true. Backend route is PUT /users/change-password
   (authenticate-only — see Backend/routes/User/userRoutes.js).
─────────────────────────────────────────────────────────────── */
function ChangePasswordPrompt() {
  const { clearMustChangePassword, logout } = useAuth();
  const [curr, setCurr]   = useState("");
  const [next1, setNext1] = useState("");
  const [next2, setNext2] = useState("");
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState("");
  // R7au-6: track the post-success logout timer so we can cancel it when
  // the modal unmounts. Pre-R7au the setTimeout fired logout() 800ms after
  // success no matter what — if the user closed the modal or navigated
  // during that window, logout still fired against a stale component and
  // kicked them mid-navigation. Now we clear the timer on unmount.
  const _pendingLogoutRef = useRef(null);
  useEffect(() => {
    return () => {
      if (_pendingLogoutRef.current) {
        clearTimeout(_pendingLogoutRef.current);
        _pendingLogoutRef.current = null;
      }
    };
  }, []);

  // R7bc-FIX-1: client-side mirror of Backend/utils/passwordPolicy.js so the
  // user sees every failing rule INLINE before the round-trip, plus we
  // surface the backend's `reasons[]` if it still rejects.
  const policyChecks = (pw) => {
    const r = [];
    if (pw.length < 10) r.push("at least 10 characters");
    if (!/[A-Z]/.test(pw)) r.push("an uppercase letter");
    if (!/[a-z]/.test(pw)) r.push("a lowercase letter");
    if (!/[0-9]/.test(pw)) r.push("a digit");
    if (!/[^a-zA-Z0-9]/.test(pw)) r.push("a special character");
    if (/\s/.test(pw)) r.push("no whitespace");
    return r;
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    setErr("");
    if (!curr || !next1 || !next2) { setErr("All fields are required."); return; }
    if (next1 !== next2) { setErr("New passwords don't match."); return; }
    if (next1 === curr)  { setErr("New password must be different from the current one."); return; }
    const missing = policyChecks(next1);
    if (missing.length) {
      setErr(`Password needs: ${missing.join(", ")}.`);
      return;
    }
    setBusy(true);
    try {
      // R7bc-FIX-1: body key is `oldPassword` (matches backend controller —
      // Backend/controllers/User/userController.js line 484). The prior key
      // `currentPassword` made the backend reject every request as
      // "Old password and new password are required" but the modal swallowed
      // the error because the controller returned `success:false` not an HTTP
      // error in some paths.
      await axios.put(
        `${API_ENDPOINTS.USERS}/change-password`,
        { oldPassword: curr, newPassword: next1 },
      );
      try { toast.success("Password updated. Please sign in again with your new password."); } catch (_) {}
      clearMustChangePassword();
      // R7bc-FIX-1: backend bumps tokenVersion on success → this session's JWT
      // is now invalid. Force re-login so the user doesn't see a stream of
      // 401s. Tiny delay so the toast is visible.
      // R7au-6: store the timer ID so the unmount cleanup can cancel it
      // if the user navigates away (or React StrictMode re-mounts) before
      // the timer fires.
      _pendingLogoutRef.current = setTimeout(() => {
        _pendingLogoutRef.current = null;
        logout();
      }, 800);
    } catch (e2) {
      const data = e2?.response?.data;
      // R7bc-FIX-1: show the backend's `reasons[]` array if present so the
      // user knows *which* rules they failed, not just the first one.
      const reasons = Array.isArray(data?.reasons) ? data.reasons.join("; ") : null;
      setErr(reasons || data?.message || "Could not change password. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,.62)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 99999, padding: 16,
    }}>
      <form onSubmit={submit} style={{
        width: "min(440px, 96vw)", background: "#fff",
        borderRadius: 16, boxShadow: "0 24px 60px rgba(15,23,42,.4)",
        padding: 28,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: "#fef3c7", color: "#a16207",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="pi pi-lock" style={{ fontSize: 20 }} />
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#1e293b" }}>Password change required</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              For security, set a new password before continuing.
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: ".3px" }}>Current password</label>
            <input type="password" autoComplete="current-password" autoFocus
              value={curr} onChange={(e) => setCurr(e.target.value)}
              style={{ width: "100%", marginTop: 4, padding: "8px 12px", border: "1.5px solid #cbd5e1", borderRadius: 8, fontSize: 13, outline: "none" }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: ".3px" }}>New password</label>
            <input type="password" autoComplete="new-password"
              value={next1} onChange={(e) => setNext1(e.target.value)}
              style={{ width: "100%", marginTop: 4, padding: "8px 12px", border: "1.5px solid #cbd5e1", borderRadius: 8, fontSize: 13, outline: "none" }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#475569", letterSpacing: ".3px" }}>Confirm new password</label>
            <input type="password" autoComplete="new-password"
              value={next2} onChange={(e) => setNext2(e.target.value)}
              style={{ width: "100%", marginTop: 4, padding: "8px 12px", border: "1.5px solid #cbd5e1", borderRadius: 8, fontSize: 13, outline: "none" }} />
          </div>
          {/* R7bc-FIX-1: inline policy hints so users know the rules upfront */}
          <div style={{ fontSize: 11, color: "#475569", background: "#f1f5f9", border: "1px solid #cbd5e1", padding: "8px 10px", borderRadius: 7, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Password must contain:</div>
            • ≥10 characters &nbsp;•&nbsp; uppercase letter &nbsp;•&nbsp; lowercase letter<br />
            • digit &nbsp;•&nbsp; special character &nbsp;•&nbsp; no spaces
          </div>
          {err && (
            <div style={{ fontSize: 12, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", padding: "8px 10px", borderRadius: 7, fontWeight: 600 }}>
              {err}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" onClick={() => { logout(); }} disabled={busy}
            style={{ padding: "9px 16px", background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, fontWeight: 600, color: "#64748b", cursor: "pointer" }}>
            Log out
          </button>
          <button type="submit" disabled={busy}
            style={{ padding: "9px 18px", background: busy ? "#94a3b8" : "#1e40af", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>
            {busy ? "Saving…" : "Update password"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── <RoleGuard> ────────────────────────────────────────────────
   Route-level guard. Children render only if the user has any of
   the allowed roles. Otherwise show an inline "Access denied"
   block — no silent 404. Useful for protecting sensitive routes
   like /admin/users, /hospital-settings, /pharmacy/settings.
─────────────────────────────────────────────────────────────────── */
export function RoleGuard({ allow = [], action, children, fallback }) {
  const { user, loading, hasRole, can } = useAuth();
  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>Checking access…</div>;
  if (!user) return <div style={{ padding: 40, textAlign: "center", color: "#dc2626", fontWeight: 700 }}>Not signed in.</div>;
  const ok = (allow.length === 0 || hasRole(...allow)) && (!action || can(action));
  if (!ok) {
    return fallback || (
      <div style={{ padding: 40, maxWidth: 520, margin: "60px auto", textAlign: "center", background: "#fff", border: "1.5px solid #fecaca", borderRadius: 12 }}>
        <i className="pi pi-lock" style={{ fontSize: 36, color: "#dc2626", marginBottom: 10, display: "block" }} />
        <div style={{ fontSize: 17, fontWeight: 800, color: "#1e293b" }}>Access denied</div>
        <div style={{ fontSize: 13, color: "#64748b", marginTop: 6 }}>
          Your role <b>{user.role}</b> doesn't have permission for this page.
          {action && <> Required action: <code style={{ fontFamily: "DM Mono, monospace", background: "#fef2f2", padding: "1px 6px", borderRadius: 3 }}>{action}</code>.</>}
        </div>
      </div>
    );
  }
  return children;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};
