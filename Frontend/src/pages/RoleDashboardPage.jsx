/**
 * RoleDashboardPage.jsx — role-aware landing page.
 *
 * One route (/dashboard) → renders a tailored layout per user role.
 * Every role gets:
 *   - A "Good morning, <name>" hero with role badge
 *   - 4-6 KPI cards relevant to that role (live where possible)
 *   - Quick-action cards for the role's most common tasks
 *   - "Today's work" panel — pending items / alerts
 *   - Helpful links into deep workflows
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import {
  AdminPage, Hero, KPI, Card, Badge, C,
} from "../Components/admin-theme";
import { ROLES, MODULES, modulesForRole, homePathForRole } from "../config/permissions";
import AdminHome from "./AdminHome";

import { API_BASE_URL as API } from "../config/api";
const authHdr = () => ({ headers: { Authorization: `Bearer ${(sessionStorage.getItem("his_token") || localStorage.getItem("his_token"))}` } });

const fmtINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function greet() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

export default function RoleDashboardPage() {
  const { user } = useAuth();
  if (!user) return <AdminPage><div style={{ padding: 40 }}>Loading…</div></AdminPage>;
  // Single-page roles — their console is their dashboard.
  if (user.role === "Dietician")    return <Navigate to="/dietitian" replace />;
  if (user.role === "Ward Boy")     return <Navigate to="/ward-tasks" replace />;
  if (user.role === "Housekeeping") return <Navigate to="/housekeeping" replace />;

  // Admin gets the full mission-control layout (its own hero, KPIs, feed).
  if (user.role === "Admin") return <AdminHome user={user} />;

  const roleMeta = ROLES.find(r => r.key === user.role) || ROLES[0];

  // Role color name → matches Hero's color prop enum
  const ROLE_HERO_COLOR = {
    Admin: "blue", Doctor: "purple", Nurse: "pink",
    Receptionist: "teal", Pharmacist: "orange",
    "Lab Technician": "blue", Radiologist: "blue",
    Accountant: "amber", "TPA Coordinator": "purple",
    Physiotherapist: "green", Dietician: "green",
    "Ward Boy": "teal", Housekeeping: "teal", Security: "amber",
  };

  const heroColor = ROLE_HERO_COLOR[user.role] || "blue";
  const name = user.fullName || `${user.firstName || ""} ${user.lastName || ""}`.trim() || "there";
  const firstName = (user.firstName || name.split(" ")[0] || "there").trim();

  return (
    <AdminPage>
      <Hero icon={roleMeta.icon} color={heroColor}
        title={`${greet()}, ${firstName}`}
        subtitle={`${roleMeta.label} workspace · ${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}`}
        right={<RoleBadge role={user.role} />} />

      {user.role === "Doctor"            && <DoctorDashboard user={user} />}
      {user.role === "Nurse"             && <NurseDashboard user={user} />}
      {user.role === "Receptionist"      && <ReceptionDashboard user={user} />}
      {user.role === "Pharmacist"        && <PharmacistDashboard user={user} />}
      {user.role === "Lab Technician"    && <LabDashboard user={user} role="Lab Technician" />}
      {user.role === "Radiologist"       && <LabDashboard user={user} role="Radiologist" />}
      {user.role === "Accountant"        && <AccountantDashboard user={user} />}
      {user.role === "TPA Coordinator"   && <TPADashboard user={user} />}
      {(user.role === "Ward Boy" || user.role === "Housekeeping") && <WardOpsDashboard user={user} role={user.role} />}
      {user.role === "Security"          && <SecurityDashboard user={user} />}
      {(user.role === "Dietician" || user.role === "Physiotherapist") && <CareTeamDashboard user={user} role={user.role} />}
    </AdminPage>
  );
}

function RoleBadge({ role }) {
  const meta = ROLES.find(r => r.key === role);
  if (!meta) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 7,
      padding: "5px 12px", borderRadius: 999,
      background: "rgba(255,255,255,.2)", color: "#fff",
      border: "1.5px solid rgba(255,255,255,.4)",
      fontSize: 11.5, fontWeight: 800, letterSpacing: ".3px",
    }}>
      <i className={`pi ${meta.icon}`} style={{ fontSize: 11 }} />
      {meta.label}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────
   Reusable building blocks for every role's dashboard
──────────────────────────────────────────────────────────────── */
function QuickAction({ icon, label, sub, onClick, color }) {
  return (
    <button onClick={onClick}
      style={{
        background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 12,
        padding: "16px 18px", textAlign: "left", cursor: "pointer",
        boxShadow: "0 1px 3px rgba(15,23,42,.04)",
        display: "flex", alignItems: "center", gap: 14,
        transition: "all .15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 6px 18px ${color}25`; e.currentTarget.style.borderColor = color + "55"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(15,23,42,.04)"; e.currentTarget.style.borderColor = C.border; }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12,
        background: color + "15", color, display: "flex",
        alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <i className={`pi ${icon}`} style={{ fontSize: 18 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 13.5, color: C.text }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{sub}</div>}
      </div>
      <i className="pi pi-arrow-right" style={{ fontSize: 13, color: C.muted, flexShrink: 0 }} />
    </button>
  );
}

function QuickActionsGrid({ items }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
      {items.map((it, i) => <QuickAction key={i} {...it} />)}
    </div>
  );
}

function AccessSnapshot({ role }) {
  const navigate = useNavigate();
  const mods = modulesForRole(role).slice(0, 8);
  return (
    <Card title="Your modules" color={C.slate} icon="pi-th-large">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        {mods.map(m => (
          <button key={m.id} onClick={() => navigate(m.home)}
            style={{
              padding: "10px 14px", borderRadius: 9,
              background: m.color + "10", border: `1.5px solid ${m.color}30`,
              color: m.color, fontSize: 12, fontWeight: 800,
              cursor: "pointer", textAlign: "left",
              display: "flex", alignItems: "center", gap: 9,
            }}>
            <i className={`pi ${m.icon}`} style={{ fontSize: 13 }} />
            {m.label}
          </button>
        ))}
      </div>
    </Card>
  );
}

/* ════════════════════════════════════════════════════════════════
   ADMIN
══════════════════════════════════════════════════════════════════ */
function AdminDashboard({ user }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState({});
  useEffect(() => {
    // AbortController guards against React's "setState on unmounted
    // component" warning when the user navigates away mid-fetch
    // (audit E-05). Aborted axios calls reject with an error caught
    // by the outer try; we check `ac.signal.aborted` before setState
    // so a stale response can't poison fresh state if the parallel
    // requests resolve in a surprising order.
    const ac = new AbortController();
    (async () => {
      try {
        const [u, p] = await Promise.all([
          axios.get(`${API}/users?limit=1`, { ...authHdr(), signal: ac.signal }).catch(() => null),
          axios.get(`${API}/pharmacy/stats`, { ...authHdr(), signal: ac.signal }).catch(() => null),
        ]);
        if (ac.signal.aborted) return;
        setStats({
          users: u?.data?.total ?? u?.data?.data?.length ?? "—",
          pharmacyRevenueToday: p?.data?.data?.todaySales?.net ?? null,
          pharmacyMonthRevenue: p?.data?.data?.monthSales?.net ?? null,
          drugsCount: p?.data?.data?.drugsCount ?? null,
          expiringCount: p?.data?.data?.expiringWithin90Days ?? null,
        });
      } catch (e) {
        if (!axios.isCancel(e)) console.error("[AdminDashboard] stats fetch:", e?.message);
      }
    })();
    return () => ac.abort();
  }, []);
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Staff users"        value={stats.users || "—"}              color={C.blue}   icon="pi-users" />
        <KPI label="Pharmacy today"     value={stats.pharmacyRevenueToday != null ? fmtINR(stats.pharmacyRevenueToday) : "—"} color={C.green}  icon="pi-receipt" />
        <KPI label="Pharmacy MTD"       value={stats.pharmacyMonthRevenue != null ? fmtINR(stats.pharmacyMonthRevenue) : "—"} color={C.amber}  icon="pi-chart-line" />
        <KPI label="Drug catalogue"     value={stats.drugsCount ?? "—"}         color={C.purple} icon="pi-box" />
        <KPI label="Expiring (90d)"     value={stats.expiringCount ?? "—"}      color={C.red}    icon="pi-exclamation-triangle" />
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Card title="Quick actions" color={C.blue} icon="pi-bolt">
          <QuickActionsGrid items={[
            { icon: "pi-building",   label: "Hospital Settings",   sub: "Identity · Print · Legal · Bank",         color: C.blue,    onClick: () => navigate("/hospital-settings") },
            { icon: "pi-users",      label: "User Management",      sub: "Onboard staff · reset passwords",        color: C.teal,    onClick: () => navigate("/admin/users") },
            { icon: "pi-shield",     label: "Roles & Permissions",  sub: "See what every role can access",         color: C.purple,  onClick: () => navigate("/admin/roles") },
            { icon: "pi-sitemap",    label: "Departments",          sub: "Hospital departments + services",        color: C.orange,  onClick: () => navigate("/department") },
            { icon: "pi-user-edit",  label: "Doctor Master",        sub: "Consultants, specialisations",           color: C.purple,  onClick: () => navigate("/doctors") },
            { icon: "pi-dollar",     label: "Hospital Charges",     sub: "TPA tariff sheets",                      color: C.amber,   onClick: () => navigate("/hospital-charges") },
            { icon: "pi-chart-bar",  label: "Reports",              sub: "Operational + financial",                color: C.green,   onClick: () => navigate("/billing-audit-trail") },
            { icon: "pi-print",      label: "Print Gallery",        sub: "Preview every printable",                color: C.pink,    onClick: () => navigate("/print-gallery") },
          ]} />
        </Card>
        <AccessSnapshot role={user.role} />
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   DOCTOR
══════════════════════════════════════════════════════════════════ */
function DoctorDashboard({ user }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState({});
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [opd, adm] = await Promise.all([
          axios.get(`${API}/opd?from=${today}&to=${today}`, { ...authHdr(), signal: ac.signal }).catch(() => null),
          // IPD-only: Admission collection also stores OPD / Day-Care
          // stubs, so without hasBed=true the count over-reports IPD.
          axios.get(`${API}/admissions/active?hasBed=true`, { ...authHdr(), signal: ac.signal }).catch(() => null),
        ]);
        if (ac.signal.aborted) return;
        setStats({
          opdToday: opd?.data?.data?.length ?? opd?.data?.length ?? "—",
          ipdActive: adm?.data?.data?.length ?? adm?.data?.length ?? "—",
        });
      } catch (e) {
        if (!axios.isCancel(e)) console.error("[DoctorDashboard] stats fetch:", e?.message);
      }
    })();
    return () => ac.abort();
  }, []);
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="OPD today"        value={stats.opdToday}   color={C.purple} icon="pi-user-edit" />
        <KPI label="Active IPD"       value={stats.ipdActive}  color={C.blue}   icon="pi-home" />
        <KPI label="Pending Rx"       value="—"                color={C.amber}  icon="pi-pen-to-square" />
        <KPI label="Lab results"      value="—"                color={C.teal}   icon="pi-search-plus" />
        <KPI label="Discharges due"   value="—"                color={C.red}    icon="pi-sign-out" />
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Card title="Quick actions" color={C.purple} icon="pi-bolt">
          <QuickActionsGrid items={[
            { icon: "pi-user-edit",  label: "OPD Panel",        sub: "Live OPD queue + assessment",            color: C.purple, onClick: () => navigate("/doctor-opd-panel") },
            { icon: "pi-search",     label: "Patient Search",   sub: "Find any patient · view full file",      color: C.blue,   onClick: () => navigate("/patient-search") },
            { icon: "pi-th-large",   label: "Bed View",         sub: "Walk the wards · IPD census",            color: C.teal,   onClick: () => navigate("/bed-visual") },
            { icon: "pi-pen-to-square",label: "Doctor Orders",  sub: "Investigation orders · drug orders",     color: C.amber,  onClick: () => navigate("/investigation-orders") },
            { icon: "pi-file-edit",  label: "Discharge Summary",sub: "Finalize discharge",                     color: C.red,    onClick: () => navigate("/discharge-summary") },
            { icon: "pi-receipt",    label: "Doctor Notes",     sub: "Daily progress · certificates",          color: C.green,  onClick: () => navigate("/doctor-notes") },
            { icon: "pi-box",        label: "Pharmacy",         sub: "Drug search · in-house stock",           color: C.orange, onClick: () => navigate("/pharmacy") },
            { icon: "pi-flag",       label: "MLC Register",     sub: "Medico-legal cases",                     color: C.red,    onClick: () => navigate("/mlc") },
          ]} />
        </Card>
        <AccessSnapshot role={user.role} />
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   NURSE
══════════════════════════════════════════════════════════════════ */
function NurseDashboard({ user }) {
  const navigate = useNavigate();
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="My ward patients" value="—" color={C.pink}   icon="pi-heart" />
        <KPI label="Vitals due"       value="—" color={C.red}    icon="pi-clock" />
        <KPI label="MAR doses today"  value="—" color={C.purple} icon="pi-pen-to-square" />
        <KPI label="Notes pending"    value="—" color={C.amber}  icon="pi-file-edit" />
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Card title="Quick actions" color={C.pink} icon="pi-bolt">
          <QuickActionsGrid items={[
            { icon: "pi-clipboard",     label: "OPD Queue",            sub: "Current patient queue",          color: C.teal,    onClick: () => navigate("/opd-queue") },
            { icon: "pi-th-large",      label: "Bed View",             sub: "Walk wards · IPD census",        color: C.blue,    onClick: () => navigate("/bed-visual") },
            { icon: "pi-pen-to-square", label: "Update Vitals",        sub: "Record BP / pulse / temp / SpO2",color: C.red,     onClick: () => navigate("/updateVitalSheet") },
            { icon: "pi-list",          label: "Vital Sheet",          sub: "Patient-wise trends",            color: C.blue,    onClick: () => navigate("/vitalSheet") },
            { icon: "pi-pen-to-square", label: "MAR Sheet",            sub: "Medication administration",      color: C.purple,  onClick: () => navigate("/mar") },
            { icon: "pi-file-edit",     label: "Nursing Notes",        sub: "Daily nursing notes",            color: C.pink,    onClick: () => navigate("/nursing-notes") },
            { icon: "pi-arrow-right-arrow-left", label: "Handover Notes", sub: "Shift handover", color: C.amber, onClick: () => navigate("/nursing-handover-notes") },
            { icon: "pi-shield",        label: "Pressure Care",        sub: "Bedsore assessment",             color: C.green,   onClick: () => navigate("/pressure-area-care") },
          ]} />
        </Card>
        <AccessSnapshot role={user.role} />
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   RECEPTION
══════════════════════════════════════════════════════════════════ */
function ReceptionDashboard({ user }) {
  const navigate = useNavigate();
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Registrations today"    value="—" color={C.teal}    icon="pi-user-plus" />
        <KPI label="OPD visits"             value="—" color={C.purple}  icon="pi-user-edit" />
        <KPI label="Active admissions"      value="—" color={C.blue}    icon="pi-home" />
        <KPI label="Discharges today"       value="—" color={C.green}   icon="pi-sign-out" />
        <KPI label="Visitor passes issued"  value="—" color={C.amber}   icon="pi-id-card" />
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Card title="Quick actions" color={C.teal} icon="pi-bolt">
          <QuickActionsGrid items={[
            { icon: "pi-user-plus",  label: "New Registration",   sub: "Walk-in registration",          color: C.teal,    onClick: () => navigate("/reception/register") },
            { icon: "pi-user-edit",  label: "OPD Admission",      sub: "Create OPD visit",              color: C.purple,  onClick: () => navigate("/reception") },
            { icon: "pi-home",       label: "IPD Admission",      sub: "Bed assignment + admission",    color: C.blue,    onClick: () => navigate("/bed-visual") },
            { icon: "pi-search",     label: "Patient Search",     sub: "Find by UHID / name / phone",   color: C.amber,   onClick: () => navigate("/patient-search") },
            { icon: "pi-sign-out",   label: "Discharge Queue",    sub: "Bills + clearance",             color: C.green,   onClick: () => navigate("/discharge-queue") },
            { icon: "pi-id-card",    label: "Visitor Pass",       sub: "Issue attendant pass",          color: C.amber,   onClick: () => navigate("/visitor-passes") },
            { icon: "pi-receipt",    label: "Billing",            sub: "Generate bill · payment",       color: C.amber,   onClick: () => navigate("/billing") },
            { icon: "pi-briefcase",  label: "TPA / Cashless",     sub: "Pre-auth + claim",              color: C.purple,  onClick: () => navigate("/tpa-cases") },
          ]} />
        </Card>
        <AccessSnapshot role={user.role} />
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   PHARMACIST
══════════════════════════════════════════════════════════════════ */
function PharmacistDashboard({ user }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState({});
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const r = await axios.get(`${API}/pharmacy/stats`, { ...authHdr(), signal: ac.signal });
        if (ac.signal.aborted) return;
        setStats(r.data?.data || {});
      } catch (e) {
        if (!axios.isCancel(e)) console.error("[PharmacistDashboard] stats fetch:", e?.message);
      }
    })();
    return () => ac.abort();
  }, []);
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Drug catalogue"     value={stats.drugsCount ?? "—"}            color={C.orange} icon="pi-box" />
        <KPI label="Active batches"     value={stats.batchesInStock ?? "—"}        color={C.blue}   icon="pi-database" />
        <KPI label="Today sales"        value={stats.todaySales ? `${stats.todaySales.count} · ${fmtINR(stats.todaySales.net)}` : "—"} color={C.green} icon="pi-receipt" />
        <KPI label="Stock value"        value={stats.stockValue != null ? fmtINR(stats.stockValue) : "—"} color={C.purple} icon="pi-money-bill" />
        <KPI label="Expiring 90d"       value={stats.expiringWithin90Days ?? "—"}  color={C.amber}  icon="pi-clock" />
        <KPI label="Already expired"    value={stats.alreadyExpired ?? "—"}        color={C.red}    icon="pi-exclamation-triangle" />
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Card title="Quick actions" color={C.orange} icon="pi-bolt">
          <QuickActionsGrid items={[
            { icon: "pi-shopping-cart", label: "New Dispense",     sub: "Walk-in / OPD / IPD sale",       color: C.green,   onClick: () => navigate("/pharmacy?tab=dispense") },
            { icon: "pi-download",      label: "Record GRN",       sub: "Goods receipt note",             color: C.purple,  onClick: () => navigate("/pharmacy?tab=grn") },
            { icon: "pi-receipt",       label: "Sales Register",   sub: "All bills · returns · add items",color: C.amber,   onClick: () => navigate("/pharmacy?tab=sales") },
            { icon: "pi-box",           label: "Inventory",        sub: "Live stock rollup",              color: C.blue,    onClick: () => navigate("/pharmacy?tab=inventory") },
            { icon: "pi-book",          label: "Registers",        sub: "Sales / Stock / Sch H / GST",    color: C.teal,    onClick: () => navigate("/pharmacy?tab=registers") },
            { icon: "pi-list",          label: "Drug Master",      sub: "Add new drug · update",          color: C.orange,  onClick: () => navigate("/pharmacy?tab=drugs") },
            { icon: "pi-truck",         label: "Suppliers",        sub: "Manage vendor master",           color: C.amber,   onClick: () => navigate("/pharmacy?tab=suppliers") },
            { icon: "pi-cog",           label: "Pharmacy Settings",sub: "Print template · register style",color: C.muted,   onClick: () => navigate("/pharmacy?tab=settings") },
          ]} />
        </Card>
        <AccessSnapshot role={user.role} />
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   LAB TECH / RADIOLOGIST
══════════════════════════════════════════════════════════════════ */
function LabDashboard({ user, role }) {
  const navigate = useNavigate();
  const isRad = role === "Radiologist";
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label={isRad ? "Imaging orders" : "Lab orders"} value="—" color={C.blue}   icon="pi-list" />
        <KPI label="Samples / studies"       value="—" color={C.purple} icon="pi-search-plus" />
        <KPI label="Reports pending"         value="—" color={C.amber}  icon="pi-file-edit" />
        <KPI label="Verified today"          value="—" color={C.green}  icon="pi-check-circle" />
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Card title="Quick actions" color={C.blue} icon="pi-bolt">
          <QuickActionsGrid items={[
            { icon: "pi-list",         label: "Investigation Orders", sub: "All open requests",         color: C.blue,    onClick: () => navigate("/investigation-orders") },
            { icon: "pi-flask",        label: "Test Master",          sub: "Tests catalogue + setup",   color: C.purple,  onClick: () => navigate("/investigation-master") },
            { icon: "pi-pen-to-square",label: "Result Entry",         sub: "Enter & verify results",    color: C.green,   onClick: () => navigate("/investigation-orders") },
            { icon: "pi-print",        label: "Dispatch Reports",     sub: "Print + share with patient",color: C.amber,   onClick: () => navigate("/investigation-orders") },
          ]} />
        </Card>
        <AccessSnapshot role={user.role} />
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   ACCOUNTANT
══════════════════════════════════════════════════════════════════ */
function AccountantDashboard({ user }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState({});
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const r = await axios.get(`${API}/billing/collection-summary?date=${today}`, { ...authHdr(), signal: ac.signal });
        if (ac.signal.aborted) return;
        const s = r.data?.summary || {};
        setStats({
          collected: s.totalCollected,
          gross:     s.totalGross,
          outstand:  s.totalPending,
          tpaPend:   s.tpaPending,
          txns:      s.txnCount,
          advance:   s.advanceDue,
        });
      } catch (e) {
        if (!axios.isCancel(e)) console.error("[AccountantDashboard] stats fetch:", e?.message);
      }
    })();
    return () => ac.abort();
  }, []);
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Today's collection"  value={stats.collected != null ? fmtINR(stats.collected) : "—"} color={C.green}  icon="pi-money-bill" />
        <KPI label="Today's gross"       value={stats.gross != null ? fmtINR(stats.gross) : "—"}        color={C.blue}   icon="pi-receipt" />
        <KPI label="Outstanding today"   value={stats.outstand != null ? fmtINR(stats.outstand) : "—"} color={C.red}    icon="pi-clock" />
        <KPI label="TPA pending"         value={stats.tpaPend != null ? fmtINR(stats.tpaPend) : "—"}   color={C.purple} icon="pi-briefcase" />
        <KPI label="IPD advance due"     value={stats.advance != null ? fmtINR(stats.advance) : "—"}   color={C.amber}  icon="pi-home" />
        <KPI label="Transactions"        value={stats.txns ?? "—"}                                      color={C.teal}   icon="pi-list" />
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Card title="Quick actions" color={C.amber} icon="pi-bolt">
          <QuickActionsGrid items={[
            { icon: "pi-book",         label: "Day Book",          sub: "Today's collection by mode / visit / doctor", color: C.amber,   onClick: () => navigate("/accounts?tab=daybook") },
            { icon: "pi-chart-line",   label: "Revenue (MTD)",     sub: "Hospital + pharmacy month-to-date",           color: C.green,   onClick: () => navigate("/accounts?tab=revenue") },
            { icon: "pi-percentage",   label: "GST Returns",       sub: "CGST / SGST / IGST bucket-wise",              color: C.purple,  onClick: () => navigate("/accounts?tab=gst") },
            { icon: "pi-clock",        label: "Outstanding",       sub: "TPA pending · IPD advance",                   color: C.teal,    onClick: () => navigate("/accounts?tab=outstanding") },
            { icon: "pi-undo",         label: "Refunds & Cancels", sub: "Process / review refund queue",               color: C.red,     onClick: () => navigate("/accounts?tab=refunds") },
            { icon: "pi-receipt",      label: "Generate Bill",     sub: "Patient bill · payment recording",            color: C.blue,    onClick: () => navigate("/billing") },
            { icon: "pi-briefcase",    label: "TPA / Cashless",    sub: "Insurance claims",                            color: C.purple,  onClick: () => navigate("/tpa-cases") },
            { icon: "pi-shield",       label: "Audit Trail",       sub: "Every billing action logged",                 color: C.teal,    onClick: () => navigate("/billing-audit-trail") },
          ]} />
        </Card>
        <AccessSnapshot role={user.role} />
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   TPA / CASHLESS COORDINATOR
══════════════════════════════════════════════════════════════════ */
function TPADashboard({ user }) {
  const navigate = useNavigate();
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Open cases"           value="—" color={C.purple} icon="pi-briefcase" />
        <KPI label="Pre-auth pending"     value="—" color={C.amber}  icon="pi-send" />
        <KPI label="Approved this month"  value="—" color={C.green}  icon="pi-check-circle" />
        <KPI label="Awaiting documents"   value="—" color={C.red}    icon="pi-exclamation-circle" />
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Card title="Quick actions" color={C.purple} icon="pi-bolt">
          <QuickActionsGrid items={[
            { icon: "pi-briefcase",    label: "TPA Cases",       sub: "All cashless cases",            color: C.purple,  onClick: () => navigate("/tpa-cases") },
            { icon: "pi-send",         label: "New Pre-Auth",    sub: "Send to TPA",                   color: C.amber,   onClick: () => navigate("/addtpa") },
            { icon: "pi-receipt",      label: "Claim Files",     sub: "File final bill claim",         color: C.blue,    onClick: () => navigate("/tpa-cases") },
            { icon: "pi-dollar",       label: "Hospital Charges",sub: "TPA tariff sheets",             color: C.green,   onClick: () => navigate("/hospital-charges") },
          ]} />
        </Card>
        <AccessSnapshot role={user.role} />
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   WARD BOY / HOUSEKEEPING
══════════════════════════════════════════════════════════════════ */
function WardOpsDashboard({ user, role }) {
  const navigate = useNavigate();
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Active beds"       value="—" color={C.blue}    icon="pi-th-large" />
        <KPI label="Pending turnovers" value="—" color={C.amber}   icon="pi-clock" />
        <KPI label="Cleaning due"      value="—" color={C.teal}    icon="pi-refresh" />
        <KPI label="Equipment alerts"  value="—" color={C.red}     icon="pi-exclamation-triangle" />
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Card title="Quick actions" color={C.teal} icon="pi-bolt">
          <QuickActionsGrid items={[
            { icon: "pi-th-large",      label: "Bed View",         sub: "All beds · status",       color: C.blue,   onClick: () => navigate("/bed-visual") },
            { icon: "pi-refresh",       label: "Mark turnover",    sub: "Room cleaned + ready",    color: C.teal,   onClick: () => navigate("/bed-visual") },
            { icon: "pi-wrench",        label: "Maintenance",      sub: "Equipment / facilities",  color: C.amber,  onClick: () => navigate("/maintenance") },
          ]} />
        </Card>
        <AccessSnapshot role={user.role} />
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   SECURITY
══════════════════════════════════════════════════════════════════ */
function SecurityDashboard({ user }) {
  const navigate = useNavigate();
  const [passStats, setPassStats] = useState(null);
  const [gateStats, setGateStats] = useState(null);
  const [incStats,  setIncStats]  = useState(null);

  // Auto-refresh every 60s. Three small fetches in parallel — each one's
  // failure (e.g. permission-not-granted) keeps the others' numbers live.
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      const [pass, gate, inc] = await Promise.all([
        axios.get(`${API}/visitor-passes/stats`, authHdr()).then((r) => r.data?.data).catch(() => null),
        axios.get(`${API}/gate-log/stats`,       authHdr()).then((r) => r.data?.data).catch(() => null),
        axios.get(`${API}/incidents/stats`,      authHdr()).then((r) => r.data?.data).catch(() => null),
      ]);
      if (cancelled) return;
      if (pass) setPassStats(pass);
      if (gate) setGateStats(gate);
      if (inc)  setIncStats(inc);
    };
    fetchAll();
    const i = setInterval(fetchAll, 60000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  const v = (obj, key) => (obj == null ? "—" : obj?.[key] ?? 0);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Passes today"     value={v(passStats, "passesToday")}     color={C.amber}  icon="pi-id-card" />
        <KPI label="Active visitors"  value={v(passStats, "activeVisitors")}  color={C.blue}   icon="pi-users" />
        <KPI label="Expired passes"   value={v(passStats, "expiredPasses")}   color={C.muted}  icon="pi-times-circle" />
        <KPI label="Gate — today In"  value={v(gateStats, "todayIn")}         color={C.green}  icon="pi-sign-in" />
        <KPI label="Gate — today Out" value={v(gateStats, "todayOut")}        color={C.amber}  icon="pi-sign-out" />
        <KPI label="Open incidents"   value={v(incStats,  "openCount")}       color={C.red}    icon="pi-exclamation-triangle" />
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Card title="Quick actions" color={C.amber} icon="pi-bolt">
          <QuickActionsGrid items={[
            { icon: "pi-id-card",             label: "Visitor passes",   sub: "Issue / verify attendant pass",            color: C.amber, onClick: () => navigate("/visitor-passes") },
            { icon: "pi-shield",              label: "Gate log",         sub: "Log every entry / exit",                    color: C.green, onClick: () => navigate("/gate-log") },
            { icon: "pi-exclamation-triangle",label: "Incident reports", sub: "Theft / fire / disturbance — full audit",   color: C.red,   onClick: () => navigate("/incidents") },
          ]} />
        </Card>
        <AccessSnapshot role={user.role} />
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════
   DIETICIAN / PHYSIOTHERAPIST
══════════════════════════════════════════════════════════════════ */
function CareTeamDashboard({ user, role }) {
  const navigate = useNavigate();
  const isDietician = role === "Dietician";
  const [stats, setStats] = useState({});
  useEffect(() => {
    if (!isDietician) return;
    (async () => {
      try {
        const r = await axios.get(`${API}/dietitian/stats`, authHdr());
        setStats(r.data?.data || {});
      } catch {}
    })();
  }, [isDietician]);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        {isDietician ? (
          <>
            <KPI label="Active diet plans"  value={stats.activePlans ?? "—"}      color={C.green}  icon="pi-check-circle" />
            <KPI label="Plans created today" value={stats.plansToday ?? "—"}       color={C.blue}   icon="pi-plus-circle" />
            <KPI label="Follow-ups due"     value={stats.pendingFollowUps ?? "—"} color={C.amber}  icon="pi-clock" />
            <KPI label="Templates"          value={stats.totalTemplates ?? "—"}   color={C.teal}   icon="pi-book" />
          </>
        ) : (
          <>
            <KPI label="Today's plans"      value="—" color={C.green}  icon="pi-list" />
            <KPI label="Sessions completed" value="—" color={C.teal}   icon="pi-check-circle" />
            <KPI label="Pending consults"   value="—" color={C.amber}  icon="pi-clock" />
          </>
        )}
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Card title="Quick actions" color={C.green} icon="pi-bolt">
          <QuickActionsGrid items={isDietician ? [
            { icon: "pi-users",         label: "Referred Patients",   sub: "Active IPD + OPD diet-referrals",   color: C.green,  onClick: () => navigate("/dietitian?tab=patients") },
            { icon: "pi-pen-to-square", label: "Assessment & Plan",   sub: "Nutritional assessment + plan",     color: C.blue,   onClick: () => navigate("/dietitian?tab=assessment") },
            { icon: "pi-book",          label: "Diet Plan Library",   sub: "17 ready templates by condition",   color: C.purple, onClick: () => navigate("/dietitian?tab=library") },
            { icon: "pi-th-large",      label: "Bed View",            sub: "IPD census",                        color: C.teal,   onClick: () => navigate("/bed-visual") },
          ] : [
            { icon: "pi-pen-to-square", label: "Patient assessment",  sub: "Initial / follow-up notes",         color: C.green,  onClick: () => navigate("/updateVitalSheet") },
            { icon: "pi-list",          label: "Patient list",         sub: "Active care plans",                color: C.blue,   onClick: () => navigate("/vitalSheet") },
            { icon: "pi-th-large",      label: "Ward rounds",          sub: "IPD census",                       color: C.teal,   onClick: () => navigate("/bed-visual") },
          ]} />
        </Card>
        <AccessSnapshot role={user.role} />
      </div>
    </>
  );
}
