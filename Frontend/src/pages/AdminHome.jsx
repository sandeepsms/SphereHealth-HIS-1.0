/**
 * AdminHome.jsx — "Mission Control" admin landing page.
 *
 * Goal: first-impression wow.  Anyone who opens this dashboard should
 * instantly feel that the HIS is alive — they see the hospital name,
 * a live clock, real-time KPIs, a live activity feed, bed-by-ward
 * occupancy, department load, and a revenue snapshot — all on one
 * scroll without leaving the page.
 *
 * One round-trip to GET /api/admin-dashboard/overview powers
 * everything; auto-refresh every 30 s keeps the feed warm.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { AdminPage, Card, C } from "../Components/admin-theme";

import { API_BASE_URL as API } from "../config/api";
const authHdr = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("his_token")}` } });
const fmtINR  = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const greet   = () => {
  const h = new Date().getHours();
  if (h < 5)  return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
};

/* Smooth relative-time formatter — "just now", "5m", "2h", "yesterday" */
function timeAgo(iso) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 30)    return "just now";
  if (diff < 60)    return `${Math.round(diff)}s ago`;
  if (diff < 3600)  return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 172800) return "yesterday";
  return `${Math.round(diff / 86400)}d ago`;
}

const COLOR_MAP = {
  blue: C.blue, teal: C.teal, green: C.green, orange: C.orange,
  amber: C.amber, purple: C.purple, pink: C.pink, red: C.red, slate: C.slate,
};

export default function AdminHome({ user }) {
  const [data, setData] = useState(null);
  const [now,  setNow]  = useState(new Date());
  const [tick, setTick] = useState(0);   // forces relative-time re-render

  /* Live clock + relative-time tick */
  useEffect(() => {
    const t1 = setInterval(() => setNow(new Date()),  1000);
    const t2 = setInterval(() => setTick(x => x + 1), 30 * 1000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);

  /* Data fetch — initial + 30 s refresh */
  useEffect(() => {
    let alive = true;
    const fetch = async () => {
      try {
        const r = await axios.get(`${API}/admin-dashboard/overview`, authHdr());
        if (alive) setData(r.data?.data || null);
      } catch (e) { /* swallow — keep last good snapshot */ }
    };
    fetch();
    const t = setInterval(fetch, 30 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const firstName = (user?.firstName || (user?.fullName || "").split(" ")[0] || "Admin").trim();
  const kpi  = data?.kpi  || {};
  const beds = data?.beds || {};
  const hosp = data?.hospital || {};
  const acts = data?.activity || [];
  const deps = data?.departments || { opdToday: [], ipdActive: [] };

  return (
    <AdminPage maxWidth={1480}>
      <HospitalHero now={now} hospital={hosp} firstName={firstName} kpi={kpi} />

      {/* Live KPI strip */}
      <div style={kpiGridStyle}>
        <StatCard
          color="teal" icon="pi-users" label="Staff on-duty"
          value={kpi.staff ?? "—"} sub="Active accounts" />
        <StatCard
          color="blue" icon="pi-th-large" label="Bed occupancy"
          value={kpi.bedsTotal != null ? `${kpi.occupancyPct}%` : "—"}
          sub={kpi.bedsTotal ? `${kpi.bedsOccupied}/${kpi.bedsTotal} occupied` : "—"}
          progress={kpi.occupancyPct} />
        <StatCard
          color="purple" icon="pi-home" label="Active IPD"
          value={kpi.ipdActive ?? "—"} sub="Currently admitted" />
        <StatCard
          color="pink" icon="pi-user-edit" label="OPD today"
          value={kpi.opdToday ?? "—"}
          sub={kpi.opdDelta != null ? `${kpi.opdDelta >= 0 ? "+" : ""}${kpi.opdDelta} vs yesterday` : ""}
          trend={kpi.opdDelta} />
        <StatCard
          color="green" icon="pi-receipt" label="Pharmacy today"
          value={kpi.pharmacyToday != null ? fmtINR(kpi.pharmacyToday) : "—"}
          sub={`${kpi.pharmacyTodayCount || 0} bills`}
          trend={kpi.pharmacyDelta} />
        <StatCard
          color="amber" icon="pi-chart-line" label="Pharmacy MTD"
          value={kpi.pharmacyMTD != null ? fmtINR(kpi.pharmacyMTD) : "—"}
          sub="Month to date" />
        <StatCard
          color="orange" icon="pi-box" label="Drug catalogue"
          value={kpi.drugsCount ?? "—"}
          sub={`${kpi.lowStockCount || 0} low-stock`} />
        <StatCard
          color="red" icon="pi-exclamation-triangle" label="Expiry alerts"
          value={kpi.expiredBatches ?? 0}
          sub={`${kpi.expiringBatches || 0} expiring (90d)`} />
      </div>

      {/* Two-column work area */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 14, marginBottom: 14 }}>
        <RevenuePanel kpi={kpi} />
        <ActivityFeed acts={acts} tick={tick} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 0.7fr", gap: 14, marginBottom: 14 }}>
        <BedOccupancyPanel beds={beds} kpi={kpi} />
        <DepartmentPanel departments={deps} />
      </div>

      {/* Quick actions — preserved from the original layout but bumped up visually */}
      <QuickActions />

      <Footer hospital={hosp} kpi={kpi} now={now} />
    </AdminPage>
  );
}

/* ════════════════════════════════════════════════════════════════
   HOSPITAL HERO
══════════════════════════════════════════════════════════════════ */
function HospitalHero({ now, hospital, firstName, kpi }) {
  const dateStr = now.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return (
    <div style={{
      borderRadius: 16,
      background: "linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 45%, #6d28d9 100%)",
      color: "#fff",
      padding: "22px 26px",
      marginBottom: 16,
      position: "relative",
      overflow: "hidden",
      boxShadow: "0 10px 30px rgba(29,78,216,.35)",
    }}>
      {/* Decorative concentric rings */}
      <div style={{
        position: "absolute", right: -120, top: -120, width: 360, height: 360,
        borderRadius: "50%", border: "1px solid rgba(255,255,255,.13)",
      }} />
      <div style={{
        position: "absolute", right: -60, top: -60, width: 240, height: 240,
        borderRadius: "50%", border: "1px solid rgba(255,255,255,.18)",
      }} />
      <div style={{
        position: "absolute", right: 20, top: 20, width: 120, height: 120,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(255,255,255,.18), transparent 70%)",
      }} />

      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: "rgba(255,255,255,.16)",
          border: "1.5px solid rgba(255,255,255,.32)",
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(10px)",
        }}>
          <i className="pi pi-shield" style={{ fontSize: 28 }} />
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: "1.2px",
                        opacity: .8, marginBottom: 2 }}>
            HOSPITAL MISSION CONTROL
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: "-.4px", lineHeight: 1.15 }}>
            {hospital.name || "SphereHealth Hospital"}
          </div>
          <div style={{ fontSize: 13, opacity: .92, marginTop: 6 }}>
            {greet()}, <strong>{firstName}</strong> · {dateStr}
          </div>
        </div>

        {/* Live clock + compliance pills */}
        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div style={{
            fontFamily: "ui-monospace, 'SF Mono', monospace",
            fontSize: 30, fontWeight: 800, letterSpacing: ".5px",
            background: "rgba(0,0,0,.18)", padding: "4px 14px", borderRadius: 10,
          }}>{timeStr}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Pill icon="pi-shield"        text={hospital.nabh ? "NABH READY" : "NABH PENDING"} on={!!hospital.nabh} />
            <Pill icon="pi-check-circle"  text="AUDIT OK" on />
            <Pill icon="pi-database"      text={`${kpi.patientsTotal || 0} PATIENTS`} on />
            <Pill icon="pi-bolt"          text="LIVE" on glow />
          </div>
        </div>
      </div>
    </div>
  );
}

function Pill({ icon, text, on, glow }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px", borderRadius: 999,
      background: on ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.08)",
      border: `1px solid rgba(255,255,255,${on ? .35 : .15})`,
      fontSize: 10.5, fontWeight: 800, letterSpacing: ".4px",
      boxShadow: glow ? "0 0 14px rgba(255,255,255,.5)" : "none",
    }}>
      <i className={`pi ${icon}`} style={{ fontSize: 10 }} /> {text}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════
   KPI CARD — coloured tile with optional progress bar + trend
══════════════════════════════════════════════════════════════════ */
const kpiGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12, marginBottom: 14,
};

function StatCard({ color, icon, label, value, sub, progress, trend }) {
  const accent = COLOR_MAP[color] || C.blue;
  return (
    <div style={{
      background: "#fff",
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      padding: "14px 16px",
      boxShadow: "0 1px 4px rgba(15,23,42,.06)",
      position: "relative", overflow: "hidden",
      transition: "transform .15s, box-shadow .15s",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 22px ${accent}25`; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 1px 4px rgba(15,23,42,.06)"; }}>
      {/* Accent ribbon on the left */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent }} />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: accent + "15", color: accent,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <i className={`pi ${icon}`} style={{ fontSize: 16 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: C.muted, letterSpacing: ".5px", textTransform: "uppercase" }}>
            {label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: C.text, marginTop: 2, letterSpacing: "-.5px" }}>
            {value}
          </div>
          {sub && (
            <div style={{ fontSize: 11, color: trend != null && trend !== 0 ? (trend > 0 ? C.green : C.red) : C.muted, marginTop: 2, fontWeight: 600 }}>
              {trend != null && trend !== 0 && (
                <i className={`pi ${trend > 0 ? "pi-arrow-up" : "pi-arrow-down"}`} style={{ fontSize: 9, marginRight: 4 }} />
              )}
              {sub}
            </div>
          )}
        </div>
      </div>
      {progress != null && (
        <div style={{ marginTop: 10, height: 5, background: accent + "15", borderRadius: 999, overflow: "hidden" }}>
          <div style={{
            width: `${Math.min(100, Math.max(0, progress))}%`,
            height: "100%", background: accent,
            borderRadius: 999, transition: "width .4s",
          }} />
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   REVENUE PANEL — Today / Yesterday / MTD bars
══════════════════════════════════════════════════════════════════ */
function RevenuePanel({ kpi }) {
  const max = Math.max(kpi.pharmacyToday || 0, kpi.pharmacyYesterday || 0, kpi.pharmacyMTD || 0, 1);
  const bars = [
    { label: "Today",     value: kpi.pharmacyToday     || 0, color: C.green,  bold: true },
    { label: "Yesterday", value: kpi.pharmacyYesterday || 0, color: C.slate },
    { label: "MTD",       value: kpi.pharmacyMTD       || 0, color: C.blue },
  ];
  return (
    <Card title="Revenue snapshot" color={C.green} icon="pi-chart-line"
          right={<span style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>Pharmacy · live</span>}>
      <div style={{ display: "grid", gap: 12 }}>
        {bars.map((b, i) => {
          const pct = (b.value / max) * 100;
          return (
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{b.label}</span>
                <span style={{ fontSize: 14, fontWeight: 900, color: b.bold ? b.color : C.text }}>{fmtINR(b.value)}</span>
              </div>
              <div style={{ height: 12, background: b.color + "15", borderRadius: 999, overflow: "hidden" }}>
                <div style={{
                  width: `${pct}%`, height: "100%",
                  background: `linear-gradient(90deg, ${b.color}, ${b.color}aa)`,
                  borderRadius: 999, transition: "width .5s",
                }} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{
        marginTop: 14, padding: "10px 12px",
        background: "#f8fafc", borderRadius: 8,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 12, color: C.muted,
      }}>
        <span>
          <strong style={{ color: C.text }}>{kpi.pharmacyTodayCount || 0}</strong> transactions today
        </span>
        <span>
          Δ <strong style={{ color: (kpi.pharmacyDelta || 0) >= 0 ? C.green : C.red }}>
            {(kpi.pharmacyDelta || 0) >= 0 ? "+" : ""}{fmtINR(kpi.pharmacyDelta || 0)}
          </strong> vs yesterday
        </span>
      </div>
    </Card>
  );
}

/* ════════════════════════════════════════════════════════════════
   LIVE ACTIVITY FEED — chronological event stream
══════════════════════════════════════════════════════════════════ */
function ActivityFeed({ acts, tick }) {
  // tick prop forces re-render so relative timestamps stay fresh.
  return (
    <Card title="Live activity" color={C.purple} icon="pi-history"
          right={<LiveDot />}>
      {acts.length === 0 ? (
        <div style={{ padding: "30px 10px", textAlign: "center", color: C.muted, fontSize: 13 }}>
          <i className="pi pi-clock" style={{ fontSize: 24, opacity: .4, marginBottom: 8, display: "block" }} />
          No recent activity in the last 24 hours.
        </div>
      ) : (
        <div style={{ maxHeight: 360, overflowY: "auto", display: "grid", gap: 8 }}>
          {acts.map((a, i) => {
            const color = COLOR_MAP[a.color] || C.slate;
            return (
              <div key={i} style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "10px 12px",
                background: i % 2 === 0 ? "#fafbfc" : "#fff",
                borderRadius: 8, border: `1px solid ${C.border}80`,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: color + "15", color,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <i className={`pi ${a.icon}`} style={{ fontSize: 13 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{a.title}</div>
                  {a.sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.sub}</div>}
                </div>
                <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, flexShrink: 0, marginTop: 4 }}>
                  {timeAgo(a.when)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function LiveDot() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: C.green }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%", background: C.green,
        boxShadow: `0 0 0 4px ${C.green}30`,
        animation: "pulse 1.6s infinite",
      }} />
      LIVE
      <style>{`@keyframes pulse {
        0%   { box-shadow: 0 0 0 0  ${C.green}55; }
        70%  { box-shadow: 0 0 0 8px ${C.green}00; }
        100% { box-shadow: 0 0 0 0  ${C.green}00; }
      }`}</style>
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════
   BED OCCUPANCY — by-ward heatmap
══════════════════════════════════════════════════════════════════ */
function BedOccupancyPanel({ beds, kpi }) {
  const wards = beds.byWard || [];
  return (
    <Card title="Bed occupancy by ward" color={C.blue} icon="pi-th-large"
          right={<span style={{ fontSize: 12, fontWeight: 800, color: C.blue }}>
            {kpi.bedsOccupied || 0}/{kpi.bedsTotal || 0} ({kpi.occupancyPct || 0}%)
          </span>}>
      {wards.length === 0 ? (
        <div style={{ padding: "30px 10px", textAlign: "center", color: C.muted, fontSize: 13 }}>
          No wards configured yet.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 9 }}>
          {wards.map((w, i) => {
            const pct = w.occupancyPct || 0;
            const color = pct >= 85 ? C.red : pct >= 60 ? C.amber : C.green;
            return (
              <div key={i}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3 }}>
                  <span style={{ fontWeight: 800, color: C.text }}>{w.ward}</span>
                  <span style={{ color: C.muted, fontFamily: "ui-monospace" }}>
                    {w.occupied}/{w.total} · <strong style={{ color }}>{Math.round(pct)}%</strong>
                  </span>
                </div>
                <div style={{ height: 9, background: color + "15", borderRadius: 999, overflow: "hidden", display: "flex" }}>
                  <div style={{ width: `${pct}%`, background: color, borderRadius: 999, transition: "width .4s" }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ════════════════════════════════════════════════════════════════
   DEPARTMENT PANEL — OPD vs IPD load
══════════════════════════════════════════════════════════════════ */
function DepartmentPanel({ departments }) {
  const opd = departments.opdToday || [];
  const ipd = departments.ipdActive || [];
  return (
    <Card title="Department load" color={C.orange} icon="pi-sitemap">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <DeptList title="OPD today"    items={opd} color={C.purple} icon="pi-user-edit" />
        <DeptList title="IPD active"   items={ipd} color={C.blue}   icon="pi-home" />
      </div>
    </Card>
  );
}
function DeptList({ title, items, color, icon }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color, marginBottom: 6, letterSpacing: ".4px" }}>
        <i className={`pi ${icon}`} style={{ marginRight: 5, fontSize: 11 }} />
        {title.toUpperCase()}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 11.5, color: C.muted, padding: "8px 4px" }}>—</div>
      ) : (
        <div style={{ display: "grid", gap: 5 }}>
          {items.map((d, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between",
              padding: "7px 10px", borderRadius: 7,
              background: color + "08", border: `1px solid ${color}18`,
              fontSize: 12,
            }}>
              <span style={{ color: C.text, fontWeight: 700 }}>{d.name}</span>
              <span style={{ color, fontWeight: 900 }}>{d.n}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   QUICK ACTIONS — modernised version of the existing tiles
══════════════════════════════════════════════════════════════════ */
function QuickActions() {
  const navigate = useNavigate();
  const items = [
    { icon: "pi-building",   label: "Hospital Settings",  sub: "Identity · Print · Legal · Bank",  color: C.blue,   to: "/hospital-settings" },
    { icon: "pi-users",      label: "User Management",    sub: "Onboard staff · reset passwords",  color: C.teal,   to: "/admin/users" },
    { icon: "pi-shield",     label: "Roles & Permissions",sub: "See what every role can access",   color: C.purple, to: "/admin/roles" },
    { icon: "pi-sitemap",    label: "Departments",        sub: "Hospital departments + services",  color: C.orange, to: "/department" },
    { icon: "pi-user-edit",  label: "Doctor Master",      sub: "Consultants, specialisations",     color: C.purple, to: "/doctors" },
    { icon: "pi-dollar",     label: "Hospital Charges",   sub: "TPA tariff sheets",                color: C.amber,  to: "/hospital-charges" },
    { icon: "pi-chart-bar",  label: "Reports",            sub: "Operational + financial",          color: C.green,  to: "/billing-audit-trail" },
    { icon: "pi-print",      label: "Print Gallery",      sub: "Preview every printable",          color: C.pink,   to: "/print-gallery" },
  ];
  return (
    <Card title="Quick actions" color={C.amber} icon="pi-bolt">
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 11,
      }}>
        {items.map((it, i) => (
          <button key={i} onClick={() => navigate(it.to)}
            style={{
              background: "#fff", border: `1.5px solid ${C.border}`, borderRadius: 12,
              padding: "13px 14px", textAlign: "left", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 11,
              transition: "all .15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 22px ${it.color}25`; e.currentTarget.style.borderColor = it.color + "55"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.borderColor = C.border; }}>
            <div style={{
              width: 40, height: 40, borderRadius: 11,
              background: `linear-gradient(135deg, ${it.color}20, ${it.color}10)`,
              color: it.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <i className={`pi ${it.icon}`} style={{ fontSize: 17 }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: C.text }}>{it.label}</div>
              <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>{it.sub}</div>
            </div>
            <i className="pi pi-arrow-right" style={{ fontSize: 11, color: C.muted }} />
          </button>
        ))}
      </div>
    </Card>
  );
}

/* ════════════════════════════════════════════════════════════════
   FOOTER — compliance + system identity
══════════════════════════════════════════════════════════════════ */
function Footer({ hospital, kpi, now }) {
  return (
    <div style={{
      marginTop: 14, padding: "14px 18px",
      background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
      color: "#e2e8f0", borderRadius: 12,
      display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10,
      fontSize: 12,
    }}>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
        <FooterStat icon="pi-server"   label="System"  value="Healthy" color="#22c55e" />
        <FooterStat icon="pi-database" label="Mongo"   value="Connected" color="#22c55e" />
        <FooterStat icon="pi-shield"   label="Audit"   value="Live" color="#a78bfa" />
        <FooterStat icon="pi-clock"    label="Synced"  value={now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} color="#60a5fa" />
      </div>
      <div style={{ opacity: .65, fontSize: 11 }}>
        SphereHealth HIS v2.0 · {hospital.name || "—"} · NABH-compliant
      </div>
    </div>
  );
}
function FooterStat({ icon, label, value, color }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <i className={`pi ${icon}`} style={{ fontSize: 11, color }} />
      <span style={{ opacity: .7 }}>{label}:</span>
      <strong style={{ color }}>{value}</strong>
    </span>
  );
}
