/**
 * MedReconciliationTab.jsx — Roadmap A2.
 *
 * NABH MOM.4d Medication Reconciliation. Three columns:
 *   Home (pre-admission)  →  Inpatient (active orders)  →  Discharge (proposed)
 *
 * Doctor reviews each drug and selects an action (Continue / Modify /
 * Stop / New / Hold). Action + reason are persisted via PATCH to a
 * single row. "Sign at Admission" and "Sign at Discharge" buttons mark
 * the two NABH reference points; the discharge sign-off also pushes
 * the finalised list into the DischargeSummary so the printed summary
 * matches.
 *
 * Lazy-loaded by the patient panel (Vite chunk: panel-tabs).
 */

import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../../config/api";

const BASE = API_ENDPOINTS.BASE;
const ACTIONS = ["CONTINUE", "MODIFY", "STOP", "NEW", "HOLD"];
const ACTION_TINT = {
  CONTINUE: "ok",
  MODIFY:   "info",
  STOP:     "danger",
  NEW:      "info",
  HOLD:     "warn",
};

function rowKey(r) {
  return `${(r.drugName || "").toLowerCase().replace(/\s+/g, "")}-${(r.dose || "").toLowerCase()}`;
}

export default function MedReconciliationTab({ admission, patient }) {
  const [doc, setDoc]         = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState("");
  const [savingRow, setSavingRow] = useState("");

  // Load (or detect missing) reconciliation doc for this admission.
  useEffect(() => {
    if (!admission?._id) return;
    let cancel = false;
    setLoading(true); setErr("");
    axios.get(`${BASE}/med-reconciliation/admission/${admission._id}`)
      .then((r) => { if (!cancel) setDoc(r.data?.data || null); })
      .catch((e) => { if (!cancel) setErr(e.response?.data?.message || e.message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [admission?._id]);

  const seed = async () => {
    if (!admission?._id) return;
    setLoading(true); setErr("");
    try {
      const r = await axios.post(`${BASE}/med-reconciliation/admission/${admission._id}/seed`);
      setDoc(r.data.data);
    } catch (e) { setErr(e.response?.data?.message || e.message); }
    finally { setLoading(false); }
  };

  const patchRow = async (rowId, patch) => {
    if (!admission?._id) return;
    setSavingRow(rowId);
    try {
      const r = await axios.patch(`${BASE}/med-reconciliation/admission/${admission._id}/row/${rowId}`, patch);
      setDoc(r.data.data);
    } catch (e) { alert("Save failed: " + (e.response?.data?.message || e.message)); }
    finally { setSavingRow(""); }
  };

  const signPhase = async (phase) => {
    if (!admission?._id) return;
    if (phase === "discharge") {
      const unsigned = (doc?.rows || []).filter((r) => !r.action || (r.action !== "CONTINUE" && !r.actionReason));
      if (unsigned.length > 0) {
        if (!window.confirm(`${unsigned.length} row(s) lack an explicit action/reason. Sign anyway?`)) return;
      }
    }
    setLoading(true);
    try {
      const r = await axios.post(`${BASE}/med-reconciliation/admission/${admission._id}/review/${phase}`);
      setDoc(r.data.data);
      alert(`✓ ${phase === "admit" ? "Admission" : "Discharge"} reconciliation signed`);
    } catch (e) { alert("Sign failed: " + (e.response?.data?.message || e.message)); }
    finally { setLoading(false); }
  };

  if (loading && !doc) return <div className="pf-spin-row"><div className="pf-spinner" /></div>;
  if (err) return <div className="pf-alert pf-alert--danger"><span className="pf-alert__icon">⚠️</span><div className="pf-alert__body"><div className="pf-alert__title">Could not load reconciliation</div><div className="pf-alert__msg">{err}</div></div></div>;

  if (!doc) {
    return (
      <div className="pf-section-card pf-section-card--info">
        <div className="pf-section-card__head">
          <span className="pf-section-card__icon">💊</span>
          <span className="pf-section-card__title">Medication Reconciliation — NABH MOM.4d</span>
        </div>
        <div className="pf-section-card__body pf-section-card__body--pad">
          <p style={{ fontSize: 13, color: "var(--pf-muted)", marginTop: 0 }}>
            No reconciliation record exists yet for this admission. Click below to seed it with
            the patient's home medications (from intake) plus the active inpatient orders.
          </p>
          <button className="pf-action pf-action--accent" onClick={seed} disabled={loading || !admission?._id}>
            {loading ? "Seeding…" : "🌱 Seed Reconciliation"}
          </button>
        </div>
      </div>
    );
  }

  // Group rows by source for the 3-column layout. Inpatient column also
  // includes the live-joined orders the API returns.
  const home       = (doc.rows || []).filter((r) => r.source === "home");
  const inpatient  = [...(doc.rows || []).filter((r) => r.source === "inpatient"), ...(doc.inpatient || []).map((o) => ({
    _liveOrder: true,
    drugName: o.orderDetails?.medicineName || "",
    dose:     o.orderDetails?.dose || "",
    route:    o.orderDetails?.route || "",
    frequency:o.orderDetails?.frequency || "",
    doctorOrderId: o._id,
  }))];
  const dedupInpatient = Array.from(new Map(inpatient.map((r) => [rowKey(r), r])).values());
  const discharge  = (doc.rows || []).filter((r) => ["NEW","MODIFY","CONTINUE"].includes(r.action));

  return (
    <div className="pf-tint--doctor" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header + sign buttons */}
      <div className="pf-section-card">
        <div className="pf-section-card__head">
          <span className="pf-section-card__icon">💊</span>
          <span className="pf-section-card__title">Medication Reconciliation</span>
          <span className="pf-section-card__count">{(doc.rows || []).length} drugs</span>
        </div>
        <div className="pf-section-card__body pf-section-card__body--pad">
          <div className="pf-pill-row">
            <div className={`pf-pill ${doc.admitReviewedAt ? "pf-pill--ok" : "pf-pill--warn"}`}>
              <span className="pf-pill__label">Admit Review</span>
              <span className="pf-pill__val">{doc.admitReviewedAt ? "✓" : "—"}</span>
            </div>
            <div className={`pf-pill ${doc.dischargeReviewedAt ? "pf-pill--ok" : "pf-pill--warn"}`}>
              <span className="pf-pill__label">Discharge Review</span>
              <span className="pf-pill__val">{doc.dischargeReviewedAt ? "✓" : "—"}</span>
            </div>
            <div className="pf-pill pf-pill--neutral">
              <span className="pf-pill__label">Home Meds</span>
              <span className="pf-pill__val">{home.length}</span>
            </div>
            <div className="pf-pill pf-pill--neutral">
              <span className="pf-pill__label">Active Now</span>
              <span className="pf-pill__val">{dedupInpatient.length}</span>
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!doc.admitReviewedAt && (
              <button className="pf-action pf-action--ghost" onClick={() => signPhase("admit")} disabled={loading}>
                ✓ Sign at Admission
              </button>
            )}
            <button className="pf-action pf-action--accent" onClick={() => signPhase("discharge")} disabled={loading}>
              ✓ Sign at Discharge
            </button>
            <button className="pf-action pf-action--quiet" onClick={seed} disabled={loading}>
              🔄 Re-seed from chart
            </button>
          </div>
          {doc.admitReviewedAt && (
            <div className="pf-fhint" style={{ marginTop: 8 }}>
              Admit reviewed by <strong>{doc.admitReviewedBy}</strong>{doc.admitReviewedByReg ? ` (Reg ${doc.admitReviewedByReg})` : ""} on {new Date(doc.admitReviewedAt).toLocaleString("en-IN")}
            </div>
          )}
          {doc.dischargeReviewedAt && (
            <div className="pf-fhint" style={{ marginTop: 4 }}>
              Discharge reviewed by <strong>{doc.dischargeReviewedBy}</strong>{doc.dischargeReviewedByReg ? ` (Reg ${doc.dischargeReviewedByReg})` : ""} on {new Date(doc.dischargeReviewedAt).toLocaleString("en-IN")}
            </div>
          )}
        </div>
      </div>

      {/* Per-row reconciliation table */}
      <div className="pf-section-card">
        <div className="pf-section-card__head">
          <span className="pf-section-card__icon">📋</span>
          <span className="pf-section-card__title">Reconciliation Decisions</span>
        </div>
        <div className="pf-data-table-wrap">
          <table className="pf-data-table pf-data-table--compact" aria-label="Medication reconciliation table">
            <thead>
              <tr>
                <th>Drug</th><th>Dose</th><th>Route</th><th>Frequency</th>
                <th>Source</th><th>Action</th><th>Reason</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(doc.rows || []).map((r) => (
                <tr key={r._id}>
                  <td className="pf-cell-strong">{r.drugName || "—"}</td>
                  <td>{r.dose || "—"}</td>
                  <td>{r.route || "—"}</td>
                  <td>{r.frequency || "—"}</td>
                  <td>
                    <span className={`pf-badge ${r.source === "home" ? "pf-badge--info" : r.source === "inpatient" ? "pf-badge--warn" : "pf-badge--ok"}`}>
                      {r.source}
                    </span>
                  </td>
                  <td>
                    <select
                      className="pf-select"
                      style={{ minWidth: 110 }}
                      value={r.action || "CONTINUE"}
                      onChange={(e) => patchRow(r._id, { action: e.target.value })}
                      disabled={savingRow === r._id}
                      aria-label={`Action for ${r.drugName}`}
                    >
                      {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </td>
                  <td style={{ minWidth: 180 }}>
                    <input
                      className="pf-input"
                      value={r.actionReason || ""}
                      onChange={(e) => {
                        // optimistic local update so typing is smooth
                        setDoc((d) => ({
                          ...d,
                          rows: d.rows.map((row) => row._id === r._id ? { ...row, actionReason: e.target.value } : row),
                        }));
                      }}
                      onBlur={(e) => patchRow(r._id, { actionReason: e.target.value })}
                      placeholder={r.action && r.action !== "CONTINUE" ? "Reason required" : ""}
                      aria-label={`Reason for ${r.drugName}`}
                    />
                  </td>
                  <td>
                    <span className={`pf-badge pf-badge--${ACTION_TINT[r.action || "CONTINUE"]}`}>
                      {savingRow === r._id ? "saving…" : r.action || "CONTINUE"}
                    </span>
                  </td>
                </tr>
              ))}
              {(doc.rows || []).length === 0 && (
                <tr><td colSpan={8} className="pf-cell-muted" style={{ textAlign: "center", padding: 20 }}>
                  No drugs on this reconciliation. Click "Re-seed from chart" above.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Outgoing summary preview */}
      {discharge.length > 0 && (
        <div className="pf-section-card pf-section-card--ok">
          <div className="pf-section-card__head">
            <span className="pf-section-card__icon">📤</span>
            <span className="pf-section-card__title">Will appear on Discharge Summary</span>
            <span className="pf-section-card__count">{discharge.length}</span>
          </div>
          <div className="pf-section-card__body pf-section-card__body--pad">
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
              {discharge.map((r) => (
                <li key={r._id}>
                  <strong>{r.drugName}</strong>
                  {r.dose && ` · ${r.dose}`}
                  {r.route && ` · ${r.route}`}
                  {r.frequency && ` · ${r.frequency}`}
                  {r.duration && ` × ${r.duration}`}
                  {r.actionReason && <span style={{ color: "var(--pf-muted)" }}> — {r.actionReason}</span>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
