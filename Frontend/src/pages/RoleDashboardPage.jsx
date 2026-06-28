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
import { useHospitalSettings } from "../context/HospitalSettingsContext";
import {
  AdminPage, Hero, KPI, Card, Badge, C,
} from "../Components/admin-theme";
import { Typewriter, Ticker } from "../Components/anim/AnimKit"; // R7hr-276
import { ROLES, MODULES, modulesForRole, homePathForRole } from "../config/permissions";
import AdminHome from "./AdminHome";
import { useVisiblePoll } from "../utils/pollingHelpers";

import { API_BASE_URL as API } from "../config/api";
// R7bh-F9 / R7bg-10-HIGH-6 — token reads are sessionStorage-only.
const authHdr = () => ({ headers: { Authorization: `Bearer ${sessionStorage.getItem("his_token") || ""}` } });

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
  const { settings } = useHospitalSettings();
  if (!user) return <AdminPage><div style={{ padding: 40 }}>Loading…</div></AdminPage>;
  // Single-page roles — their console is their dashboard.
  if (user.role === "Dietician")    return <Navigate to="/dietitian" replace />;
  if (user.role === "Ward Boy")     return <Navigate to="/ward-tasks" replace />;
  if (user.role === "Housekeeping") return <Navigate to="/housekeeping" replace />;
  // R7bb-E/D5-CRIT-3 — MRD lands on the discharged-patient archive
  // (their primary surface). Previously their landing was the generic
  // RoleDashboardPage that had no MRD branch and rendered a blank hero.
  if (user.role === "MRD")          return <Navigate to="/medical-records/discharges" replace />;

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
      <Hero icon={roleMeta.icon} color={heroColor} logo={settings?.logo || "/bims-logo.png"}
        title={<Typewriter text={`${greet()}, ${firstName}`} speed={42} />}
        subtitle={`${roleMeta.label} workspace · ${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}`}
        right={<RoleBadge role={user.role} />} />

      {/* R7hr-276 — live ticker, on every role's dashboard */}
      <Ticker
        items={[
          `${roleMeta.label} workspace`,
          new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }),
          "SphereHealth HIS · NABH compliant",
          "Tip: use the mic button (bottom-right) to dictate clinical notes",
        ]}
        style={{ background: "#0f172a", color: "#e2e8f0", borderRadius: 10, padding: "7px 0", margin: "0 0 14px", fontSize: 12.5 }}
      />

      {user.role === "Doctor"            && <DoctorDashboard user={user} />}
      {user.role === "Nurse"             && <NurseDashboard user={user} />}
      {user.role === "Receptionist"      && <ReceptionDashboard user={user} />}
      {user.role === "Pharmacist"        && <PharmacistDashboard user={user} />}
      {user.role === "Lab Technician"    && <LabDashboard user={user} role="Lab Technician" />}
      {user.role === "Radiologist"       && <LabDashboard user={user} role="Radiologist" />}
      {user.role === "Accountant"        && <AccountantDashboard user={user} />}
      {user.role === "TPA Coordinator"   && <TPADashboard user={user} />}
      {/* Ward Boy / Housekeeping never reach here — they redirect to /ward-tasks
          and /housekeeping at the top of this component (R7hr-313). */}
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
        boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 4px 12px rgba(16,24,40,.06)",
        display: "flex", alignItems: "center", gap: 14,
        transition: "all .15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 6px 18px ${color}25`; e.currentTarget.style.borderColor = color + "55"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 1px 2px rgba(16,24,40,.04), 0 4px 12px rgba(16,24,40,.06)"; e.currentTarget.style.borderColor = C.border; }}>
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
    <div className="hga-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
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

/* Admin lands on the full AdminHome mission-control (see line ~51). The old
   AdminDashboard component here was never rendered and was removed (R7hr-313). */

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
      <div className="hga-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
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
      <div className="hga-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
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
            { icon: "pi-pen-to-square", label: "Update Vitals",        sub: "Record BP / pulse / temp / SpO2",color: C.red,     onClick: () => navigate("/vitalSheet") },
            { icon: "pi-list",          label: "Vital Sheet",          sub: "Patient-wise trends",            color: C.blue,    onClick: () => navigate("/vitalSheet") },
            { icon: "pi-chart-bar",     label: "MAR Sheet",            sub: "Treatment Chart — Live MAR",     color: C.purple,  onClick: () => navigate("/nursing-notes?tile=mar") },
            { icon: "pi-file-edit",     label: "Nursing Notes",        sub: "Daily nursing notes",            color: C.pink,    onClick: () => navigate("/nursing-notes") },
            { icon: "pi-arrow-right-arrow-left", label: "Handover Notes", sub: "Shift / SBAR / bed-transfer handover", color: C.amber, onClick: () => navigate("/nurse-patient-panel?tab=handover") },
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
      <div className="hga-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
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
            { icon: "pi-user-edit",  label: "OPD Admission",      sub: "Create OPD visit",              color: C.purple,  onClick: () => navigate("/reception/register") },
            { icon: "pi-home",       label: "IPD Admission",      sub: "Bed assignment + admission",    color: C.blue,    onClick: () => navigate("/bed-visual") },
            { icon: "pi-search",     label: "Patient Search",     sub: "Find by UHID / name / phone",   color: C.amber,   onClick: () => navigate("/patient-search") },
            { icon: "pi-sign-out",   label: "Discharge Queue",    sub: "Bills + clearance",             color: C.green,   onClick: () => navigate("/discharge-queue") },
            { icon: "pi-id-card",    label: "Visitor Pass",       sub: "Issue attendant pass",          color: C.amber,   onClick: () => navigate("/visitor-passes") },
            { icon: "pi-receipt",    label: "Billing",            sub: "Generate bill · payment",       color: C.amber,   onClick: () => navigate("/reception-billing") },
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
      <div className="hga-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 14 }}>
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
      {/* R7bb-E/D6-CRIT-2 — Radiologist has no end-to-end workflow yet
          (imaging reporting + dispatch surface is not built). They can
          read imaging orders (lab.records.read) but the rest of the
          tiles are placeholders. Show an honest "coming soon" banner so
          the user knows what's live vs scaffolded. */}
      {isRad && (
        <div style={{
          padding: "12px 16px", marginBottom: 14, borderRadius: 10,
          background: "#eef2ff", border: "1.5px solid #c7d2fe",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <i className="pi pi-info-circle" style={{ fontSize: 18, color: "#4f46e5" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#3730a3" }}>
              Radiology reporting workspace — coming soon
            </div>
            <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
              You can read imaging orders &amp; reports today via Investigation Orders. The
              dictate-and-sign reporting surface ships in the next release.
            </div>
          </div>
        </div>
      )}

      <div className="hga-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
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
            { icon: "pi-pen-to-square",label: "Result Entry",         sub: "Enter & verify results",    color: C.green,   onClick: () => navigate("/investigation-orders?status=SAMPLE_COLLECTED") },
            { icon: "pi-print",        label: "Dispatch Reports",     sub: "Print + share with patient",color: C.amber,   onClick: () => navigate("/investigation-orders?status=COMPLETED") },
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
        // R7bh-F1 / META-4 (R7bg-6-CRIT-5): the legacy /billing/
        // collection-summary aggregator missed the reversed-refund
        // cash-back leg. We now fire BOTH endpoints in parallel —
        // the new /api/reports/day-book (dayBookService, A6-CRIT-6
        // compliant) supplies the corrected `collections` total
        // (which already nets reversed refunds back IN), while the
        // legacy endpoint still supplies fields the day-book service
        // doesn't expose (totalGross / totalPending / tpaPending /
        // advanceDue / byVisitType / byDoctor). The day-book figure
        // wins for `collected` + `txns`; everything else falls back
        // to the legacy summary.
        const [dayBookR, legacyR] = await Promise.allSettled([
          axios.get(`${API}/reports/day-book?date=${today}`, { ...authHdr(), signal: ac.signal }),
          axios.get(`${API}/billing/collection-summary?date=${today}`, { ...authHdr(), signal: ac.signal }),
        ]);
        if (ac.signal.aborted) return;
        const db = dayBookR.status === "fulfilled" ? (dayBookR.value.data?.data?.summary || {}) : {};
        const ls = legacyR.status === "fulfilled" ? (legacyR.value.data?.summary    || {}) : {};
        setStats({
          // Prefer day-book's reversal-aware figure; fall back to legacy.
          collected: db.collections   ?? ls.totalCollected,
          gross:     ls.totalGross,
          outstand:  ls.totalPending,
          tpaPend:   ls.tpaPending,
          txns:      db.collectionsCount ?? ls.txnCount,
          advance:   ls.advanceDue,
        });
      } catch (e) {
        if (!axios.isCancel(e)) console.error("[AccountantDashboard] stats fetch:", e?.message);
      }
    })();
    return () => ac.abort();
  }, []);
  return (
    <>
      <div className="hga-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
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
            { icon: "pi-receipt",      label: "Generate Bill",     sub: "Patient bill · payment recording",            color: C.blue,    onClick: () => navigate("/reception-billing") },
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
      <div className="hga-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
        <KPI label="Open cases"           value="—" color={C.purple} icon="pi-briefcase" />
        <KPI label="Pre-auth pending"     value="—" color={C.amber}  icon="pi-send" />
        <KPI label="Approved this month"  value="—" color={C.green}  icon="pi-check-circle" />
        <KPI label="Awaiting documents"   value="—" color={C.red}    icon="pi-exclamation-circle" />
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <Card title="Quick actions" color={C.purple} icon="pi-bolt">
          <QuickActionsGrid items={[
            { icon: "pi-briefcase",    label: "TPA Cases",       sub: "All cashless cases",            color: C.purple,  onClick: () => navigate("/tpa-cases") },
            { icon: "pi-building",     label: "TPA Master",      sub: "Manage TPA payor records",      color: C.amber,   onClick: () => navigate("/addtpa") },
            { icon: "pi-receipt",      label: "Claim Files",     sub: "File final bill claim",         color: C.blue,    onClick: () => navigate("/tpa-cases?tab=SUBMITTED") },
            { icon: "pi-dollar",       label: "Hospital Charges",sub: "TPA tariff sheets",             color: C.green,   onClick: () => navigate("/hospital-charges") },
          ]} />
        </Card>
        <AccessSnapshot role={user.role} />
      </div>
    </>
  );
}

/* Ward Boy / Housekeeping have no RoleDashboardPage view — they redirect to
   their dedicated consoles (/ward-tasks, /housekeeping) at the top of this
   file. The old WardOpsDashboard component was dead code and was removed
   (R7hr-313). */

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
  // R7bh-F9 / R7bg-9-HIGH-4 — visibility-gated; pauses when the
  // Security guard tabs away (e.g. to gate-log entry form), resumes on
  // focus. Three stats endpoints × 60 s × idle hours adds up quickly
  // on the security desk that leaves a dashboard open all shift.
  const fetchAll = React.useCallback(async () => {
    const [pass, gate, inc] = await Promise.all([
      axios.get(`${API}/visitor-passes/stats`, authHdr()).then((r) => r.data?.data).catch(() => null),
      axios.get(`${API}/gate-log/stats`,       authHdr()).then((r) => r.data?.data).catch(() => null),
      axios.get(`${API}/incidents/stats`,      authHdr()).then((r) => r.data?.data).catch(() => null),
    ]);
    if (pass) setPassStats(pass);
    if (gate) setGateStats(gate);
    if (inc)  setIncStats(inc);
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);
  useVisiblePoll(fetchAll, 60000, []);

  const v = (obj, key) => (obj == null ? "—" : obj?.[key] ?? 0);

  return (
    <>
      <div className="hga-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 14 }}>
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
            { icon: "pi-bell",                label: "Fire Drills",      sub: "Mock-drill register · NABH FMS",           color: C.amber, onClick: () => navigate("/fire-drills") },
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
  const isPhysio    = role === "Physiotherapist";
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
      {/* R7bb-E/D6-CRIT-2 — Physiotherapy session/scheduling workflow
          isn't built yet; the role has no actionable backend. Flag this
          honestly with a banner so the user doesn't expect Dietician-
          parity features. Keeps the dashboard tile visible while the
          real surface ships. */}
      {isPhysio && (
        <div style={{
          padding: "12px 16px", marginBottom: 14, borderRadius: 10,
          background: "#ecfdf5", border: "1.5px solid #a7f3d0",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <i className="pi pi-info-circle" style={{ fontSize: 18, color: "#047857" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#065f46" }}>
              Physiotherapy workspace — coming soon
            </div>
            <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
              The scheduled-sessions board and per-patient progress notes are scaffolded but
              not yet wired up. Use the Bed View for ward rounds in the meantime.
            </div>
          </div>
        </div>
      )}
      <div className="hga-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
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
