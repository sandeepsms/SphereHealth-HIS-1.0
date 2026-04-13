import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const ROLE_COLORS = {
  Admin:            "#1e40af",
  Receptionist:     "#0d9488",
  Doctor:           "#7c3aed",
  Nurse:            "#db2777",
  Dietician:        "#16a34a",
  "TPA Coordinator":"#d97706",
  Pharmacist:       "#ea580c",
  "Lab Technician": "#0891b2",
};

const ROLE_ICONS = {
  Admin:            "pi-shield",
  Receptionist:     "pi-desktop",
  Doctor:           "pi-heart",
  Nurse:            "pi-heart-fill",
  Dietician:        "pi-apple",
  "TPA Coordinator":"pi-briefcase",
  Pharmacist:       "pi-inbox",
  "Lab Technician": "pi-chart-bar",
};

export default function LoginPage() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const from      = location.state?.from?.pathname || "/mainpage";

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError("Please enter email and password."); return; }
    setError("");
    setLoading(true);
    try {
      const user = await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err?.response?.data?.message || "Login failed. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #1e3a8a 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans', sans-serif", padding: 20, position: "relative", overflow: "hidden",
    }}>
      {/* Background decoration */}
      <div style={{ position: "absolute", top: -100, right: -100, width: 400, height: 400,
        background: "radial-gradient(circle, rgba(56,189,248,.08), transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: -80, left: -80, width: 350, height: 350,
        background: "radial-gradient(circle, rgba(124,58,237,.08), transparent 70%)", pointerEvents: "none" }} />

      <div style={{ width: "100%", maxWidth: 440, position: "relative" }}>

        {/* Hospital branding */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 64, height: 64, background: "#1e40af", borderRadius: 16,
            marginBottom: 16, boxShadow: "0 8px 32px rgba(30,64,175,.4)",
          }}>
            <span style={{ fontSize: 28, fontWeight: 900, color: "white" }}>S</span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "white", lineHeight: 1.2 }}>
            SphereHealth <span style={{ color: "#38bdf8" }}>HIS</span>
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            Hospital Information System · NABH Compliant
          </div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span style={{ background: "rgba(56,189,248,.15)", border: "1px solid rgba(56,189,248,.3)",
              color: "#38bdf8", padding: "2px 10px", borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
              NABH ACCREDITED
            </span>
            <span style={{ background: "rgba(22,163,74,.12)", border: "1px solid rgba(22,163,74,.25)",
              color: "#4ade80", padding: "2px 10px", borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
              SECURE LOGIN
            </span>
          </div>
        </div>

        {/* Login card */}
        <div style={{
          background: "rgba(255,255,255,.04)", backdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,.1)", borderRadius: 20,
          padding: "36px 40px", boxShadow: "0 24px 64px rgba(0,0,0,.4)",
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "white", marginBottom: 6 }}>
            Sign in to your account
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 28 }}>
            Enter your credentials to access the system
          </div>

          {error && (
            <div style={{
              background: "rgba(220,38,38,.15)", border: "1px solid rgba(220,38,38,.3)",
              borderRadius: 8, padding: "10px 14px", marginBottom: 18,
              display: "flex", alignItems: "center", gap: 8,
              color: "#fca5a5", fontSize: 12, fontWeight: 500,
            }}>
              <i className="pi pi-exclamation-triangle" style={{ fontSize: 13 }} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: ".8px", color: "#94a3b8", marginBottom: 7 }}>
                Email Address
              </label>
              <div style={{ position: "relative" }}>
                <i className="pi pi-envelope" style={{
                  position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)",
                  color: "#64748b", fontSize: 14,
                }} />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@spherehealth.com"
                  autoComplete="email"
                  style={{
                    width: "100%", paddingLeft: 38, paddingRight: 14, paddingTop: 11, paddingBottom: 11,
                    background: "rgba(255,255,255,.07)", border: "1.5px solid rgba(255,255,255,.12)",
                    borderRadius: 10, color: "white", fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                    outline: "none", boxSizing: "border-box",
                    transition: "border-color .2s, box-shadow .2s",
                  }}
                  onFocus={e => { e.target.style.borderColor = "#38bdf8"; e.target.style.boxShadow = "0 0 0 3px rgba(56,189,248,.12)"; }}
                  onBlur={e => { e.target.style.borderColor = "rgba(255,255,255,.12)"; e.target.style.boxShadow = "none"; }}
                />
              </div>
            </div>

            {/* Password */}
            <div style={{ marginBottom: 28 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: ".8px", color: "#94a3b8", marginBottom: 7 }}>
                Password
              </label>
              <div style={{ position: "relative" }}>
                <i className="pi pi-lock" style={{
                  position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)",
                  color: "#64748b", fontSize: 14,
                }} />
                <input
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  style={{
                    width: "100%", paddingLeft: 38, paddingRight: 44, paddingTop: 11, paddingBottom: 11,
                    background: "rgba(255,255,255,.07)", border: "1.5px solid rgba(255,255,255,.12)",
                    borderRadius: 10, color: "white", fontSize: 13, fontFamily: "'DM Sans', sans-serif",
                    outline: "none", boxSizing: "border-box",
                    transition: "border-color .2s, box-shadow .2s",
                  }}
                  onFocus={e => { e.target.style.borderColor = "#38bdf8"; e.target.style.boxShadow = "0 0 0 3px rgba(56,189,248,.12)"; }}
                  onBlur={e => { e.target.style.borderColor = "rgba(255,255,255,.12)"; e.target.style.boxShadow = "none"; }}
                />
                <button type="button" onClick={() => setShowPwd(p => !p)}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: 4 }}>
                  <i className={`pi ${showPwd ? "pi-eye-slash" : "pi-eye"}`} style={{ fontSize: 14 }} />
                </button>
              </div>
            </div>

            {/* Submit */}
            <button type="submit" disabled={loading}
              style={{
                width: "100%", padding: "13px 0",
                background: loading ? "#374151" : "linear-gradient(135deg, #1e40af, #1d4ed8)",
                border: "none", borderRadius: 10, color: "white",
                fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                boxShadow: loading ? "none" : "0 4px 20px rgba(30,64,175,.4)",
                transition: "all .2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
              {loading
                ? <><i className="pi pi-spin pi-spinner" />Signing in…</>
                : <><i className="pi pi-sign-in" />Sign In</>
              }
            </button>
          </form>
        </div>

        {/* Role reference */}
        <div style={{ marginTop: 24, background: "rgba(255,255,255,.03)",
          border: "1px solid rgba(255,255,255,.07)", borderRadius: 14, padding: "16px 20px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: 1, color: "#475569", marginBottom: 12 }}>
            Access Roles
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {Object.entries(ROLE_COLORS).map(([role, color]) => (
              <div key={role} style={{
                display: "flex", alignItems: "center", gap: 6,
                background: color + "18", border: `1px solid ${color}30`,
                borderRadius: 6, padding: "4px 10px",
              }}>
                <i className={`pi ${ROLE_ICONS[role] || "pi-user"}`} style={{ fontSize: 11, color }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8" }}>{role}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 11, color: "#334155" }}>
          SphereHealth HIS v2.0 · Secure & NABH Compliant
        </div>
      </div>
    </div>
  );
}
