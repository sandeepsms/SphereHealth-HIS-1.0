/**
 * MaintenanceDashboardPage.jsx
 *
 * Single-screen control panel for housekeeping / facilities / equipment.
 * Pulls from /api/bedss + /api/bedss/housekeeping/queue and lets the
 * maintenance team drive bed turnover:
 *
 *   Maintenance bed  →  CleaningPending  →  CleaningInProgress
 *                  →  CleaningDone  →  Inspected  →  Available
 *
 * Cards:
 *   • KPI strip — counts + total downtime today
 *   • Active maintenance queue — rows of beds in Maintenance with
 *     quick-action buttons (start / done / inspected / release)
 *   • Equipment needing service — beds where any equipment.lastService
 *     is older than 90 days
 *   • Blocked beds — status="Blocked" beds with the reason
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { bedService } from "../../Services/bedService";
import authFetch from "../../utils/authFetch";
import { API_ENDPOINTS } from "../../config/api";

const C = {
  bg: "#f8fafc", card: "#fff", border: "#e2e8f0",
  text: "#0f172a", muted: "#64748b",
  amber: "#d97706", amberL: "#fffbeb",
  blue: "#4f46e5", blueL: "#eef2ff",
  green: "#16a34a", greenL: "#dcfce7",
  red: "#dc2626", redL: "#fef2f2",
  slate: "#475569",
  purple: "#7c3aed", purpleL: "#f5f3ff",
};

const HK_STATES = ["CleaningPending", "CleaningInProgress", "CleaningDone", "Inspected"];
const HK_NEXT   = {
  Idle:               "CleaningPending",
  CleaningPending:    "CleaningInProgress",
  CleaningInProgress: "CleaningDone",
  CleaningDone:       "Inspected",
};
const HK_LABEL = {
  Idle:               "Idle",
  CleaningPending:    "Pending",
  CleaningInProgress: "In progress",
  CleaningDone:       "Done",
  Inspected:          "Inspected",
};
const HK_COLOR = {
  Idle:               { c: C.muted, bg: "#f1f5f9" },
  CleaningPending:    { c: C.amber, bg: C.amberL },
  CleaningInProgress: { c: C.blue,  bg: C.blueL  },
  CleaningDone:       { c: C.purple,bg: C.purpleL},
  Inspected:          { c: C.green, bg: C.greenL },
};

function timeSince(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const m = Math.floor(ms / 60000);
  if (m < 1)  return "<1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ${m % 60} min`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default function MaintenanceDashboardPage() {
  const [beds, setBeds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState({});   // bedId → "loading" while a quick-action is in flight

  const load = async () => {
    setLoading(true);
    try {
      const all = await bedService.getAllBeds();
      setBeds(Array.isArray(all) ? all : all?.data || []);
    } catch (e) {
      toast.error(e.message || "Failed to load beds");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);    // refresh every minute
    return () => clearInterval(t);
  }, []);

  /* ── Derived buckets ───────────────────────────────────── */
  const maintenance = useMemo(
    () => beds.filter(b => b.status === "Maintenance" || (b.housekeeping?.state && b.housekeeping.state !== "Idle")),
    [beds]
  );
  const blocked       = useMemo(() => beds.filter(b => b.status === "Blocked"), [beds]);
  const equipDue      = useMemo(() =>
    beds.filter(b => Array.isArray(b.equipment) && b.equipment.some(e => {
      const d = daysSince(e.lastService);
      return d == null || d >= 90;
    })), [beds]);

  const totalDowntime = useMemo(() => {
    let mins = 0;
    for (const b of maintenance) {
      const s = b.housekeeping?.startedAt;
      if (s) mins += Math.floor((Date.now() - new Date(s).getTime()) / 60000);
    }
    return mins;
  }, [maintenance]);

  /* ── Actions ──────────────────────────────────────────── */
  const setActingFor = (id, val) =>
    setActing(a => { const next = { ...a }; if (val) next[id] = val; else delete next[id]; return next; });

  const updateHk = async (bed, nextState) => {
    const id = bed._id;
    if (acting[id]) return;
    setActingFor(id, "loading");
    try {
      const r = await authFetch(`${API_ENDPOINTS.BEDS}/${id}/housekeeping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: nextState }),
      });
      if (!r.ok) {
        const t = await r.text(); throw new Error(t || `HTTP ${r.status}`);
      }
      toast.success(`${bed.bedNumber}: ${HK_LABEL[nextState] || nextState}`);
      await load();
    } catch (e) {
      toast.error(e.message || "Update failed");
    } finally { setActingFor(id, null); }
  };

  const releaseBed = async (bed) => {
    if (acting[bed._id]) return;
    setActingFor(bed._id, "loading");
    try {
      await bedService.updateBedStatus(bed._id, "Available");
      // Also push housekeeping back to Idle for a clean record.
      await authFetch(`${API_ENDPOINTS.BEDS}/${bed._id}/housekeeping`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "Idle" }),
      });
      toast.success(`${bed.bedNumber} released → Available`);
      await load();
    } catch (e) {
      toast.error(e.message || "Release failed");
    } finally { setActingFor(bed._id, null); }
  };

  const unblockBed = async (bed) => {
    if (acting[bed._id]) return;
    setActingFor(bed._id, "loading");
    try {
      await bedService.updateBedStatus(bed._id, "Available");
      toast.success(`${bed.bedNumber} unblocked → Available`);
      await load();
    } catch (e) {
      toast.error(e.message || "Unblock failed");
    } finally { setActingFor(bed._id, null); }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: 20, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1500, margin: "0 auto" }}>

        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg,#d97706,#b45309)",
          borderRadius: 14, padding: "16px 22px", marginBottom: 16,
          color: "#fff", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          boxShadow: "0 4px 14px rgba(217,119,6,.25)",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.32)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="pi pi-wrench" style={{ fontSize: 22 }} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px" }}>
              Maintenance Dashboard
            </div>
            <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>
              Bed turnover · housekeeping queue · equipment service tracker
            </div>
          </div>
          <button onClick={load} disabled={loading}
            style={{
              padding: "9px 16px", borderRadius: 8,
              background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.3)",
              color: "#fff", fontWeight: 700, fontSize: 12,
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}>
            <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} style={{ fontSize: 11 }} />
            Refresh
          </button>
        </div>

        {/* KPI strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
          {[
            { label: "In maintenance",   value: maintenance.length, color: C.amber, icon: "pi-wrench" },
            { label: "Cleaning pending", value: beds.filter(b => b.housekeeping?.state === "CleaningPending").length, color: C.amber, icon: "pi-hourglass" },
            { label: "In progress",      value: beds.filter(b => b.housekeeping?.state === "CleaningInProgress").length, color: C.blue,  icon: "pi-spin pi-spinner" },
            { label: "Awaiting inspect", value: beds.filter(b => b.housekeeping?.state === "CleaningDone").length, color: C.purple, icon: "pi-eye" },
            { label: "Equip service due",value: equipDue.length, color: C.red,   icon: "pi-cog" },
            { label: "Blocked",          value: blocked.length, color: C.slate, icon: "pi-ban" },
          ].map((k, i) => (
            <div key={i} style={{
              background: C.card, border: `1.5px solid ${C.border}`,
              borderRadius: 12, padding: "14px 16px",
              boxShadow: "0 1px 3px rgba(15,23,42,.04)",
              display: "flex", alignItems: "center", gap: 14,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: k.color + "12",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                <i className={`pi ${k.icon}`} style={{ fontSize: 16, color: k.color }} />
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginTop: 4 }}>{k.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Total downtime ribbon */}
        <div style={{
          background: C.amberL, border: `1.5px solid ${C.amber}30`,
          borderRadius: 10, padding: "10px 16px", marginBottom: 16,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <i className="pi pi-clock" style={{ color: C.amber, fontSize: 14 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>
            Combined housekeeping downtime in queue:
          </span>
          <span style={{ fontSize: 13, fontWeight: 800, color: C.amber }}>
            {Math.floor(totalDowntime / 60)} hr {totalDowntime % 60} min
          </span>
        </div>

        {/* Active maintenance queue */}
        <Section title="Active maintenance queue" icon="pi-list" color={C.amber}
          count={maintenance.length}
          empty="No beds in maintenance — all clean.">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: `1.5px solid ${C.border}` }}>
                {["Bed","Location","Status","HK state","Started","Assigned","Action"].map(h => (
                  <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", fontSize: 10, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {maintenance.map((b, i) => {
                const hk = b.housekeeping || {};
                const state = hk.state || "Idle";
                const hkc = HK_COLOR[state] || HK_COLOR.Idle;
                const isActing = acting[b._id] === "loading";
                const nextState = HK_NEXT[state];
                return (
                  <tr key={b._id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 700, color: C.text, whiteSpace: "nowrap" }}>
                      <i className="pi pi-th-large" style={{ marginRight: 6, color: C.muted, fontSize: 10 }} />
                      {b.bedNumber}
                    </td>
                    <td style={{ padding: "10px 12px", color: C.muted, fontSize: 11.5 }}>
                      {b.wardName || "—"} · Room {b.roomNumber || "—"} · Floor {b.floorNumber || "—"}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <Pill bg={C.amberL} c={C.amber}>{b.status}</Pill>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <Pill bg={hkc.bg} c={hkc.c}>{HK_LABEL[state]}</Pill>
                    </td>
                    <td style={{ padding: "10px 12px", color: C.muted, fontSize: 11.5, whiteSpace: "nowrap" }}>
                      {timeSince(hk.startedAt)}
                    </td>
                    <td style={{ padding: "10px 12px", color: C.muted, fontSize: 11.5 }}>
                      {hk.assignedTo || "—"}
                    </td>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        {nextState && (
                          <button onClick={() => updateHk(b, nextState)} disabled={isActing}
                            style={{
                              padding: "6px 12px", borderRadius: 6, border: "none",
                              background: hkc.c, color: "#fff",
                              fontSize: 11, fontWeight: 700,
                              cursor: isActing ? "not-allowed" : "pointer",
                              opacity: isActing ? .6 : 1,
                              display: "inline-flex", alignItems: "center", gap: 4,
                            }}>
                            {isActing ? <i className="pi pi-spin pi-spinner" style={{ fontSize: 10 }} /> : <i className="pi pi-arrow-right" style={{ fontSize: 10 }} />}
                            → {HK_LABEL[nextState]}
                          </button>
                        )}
                        {(state === "Inspected" || state === "CleaningDone") && (
                          <button onClick={() => releaseBed(b)} disabled={isActing}
                            style={{
                              padding: "6px 12px", borderRadius: 6, border: "1.5px solid #86efac",
                              background: C.greenL, color: C.green,
                              fontSize: 11, fontWeight: 700,
                              cursor: isActing ? "not-allowed" : "pointer",
                              opacity: isActing ? .6 : 1,
                            }}>
                            <i className="pi pi-check" style={{ fontSize: 10, marginRight: 4 }} />
                            Release
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        {/* Equipment service due */}
        <Section title="Equipment service due" icon="pi-cog" color={C.red}
          count={equipDue.length}
          empty="All equipment serviced within policy (last 90 days).">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: `1.5px solid ${C.border}` }}>
                {["Bed","Location","Equipment","Last service","Days since","Action"].map(h => (
                  <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", fontSize: 10, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {equipDue.flatMap(b =>
                (b.equipment || [])
                  .filter(e => { const d = daysSince(e.lastService); return d == null || d >= 90; })
                  .map((e, idx) => (
                    <tr key={`${b._id}-${idx}`} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: "10px 12px", fontWeight: 700 }}>{b.bedNumber}</td>
                      <td style={{ padding: "10px 12px", color: C.muted, fontSize: 11.5 }}>
                        {b.wardName || "—"} · Room {b.roomNumber || "—"}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ fontWeight: 700 }}>{e.label || e.type}</span>
                        {e.serialNo && <span style={{ color: C.muted, fontSize: 10.5, marginLeft: 6 }}>SN: {e.serialNo}</span>}
                      </td>
                      <td style={{ padding: "10px 12px", color: C.muted }}>
                        {e.lastService ? new Date(e.lastService).toLocaleDateString("en-IN") : "Never recorded"}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ color: C.red, fontWeight: 800 }}>
                          {daysSince(e.lastService) != null ? `${daysSince(e.lastService)} days` : "—"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", color: C.muted, fontSize: 11 }}>
                        Edit via Bed Management → Edit Bed
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </Section>

        {/* Blocked beds */}
        <Section title="Blocked beds" icon="pi-ban" color={C.slate}
          count={blocked.length}
          empty="No beds blocked.">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: `1.5px solid ${C.border}` }}>
                {["Bed","Location","Reason","Action"].map(h => (
                  <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", fontSize: 10 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {blocked.map(b => (
                <tr key={b._id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "10px 12px", fontWeight: 700 }}>{b.bedNumber}</td>
                  <td style={{ padding: "10px 12px", color: C.muted, fontSize: 11.5 }}>
                    {b.wardName || "—"} · Room {b.roomNumber || "—"}
                  </td>
                  <td style={{ padding: "10px 12px", color: C.muted }}>
                    {b.reservationReason || b.isolationNotes || "—"}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <button onClick={() => unblockBed(b)} disabled={acting[b._id] === "loading"}
                      style={{
                        padding: "6px 12px", borderRadius: 6, border: "1.5px solid #86efac",
                        background: C.greenL, color: C.green,
                        fontSize: 11, fontWeight: 700,
                        cursor: acting[b._id] ? "not-allowed" : "pointer",
                      }}>
                      <i className="pi pi-check" style={{ fontSize: 10, marginRight: 4 }} />
                      Unblock → Available
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  );
}

/* ── Section card primitive ── */
function Section({ title, icon, color, count, children, empty }) {
  const isEmpty = count === 0;
  return (
    <div style={{
      background: C.card, border: `1.5px solid ${C.border}`,
      borderRadius: 12, marginBottom: 16, overflow: "hidden",
      boxShadow: "0 1px 3px rgba(15,23,42,.04)",
    }}>
      <div style={{
        padding: "12px 18px",
        background: `${color}08`, borderBottom: `1px solid ${color}20`,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <i className={`pi ${icon}`} style={{ color, fontSize: 14 }} />
        <span style={{ fontWeight: 800, fontSize: 13, color: C.text }}>{title}</span>
        <span style={{
          marginLeft: 8, fontSize: 10.5, fontWeight: 800,
          padding: "2px 8px", borderRadius: 4,
          background: `${color}12`, color,
          border: `1px solid ${color}30`,
        }}>{count}</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        {isEmpty ? (
          <div style={{ padding: "24px 18px", textAlign: "center", color: C.muted, fontSize: 13, fontStyle: "italic" }}>
            {empty}
          </div>
        ) : children}
      </div>
    </div>
  );
}

function Pill({ bg, c, children }) {
  return (
    <span style={{
      padding: "3px 9px", borderRadius: 4,
      background: bg, color: c,
      fontSize: 10, fontWeight: 800,
      border: `1px solid ${c}30`,
      whiteSpace: "nowrap",
    }}>{children}</span>
  );
}
