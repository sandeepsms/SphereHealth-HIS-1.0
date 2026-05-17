import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../config/api";
import { roleCan, roleSeesModule, homePathForRole } from "../config/permissions";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);   // current user object
  const [token, setToken]     = useState(() => localStorage.getItem("his_token") || null);
  const [loading, setLoading] = useState(true);   // initial session check

  /* ── Restore session on mount ── */
  useEffect(() => {
    const restore = async () => {
      const saved = localStorage.getItem("his_token");
      if (!saved) { setLoading(false); return; }
      try {
        const res = await axios.get(API_ENDPOINTS.AUTH_ME, {
          headers: { Authorization: `Bearer ${saved}` },
        });
        setUser(res.data.user);
        setToken(saved);
      } catch {
        localStorage.removeItem("his_token");
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    restore();
  }, []);

  /* ── Login ── */
  const login = useCallback(async (email, password) => {
    const res = await axios.post(API_ENDPOINTS.AUTH_LOGIN, { email, password });
    const { token: t, user: u } = res.data;
    localStorage.setItem("his_token", t);
    setToken(t);
    setUser(u);
    return u;
  }, []);

  /* ── Logout ──
     Sweeps every PHI-tinged cache (nursing assessments, reception drafts,
     break-glass tokens) from local + session storage so the next user on
     a shared terminal can't open DevTools and harvest the previous user's
     patient context. Security audit 2026-05-17 finding E-01 / E-02. */
  const logout = useCallback(() => {
    localStorage.removeItem("his_token");
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
    setToken(null);
    setUser(null);
  }, []);

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
    <AuthContext.Provider value={{ user, token, loading, login, logout, hasRole, isAdmin, can, seesModule, homePath }}>
      {children}
    </AuthContext.Provider>
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
