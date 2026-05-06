import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../config/api";

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

  /* ── Logout ── */
  const logout = useCallback(() => {
    localStorage.removeItem("his_token");
    setToken(null);
    setUser(null);
  }, []);

  /* ── Role helpers ── */
  const hasRole = useCallback((...roles) => user && roles.includes(user.role), [user]);
  const isAdmin = useCallback(() => hasRole("Admin"), [hasRole]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, hasRole, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
};
