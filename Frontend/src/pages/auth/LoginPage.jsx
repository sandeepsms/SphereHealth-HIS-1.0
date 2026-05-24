import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useHospitalSettings } from "../../context/HospitalSettingsContext";
import { homePathForRole } from "../../config/permissions";

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
  const { settings } = useHospitalSettings();
  const navigate  = useNavigate();
  const location  = useLocation();
  const fromState = location.state?.from?.pathname;
  // R7cc: /api/hospital-settings DOES require auth (singleton holds bank +
  // GSTIN — not safe to expose pre-login). On the login screen the context
  // fetch returns 401 → settings stays at DEFAULT_SETTINGS → fallback
  // "Hospital" shows until the user authenticates. Acceptable trade-off:
  // after login the context refetches with the bearer and every subsequent
  // surface shows the configured name. If a public hospital-identity
  // endpoint is added later, this fallback path will start hydrating live.
  const hospitalName = settings?.hospitalName || "Hospital";

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  // R7cp: when the backend rate-limiter trips (HTTP 429), it ships a
  // `retryAfterSec` countdown in the response body. We capture the
  // absolute reset timestamp here and tick a 1s interval so the error
  // banner shows a live mm:ss countdown — much clearer than "Try again
  // in a few minutes" (which left the user staring at a dead form).
  // Also disables the submit button while the lock is active so a
  // panicked retry doesn't burn another slot once it unlocks.
  const [lockUntil, setLockUntil] = useState(0);   // ms epoch; 0 = unlocked
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!lockUntil) { setSecondsLeft(0); return; }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setLockUntil(0);
        setError("");           // auto-clear the banner once the lock expires
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockUntil]);

  // mm:ss formatter for the countdown badge.
  const fmtCountdown = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Role-aware landing page: each role gets its own home
  // Removed local landingPageForRole — its routes were stale (Dietician
  // landed on /vitalSheet, Physio on /updateVitalSheet — both nurse
  // pages; Pharmacist on /mar — a nursing route; default /mainpage was
  // the reception-flavoured generic dashboard). Now defers to the
  // central homePathForRole in permissions.js which sends everyone to
  // /dashboard (RoleDashboardPage handles per-role layout).

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError("Please enter email and password."); return; }
    setError("");
    setLoading(true);
    try {
      const user = await login(email.trim(), password);
      // Prefer the page the user was trying to reach before login;
      // otherwise send them to their role-aware /dashboard.
      const STALE_REDIRECTS = ["/mainpage", "/dashboard1", "/login"];
      const dest = fromState && !STALE_REDIRECTS.includes(fromState) ? fromState : homePathForRole(user?.role);
      navigate(dest, { replace: true });
    } catch (err) {
      // R7cp: 429 rate-limit handling. Backend ships `retryAfterSec` +
      // `resetAt` in the body; also sets the standard `Retry-After`
      // header for non-browser clients. Prefer the body field, fall
      // back to the header, fall back to a 15-min default. lockUntil
      // is an absolute timestamp so the useEffect tick stays accurate
      // even if the tab sleeps and resumes (Date.now ticks regardless).
      const isRateLimited =
        err?.response?.status === 429 ||
        err?.response?.data?.code === "TOO_MANY_LOGIN_ATTEMPTS";
      if (isRateLimited) {
        const bodySec   = Number(err?.response?.data?.retryAfterSec);
        const headerSec = Number(err?.response?.headers?.["retry-after"]);
        const sec = Number.isFinite(bodySec) && bodySec > 0
          ? bodySec
          : Number.isFinite(headerSec) && headerSec > 0
            ? headerSec
            : 15 * 60;
        setLockUntil(Date.now() + sec * 1000);
        setError(
          err?.response?.data?.message ||
          `Too many login attempts. Try again in ${Math.ceil(sec / 60)} minute${sec >= 120 ? "s" : ""}.`,
        );
      } else {
        setError(err?.response?.data?.message || "Login failed. Please check your credentials.");
      }
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
            {hospitalName} <span style={{ color: "#38bdf8" }}>HIS</span>
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            Hospital Information System · NABH Compliant
          </div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {/* R7ce: login screen is pre-auth so settings aren't loaded yet —
                always show the safe software-level claim "NABH COMPLIANT".
                The Header + Sidebar (which DO have settings) handle the
                accreditation upgrade once admin enters the cert#. */}
            <span style={{ background: "rgba(56,189,248,.15)", border: "1px solid rgba(56,189,248,.3)",
              color: "#38bdf8", padding: "2px 10px", borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
              NABH COMPLIANT
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
              <span style={{ flex: 1 }}>{error}</span>
              {/* R7cp: live mm:ss countdown badge — only visible while the
                  rate-limit lock is active. Auto-clears when the timer hits
                  zero (the useEffect also wipes the error banner). */}
              {secondsLeft > 0 && (
                <span style={{
                  background: "rgba(220,38,38,.35)", color: "#fee2e2",
                  padding: "2px 10px", borderRadius: 10, fontSize: 11,
                  fontFamily: "'DM Mono', monospace", fontWeight: 800,
                  letterSpacing: ".5px", whiteSpace: "nowrap",
                }} title="Time until you can try again">
                  <i className="pi pi-clock" style={{ fontSize: 10, marginRight: 4 }} />
                  {fmtCountdown(secondsLeft)}
                </span>
              )}
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

            {/* Submit — R7cp: disabled while the rate-limit countdown is
                active so an impatient user can't burn another slot the
                instant the lock expires. Re-enables automatically when
                secondsLeft hits 0 (via the useEffect that clears lockUntil). */}
            <button type="submit" disabled={loading || secondsLeft > 0}
              style={{
                width: "100%", padding: "13px 0",
                background: (loading || secondsLeft > 0) ? "#374151" : "linear-gradient(135deg, #1e40af, #1d4ed8)",
                border: "none", borderRadius: 10, color: "white",
                fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 700,
                cursor: (loading || secondsLeft > 0) ? "not-allowed" : "pointer",
                boxShadow: (loading || secondsLeft > 0) ? "none" : "0 4px 20px rgba(30,64,175,.4)",
                transition: "all .2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
              {loading
                ? <><i className="pi pi-spin pi-spinner" />Signing in…</>
                : secondsLeft > 0
                  ? <><i className="pi pi-lock" />Locked · retry in {fmtCountdown(secondsLeft)}</>
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
          {`${hospitalName} HIS v2.0 · Secure & NABH Compliant`}
        </div>
      </div>
    </div>
  );
}
