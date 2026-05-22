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
// R7ar-P1-14/D4-aq-02: centralised Decimal128 unwrap + INR formatters.
// Replaces the local toMoney/fmtCur shim that used to live near line 46.
import { toMoney, fmtINR0 as fmtCur, fmtINR2 as fmtCurExact } from "../../utils/money";
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
  // R7bb-E/D5-CRIT-4 — `can("doctor.self.write")` decides whether the
  // viewer can press "Next →" (call next token) or change the doctor's
  // status from the receptionist dashboard. Receptionists can SEE the
  // strip but can't drive someone else's availability — that's the
  // doctor's own self-write surface.
  const { user, can } = useAuth();
  const myUserId = user?._id || user?.id;
  const canDriveDoctorSelf = typeof can === "function" ? can("doctor.self.write") : false;
  const [date,       setDate]       = useState(today());
  const [collection, setCollection] = useState(null);
  const [queues,     setQueues]     = useState([]);
  const [presence,   setPresence]   = useState([]);
  const [loading,    setLoading]    = useState(true);

  // ── Tab state ──────────────────────────────────────────────
  // Two views on this page:
  //   "overview"   — the legacy stat tiles + breakdown cards
  //   "collection" — a line-by-line list of every bill the cashier
  //                  collected or generated today (request from
  //                  receptionist team — they wanted to "see what
  //                  I touched today" without leaving the dashboard).
  const [activeTab, setActiveTab] = useState("overview");
  // Today's bills for the Collection tab — fetched lazily the first
  // time the tab is opened, then refreshed on date change or manual
  // reload. Filtered client-side by `myOnly`, `statusFilter`, and a
  // free-text search box so the table stays responsive even when the
  // day's transaction count climbs into the hundreds.
  const [todaysBills,     setTodaysBills]     = useState([]);
  const [billsLoading,    setBillsLoading]    = useState(false);
  const [myOnly,          setMyOnly]          = useState(false);
  const [statusFilter,    setStatusFilter]    = useState("ALL");
  const [collSearch,      setCollSearch]      = useState("");

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
      // R7bh-F1 / META-4 (R7bg-6-CRIT-5): added the new day-book
      // endpoint alongside the legacy collection-summary so the
      // dashboard's totals reflect the reversed-refund cash-back leg
      // (A6-CRIT-6). Legacy still supplies byVisitType + advanceDue +
      // tpaPending which the new service doesn't expose; day-book
      // overrides totalCollected + txnCount so the KPI tiles show
      // the corrected figure.
      const [colRes, dayBookRes, qRes, pRes] = await Promise.allSettled([
        axios.get(`${API_ENDPOINTS.BASE}/billing/collection-summary`, { ...cfg, params: { date } }),
        axios.get(`${API_ENDPOINTS.BASE}/reports/day-book`,           { ...cfg, params: { date } }),
        axios.get(`${API_ENDPOINTS.BASE}/doctors/dashboard/queues`, cfg),
        axios.get(`${API_ENDPOINTS.BASE}/presence/active`, cfg),
      ]);
      if (signal?.aborted) return;
      if (colRes.status === "fulfilled") {
        const legacy = colRes.value.data || {};
        const db = dayBookRes.status === "fulfilled" ? (dayBookRes.value.data?.data || {}) : {};
        // Merge: day-book wins for collections + count + byMode (it
        // has the correct reversed-refund cash-back logic).
        const merged = {
          ...legacy,
          summary: {
            ...(legacy.summary || {}),
            totalCollected: db.summary?.collections      ?? legacy.summary?.totalCollected,
            txnCount:       db.summary?.collectionsCount ?? legacy.summary?.txnCount,
          },
          byMode: db.byMode?.length ? db.byMode : (legacy.byMode || []),
        };
        setCollection(merged);
      }
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

  // ── Today's bills (Collection tab) ─────────────────────────
  // Lazy-fetch: only fires when the user actually clicks the
  // Collection tab, then refreshes whenever date changes or on a
  // 25-second cadence (rather than fighting with the 20s overview
  // poll). Reuses /api/billing?startDate=…&endDate=… which already
  // supports the same UI semantics (and a populated patient ref so
  // we can show names without an extra round-trip).
  const loadTodaysBills = useCallback(async (signal) => {
    setBillsLoading(true);
    try {
      // listBills parses startDate/endDate via `new Date(str)` — passing
      // bare YYYY-MM-DD for both ends produces a zero-width range
      // (midnight UTC of that day for BOTH bounds, so $gte and $lte
      // collapse and nothing matches). Pad the end to 23:59:59.999 so
      // the query actually covers the full local day.
      const { data } = await axios.get(`${API_ENDPOINTS.BASE}/billing`, {
        params: {
          startDate: `${date}T00:00:00.000`,
          endDate:   `${date}T23:59:59.999`,
          limit:     500,
        },
        signal,
      });
      if (signal?.aborted) return;
      setTodaysBills(data?.data || []);
    } catch (e) {
      if (!axios.isCancel(e)) console.error("[ReceptionDashboard] todaysBills:", e?.message);
    } finally {
      if (!signal?.aborted) setBillsLoading(false);
    }
  }, [date]);

  useEffect(() => {
    if (activeTab !== "collection") return;
    const ac = new AbortController();
    loadTodaysBills(ac.signal);
    if (date === today()) {
      const t = setInterval(() => loadTodaysBills(ac.signal), 25000);
      return () => { clearInterval(t); ac.abort(); };
    }
    return () => ac.abort();
  }, [activeTab, date, loadTodaysBills]);

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
  // R7aw-FIX-F3/D4: unwrap Decimal128 wire shape via `toMoney` instead of
  // `|| 0`. Pre-fix, when /billing/collection-summary returned amounts as
  // `{$numberDecimal:"…"}` (Mongo Decimal128) the `|| 0` left the object
  // intact — every downstream `fmtCur(totalCollected)` and the
  // `modes.reduce(…+m.amount, 0)` total in the Payment-Mode card showed
  // ₹NaN. The KPI tiles (totalCollected, advanceDue, tpaPending) and the
  // by-visit/by-mode amounts all flow through this now-safe coercion.
  const totalCollected = toMoney(collection?.summary?.totalCollected);
  const txnCount       = collection?.summary?.txnCount || 0;
  const advanceDue     = toMoney(collection?.summary?.advanceDue);
  const tpaPending     = toMoney(collection?.summary?.tpaPending);

  const byVisitMap = useMemo(() => {
    const m = {};
    (collection?.byVisitType || []).forEach(v => { m[v.type] = v; });
    return m;
  }, [collection]);

  const modes = collection?.byMode || [];
  // R7aw-FIX-F3: same Decimal128 trap on per-mode amounts feeding the
  // percentage strip (m.amount/totalForPct). `toMoney(m.amount)` keeps the
  // reduce numeric instead of NaN.
  const totalForPct = modes.reduce((s, m) => s + toMoney(m.amount), 0) || 1;

  const isToday = date === today();
  const isFuture = date > today();

  // ── Collection-tab derived values ──────────────────────────
  // Filter the day's bills by the toolbar controls. Search matches
  // bill number, patient name, or UHID — same semantics as the
  // Billing Counter smart-search so the receptionist's muscle memory
  // carries over.
  const filteredBills = useMemo(() => {
    const q = (collSearch || "").trim().toLowerCase();
    let rows = todaysBills.slice();
    if (myOnly) {
      const me = String(myUserId || "");
      rows = rows.filter(b => {
        const ids = [
          b.generatedBy, b.receivedBy, b.collectedBy,
          ...((b.payments || []).map(p => p.receivedById || p.receivedBy)),
        ].filter(Boolean).map(String);
        return ids.some(x => x === me);
      });
    }
    if (statusFilter !== "ALL") {
      rows = rows.filter(b => (b.billStatus || "").toUpperCase() === statusFilter);
    }
    if (q) {
      rows = rows.filter(b =>
        (b.billNumber || "").toLowerCase().includes(q) ||
        (b.patientName || b.patient?.fullName || "").toLowerCase().includes(q) ||
        (b.UHID || b.patient?.UHID || "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [todaysBills, myOnly, statusFilter, collSearch, myUserId]);

  const collectionTotals = useMemo(() => {
    const sum = filteredBills.reduce((acc, b) => {
      const net  = toMoney(b.netAmount);
      const paid = toMoney(b.advancePaid ?? b.totalPaid);
      acc.net  += net;
      acc.paid += paid;
      acc.due  += Math.max(0, net - paid);
      if ((b.billStatus || "").toUpperCase() === "DRAFT")     acc.drafts += 1;
      if ((b.billStatus || "").toUpperCase() === "GENERATED") acc.open   += 1;
      if ((b.billStatus || "").toUpperCase() === "PAID")      acc.paidBills += 1;
      return acc;
    }, { net: 0, paid: 0, due: 0, drafts: 0, open: 0, paidBills: 0 });
    return sum;
  }, [filteredBills]);

  // Payment-mode summary on each row — "CASH+UPI" if the bill saw
  // multiple modes today, single label otherwise. Empty for DRAFTs.
  const modesFor = (b) => {
    const set = new Set((b.payments || []).map(p => (p.paymentMode || p.mode || "").toUpperCase()).filter(Boolean));
    return Array.from(set).join("+");
  };

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

      {/* ── Tab strip — Overview / Collection ── */}
      <div className="rd-tabs">
        <button className={`rd-tab ${activeTab === "overview"   ? "rd-tab--active" : ""}`}
                onClick={() => setActiveTab("overview")}>
          <i className="pi pi-th-large" /> Overview
        </button>
        <button className={`rd-tab ${activeTab === "collection" ? "rd-tab--active" : ""}`}
                onClick={() => setActiveTab("collection")}>
          <i className="pi pi-receipt" /> Collection
          {todaysBills.length > 0 && (
            <span className="rd-tab-count">{todaysBills.length}</span>
          )}
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

      {/* Overview wraps the stat tiles + breakdown grid below. */}
      {activeTab === "overview" && (
      <>
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
          // R7aw-FIX-F3/D4: `byVisitMap[t]?.amount` is Decimal128 — compare
          // against 0 via `toMoney(…) > 0`, else the bare object compared
          // > 0 is always falsey and the Services tile never shows.
          .filter(t => t !== "Services" || toMoney(byVisitMap[t]?.amount) > 0 || (byVisitMap[t]?.count || 0) > 0)
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
                  {/* R7bb-E/D5-CRIT-4 — Next/status are gated by doctor.self.write
                      so Receptionist/Accountant viewers see read-only doctor info
                      instead of buttons the backend would 403 on. */}
                  {isToday && canDriveDoctorSelf && d.waiting > 0 && (
                    <button className="rd-doc-btn rd-doc-btn--next" onClick={() => serveNext(d._id)}
                            title="Call next patient">
                      Next →
                    </button>
                  )}
                  {isToday && canDriveDoctorSelf && (
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
                  {isToday && !canDriveDoctorSelf && (
                    <span className="rd-doc-status-label" style={{ fontSize:11, color:"#64748b", fontWeight:600 }}>
                      {STATUS_LABEL[d.availability?.status || "Offline"]}
                    </span>
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
              // R7aw-FIX-F3/D4: same Decimal128 unwrap so the percentage
              // calc doesn't render "NaN%" when the wire shape is raw.
              const pct = ((toMoney(m.amount) / totalForPct) * 100).toFixed(0);
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
      </>
      )}

      {/* ════════════════ COLLECTION TAB ════════════════════════════
          Line-by-line list of every bill the receptionist DRAFTed,
          generated, or collected today. Click a row to jump back into
          /reception-billing/:UHID with that bill highlighted. Mirrors
          the columns the Accountant uses for end-of-day reconciliation
          so a handover snapshot is one screenshot away. */}
      {activeTab === "collection" && (
        <div className="rd-collection">
          {/* Toolbar — search + status filter + "my bills only" toggle */}
          <div className="rd-coll-toolbar">
            <div className="rx-search rd-coll-search">
              <i className="pi pi-search" />
              <input type="text"
                     placeholder="Bill #, patient name, or UHID…"
                     value={collSearch}
                     onChange={e => setCollSearch(e.target.value)} />
            </div>
            <select className="his-select rd-coll-status"
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}>
              <option value="ALL">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="GENERATED">Generated</option>
              <option value="PARTIAL">Partial</option>
              <option value="PAID">Paid</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="REFUNDED">Refunded</option>
            </select>
            <label className="rd-coll-myonly" title="Show only bills I personally touched today">
              <input type="checkbox"
                     checked={myOnly}
                     onChange={e => setMyOnly(e.target.checked)} />
              My bills only
            </label>
            <button className="rd-btn-ghost"
                    onClick={() => { const ac = new AbortController(); loadTodaysBills(ac.signal); }}
                    title="Refresh">
              <i className={`pi ${billsLoading ? "pi-spin pi-spinner" : "pi-refresh"}`} /> Refresh
            </button>
          </div>

          {/* Strip-summary chips — quick eyeballable numbers above the table */}
          <div className="rd-coll-chips">
            <span className="rd-coll-chip">
              <strong>{filteredBills.length}</strong> bill{filteredBills.length === 1 ? "" : "s"}
            </span>
            <span className="rd-coll-chip rd-coll-chip--success">
              Collected <strong>{fmtCur(collectionTotals.paid)}</strong>
            </span>
            <span className="rd-coll-chip rd-coll-chip--danger">
              Due <strong>{fmtCur(collectionTotals.due)}</strong>
            </span>
            <span className="rd-coll-chip">
              Net <strong>{fmtCur(collectionTotals.net)}</strong>
            </span>
            <span className="rd-coll-chip">
              {collectionTotals.drafts} draft · {collectionTotals.open} open · {collectionTotals.paidBills} paid
            </span>
          </div>

          {/* Table */}
          <div className="rd-coll-tablewrap">
            {billsLoading && filteredBills.length === 0 ? (
              <div className="rd-empty"><i className="pi pi-spin pi-spinner" /> Loading…</div>
            ) : filteredBills.length === 0 ? (
              <div className="rd-empty">
                <span className="rd-empty-icon">🧾</span>
                {todaysBills.length === 0
                  ? "No bills touched yet today."
                  : "No bills match the current filters."}
              </div>
            ) : (
              <table className="rd-coll-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Bill #</th>
                    <th>Patient</th>
                    <th>Visit</th>
                    <th>Status</th>
                    <th>Mode</th>
                    <th className="right">Net</th>
                    <th className="right">Paid</th>
                    <th className="right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBills.map(b => {
                    const net  = toMoney(b.netAmount);
                    const paid = toMoney(b.advancePaid ?? b.totalPaid);
                    const bal  = Math.max(0, net - paid);
                    const status = (b.billStatus || "—").toUpperCase();
                    const statusCls = status === "PAID"      ? "rd-status-paid"
                                   : status === "PARTIAL"   ? "rd-status-partial"
                                   : status === "GENERATED" ? "rd-status-generated"
                                   : status === "DRAFT"     ? "rd-status-draft"
                                   : status === "CANCELLED" ? "rd-status-cancelled"
                                   : "rd-status-other";
                    const when = b.payments?.length
                      ? new Date(b.payments[b.payments.length - 1].paidAt || b.updatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                      : new Date(b.billDate || b.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
                    const uhid = b.UHID || b.patient?.UHID;
                    const name = b.patientName || b.patient?.fullName || "—";
                    return (
                      <tr key={b._id}
                          className="rd-coll-row"
                          onClick={() => uhid && navigate(`/reception-billing/${encodeURIComponent(uhid)}`)}
                          title={`Open ${name} (${uhid || ""})`}>
                        <td className="rd-coll-time">{when}</td>
                        <td className="rd-coll-billno">{b.billNumber || "DRAFT"}</td>
                        <td>
                          <div className="rd-coll-patient">{name}</div>
                          {uhid && <div className="rd-coll-uhid">{uhid}</div>}
                        </td>
                        <td>{b.visitType || "—"}</td>
                        <td><span className={`rd-coll-status ${statusCls}`}>{status}</span></td>
                        <td className="rd-coll-mode">{modesFor(b) || "—"}</td>
                        <td className="right">{fmtCur(net)}</td>
                        <td className="right rx-text-success">{fmtCur(paid)}</td>
                        <td className={`right ${bal > 0 ? "rx-text-danger" : "rx-text-success"}`}>
                          {fmtCur(bal)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div className="rd-floating-loader">
          <i className="pi pi-spin pi-spinner" /> Loading…
        </div>
      )}
    </div>
  );
}
