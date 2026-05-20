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
  // R7as-FIX-9/D3-high: MRD role was missing from the Frontend ROLES catalogue.
  // Backend enum has accepted "MRD" since R7i; admin user-create UI couldn't
  // pick it because this list excluded it. Read-only role — viewer of every
  // discharged patient file (enforced via blockReadOnlyRoleWrites middleware).
  { key: "MRD",               label: "Medical Records", icon: "pi-folder-open", color: "#6366f1", light: "#eef2ff", desc: "Read-only access to discharged patient files. Re-activate within 24h." },
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
  // Module `home` paths drive the AccessSnapshot tile clicks on
  // RoleDashboardPage. These need to point to routes that actually
  // exist — previously /lab-management, /bill, /cashless, /admin-reports
  // were all dead, so clicking a module tile bounced to the catch-all
  // and re-redirected to /dashboard.
  { id: "lab",        label: "Lab",             icon: "pi-search-plus",   home: "/investigation-orders", color: "#0284c7" },
  // R7ah: billing module home now points at /reception-billing (the
  // canonical billing surface). The old /billing page is gone — see
  // App.jsx for redirect.
  { id: "billing",    label: "Billing",         icon: "pi-receipt",       home: "/reception-billing", color: "#d97706" },
  { id: "tpa",        label: "TPA / Cashless",  icon: "pi-briefcase",     home: "/tpa-cases",         color: "#7c3aed" },
  { id: "care",       label: "Care Plans",      icon: "pi-bolt",          home: "/vitalSheet",        color: "#16a34a" },
  { id: "maintenance",label: "Maintenance",     icon: "pi-wrench",        home: "/maintenance",       color: "#0d9488" },
  { id: "security",   label: "Visitor Security",icon: "pi-lock",          home: "/visitor-passes",    color: "#374151" },
  { id: "admin",      label: "Masters & Admin", icon: "pi-cog",           home: "/admin/users",       color: "#1e293b" },
  { id: "reports",    label: "Reports & MIS",   icon: "pi-chart-bar",     home: "/billing-audit-trail",  color: "#1d4ed8" },
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
  // Security — gate log + incident reports
  "security.gate-log":        ["Admin", "Security", "Receptionist"],
  "security.incident-report": ["Admin", "Security"],

  // Patient demographics vs clinical edits — split so receptionist can fix a
  // misspelled name / contact but can't rewrite blood group, DOB, allergies,
  // gender. Mirror of Backend/config/permissions.js (security audit 2026-05-17).
  "patient.read":               ["Admin", "Receptionist", "Doctor", "Nurse", "Lab Technician", "Pharmacist", "Dietician", "TPA Coordinator", "Accountant"],
  "patient.write-demographics": ["Admin", "Receptionist"],
  "patient.write-clinical":     ["Admin", "Doctor", "Nurse"],
  "patient.delete":             ["Admin"],
  "patient.export":             ["Admin", "Doctor"],

  // Clinical
  "rx.write":              ["Admin", "Doctor"],
  // Accountant gets read access for the Accounts Console (GST register,
  // pharmacy stats, sales/expiry registers). Write actions stay restricted.
  "rx.read":               ["Admin", "Doctor", "Nurse", "Pharmacist", "Accountant"],
  "ipd.assign-bed":        ["Admin", "Receptionist", "Doctor"],
  // Clinical discharge — medical decision. Receptionist is intentionally NOT
  // here (security audit 2026-05-17); they still have reception.discharge
  // for the bill-counter step.
  "ipd.discharge":         ["Admin", "Doctor"],
  "ipd.cancel":            ["Admin", "Doctor"],
  "ipd.transfer":          ["Admin", "Doctor", "Nurse"],
  "ipd.delete":            ["Admin"],
  "ipd.discharge-summary": ["Admin", "Doctor"],
  "vitals.write":          ["Admin", "Nurse", "Doctor"],
  "mar.write":             ["Admin", "Nurse"],
  "doctor-orders.write":   ["Admin", "Doctor"],
  // R7m: Mirror new doctor-order action gates (see Backend/config/permissions.js).
  "order.acknowledge":     ["Admin", "Nurse", "Doctor"],
  "order.stop":            ["Admin", "Doctor"],
  // R7n: Mirror consent gates (see Backend/config/permissions.js).
  "consent.write":         ["Admin", "Doctor", "Nurse"],
  "consent.delete":        ["Admin"],

  // Pharmacy
  "pharmacy.dispense":     ["Admin", "Pharmacist"],
  // Nurse → Pharmacy drug indent workflow (mirror of backend)
  "indent.raise":          ["Admin", "Nurse", "Doctor"],
  "indent.read":           ["Admin", "Nurse", "Doctor", "Pharmacist", "Receptionist"],
  "indent.fulfill":        ["Admin", "Pharmacist"],
  "indent.cancel":         ["Admin", "Nurse", "Pharmacist"],
  "pharmacy.grn":          ["Admin", "Pharmacist"],
  "pharmacy.return":       ["Admin", "Pharmacist"],
  "pharmacy.add-items":    ["Admin", "Pharmacist"],
  "pharmacy.cancel":       ["Admin", "Pharmacist"],
  "pharmacy.settings":     ["Admin", "Pharmacist"],

  // Lab — outsourced workflow. Lab Technician does ALL data entry
  // (labs + imaging + micro + histopath). No in-house Pathologist /
  // Radiologist for now (14 May 2026 — role stays in userModel for
  // when in-house imaging comes online).
  "lab.order":             ["Admin", "Doctor", "Receptionist"],
  "lab.collect":           ["Admin", "Lab Technician", "Nurse"],
  "lab.result-entry":      ["Admin", "Lab Technician"],
  "lab.verify":            ["Admin", "Doctor"],
  "lab.dispatch":          ["Admin", "Lab Technician"],
  // R7z: cancel split from dispatch — Lab Tech can print but can't void
  // a clinician's order (cancel also reverses billing). Sample rejection
  // stays a Lab Tech action under lab.result-entry.
  "lab.cancel":            ["Admin", "Doctor"],
  "lab.records.read":      ["Admin", "Doctor", "Nurse", "Lab Technician"],
  "lab.records.write":     ["Admin", "Lab Technician"],
  "lab.records.verify":    ["Admin", "Doctor"],

  // Billing
  "billing.read":          ["Admin", "Accountant", "Receptionist", "TPA Coordinator"],
  "billing.write":         ["Admin", "Accountant", "Receptionist"],
  "billing.refund":        ["Admin", "Accountant"],
  "billing.discount":      ["Admin", "Accountant"],
  // IPD Live Ledger — mirror of backend permissions for the same actions.
  // Backend keeps the source of truth (controllers re-check); these are
  // used to show/hide the buttons on the IPD Live Billing page.
  "billing.undo":          ["Admin", "Accountant", "Receptionist"],
  "billing.override":      ["Admin", "Accountant"],
  "billing.cancel-charge": ["Admin", "Accountant"],
  // Manual charge add — clinicians + desk staff (Doctors/Nurses can add
  // but only Admin/Accountant can override the price; controller enforces).
  "billing.manual-charge": ["Admin", "Accountant", "Receptionist", "Doctor", "Nurse"],

  // TPA / cashless
  "tpa.pre-auth":          ["Admin", "TPA Coordinator", "Receptionist"],
  "tpa.claim":             ["Admin", "TPA Coordinator"],

  // Dietician — patient assessment + diet plan assignment
  "diet.read":             ["Admin", "Dietician", "Doctor", "Nurse"],
  "diet.write":            ["Admin", "Dietician"],

  // Ward Boy task board
  "ward.read":             ["Admin", "Doctor", "Nurse", "Receptionist", "Ward Boy", "Housekeeping"],
  "ward.create":           ["Admin", "Doctor", "Nurse", "Receptionist", "Ward Boy"],
  "ward.fulfill":          ["Admin", "Ward Boy"],
  "ward.admin":            ["Admin"],
  // Phase B / C
  "ward.shift":            ["Admin", "Ward Boy", "Housekeeping"],
  "ward.equipment":        ["Admin", "Ward Boy", "Nurse"],
  "ward.supplies":         ["Admin", "Ward Boy", "Housekeeping", "Nurse"],
  "ward.code-blue":        ["Admin", "Doctor", "Nurse", "Ward Boy"],
  "ward.mortuary":         ["Admin", "Doctor", "Nurse", "Ward Boy"],
  "ward.manage":           ["Admin", "Nurse"],

  // Housekeeping
  "house.read":            ["Admin", "Doctor", "Nurse", "Receptionist", "Housekeeping", "Ward Boy"],
  "house.create":          ["Admin", "Doctor", "Nurse", "Receptionist", "Housekeeping"],
  "house.fulfill":         ["Admin", "Housekeeping"],
  "house.spillage":        ["Admin", "Doctor", "Nurse", "Housekeeping"],
  "house.inventory":       ["Admin", "Housekeeping"],
  "house.checklist":       ["Admin", "Housekeeping"],
  "house.pest":            ["Admin", "Housekeeping"],
  "house.manage":          ["Admin", "Nurse"],

  // Reports
  "reports.financial":     ["Admin", "Accountant"],
  "reports.clinical":      ["Admin", "Doctor"],
  // Accountant needs audit-trail review to catch unauthorized refunds/cancels.
  "reports.audit":         ["Admin", "Accountant"],

  // ── Medical Records Department (R7i) ────────────────────────
  // Replaces the paper MRD function. Read-only access to every
  // discharged patient's complete file (notes, MAR, vitals,
  // labs, consents, bills, payments).
  "mrd.read":              ["Admin", "Doctor", "MRD"],
  "mrd.list":              ["Admin", "Doctor", "MRD"],
  // Same-day discharge undo — Admin only, controller gates 24h window.
  "admission.reactivate":  ["Admin"],
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

// Role-aware "home" path.
//
// Every role lands on /dashboard — the RoleDashboardPage dispatcher
// renders the right layout for the logged-in user. This replaces the
// old per-role redirect table which had several problems:
//   • Admin landed on /mainpage which is a receptionist-flavoured
//     MainPage (the old generic dashboard) — Dietician / Physio /
//     Accountant clicking sidebar "Dashboard" went to the same wrong
//     page (treated as a permission breach by the user on 13 May 2026).
//   • Several roles pointed to legacy paths that no longer exist
//     (/lab-management, /cashless, /admin-reports, /dashboard1) and
//     would 404 / fall through to the catch-all.
// Returning a single /dashboard keeps the dispatch in one place
// (RoleDashboardPage reads user.role) so we never have to fan out
// per-role landing logic again.
export function homePathForRole(role) {
  if (!role) return "/login";
  // Single-page roles — sidebar shows only Dashboard which IS the
  // console itself. Each adds their role-home as the landing path.
  if (role === "Dietician")    return "/dietitian";
  if (role === "Ward Boy")     return "/ward-tasks";
  if (role === "Housekeeping") return "/housekeeping";
  return "/dashboard";
}

const PERMISSIONS = {
  ROLES, ROLE_KEYS, MODULES, MODULE_ROLES, ACTIONS,
  roleSeesModule, roleCan, modulesForRole, actionsForRole, homePathForRole,
};
export default PERMISSIONS;
