/**
 * BrandTransition.jsx — R7hr-330
 * Branded route-transition loader (Suspense fallback for the authenticated
 * shell). Shows the animated hospital/BIMS logo + a short, role-specific
 * encouraging line while the next page's chunk loads. A 120ms delay keeps
 * fast (cached) navigations from flashing the loader.
 *
 * The lines are original, attribution-free encouragements written per role.
 */
import React, { useEffect, useMemo, useState } from "react";
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

export default function BrandTransition() {
  const { user } = useAuth();
  const { settings } = useHospitalSettings();
  const [show, setShow] = useState(false);

  // Skip the loader for fast (cached) navigations — only reveal after 120ms.
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 120);
    return () => clearTimeout(t);
  }, []);

  const role = user?.role || "default";
  const logo = settings?.logo || "/bims-logo.png";
  const hospital = settings?.hospitalName || "Bright Institute of Medical Sciences";
  // Pick one line per mount (per navigation).
  const line = useMemo(() => {
    const lines = ROLE_LINES[role] || ROLE_LINES.default;
    return lines[Math.floor(Math.random() * lines.length)];
  }, [role]);

  if (!show) return null;

  return (
    <div
      className="hga-enter-fade"
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        minHeight: "calc(100vh - 140px)", padding: 40, textAlign: "center",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      {/* Logo + spinning ring + pulse */}
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

      {/* Hospital name */}
      <div style={{
        fontSize: 11.5, fontWeight: 800, letterSpacing: "1.4px", textTransform: "uppercase",
        color: "#6366f1", marginBottom: 10,
      }}>{hospital}</div>

      {/* Role-specific encouragement */}
      <div key={line} style={{
        fontSize: 16.5, fontWeight: 700, color: "#1e293b", maxWidth: 460, lineHeight: 1.5,
        animation: "btRise .5s ease both",
      }}>{line}</div>

      {/* Progress dots */}
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
