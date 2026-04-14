import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/* ── Role sets ── */
const R = {
  ALL:        ["Admin","Doctor","Nurse","Receptionist","Dietician","TPA Coordinator","Pharmacist","Lab Technician"],
  ADMIN:      ["Admin"],
  DOCTOR:     ["Admin","Doctor"],
  NURSE_ONLY: ["Admin","Nurse"],
  NURSE:      ["Admin","Nurse","Doctor"],           // MAR + vitals update: both can do
  BILLING:    ["Admin","Receptionist","TPA Coordinator"],
  RECEPT:     ["Admin","Receptionist"],
  CLINICAL:   ["Admin","Doctor","Nurse"],            // strict: no Dietician on clinical pages
  TPA:        ["Admin","TPA Coordinator"],
  FRONT_DESK: ["Admin","Receptionist"],              // registration, IPD, OPD booking
  VIEW_PATIENTS: ["Admin","Doctor","Nurse","Receptionist","TPA Coordinator"],
};

const allowed = (roles, userRole) => !roles || roles.includes(userRole);

/* ── Menu structure ── */
const MENU = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "pi-home",
    color: "#6366f1",
    bg: "#eef2ff",
    path: "/mainpage",
    roles: R.ALL,
  },
  {
    key: "patients",
    label: "Patient Management",
    icon: "pi-users",
    color: "#0ea5e9",
    bg: "#f0f9ff",
    roles: R.VIEW_PATIENTS,
    items: [
      { label: "IPD Admission",    icon: "pi-plus-circle",  path: "/ipd-admission",     roles: R.FRONT_DESK, badge: "NEW" },
      { label: "OPD Registration", icon: "pi-user-plus",    path: "/opd-register",      roles: R.FRONT_DESK, badge: "UHID" },
      { label: "Registration",     icon: "pi-user-plus",    path: "/registration/ipd",  roles: R.FRONT_DESK },
      { label: "Patient List",     icon: "pi-list",         path: "/allpatient",        roles: R.VIEW_PATIENTS },
      { label: "Patient Records",  icon: "pi-id-card",      path: "/patients",          roles: R.VIEW_PATIENTS },
      { label: "Patient History",  icon: "pi-clock",        path: "/patient-history",   roles: R.CLINICAL },
    ],
  },
  {
    key: "opd",
    label: "OPD / Emergency",
    icon: "pi-truck",
    color: "#f97316",
    bg: "#fff7ed",
    roles: ["Admin","Doctor","Nurse","Receptionist"],
    items: [
      { label: "OPD Registration", icon: "pi-user-plus",   path: "/opd-register",      roles: R.FRONT_DESK, badge: "UHID" },
      { label: "OPD Queue",        icon: "pi-list",         path: "/opd-queue",         roles: R.NURSE },
      { label: "My OPD Patients",  icon: "pi-stop-circle",  path: "/doctor-opd-panel",  roles: R.DOCTOR },
      { label: "OPD Visits",       icon: "pi-calendar",    path: "/opd-visit",         roles: ["Admin","Doctor","Receptionist"] },
      { label: "New OPD",          icon: "pi-plus-circle", path: "/opd/new",           roles: R.FRONT_DESK },
      { label: "Emergency",        icon: "pi-bolt",         path: "/emergency",         roles: ["Admin","Doctor","Nurse","Receptionist"], badge: "URGENT" },
    ],
  },
  {
    key: "doctor",
    label: "Clinical — Doctor",
    icon: "pi-stop-circle",
    color: "#14b8a6",
    bg: "#f0fdfa",
    roles: R.DOCTOR,
    items: [
      { label: "My OPD Patients",        icon: "pi-users",                path: "/doctor-opd-panel",     roles: R.DOCTOR, badge: "NEW" },
      { label: "OPD Assessment",         icon: "pi-file-check",           path: "/opd-assessment",       roles: R.DOCTOR },
      { label: "Emergency Assessment",   icon: "pi-exclamation-triangle", path: "/emergency-assessment", roles: R.DOCTOR },
      { label: "IPD Initial Assessment", icon: "pi-clipboard",            path: "/ipd-assessment",       roles: R.CLINICAL },
      { label: "IPD Daily Assessment",   icon: "pi-file-edit",            path: "/doctor-assessment",    roles: R.DOCTOR },
      { label: "Discharge Summary",      icon: "pi-sign-out",             path: "/discharge-summary",    roles: R.DOCTOR },
      { label: "Consent Forms",          icon: "pi-shield",               path: "/consent-forms",        roles: R.CLINICAL },
    ],
  },
  {
    key: "nursing",
    label: "Clinical — Nursing",
    icon: "pi-heart",
    color: "#ec4899",
    bg: "#fdf2f8",
    roles: R.NURSE_ONLY,
    items: [
      { label: "OPD Queue",          icon: "pi-list",                   path: "/opd-queue",                roles: R.NURSE_ONLY, badge: "NEW" },
      { label: "Initial Assessment", icon: "pi-clipboard",              path: "/nurse-initial-assessment", roles: R.NURSE_ONLY, badge: "NABH" },
      { label: "Nursing Notes",      icon: "pi-pencil",                 path: "/nursing-notes",            roles: R.NURSE_ONLY },
      { label: "Care Plan",          icon: "pi-heart-fill",             path: "/nursing-care-plan",        roles: R.NURSE_ONLY },
      { label: "Handover Notes",     icon: "pi-arrow-right-arrow-left", path: "/nursing-handover-notes",   roles: R.NURSE_ONLY },
      { label: "MAR",                icon: "pi-list-check",             path: "/mar",                      roles: R.NURSE },
    ],
  },
  {
    key: "vitals",
    label: "Vitals",
    icon: "pi-chart-line",
    color: "#22c55e",
    bg: "#f0fdf4",
    roles: R.CLINICAL,
    items: [
      { label: "Update Vitals", icon: "pi-plus",      path: "/updateVitalSheet", roles: R.NURSE_ONLY },
      { label: "Vital Sheet",   icon: "pi-table",     path: "/vitalSheet",       roles: R.CLINICAL },
      { label: "Vitals View",   icon: "pi-chart-bar", path: "/vitalsView",       roles: R.CLINICAL },
    ],
  },
  {
    key: "billing",
    label: "Billing",
    icon: "pi-receipt",
    color: "#f59e0b",
    bg: "#fffbeb",
    roles: R.BILLING,
    items: [
      { label: "Patient Billing",  icon: "pi-user",   path: "/patient-billing",  roles: R.BILLING },
      { label: "Bills List",       icon: "pi-list",   path: "/billing",          roles: R.BILLING },
      { label: "Service Master",   icon: "pi-cog",    path: "/service-master",   roles: R.ADMIN },
      { label: "Hospital Charges", icon: "pi-dollar", path: "/hospital-charges", roles: R.ADMIN },
    ],
  },
  {
    key: "beds",
    label: "Bed Management",
    icon: "pi-th-large",
    color: "#8b5cf6",
    bg: "#f5f3ff",
    roles: R.FRONT_DESK,
    items: [
      { label: "Manage Beds",       icon: "pi-list",     path: "/beds",         roles: R.FRONT_DESK },
      { label: "Bed Visual Layout", icon: "pi-map",      path: "/bed-visual",   roles: R.CLINICAL },
      { label: "Wards",             icon: "pi-building", path: "/wards",        roles: R.FRONT_DESK },
      { label: "Rooms",             icon: "pi-box",      path: "/rooms",        roles: R.FRONT_DESK },
      { label: "Room Category",     icon: "pi-tags",     path: "/roomcategory", roles: R.ADMIN },
    ],
  },
  {
    key: "masters",
    label: "Masters",
    icon: "pi-database",
    color: "#64748b",
    bg: "#f8fafc",
    roles: R.ADMIN,
    items: [
      { label: "User Management", icon: "pi-users",       path: "/admin/users", roles: R.ADMIN },
      { label: "Buildings",       icon: "pi-building",    path: "/buildings",   roles: R.ADMIN },
      { label: "Floors",          icon: "pi-bars",        path: "/floors",      roles: R.ADMIN },
      { label: "Departments",     icon: "pi-sitemap",     path: "/department",  roles: R.ADMIN },
      { label: "Doctors",         icon: "pi-user-edit",   path: "/doctors",     roles: R.ADMIN },
      { label: "Add TPA",         icon: "pi-briefcase",   path: "/addtpa",      roles: R.TPA },
      { label: "TPA Services",    icon: "pi-plus-circle", path: "/addservice",  roles: R.TPA },
    ],
  },
];

/* ── Badge chip ── */
function Badge({ label, color }) {
  const colors = {
    NEW:    { bg: "#dcfce7", text: "#16a34a" },
    NABH:   { bg: "#f5f3ff", text: "#7c3aed" },
    URGENT: { bg: "#fef2f2", text: "#dc2626" },
  };
  const c = colors[label] || { bg: "#f1f5f9", text: "#64748b" };
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: ".4px",
      padding: "2px 6px", borderRadius: 4,
      background: c.bg, color: c.text,
      flexShrink: 0,
    }}>{label}</span>
  );
}

/* ── Single nav section ── */
function NavSection({ section, role, openKey, setOpenKey, location, navigate, collapsed }) {
  if (!allowed(section.roles, role)) return null;

  const isDirect = !section.items;
  const isOpen   = openKey === section.key;
  const isActive = isDirect
    ? location.pathname === section.path
    : section.items?.some(i => location.pathname === i.path || location.pathname.startsWith(i.path + "/"));

  const toggle = () => {
    if (isDirect) { navigate(section.path); return; }
    setOpenKey(isOpen ? null : section.key);
  };

  if (collapsed) return null; // collapsed handled separately

  return (
    <div style={{ marginBottom: 2 }}>
      {/* Section header button */}
      <button
        onClick={toggle}
        title={section.label}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          gap: 10, padding: "9px 12px",
          background: isActive ? section.color + "12" : "transparent",
          border: "none", borderRadius: 10,
          cursor: "pointer", transition: "all .15s",
          borderLeft: isActive ? `3px solid ${section.color}` : "3px solid transparent",
        }}
        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = section.bg; }}
        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
      >
        {/* Icon pill */}
        <span style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: isActive ? section.color : section.bg,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .15s",
        }}>
          <i className={`pi ${section.icon}`} style={{
            fontSize: 13,
            color: isActive ? "white" : section.color,
          }} />
        </span>

        {/* Label */}
        <span style={{
          flex: 1, textAlign: "left",
          fontSize: 12.5, fontWeight: isActive ? 700 : 600,
          color: isActive ? section.color : "#334155",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {section.label}
        </span>

        {/* Chevron */}
        {!isDirect && (
          <i className={`pi ${isOpen ? "pi-chevron-down" : "pi-chevron-right"}`}
            style={{ fontSize: 10, color: "#94a3b8", transition: "transform .2s",
              transform: isOpen ? "rotate(0deg)" : "rotate(0deg)" }} />
        )}
      </button>

      {/* Sub-items */}
      {!isDirect && isOpen && (
        <div style={{
          marginLeft: 18, marginTop: 2, marginBottom: 4,
          borderLeft: `2px solid ${section.color}25`,
          paddingLeft: 8,
          animation: "slideDown .15s ease",
        }}>
          {section.items
            .filter(item => allowed(item.roles, role))
            .map(item => {
              const active = location.pathname === item.path || location.pathname.startsWith(item.path + "/");
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center",
                    gap: 8, padding: "7px 10px",
                    background: active ? section.color + "15" : "transparent",
                    border: "none", borderRadius: 8,
                    cursor: "pointer", transition: "all .12s",
                    marginBottom: 1,
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = section.color + "08"; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{
                    width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                    background: active ? section.color + "20" : "#f1f5f9",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <i className={`pi ${item.icon}`} style={{ fontSize: 11, color: active ? section.color : "#94a3b8" }} />
                  </span>
                  <span style={{
                    flex: 1, textAlign: "left",
                    fontSize: 12, fontWeight: active ? 700 : 500,
                    color: active ? section.color : "#475569",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {item.label}
                  </span>
                  {item.badge && <Badge label={item.badge} />}
                  {active && (
                    <span style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: section.color, flexShrink: 0,
                    }} />
                  )}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════
   MAIN SIDEBAR
═══════════════════════════════════ */
export default function Sidebar({ collapsed, setCollapsed }) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user }  = useAuth();
  const role      = user?.role || "Admin";

  // Auto-open the section that contains the active route
  const activeSection = MENU.find(s =>
    s.path === location.pathname ||
    s.items?.some(i => location.pathname === i.path || location.pathname.startsWith(i.path + "/"))
  );
  const [openKey, setOpenKey] = useState(activeSection?.key || null);

  const W = collapsed ? 64 : 260;

  /* ── Collapsed icon strip ── */
  const collapsedItems = MENU.filter(s => allowed(s.roles, role));

  return (
    <div
      className="his-sidebar"
      style={{
        width: W,
        transition: "width .22s cubic-bezier(.4,0,.2,1)",
        overflowX: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── Brand ── */}
      <div style={{
        display: "flex", alignItems: "center",
        padding: collapsed ? "14px 0" : "14px 14px",
        justifyContent: collapsed ? "center" : "space-between",
        borderBottom: "1px solid #f1f5f9",
        flexShrink: 0,
      }}>
        {!collapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: "linear-gradient(135deg, #6366f1, #0ea5e9)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ color: "white", fontWeight: 900, fontSize: 13 }}>S</span>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>
                Sphere<span style={{ color: "#6366f1" }}>Health</span>
              </div>
              <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600, letterSpacing: ".5px" }}>HIS PLATFORM</div>
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(p => !p)}
          title={collapsed ? "Expand" : "Collapse"}
          style={{
            width: 28, height: 28, border: "1px solid #e2e8f0", borderRadius: 7,
            background: "white", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#64748b", fontSize: 12, flexShrink: 0,
          }}
        >
          <i className={`pi ${collapsed ? "pi-angle-right" : "pi-angle-left"}`} />
        </button>
      </div>

      {/* ── User card ── */}
      {!collapsed && user && (
        <div style={{
          margin: "10px 10px 4px",
          padding: "10px 12px",
          background: "linear-gradient(135deg, #f8faff, #f0f4ff)",
          borderRadius: 10,
          border: "1px solid #e0e7ff",
          display: "flex", alignItems: "center", gap: 10,
          flexShrink: 0,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "white", fontSize: 13, fontWeight: 700,
            boxShadow: "0 2px 8px #6366f130",
          }}>
            {(user.fullName || user.firstName || "U")[0].toUpperCase()}
          </div>
          <div style={{ overflow: "hidden", flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#1e293b",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim()}
            </div>
            <div style={{ fontSize: 10, color: "#6366f1", fontWeight: 600 }}>{user.role}</div>
          </div>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#22c55e", boxShadow: "0 0 0 2px #dcfce7", flexShrink: 0,
          }} />
        </div>
      )}

      {/* ── Expanded nav ── */}
      {!collapsed && (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 80px", scrollbarWidth: "none" }}>
          <style>{`
            @keyframes slideDown {
              from { opacity: 0; transform: translateY(-6px); }
              to   { opacity: 1; transform: translateY(0); }
            }
            .his-sidebar div::-webkit-scrollbar { display: none; }
          `}</style>

          {MENU.map(section => (
            <NavSection
              key={section.key}
              section={section}
              role={role}
              openKey={openKey}
              setOpenKey={setOpenKey}
              location={location}
              navigate={navigate}
              collapsed={false}
            />
          ))}
        </div>
      )}

      {/* ── Collapsed icon strip ── */}
      {collapsed && (
        <div style={{
          flex: 1, overflowY: "auto", padding: "8px 0",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
          scrollbarWidth: "none",
        }}>
          {/* User avatar */}
          {user && (
            <div style={{
              width: 34, height: 34, borderRadius: "50%", marginBottom: 6,
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "white", fontSize: 13, fontWeight: 700,
            }}>
              {(user.fullName || user.firstName || "U")[0].toUpperCase()}
            </div>
          )}

          {collapsedItems.map(section => {
            const isActive = section.path === location.pathname ||
              section.items?.some(i => location.pathname === i.path);
            return (
              <button
                key={section.key}
                title={section.label}
                onClick={() => {
                  setCollapsed(false);
                  setOpenKey(section.key);
                }}
                style={{
                  width: 40, height: 40, border: "none", borderRadius: 10,
                  background: isActive ? section.color + "18" : "transparent",
                  cursor: "pointer", transition: "all .15s",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  position: "relative",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = section.bg; }}
                onMouseLeave={e => { e.currentTarget.style.background = isActive ? section.color + "18" : "transparent"; }}
              >
                <i className={`pi ${section.icon}`} style={{ fontSize: 15, color: isActive ? section.color : "#94a3b8" }} />
                {isActive && (
                  <span style={{
                    position: "absolute", left: 2, top: "50%", transform: "translateY(-50%)",
                    width: 3, height: 18, borderRadius: 3, background: section.color,
                  }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
