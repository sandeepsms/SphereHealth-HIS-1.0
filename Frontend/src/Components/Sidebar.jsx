import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "primeicons/primeicons.css";

/* ─── Section definitions ──────────────────────────────────────────────── */
const NAV = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "pi-home",
    color: "#1e40af",
    light: "#eff6ff",
    path: "/mainpage",
    single: true,
  },
  {
    id: "patient",
    label: "Patient Management",
    icon: "pi-users",
    color: "#0891b2",
    light: "#ecfeff",
    nabh: true,
    items: [
      { label: "IPD Admission",    icon: "pi-plus-circle",          path: "/ipd-admission",     nabh: true },
      { label: "OPD Registration", icon: "pi-user-plus",             path: "/opd-register" },
      { label: "Emergency",        icon: "pi-exclamation-triangle",  path: "/emergency" },
      { label: "Patient Search",   icon: "pi-search",                path: "/allpatient" },
      { label: "Patient Records",  icon: "pi-id-card",               path: "/patients" },
      { label: "Visit History",    icon: "pi-clock",                 path: "/patient-history" },
    ],
  },
  {
    id: "opd",
    label: "OPD / Emergency",
    icon: "pi-building",
    color: "#059669",
    light: "#ecfdf5",
    items: [
      { label: "OPD Queue",          icon: "pi-list",      path: "/opd-queue" },
      { label: "OPD Visits",         icon: "pi-calendar",  path: "/opd-visit" },
      { label: "Doctor OPD Panel",   icon: "pi-desktop",   path: "/doctor-opd-panel" },
      { label: "Emergency Cases",    icon: "pi-bolt",      path: "/emergency" },
    ],
  },
  {
    id: "doctor",
    label: "Clinical — Doctor",
    icon: "pi-user-edit",
    color: "#7c3aed",
    light: "#f5f3ff",
    nabh: true,
    items: [
      { label: "Patient Panel",           icon: "pi-id-card",             path: "/doctor-patient-panel" },
      { label: "IPD Assessment",         icon: "pi-file-edit",           path: "/doctor-assessment",      nabh: true },
      { label: "Doctor Notes",            icon: "pi-file-edit",           path: "/doctor-notes",           nabh: true },
      { label: "Emergency Assessment",   icon: "pi-exclamation-circle",  path: "/emergency-assessment" },
      { label: "Discharge Summary",      icon: "pi-sign-out",            path: "/discharge-summary",      nabh: true },
      { label: "Consent Forms",          icon: "pi-shield",              path: "/consent-forms",          nabh: true },
      { label: "Prescriptions",          icon: "pi-pencil",              path: "/doctor-opd-panel" },
    ],
  },
  {
    id: "nursing",
    label: "Clinical — Nursing",
    icon: "pi-heart",
    color: "#db2777",
    light: "#fdf2f8",
    nabh: true,
    items: [
      { label: "Nursing Notes",   icon: "pi-file-edit", path: "/nursing-notes", nabh: true },
      { label: "OPD Queue",       icon: "pi-list",      path: "/opd-queue" },
      { label: "Patient Panel",   icon: "pi-id-card",   path: "/nurse-patient-panel" },
    ],
  },
  {
    id: "pharmacy",
    label: "Pharmacy / MAR",
    icon: "pi-box",
    color: "#ea580c",
    light: "#fff7ed",
    nabh: true,
    items: [
      { label: "MAR",              icon: "pi-table",          path: "/mar",  nabh: true },
      { label: "Pharmacy Indent",  icon: "pi-shopping-cart",  path: "/mar" },
    ],
  },
  {
    id: "lab",
    label: "Lab & Investigation",
    icon: "pi-search-plus",
    color: "#0284c7",
    light: "#f0f9ff",
    items: [
      { label: "Investigation Orders",  icon: "pi-list",   path: "/investigation-orders" },
      { label: "Investigation Master",  icon: "pi-cog",    path: "/investigation-master" },
      { label: "Lab Staff",             icon: "pi-users",  path: "/lab-staff" },
    ],
  },
  {
    id: "vitals",
    label: "Vitals",
    icon: "pi-chart-line",
    color: "#16a34a",
    light: "#f0fdf4",
    items: [
      { label: "Update Vitals",  icon: "pi-pencil",    path: "/updateVitalSheet" },
      { label: "Vital Sheet",    icon: "pi-table",     path: "/vitalSheet" },
      { label: "Vitals View",    icon: "pi-chart-bar", path: "/vitalsView" },
    ],
  },
  {
    id: "billing",
    label: "Billing & Finance",
    icon: "pi-receipt",
    color: "#d97706",
    light: "#fffbeb",
    items: [
      { label: "Patient Bill",             icon: "pi-user",    path: "/patient-billing" },
      { label: "Billing Intelligence",     icon: "pi-bolt",    path: "/billing-intelligence",  badge: "AI" },
      { label: "Billing Audit Trail",      icon: "pi-list",    path: "/billing-audit-trail",   badge: "NEW" },
      { label: "Service Master",           icon: "pi-cog",     path: "/service-master" },
      { label: "Chargeable Services",      icon: "pi-dollar",  path: "/chargeable-services" },
      { label: "Bills List",               icon: "pi-file",    path: "/billing" },
    ],
  },
  {
    id: "beds",
    label: "Bed Management",
    icon: "pi-table",
    color: "#475569",
    light: "#f8fafc",
    items: [
      { label: "Bed Visual Layout",  icon: "pi-eye",      path: "/bed-visual" },
      { label: "Manage Beds",        icon: "pi-list",     path: "/beds" },
      { label: "Wards",              icon: "pi-home",     path: "/wards" },
      { label: "Rooms",              icon: "pi-box",      path: "/rooms" },
      { label: "Room Category",      icon: "pi-th-large", path: "/roomcategory" },
    ],
  },
  {
    id: "masters",
    label: "Masters & Admin",
    icon: "pi-sliders-h",
    color: "#374151",
    light: "#f9fafb",
    items: [
      { label: "Hospital Settings",  icon: "pi-building",   path: "/hospital-settings", badge: "NEW" },
      { label: "Department",         icon: "pi-sitemap",    path: "/department" },
      { label: "Doctor Management",  icon: "pi-user-edit",  path: "/doctors" },
      { label: "User Management",    icon: "pi-users",      path: "/admin/users" },
      { label: "Hospital Charges",   icon: "pi-dollar",     path: "/hospital-charges" },
      { label: "TPA Services",       icon: "pi-briefcase",  path: "/addservice" },
      { label: "Buildings",          icon: "pi-building",   path: "/buildings" },
      { label: "Floors",             icon: "pi-arrows-v",   path: "/floors" },
    ],
  },
];

/* ─── Badge pill ────────────────────────────────────────────────────────── */
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

/* ─── Single nav item ────────────────────────────────────────────────────── */
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
        position: "relative",
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#f1f5f9"; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
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
          {item.nabh && <Pill label="NABH" color="#7c3aed" />}
          {item.badge === "AI" && <Pill label="AI" color="#059669" />}
          {item.badge === "NEW" && <Pill label="NEW" color="#d97706" />}
        </>
      )}
    </button>
  );
}

/* ─── Section header ────────────────────────────────────────────────────── */
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
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
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

/* ─── Main Sidebar ──────────────────────────────────────────────────────── */
export default function Sidebar({ collapsed, setCollapsed }) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const [open, setOpen] = useState({ dashboard: true, patient: true });

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(path + "/");

  const toggle = (id) => setOpen(p => ({ ...p, [id]: !p[id] }));

  const W = collapsed ? 64 : 260;

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

      {/* ── Scrollable nav ── */}
      <div style={{
        flex: 1, overflowY: "auto", overflowX: "hidden",
        padding: "6px 0 20px",
        scrollbarWidth: "thin", scrollbarColor: "#e2e8f0 transparent",
      }}>
        {NAV.map((section, si) => (
          <div key={section.id}>
            {/* Divider between groups */}
            {si > 0 && !collapsed && (
              <div style={{
                height: 1, background: "#f1f5f9",
                margin: "4px 16px 4px",
              }} />
            )}

            <SectionHeader
              section={section}
              collapsed={collapsed}
              isOpen={!!open[section.id]}
              toggle={() => toggle(section.id)}
              isActive={isActive}
              navigate={navigate}
            />

            {/* Sub-items */}
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

      {/* ── Footer ── */}
      {!collapsed && (
        <div style={{
          padding: "10px 16px",
          borderTop: "1px solid #f1f5f9",
          background: "#f8fafc",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: "linear-gradient(135deg,#0891b2,#7c3aed)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700, color: "#fff",
            }}>SH</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#1e293b" }}>SphereHealth HIS</div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>v2.0 · NABH Ready</div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        /* scrollbar */
        div::-webkit-scrollbar { width: 4px; }
        div::-webkit-scrollbar-track { background: transparent; }
        div::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }
        div::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}</style>
    </div>
  );
}
