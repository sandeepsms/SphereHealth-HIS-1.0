// pages/bed/BedDashboard.jsx
// Bed Management Dashboard — operational overview for ward-in-charge,
// nurse manager, and admin. Aggregates already-available data (beds,
// admissions, transfers) into KPI tiles + actionable lists. No new
// backend endpoints required for this first cut.
//
// Tiles:
//   1. Occupancy % (overall + by ward)
//   2. ALOS (Average Length of Stay, last 30 days)
//   3. Today's expected discharges
//   4. Beds in maintenance / cleaning
//   5. Isolation occupancy (by precaution flag)
//   6. Pending bed-transfer handovers
//
// Counts are computed client-side from the GET /bedss and
// GET /admissions endpoints. When the data volume grows past
// ~5000 beds we'll move aggregations into a dedicated controller.

import React, { useEffect, useMemo, useState } from "react";
import { API_ENDPOINTS } from "../../config/api";

const C = {
  card:     "#ffffff",
  border:   "#e2e8f0",
  text:     "#0f172a",
  muted:    "#64748b",
  bg:       "#f8fafc",
  primary:  "#2563eb",
  primaryL: "#dbeafe",
  green:    "#16a34a",
  greenL:   "#dcfce7",
  amber:    "#d97706",
  amberL:   "#fef3c7",
  red:      "#dc2626",
  redL:     "#fee2e2",
  purple:   "#7c3aed",
  purpleL:  "#ede9fe",
  pink:     "#db2777",
  pinkL:    "#fce7f3",
  teal:     "#0d9488",
  tealL:    "#ccfbf1",
};

const fetchJSON = async (url) => {
  try {
    const r = await fetch(url);
    const data = await r.json();
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.beds))       return data.beds;
    if (Array.isArray(data?.admissions)) return data.admissions;
    if (Array.isArray(data?.transfers))  return data.transfers;
    return [];
  } catch { return []; }
};

const isSameDay = (a, b) => {
  if (!a || !b) return false;
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear()
      && x.getMonth() === y.getMonth()
      && x.getDate() === y.getDate();
};

const dayDiff = (from, to) => {
  if (!from) return null;
  const f = new Date(from), t = to ? new Date(to) : new Date();
  return Math.max(1, Math.ceil((t - f) / (1000 * 60 * 60 * 24)));
};

const BedDashboard = () => {
  const [beds, setBeds]             = useState([]);
  const [admissions, setAdmissions] = useState([]);
  const [transfers, setTransfers]   = useState([]);
  const [loading, setLoading]       = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchJSON(API_ENDPOINTS.BEDS),
      fetchJSON(API_ENDPOINTS.ADMISSIONS),
      fetchJSON(API_ENDPOINTS.BED_TRANSFERS),
    ]).then(([b, a, t]) => {
      if (cancelled) return;
      setBeds(b);
      setAdmissions(a);
      setTransfers(t);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshTick]);

  // ── Aggregations ────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total       = beds.length;
    const occupied    = beds.filter(b => b.status === "Occupied").length;
    const available   = beds.filter(b => b.status === "Available").length;
    const maintenance = beds.filter(b => b.status === "Maintenance").length;
    const blocked     = beds.filter(b => b.status === "Blocked").length;
    const reserved    = beds.filter(b => b.status === "Reserved").length;
    const occupancyPct = total > 0 ? Math.round((occupied / total) * 100) : 0;

    // ALOS from admissions discharged in the last 30 days
    const now = Date.now();
    const THIRTY = 30 * 24 * 60 * 60 * 1000;
    const recent = admissions.filter(a => a.dischargeDate && (now - new Date(a.dischargeDate).getTime()) < THIRTY);
    const totalDays = recent.reduce((sum, a) => sum + (dayDiff(a.admissionDate, a.dischargeDate) || 0), 0);
    const alos = recent.length > 0 ? (totalDays / recent.length).toFixed(1) : "—";

    // Today's expected discharges
    const today = new Date();
    const expectedToday = beds.filter(b => {
      const eta = b.currentBooking?.expectedDischargeDate;
      return b.status === "Occupied" && eta && isSameDay(eta, today);
    });

    // Isolation occupancy
    const isolationCount = beds.filter(b => Array.isArray(b.isolationFlags) && b.isolationFlags.length > 0).length;
    const isolationByFlag = {};
    beds.forEach(b => (b.isolationFlags || []).forEach(f => {
      isolationByFlag[f] = (isolationByFlag[f] || 0) + 1;
    }));

    // Pending transfer handovers
    const pendingTransfers = transfers.filter(t => t.status === "PendingHandover");

    // Housekeeping queue (beds awaiting / undergoing cleaning) + SLA
    const housekeepingQueue = beds
      .filter(b => ["CleaningPending", "CleaningInProgress", "CleaningDone"].includes(b.housekeeping?.state))
      .map(b => {
        const started = b.housekeeping?.startedAt ? new Date(b.housekeeping.startedAt).getTime() : null;
        const ageMin  = started ? Math.round((Date.now() - started) / 60000) : null;
        return { ...b, _hkAgeMin: ageMin };
      })
      .sort((a, b) => (b._hkAgeMin || 0) - (a._hkAgeMin || 0));

    // Stale reservations — Reserved beds past reservedUntil
    const staleReservations = beds.filter(b =>
      b.status === "Reserved" && b.reservedUntil && new Date(b.reservedUntil) < new Date()
    );

    // Occupancy by ward
    const byWard = {};
    beds.forEach(b => {
      const key = b.wardName || "(Unassigned ward)";
      if (!byWard[key]) byWard[key] = { total: 0, occupied: 0 };
      byWard[key].total += 1;
      if (b.status === "Occupied") byWard[key].occupied += 1;
    });
    const wardRows = Object.entries(byWard)
      .map(([name, v]) => ({ name, ...v, pct: v.total ? Math.round(v.occupied * 100 / v.total) : 0 }))
      .sort((a, b) => b.pct - a.pct);

    return {
      total, occupied, available, maintenance, blocked, reserved, occupancyPct,
      alos, expectedToday, isolationCount, isolationByFlag, pendingTransfers,
      wardRows, housekeepingQueue, staleReservations,
    };
  }, [beds, admissions, transfers]);

  /* Expire stale reservations on-demand (P2 #10). */
  const expireStaleReservations = async () => {
    try {
      const r = await fetch(`${API_ENDPOINTS.BEDS}/reservations/expire-stale`, { method: "POST" });
      const data = await r.json();
      if (data?.success) {
        setRefreshTick(t => t + 1);
      }
    } catch { /* silent */ }
  };

  return (
    <div style={{ padding: "20px 28px", fontFamily: "'DM Sans', sans-serif", background: C.bg, minHeight: "100vh" }}>
      {/* ── Page header ── */}
      <div style={{
        background: "linear-gradient(135deg, #475569, #1e293b)",
        borderRadius: 14, padding: "18px 24px", color: "white",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 18, boxShadow: "0 6px 22px rgba(15,23,42,.25)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="pi pi-chart-bar" style={{ fontSize: 22 }} />
          </div>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800 }}>Bed Management Dashboard</div>
            <div style={{ fontSize: 12, opacity: .85 }}>Occupancy, expected discharges, isolation, and transfer queue</div>
          </div>
        </div>
        <button onClick={() => setRefreshTick(t => t + 1)}
          disabled={loading}
          style={{ background: "rgba(255,255,255,.2)", border: "none", color: "white", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} />
          Refresh
        </button>
      </div>

      {/* ── Headline KPI strip ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
        <Kpi label="Occupancy" value={`${kpis.occupancyPct}%`} sub={`${kpis.occupied} / ${kpis.total} beds`} color={C.primary} bg={C.primaryL} icon="pi-percentage" />
        <Kpi label="Available" value={kpis.available} sub={`${kpis.reserved} reserved`} color={C.green} bg={C.greenL} icon="pi-check-circle" />
        <Kpi label="ALOS (30d)" value={kpis.alos} sub="Avg Length of Stay (days)" color={C.purple} bg={C.purpleL} icon="pi-clock" />
        <Kpi label="Maintenance" value={kpis.maintenance + kpis.blocked} sub={`${kpis.maintenance} maint · ${kpis.blocked} blocked`} color={C.amber} bg={C.amberL} icon="pi-wrench" />
      </div>

      {/* ── Two-column layout: lists ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Occupancy by ward */}
        <Panel title="Occupancy by Ward" icon="pi-building" color={C.primary}>
          {kpis.wardRows.length === 0 ? <Empty msg="No wards configured" /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {kpis.wardRows.slice(0, 8).map(w => (
                <div key={w.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: C.text }}>{w.name}</div>
                  <div style={{ flex: 2, height: 8, background: "#f1f5f9", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ width: `${w.pct}%`, height: "100%",
                      background: w.pct > 85 ? C.red : w.pct > 65 ? C.amber : C.green, transition: "width .3s" }} />
                  </div>
                  <div style={{ width: 70, textAlign: "right", fontSize: 11, fontWeight: 700, color: C.muted }}>
                    {w.occupied}/{w.total} · <strong style={{ color: C.text }}>{w.pct}%</strong>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Expected discharges today */}
        <Panel title={`Today's Expected Discharges (${kpis.expectedToday.length})`} icon="pi-sign-out" color={C.teal}>
          {kpis.expectedToday.length === 0 ? <Empty msg="No discharges expected today" /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {kpis.expectedToday.slice(0, 8).map(b => (
                <div key={b._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: C.tealL, borderRadius: 8, border: `1px solid ${C.teal}25` }}>
                  <i className="pi pi-user" style={{ fontSize: 12, color: C.teal }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                      Bed {b.bedNumber} · {b.wardName || "—"}
                    </div>
                    <div style={{ fontSize: 10, color: C.muted }}>
                      Admitted: {b.currentBooking?.admittedDate
                        ? new Date(b.currentBooking.admittedDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
                        : "—"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Isolation occupancy */}
        <Panel title={`Isolation Occupancy (${kpis.isolationCount})`} icon="pi-shield" color={C.red}>
          {Object.keys(kpis.isolationByFlag).length === 0 ? <Empty msg="No isolation beds active" /> : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {Object.entries(kpis.isolationByFlag).sort((a,b) => b[1] - a[1]).map(([flag, count]) => (
                <span key={flag} style={{
                  background: C.redL, color: C.red, border: `1px solid ${C.red}40`,
                  padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}>
                  <i className="pi pi-exclamation-triangle" style={{ fontSize: 10 }} />
                  {flag}
                  <span style={{ background: C.red, color: "white", padding: "1px 7px", borderRadius: 999, fontSize: 10 }}>{count}</span>
                </span>
              ))}
            </div>
          )}
        </Panel>

        {/* Pending transfer handovers */}
        <Panel title={`Pending Transfer Handovers (${kpis.pendingTransfers.length})`} icon="pi-arrows-h" color={C.purple}>
          {kpis.pendingTransfers.length === 0 ? <Empty msg="No transfers awaiting handover" /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {kpis.pendingTransfers.slice(0, 6).map(t => (
                <div key={t._id} style={{ padding: "8px 12px", background: C.purpleL, borderRadius: 8, border: `1px solid ${C.purple}30` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                    {t.patientName} · UHID: {t.UHID}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                    Bed {t.fromBedNumber} → Bed {t.toBedNumber}
                  </div>
                </div>
              ))}
              <a href="/bed-transfers" style={{ marginTop: 4, fontSize: 11, color: C.purple, fontWeight: 700, textDecoration: "none" }}>
                View all transfers →
              </a>
            </div>
          )}
        </Panel>

        {/* Housekeeping queue (P1 #5) */}
        <Panel title={`Housekeeping Queue (${kpis.housekeepingQueue.length})`} icon="pi-bookmark-fill" color={C.amber}>
          {kpis.housekeepingQueue.length === 0 ? <Empty msg="No beds awaiting cleaning" /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {kpis.housekeepingQueue.slice(0, 8).map(b => {
                const state = b.housekeeping?.state || "—";
                const sla   = b._hkAgeMin;
                const slaBreached = sla != null && sla > 30;
                return (
                  <div key={b._id} style={{
                    padding: "8px 12px",
                    background: slaBreached ? C.redL : C.amberL,
                    borderRadius: 8,
                    border: `1px solid ${slaBreached ? C.red : C.amber}30`,
                    display: "flex", alignItems: "center", gap: 10,
                  }}>
                    <i className={`pi ${state === "CleaningInProgress" ? "pi-spin pi-spinner" : "pi-bookmark-fill"}`} style={{ fontSize: 12, color: slaBreached ? C.red : C.amber }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                        Bed {b.bedNumber} · {b.wardName || "—"}
                      </div>
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                        {state} {sla != null ? `· ${sla} min ago` : ""} {slaBreached ? "· SLA breached" : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Stale reservations (P2 #10) */}
        <Panel
          title={`Stale Reservations (${kpis.staleReservations.length})`}
          icon="pi-clock"
          color={C.pink}
          action={kpis.staleReservations.length > 0 ? (
            <button onClick={expireStaleReservations}
              style={{ background: C.pink, color: "white", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
              Expire all
            </button>
          ) : null}
        >
          {kpis.staleReservations.length === 0 ? <Empty msg="No expired holds" /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {kpis.staleReservations.slice(0, 6).map(b => (
                <div key={b._id} style={{ padding: "8px 12px", background: C.pinkL, borderRadius: 8, border: `1px solid ${C.pink}30` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                    Bed {b.bedNumber} · {b.wardName || "—"}
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                    Held by {b.reservedBy || "—"} · expired {b.reservedUntil ? new Date(b.reservedUntil).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
};

// ── Helper components ─────────────────────────────────────────────
const Kpi = ({ label, value, sub, color, bg, icon }) => (
  <div style={{ background: bg, border: `1.5px solid ${color}25`, borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
    <div style={{ width: 40, height: 40, borderRadius: 10, background: color + "20", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <i className={`pi ${icon}`} style={{ fontSize: 16, color }} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: color + "aa", textTransform: "uppercase", letterSpacing: ".5px", marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: "#64748b", marginTop: 3 }}>{sub}</div>}
    </div>
  </div>
);

const Panel = ({ title, icon, color, action, children }) => (
  <div style={{ background: "white", border: "1.5px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
    <div style={{ background: "#f8fafc", padding: "11px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 8 }}>
      <i className={`pi ${icon}`} style={{ fontSize: 14, color }} />
      <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", flex: 1 }}>{title}</span>
      {action}
    </div>
    <div style={{ padding: 14 }}>{children}</div>
  </div>
);

const Empty = ({ msg }) => (
  <div style={{ textAlign: "center", padding: "20px 0", color: "#94a3b8", fontSize: 12 }}>
    <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
    {msg}
  </div>
);

export default BedDashboard;
