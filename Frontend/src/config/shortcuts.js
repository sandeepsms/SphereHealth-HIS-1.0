// config/shortcuts.js
// ════════════════════════════════════════════════════════════════════
// R7hr-223 — Windows-style keyboard shortcut layer (ADDITIVE; no page
// logic touched). A curated command catalog drives:
//   • the Ctrl+K command palette (search & jump to any page)
//   • the G-prefixed quick-nav chords (G then a key)
//   • the ?/F1 cheat-sheet
// Everything is ROLE-FILTERED so each user only sees pages they can open.
// The real access boundary stays the route-level RoleGuard / backend gate;
// this layer is only a launcher, so being slightly permissive is harmless.
// ════════════════════════════════════════════════════════════════════

const ALL = "*";
const ADMIN = "Admin", DR = "Doctor", NR = "Nurse", RX = "Receptionist",
  PH = "Pharmacist", AC = "Accountant", LAB = "Lab Technician", DT = "Dietician",
  TPA = "TPA Coordinator", WB = "Ward Boy", SEC = "Security", HK = "Housekeeping",
  MRD = "MRD", RAD = "Radiologist", PT = "Physiotherapist";

// { id, label, path, icon, keywords, roles ("*" | [roleKeys]), chord (G-prefix key) }
// chord is resolved per-role first-accessible-wins, so the same chord may be
// reused across roles that never see each other's command.
export const COMMANDS = [
  // ── Everyone / shared ──────────────────────────────────────────────
  { id: "dashboard",       label: "Dashboard",                 path: "/dashboard",            icon: "🏠", keywords: "home overview start", roles: ALL, chord: "d" },
  { id: "patient-search",  label: "Patient Search",            path: "/patient-search",       icon: "🔎", keywords: "find lookup uhid patient", roles: [ADMIN, RX, DR, NR, LAB, PH, DT, TPA, AC, MRD, RAD], chord: "p" },
  { id: "all-patients",    label: "All Patients",              path: "/allpatient",           icon: "👥", keywords: "directory list everyone", roles: [ADMIN, RX, DR, NR, MRD] },
  { id: "patient-history", label: "Patient History (OPD/IPD)", path: "/patient-history-view", icon: "📂", keywords: "timeline file record history visit", roles: [ADMIN, DR, NR, MRD, RX, AC, TPA] },
  { id: "appointments",    label: "Appointments",              path: "/appointments",         icon: "📅", keywords: "schedule booking slot", roles: [ADMIN, RX], chord: "a" },

  // ── Reception / front desk ─────────────────────────────────────────
  { id: "reception",         label: "Reception Desk",          path: "/reception",              icon: "🛎", keywords: "register front desk admit new patient", roles: [ADMIN, RX], chord: "r" },
  { id: "reception-billing", label: "Billing Counter",         path: "/reception-billing",      icon: "💳", keywords: "bill pay collect invoice receipt money cash", roles: [ADMIN, RX, AC], chord: "b" },
  { id: "reception-opd-q",   label: "OPD Queue (Reception)",   path: "/reception-opd-queue",    icon: "🧾", keywords: "opd waiting token queue", roles: [ADMIN, RX], chord: "q" },
  { id: "reception-emerg",   label: "Emergency Cases",         path: "/reception-emergency",    icon: "🚑", keywords: "emergency casualty trauma", roles: [ADMIN, RX] },
  { id: "discharge-queue",   label: "Discharge Queue",         path: "/discharge-queue",        icon: "🚪", keywords: "discharge release gate pass", roles: [ADMIN, RX] },
  { id: "closing-report",    label: "Cashier Closing Report",  path: "/reception/closing-report", icon: "🧮", keywords: "cash shift close report collection", roles: [ADMIN, RX, AC] },

  // ── Doctor ─────────────────────────────────────────────────────────
  { id: "doctor-opd-panel", label: "Doctor OPD Panel",          path: "/doctor-opd-panel",       icon: "🩺", keywords: "opd consult panel", roles: [ADMIN, DR], chord: "o" },
  { id: "doctor-panel",     label: "Doctor Patient Panel (IPD)", path: "/doctor-patient-panel",  icon: "🩺", keywords: "ipd ward rounds panel", roles: [ADMIN, DR] },
  { id: "doctor-notes",     label: "Doctor Notes",              path: "/doctor-notes",           icon: "📝", keywords: "progress note soap daily", roles: [ADMIN, DR], chord: "n" },
  { id: "opd-assessment",   label: "OPD Assessment",            path: "/opd-assessment",         icon: "🩻", keywords: "opd assessment prescription rx", roles: [ADMIN, DR] },
  { id: "ipd-initial",      label: "IPD Initial Assessment",    path: "/ipd-initial-assessment", icon: "📋", keywords: "initial assessment admission history", roles: [ADMIN, DR] },
  { id: "discharge-summary", label: "Discharge Summary",        path: "/discharge-summary",      icon: "📄", keywords: "discharge summary final", roles: [ADMIN, DR] },
  { id: "medical-certs",    label: "Medical Certificates",      path: "/medical-certificates",   icon: "📜", keywords: "certificate fitness medical leave", roles: [ADMIN, DR] },

  // ── Nurse ──────────────────────────────────────────────────────────
  { id: "nurse-panel",   label: "Nurse Patient Panel",   path: "/nurse-patient-panel",    icon: "💗", keywords: "ipd nurse panel ward", roles: [ADMIN, NR], chord: "o" },
  { id: "nursing-notes", label: "Nursing Notes",         path: "/nursing-notes",          icon: "🗒", keywords: "vitals pain wound neuro mar nursing note", roles: [ADMIN, NR], chord: "n" },
  { id: "nurse-opd-q",   label: "Nurse OPD Queue",       path: "/opd-queue",              icon: "🧾", keywords: "opd queue vitals triage", roles: [ADMIN, NR], chord: "q" },
  { id: "nurse-initial", label: "Nurse Initial Assessment", path: "/nurse-initial-assessment", icon: "📋", keywords: "initial assessment nursing", roles: [ADMIN, NR] },
  { id: "care-plan",     label: "Nursing Care Plan",     path: "/nursing-care-plan",      icon: "📌", keywords: "care plan nursing", roles: [ADMIN, NR] },
  { id: "handover",      label: "Nursing Handover",      path: "/nurse-patient-panel?tab=handover", icon: "🔄", keywords: "handover shift sbar", roles: [ADMIN, NR] },

  // ── Clinical shared ────────────────────────────────────────────────
  { id: "vitals",      label: "Vital Sheet",   path: "/vitalSheet",      icon: "❤", keywords: "vitals chart bp pulse temperature", roles: [ADMIN, NR, DR], chord: "v" },
  { id: "consent",     label: "Consent Forms", path: "/consent-forms",   icon: "✍", keywords: "consent biometric form signature", roles: [ADMIN, DR, NR] },
  { id: "icu-bundles", label: "ICU Bundles",   path: "/icu-bundles",     icon: "🫀", keywords: "icu bundle critical care", roles: [ADMIN, DR, NR] },
  { id: "diabetic",    label: "Diabetic Chart", path: "/diabetic-chart", icon: "🩸", keywords: "diabetic sugar insulin glucose", roles: [ADMIN, DR, NR] },
  { id: "lab-results", label: "Lab Results",   path: "/lab-results",     icon: "🧪", keywords: "lab investigation result report", roles: [ADMIN, DR, NR, LAB, RAD], chord: "l" },
  { id: "beds",        label: "Bed Dashboard", path: "/bed-dashboard",   icon: "🛏", keywords: "bed occupancy ward availability", roles: [ADMIN, RX, NR], chord: "e" },

  // ── Pharmacy ───────────────────────────────────────────────────────
  { id: "pharmacy",         label: "Pharmacy",          path: "/pharmacy",         icon: "💊", keywords: "pharmacy dispense medicine stock", roles: [ADMIN, PH], chord: "y" },
  { id: "pharmacy-indents", label: "Pharmacy Indents",  path: "/pharmacy/indents", icon: "📦", keywords: "indent request stock supply", roles: [ADMIN, PH] },

  // ── Department consoles ────────────────────────────────────────────
  { id: "dietitian",      label: "Dietitian Console", path: "/dietitian",       icon: "🥗", keywords: "diet nutrition meal", roles: [ADMIN, DT], chord: "o" },
  { id: "physio",         label: "Physiotherapy",     path: "/physiotherapist", icon: "🧘", keywords: "physio therapy rehab", roles: [ADMIN, PT], chord: "o" },
  { id: "ward-tasks",     label: "Ward Tasks",        path: "/ward-tasks",      icon: "🧹", keywords: "ward boy task", roles: [ADMIN, WB], chord: "o" },
  { id: "housekeeping",   label: "Housekeeping",      path: "/housekeeping",    icon: "🧼", keywords: "clean housekeeping", roles: [ADMIN, HK], chord: "o" },
  { id: "visitor-passes", label: "Visitor Passes",    path: "/visitor-passes",  icon: "🪪", keywords: "visitor pass gate", roles: [ADMIN, SEC, RX], chord: "o" },
  { id: "gate-log",       label: "Gate Log",          path: "/gate-log",        icon: "🚧", keywords: "gate security log", roles: [ADMIN, SEC] },

  // ── Accounts ───────────────────────────────────────────────────────
  { id: "accounts", label: "Accounts Console", path: "/accounts", icon: "📊", keywords: "accounts finance ledger revenue", roles: [ADMIN, AC], chord: "o" },

  // ── MRD ────────────────────────────────────────────────────────────
  { id: "mrd-discharges", label: "Medical Records — Discharges", path: "/medical-records/discharges", icon: "🗄", keywords: "mrd records discharge archive", roles: [ADMIN, MRD], chord: "o" },

  // ── Compliance / quality ───────────────────────────────────────────
  { id: "nabh-registers", label: "NABH Registers",  path: "/compliance/nabh-registers", icon: "📚", keywords: "nabh register compliance quality", roles: [ADMIN, NR, DR] },
  { id: "incidents",      label: "Incident Reports", path: "/incidents",                icon: "⚠", keywords: "incident report safety event", roles: [ADMIN, NR, DR] },

  // ── Admin / masters ────────────────────────────────────────────────
  { id: "admin-users",       label: "Users & Staff",            path: "/admin/users",           icon: "👤", keywords: "users staff accounts manage", roles: [ADMIN], chord: "u" },
  { id: "admin-roles",       label: "Roles & Permissions",      path: "/admin/roles",           icon: "🔐", keywords: "roles permission rbac access", roles: [ADMIN] },
  { id: "hospital-config",   label: "Hospital Settings",        path: "/admin/hospital-config", icon: "⚙", keywords: "settings config hospital branding", roles: [ADMIN], chord: "s" },
  { id: "system-health",     label: "System Health",            path: "/admin/system-health",   icon: "💚", keywords: "system health status monitor", roles: [ADMIN] },
  { id: "hospital-charges",  label: "Hospital Charges Master",  path: "/hospital-charges",      icon: "🏷", keywords: "charges master price tariff", roles: [ADMIN, AC] },
  { id: "nursing-equipment", label: "Nursing Equipment Master", path: "/nursing-equipment",     icon: "🩹", keywords: "equipment consumable master", roles: [ADMIN, AC] },
];

// Rows for the ?/F1 cheat-sheet "General" column.
export const GLOBAL_SHORTCUTS = [
  { keys: ["Ctrl", "K"],     label: "Command palette — jump to any page" },
  { keys: ["G", "then key"], label: "Quick navigation (see your list →)" },
  { keys: ["Alt", "H"],      label: "Go to home / dashboard" },
  { keys: ["Alt", "←"],      label: "Back" },
  { keys: ["Ctrl", "S"],     label: "Save / submit the current form" },
  { keys: ["Ctrl", "P"],     label: "Print the current page" },
  { keys: ["Ctrl", "N"],     label: "New / add record" },
  { keys: ["?"],             label: "Show this shortcuts help" },
  { keys: ["Esc"],           label: "Close dialog / palette" },
];

export function commandsForRole(role) {
  if (!role) return [];
  return COMMANDS.filter((c) => c.roles === ALL || c.roles.includes(role));
}

// { chordChar: command } for the role — first accessible command claiming a
// chord wins; any later collision stays reachable via the palette.
export function chordMapForRole(role) {
  const map = {};
  for (const c of commandsForRole(role)) {
    if (c.chord && !map[c.chord]) map[c.chord] = c;
  }
  return map;
}
