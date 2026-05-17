/**
 * ReceptionDashboard.jsx
 *
 * Front-desk "control tower":
 *   • Today's totals (OPD / IPD / DC / ER / Services)
 *   • Live Doctor strip — status, current token, waiting count
 *   • Collection breakdown (by payment mode + by doctor)
 *   • Outstanding (IPD advance dues, TPA pending)
 *   • Per-receptionist split (for shift handover)
 *   • Date picker — today, past, future (planning view)
 *
 * Polls every 20s; refreshes on window focus.
 * No inline JS styles — all visuals in ReceptionDashboard.css.
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { useReceptionistPresence } from "../../hooks/useReceptionistPresence";
import { useAuth } from "../../context/AuthContext";
import "./ReceptionDashboard.css";

const STATUS_LABEL = {
  Available:       "Available",
  InConsultation:  "In Consultation",
  OnBreak:         "On Break",
  OnLeave:         "On Leave",
  Offline:         "Offline",
};
const STATUS_DOT_CLASS = {
  Available:        "rd-doc-status-dot--available",
  InConsultation:   "rd-doc-status-dot--inconsultation",
  OnBreak:          "rd-doc-status-dot--onbreak",
  OnLeave:          "rd-doc-status-dot--onleave",
  Offline:          "rd-doc-status-dot--offline",
};

const fmtCur = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtCurExact = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const today = () => new Date().toISOString().slice(0, 10);
const fmtDateLong = (d) => new Date(d).toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

// Plain-English description of what a fellow receptionist is currently
// doing — used by the presence strip. Extracted out of the JSX to avoid
// the nested ternary that the audit flagged.
const presenceDoing = (p) => {
  if (p.action === "registering" && p.currentResource?.label) return `registering ${p.currentResource.label}`;
  if (p.action === "editing"     && p.currentResource?.label) return `editing ${p.currentResource.label}`;
  if (p.action === "viewing-dashboard") return "on dashboard";
  return p.action || "idle";
};

export default function ReceptionDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const myUserId = user?._id || user?.id;
  const [date,       setDate]       = useState(today());
  const [collection, setCollection] = useState(null);
  const [queues,     setQueues]     = useState([]);
  const [presence,   setPresence]   = useState([]);
  const [loading,    setLoading]    = useState(true);

  // Broadcast our own presence (so the other receptionist can see us)
  useReceptionistPresence({ type: "idle", action: "viewing-dashboard" });

  /* ─── Load data ─── */
  // AbortController guards the dashboard's 3 parallel fetches against
  // setState-on-unmount when the user navigates away during the request
  // (audit E-05). Each axios call gets the same signal; the cleanup
  // function in the consuming useEffect aborts them.
  const load = useCallback(async (silent = false, signal = undefined) => {
    if (!silent) setLoading(true);
    try {
      const cfg = signal ? { signal } : {};
      const [colRes, qRes, pRes] = await Promise.allSettled([
        axios.get(`${API_ENDPOINTS.BASE}/billing/collection-summary`, { ...cfg, params: { date } }),
        axios.get(`${API_ENDPOINTS.BASE}/doctors/dashboard/queues`, cfg),
        axios.get(`${API_ENDPOINTS.BASE}/presence/active`, cfg),
      ]);
      if (signal?.aborted) return;
      if (colRes.status === "fulfilled") setCollection(colRes.value.data);
      if (qRes.status === "fulfilled")   setQueues(qRes.value.data?.data || []);
      if (pRes.status === "fulfilled")   setPresence(pRes.value.data?.data || []);
      // Surface individual failures (audit E-06). Individual rejections
      // don't blow up the page (Promise.allSettled) but the operator
      // deserves to know if doctor queue / presence didn't load.
      if (colRes.status === "rejected" && !axios.isCancel(colRes.reason)) {
        console.error("[ReceptionDashboard] collection-summary:", colRes.reason?.message);
      }
      if (qRes.status === "rejected" && !axios.isCancel(qRes.reason)) {
        console.error("[ReceptionDashboard] doctor queues:", qRes.reason?.message);
      }
      if (pRes.status === "rejected" && !axios.isCancel(pRes.reason)) {
        console.error("[ReceptionDashboard] presence:", pRes.reason?.message);
      }
    } catch (e) {
      if (!axios.isCancel(e)) console.error("[ReceptionDashboard] load:", e?.message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const ac = new AbortController();
    load(false, ac.signal);
    return () => ac.abort();
  }, [load]);

  // Auto-refresh every 20s + on window focus (only when viewing today)
  useEffect(() => {
    if (date !== today()) return;
    const t = setInterval(() => load(true), 20000);
    const onFocus = () => load(true);
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [date, load]);

  /* ─── Mark current token served (doctor's panel will call this, but
   *     reception can also trigger if doctor forgets) ─── */
  const serveNext = async (doctorId) => {
    try {
      await axios.post(`${API_ENDPOINTS.BASE}/doctors/${doctorId}/serve-next`);
      load(true);
      toast.success("Next patient called");
    } catch (e) { toast.error("Could not advance queue"); }
  };

  const setStatus = async (doctorId, status) => {
    try {
      await axios.patch(`${API_ENDPOINTS.BASE}/doctors/${doctorId}/availability`, { status });
      load(true);
    } catch (e) { toast.error("Could not update status"); }
  };

  /* ─── Derived ─── */
  const totalCollected = collection?.summary?.totalCollected || 0;
  const txnCount       = collection?.summary?.txnCount || 0;
  const advanceDue     = collection?.summary?.advanceDue || 0;
  const tpaPending     = collection?.summary?.tpaPending || 0;

  const byVisitMap = useMemo(() => {
    const m = {};
    (collection?.byVisitType || []).forEach(v => { m[v.type] = v; });
    return m;
  }, [collection]);

  const modes = collection?.byMode || [];
  const totalForPct = modes.reduce((s, m) => s + m.amount, 0) || 1;

  const isToday = date === today();
  const isFuture = date > today();

  /* ════════════════ RENDER ════════════════ */
  return (
    <div className="rd-page">

      {/* ── Top bar ── */}
      <div className="rd-topbar">
        <div>
          <div className="rd-topbar-title">
            <i className="pi pi-desktop" />
            <span>Reception Dashboard</span>
          </div>
          <div className="rd-topbar-meta">{fmtDateLong(date)}{isToday && " · Live"}</div>
        </div>
        <div className="rd-date-picker">
          <label>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="rd-topbar-actions">
          <button className="rd-btn-ghost" onClick={() => load()} title="Refresh">
            <i className="pi pi-refresh" /> Refresh
          </button>
          {/* `Print Closing` button removed — raw `window.print()` printed
              the entire app shell (sidebar, top nav, menu) producing an
              unusable page. End-of-day closing report belongs in a
              dedicated `/reception/closing-report` route with its own
              print stylesheet. */}
          <button className="rd-btn-primary" onClick={() => navigate("/reception/register")}>
            <i className="pi pi-plus" /> New Registration
          </button>
        </div>
      </div>

      {/* ── Quick actions — common destinations one tap away ──
          Placed right under the topbar so the receptionist doesn't have
          to scroll into a card to start a workflow. Each tile is a
          plain button with an icon + label; navigation happens via
          react-router so the page transition uses the SPA route. */}
      <div className="rd-quick-actions">
        <button className="rd-qa-tile" onClick={() => navigate("/reception/register")}>
          <i className="pi pi-user-plus" />
          <span>New Registration</span>
        </button>
        <button className="rd-qa-tile" onClick={() => navigate("/patient-search")}>
          <i className="pi pi-search" />
          <span>Patient Search</span>
        </button>
        <button className="rd-qa-tile" onClick={() => navigate("/appointments")}>
          <i className="pi pi-calendar-plus" />
          <span>Appointments</span>
        </button>
        <button className="rd-qa-tile" onClick={() => navigate("/reception-billing")}>
          <i className="pi pi-receipt" />
          <span>Billing & Payments</span>
        </button>
        <button className="rd-qa-tile" onClick={() => navigate("/visitor-passes")}>
          <i className="pi pi-id-card" />
          <span>Visitor Passes</span>
        </button>
        <button className="rd-qa-tile" onClick={() => navigate("/discharge-queue")}>
          <i className="pi pi-sign-out" />
          <span>Discharge Queue</span>
        </button>
      </div>

      {/* ── Live Receptionist Presence strip ── */}
      {isToday && presence.length > 0 && (
        <div className="rd-presence-strip rd-presence-row">
          <i className="pi pi-users" />
          <span className="rd-presence-label">
            Active Right Now ({presence.length})
          </span>
          {presence.map(p => {
            const secondsAgo = Math.floor((Date.now() - new Date(p.lastHeartbeatAt)) / 1000);
            const isMe = String(p.userId) === String(myUserId || "");
            return (
              <div key={p.userId} className={`rd-presence-chip ${isMe ? "rd-presence-chip--me" : ""}`}>
                <span className="rd-presence-dot" />
                <span className="rd-presence-name">{p.userName}{isMe ? " (you)" : ""}</span>
                <span className="rd-presence-doing">{presenceDoing(p)}</span>
                <span className="rd-presence-ago">{secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.floor(secondsAgo/60)}m ago`}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Stat tiles ── */}
      <div className="rd-stats rd-stats--mb">
        <div className="rd-stat rd-stat--total">
          <span className="rd-stat-label">Total Collection</span>
          <span className="rd-stat-value">{fmtCur(totalCollected)}</span>
          <span className="rd-stat-sub">{txnCount} transaction{txnCount !== 1 ? "s" : ""}</span>
        </div>
        {/* `Services` tile drops out when zero — most clinics don't sell
            standalone services from reception so the empty tile was just
            visual noise. OPD/IPD/DC/ER always render even at zero so
            the layout stays predictable shift-to-shift. */}
        {["OPD","IPD","DC","ER","Services"]
          .filter(t => t !== "Services" || (byVisitMap[t]?.amount || 0) > 0 || (byVisitMap[t]?.count || 0) > 0)
          .map(t => (
            <div key={t} className={`rd-stat rd-stat--${t.toLowerCase()}`}>
              <span className="rd-stat-label">{t === "DC" ? "Day Care" : t}</span>
              <span className="rd-stat-value">{fmtCur(byVisitMap[t]?.amount || 0)}</span>
              <span className="rd-stat-sub">{byVisitMap[t]?.count || 0} visits</span>
            </div>
          ))}
      </div>

      {/* ── Two-column grid ── */}
      <div className="rd-grid">

        {/* ── Live Doctor Strip ── */}
        <div className="rd-card">
          <div className="rd-card-head">
            <div className="rd-card-icon rd-card-icon--doctor"><i className="pi pi-user-md" /></div>
            <span className="rd-card-title">Doctor Availability — Live Queue</span>
            <span className="rd-card-meta">{queues.length} doctor{queues.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="rd-card-body rd-card-body--tight">
            {queues.length === 0 ? (
              <div className="rd-empty">
                <span className="rd-empty-icon">👨‍⚕️</span>
                No doctors configured yet
              </div>
            ) : queues.map(d => (
              <div key={d._id} className="rd-doc-row">
                <div className="rd-doc-name">
                  <span className={`rd-doc-status-dot ${STATUS_DOT_CLASS[d.availability?.status] || ""}`} />
                  <div className="rd-min-zero">
                    <div className="rd-doc-info-name">{d.fullName}</div>
                    <div className="rd-doc-info-spec">{d.specialization} · {d.department || "—"}</div>
                    {d.availability?.note && <div className="rd-doc-info-note">📝 {d.availability.note}</div>}
                  </div>
                </div>
                <div className="rd-doc-queue">
                  <span className="rd-doc-token" title="Currently serving token">
                    Now: #{d.currentlyServing || "—"}
                  </span>
                  {d.waiting > 0 && (
                    <span className="rd-doc-token rd-doc-token--waiting" title="Patients waiting">
                      {d.waiting} waiting
                    </span>
                  )}
                </div>
                <div className="rd-doc-actions">
                  {isToday && d.waiting > 0 && (
                    <button className="rd-doc-btn rd-doc-btn--next" onClick={() => serveNext(d._id)}
                            title="Call next patient">
                      Next →
                    </button>
                  )}
                  {isToday && (
                    <select
                      className="rd-doc-btn"
                      value={d.availability?.status || "Offline"}
                      onChange={e => setStatus(d._id, e.target.value)}
                    >
                      {Object.entries(STATUS_LABEL).map(([k, v]) =>
                        <option key={k} value={k}>{v}</option>
                      )}
                    </select>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Payment-mode breakdown ── */}
        <div className="rd-card">
          <div className="rd-card-head">
            <div className="rd-card-icon rd-card-icon--mode"><i className="pi pi-credit-card" /></div>
            <span className="rd-card-title">Payment Mode Breakdown</span>
          </div>
          <div className="rd-card-body">
            {modes.length === 0 ? (
              <div className="rd-empty">
                <span className="rd-empty-icon">💳</span>
                No payments recorded
              </div>
            ) : modes.map(m => {
              const pct = ((m.amount / totalForPct) * 100).toFixed(0);
              const cls = m.mode.toLowerCase();
              return (
                <div key={m.mode} className="rd-mode">
                  <span className="rd-mode-label">{m.mode}</span>
                  <div className="rd-mode-bar">
                    <div className={`rd-mode-bar-fill rd-mode-bar-fill--${cls}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="rd-mode-amount">{fmtCur(m.amount)}</span>
                  <span className="rd-mode-pct">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Doctor-wise revenue ── */}
        <div className="rd-card">
          <div className="rd-card-head">
            <div className="rd-card-icon rd-card-icon--patients"><i className="pi pi-chart-bar" /></div>
            <span className="rd-card-title">Doctor-wise Revenue</span>
          </div>
          <div className="rd-card-body">
            {(collection?.byDoctor || []).length === 0 ? (
              <div className="rd-empty">
                <span className="rd-empty-icon">📊</span>
                No consultation revenue yet
              </div>
            ) : (collection.byDoctor || []).map(d => (
              <div key={d.doctorId} className="rd-doc-rev-row">
                <div>
                  <span className="rd-doc-rev-name">{d.name}</span>
                  {d.specialization && <span className="rd-doc-rev-spec"> · {d.specialization}</span>}
                </div>
                <span className="rd-doc-rev-count">{d.count} {d.count === 1 ? "patient" : "patients"}</span>
                <span className="rd-doc-rev-amount">{fmtCur(d.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Outstanding dues — action-needed alerts ──
            Previously this was mashed together with the per-receptionist
            shift-handover split. Now split into two cards: this one
            shows live items needing attention (TPA pending, IPD
            advance dues). It's the receptionist's pending-action
            list — a TPA total >0 means a coordinator owes follow-up. */}
        <div className="rd-card">
          <div className="rd-card-head">
            <div className="rd-card-icon rd-card-icon--actions"><i className="pi pi-exclamation-circle" /></div>
            <span className="rd-card-title">Outstanding Dues</span>
          </div>
          <div className="rd-card-body">
            {advanceDue > 0 && (
              <div className="rd-alert">
                <i className="pi pi-wallet rd-alert-icon" />
                <span className="rd-alert-text">IPD advance dues pending</span>
                <span className="rd-alert-amount">{fmtCurExact(advanceDue)}</span>
              </div>
            )}
            {tpaPending > 0 && (
              <div className="rd-alert">
                <i className="pi pi-shield rd-alert-icon" />
                <span className="rd-alert-text">TPA / Insurance claims pending</span>
                <span className="rd-alert-amount">{fmtCurExact(tpaPending)}</span>
              </div>
            )}
            {advanceDue === 0 && tpaPending === 0 && (
              <div className="rd-empty rd-empty--small">
                <span className="rd-empty-icon">✓</span>
                All clear — no pending dues
              </div>
            )}
          </div>
        </div>

        {/* ── Shift Handover — per-receptionist collection split ──
            Analytical, end-of-shift view: how much each receptionist
            collected today. Used to reconcile cash drawer at handover.
            Sits in its own card now so the layout doesn't lump it with
            live action items above. */}
        <div className="rd-card">
          <div className="rd-card-head">
            <div className="rd-card-icon rd-card-icon--patients"><i className="pi pi-users" /></div>
            <span className="rd-card-title">Shift Handover — Per-Receptionist</span>
            <span className="rd-card-meta">{(collection?.byReceptionist || []).length}</span>
          </div>
          <div className="rd-card-body">
            {(collection?.byReceptionist || []).length === 0 ? (
              <div className="rd-empty rd-empty--small">
                <span className="rd-empty-icon">🧾</span>
                No transactions yet today
              </div>
            ) : (collection.byReceptionist || []).map(r => (
              <div key={r.id} className="rd-doc-rev-row">
                <div>
                  <span className="rd-doc-rev-name">{r.name}</span>
                </div>
                <span className="rd-doc-rev-count">{r.count} {r.count === 1 ? "txn" : "txns"}</span>
                <span className="rd-doc-rev-amount">{fmtCur(r.amount)}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {loading && (
        <div className="rd-floating-loader">
          <i className="pi pi-spin pi-spinner" /> Loading…
        </div>
      )}
    </div>
  );
}
