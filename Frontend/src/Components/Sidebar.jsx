/**
 * Sidebar.jsx — Role-based dynamic navigation
 *
 * Each section and item carries a `roles` array.
 * The sidebar filters to show only what's relevant for the logged-in user's role.
 * Admin always sees everything.
 *
 * Roles (from userModel):
 *   Doctor | Nurse | Admin | Receptionist | Pharmacist | Lab Technician
 *   Radiologist | Physiotherapist | Ward Boy | Accountant | Security
 *   Housekeeping | Dietician | TPA Coordinator
 */

import React, { useState, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "primeicons/primeicons.css";

/* ══════════════════════════════════════════════════════════════
   ROLE META — color, icon, label for each role
══════════════════════════════════════════════════════════════ */
const ROLE_META = {
  Admin:             { color: "#1e293b", light: "#f1f5f9",  icon: "pi-shield",           label: "Administrator" },
  Receptionist:      { color: "#0891b2", light: "#ecfeff",  icon: "pi-desktop",          label: "Receptionist" },
  Doctor:            { color: "#7c3aed", light: "#f5f3ff",  icon: "pi-user-edit",        label: "Doctor" },
  Nurse:             { color: "#db2777", light: "#fdf2f8",  icon: "pi-heart",            label: "Nurse" },
  Pharmacist:        { color: "#ea580c", light: "#fff7ed",  icon: "pi-box",              label: "Pharmacist" },
  "Lab Technician":  { color: "#0284c7", light: "#f0f9ff",  icon: "pi-search-plus",      label: "Lab Technician" },
  Radiologist:       { color: "#0284c7", light: "#f0f9ff",  icon: "pi-eye",              label: "Radiologist" },
  Physiotherapist:   { color: "#059669", light: "#ecfdf5",  icon: "pi-bolt",             label: "Physiotherapist" },
  Accountant:        { color: "#d97706", light: "#fffbeb",  icon: "pi-receipt",          label: "Accountant" },
  "TPA Coordinator": { color: "#7c3aed", light: "#f5f3ff",  icon: "pi-briefcase",        label: "TPA Coordinator" },
  "Ward Boy":        { color: "#475569", light: "#f8fafc",  icon: "pi-user",             label: "Ward Boy" },
  Dietician:         { color: "#16a34a", light: "#f0fdf4",  icon: "pi-apple",            label: "Dietician" },
  Security:          { color: "#374151", light: "#f9fafb",  icon: "pi-lock",             label: "Security" },
  Housekeeping:      { color: "#64748b", light: "#f8fafc",  icon: "pi-home",             label: "Housekeeping" },
};

/* Role shorthand groups for readability */
const ALL   = ["*"];   // shown to every role
const RX    = "Receptionist";
const DR    = "Doctor";
const NR    = "Nurse";
const PH    = "Pharmacist";
const LB    = "Lab Technician";
const RL    = "Radiologist";
const AC    = "Accountant";
const TPA   = "TPA Coordinator";
const WB    = "Ward Boy";
const ADMIN = "Admin";
const PT    = "Physiotherapist";
const DT    = "Dietician";

/* ══════════════════════════════════════════════════════════════
   MASTER NAV DEFINITION
   roles: ["*"] = everyone  |  omit or [] = Admin only
   Each item also carries roles for fine-grained filtering.
══════════════════════════════════════════════════════════════ */
const NAV = [
  /* ── Dashboard ──────────────────────────────────────── */
  {
    id: "dashboard", label: "Dashboard",
    icon: "pi-home", color: "#1e40af", light: "#eff6ff",
    path: "/mainpage", single: true, roles: ALL,
  },

  /* ── Reception (NABH front-desk workflow) ───────────── */
  /* Receptionist gets the full front-desk surface.
     Admin sees everything for management.
     Doctor/Nurse only get "Reception Dashboard" link (handy overview) and
     "Patient Search" — they shouldn't be creating registrations, issuing
     visitor passes, or working the discharge queue. */
  {
    id: "registration", label: "Reception",
    icon: "pi-desktop", color: "#0891b2", light: "#ecfeff",
    nabh: true, roles: [ADMIN, RX, DR, NR, AC, TPA],
    items: [
      { label: "Dashboard",           icon: "pi-chart-line",        path: "/reception",            nabh: true,  badge: "LIVE",  roles: [ADMIN, RX, DR, NR, AC, TPA] },
      { label: "New Registration",    icon: "pi-user-plus",         path: "/reception/register",   nabh: true,                  roles: [ADMIN, RX] },
      // RX-flavored Patient Search & Visit History (rx-page style, slimmer)
      { label: "Patient Search",      icon: "pi-search",            path: "/patient-search",                                   roles: [RX] },
      { label: "Visit History",       icon: "pi-clock",             path: "/visit-history",                                    roles: [RX] },
      // Original Patient Search & Visit History — for other roles
      { label: "Patient Search",      icon: "pi-search",            path: "/allpatient",                                       roles: [ADMIN, DR, NR, AC, TPA] },
      { label: "Visit History",       icon: "pi-clock",             path: "/patient-history",                                  roles: [ADMIN, DR, NR] },
      { label: "Appointments",        icon: "pi-calendar-plus",     path: "/appointments",         nabh: true,  badge: "NEW",   roles: [ADMIN, RX] },
      { label: "Discharge Queue",     icon: "pi-sign-out",          path: "/discharge-queue",      nabh: true,  badge: "NEW",   roles: [ADMIN, RX] },
      { label: "TPA / Insurance",     icon: "pi-shield",            path: "/tpa-cases",            nabh: true,  badge: "NEW",   roles: [ADMIN, RX, TPA, AC] },
      { label: "Visitor Passes",      icon: "pi-id-card",           path: "/visitor-passes",       nabh: true,  badge: "NEW",   roles: [ADMIN, RX] },
    ],
  },

  /* ── OPD & Emergency Queue ──────────────────────────── */
  {
    id: "opd", label: "OPD / Emergency",
    icon: "pi-building", color: "#059669", light: "#ecfdf5",
    roles: [ADMIN, RX, DR, NR],
    items: [
      // RX-flavored versions (rx-page style, no clinical fields)
      { label: "OPD Queue",          icon: "pi-list",      path: "/reception-opd-queue",  roles: [RX] },
      { label: "Emergency Cases",    icon: "pi-bolt",      path: "/reception-emergency",  roles: [RX] },
      // Original clinical versions for doctors / nurses / admin
      { label: "OPD Queue",          icon: "pi-list",      path: "/opd-queue",         roles: [ADMIN, DR, NR] },
      { label: "Doctor OPD Panel",   icon: "pi-desktop",   path: "/doctor-opd-panel",  roles: [ADMIN, DR] },
      { label: "Emergency Cases",    icon: "pi-bolt",      path: "/emergency",         roles: [ADMIN, DR, NR] },
    ],
  },

  /* ── Bed Management ─────────────────────────────────── */
  {
    id: "beds", label: "Bed Management",
    icon: "pi-table", color: "#475569", light: "#f8fafc",
    roles: [ADMIN, RX, NR, WB],
    items: [
      // RX-flavored read-only visual layout (no admit / transfer / discharge)
      { label: "Bed Visual Layout",  icon: "pi-eye",       path: "/reception-beds", roles: [RX] },
      // Full clinical version
      { label: "Bed Visual Layout",  icon: "pi-eye",       path: "/bed-visual",   roles: [ADMIN, NR, WB] },
      { label: "Manage Beds",        icon: "pi-list",      path: "/beds",         roles: [ADMIN, NR] },
      { label: "Wards",              icon: "pi-home",      path: "/wards",        roles: [ADMIN, NR] },
      { label: "Rooms",              icon: "pi-box",       path: "/rooms",        roles: [ADMIN] },
      { label: "Room Category",      icon: "pi-th-large",  path: "/roomcategory", roles: [ADMIN] },
    ],
  },

  /* ── Clinical — Doctor ──────────────────────────────── */
  {
    id: "doctor", label: "Clinical — Doctor",
    icon: "pi-user-edit", color: "#7c3aed", light: "#f5f3ff",
    nabh: true, roles: [ADMIN, DR],
    items: [
      { label: "Patient Panel",         icon: "pi-id-card",           path: "/doctor-patient-panel",  roles: [ADMIN, DR] },
      { label: "OPD Assessment",        icon: "pi-file-edit",         path: "/doctor-opd-panel",       roles: [ADMIN, DR], nabh: true },
      { label: "Doctor Notes",          icon: "pi-book",              path: "/doctor-notes",           roles: [ADMIN, DR], nabh: true },
      { label: "Emergency Assessment",  icon: "pi-exclamation-circle",path: "/emergency-assessment",   roles: [ADMIN, DR], nabh: true },
      { label: "Discharge Summary",     icon: "pi-sign-out",          path: "/discharge-summary",      roles: [ADMIN, DR], nabh: true },
      { label: "Consent Forms",         icon: "pi-shield",            path: "/consent-forms",          roles: [ADMIN, DR], nabh: true },
    ],
  },

  /* ── Clinical — Nursing ─────────────────────────────── */
  {
    id: "nursing", label: "Clinical — Nursing",
    icon: "pi-heart", color: "#db2777", light: "#fdf2f8",
    nabh: true, roles: [ADMIN, NR, WB],
    items: [
      { label: "Nursing Notes",         icon: "pi-file-edit",  path: "/nursing-notes",           roles: [ADMIN, NR], nabh: true },
      { label: "Patient Panel",         icon: "pi-id-card",    path: "/nurse-patient-panel",     roles: [ADMIN, NR, WB] },
      { label: "OPD Queue",             icon: "pi-list",       path: "/opd-queue",               roles: [ADMIN, NR] },
      { label: "Initial Assessment",    icon: "pi-clipboard",  path: "/nurse-initial-assessment",roles: [ADMIN, NR], nabh: true },
      { label: "Daily Assessment",      icon: "pi-calendar",   path: "/daily-nursing-assessment",roles: [ADMIN, NR], nabh: true },
      { label: "Care Plan",             icon: "pi-heart",      path: "/nursing-care-plan",       roles: [ADMIN, NR], nabh: true },
      { label: "Fall Risk",             icon: "pi-exclamation-triangle", path: "/fall-risk-assessment", roles: [ADMIN, NR], nabh: true },
      { label: "Pain Assessment",       icon: "pi-minus-circle", path: "/pain-assessment",       roles: [ADMIN, NR], nabh: true },
    ],
  },

  /* ── Vitals ──────────────────────────────────────────── */
  {
    id: "vitals", label: "Vitals",
    icon: "pi-chart-line", color: "#16a34a", light: "#f0fdf4",
    roles: [ADMIN, NR, DR, PT, DT],
    items: [
      { label: "Update Vitals",  icon: "pi-pencil",    path: "/updateVitalSheet",  roles: [ADMIN, NR, PT, DT] },
      { label: "Vital Sheet",    icon: "pi-table",     path: "/vitalSheet",        roles: [ADMIN, NR, DR, DT] },
      { label: "Vitals View",    icon: "pi-chart-bar", path: "/vitalsView",        roles: [ADMIN, NR, DR, DT] },
    ],
  },

  /* ── Pharmacy / MAR ──────────────────────────────────── */
  {
    id: "pharmacy", label: "Pharmacy / MAR",
    icon: "pi-box", color: "#ea580c", light: "#fff7ed",
    nabh: true, roles: [ADMIN, PH, NR, DR],
    items: [
      // MAR is the canonical record — Doctor reads it (gets to "DR" too)
      { label: "MAR",              icon: "pi-table",         path: "/mar",   nabh: true, roles: [ADMIN, PH, NR, DR] },
    ],
  },

  /* ── Lab & Investigation ─────────────────────────────── */
  {
    id: "lab", label: "Lab & Investigation",
    icon: "pi-search-plus", color: "#0284c7", light: "#f0f9ff",
    roles: [ADMIN, LB, RL, DR],
    items: [
      { label: "Investigation Orders",  icon: "pi-list",   path: "/investigation-orders",  roles: [ADMIN, LB, RL, DR] },
      { label: "Investigation Master",  icon: "pi-cog",    path: "/investigation-master",  roles: [ADMIN, LB] },
    ],
  },

  /* ── Billing & Finance ──────────────────────────────── */
  {
    id: "billing", label: "Billing",
    icon: "pi-receipt", color: "#d97706", light: "#fffbeb",
    roles: [ADMIN, AC, TPA, RX],
    items: [
      // RX-flavored unified billing & payment collection (rx-page style)
      { label: "Billing & Payments",    icon: "pi-receipt", path: "/reception-billing",     roles: [RX] },
      // Full billing UIs for accountants / admin
      { label: "Patient Bill",          icon: "pi-user",    path: "/patient-billing",       roles: [ADMIN, AC, TPA] },
      { label: "Bills List",            icon: "pi-file",    path: "/billing",               roles: [ADMIN, AC] },
      { label: "Billing Intelligence",  icon: "pi-bolt",    path: "/billing-intelligence",  badge: "AI",  roles: [ADMIN, AC] },
      { label: "Billing Audit Trail",   icon: "pi-list",    path: "/billing-audit-trail",                 roles: [ADMIN, AC] },
      { label: "TPA Services",          icon: "pi-briefcase", path: "/addservice",          roles: [ADMIN, TPA, AC] },
      { label: "Chargeable Services",   icon: "pi-dollar",  path: "/chargeable-services",   roles: [ADMIN, AC] },
      { label: "Service Master",        icon: "pi-cog",     path: "/service-master",        roles: [ADMIN] },
    ],
  },

  /* ── Masters & Admin ─────────────────────────────────── */
  {
    id: "masters", label: "Masters & Admin",
    icon: "pi-sliders-h", color: "#374151", light: "#f9fafb",
    roles: [ADMIN],   // Admin only
    items: [
      { label: "Hospital Settings",  icon: "pi-building",   path: "/hospital-settings", badge: "NEW" },
      { label: "Department",         icon: "pi-sitemap",    path: "/department" },
      { label: "Doctor Management",  icon: "pi-user-edit",  path: "/doctors" },
      { label: "User Management",    icon: "pi-users",      path: "/admin/users" },
      { label: "Hospital Charges",   icon: "pi-dollar",     path: "/hospital-charges" },
      { label: "Buildings",          icon: "pi-building",   path: "/buildings" },
      { label: "Floors",             icon: "pi-arrows-v",   path: "/floors" },
      { label: "Rooms",              icon: "pi-box",        path: "/rooms" },
      { label: "Room Category",      icon: "pi-th-large",   path: "/roomcategory" },
    ],
  },
];

/* ══════════════════════════════════════════════════════════════
   ROLE FILTERING HELPER
══════════════════════════════════════════════════════════════ */
function canSee(roles, userRole) {
  if (!roles || roles.length === 0) return userRole === ADMIN;
  if (roles.includes("*")) return true;
  return roles.includes(userRole);
}

function filterNav(nav, userRole) {
  if (userRole === ADMIN) return nav; // Admin sees everything unfiltered
  return nav
    .filter(section => canSee(section.roles, userRole))
    .map(section => {
      if (section.single || !section.items) return section;
      const items = section.items.filter(item => canSee(item.roles, userRole));
      return items.length > 0 ? { ...section, items } : null;
    })
    .filter(Boolean);
}

/* ══════════════════════════════════════════════════════════════
   BADGE PILL
══════════════════════════════════════════════════════════════ */
function Pill({ label, color = "#7c3aed", bg }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: ".6px",
      padding: "2px 6px", borderRadius: 20,
      background: bg || color + "18",
      color, border: `1px solid ${color}30`,
      flexShrink: 0, lineHeight: 1.4,
    }}>{label}</span>
  );
}

/* ══════════════════════════════════════════════════════════════
   NAV ITEM
══════════════════════════════════════════════════════════════ */
function NavItem({ item, color, collapsed, navigate, isActive }) {
  const active = isActive(item.path);
  return (
    <button
      onClick={() => navigate(item.path)}
      title={collapsed ? item.label : ""}
      style={{
        width: "100%", border: "none", cursor: "pointer",
        display: "flex", alignItems: "center",
        gap: 10, padding: collapsed ? "9px 0" : "8px 14px 8px 36px",
        justifyContent: collapsed ? "center" : "flex-start",
        background: active ? color + "12" : "transparent",
        borderLeft: active ? `3px solid ${color}` : "3px solid transparent",
        borderRadius: "0 8px 8px 0",
        marginBottom: 1, transition: "all .15s",
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#f1f5f9"; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = active ? color + "12" : "transparent"; }}
    >
      <i className={`pi ${item.icon}`}
        style={{ fontSize: 13, color: active ? color : "#64748b", minWidth: 14, textAlign: "center" }} />
      {!collapsed && (
        <>
          <span style={{
            fontSize: 12.5, fontWeight: active ? 600 : 400,
            color: active ? color : "#334155", flex: 1, textAlign: "left",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{item.label}</span>
          {item.nabh  && <Pill label="NABH" color="#7c3aed" />}
          {item.badge === "AI"  && <Pill label="AI"  color="#059669" />}
          {item.badge === "NEW" && <Pill label="NEW" color="#d97706" />}
        </>
      )}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════
   SECTION HEADER
══════════════════════════════════════════════════════════════ */
function SectionHeader({ section, collapsed, isOpen, toggle, isActive, navigate }) {
  const anyActive = !section.single && section.items?.some(i => isActive(i.path));

  if (section.single) {
    const active = isActive(section.path);
    return (
      <button
        onClick={() => navigate(section.path)}
        title={collapsed ? section.label : ""}
        style={{
          width: "100%", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center",
          gap: 10, padding: collapsed ? "10px 0" : "10px 16px",
          justifyContent: collapsed ? "center" : "flex-start",
          background: active ? section.color + "12" : "transparent",
          borderLeft: active ? `3px solid ${section.color}` : "3px solid transparent",
          transition: "all .15s",
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#f1f5f9"; }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = active ? section.color + "12" : "transparent"; }}
      >
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: active ? section.color : section.light,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s",
        }}>
          <i className={`pi ${section.icon}`}
            style={{ fontSize: 13, color: active ? "white" : section.color }} />
        </div>
        {!collapsed && (
          <span style={{
            fontSize: 13, fontWeight: 600,
            color: active ? section.color : "#1e293b",
          }}>{section.label}</span>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      title={collapsed ? section.label : ""}
      style={{
        width: "100%", border: "none", cursor: "pointer",
        display: "flex", alignItems: "center",
        gap: 10, padding: collapsed ? "10px 0" : "10px 16px",
        justifyContent: collapsed ? "center" : "flex-start",
        background: anyActive ? section.color + "08" : "transparent",
        borderLeft: anyActive ? `3px solid ${section.color}` : "3px solid transparent",
        transition: "all .15s",
      }}
      onMouseEnter={e => { if (!anyActive) e.currentTarget.style.background = "#f8fafc"; }}
      onMouseLeave={e => { if (!anyActive) e.currentTarget.style.background = anyActive ? section.color + "08" : "transparent"; }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        background: isOpen || anyActive ? section.color : section.light,
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all .2s",
      }}>
        <i className={`pi ${section.icon}`}
          style={{ fontSize: 13, color: isOpen || anyActive ? "white" : section.color }} />
      </div>
      {!collapsed && (
        <>
          <span style={{
            fontSize: 13, fontWeight: 600, flex: 1, textAlign: "left",
            color: isOpen || anyActive ? section.color : "#1e293b",
            whiteSpace: "nowrap",
          }}>{section.label}</span>
          {section.nabh && <Pill label="NABH" color="#7c3aed" />}
          <i className={`pi ${isOpen ? "pi-chevron-up" : "pi-chevron-down"}`}
            style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0 }} />
        </>
      )}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN SIDEBAR
══════════════════════════════════════════════════════════════ */
export default function Sidebar({ collapsed, setCollapsed }) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user, logout } = useAuth();

  const userRole = user?.role || ADMIN;
  const roleMeta = ROLE_META[userRole] || ROLE_META.Admin;

  /* Filter NAV based on role */
  const visibleNav = useMemo(() => filterNav(NAV, userRole), [userRole]);

  /* Open state — default open for first two sections */
  const [open, setOpen] = useState(() => {
    const init = {};
    visibleNav.forEach((s, i) => { if (i < 2) init[s.id] = true; });
    return init;
  });

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(path + "/");

  const toggle = (id) => setOpen(p => ({ ...p, [id]: !p[id] }));

  const W = collapsed ? 64 : 260;

  /* ── User initials ── */
  const initials = user?.name
    ? user.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() || "?";

  const userName = user?.name || user?.email || "User";

  return (
    <div style={{
      position: "fixed", left: 0, top: 52, bottom: 0, width: W,
      background: "#fff",
      boxShadow: "2px 0 20px rgba(0,0,0,.07)",
      transition: "width .25s cubic-bezier(.4,0,.2,1)",
      zIndex: 900, display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>

      {/* ── Brand / collapse toggle ── */}
      <div style={{
        padding: collapsed ? "12px 0" : "12px 16px",
        borderBottom: "1px solid #f1f5f9",
        display: "flex", alignItems: "center",
        justifyContent: collapsed ? "center" : "space-between",
        background: "linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%)",
        flexShrink: 0,
      }}>
        {!collapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 30, height: 30,
              background: "linear-gradient(135deg,#38bdf8,#7c3aed)",
              borderRadius: 8, display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 14, fontWeight: 900, color: "#fff",
            }}>S</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
                SphereHealth<span style={{ color: "#38bdf8" }}>HIS</span>
              </div>
              <div style={{ fontSize: 9, color: "#94a3b8", letterSpacing: ".8px", marginTop: 2 }}>
                NABH ACCREDITED
              </div>
            </div>
          </div>
        )}
        {collapsed && (
          <div style={{
            width: 30, height: 30,
            background: "linear-gradient(135deg,#38bdf8,#7c3aed)",
            borderRadius: 8, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 14, fontWeight: 900, color: "#fff",
          }}>S</div>
        )}
        <button
          onClick={() => setCollapsed(p => !p)}
          style={{
            background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.15)",
            borderRadius: 6, width: 26, height: 26, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <i className={`pi ${collapsed ? "pi-angle-double-right" : "pi-angle-double-left"}`}
            style={{ fontSize: 11, color: "#cbd5e1" }} />
        </button>
      </div>

      {/* ── Role identity card ── */}
      {!collapsed && user && (
        <div style={{
          padding: "10px 14px",
          borderBottom: "1px solid #f1f5f9",
          background: roleMeta.light,
          display: "flex", alignItems: "center", gap: 10,
          flexShrink: 0,
        }}>
          {/* Avatar */}
          <div style={{
            width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
            background: `linear-gradient(135deg, ${roleMeta.color}, ${roleMeta.color}aa)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 800, color: "#fff",
            border: `2px solid ${roleMeta.color}30`,
          }}>{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12.5, fontWeight: 700, color: "#1e293b",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{userName}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%",
                background: roleMeta.color, flexShrink: 0,
              }} />
              <span style={{
                fontSize: 10, fontWeight: 700, color: roleMeta.color,
                letterSpacing: ".4px",
              }}>{roleMeta.label}</span>
            </div>
          </div>
          <button
            onClick={logout}
            title="Logout"
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: 4, color: "#94a3b8", borderRadius: 6,
              display: "flex", alignItems: "center",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "#fee2e2"; e.currentTarget.style.color = "#dc2626"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#94a3b8"; }}
          >
            <i className="pi pi-sign-out" style={{ fontSize: 13 }} />
          </button>
        </div>
      )}

      {/* Collapsed role dot */}
      {collapsed && user && (
        <div style={{
          padding: "8px 0", display: "flex", flexDirection: "column",
          alignItems: "center", gap: 4, borderBottom: "1px solid #f1f5f9",
          background: roleMeta.light, flexShrink: 0,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            background: `linear-gradient(135deg, ${roleMeta.color}, ${roleMeta.color}aa)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 800, color: "#fff",
          }} title={`${userName} — ${roleMeta.label}`}>{initials}</div>
        </div>
      )}

      {/* ── Scrollable nav ── */}
      <div style={{
        flex: 1, overflowY: "auto", overflowX: "hidden",
        padding: "6px 0 20px",
        scrollbarWidth: "thin", scrollbarColor: "#e2e8f0 transparent",
      }}>
        {visibleNav.map((section, si) => (
          <div key={section.id}>
            {si > 0 && !collapsed && (
              <div style={{ height: 1, background: "#f1f5f9", margin: "4px 16px 4px" }} />
            )}

            <SectionHeader
              section={section}
              collapsed={collapsed}
              isOpen={!!open[section.id]}
              toggle={() => toggle(section.id)}
              isActive={isActive}
              navigate={navigate}
            />

            {!section.single && section.items && (
              <div style={{
                maxHeight: open[section.id] && !collapsed ? section.items.length * 38 : 0,
                overflow: "hidden",
                transition: "max-height .25s cubic-bezier(.4,0,.2,1)",
              }}>
                {section.items.map(item => (
                  <NavItem
                    key={item.path + item.label}
                    item={item}
                    color={section.color}
                    collapsed={collapsed}
                    navigate={navigate}
                    isActive={isActive}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Footer — item count summary ── */}
      {!collapsed && (
        <div style={{
          padding: "8px 14px",
          borderTop: "1px solid #f1f5f9",
          background: "#f8fafc", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 20, height: 20, borderRadius: 5,
              background: roleMeta.color,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <i className={`pi ${roleMeta.icon}`} style={{ fontSize: 10, color: "#fff" }} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#1e293b", lineHeight: 1 }}>SphereHealth HIS</div>
              <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>v2.0 · NABH Ready</div>
            </div>
          </div>
          <span style={{
            fontSize: 9, color: roleMeta.color, fontWeight: 700,
            background: roleMeta.light, padding: "2px 7px",
            borderRadius: 10, border: `1px solid ${roleMeta.color}30`,
            letterSpacing: ".4px",
          }}>{roleMeta.label.toUpperCase()}</span>
        </div>
      )}

      <style>{`
        div::-webkit-scrollbar { width: 4px; }
        div::-webkit-scrollbar-track { background: transparent; }
        div::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }
        div::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}</style>
    </div>
  );
}
