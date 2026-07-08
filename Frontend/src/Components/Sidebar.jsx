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
import { IS_PHARMACY_STANDALONE } from "../config/pharmacyMode";
import "primeicons/primeicons.css";

/* ══════════════════════════════════════════════════════════════
   ROLE META — color, icon, label for each role
══════════════════════════════════════════════════════════════ */
export const ROLE_META = {
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
export const NAV = [
  /* ── Dashboard ──────────────────────────────────────────────
     /dashboard is the role-aware RoleDashboardPage — it reads
     user.role and renders the right layout. Previously this pointed
     to /mainpage which was the receptionist-flavoured MainPage and
     non-receptionist roles (Dietician, Physio, Accountant, …) saw
     reception's "New OPD / IPD Registration" cards — a permission
     breach reported on 13 May 2026. */
  {
    id: "dashboard", label: "Dashboard",
    icon: "pi-home", color: "#4338ca", light: "#eef2ff",
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
      // R7hr(DC-P1) — Day Care Today board (checklist + readiness + overdue)
      { label: "Day Care Today",     icon: "pi-sun",       path: "/daycare",           roles: [ADMIN, DR, NR, RX] },
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
      // ── R7gk — Maintenance + Equipment Tracker reinstated.
      // R7bb-E had removed the standalone "Maintenance" section because
      // the "MT" role was phantom (no backend ACL). The pages and routes
      // (/maintenance + /equipment) were always alive — only the sidebar
      // entry point disappeared. Per the removal comment's own
      // recommendation, surfacing them here as Admin-only entries inside
      // Bed Management's facility-admin group, which is the correct home
      // until a dedicated Facilities-Manager role exists in the backend.
      { label: "Maintenance",        icon: "pi-wrench",    path: "/maintenance",    roles: [ADMIN] },
      { label: "Equipment Tracker",  icon: "pi-cog",       path: "/equipment",      roles: [ADMIN] },
    ],
  },


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
      // R7fu — Medical Certificate builder. 12 NABH-compliant cert types
      // (fitness / sick-leave / disability / vaccination / cause-of-death etc.)
      { label: "Medical Certificates", icon: "pi-id-card", path: "/medical-certificates", roles: [ADMIN, DR], badge: "NEW" },
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

  /* ── Pharmacy ──────────────────────────────────────────
     R7cq: trimmed.
       • MAR + Diabetic Chart moved out — both now live as tiles inside
         Nursing Notes so the nurse opens them in patient context. Keeping
         them in two places duplicated the nav and split the workflow.
       • Kitchen Indent + Cold Chain Log removed entirely — modules
         deprecated per launch-scope decision. Routes + page components
         also deleted (see App.jsx). Backend models stay so existing
         data survives in case the modules ever return.
       • Section label dropped "/ MAR" since MAR no longer lives here. */
  {
    id: "pharmacy", label: "Pharmacy",
    icon: "pi-box", color: "#ea580c", light: "#fff7ed",
    nabh: true, roles: [ADMIN, PH],
    items: [
      // Live Indents is NOT a separate sidebar entry — it lives as a
      // tab inside the Pharmacy page (next to Dispense + Sales) so the
      // pharmacist sees it on their primary workspace.
      { label: "Pharmacy",         icon: "pi-box",           path: "/pharmacy",        nabh: true, badge: "NEW", roles: [ADMIN, PH] },
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
      // R7cq: Lab Console + Radiology Console removed per launch-scope
      // decision. Lab/imaging at this hospital are outsourced — the
      // multi-tab consoles weren't being used. Lab Tech still has
      // Manual Lab Entry below to transcribe external reports;
      // Radiologist still reads Imaging Reports.
      { label: "Imaging Reports",       icon: "pi-table",  path: "/lab-results",           badge: "READ",roles: [RL] },
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
      { label: "Doctor Charges",        icon: "pi-user-edit", path: "/doctor-charges",      roles: [ADMIN, AC] },
      // R7en — Per-room-category daily-charges matrix. Sits next to
      // Doctor Charges so the two "master price tables" live together.
      { label: "Room Charges",          icon: "pi-table",    path: "/room-charges",        roles: [ADMIN, AC] },
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

  /* ── Housekeeping — console + manager dashboard ───────────────
     B8-T07 — surfaces the previously-orphan /housekeeping-manager
     route for Admin. Housekeeping role itself still sees the
     HOUSEKEEPING_NAV hard-fork (single-page /housekeeping console),
     so this section only shows for Admin. Mirrors the Ward Boy
     pattern: Console = operational, Manager = aggregate metrics. */
  {
    id: "housekeeping", label: "Housekeeping",
    icon: "pi-sparkles", color: "#0d9488", light: "#f0fdfa",
    roles: [ADMIN],
    items: [
      { label: "Housekeeping Console",  icon: "pi-home",      path: "/housekeeping",         roles: [ADMIN] },
      { label: "Housekeeping Manager",  icon: "pi-chart-bar", path: "/housekeeping-manager", roles: [ADMIN], badge: "NEW" },
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
      // R7dw — NABH Signage Generator: 88 bilingual signage templates
      // for accreditation. Admin-only — used during NABH prep / audit.
      { label: "NABH Signage",       icon: "pi-images",     path: "/admin/nabh-signage",  badge: "NEW" },
      { label: "Hospital Charges",   icon: "pi-dollar",     path: "/hospital-charges" },
      // R7hr-164 — Nursing Equipment Master sits next to Hospital Charges
      // as the master CRUD for the "Equipment Used This Shift" catalogue
      // (oxygen mask, IV cannula, dressings…). Nurses tick chips on the
      // NursingNotes Equipment tile; each tick fans into the IPD ledger via
      // autoBillingService.onEquipmentCharged with chargeOncePerDay dedup.
      { label: "Nursing Equipment",  icon: "pi-heart",      path: "/nursing-equipment", badge: "NEW" },
      // R7bf-G / NABH HRD.3 — staff credentialing register lives under
      // Masters & Admin since Admin owns the HR function today.
      { label: "Credentialing",      icon: "pi-id-card",    path: "/credentials",       badge: "NABH",  roles: [ADMIN] },
      // R7hr-272 — DB Backup & Recovery (status / run-now / download). Admin-only.
      { label: "Backup & Recovery",  icon: "pi-database",   path: "/backup",            badge: "NEW",   roles: [ADMIN] },
      // R7hr-274 — Animation Gallery (live showcase of the 20-effect toolkit).
      { label: "Animation Gallery",  icon: "pi-sparkles",   path: "/animation-gallery", badge: "NEW",   roles: [ADMIN] },
      // Buildings / Floors / Rooms / Room Categories moved to Bed Management
      // so the full bed hierarchy lives in one place.
    ],
  },

  /* ── R7bf-G + R7bj-F2/F6 + R7ej — Quality & Compliance (NABH gateway) ─ */
  // R7ej (May 2026): collapsed 15 individual NABH-register entries (AAC.6
  // Critical Value Alerts, PRE.6 Grievance, MOM.7 ADR, FMS.4 Fire Drill,
  // Food Reactions, BMW Manifest, Code Response, HRD.8 Sharps Injury,
  // COP.10 OT, COP.13 Anaesthesia, COP.16 Readmission, COP.18 Mortality,
  // COP.17 Restraint, MOM.7 Antimicrobial, HIC.5 Infection Control) into
  // the /compliance/nabh-registers landing page as categorized tiles.
  // The sidebar now exposes a single gateway entry; the gateway page itself
  // role-gates the individual register pages via the existing route guards.
  // Widened roles cover the union of all previously-permitted populations
  // (Doctor/Nurse/Reception/Pharmacist/Lab/Security/Dietician/Ward Boy/
  // Housekeeping/MRD) so role-specific registers (e.g. BMW Manifest for
  // Housekeeping, Fire Drill for Security) are still reachable.
  {
    id: "quality", label: "Quality & Compliance",
    icon: "pi-verified", color: "#0d9488", light: "#f0fdfa",
    nabh: true, roles: [ADMIN, DR, NR, RX, PH, LB, SE, DT, WB, "Housekeeping", "MRD"],
    items: [
      // R7ek — Inspection Dashboard is a manager-facing "what's happening
      // today" view (KPIs + last-24h activity per register). Lives as its
      // own sidebar entry above the registers gateway so it's reachable
      // in one click without going through the tile landing page.
      { label: "Inspection Dashboard", icon: "pi-chart-bar", path: "/compliance/inspection-dashboard",
        nabh: true, badge: "TODAY",
        roles: [ADMIN, DR, NR, RX, PH, LB, SE, DT, WB, "Housekeeping", "MRD"] },
      { label: "NABH Registers", icon: "pi-th-large", path: "/compliance/nabh-registers",
        nabh: true, badge: "R7bo",
        roles: [ADMIN, DR, NR, RX, PH, LB, SE, DT, WB, "Housekeeping", "MRD"] },
      // NABH PRE.3 — patient satisfaction & experience feedback. Reception /
      // discharge-desk Nurse collect it or mint a patient link/QR; Admin/MRD
      // read the dashboard.
      { label: "Patient Feedback", icon: "pi-comments", path: "/patient-feedback",
        nabh: true, badge: "NEW",
        roles: [ADMIN, "MRD", RX, NR] },
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

// R7cs — pharmacy-standalone mode: collapse the sidebar to just the
// Pharmacy section regardless of role. Even Admin in a retail
// deployment shouldn't see Doctor / Nurse / Reception nav (those
// modules aren't reachable; the underlying DB collections may not
// exist). IS_PHARMACY_STANDALONE is imported at the top of file.
export function filterNav(nav, userRole) {
  // Standalone short-circuit — only the "pharmacy" section survives.
  // Applied BEFORE the role branches so it overrides every other rule.
  if (IS_PHARMACY_STANDALONE) {
    return nav
      .filter(section => section.id === "pharmacy")
      .map(section => {
        if (section.single || !section.items) return section;
        // In standalone, every role with Pharmacy access sees every
        // pharmacy item (no per-item role pruning) — keeps the chemist
        // shop's single user able to do GRN + Dispense + Settings.
        return section;
      });
  }
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
      className="hga-nav-item"
      onClick={() => navigate(item.path)}
      title={collapsed ? item.label : ""}
      style={{
        width: "100%", border: "none", cursor: "pointer",
        display: "flex", alignItems: "center",
        gap: 10, padding: collapsed ? "9px 0" : "8px 14px 8px 36px",
        justifyContent: collapsed ? "center" : "flex-start",
        background: active ? `linear-gradient(90deg, ${color}24, ${color}0a)` : "transparent",
        borderLeft: active ? `3px solid ${color}` : "3px solid transparent",
        borderRadius: "0 8px 8px 0",
        boxShadow: active ? `inset 0 0 0 1px ${color}14` : "none",
        marginBottom: 1, transition: "all .2s cubic-bezier(.4,0,.2,1)",
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
      boxShadow: "1px 0 0 #eceef3, 4px 0 24px rgba(16,24,40,.08)",
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
        background: "linear-gradient(135deg,#1e1b4b 0%,#312e81 55%,#3730a3 100%)",
        flexShrink: 0,
      }}>
        {/* R7dt — Hospital logo (from HospitalSettings.logo). Falls back
            to a gradient "S" badge if no logo configured yet. Used in
            both expanded and collapsed sidebar states so the brand
            stays consistent. The hospital uploads its logo via the
            Hospital Config wizard; once saved, it appears here +
            in the footer + on every printed bill/receipt. */}
        {!collapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {settings?.logo
              ? (
                <div style={{
                  width: 30, height: 30, borderRadius: 8, overflow: "hidden",
                  background: "#fff", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 0 1px rgba(255,255,255,.18)",
                }}>
                  <img
                    src={settings.logo}
                    alt={settings?.hospitalName || "Hospital logo"}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                  />
                </div>
              )
              : (
                <div style={{
                  width: 30, height: 30,
                  background: "linear-gradient(135deg,#38bdf8,#7c3aed)",
                  borderRadius: 8, display: "flex", alignItems: "center",
                  justifyContent: "center", fontSize: 14, fontWeight: 900, color: "#fff",
                }}>{(settings?.hospitalName || "S").charAt(0).toUpperCase()}</div>
              )
            }
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", lineHeight: 1 }}>
                {settings?.hospitalName || "Hospital"}<span style={{ color: "#38bdf8" }}> HIS</span>
              </div>
              {/* R7ce: only label the HOSPITAL as "NABH ACCREDITED" once admin
                  has entered a cert # in the wizard. Otherwise show
                  "NABH COMPLIANT" — a software-level claim that doesn't
                  misrepresent the hospital's accreditation status. */}
              <div style={{ fontSize: 9, color: "#94a3b8", letterSpacing: ".8px", marginTop: 2 }}>
                {String(settings?.nabhCertNumber || "").trim()
                  ? "NABH ACCREDITED"
                  : "NABH COMPLIANT"}
              </div>
            </div>
          </div>
        )}
        {collapsed && (
          settings?.logo
            ? (
              <div style={{
                width: 30, height: 30, borderRadius: 8, overflow: "hidden",
                background: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 0 1px rgba(255,255,255,.18)",
              }}>
                <img
                  src={settings.logo}
                  alt={settings?.hospitalName || "Hospital logo"}
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                />
              </div>
            )
            : (
              <div style={{
                width: 30, height: 30,
                background: "linear-gradient(135deg,#38bdf8,#7c3aed)",
                borderRadius: 8, display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 14, fontWeight: 900, color: "#fff",
              }}>{(settings?.hospitalName || "S").charAt(0).toUpperCase()}</div>
            )
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

      {/* ── Scrollable nav ── (R7hr-273b: sections cascade in on mount) */}
      <div className="hga-stagger" style={{
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
          {/* R7dt — Footer brand mark also uses HospitalSettings.logo
              when configured. Falls back to the role-colored shield
              icon for first-run / pre-config state. */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {settings?.logo
              ? (
                <div style={{
                  width: 20, height: 20, borderRadius: 5, overflow: "hidden",
                  background: "#fff", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: `0 0 0 1px ${roleMeta.color}30`,
                }}>
                  <img
                    src={settings.logo}
                    alt={settings?.hospitalName || "Hospital logo"}
                    style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                  />
                </div>
              )
              : (
                <div style={{
                  width: 20, height: 20, borderRadius: 5,
                  background: roleMeta.color,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <i className={`pi ${roleMeta.icon}`} style={{ fontSize: 10, color: "#fff" }} />
                </div>
              )
            }
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
