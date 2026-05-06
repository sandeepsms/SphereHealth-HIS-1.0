/**
 * FingerprintConsentModal.jsx
 * Self-contained modal for capturing biometric/WebAuthn consent for procedures.
 * Uses inline styles only (no CSS modules).
 */
import React, { useState } from "react";

const C = {
  purple: "#7c3aed",
  success: "#059669",
  danger: "#dc2626",
  amber: "#d97706",
  border: "#e2e8f0",
  muted: "#64748b",
  dark: "#0f172a",
  bg: "#f8fafc",
  card: "#fff",
};

// Fingerprint SVG icon
function FingerprintIcon({ size = 80, color = C.purple }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M50 15 C30 15 15 30 15 50 C15 65 22 78 33 86" stroke={color} strokeWidth="4" strokeLinecap="round" fill="none"/>
      <path d="M50 15 C70 15 85 30 85 50 C85 65 78 78 67 86" stroke={color} strokeWidth="4" strokeLinecap="round" fill="none"/>
      <path d="M50 25 C35 25 25 36 25 50 C25 61 31 70 40 76" stroke={color} strokeWidth="4" strokeLinecap="round" fill="none"/>
      <path d="M50 25 C65 25 75 36 75 50 C75 61 69 70 60 76" stroke={color} strokeWidth="4" strokeLinecap="round" fill="none"/>
      <path d="M50 35 C40 35 33 42 33 50 C33 57 37 63 43 67" stroke={color} strokeWidth="4" strokeLinecap="round" fill="none"/>
      <path d="M50 35 C60 35 67 42 67 50 C67 57 63 63 57 67" stroke={color} strokeWidth="4" strokeLinecap="round" fill="none"/>
      <path d="M50 45 C45 45 42 47 42 50 C42 53 44 55 47 57" stroke={color} strokeWidth="4" strokeLinecap="round" fill="none"/>
      <path d="M50 45 C55 45 58 47 58 50 C58 53 56 55 53 57" stroke={color} strokeWidth="4" strokeLinecap="round" fill="none"/>
      <circle cx="50" cy="50" r="4" fill={color}/>
    </svg>
  );
}

export default function FingerprintConsentModal({ open, onClose, onConfirm, procedure, patient }) {
  const [consentGiver, setConsentGiver] = useState("self");
  const [guardianName, setGuardianName] = useState("");
  const [guardianRelation, setGuardianRelation] = useState("");
  const [witnessName, setWitnessName] = useState("");
  const [notes, setNotes] = useState("");
  const [scanState, setScanState] = useState("idle"); // idle | scanning | success | failed
  const [fingerprintHash, setFingerprintHash] = useState("");
  const [fingerprintVerified, setFingerprintVerified] = useState(false);

  const capture = async () => {
    setScanState("scanning");
    try {
      /**
       * BIOMETRIC INTEGRATION POINT
       * ─────────────────────────────────────────────────────────────────────
       * In production replace this block with your biometric SDK call.
       * Common hospital devices (Mantra MFS100, SecuGen Hamster):
       *   const res = await fetch("http://localhost:11100/SGIFPCapture", { method: "POST" });
       *   const { ErrorCode, BMPBase64 } = await res.json();
       *   if (ErrorCode !== 0) throw new Error("Capture failed");
       *   const hash = await crypto.subtle.digest("SHA-256", base64ToBytes(BMPBase64));
       *   → setFingerprintHash, setFingerprintVerified(true), setScanState("success")
       * ─────────────────────────────────────────────────────────────────────
       * Demo mode: 2-second simulated capture with a random secure hash.
       */
      await new Promise((r) => setTimeout(r, 2000));
      const rnd = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      setFingerprintHash(rnd);
      setFingerprintVerified(false); // set true when real hardware confirms
      setScanState("success");
    } catch (_err) {
      setScanState("failed");
    }
  };

  const handleConfirm = () => {
    if (scanState !== "success") return;
    onConfirm({
      fingerprintHash,
      fingerprintVerified,
      witnessName,
      guardianName: consentGiver === "guardian" ? guardianName : "",
      guardianRelation: consentGiver === "guardian" ? guardianRelation : "",
      notes,
      obtainedAt: new Date().toISOString(),
      obtainedBy: witnessName || "Staff",
      method: fingerprintVerified ? "WebAuthn" : "Simulated",
    });
  };

  const resetAndClose = () => {
    setScanState("idle");
    setFingerprintHash("");
    setFingerprintVerified(false);
    setConsentGiver("self");
    setGuardianName("");
    setGuardianRelation("");
    setWitnessName("");
    setNotes("");
    onClose();
  };

  if (!open) return null;

  const scanColors = {
    idle:     { ring: C.purple + "40", icon: C.purple, label: "Place finger to scan", bg: C.purple + "08" },
    scanning: { ring: C.amber + "60",  icon: C.amber,  label: "Scanning...",           bg: C.amber + "08" },
    success:  { ring: C.success + "60",icon: C.success,label: "Fingerprint Captured ✓",bg: C.success + "08" },
    failed:   { ring: C.danger + "60", icon: C.danger, label: "Scan failed — try again",bg: C.danger + "08" },
  };
  const sc = scanColors[scanState] || scanColors.idle;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes fpPulse {
          0%   { transform: scale(1);   opacity: .7; }
          50%  { transform: scale(1.15); opacity: .3; }
          100% { transform: scale(1);   opacity: .7; }
        }
        @keyframes fpRipple {
          0%   { transform: scale(.8); opacity: .8; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        @keyframes fpSpin {
          0%   { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .fp-pulse-ring {
          animation: fpPulse 2s ease-in-out infinite;
        }
        .fp-ripple-ring {
          animation: fpRipple 1.2s ease-out infinite;
        }
      `}} />

      {/* Overlay */}
      <div
        onClick={resetAndClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
          zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {/* Modal card */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: C.card, borderRadius: 20, maxWidth: 540, width: "95%",
            boxShadow: "0 25px 60px rgba(0,0,0,.35), 0 8px 20px rgba(0,0,0,.15)",
            maxHeight: "90vh", overflowY: "auto",
          }}
        >
          {/* Header */}
          <div style={{
            background: `linear-gradient(135deg, #4c1d95, ${C.purple})`,
            borderRadius: "20px 20px 0 0", padding: "20px 24px", color: "#fff",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <i className="pi pi-shield" style={{ fontSize: 18 }} />
                  <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.2px" }}>
                    {procedure?.procedureName || "Procedure Consent"}
                  </span>
                </div>
                {procedure?.procedureType && (
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".6px", background: "rgba(255,255,255,.2)", padding: "2px 10px", borderRadius: 20 }}>
                    {procedure.procedureType}
                  </span>
                )}
              </div>
              <button onClick={resetAndClose} style={{ background: "rgba(255,255,255,.15)", border: "none", color: "#fff", width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                ×
              </button>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 16, fontSize: 12, opacity: .85, flexWrap: "wrap" }}>
              <span><i className="pi pi-user" style={{ marginRight: 4 }} />{patient?.patientName || "Patient"}</span>
              <span><i className="pi pi-id-card" style={{ marginRight: 4 }} />{patient?.UHID || "—"}</span>
              {patient?.age && <span>{patient.age} yrs · {patient.gender}</span>}
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: "20px 24px" }}>

            {/* Consent giver */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>
                Consent Given By
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {["self", "guardian"].map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setConsentGiver(opt)}
                    style={{
                      padding: "8px 20px", borderRadius: 8, border: `2px solid ${consentGiver === opt ? C.purple : C.border}`,
                      background: consentGiver === opt ? C.purple + "10" : "#fff",
                      color: consentGiver === opt ? C.purple : C.muted,
                      fontWeight: 600, fontSize: 12, cursor: "pointer", textTransform: "capitalize",
                    }}
                  >
                    {opt === "self" ? "Patient (Self)" : "Guardian / Relative"}
                  </button>
                ))}
              </div>

              {consentGiver === "guardian" && (
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 5 }}>Guardian Name *</label>
                    <input
                      value={guardianName}
                      onChange={(e) => setGuardianName(e.target.value)}
                      placeholder="Full name"
                      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: C.muted, marginBottom: 5 }}>Relation</label>
                    <input
                      value={guardianRelation}
                      onChange={(e) => setGuardianRelation(e.target.value)}
                      placeholder="e.g. Son, Spouse, Parent"
                      style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Fingerprint scanner */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 12 }}>
                Biometric Verification
              </div>
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                padding: "24px 20px", background: sc.bg, borderRadius: 14,
                border: `2px dashed ${sc.ring}`, position: "relative", overflow: "hidden",
              }}>
                {/* Ripple animation for scanning state */}
                {scanState === "scanning" && (
                  <>
                    <div className="fp-ripple-ring" style={{ position: "absolute", width: 120, height: 120, borderRadius: "50%", border: `3px solid ${C.amber}40` }} />
                    <div className="fp-ripple-ring" style={{ position: "absolute", width: 120, height: 120, borderRadius: "50%", border: `3px solid ${C.amber}40`, animationDelay: ".4s" }} />
                  </>
                )}
                {/* Pulse ring for idle */}
                {scanState === "idle" && (
                  <div className="fp-pulse-ring" style={{ position: "absolute", width: 120, height: 120, borderRadius: "50%", border: `3px solid ${C.purple}30` }} />
                )}

                <div style={{ position: "relative", zIndex: 1 }}>
                  <FingerprintIcon size={80} color={sc.icon} />
                </div>
                <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: sc.icon, zIndex: 1 }}>
                  {sc.label}
                </div>
                {fingerprintVerified && (
                  <div style={{ marginTop: 6, fontSize: 10, color: C.muted }}>
                    Hardware verified · Hash: {fingerprintHash?.slice(0, 8)}…
                  </div>
                )}
                {scanState === "success" && !fingerprintVerified && (
                  <div style={{ marginTop: 6, fontSize: 10, color: C.amber }}>
                    Simulated capture (no biometric hardware detected)
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button
                  onClick={capture}
                  disabled={scanState === "scanning"}
                  style={{
                    flex: 1, padding: "10px 20px", borderRadius: 8, border: "none",
                    background: scanState === "scanning" ? C.muted : C.purple,
                    color: "#fff", fontWeight: 600, fontSize: 13, cursor: scanState === "scanning" ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}
                >
                  {scanState === "scanning" ? (
                    <><i className="pi pi-spin pi-spinner" /> Scanning...</>
                  ) : scanState === "success" ? (
                    <><i className="pi pi-refresh" /> Re-scan</>
                  ) : (
                    <><i className="pi pi-id-card" /> Scan Fingerprint</>
                  )}
                </button>
                {scanState === "failed" && (
                  <button
                    onClick={() => { setScanState("idle"); }}
                    style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#fff", color: C.muted, fontSize: 12, cursor: "pointer" }}
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Witness */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6 }}>
                Witness Name (Staff)
              </label>
              <input
                value={witnessName}
                onChange={(e) => setWitnessName(e.target.value)}
                placeholder="Name of witnessing staff member"
                style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6 }}>
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional consent notes, patient questions, etc."
                rows={3}
                style={{ width: "100%", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
              />
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleConfirm}
                disabled={scanState !== "success"}
                style={{
                  flex: 1, padding: "12px 20px", borderRadius: 10, border: "none",
                  background: scanState === "success" ? `linear-gradient(135deg, #047857, ${C.success})` : C.border,
                  color: scanState === "success" ? "#fff" : C.muted,
                  fontWeight: 700, fontSize: 13, cursor: scanState === "success" ? "pointer" : "not-allowed",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  boxShadow: scanState === "success" ? "0 4px 12px rgba(5,150,105,.3)" : "none",
                }}
              >
                <i className="pi pi-check-circle" />
                Confirm Consent
              </button>
              <button
                onClick={resetAndClose}
                style={{
                  padding: "12px 20px", borderRadius: 10, border: `1px solid ${C.border}`,
                  background: "#fff", color: C.muted, fontWeight: 600, fontSize: 13, cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
