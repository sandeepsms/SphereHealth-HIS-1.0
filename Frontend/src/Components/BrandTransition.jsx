/**
 * BrandTransition.jsx — R7hr-330 / R7hr-331
 * Branded transitions between pages with role-specific encouragement.
 *
 *  • BrandSplash        — the visual (animated logo + hospital + line + dots).
 *  • BrandTransition    — Suspense fallback (shown while a lazy chunk loads).
 *  • RouteInterstitial  — a short overlay shown on EVERY route change (even
 *                         cached navigations), so the brand + encouragement
 *                         always plays when switching pages from the dashboard.
 *
 * Lines are original, attribution-free encouragements written per role.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useHospitalSettings } from "../context/HospitalSettingsContext";

const ROLE_LINES = {
  Admin: [
    "Steering the whole hospital — lead with clarity.",
    "Every system you keep humming saves someone time.",
    "Mission control is in steady hands.",
  ],
  Doctor: [
    "Every decision you make moves a patient toward healing.",
    "Your expertise turns uncertainty into hope.",
    "One patient at a time — you've got this.",
  ],
  Nurse: [
    "Your care is the heartbeat of every ward.",
    "The smallest kindness you give matters the most.",
    "Steady hands, warm heart — patients feel it.",
  ],
  Receptionist: [
    "You're the first welcome every patient remembers.",
    "A calm front desk calms the whole hospital.",
    "Every smile you give sets the tone for care.",
  ],
  Pharmacist: [
    "Right drug, right dose — your precision protects lives.",
    "Every accurate dispense is quiet heroism.",
    "Safety lives in your attention to detail.",
  ],
  "Lab Technician": [
    "Behind every result is a patient awaiting answers.",
    "Your accuracy guides every diagnosis.",
    "Small samples, big impact.",
  ],
  Radiologist: [
    "You reveal what the eye alone can't see.",
    "Clarity in every image, confidence in every report.",
  ],
  Accountant: [
    "Steady books keep care flowing.",
    "Every figure you balance keeps the wards running.",
  ],
  "TPA Coordinator": [
    "You turn paperwork into peace of mind.",
    "Every claim you clear lifts a family's worry.",
  ],
  Dietician: [
    "Good nutrition is quiet medicine — you prescribe it.",
    "Every plan you build helps someone heal faster.",
  ],
  Physiotherapist: [
    "Every step a patient takes, you helped enable.",
    "Movement is medicine — you deliver it daily.",
  ],
  "Ward Boy": [
    "A ready, clean ward is safe care in motion.",
    "Your work keeps every patient comfortable and safe.",
  ],
  Housekeeping: [
    "A spotless ward is infection-free care in action.",
    "Your work keeps every corner safe.",
  ],
  Security: [
    "Your watch keeps everyone safe.",
    "Calm vigilance protects the whole campus.",
  ],
  MRD: [
    "Every record you safeguard protects a patient's story.",
    "Order today is the answer someone needs tomorrow.",
  ],
  default: [
    "Care, precision, compassion — you bring it every day.",
    "Thank you for the work you do here.",
  ],
};

function pickLine(role) {
  const lines = ROLE_LINES[role] || ROLE_LINES.default;
  return lines[Math.floor(Math.random() * lines.length)];
}

/* ── Shared visual: animated logo + hospital + encouragement + dots ── */
export function BrandSplash({ logo, hospital, line }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      textAlign: "center", fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{ position: "relative", width: 96, height: 96, marginBottom: 22 }}>
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          border: "3px solid #e0e7ff", borderTopColor: "#4338ca",
          animation: "btSpin .9s linear infinite",
        }} />
        <div style={{
          position: "absolute", inset: 11, borderRadius: "50%", background: "#fff",
          boxShadow: "0 10px 28px rgba(67,56,202,.22)",
          display: "flex", alignItems: "center", justifyContent: "center",
          animation: "btPulse 1.8s ease-in-out infinite",
        }}>
          <img src={logo} alt={hospital}
            style={{ width: "66%", height: "66%", objectFit: "contain" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }} />
        </div>
      </div>

      <div style={{
        fontSize: 11.5, fontWeight: 800, letterSpacing: "1.4px", textTransform: "uppercase",
        color: "#6366f1", marginBottom: 10,
      }}>{hospital}</div>

      <div key={line} style={{
        fontSize: 16.5, fontWeight: 700, color: "#1e293b", maxWidth: 460, lineHeight: 1.5,
        padding: "0 16px", animation: "btRise .5s ease both",
      }}>{line}</div>

      <div style={{ display: "flex", gap: 7, marginTop: 20 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{
            width: 8, height: 8, borderRadius: "50%", background: "#4338ca",
            animation: "btDot 1.1s ease-in-out infinite", animationDelay: `${i * 0.16}s`,
          }} />
        ))}
      </div>

      <style>{`
        @keyframes btSpin  { to { transform: rotate(360deg); } }
        @keyframes btPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
        @keyframes btRise  { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes btDot   { 0%,100% { opacity: .25; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-4px); } }
        @media (prefers-reduced-motion: reduce) {
          [style*="btSpin"], [style*="btPulse"], [style*="btDot"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

/* ── Suspense fallback — shown while a lazy chunk loads (slow/first visit) ── */
export default function BrandTransition() {
  const { user } = useAuth();
  const { settings } = useHospitalSettings();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 120);
    return () => clearTimeout(t);
  }, []);
  const line = useMemo(() => pickLine(user?.role || "default"), [user?.role]);
  if (!show) return null;
  return (
    <div className="hga-enter-fade" style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "calc(100vh - 140px)", padding: 40,
    }}>
      <BrandSplash logo={settings?.logo || "/bims-logo.png"} hospital={settings?.hospitalName || "Bright Institute of Medical Sciences"} line={line} />
    </div>
  );
}

/* ── Route-change interstitial — plays on EVERY navigation (even cached), so
   the brand + role encouragement always shows when switching pages. ── */
export function RouteInterstitial({ duration = 650 }) {
  const location = useLocation();
  const { user } = useAuth();
  const { settings } = useHospitalSettings();
  const prevPath = useRef(location.pathname);
  const [active, setActive] = useState(false);
  const [line, setLine] = useState("");

  // useLayoutEffect so the overlay is committed BEFORE the browser paints the
  // newly-routed (often heavy) page — otherwise the page flashes for a frame
  // and the splash arrives late, which read as "not showing everywhere".
  useLayoutEffect(() => {
    if (location.pathname === prevPath.current) return; // ignore query-only changes
    prevPath.current = location.pathname;
    if (location.pathname === "/login") return;         // not on the login screen
    setLine(pickLine(user?.role || "default"));
    setActive(true);
    const t = setTimeout(() => setActive(false), duration);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  if (!active) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 6000,
      background: "radial-gradient(900px 500px at 50% 8%, #eef2ff, #f8fafc 60%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: `btInterOut ${duration}ms ease both`,
    }}>
      <BrandSplash logo={settings?.logo || "/bims-logo.png"} hospital={settings?.hospitalName || "Bright Institute of Medical Sciences"} line={line} />
      <style>{`@keyframes btInterOut { 0%{opacity:1} 68%{opacity:1} 100%{opacity:0} }`}</style>
    </div>
  );
}
