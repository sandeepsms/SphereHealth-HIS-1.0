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
import { useHospitalSettings } from "../context/HospitalSettingsContext";
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
  MRD:               { color: "#0f766e", light: "#ecfeff",  icon: "pi-folder-open",      label: "Medical Records" },
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
// R7bb-E/D1-CRIT-2 — "MT" / "Maintenance" was a phantom role: never in
// the User enum or permissions ACL, never satisfied any backend gate.
// Removed alongside the Maintenance section below. Housekeeping handles
// cleaning queues via HOUSEKEEPING_NAV; Equipment Tracker remains a
// Bed Management / facility-admin tile if reinstated later.
const SE    = "Security";

/* ══════════════════════════════════════════════════════════════
   MASTER NAV DEFINITION
   roles: ["*"] = everyone  |  omit or [] = Admin only
   Each item also carries roles for fine-grained filtering.
══════════════════════════════════════════════════════════════ */
const NAV = [
  /* ── Dashboard ──────────────────────────────────────────────
     /dashboard is the role-aware RoleDashboardPage — it reads
     user.role and renders the right layout. Previously this pointed
     to /mainpage which was the receptionist-flavoured MainPage and
     non-receptionist roles (Dietician, Physio, Accountant, …) saw
     reception's "New OPD / IPD Registration" cards — a permission
     breach reported on 13 May 2026. */
  {
    id: "dashboard", label: "Dashboard",
    icon: "pi-home", color: "#1e40af", light: "#eff6ff",
    path: "/dashboard", single: true, roles: ALL,
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
      // Single "Patient Lookup — All-in-One" entry replaces the four
      // previous lines (RX-flavored + clinical-flavored copies of
      // "Patient Search" + "Visit History"). All 4 legacy routes now
      // alias the unified PatientLookupPage which adapts its default
      // view per role: Receptionist → Search · Doctor/Nurse/Admin →
      // Directory · ?uhid= deep link → Timeline. See the
      // PatientLookupPage docstring for the consolidation rationale.
      { label: "Patient Lookup",      icon: "pi-id-card",           path: "/patient-search",                  badge: "ALL-IN-ONE",  roles: [ADMIN, RX, DR, NR, AC, TPA] },
      // OPD history per UHID + chronological IPD file per admission — a
      // two-tab focused view that complements the giant Complete Patient
      // File. Reachable without a UHID (the page shows a search box) so
      // clinicians can land here, search by UHID/IPD number, and read.
      { label: "Patient File",        icon: "pi-folder",            path: "/patient-history-view",            badge: "NEW",         roles: [ADMIN, RX, DR, NR, AC, TPA] },
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
      // ── Operational (everyone in group sees these) ──
      // Dashboard doubles as the Bed Management home — KPI strip on top
      // and a tile grid linking out to every other section.
      { label: "Home",               icon: "pi-th-large",  path: "/bed-dashboard",  badge: "NEW", roles: [ADMIN, NR, WB] },
      // Single role-aware Live Bed Map; RX sees read-only mode on the same route
      { label: "Live Bed Map",       icon: "pi-eye",       path: "/bed-visual",     roles: [ADMIN, RX, NR, WB] },
      { label: "Bed Transfers",      icon: "pi-arrows-h",  path: "/bed-transfers",  badge: "NEW", roles: [ADMIN, DR, NR] },
      { label: "Monthly Report",     icon: "pi-file-pdf",  path: "/bed-reports/monthly", badge: "NEW", roles: [ADMIN, NR] },
      { label: "Manage Beds",        icon: "pi-list",      path: "/beds",           roles: [ADMIN, NR] },
      // ── Setup & Hierarchy (admin only) ──
      // These were previously scattered: Wards/Rooms/RoomCategory here,
      // Buildings/Floors in Settings. Consolidated into one group so the
      // full Building → Floor → Ward → Room → Bed hierarchy lives together.
      { label: "Wards",              icon: "pi-home",      path: "/wards",          roles: [ADMIN, NR] },
      { label: "Rooms",              icon: "pi-box",       path: "/rooms",          roles: [ADMIN] },
      { label: "Room Categories",    icon: "pi-th-large",  path: "/roomcategory",   roles: [ADMIN] },
      { label: "Floors",             icon: "pi-arrows-v",  path: "/floors",         roles: [ADMIN] },
      { label: "Buildings",          icon: "pi-building",  path: "/buildings",      roles: [ADMIN] },
    ],
  },

  /* R7bb-E/D1-CRIT-2, D6-CRIT-1 — Maintenance section deleted.
     "Maintenance" was a phantom role with no backend ACL backing; nothing
     under /maintenance or /equipment was reachable by the (non-existent)
     MT user. Housekeeping uses HOUSEKEEPING_NAV; equipment + maintenance
     dashboards can be reinstated as admin-only tiles inside Bed Management
     when there's real backend support behind them. */

  /* ── Clinical — Doctor ────────────────────────────────
     R7av — slim sidebar to 3 core entries. Emergency Assessment,
     Discharge Summary, Consent Forms, and MLC now live as tiles INSIDE
     the Doctor Notes page (same surface as Diagnosis / Orders / MAR /
     Team) so a doctor lands on a single hub for everything they author
     about a patient. The standalone routes still exist — the tiles
     navigate to them — so deep-links from print headers and email
     reminders keep working.

     Physiotherapy Console removed from the Doctor sidebar too: it now
     lives only under the Physiotherapist role's hard-forked nav
     (see PHYSIO_NAV below). Doctors who need to peek at a physio plan
     can deep-link to /physiotherapist?tab=plans from inside the patient
     file or a doctor-order chip — keeping it on every doctor's sidebar
     made the sidebar feel like a settings menu. */
  {
    id: "doctor", label: "Clinical — Doctor",
    icon: "pi-user-edit", color: "#7c3aed", light: "#f5f3ff",
    nabh: true, roles: [ADMIN, DR],
    items: [
      { label: "Patient Panel",  icon: "pi-id-card",   path: "/doctor-patient-panel", roles: [ADMIN, DR] },
      { label: "OPD Assessment", icon: "pi-file-edit", path: "/doctor-opd-panel",     roles: [ADMIN, DR], nabh: true },
      { label: "Doctor Notes",   icon: "pi-book",      path: "/doctor-notes",         roles: [ADMIN, DR], nabh: true },
    ],
  },

  /* ── Medical Records (MRD) — R7i ─────────────────────
     Replaces the paper MRD function. Read-only access to
     every discharged patient's complete file. Doctor sees
     it so they can pull up any old case during a follow-up;
     Admin/MRD see the full archive list.

     "MRD" is a string literal here because it's not in the
     short-form aliases at the top of this file — Sidebar's
     filter uses string equality against user.role. */
  {
    id: "mrd", label: "Medical Records",
    icon: "pi-folder-open", color: "#0f766e", light: "#ecfeff",
    nabh: true, roles: [ADMIN, DR, "MRD"],
    items: [
      // Discharged-patient archive — the primary MRD entry point.
      // Clicking a row navigates to /patient-file/:uhid (read-only
      // complete file). Filterable by Today / 7d / 30d / 1y.
      { label: "Patient Files",         icon: "pi-folder-open",       path: "/medical-records/discharges", nabh: true, badge: "MRD",       roles: [ADMIN, DR, "MRD"] },
      // Generic UHID search — same target page; convenient when
      // the user knows the UHID but not the discharge date.
      { label: "UHID Search",           icon: "pi-search",            path: "/patient-search",                                            roles: [ADMIN, DR, "MRD"] },
      // Quick access to the focused OPD/IPD history view for MRD audits.
      { label: "OPD/IPD History",       icon: "pi-folder",            path: "/patient-history-view",                  badge: "NEW",       roles: [ADMIN, DR, "MRD"] },
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
      // R7e: Removed 5 duplicate sidebar entries (Initial Assessment /
      // Daily Assessment / Care Plan / Fall Risk / Pain Assessment) —
      // every one of those is already accessible as a chip button on the
      // Nursing Notes page itself (the "ASSESSMENT & MONITORING" +
      // "INTERVENTIONS" + "DOCUMENTATION" row), so the sidebar entries
      // were redundant navigation that created 5 extra clicks the nurse
      // didn't need. Routes themselves stay in App.jsx so deep links
      // and chip-button navigation continue to work.
    ],
  },

  /* ── Pharmacy / MAR ──────────────────────────────────── */
  {
    id: "pharmacy", label: "Pharmacy / MAR",
    icon: "pi-box", color: "#ea580c", light: "#fff7ed",
    nabh: true, roles: [ADMIN, PH, NR, DR],
    items: [
      // MAR is the canonical record — Doctor reads it (gets to "DR" too).
      // Live Indents is NOT a separate sidebar entry — it lives as a
      // tab inside the Pharmacy page (next to Dispense + Sales) so the
      // pharmacist sees it on their primary workspace.
      { label: "Pharmacy",         icon: "pi-box",           path: "/pharmacy",        nabh: true, badge: "NEW", roles: [ADMIN, PH] },
      // R7bb-E/D5-CRIT-1 — Pharmacist removed: backend mar.read excludes
      // PH so the page hits a 403/empty state every time. PH still
      // sees Pharmacy + Indents to fulfil dispensing requests instead.
      { label: "MAR",              icon: "pi-table",         path: "/mar",             nabh: true, roles: [ADMIN, NR, DR] },
      { label: "Diabetic Chart",   icon: "pi-chart-bar",     path: "/diabetic-chart",  nabh: true, badge: "NEW", roles: [ADMIN, NR, DR] },
      // R7bj-F2 — Kitchen indent console (nurse raises meal indent,
      // kitchen desk prepares, ward boy delivers). Visible to the four
      // roles that participate in the loop. Lazy route /kitchen owned
      // by F10 — if KitchenConsole.jsx isn't yet shipped the route
      // renders the lazy-import-fallback page.
      { label: "Kitchen Indent",   icon: "pi-shopping-cart", path: "/kitchen",         nabh: true, badge: "NEW", roles: [ADMIN, NR, PH, WB] },
      // R7bk — Cold-Chain Log (NABH MOM.2, WHO PQS E003). Pharmacist
      // logs vaccine-fridge / insulin-fridge / freezer temps; auto-flag
      // out-of-range as breach + nurse acknowledge.
      { label: "Cold Chain Log",   icon: "pi-bolt",          path: "/cold-chain",      nabh: true, badge: "MOM.2", roles: [ADMIN, PH, NR, DR] },
    ],
  },

  /* ── Lab & Investigation ─────────────────────────────── */
  {
    id: "lab", label: "Lab & Investigation",
    icon: "pi-search-plus", color: "#0284c7", light: "#f0f9ff",
    roles: [ADMIN, LB, RL, DR],
    items: [
      // R7bb-E/D5-MED-1 — Radiologist re-added to the imaging/lab list
      // surface. Backend lab.records.read includes Radiologist + MRD so
      // they can pull up scan reports — without this entry the Lab
      // section was visible but empty for the role. Manual Lab Entry
      // (write) stays Admin/LabTech-only. Master likewise.
      { label: "Investigation Orders",  icon: "pi-list",   path: "/investigation-orders",  roles: [ADMIN, LB, DR, RL] },
      // R7bd-E-5 / A3-MED-18 — Lab Tech multi-tab console (sample queue,
      // result-entry queue, QC log, day worksheet). Sits above the
      // single-page "Manual Lab Entry" because the console is the
      // intended landing surface; the entry page is now reached from
      // the queue rows. Visible to Admin + Lab Tech only.
      { label: "Lab Console",           icon: "pi-flask",  path: "/lab-console",           badge: "NEW", roles: [ADMIN, LB] },
      { label: "Imaging Reports",       icon: "pi-table",  path: "/lab-results",           badge: "READ",roles: [RL] },
      // R7bd-E-6 / A3-HIGH-10 — Radiologist 3-tab console stub
      // (worklist, reported, pending sign-off). Visible to Admin +
      // Radiologist only.
      { label: "Radiology Console",     icon: "pi-eye",    path: "/radiology-console",     badge: "NEW", roles: [ADMIN, RL] },
      { label: "Manual Lab Entry",      icon: "pi-table",  path: "/lab-results",           badge: "NEW", roles: [ADMIN, LB] },
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
      // Receptionist-only Billing Counter — single-window flow.
      // The accountant / admin still see the deeper UIs below, but
      // for the receptionist this is the only billing entry.
      { label: "Billing Counter",       icon: "pi-credit-card", path: "/reception-billing", badge: "COUNTER", roles: [RX] },
      // IPD Live Ledger — direct entry to the per-admission ledger with
      // Category / Daily Breakdown / Audit Trail tabs and the
      // Generate-Final-Bill + Print-Final-Bill buttons. Opens the picker
      // when no admissionId is in the URL so users can search instead of
      // memorising MongoDB ids. Distinct from Billing Counter (which is
      // a per-UHID bill list) — this is the IPD-stay-wide rolling tab.
      { label: "IPD Live Ledger",       icon: "pi-chart-line",  path: "/billing/ipd",        badge: "IPD",     roles: [ADMIN, AC, RX] },
      // R7ah: removed legacy "Patient Bill" (/patient-billing) and
      // "Bills List" (/billing) entries. Reception Billing Counter
      // (/reception-billing) and IPD Live Ledger (/billing/ipd) are
      // the canonical surfaces — the two old pages were redundant.
      // Billing Intelligence (AI) was removed earlier in the same cleanup.
      { label: "Billing Audit Trail",   icon: "pi-list",    path: "/billing-audit-trail",                 roles: [ADMIN, AC] },
      { label: "TPA Services",          icon: "pi-briefcase", path: "/addservice",          roles: [ADMIN, TPA, AC] },
      { label: "Chargeable Services",   icon: "pi-dollar",  path: "/chargeable-services",   roles: [ADMIN, AC] },
      { label: "Service Master",        icon: "pi-cog",     path: "/service-master",        roles: [ADMIN] },
    ],
  },

  /* ── Dietitian — single Console entry for Doctor/Nurse/Admin ──
     For Dietician this section is REPLACED entirely by the
     DIETICIAN_NAV override below (Dashboard → /dietitian). For other
     roles who need to view diet plans (treating doctor, nurse on rounds,
     admin oversight) we keep a single "Dietician Console" link — they
     get the full console where they can read everything, write actions
     are gated by diet.write at both UI and API levels. */
  {
    id: "dietitian", label: "Nutrition / Diet",
    icon: "pi-apple", color: "#16a34a", light: "#f0fdf4",
    roles: [ADMIN, DR, NR],   // DT excluded — they get DIETICIAN_NAV instead
    items: [
      { label: "Dietician Console",  icon: "pi-apple",  path: "/dietitian",  badge: "NEW",  roles: [ADMIN, DR, NR] },
    ],
  },

  /* ── Ward Boy — task board + manager view ─────────────────────
     Same hard-fork pattern as Dietician — the role itself sees the
     WARD_BOY_NAV single-page console. Admin / Receptionist / Nurse
     get visibility into the task board through this section so they
     can see what's queued, what's in progress, and (Admin) the
     manager dashboard for aggregate metrics. */
  {
    id: "wardboy", label: "Ward Boy",
    icon: "pi-user", color: "#0d9488", light: "#f0fdfa",
    roles: [ADMIN, RX, NR, DR],
    items: [
      { label: "Task Board",          icon: "pi-list",   path: "/ward-tasks",   roles: [ADMIN, RX, NR, DR] },
      { label: "Ward Manager",        icon: "pi-chart-bar", path: "/ward-manager", roles: [ADMIN] },
    ],
  },

  /* ── Security — visitor passes + gate logs + incident reports ─
     Mirrors the Dietician/Ward Boy pattern: Security users see the
     SECURITY_NAV hard-fork (4-entry workspace), Admin sees this
     section so the security surface is discoverable from the main
     nav rather than buried under Reception. */
  {
    id: "security", label: "Security",
    icon: "pi-lock", color: "#374151", light: "#f9fafb",
    roles: [ADMIN, SE],
    items: [
      { label: "Visitor Passes",   icon: "pi-id-card",              path: "/visitor-passes", roles: [ADMIN, SE] },
      { label: "Gate Log",         icon: "pi-shield",               path: "/gate-log",       badge: "NEW", roles: [ADMIN, SE] },
      { label: "Incident Reports", icon: "pi-exclamation-triangle", path: "/incidents",      badge: "NEW", roles: [ADMIN, SE] },
    ],
  },

  /* ── Accounts & Finance — dedicated Accountant workspace ── */
  /* Centralises daily collection, GST returns, outstanding (TPA + IPD
     advance), refund / cancellation queue, and the audit trail.
     Visible to Accountant + Admin; everything inside hits existing
     billing / pharmacy register endpoints. */
  {
    id: "accounts", label: "Accounts & Finance",
    icon: "pi-wallet", color: "#15803d", light: "#f0fdf4",
    roles: [ADMIN, AC],
    items: [
      // Each item deep-links to a tab in /accounts. The console parent has
      // no separate sidebar entry — the 5 tabs together ARE the console.
      { label: "Day Book",             icon: "pi-book",        path: "/accounts?tab=daybook",     badge: "NEW",  roles: [ADMIN, AC] },
      { label: "Revenue (MTD)",        icon: "pi-chart-line",  path: "/accounts?tab=revenue",                    roles: [ADMIN, AC] },
      { label: "GST Returns",          icon: "pi-percentage",  path: "/accounts?tab=gst",                        roles: [ADMIN, AC] },
      { label: "Outstanding",          icon: "pi-clock",       path: "/accounts?tab=outstanding",                roles: [ADMIN, AC] },
      { label: "Refunds & Audit",      icon: "pi-undo",        path: "/accounts?tab=refunds",                    roles: [ADMIN, AC] },
      { label: "Pharmacy Sales Reg.",  icon: "pi-receipt",     path: "/pharmacy?tab=registers",                  roles: [ADMIN, AC] },
      // R7bk — GST + TDS regulatory exports (R7bh-F6 backend; UI in /tax-returns and /tds).
      { label: "GSTR-1 / 3B",          icon: "pi-file",        path: "/tax-returns",              badge: "GST",     roles: [ADMIN, AC] },
      { label: "TDS Form 16A",         icon: "pi-percentage",  path: "/tds",                      badge: "TDS",     roles: [ADMIN, AC] },
    ],
  },

  /* ── Masters & Admin ─────────────────────────────────── */
  {
    id: "masters", label: "Masters & Admin",
    icon: "pi-sliders-h", color: "#374151", light: "#f9fafb",
    roles: [ADMIN],   // Admin only
    items: [
      // R7cc — legacy "Hospital Settings" link removed; the wizard below is
      // now the sole admin entry-point for hospital config.
      { label: "Hospital Configuration", icon: "pi-cog",   path: "/admin/hospital-config", badge: "NEW" },
      { label: "Print Templates",    icon: "pi-print",      path: "/print-gallery",     badge: "NEW" },
      { label: "Department",         icon: "pi-sitemap",    path: "/department" },
      { label: "Doctor Management",  icon: "pi-user-edit",  path: "/doctors" },
      { label: "User Management",    icon: "pi-users",      path: "/admin/users" },
      { label: "Roles & Permissions",icon: "pi-shield",     path: "/admin/roles",       badge: "NEW" },
      // R7bz — read-only System Health diagnostics (DB / crons / errors /
      // activity / integrity / server).  Admin-only — the section itself
      // is already roles:[ADMIN] so no per-item role override is needed.
      { label: "System Health",      icon: "pi-server",     path: "/admin/system-health", badge: "NEW" },
      { label: "Hospital Charges",   icon: "pi-dollar",     path: "/hospital-charges" },
      // R7bf-G / NABH HRD.3 — staff credentialing register lives under
      // Masters & Admin since Admin owns the HR function today.
      { label: "Credentialing",      icon: "pi-id-card",    path: "/credentials",       badge: "NABH",  roles: [ADMIN] },
      // Buildings / Floors / Rooms / Room Categories moved to Bed Management
      // so the full bed hierarchy lives in one place.
    ],
  },

  /* ── R7bf-G + R7bj-F2/F6 — Quality & Compliance (NABH scaffolds) ─ */
  // Surfaces the NABH register pages: AAC.6 critical-value alerts,
  // PRE.6 grievance, MOM.7 ADR, FMS.4 fire drill, and the new R7bj
  // additions — food-reaction sentinel events (F2), BMW transport
  // manifest (F6 / BMWM 2016), code response / rapid response (F6),
  // sharps-injury register (F6 / HRD.8).
  {
    id: "quality", label: "Quality & Compliance",
    icon: "pi-verified", color: "#0d9488", light: "#f0fdfa",
    nabh: true, roles: [ADMIN, DR, NR, RX, PH, SE, DT, WB, "Housekeeping", "MRD"],
    items: [
      { label: "Critical Value Alerts", icon: "pi-bell",                 path: "/critical-value-alerts", nabh: true, badge: "AAC.6", roles: [ADMIN, DR, NR] },
      { label: "Grievance Register",    icon: "pi-comment",              path: "/grievances",            nabh: true, badge: "PRE.6", roles: [ADMIN, RX, DR, "MRD"] },
      { label: "ADR Reports",           icon: "pi-flag",                 path: "/adr-reports",           nabh: true, badge: "MOM.7", roles: [ADMIN, DR, NR, PH] },
      { label: "Fire Drill Register",   icon: "pi-shield",               path: "/fire-drills",           nabh: true, badge: "FMS.4", roles: [ADMIN, SE] },
      // R7bj-F2 — adverse food reaction sentinel-event register.
      { label: "Food Reactions",        icon: "pi-exclamation-triangle", path: "/food-reactions",        nabh: true, badge: "NEW",   roles: [ADMIN, DR, NR, DT, PH, "MRD"] },
      // R7bj-F6 — biomedical waste manifest (cart-out → vendor → PCB).
      { label: "BMW Manifest",          icon: "pi-truck",                path: "/bmw-manifest",          nabh: true, badge: "FMS.5", roles: [ADMIN, "Housekeeping", WB, "MRD"] },
      // R7bj-F6 — code response (code blue / pink / purple / black) log.
      { label: "Code Response Log",     icon: "pi-bolt",                 path: "/code-response",         nabh: true, badge: "NEW",   roles: [ADMIN, DR, NR, "MRD"] },
      // R7bj-F6 — sharps-injury register (HRD.8 needle-stick reporting).
      { label: "Sharps Injury",         icon: "pi-info-circle",          path: "/sharps-injury",         nabh: true, badge: "HRD.8", roles: [ADMIN, DR, NR, PH, LB, WB, "Housekeeping", "MRD"] },
      // R7bo — NABH Inspection Dashboard: surveyor-ready unified view of
      // RBS, Emergency, and Blood Transfusion registers (auto-populated).
      // R7bs — DVT (Caprini) chip lives inside the Nursing Notes page as
      // requested (Assessment & Monitoring section, next to Fall Risk).
      // No separate sidebar entry — keeps the chip-page consolidation
      // discipline established by R7e (avoid duplicate nursing entries).
      { label: "NABH Registers",        icon: "pi-th-large",             path: "/compliance/nabh-registers", nabh: true, badge: "R7bo", roles: [ADMIN, DR, NR, "MRD"] },
      // R7bx — six new surveyor-facing NABH registers. Each is a self-
      // contained filterable + printable + CSV-exportable chronological
      // log, auto-populated from existing clinical save paths (doctor
      // orders, procedure notes, admissions, discharge finalize).
      { label: "OT Register",           icon: "pi-briefcase",            path: "/compliance/nabh/ot-register",            nabh: true, badge: "COP.10",  roles: [ADMIN, DR, NR, "MRD"] },
      { label: "Anaesthesia Register",  icon: "pi-shield",               path: "/compliance/nabh/asa-register",           nabh: true, badge: "COP.13",  roles: [ADMIN, DR, NR, "MRD"] },
      { label: "Readmission Register",  icon: "pi-reply",                path: "/compliance/nabh/readmission-register",   nabh: true, badge: "COP.16",  roles: [ADMIN, DR, NR, "MRD"] },
      { label: "Mortality Register",    icon: "pi-times-circle",         path: "/compliance/nabh/mortality-register",     nabh: true, badge: "COP.18",  roles: [ADMIN, DR, NR, "MRD"] },
      { label: "Restraint Register",    icon: "pi-lock",                 path: "/compliance/nabh/restraint-register",     nabh: true, badge: "COP.17",  roles: [ADMIN, DR, NR, "MRD"] },
      { label: "Antimicrobial Use",     icon: "pi-stop-circle",          path: "/compliance/nabh/antimicrobial-register", nabh: true, badge: "MOM.7",   roles: [ADMIN, DR, NR, "MRD"] },
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

// Dietician-specific stripped sidebar — user requested 13 May 2026 that
// the Dietician sees ONLY a Dashboard entry, and every dietician sub-
// task (referred patients, assessment, library) lives as a pill-tab
// inside the /dietitian console rather than as separate sidebar items.
// We hard-fork the nav for this role so the rest of the NAV array
// (which other roles still consume) doesn't need to change.
const DIETICIAN_NAV = [{
  id: "dashboard", label: "Dashboard",
  icon: "pi-apple", color: "#16a34a", light: "#f0fdf4",
  path: "/dietitian", single: true, roles: ["Dietician"],
}];

// Ward Boy gets the same single-page treatment — the entire workflow
// (Available, My Tasks, Today) lives inside the /ward-tasks console.
const WARD_BOY_NAV = [{
  id: "dashboard", label: "Dashboard",
  icon: "pi-user", color: "#0d9488", light: "#f0fdfa",
  path: "/ward-tasks", single: true, roles: ["Ward Boy"],
}];

// Housekeeping — same single-page-console pattern.
const HOUSEKEEPING_NAV = [{
  id: "dashboard", label: "Dashboard",
  icon: "pi-sparkles", color: "#0d9488", light: "#f0fdfa",
  path: "/housekeeping", single: true, roles: ["Housekeeping"],
}];

// R7bj-F1 / R7bk — Physiotherapist hard-fork. Entire workflow (My
// Patients / Today's Sessions / Plans) lives inside /physiotherapist.
// NABH COP.20 rehabilitation services compliance.
const PHYSIO_NAV = [{
  id: "dashboard", label: "Dashboard",
  icon: "pi-bolt", color: "#059669", light: "#ecfdf5",
  path: "/physiotherapist", single: true, roles: ["Physiotherapist"],
}];

// Security — small focused workspace: dashboard, visitor passes, gate
// log, incident reports. Mirrors the Dietician/Ward Boy hard-fork
// pattern so the rest of the NAV array doesn't need to know about
// Security at all.
const SECURITY_NAV = [
  { id: "dashboard",      label: "Dashboard",        icon: "pi-home",                color: "#374151", light: "#f9fafb", path: "/dashboard",      single: true, roles: ["Security"] },
  { id: "visitor-passes", label: "Visitor Passes",   icon: "pi-id-card",             color: "#f59e0b", light: "#fffbeb", path: "/visitor-passes", single: true, roles: ["Security"] },
  { id: "gate-log",       label: "Gate Log",         icon: "pi-shield",              color: "#10b981", light: "#ecfdf5", path: "/gate-log",       single: true, roles: ["Security"], badge: "NEW" },
  { id: "incidents",      label: "Incident Reports", icon: "pi-exclamation-triangle",color: "#ef4444", light: "#fef2f2", path: "/incidents",      single: true, roles: ["Security"], badge: "NEW" },
];

// Receptionist — workflow-focused hard-fork. Replaces the previous
// 7-section / 17-item filter view (which sprinkled Reception across
// Dashboard, Reception, OPD/Emergency, Bed Management, Billing, Ward
// Boy sections) with a curated 1-tile + 3-section, 11-item layout
// organised around a receptionist's actual day:
//   • Today's Desk        — landing-tile dashboard with live counters
//   • FRONT DESK          — registration, search, history, appointments,
//                           visitor passes, discharge clearance
//   • QUEUES & BEDS       — OPD queue, ER cases, live bed map
//   • BILLING & TPA       — payment counter + insurance pre-auth
// Removed vs. previous view:
//   - duplicate "Dashboard" top-level link (the Reception tile is the
//     landing page; the universal /dashboard role-router still
//     forwards there if you bookmark it)
//   - Ward Boy → Task Board (receptionists can't fulfill tasks; if
//     they need to file a porter request they'll do it from the
//     patient file's quick actions)
//   - Setup / hierarchy entries (Wards / Rooms / Floors / Buildings)
//     they never had access to anyway — listed here for clarity.
const RECEPTION_NAV = [
  // Landing tile — the receptionist's home page (ReceptionDashboard:
  // today's OPD/IPD totals, doctor strip, collection breakdown, dues)
  {
    id: "desk", label: "Today's Desk",
    icon: "pi-home", color: "#0891b2", light: "#ecfeff",
    path: "/reception", single: true, roles: ["Receptionist"],
  },

  // ── Front desk — registration, lookup, scheduling, discharge ──
  // Ordered by daily frequency: New Reg is the primary CTA; search/
  // history support returning-patient lookup; appointments slot the
  // next visit; visitor passes are the steady stream of attendant
  // entries; discharge queue closes out IPD patients.
  {
    id: "front-desk", label: "Front Desk",
    icon: "pi-desktop", color: "#0891b2", light: "#ecfeff",
    nabh: true, roles: ["Receptionist"],
    items: [
      { label: "New Registration",  icon: "pi-user-plus",      path: "/reception/register", roles: ["Receptionist"], nabh: true },
      // Single "Patient Lookup — All-in-One" entry replaces the previous
      // pair of "Patient Search" + "Visit History" sidebar links. Inside
      // the unified PatientLookupPage the receptionist can switch between
      // search / directory / timeline tabs without leaving the page; the
      // separate sidebar entry for Visit History became redundant. Lands
      // on the Search tab by default for receptionists (see the
      // `defaultView` logic inside PatientLookupPage).
      { label: "Patient Lookup",    icon: "pi-id-card",        path: "/patient-search",     roles: ["Receptionist"], badge: "ALL-IN-ONE" },
      { label: "Appointments",      icon: "pi-calendar-plus",  path: "/appointments",       roles: ["Receptionist"], nabh: true },
      { label: "Visitor Passes",    icon: "pi-id-card",        path: "/visitor-passes",     roles: ["Receptionist"], nabh: true },
      { label: "Discharge Queue",   icon: "pi-sign-out",       path: "/discharge-queue",    roles: ["Receptionist"], nabh: true, badge: "NABH" },
    ],
  },

  // ── Queues & beds — current workload visibility ──
  // OPD queue + ER cases are the two queues a reception watches all
  // day; Live Bed Map opens read-only for IPD admission planning.
  {
    id: "queues", label: "Queues & Beds",
    icon: "pi-list", color: "#059669", light: "#ecfdf5",
    roles: ["Receptionist"],
    items: [
      { label: "OPD Queue",        icon: "pi-list",  path: "/reception-opd-queue", roles: ["Receptionist"] },
      { label: "Emergency Cases",  icon: "pi-bolt",  path: "/reception-emergency", roles: ["Receptionist"] },
      { label: "Live Bed Map",     icon: "pi-eye",   path: "/bed-visual",          roles: ["Receptionist"] },
    ],
  },

  // ── Billing Counter — single-window cash/UPI/card collection ──
  // One sidebar entry covers the entire receptionist billing flow:
  //   patient search → bill list → payment recording → advance deposit
  //   take/apply → receipt printing. TPA pre-auth still has its own
  //   /tpa-cases page (admin/AC sidebar), but for the receptionist's
  //   day-to-day cash work everything lives behind this single tile.
  //   Rendered as `single: true` so the sidebar shows it as a flat
  //   card with the COUNTER pill — not an expandable group.
  {
    id: "billing-counter", label: "Billing Counter",
    icon: "pi-credit-card", color: "#d97706", light: "#fffbeb",
    nabh: true, single: true, roles: ["Receptionist"],
    path: "/reception-billing",
    badge: "COUNTER",
  },

  // ── IPD Live Ledger — per-admission rolling tab ──
  // Distinct from Billing Counter (which is a per-UHID bill list).
  // This is the IPD-stay-wide ledger: bed-day + nursing + doctor visits
  // + medicines + procedures all consolidated under one admission, with
  // Category / Daily Breakdown / Audit Trail tabs and the
  // Generate-Final-Bill + Print-Final-Bill buttons. Opens the picker
  // when no admissionId is in the URL so the receptionist can search
  // instead of memorising MongoDB ids.
  {
    id: "ipd-ledger", label: "IPD Live Ledger",
    icon: "pi-chart-line", color: "#7c3aed", light: "#f5f3ff",
    nabh: true, single: true, roles: ["Receptionist"],
    path: "/billing/ipd",
    badge: "IPD",
  },
];

function filterNav(nav, userRole) {
  if (userRole === ADMIN) return nav; // Admin sees everything unfiltered
  if (userRole === "Dietician")       return DIETICIAN_NAV;
  if (userRole === "Ward Boy")        return WARD_BOY_NAV;
  if (userRole === "Housekeeping")    return HOUSEKEEPING_NAV;
  if (userRole === "Security")        return SECURITY_NAV;
  if (userRole === "Physiotherapist") return PHYSIO_NAV;
  if (userRole === "Receptionist") return RECEPTION_NAV;
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
          {item.badge === "AI"      && <Pill label="AI"      color="#059669" />}
          {item.badge === "NEW"     && <Pill label="NEW"     color="#d97706" />}
          {item.badge === "LIVE"    && <Pill label="LIVE"    color="#dc2626" />}
          {item.badge === "ALL-IN-ONE" && <Pill label="ALL-IN-ONE" color="#0891b2" />}
          {item.badge === "COUNTER" && <Pill label="COUNTER" color="#d97706" />}
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
          <>
            <span style={{
              fontSize: 13, fontWeight: 600,
              color: active ? section.color : "#1e293b",
              flex: 1, textAlign: "left",
            }}>{section.label}</span>
            {section.nabh && <Pill label="NABH" color="#7c3aed" />}
            {section.badge === "COUNTER" && <Pill label="COUNTER" color={section.color || "#d97706"} />}
            {section.badge === "ALL-IN-ONE" && <Pill label="ALL-IN-ONE" color="#0891b2" />}
            {section.badge === "AI"      && <Pill label="AI"  color="#059669" />}
            {section.badge === "NEW"     && <Pill label="NEW" color="#d97706" />}
          </>
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
  const { settings } = useHospitalSettings();

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

  // Active-state matching is query-aware so deep links like
  // "/accounts?tab=daybook" highlight only when both the pathname AND the
  // tab query param match. Without this, every "/accounts?tab=*" sidebar
  // entry would always appear inactive while "Accounts Console" (path
  // "/accounts") would always be active regardless of the open tab.
  const isActive = (path) => {
    if (!path) return false;
    const [p, q] = path.split("?");
    if (location.pathname !== p && !location.pathname.startsWith(p + "/")) return false;
    if (!q) return true;                  // path has no query → pathname match is enough
    const want = new URLSearchParams(q);
    const have = new URLSearchParams(location.search);
    for (const [k, v] of want) {
      if (have.get(k) !== v) return false;
    }
    return true;
  };

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
                {settings?.hospitalName || "Hospital"}<span style={{ color: "#38bdf8" }}> HIS</span>
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
              <div style={{ fontSize: 10, fontWeight: 700, color: "#1e293b", lineHeight: 1 }}>{`${settings?.hospitalName || "Hospital"} HIS`}</div>
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
