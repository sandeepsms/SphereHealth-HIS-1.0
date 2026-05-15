import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

/* ── PrivateRoute: require login ── */
export function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <SplashLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

/* ── RoleRoute: require specific roles ── */
export function RoleRoute({ children, roles = [] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <SplashLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (roles.length > 0 && !roles.includes(user.role)) return <AccessDenied />;
  return children;
}

/* ── Full-page loading splash ── */
function SplashLoader() {
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "linear-gradient(135deg, #0f172a, #1e293b)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 16, zIndex: 9999,
    }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: "white" }}>
        <span style={{ color: "#38bdf8" }}>S</span>phereHealth <span style={{ color: "#38bdf8" }}>HIS</span>
      </div>
      <i className="pi pi-spin pi-spinner" style={{ fontSize: 24, color: "#38bdf8" }} />
      <div style={{ fontSize: 12, color: "#64748b" }}>Loading session…</div>
    </div>
  );
}

/* ── Access denied screen ── */
function AccessDenied() {
  const { user } = useAuth();
  return (
    <div style={{
      minHeight: "calc(100vh - 52px)", display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1d23", marginBottom: 8 }}>Access Denied</div>
        <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
          Your role <strong style={{ color: "#1e40af" }}>{user?.role}</strong> does not have permission to view this page.
        </div>
        <a href="/dashboard" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "10px 22px", background: "#1e40af", color: "white",
          borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: "none",
        }}>
          <i className="pi pi-home" />Go to Dashboard
        </a>
      </div>
    </div>
  );
}
