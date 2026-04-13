import React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { PanelMenu } from "primereact/panelmenu";
import { useAuth } from "../context/AuthContext";

/* ── Role sets ── */
const R = {
  ALL:        ["Admin","Doctor","Nurse","Receptionist","Dietician","TPA Coordinator","Pharmacist","Lab Technician"],
  ADMIN:      ["Admin"],
  DOCTOR:     ["Admin","Doctor"],
  NURSE:      ["Admin","Nurse","Doctor"],
  BILLING:    ["Admin","Receptionist","TPA Coordinator"],
  RECEPT:     ["Admin","Receptionist"],
  CLINICAL:   ["Admin","Doctor","Nurse","Dietician"],
  TPA:        ["Admin","TPA Coordinator","Receptionist"],
};

const allowed = (roles, userRole) => !roles || roles.includes(userRole);

export default function Sidebar({ collapsed, setCollapsed }) {
  const navigate   = useNavigate();
  const location   = useLocation();
  const { user }   = useAuth();
  const role       = user?.role || "Admin";

  const go = (path) => navigate(path);

  /* ── Menu definition with role guards ── */
  const raw = [
    {
      label: "Dashboard",
      icon: "pi pi-home",
      command: () => go("/mainpage"),
      roles: R.ALL,
    },
    {
      label: "Patient Management",
      icon: "pi pi-users",
      roles: R.ALL,
      items: [
        { label: "Registration",    icon: "pi pi-user-plus", command: () => go("/registration/ipd"), roles: R.RECEPT },
        { label: "Patient List",    icon: "pi pi-list",      command: () => go("/allpatient"),        roles: R.ALL },
        { label: "Patient Records", icon: "pi pi-id-card",   command: () => go("/patients"),          roles: R.ALL },
      ],
    },
    {
      label: "OPD / Emergency",
      icon: "pi pi-hospital",
      roles: R.ALL,
      items: [
        { label: "OPD Visits",  icon: "pi pi-calendar",          command: () => go("/opd-visit"),  roles: R.ALL },
        { label: "New OPD",     icon: "pi pi-plus-circle",        command: () => go("/opd/new"),    roles: R.RECEPT },
        { label: "Emergency",   icon: "pi pi-exclamation-circle", command: () => go("/emergency"),  roles: R.ALL },
      ],
    },
    {
      label: "Clinical — Doctor",
      icon: "pi pi-stethoscope",
      roles: R.DOCTOR,
      items: [
        { label: "OPD Assessment",       icon: "pi pi-file-check",           command: () => go("/opd-assessment"),        roles: R.DOCTOR },
        { label: "Emergency Assessment", icon: "pi pi-exclamation-triangle", command: () => go("/emergency-assessment"), roles: R.DOCTOR },
        { label: "IPD Initial Assessment", icon: "pi pi-clipboard",          command: () => go("/ipd-assessment"),        roles: R.CLINICAL },
        { label: "IPD Daily Assessment",   icon: "pi pi-file-edit",          command: () => go("/doctor-assessment"),     roles: R.DOCTOR },
        { label: "Prescriptions",     icon: "pi pi-book",       command: () => go("/doctors"),           roles: R.DOCTOR },
        { label: "Discharge Summary", icon: "pi pi-sign-out",   command: () => go("/discharge-summary"), roles: R.DOCTOR },
        { label: "Consent Forms",     icon: "pi pi-file-check", command: () => go("/consent-forms"),     roles: R.CLINICAL },
      ],
    },
    {
      label: "Clinical — Nursing",
      icon: "pi pi-heart",
      roles: R.NURSE,
      items: [
        { label: "Nursing Notes",     icon: "pi pi-pencil",                    command: () => go("/nursing-notes"),          roles: R.NURSE },
        { label: "Nursing Care Plan", icon: "pi pi-heart",                     command: () => go("/nursing-care-plan"),      roles: R.NURSE },
        { label: "Handover Notes",    icon: "pi pi-arrow-right-arrow-left",    command: () => go("/nursing-handover-notes"), roles: R.NURSE },
        { label: "MAR",               icon: "pi pi-list",                      command: () => go("/mar"),                    roles: R.NURSE },
      ],
    },
    {
      label: "Vitals",
      icon: "pi pi-chart-line",
      roles: R.NURSE,
      items: [
        { label: "Update Vitals", icon: "pi pi-plus",  command: () => go("/updateVitalSheet"), roles: R.NURSE },
        { label: "Vital Sheet",   icon: "pi pi-table", command: () => go("/vitalSheet"),       roles: R.CLINICAL },
        { label: "Vitals View",   icon: "pi pi-eye",   command: () => go("/vitalsView"),       roles: R.CLINICAL },
      ],
    },
    {
      label: "Billing",
      icon: "pi pi-receipt",
      roles: R.BILLING,
      items: [
        { label: "Patient Billing",  icon: "pi pi-user",   command: () => go("/patient-billing"),   roles: R.BILLING },
        { label: "Bills List",       icon: "pi pi-list",   command: () => go("/billing"),            roles: R.BILLING },
        { label: "Service Master",   icon: "pi pi-cog",    command: () => go("/service-master"),     roles: R.ADMIN },
        { label: "Hospital Charges", icon: "pi pi-dollar", command: () => go("/hospital-charges"),   roles: R.ADMIN },
      ],
    },
    {
      label: "Bed Management",
      icon: "pi pi-table",
      roles: R.RECEPT,
      items: [
        { label: "Manage Beds",       icon: "pi pi-list",    command: () => go("/beds"),        roles: R.RECEPT },
        { label: "Bed Visual Layout", icon: "pi pi-th-large",command: () => go("/bed-visual"), roles: R.ALL },
        { label: "Wards",             icon: "pi pi-home",    command: () => go("/wards"),       roles: R.RECEPT },
        { label: "Rooms",             icon: "pi pi-box",     command: () => go("/rooms"),       roles: R.RECEPT },
        { label: "Room Category",     icon: "pi pi-th-large",command: () => go("/roomcategory"),roles: R.ADMIN },
      ],
    },
    {
      label: "Masters",
      icon: "pi pi-database",
      roles: R.ADMIN,
      items: [
        { label: "User Management", icon: "pi pi-users",          command: () => go("/admin/users"), roles: R.ADMIN },
        { label: "Buildings",   icon: "pi pi-building",    command: () => go("/buildings"),  roles: R.ADMIN },
        { label: "Floors",      icon: "pi pi-arrows-v",    command: () => go("/floors"),     roles: R.ADMIN },
        { label: "Departments", icon: "pi pi-sitemap",     command: () => go("/department"), roles: R.ADMIN },
        { label: "Doctors",     icon: "pi pi-user-edit",   command: () => go("/doctors"),    roles: R.ADMIN },
        { label: "Add TPA",     icon: "pi pi-briefcase",   command: () => go("/addtpa"),     roles: R.TPA },
        { label: "TPA Services",icon: "pi pi-plus-circle", command: () => go("/addservice"), roles: R.TPA },
      ],
    },
  ];

  /* ── Filter menu by role ── */
  const filterItems = (items) =>
    items
      .filter(item => allowed(item.roles, role))
      .map(item => {
        const { roles: _, ...rest } = item;
        if (rest.items) {
          rest.items = filterItems(rest.items);
          if (rest.items.length === 0) return null;
        }
        return rest;
      })
      .filter(Boolean);

  const menuModel = filterItems(raw);

  const sidebarW = collapsed ? 64 : 258;

  /* ── Collapsed icon nav items (filtered) ── */
  const collapsedNav = [
    { icon: "pi pi-home",        path: "/mainpage",          title: "Dashboard",   roles: R.ALL },
    { icon: "pi pi-users",       path: "/allpatient",        title: "Patients",    roles: R.ALL },
    { icon: "pi pi-file-edit",   path: "/doctor-assessment", title: "Assessment",  roles: R.DOCTOR },
    { icon: "pi pi-pencil",      path: "/nursing-notes",     title: "Nursing",     roles: R.NURSE },
    { icon: "pi pi-th-large",    path: "/beds",              title: "Beds",        roles: R.RECEPT },
    { icon: "pi pi-receipt",     path: "/patient-billing",   title: "Billing",     roles: R.BILLING },
    { icon: "pi pi-chart-line",  path: "/vitalsView",        title: "Vitals",      roles: R.CLINICAL },
    { icon: "pi pi-database",    path: "/department",        title: "Masters",     roles: R.ADMIN },
  ].filter(item => allowed(item.roles, role));

  return (
    <>
      <div className="his-sidebar" style={{ width: sidebarW }}>
        {/* Brand header */}
        <div className="his-sidebar-brand">
          {!collapsed && (
            <div className="his-sidebar-brand-title">
              <span style={{ color: "#38bdf8", fontWeight: 800 }}>S</span>phereHealth
            </div>
          )}
          <button className="his-sidebar-toggle" onClick={() => setCollapsed(p => !p)} title={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? "☰" : "✕"}
          </button>
        </div>

        {/* Role badge (expanded only) */}
        {!collapsed && user && (
          <div style={{
            margin: "8px 10px 0", padding: "6px 12px",
            background: "#f0f9ff", borderRadius: 8, border: "1px solid #bae6fd",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: "#1e40af", color: "white",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700, flexShrink: 0,
            }}>
              {user.fullName?.[0] || user.firstName?.[0] || "U"}
            </div>
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1e293b", whiteSpace: "nowrap",
                overflow: "hidden", textOverflow: "ellipsis" }}>
                {user.fullName || `${user.firstName} ${user.lastName}`}
              </div>
              <div style={{ fontSize: 10, color: "#1e40af", fontWeight: 600 }}>{user.role}</div>
            </div>
          </div>
        )}

        {/* Menu */}
        {!collapsed && (
          <div style={{ padding: "8px 0 80px" }}>
            <PanelMenu model={menuModel} style={{ width: "100%", border: "none" }} />
          </div>
        )}

        {/* Collapsed icon nav */}
        {collapsed && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0", gap: 4 }}>
            {collapsedNav.map(item => (
              <button key={item.path} title={item.title} onClick={() => go(item.path)}
                style={{
                  width: 44, height: 44, border: "none", borderRadius: 8,
                  background: location.pathname === item.path ? "#eff6ff" : "transparent",
                  color: location.pathname === item.path ? "#1e40af" : "#6b7280",
                  cursor: "pointer", fontSize: 16,
                  display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s",
                }}>
                <i className={item.icon} />
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
