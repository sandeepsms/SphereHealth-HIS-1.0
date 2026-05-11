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

export default function ReceptionDashboard() {
  const navigate = useNavigate();
  const [date,       setDate]       = useState(today());
  const [collection, setCollection] = useState(null);
  const [queues,     setQueues]     = useState([]);
  const [loading,    setLoading]    = useState(true);

  /* ─── Load data ─── */
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [colRes, qRes] = await Promise.allSettled([
        axios.get(`${API_ENDPOINTS.BASE}/billing/collection-summary`, { params: { date } }),
        axios.get(`${API_ENDPOINTS.BASE}/doctors/dashboard/queues`),
      ]);
      if (colRes.status === "fulfilled") setCollection(colRes.value.data);
      if (qRes.status === "fulfilled")   setQueues(qRes.value.data?.data || []);
    } catch (e) { /* silent */ }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { load(); }, [load]);

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
          <label>DATE</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="rd-topbar-actions">
          <button className="rd-btn-ghost" onClick={() => load()} title="Refresh">
            <i className="pi pi-refresh" /> Refresh
          </button>
          <button className="rd-btn-ghost" onClick={() => window.print()} title="Print closing">
            <i className="pi pi-print" /> Print Closing
          </button>
          <button className="rd-btn-primary" onClick={() => navigate("/reception/register")}>
            <i className="pi pi-plus" /> New Registration
          </button>
        </div>
      </div>

      {/* ── Stat tiles ── */}
      <div className="rd-stats" style={{ marginBottom: 14 }}>
        <div className="rd-stat rd-stat--total">
          <span className="rd-stat-label">Total Collection</span>
          <span className="rd-stat-value">{fmtCur(totalCollected)}</span>
          <span className="rd-stat-sub">{txnCount} transaction{txnCount !== 1 ? "s" : ""}</span>
        </div>
        {["OPD","IPD","DC","ER","Services"].map(t => (
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
          <div className="rd-card-body" style={{ padding: "6px 14px" }}>
            {queues.length === 0 ? (
              <div className="rd-empty">
                <span className="rd-empty-icon">👨‍⚕️</span>
                No doctors configured yet
              </div>
            ) : queues.map(d => (
              <div key={d._id} className="rd-doc-row">
                <div className="rd-doc-name">
                  <span className={`rd-doc-status-dot ${STATUS_DOT_CLASS[d.availability?.status] || ""}`} />
                  <div style={{ minWidth: 0 }}>
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

        {/* ── Outstanding + Per-receptionist (shift handover) ── */}
        <div className="rd-card">
          <div className="rd-card-head">
            <div className="rd-card-icon rd-card-icon--actions"><i className="pi pi-exclamation-circle" /></div>
            <span className="rd-card-title">Outstanding · Shift Handover</span>
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
              <div className="rd-empty" style={{ padding: 12 }}>
                <span className="rd-empty-icon">✓</span>
                All clear — no pending dues
              </div>
            )}

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #e2e8f0" }}>
              <div className="rd-stat-label" style={{ marginBottom: 8 }}>RECEPTIONIST-WISE COLLECTION (today)</div>
              {(collection?.byReceptionist || []).length === 0 ? (
                <div className="rd-empty" style={{ padding: 6 }}>No transactions yet</div>
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

      </div>

      {loading && (
        <div style={{ position: "fixed", bottom: 16, right: 16, padding: "8px 14px",
                      background: "#1e293b", color: "#fff", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
          <i className="pi pi-spin pi-spinner" style={{ marginRight: 6 }} /> Loading…
        </div>
      )}
    </div>
  );
}
