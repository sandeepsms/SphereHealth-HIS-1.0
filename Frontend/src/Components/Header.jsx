import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const MODULE_NAMES = {
  "/mainpage":               "Dashboard",
  "/dashboard1":             "Dashboard",
  "/dash":                   "Dashboard",
  "/registration":           "Patient Registration",
  "/allpatient":             "Patient List",
  "/patients":               "Patient Management",
  "/opd-visit":              "OPD Visits",
  "/opd/new":                "New OPD Visit",
  "/emergency":              "Emergency",
  "/emergency/new":          "New Emergency",
  "/ipd-admission":          "IPD Admission — NABH Compliant",
  "/nursing-notes":          "Nursing Notes — IPD / Day Care",
  "/nursing-handover-notes": "Nursing Handover Notes",
  "/nursing-care-plan":      "Nursing Care Plan",
  "/doctor-assessment":      "Doctor Assessment & Order Entry",
  "/emergency-assessment":   "Emergency Assessment",
  "/ipd-assessment":              "IPD Initial Assessment",
  "/nurse-initial-assessment":    "Nursing Initial Assessment — NABH",
  "/admin/users":            "User Management",
  "/doctors":                "Doctor Management",
  "/doctors/new":            "Add Doctor",
  "/discharge-summary":      "Discharge Summary",
  "/consent-forms":          "Consent Forms",
  "/mar":                    "MAR — Medication Administration Record",
  "/patient-billing":        "Patient Billing",
  "/billing":                "Billing",
  "/hospital-charges":       "Hospital Charges",
  "/service-master":         "Service Master",
  "/beds":                   "Bed Management",
  "/bed-visual":             "Bed Visual Layout",
  "/wards":                  "Ward Management",
  "/buildings":              "Building Management",
  "/floors":                 "Floor Management",
  "/rooms":                  "Room Management",
  "/department":             "Department Management",
  "/updateVitalSheet":       "Update Vital Sheet",
  "/vitalSheet":             "Vital Sheet",
  "/vitalsView":             "Vitals View",
};

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

function getModuleName(pathname) {
  if (MODULE_NAMES[pathname]) return MODULE_NAMES[pathname];
  for (const key of Object.keys(MODULE_NAMES)) {
    if (pathname.startsWith(key + "/") || pathname.startsWith(key + ":")) return MODULE_NAMES[key];
  }
  return "SphereHealth HIS";
}

function useClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return time;
}

const isDoctorPage = (p) => p.includes("doctor") || p.includes("mar") || p.includes("discharge") || p.includes("consent");

export default function Header() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const time      = useClock();
  const { user, logout } = useAuth();
  const pathname  = location.pathname;
  const module    = getModuleName(pathname);
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef(null);

  const bgColor  = isDoctorPage(pathname) ? "#1e293b" : "#1e40af";
  const timeStr  = time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr  = time.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  const displayName = user ? (user.fullName || `${user.firstName} ${user.lastName}`) : "Guest";
  const initials    = displayName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const roleColor   = user ? (ROLE_COLORS[user.role] || "#1e40af") : "#1e40af";

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div style={{
      background: bgColor, color: "white",
      padding: "0 24px", height: 52,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000,
      boxShadow: "0 2px 12px rgba(0,0,0,.25)",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {/* ── Left: Logo + NABH + Module ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 28, height: 28, background: "linear-gradient(135deg,#38bdf8,#7c3aed)", borderRadius: 7,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "white", flexShrink: 0 }}>S</div>
        <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: ".3px", color: "white" }}>
          SphereHealth<span style={{ color: "#38bdf8" }}>HIS</span>
        </span>
        <span style={{ background: "rgba(56,189,248,.2)", border: "1px solid rgba(56,189,248,.4)",
          padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "1.2px", color: "#7dd3fc" }}>NABH</span>
        {module && module !== "SphereHealth HIS" && (
          <>
            <span style={{ width: 1, height: 28, background: "#334155", display: "inline-block", marginLeft: 2 }} />
            <span style={{ fontSize: 12, color: "#94a3b8", paddingLeft: 2 }}>{module}</span>
          </>
        )}
      </div>

      {/* ── Right: Clock + User Dropdown ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12,
          background: "rgba(255,255,255,.08)", padding: "5px 12px", borderRadius: 6,
          color: "#e2e8f0", border: "1px solid rgba(255,255,255,.1)", whiteSpace: "nowrap" }}>
          {timeStr} &nbsp;|&nbsp; {dateStr}
        </div>

        {/* User pill with dropdown */}
        <div ref={dropRef} style={{ position: "relative" }}>
          <button onClick={() => setDropOpen(p => !p)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.2)",
              padding: "5px 12px", borderRadius: 20, cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, color: "white",
            }}>
            <div style={{
              width: 24, height: 24, background: roleColor,
              borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 700, color: "white", flexShrink: 0,
            }}>{initials}</div>
            <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {displayName}
            </span>
            {user?.role && (
              <span style={{ fontSize: 9, fontWeight: 700, background: roleColor + "30",
                color: "#e2e8f0", padding: "1px 6px", borderRadius: 3, letterSpacing: ".5px" }}>
                {user.role.toUpperCase()}
              </span>
            )}
            <i className={`pi ${dropOpen ? "pi-chevron-up" : "pi-chevron-down"}`} style={{ fontSize: 10 }} />
          </button>

          {/* Dropdown */}
          {dropOpen && (
            <div style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0,
              background: "white", border: "1px solid #e2e6ea", borderRadius: 12,
              boxShadow: "0 8px 32px rgba(0,0,0,.18)", minWidth: 220, zIndex: 2000,
              overflow: "hidden",
            }}>
              {/* Profile header */}
              <div style={{ padding: "14px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e6ea" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#1a1d23" }}>{displayName}</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{user?.email}</div>
                <div style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 5,
                  background: roleColor + "15", border: `1px solid ${roleColor}30`,
                  padding: "2px 8px", borderRadius: 5 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: roleColor }}>{user?.role}</span>
                </div>
              </div>

              {/* Menu items */}
              {[
                { icon: "pi-home",     label: "Dashboard",       action: () => { navigate("/mainpage"); setDropOpen(false); } },
                { icon: "pi-user",     label: "My Profile",      action: () => setDropOpen(false) },
                { icon: "pi-cog",      label: "Settings",        action: () => setDropOpen(false) },
              ].map(item => (
                <button key={item.label} onClick={item.action}
                  style={{ width: "100%", padding: "10px 16px", background: "none", border: "none",
                    display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "#374151", textAlign: "left" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f0f9ff"}
                  onMouseLeave={e => e.currentTarget.style.background = "none"}>
                  <i className={`pi ${item.icon}`} style={{ fontSize: 13, color: "#6b7280", width: 16 }} />
                  {item.label}
                </button>
              ))}

              <div style={{ borderTop: "1px solid #e2e6ea" }}>
                <button onClick={handleLogout}
                  style={{ width: "100%", padding: "10px 16px", background: "none", border: "none",
                    display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif", fontSize: 12, color: "#dc2626", textAlign: "left" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#fef2f2"}
                  onMouseLeave={e => e.currentTarget.style.background = "none"}>
                  <i className="pi pi-sign-out" style={{ fontSize: 13, color: "#dc2626", width: 16 }} />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
