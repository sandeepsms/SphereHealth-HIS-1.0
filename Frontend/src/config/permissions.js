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
 *
 * ────────────────────────────────────────────────────────────────────
 * R7bb-FIX-C-2 — PHANTOM / DEPRECATED ROLE DECISIONS (mirror)
 * ────────────────────────────────────────────────────────────────────
 * Radiologist & Physiotherapist exist in the User.role enum + ROLES
 * catalogue but have near-zero action coverage. See
 * Backend/config/permissions.js header for the full decision log.
 * Frontend `can()` returns false for everything except the small set
 * Radiologist gets on the imaging-workflow + Physiotherapist on the
 * new physio.note.write action. "Maintenance" is NOT a role — it is
 * a module label and a Bed/Room status value.
 * ────────────────────────────────────────────────────────────────────
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
  { id: "opd",        label: "OPD / Emergency", icon: "pi-stethoscope",   home: "/doctor-opd-panel",  color: "#7c3aed" },
  { id: "ipd",        label: "Beds & IPD",      icon: "pi-th-large",      home: "/bed-visual",        color: "#4f46e5" },
  { id: "doctor",     label: "Doctor Workbench",icon: "pi-user-edit",     home: "/doctor-opd-panel",  color: "#7c3aed" },
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
  // R7bb-FIX-C-4/D1-CRIT-4: MRD module — discharged-patient archive
  // home + tile so the MRD role has a navigable module on
  // RoleDashboardPage's AccessSnapshot.
  { id: "medical-records", label: "Medical Records", icon: "pi-folder-open", home: "/medical-records/discharges", color: "#6366f1" },
  { id: "admin",      label: "Masters & Admin", icon: "pi-cog",           home: "/admin/users",       color: "#1e293b" },
  { id: "reports",    label: "Reports & MIS",   icon: "pi-chart-bar",     home: "/billing-audit-trail",  color: "#4f46e5" },
];

/* ── Module access per role.
   "*" gives access; otherwise it's a list of role keys.            ── */
export const MODULE_ROLES = {
  reception:   ["Admin", "Receptionist", "Doctor", "Nurse", "Accountant", "TPA Coordinator"],
  opd:         ["Admin", "Doctor", "Nurse", "Receptionist"],
  ipd:         ["Admin", "Doctor", "Nurse", "Receptionist", "Ward Boy", "Housekeeping", "Physiotherapist", "Dietician", "MRD"],
  doctor:      ["Admin", "Doctor"],
  // R7hr-313 — /nursing-notes is gated by mar.write (Admin+Nurse only), so
  // showing the Nursing module tile to Doctor/Physio/Dietician dropped them
  // on an "Access denied" wall. Doctors read nursing notes via their own
  // patient panel's Nursing tab; physio/dietician have no nursing surface.
  nursing:     ["Admin", "Nurse"],
  pharmacy:    ["Admin", "Pharmacist", "Doctor"],
  lab:         ["Admin", "Lab Technician", "Radiologist", "Doctor"],
  billing:     ["Admin", "Receptionist", "Accountant", "TPA Coordinator"],
  tpa:         ["Admin", "TPA Coordinator", "Receptionist"],
  care:        ["Admin", "Physiotherapist", "Dietician", "Doctor", "Nurse"],
  maintenance: ["Admin", "Housekeeping", "Ward Boy"],
  security:    ["Admin", "Security", "Receptionist"],
  // R7bb-FIX-C-4/D1-CRIT-4: MRD now has an explicit MODULE_ROLES row so the
  // role can see its sidebar/dashboard module tile. Admin gets visibility
  // too (HIM oversight) and Doctor (cross-cover read of discharged files).
  "medical-records": ["Admin", "MRD", "Doctor"],
  admin:       ["Admin"],
  // Reports — MRD added so the MRD console can pull discharge / occupancy
  // reports for HIM audits.
  reports:     ["Admin", "Accountant", "MRD"],
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
  // R7hr-272 — DB backup & recovery admin page (Admin only). Mirrors backend.
  "backup.manage":         ["Admin"],
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
  // R7bb-FIX-C-6/D2-CRIT-1: patient.read-demographics is the canonical
  // token going forward (same role set, separate key for future split).
  // patient-file.read (declared later) is the narrow clinical-file token.
  "patient.read":               ["Admin", "Receptionist", "Doctor", "Nurse", "Lab Technician", "Pharmacist", "Dietician", "TPA Coordinator", "Accountant"],
  "patient.read-demographics":  ["Admin", "Receptionist", "Doctor", "Nurse", "Lab Technician", "Pharmacist", "Dietician", "TPA Coordinator", "Accountant"],
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
  // R7ei — ICU Bundles of Care write surface (mirror of backend).
  // Bedside clinician (intensivist) + nurse + admin can chart bundles;
  // distinct from mar.write so the medication-administration ACL stays
  // tight.
  "icu-bundle.write":      ["Admin", "Doctor", "Nurse"],
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
  // R7hr-12-S2 (D3-03): ward-stock-return endpoint mirror. Same tier as
  // pharmacy.return — Admin + Pharmacist only.
  "indent.return":         ["Admin", "Pharmacist"],
  "pharmacy.grn":          ["Admin", "Pharmacist"],
  "pharmacy.return":       ["Admin", "Pharmacist"],
  "pharmacy.add-items":    ["Admin", "Pharmacist"],
  "pharmacy.cancel":       ["Admin", "Pharmacist"],
  "pharmacy.settings":     ["Admin", "Pharmacist"],
  // R7bd-E-1 / A2-MED-16 — Schedule-X register (mirror of backend).
  "pharmacy.schedule-x.write": ["Admin", "Pharmacist"],
  "pharmacy.schedule-x.read":  ["Admin", "Pharmacist"],
  // R7bd-E-2 / A2-MED-18 — stock-take / cycle count (mirror of backend).
  "pharmacy.stock-take":       ["Admin", "Pharmacist"],

  // Lab — outsourced workflow. Lab Technician does ALL data entry
  // for labs + micro + histopath; Radiologist re-enabled for imaging
  // workflow (R7bb-FIX-C-2 mirror).
  "lab.order":             ["Admin", "Doctor", "Receptionist"],
  "lab.collect":           ["Admin", "Lab Technician", "Nurse"],
  "lab.read":              ["Admin", "Doctor", "Nurse", "Lab Technician", "Radiologist", "MRD"],
  "lab.result-entry":      ["Admin", "Lab Technician", "Radiologist"],
  "lab.verify":            ["Admin", "Doctor", "Radiologist"],
  "lab.dispatch":          ["Admin", "Lab Technician", "Radiologist"],
  // R7z: cancel split from dispatch — Lab Tech can print but can't void
  // a clinician's order (cancel also reverses billing). Sample rejection
  // stays a Lab Tech action under lab.result-entry.
  "lab.cancel":            ["Admin", "Doctor"],
  // R7bb-B/D4-CRIT: Radiologist + MRD added so they can read lab + imaging
  // records on the investigation-orders surface (mirror of backend).
  "lab.records.read":      ["Admin", "Doctor", "Nurse", "Lab Technician", "Radiologist", "MRD"],
  "lab.records.write":     ["Admin", "Lab Technician", "Radiologist"],
  "lab.records.verify":    ["Admin", "Doctor", "Radiologist"],

  // Billing
  "billing.read":          ["Admin", "Accountant", "Receptionist", "TPA Coordinator"],
  // R7bp-FIX-PERMS / D8-CRIT — Doctor + Nurse added so the OPD / Emergency
  // "Services & Orders" panel can POST /billing/create + /billing/:id/add-service.
  // Mirrors Backend/config/permissions.js. Money-write paths stay blocked by
  // the blockNonClinicalForDoctorNurse middleware on the server.
  "billing.write":         ["Admin", "Accountant", "Receptionist", "Doctor", "Nurse"],
  // R7hr-261 (sprint-review SoD fix): mirrors Backend. billing.refund is the
  // SENSITIVE tier (bill refund/cancel, credit-note approve, bulk-settle,
  // settlement-adjust, cashier clear-close) — Accountant/Admin only.
  "billing.refund":        ["Admin", "Accountant"],
  // R7hr-170, re-scoped by R7hr-261: Receptionist may refund a patient ADVANCE
  // DEPOSIT only. Narrow action so the Advance-Deposits-row Refund button shows
  // for reception without granting the bill-level refund / credit-note tier.
  "billing.advance-refund": ["Admin", "Accountant", "Receptionist"],
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
  // R7bb-FIX-C-7/D2-CRIT-2: split tpa.pre-auth → tpa.case-file (Reception
  // + TPA Coordinator) vs tpa.master-edit (TPA Coordinator + Admin only).
  // Receptionist can attach pre-auth to a bill but cannot CRUD the TPA
  // master payor record.
  "tpa.pre-auth":          ["Admin", "TPA Coordinator", "Receptionist"], // deprecated alias for tpa.case-file
  "tpa.case-file":         ["Admin", "TPA Coordinator", "Receptionist"],
  "tpa.master-edit":       ["Admin", "TPA Coordinator"],
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

  // Housekeeping — R7bb-FIX-C-12/D2-HIGH-4 adds Housekeeping to house.manage.
  "house.read":            ["Admin", "Doctor", "Nurse", "Receptionist", "Housekeeping", "Ward Boy"],
  "house.create":          ["Admin", "Doctor", "Nurse", "Receptionist", "Housekeeping"],
  "house.fulfill":         ["Admin", "Housekeeping"],
  "house.spillage":        ["Admin", "Doctor", "Nurse", "Housekeeping"],
  "house.inventory":       ["Admin", "Housekeeping"],
  "house.checklist":       ["Admin", "Housekeeping"],
  "house.pest":            ["Admin", "Housekeeping"],
  "house.manage":          ["Admin", "Nurse", "Housekeeping"],

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
  "mrd.write":             ["Admin"],
  // Patient-scoped audit-bundle print (Complete File + activity/print/billing/
  // clinical trails). Gates the "Include audit logs" group in the Print Center
  // dialog on CompletePatientFilePage. Mirror of Backend/config/permissions.js.
  "patient-file.audit-print": ["Admin", "MRD"],
  // Same-day discharge undo — Admin only, controller gates 24h window.
  "admission.reactivate":  ["Admin"],

  // ── R7az-A/D1+D9 — new PHI/clinical read tokens + write splits ──
  // Mirror of Backend/config/permissions.js. Frontend `can()` helper
  // hides UI buttons / sidebar items the API will reject.
  "patient-file.read":         ["Admin", "Doctor", "Nurse", "MRD"],
  "doctor-notes.read":         ["Admin", "Doctor", "Nurse", "MRD"],
  "nurse-notes.read":          ["Admin", "Doctor", "Nurse", "MRD"],
  "mar.read":                  ["Admin", "Doctor", "Nurse", "MRD"],
  "discharge-summary.read":    ["Admin", "Doctor", "Nurse", "MRD"],
  "discharge-summary.write":   ["Admin", "Doctor"],
  "mlc.write":                 ["Admin", "Doctor"],
  "mlc.read":                  ["Admin", "Doctor", "Nurse"],
  "ipd.read":                  ["Admin", "Doctor", "Nurse", "Receptionist"],
  // R7bb-FIX-C-1: new explicit OPD / ER read tokens + restricted DELETE.
  "opd.read":                  ["Admin", "Doctor", "Nurse", "Receptionist"],
  "er.read":                   ["Admin", "Doctor", "Nurse", "Receptionist"],
  "opd.delete":                ["Admin", "Doctor"],
  "er.delete":                 ["Admin", "Doctor"],
  "consultation.write":        ["Admin", "Doctor"],
  "safety.write":              ["Admin", "Doctor", "Nurse"],
  "diabetic.scale.write":      ["Admin", "Doctor"],
  "doctor.self.write":         ["Admin", "Doctor"],
  // R7bb-FIX-C-15: new self-read token for /api/doctors/me.
  "doctor.self.read":          ["Admin", "Doctor"],
  "services.read":             ["Admin", "Doctor", "Nurse", "Receptionist", "Pharmacist", "Lab Technician"],
  "appointment.confirm":       ["Admin", "Receptionist"],

  // ── R7bb-FIX-C-1 (S1: 38 ungated routes) — new explicit tokens ────
  "med-recon.read":            ["Admin", "Doctor", "Nurse", "Pharmacist", "MRD"],
  "nursing.care-plan.read":    ["Admin", "Doctor", "Nurse", "MRD"],
  "equipment.read":            ["Admin", "Doctor", "Nurse", "Receptionist", "Ward Boy", "Housekeeping"],
  "equipment.write":           ["Admin", "Ward Boy", "Nurse"],
  "auth.2fa":                  ["Admin", "Doctor", "Nurse"],
  "presence.read":             ["Admin"],
  "users.change-password-self": [
    "Admin", "Receptionist", "Doctor", "Nurse", "Dietician",
    "TPA Coordinator", "Pharmacist", "Lab Technician", "Radiologist",
    "Physiotherapist", "Accountant", "Ward Boy", "Housekeeping",
    "Security", "MRD",
  ],

  // R7bb-FIX-C-5: senior-doctor signature gate (stub — middleware
  // extension pending). Same role set as "Admin + Doctor" today;
  // designation-tier check is filed forward.
  "signature.consultant-grade": ["Admin", "Doctor"],

  // R7bb-FIX-C-2: Physiotherapist's only write action. No frontend
  // page wires it yet — kept as a stub so the role has somewhere to
  // attach a future requireAction.
  "physio.note.write":         ["Admin", "Physiotherapist"],

  // ── R7bf-G — NABH compliance scaffold tokens (mirror of backend) ─
  // Sidebar + page `can(...)` checks consult these; backend has the
  // authoritative copy. See Backend/config/permissions.js header for
  // the role-selection rationale (no dedicated HR / Safety Officer
  // roles today, so the nearest functional cohort owns each register).
  "clinical.acknowledge-critical": ["Admin", "Doctor", "Nurse"],
  "clinical.emit-critical":        ["Admin", "Doctor", "Nurse", "Lab Technician"],
  "pharmacy.adr.write":            ["Admin", "Doctor", "Pharmacist", "Nurse"],
  "pharmacy.adr.read":             ["Admin", "Doctor", "Pharmacist", "Nurse"],
  "quality.grievance.write":       ["Admin", "MRD", "Receptionist"],
  "quality.grievance.read":        ["Admin", "MRD", "Receptionist", "Doctor"],
  "hr.credential.write":           ["Admin"],
  "hr.credential.read":            ["Admin", "Doctor"],
  "compliance.firedrill.write":    ["Admin", "Security"],
  "compliance.firedrill.read":     ["Admin", "Security"],
  // R7bo — NABH Inspection Dashboard (RBS / Emergency / Blood Transfusion).
  "compliance.read":               ["Admin", "Doctor", "Nurse", "MRD"],
  // R7gw-B9 — NABH register surface gates (mirror of backend); Sentinel,
  // Hand-Hygiene, HAI, Med-Error, etc.
  "compliance.nabh.read":          ["Admin", "Doctor", "Nurse", "MRD"],
  "compliance.nabh.write":         ["Admin", "Doctor", "Nurse", "MRD"],
  "print.audit.write":             ["Admin", "Doctor", "Nurse", "Pharmacist", "Lab Technician", "Receptionist", "MRD"],

  // ── R7bh-F6 — Accountant regulatory + cold-chain (mirror of backend) ─
  "tax.returns.write":             ["Admin", "Accountant"],
  "tax.returns.read":              ["Admin", "Accountant"],
  "tax.tds.write":                 ["Admin", "Accountant"],
  "tax.tds.read":                  ["Admin", "Accountant"],
  "compliance.retention.read":     ["Admin", "MRD"],
  "pharmacy.cold-chain.write":     ["Admin", "Pharmacist", "Nurse"],
  "pharmacy.cold-chain.read":      ["Admin", "Pharmacist", "Nurse", "Doctor"],

  // ── R7bj-F1 — Physiotherapy plan + session register ───────────
  // Mirror of Backend/config/permissions.js. Plan reads broad,
  // writes narrow to Doctor / Physiotherapist; session writes
  // narrowest (PT only, plus Admin).
  "physio.plan.read":              ["Admin", "Doctor", "Nurse", "Physiotherapist"],
  "physio.plan.write":             ["Admin", "Doctor", "Physiotherapist"],
  "physio.session.read":           ["Admin", "Doctor", "Nurse", "Physiotherapist"],
  "physio.session.write":          ["Admin", "Physiotherapist"],

  // ── R7bj-F2 — Kitchen indent + adverse food reactions ─────────
  "kitchen.indent.read":           ["Admin", "Nurse", "Pharmacist", "Ward Boy", "Dietician"],
  "kitchen.indent.write":          ["Admin", "Nurse", "Pharmacist", "Dietician"],
  "kitchen.delivery.write":        ["Admin", "Ward Boy", "Pharmacist"],
  "quality.food-reaction.read":    ["Admin", "Doctor", "Nurse", "Dietician", "Pharmacist", "MRD"],
  "quality.food-reaction.write":   ["Admin", "Doctor", "Nurse", "Dietician"],

  // ── R7bj-F6 — Compliance registers (BMW, code response, sharps) ─
  "compliance.bmw.read":           ["Admin", "Housekeeping", "Ward Boy", "MRD"],
  "compliance.bmw.write":          ["Admin", "Housekeeping", "Ward Boy"],
  "compliance.code-response.read": ["Admin", "Doctor", "Nurse", "MRD"],
  "compliance.code-response.write":["Admin", "Doctor", "Nurse"],
  "clinical.sharps-injury.read":   ["Admin", "Doctor", "Nurse", "MRD"],
  "clinical.sharps-injury.write":  ["Admin", "Doctor", "Nurse", "Pharmacist", "Lab Technician", "Ward Boy", "Housekeeping"],
};

/* ── Helpers ─────────────────────────────────────────────────────── */
export function roleSeesModule(role, moduleId) {
  if (!role) return false;
  const allowed = MODULE_ROLES[moduleId];
  if (!allowed) return false;
  return allowed.includes("*") || allowed.includes(role);
}

// R7bb-FIX-C-2: phantom-role warning. Mirrors the Backend roleCan() noise
// so a deprecated Radiologist / Physiotherapist account surfaces in the
// browser console as well as the server log.
const _phantomWarned = new Set();
function _maybeWarn(role) {
  if (role === "Radiologist" || role === "Physiotherapist") {
    if (!_phantomWarned.has(role)) {
      _phantomWarned.add(role);
      // eslint-disable-next-line no-console
      console.warn(
        `[permissions] role="${role}" is a deprecated / partially-built role. ` +
        `This account will see an almost-empty UI. See ` +
        `Frontend/src/config/permissions.js header for the decision log.`
      );
    }
  }
}

export function roleCan(role, action) {
  if (!role) return false;
  _maybeWarn(role);
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
  // R7bb-E/D5-CRIT-3 — MRD lands on the discharged-patient archive
  // (their primary read-only surface). RoleDashboardPage's MRD branch
  // also redirects there as a belt-and-braces fallback if some flow
  // forces /dashboard.
  if (role === "MRD")          return "/medical-records/discharges";
  return "/dashboard";
}

const PERMISSIONS = {
  ROLES, ROLE_KEYS, MODULES, MODULE_ROLES, ACTIONS,
  roleSeesModule, roleCan, modulesForRole, actionsForRole, homePathForRole,
};
export default PERMISSIONS;
