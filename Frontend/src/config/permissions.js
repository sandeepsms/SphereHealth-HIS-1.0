/**
 * permissions.js — single source of truth for what each role can do.
 *
 * Sidebar, route guards, role-overview admin page, and the
 * AuthContext helpers (`can` / `seesModule`) all read from here.
 *
 * Two layers:
 *   1. MODULES   — top-level navigable areas (Reception, Pharmacy, …)
 *                  for landing-page dispatch + sidebar grouping.
 *   2. ACTIONS   — fine-grained capability tokens
 *                  ("billing.write", "ipd.discharge", "pharmacy.cancel")
 *                  for buttons / sensitive route gates.
 *
 * Adding a new role:
 *   - register it in the userModel enum (Backend/models/User/userModel.js)
 *   - drop it into ROLES below
 *   - add it to whatever modules / actions it should access
 */

/* ── Role catalogue with theme + meta ────────────────────────────── */
export const ROLES = [
  { key: "Admin",             label: "Administrator",   icon: "pi-shield",      color: "#1e293b", light: "#f1f5f9", desc: "Full system access. Can manage users, settings, and every module." },
  { key: "Doctor",            label: "Doctor",          icon: "pi-user-edit",   color: "#7c3aed", light: "#f5f3ff", desc: "Patient assessment, Rx, IPD orders, discharge, certificates." },
  { key: "Nurse",             label: "Nurse",           icon: "pi-heart",       color: "#db2777", light: "#fdf2f8", desc: "Vitals, MAR, ward rounds, nursing notes, handover." },
  { key: "Receptionist",      label: "Receptionist",    icon: "pi-desktop",     color: "#0891b2", light: "#ecfeff", desc: "Registration, OPD / IPD admission, billing, visitor passes." },
  { key: "Pharmacist",        label: "Pharmacist",      icon: "pi-box",         color: "#ea580c", light: "#fff7ed", desc: "Drug master, inventory, GRN, dispense, sales register." },
  { key: "Lab Technician",    label: "Lab Technician",  icon: "pi-search-plus", color: "#0284c7", light: "#f0f9ff", desc: "Lab orders, sample collection, result entry, report dispatch." },
  { key: "Radiologist",       label: "Radiologist",     icon: "pi-eye",         color: "#0284c7", light: "#f0f9ff", desc: "Imaging requests, report write-ups, dispatch." },
  { key: "Physiotherapist",   label: "Physiotherapist", icon: "pi-bolt",        color: "#059669", light: "#ecfdf5", desc: "Physiotherapy schedule, session notes, plans." },
  { key: "Dietician",         label: "Dietician",       icon: "pi-apple",      color: "#16a34a", light: "#f0fdf4", desc: "Diet plans, nutrition orders, meal sheets." },
  { key: "Accountant",        label: "Accountant",      icon: "pi-receipt",     color: "#d97706", light: "#fffbeb", desc: "Billing reconciliation, refunds, financial reports." },
  { key: "TPA Coordinator",   label: "TPA Coordinator", icon: "pi-briefcase",   color: "#7c3aed", light: "#f5f3ff", desc: "Insurance pre-auth, claim file, cashless coordination." },
  { key: "Ward Boy",          label: "Ward Boy",        icon: "pi-user",        color: "#475569", light: "#f8fafc", desc: "Patient transport, vitals support, ward tasks." },
  { key: "Housekeeping",      label: "Housekeeping",    icon: "pi-home",        color: "#64748b", light: "#f8fafc", desc: "Room turnover, ward cleaning, biomedical waste." },
  { key: "Security",          label: "Security",        icon: "pi-lock",        color: "#374151", light: "#f9fafb", desc: "Visitor passes, gate logs, incident reports." },
];

export const ROLE_KEYS = ROLES.map(r => r.key);

/* ── High-level modules ──────────────────────────────────────────── */
export const MODULES = [
  { id: "reception",  label: "Reception",       icon: "pi-desktop",       home: "/reception",         color: "#0891b2" },
  { id: "opd",        label: "OPD / Emergency", icon: "pi-stethoscope",   home: "/opd-visit",         color: "#7c3aed" },
  { id: "ipd",        label: "Beds & IPD",      icon: "pi-th-large",      home: "/bed-visual",        color: "#1d4ed8" },
  { id: "doctor",     label: "Doctor Workbench",icon: "pi-user-edit",     home: "/doctor",            color: "#7c3aed" },
  { id: "nursing",    label: "Nursing",         icon: "pi-heart",         home: "/nursing-notes",     color: "#db2777" },
  { id: "pharmacy",   label: "Pharmacy",        icon: "pi-box",           home: "/pharmacy",          color: "#ea580c" },
  { id: "lab",        label: "Lab",             icon: "pi-search-plus",   home: "/lab-management",    color: "#0284c7" },
  { id: "billing",    label: "Billing",         icon: "pi-receipt",       home: "/bill",              color: "#d97706" },
  { id: "tpa",        label: "TPA / Cashless",  icon: "pi-briefcase",     home: "/cashless",          color: "#7c3aed" },
  { id: "care",       label: "Care Plans",      icon: "pi-bolt",          home: "/vitalSheet",        color: "#16a34a" },
  { id: "maintenance",label: "Maintenance",     icon: "pi-wrench",        home: "/maintenance",       color: "#0d9488" },
  { id: "security",   label: "Visitor Security",icon: "pi-lock",          home: "/visitor-passes",    color: "#374151" },
  { id: "admin",      label: "Masters & Admin", icon: "pi-cog",           home: "/admin/users",       color: "#1e293b" },
  { id: "reports",    label: "Reports & MIS",   icon: "pi-chart-bar",     home: "/admin-reports",     color: "#1d4ed8" },
];

/* ── Module access per role.
   "*" gives access; otherwise it's a list of role keys.            ── */
export const MODULE_ROLES = {
  reception:   ["Admin", "Receptionist", "Doctor", "Nurse", "Accountant", "TPA Coordinator"],
  opd:         ["Admin", "Doctor", "Nurse", "Receptionist"],
  ipd:         ["Admin", "Doctor", "Nurse", "Receptionist", "Ward Boy", "Housekeeping", "Physiotherapist", "Dietician"],
  doctor:      ["Admin", "Doctor"],
  nursing:     ["Admin", "Nurse", "Doctor", "Physiotherapist", "Dietician"],
  pharmacy:    ["Admin", "Pharmacist", "Doctor"],
  lab:         ["Admin", "Lab Technician", "Radiologist", "Doctor"],
  billing:     ["Admin", "Receptionist", "Accountant", "TPA Coordinator"],
  tpa:         ["Admin", "TPA Coordinator", "Receptionist"],
  care:        ["Admin", "Physiotherapist", "Dietician", "Doctor", "Nurse"],
  maintenance: ["Admin", "Housekeeping", "Ward Boy"],
  security:    ["Admin", "Security", "Receptionist"],
  admin:       ["Admin"],
  reports:     ["Admin", "Accountant"],
};

/* ── Fine-grained action permissions ─────────────────────────────── */
export const ACTIONS = {
  // User & access management
  "users.read":            ["Admin"],
  "users.write":           ["Admin"],
  "users.reset-password":  ["Admin"],
  "users.signature":       ["Admin"],
  "users.deactivate":      ["Admin"],

  // Hospital identity / settings
  "settings.read":         ["Admin"],
  "settings.write":        ["Admin"],

  // Departments + doctor master
  "departments.read":      ["Admin", "Doctor", "Nurse", "Receptionist"],
  "departments.write":     ["Admin"],
  "doctors.read":          ["Admin", "Receptionist", "Doctor", "Nurse"],
  "doctors.write":         ["Admin"],

  // Reception flows
  "reception.register":    ["Admin", "Receptionist"],
  "reception.discharge":   ["Admin", "Receptionist"],
  "reception.visitor-pass":["Admin", "Receptionist", "Security"],

  // Clinical
  "rx.write":              ["Admin", "Doctor"],
  // Accountant gets read access for the Accounts Console (GST register,
  // pharmacy stats, sales/expiry registers). Write actions stay restricted.
  "rx.read":               ["Admin", "Doctor", "Nurse", "Pharmacist", "Accountant"],
  "ipd.assign-bed":        ["Admin", "Receptionist", "Doctor"],
  "ipd.discharge":         ["Admin", "Doctor", "Receptionist"],
  "ipd.discharge-summary": ["Admin", "Doctor"],
  "vitals.write":          ["Admin", "Nurse", "Doctor"],
  "mar.write":             ["Admin", "Nurse"],
  "doctor-orders.write":   ["Admin", "Doctor"],

  // Pharmacy
  "pharmacy.dispense":     ["Admin", "Pharmacist"],
  "pharmacy.grn":          ["Admin", "Pharmacist"],
  "pharmacy.return":       ["Admin", "Pharmacist"],
  "pharmacy.add-items":    ["Admin", "Pharmacist"],
  "pharmacy.cancel":       ["Admin", "Pharmacist"],
  "pharmacy.settings":     ["Admin", "Pharmacist"],

  // Lab
  "lab.order":             ["Admin", "Doctor", "Receptionist"],
  "lab.collect":           ["Admin", "Lab Technician", "Nurse"],
  "lab.result-entry":      ["Admin", "Lab Technician"],
  "lab.verify":            ["Admin", "Radiologist", "Doctor"],
  "lab.dispatch":          ["Admin", "Lab Technician"],

  // Billing
  "billing.read":          ["Admin", "Accountant", "Receptionist", "TPA Coordinator"],
  "billing.write":         ["Admin", "Accountant", "Receptionist"],
  "billing.refund":        ["Admin", "Accountant"],
  "billing.discount":      ["Admin", "Accountant"],

  // TPA / cashless
  "tpa.pre-auth":          ["Admin", "TPA Coordinator", "Receptionist"],
  "tpa.claim":             ["Admin", "TPA Coordinator"],

  // Reports
  "reports.financial":     ["Admin", "Accountant"],
  "reports.clinical":      ["Admin", "Doctor"],
  // Accountant needs audit-trail review to catch unauthorized refunds/cancels.
  "reports.audit":         ["Admin", "Accountant"],
};

/* ── Helpers ─────────────────────────────────────────────────────── */
export function roleSeesModule(role, moduleId) {
  if (!role) return false;
  const allowed = MODULE_ROLES[moduleId];
  if (!allowed) return false;
  return allowed.includes("*") || allowed.includes(role);
}

export function roleCan(role, action) {
  if (!role) return false;
  const allowed = ACTIONS[action];
  if (!allowed) return false;
  return allowed.includes("*") || allowed.includes(role);
}

// Modules a given role can access — used by the role-overview page.
export function modulesForRole(role) {
  return MODULES.filter(m => roleSeesModule(role, m.id));
}

// Actions a given role can perform — used by the role-overview page.
export function actionsForRole(role) {
  return Object.entries(ACTIONS)
    .filter(([, allowed]) => allowed.includes(role) || allowed.includes("*"))
    .map(([action]) => action);
}

// Role-aware "home" path — pharmacist lands on /pharmacy, doctor on /doctor, etc.
export function homePathForRole(role) {
  const PRIORITY = {
    Admin: "/mainpage",
    Doctor: "/doctor",
    Nurse: "/nursing-notes",
    Receptionist: "/reception",
    Pharmacist: "/pharmacy",
    "Lab Technician": "/lab-management",
    Radiologist: "/lab-management",
    Accountant: "/admin-reports",
    "TPA Coordinator": "/cashless",
    Physiotherapist: "/dashboard1",
    Dietician: "/dashboard1",
    "Ward Boy": "/bed-visual",
    Security: "/visitor-passes",
    Housekeeping: "/bed-visual",
  };
  return PRIORITY[role] || "/dashboard1";
}

const PERMISSIONS = {
  ROLES, ROLE_KEYS, MODULES, MODULE_ROLES, ACTIONS,
  roleSeesModule, roleCan, modulesForRole, actionsForRole, homePathForRole,
};
export default PERMISSIONS;
