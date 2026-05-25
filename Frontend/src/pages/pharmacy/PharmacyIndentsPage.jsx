/**
 * PharmacyIndentsPage.jsx — Pharmacist's live indent queue.
 *
 * Route: /pharmacy/indents
 * Backend: GET /api/indents?openOnly=true (Raised|Acknowledged|PartiallyReleased)
 *
 * The polling cycle (every 10 s) compares the previous list to the new
 * one — any newly-arrived STAT indent triggers a soft chime + red
 * flash on the new row. The pharmacist sees:
 *
 *   - STAT indents at the top with a red border + bell icon
 *   - Urgent in amber
 *   - Routine in slate
 *
 * Clicking a row opens the release modal: per-item issued qty + batch
 * number + optional substitution. Releasing fires reservation triggers
 * on the patient's IPD bill via /api/indents/:id/release.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import API_ENDPOINTS from "../../config/api";
import { useVisiblePoll } from "../../utils/pollingHelpers";

const C = {
  primary: "#1d4ed8", accent: "#7c3aed",
  success: "#059669", warn: "#d97706", danger: "#dc2626",
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0",
  muted: "#64748b", dark: "#0f172a",
};

const URGENCY = {
  STAT:    { fg: "#b91c1c", bg: "#fee2e2", border: "#fca5a5", icon: "pi-bell" },
  Urgent:  { fg: "#a16207", bg: "#fef3c7", border: "#fcd34d", icon: "pi-exclamation-triangle" },
  Routine: { fg: "#475569", bg: "#f1f5f9", border: "#cbd5e1", icon: "pi-clock" },
};
const STATUS = {
  Raised:            { fg: "#1d4ed8", bg: "#dbeafe" },
  Acknowledged:      { fg: "#0d9488", bg: "#ccfbf1" },
  PartiallyReleased: { fg: "#d97706", bg: "#fef3c7" },
  Released:          { fg: "#15803d", bg: "#dcfce7" },
  Cancelled:         { fg: "#b91c1c", bg: "#fee2e2" },
};

const inr  = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN")}`;
const fmtT = (d) => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

// Tiny built-in WebAudio chime — avoids shipping an asset. Plays a soft
// 660 Hz beep for 250 ms; falls back silently if AudioContext is blocked
// (most browsers allow it after first user gesture).
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 660;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.08;
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => ctx.close();
  } catch (_) { /* ignored — user hasn't interacted yet */ }
}

export default function PharmacyIndentsPage({ embedded = false } = {}) {
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterUrgency, setFilterUrgency] = useState("");
  const [filterStatus, setFilterStatus]   = useState("open");
  const [release, setRelease] = useState({ open: false, indent: null });
  const [busy, setBusy] = useState(false);
  const seenStatRef = useRef(new Set());     // remember STAT ids we've chimed for
  // R7bh-F9 / R7bg-4-CRIT-1 — `load()` used to gate the chime on
  // `list.length > 0` from closure, but `list` wasn't a dependency, so
  // `useCallback` froze it at [] forever. After a filter flip the
  // closure still read 0 and STAT chime fired on initial render of
  // every filter view. Mirror the latest list length into a ref so the
  // gate observes the *current* state without re-recreating `load`.
  const listLenRef = useRef(0);
  // R7bh-F9 / R7bg-4-CRIT-2 — the previous in-flight `/indents` fetch
  // would race the next tick on slow networks and overwrite fresh data
  // with stale results. Abort the prior request when the poll re-fires
  // or filters change.
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    // Cancel any in-flight previous request before launching a new one.
    if (abortRef.current) { try { abortRef.current.abort(); } catch (_) {} }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const params = new URLSearchParams();
      if (filterStatus === "open") params.set("openOnly", "true");
      else if (filterStatus) params.set("status", filterStatus);
      if (filterUrgency) params.set("urgency", filterUrgency);
      const { data } = await axios.get(`${API_ENDPOINTS.BASE}/indents?${params}`, { signal: ctrl.signal });
      const fresh = Array.isArray(data?.data) ? data.data : [];

      // STAT-chime — chime once per STAT id we haven't seen in this
      // session. The seenStatRef is committed AFTER the chime so a
      // re-render or filter flip doesn't re-trigger.
      const newStats = fresh.filter(i => i.urgency === "STAT" && !seenStatRef.current.has(i._id));
      if (newStats.length && listLenRef.current > 0) {  // skip on initial mount
        playChime();
        toast.warn(`STAT indent — ${newStats[0].patientName || newStats[0].UHID}`, { autoClose: 5000 });
      }
      newStats.forEach(i => seenStatRef.current.add(i._id));

      listLenRef.current = fresh.length;
      setList(fresh);
    } catch (e) {
      // Aborted polls are expected (next tick or filter change) — silent.
      if (e.name === "CanceledError" || e.name === "AbortError" || axios.isCancel?.(e)) return;
      // Non-fatal — surface only on the first failure so toast spam
      // doesn't drown the queue during a flaky network.
      if (loading) toast.error("Could not load indents: " + (e.response?.data?.message || e.message));
    } finally {
      setLoading(false);
    }
  // load() shouldn't recreate every render or the polling interval will
  // chase its own tail — keep deps minimal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterUrgency]);

  useEffect(() => { load(); }, [load]);
  // R7bh-F9 / R7bg-9-HIGH-4 — visibility-gated poll. Pauses when the
  // pharmacist tabs away (e.g. to email), resumes + immediately
  // refreshes on focus return.
  useVisiblePoll(load, 10000, [filterStatus, filterUrgency]);
  // Abort any straggling request on unmount.
  useEffect(() => () => { if (abortRef.current) { try { abortRef.current.abort(); } catch (_) {} } }, []);

  /* ── Release modal helpers ────────────────────────────────── */
  // Auto-fetch the FEFO (first-expiry-first-out) batch + sale price for
  // every item that carries a drugId. This eliminates the two manual
  // typings the pharmacist used to do per row — LOT number + unit price
  // — and surfaces the available stock + earliest expiry inline so a
  // stock-out is obvious before clicking Release. The batch + price
  // inputs stay editable for the unusual override (e.g. dispensing from
  // a specific lot for a recall).
  const openRelease = async (indent) => {
    const rawItems = (indent.items || []).map(it => ({
      ...it,
      pendingQty: Math.max(0, (it.requestedQty || 0) - (it.issuedQty || 0)),
      _issuedNow: Math.max(0, (it.requestedQty || 0) - (it.issuedQty || 0)),
      _batch:     it.batchNumber || "",
      _unitPrice: it.unitPriceSnapshot || 0,
      _availableQty: null,    // populated below — null = still loading
      _expiryDate:   null,
      _batches:      [],      // full FEFO list (for future batch-picker UI)
    }));

    // Open the modal IMMEDIATELY with what we have so the pharmacist
    // sees the form right away — then enrich in the background. If the
    // batch fetch fails (e.g. drugId missing), the pharmacist falls
    // back to typing batch + price manually like before.
    setRelease({ open: true, indent: { ...indent, _formItems: rawItems } });

    try {
      const enriched = await Promise.all(rawItems.map(async (it) => {
        // R7db-1: items without a drugId (manual / typed-in entries) can
        // never resolve a FEFO batch — clear the loading flag immediately
        // so the spinner doesn't spin forever. _availableQty:0 puts the
        // row in "manual entry" mode (red "Out of stock" hint) but the
        // batch + price inputs stay editable so the pharmacist can type
        // them in by hand and release.
        if (!it.drugId) return { ...it, _availableQty: 0 };
        try {
          const { data } = await axios.get(`${API_ENDPOINTS.BASE}/pharmacy/batches?drugId=${encodeURIComponent(it.drugId)}`);
          const list = Array.isArray(data?.data) ? data.data : [];
          // FEFO — earliest expiryDate first, with remaining > 0. Backend
          // already sorts by expiryDate asc, but we filter out empty
          // batches here so the pharmacist sees the next dispensable lot.
          const usable = list.filter(b => Number(b.remaining) > 0);
          const head   = usable[0];
          if (!head) return { ...it, _availableQty: 0, _batches: list };
          return {
            ...it,
            _batch:        it._batch || head.batchNo || "",
            _unitPrice:    Number(it._unitPrice) || Number(head.salePrice) || 0,
            _availableQty: usable.reduce((s, b) => s + Number(b.remaining || 0), 0),
            _expiryDate:   head.expiryDate || null,
            _batches:      usable,
          };
        } catch (_) {
          // R7db-1: batch endpoint failed (network / 401 / 500) — still
          // unstick the spinner. _availableQty:0 + _fetchFailed flag tells
          // the UI to swap the hint from "Out of stock" to "Stock check
          // failed — type batch + price manually". Release still proceeds
          // — the pharmacist owns the override.
          return { ...it, _availableQty: 0, _fetchFailed: true };
        }
      }));
      // Re-open with enriched items. Guard against the modal having
      // closed in the interim (pharmacist hit Cancel before fetch
      // resolved) by checking the previous indent identity.
      setRelease(prev => {
        if (!prev.open || prev.indent?._id !== indent._id) return prev;
        return { ...prev, indent: { ...prev.indent, _formItems: enriched } };
      });
    } catch (_) { /* non-fatal */ }
  };
  const closeRelease = () => { if (!busy) setRelease({ open: false, indent: null }); };

  const submitRelease = async () => {
    if (!release.indent) return;
    const itemsPayload = (release.indent._formItems || [])
      .filter(it => Number(it._issuedNow) > 0)
      .map(it => ({
        itemId:      it._id,
        issuedQty:   Number(it._issuedNow),
        batchNumber: it._batch || "",
        unitPrice:   Number(it._unitPrice) || 0,
      }));
    if (!itemsPayload.length) return toast.warn("Set qty > 0 on at least one item");
    setBusy(true);
    try {
      await axios.post(`${API_ENDPOINTS.BASE}/indents/${release.indent._id}/release`, { items: itemsPayload });
      toast.success("Indent released — drugs heading to ward");
      closeRelease();
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = async (indent) => {
    try {
      await axios.post(`${API_ENDPOINTS.BASE}/indents/${indent._id}/acknowledge`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || e.message);
    }
  };

  /* ── Render ───────────────────────────────────────────────── */
  // When embedded inside the Pharmacy tab strip, drop the full-page
  // chrome (background, min-height, header bar) — the parent provides
  // those. Standalone route keeps the original look.
  return (
    <div style={embedded
      ? { padding: 0 }
      : { background: C.bg, minHeight: "100vh", padding: "16px 20px 60px" }}>
      {!embedded && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <button onClick={() => navigate(-1)} style={{
            padding: "6px 12px", background: "#fff", border: `1px solid ${C.border}`,
            borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, color: C.dark,
          }}>
            <i className="pi pi-arrow-left" style={{ marginRight: 6, fontSize: 11 }} />
            Back
          </button>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.dark }}>
            <i className="pi pi-inbox" style={{ marginRight: 6, color: C.primary }} />
            Pharmacy Indent Queue
          </div>
          <span style={{ marginLeft: "auto", fontSize: 12, color: C.muted }}>
            Auto-refresh every 10s · {list.length} in view
          </span>
        </div>
      )}

      {/* Filters */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: 10, marginBottom: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginRight: 6 }}>FILTERS:</div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{
          padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: "inherit", fontSize: 12,
        }}>
          <option value="open">Open (Raised + Acked + Partial)</option>
          <option value="Raised">Raised only</option>
          <option value="Acknowledged">Acknowledged only</option>
          <option value="Released">Released</option>
          <option value="Cancelled">Cancelled</option>
          <option value="">All statuses</option>
        </select>
        <select value={filterUrgency} onChange={e => setFilterUrgency(e.target.value)} style={{
          padding: "7px 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: "inherit", fontSize: 12,
        }}>
          <option value="">All urgencies</option>
          <option value="STAT">STAT only</option>
          <option value="Urgent">Urgent only</option>
          <option value="Routine">Routine only</option>
        </select>
        <button onClick={load} style={{
          marginLeft: "auto", padding: "7px 12px", background: "#fff", color: C.muted,
          border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 12,
        }}>
          <i className="pi pi-refresh" style={{ marginRight: 4 }} /> Refresh
        </button>
      </div>

      {/* Queue list */}
      {loading ? (
        <div style={{ padding: 60, textAlign: "center" }}>
          <i className="pi pi-spin pi-spinner" style={{ fontSize: 28, color: C.primary }} />
        </div>
      ) : list.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: C.muted, fontStyle: "italic", background: C.card, borderRadius: 12, border: `1px solid ${C.border}` }}>
          <i className="pi pi-inbox" style={{ fontSize: 28, marginBottom: 8, display: "block" }} />
          No indents in this view. Wards will raise indents and they'll appear here within 10 seconds.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map(indent => {
            const u = URGENCY[indent.urgency] || URGENCY.Routine;
            const s = STATUS[indent.status] || STATUS.Raised;
            const totalReq = (indent.items || []).reduce((s, it) => s + (it.requestedQty || 0), 0);
            const totalIss = (indent.items || []).reduce((s, it) => s + (it.issuedQty || 0), 0);
            const closable = indent.status === "Raised" || indent.status === "Acknowledged" || indent.status === "PartiallyReleased";
            return (
              <div key={indent._id} style={{
                background: C.card,
                border: `1.5px solid ${u.border}`,
                borderLeft: `6px solid ${u.fg}`,
                borderRadius: 12, padding: 14,
                boxShadow: indent.urgency === "STAT" ? "0 4px 14px rgba(220, 38, 38, 0.18)" : "0 1px 3px rgba(15, 23, 42, 0.06)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                  <span style={{
                    background: u.bg, color: u.fg, padding: "3px 10px", borderRadius: 12,
                    fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px",
                  }}>
                    <i className={`pi ${u.icon}`} style={{ marginRight: 4, fontSize: 10 }} />
                    {indent.urgency}
                  </span>
                  <span style={{ fontWeight: 800, color: C.dark, fontSize: 14 }}>{indent.indentNumber}</span>
                  <span style={{
                    background: s.bg, color: s.fg, padding: "2px 8px", borderRadius: 10,
                    fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                  }}>
                    {indent.status}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted }}>
                    Raised {fmtT(indent.raisedAt)} · by {indent.raisedBy} ({indent.raisedByRole})
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 14, marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Patient</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.dark, marginTop: 2 }}>
                      {indent.patientName || indent.UHID}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>
                      {indent.UHID} · {indent.admissionNumber}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Bed / Ward</div>
                    <div style={{ fontSize: 12, color: C.dark, marginTop: 4 }}>
                      {indent.bedNumber || "—"} · {indent.wardName || "—"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Progress</div>
                    <div style={{ fontSize: 12, color: C.dark, marginTop: 4, fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>
                      {totalIss} / {totalReq} units issued
                    </div>
                  </div>
                </div>

                {/* Items table */}
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 8 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", fontSize: 10, color: C.muted, textTransform: "uppercase" }}>
                      <th style={{ padding: "6px 10px", textAlign: "left" }}>Drug</th>
                      <th style={{ padding: "6px 10px", textAlign: "left", width: 80 }}>Source</th>
                      <th style={{ padding: "6px 10px", textAlign: "center", width: 80 }}>Requested</th>
                      <th style={{ padding: "6px 10px", textAlign: "center", width: 80 }}>Issued</th>
                      <th style={{ padding: "6px 10px", textAlign: "left" }}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(indent.items || []).map(it => (
                      <tr key={it._id} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "6px 10px" }}>
                          <div style={{ fontWeight: 700, color: C.dark }}>{it.drugName}</div>
                          {(it.dose || it.form || it.route) && (
                            <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
                              {it.form} {it.dose} {it.route && `· ${it.route}`}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700,
                            background: it.sourceType === "DoctorOrder" ? "#dbeafe" : "#fef3c7",
                            color:      it.sourceType === "DoctorOrder" ? "#1d4ed8" : "#a16207",
                            padding: "2px 7px", borderRadius: 6, textTransform: "uppercase", letterSpacing: ".3px",
                          }}>
                            {it.sourceType === "DoctorOrder" ? "Rx" : "Manual"}
                          </span>
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "center", fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>
                          {it.requestedQty}
                        </td>
                        <td style={{ padding: "6px 10px", textAlign: "center", fontFamily: "'DM Mono', monospace", fontWeight: 700,
                                     color: it.issuedQty >= it.requestedQty ? C.success : (it.issuedQty > 0 ? C.warn : C.muted) }}>
                          {it.issuedQty}
                        </td>
                        <td style={{ padding: "6px 10px", color: C.muted, fontSize: 11 }}>{it.reason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {indent.notes && (
                  <div style={{ marginTop: 6, padding: "6px 10px", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 6, fontSize: 11, color: "#92400e" }}>
                    <strong>Nurse's note:</strong> {indent.notes}
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  {indent.status === "Raised" && (
                    <button onClick={() => acknowledge(indent)} style={{
                      padding: "6px 14px", background: "#fff", color: C.primary, border: `1px solid ${C.primary}`,
                      borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
                    }}>
                      <i className="pi pi-eye" style={{ marginRight: 4 }} /> Acknowledge
                    </button>
                  )}
                  {closable && (
                    <button onClick={() => openRelease(indent)} style={{
                      padding: "6px 14px", background: C.primary, color: "#fff", border: "none",
                      borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: 12,
                    }}>
                      <i className="pi pi-send" style={{ marginRight: 4 }} /> Release stock
                    </button>
                  )}
                  <button onClick={() => navigate(`/billing/ipd/${indent.admissionId}`)} style={{
                    padding: "6px 14px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`,
                    borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, fontSize: 12,
                  }}>
                    <i className="pi pi-receipt" style={{ marginRight: 4 }} /> Live Ledger
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Release modal ──────────────────────────────────── */}
      {release.open && release.indent && (
        <div onClick={closeRelease} style={{
          position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.45)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: C.card, borderRadius: 14, width: 680, maxWidth: "94vw", maxHeight: "88vh", overflow: "auto",
            padding: 22, boxShadow: "0 24px 48px rgba(15,23,42,.25)",
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.primary, marginBottom: 4 }}>
              <i className="pi pi-send" style={{ marginRight: 6 }} />
              Release indent — {release.indent.indentNumber}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>
              Patient: <strong style={{ color: C.dark }}>{release.indent.patientName || release.indent.UHID}</strong> · Bed {release.indent.bedNumber || "—"}
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, marginBottom: 14 }}>
              <thead>
                <tr style={{ background: "#f8fafc", fontSize: 10, color: C.muted, textTransform: "uppercase" }}>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>Drug</th>
                  <th style={{ padding: "6px 8px", textAlign: "center", width: 60 }}>Pending</th>
                  <th style={{ padding: "6px 8px", textAlign: "center", width: 80 }}>Issue now</th>
                  <th style={{ padding: "6px 8px", textAlign: "left", width: 110 }}>Batch #</th>
                  <th style={{ padding: "6px 8px", textAlign: "right", width: 80 }}>Unit ₹</th>
                </tr>
              </thead>
              <tbody>
                {(release.indent._formItems || []).map((it, idx) => {
                  // Stock-state hints rendered under the drug name. _availableQty
                  // is null while the FEFO fetch is in flight, 0 when stock is
                  // empty (red), and a positive number when ready (slate).
                  const stockLoading = it._availableQty === null;
                  const stockOut     = it._availableQty === 0;
                  // R7db-1: distinguish "really out of stock" vs "couldn't
                  // check stock" (no drugId / API error). Both still need
                  // manual entry but the message differs so the pharmacist
                  // knows whether to expect a real stock-out or a fetch issue.
                  const fetchFailed  = stockOut && (it._fetchFailed || !it.drugId);
                  const wantMore     = !stockLoading && !stockOut && Number(it._issuedNow) > Number(it._availableQty || 0);
                  const expirySoon   = it._expiryDate && (new Date(it._expiryDate).getTime() - Date.now()) < 60 * 86400000;
                  const stockColor =
                    stockLoading ? C.muted :
                    stockOut     ? (fetchFailed ? C.warn : C.danger) :
                    wantMore     ? C.warn :
                                   C.muted;
                  return (
                  <tr key={it._id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px 8px" }}>
                      <div style={{ fontWeight: 700, color: C.dark }}>{it.drugName}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>{it.form} {it.dose}</div>
                      {/* Live FEFO stock hint — auto-fetched from /batches?drugId=…
                          on modal open. Lets the pharmacist spot a stock-out BEFORE
                          clicking Release (would otherwise fail server-side). */}
                      <div style={{ fontSize: 10, color: stockColor, marginTop: 3, fontFamily: "'DM Mono', monospace" }}>
                        {stockLoading && <><i className="pi pi-spin pi-spinner" style={{ fontSize: 9, marginRight: 3 }} /> fetching FEFO batch…</>}
                        {stockOut && !fetchFailed && <><i className="pi pi-exclamation-triangle" style={{ fontSize: 9, marginRight: 3 }} /> Out of stock</>}
                        {fetchFailed && <><i className="pi pi-pencil" style={{ fontSize: 9, marginRight: 3 }} /> Stock check unavailable — enter batch + price manually</>}
                        {!stockLoading && !stockOut && (
                          <>
                            <i className="pi pi-box" style={{ fontSize: 9, marginRight: 3 }} />
                            Available: {it._availableQty}
                            {wantMore && <span style={{ color: C.danger, marginLeft: 4 }}>· insufficient</span>}
                            {it._expiryDate && (
                              <span style={{ marginLeft: 6, color: expirySoon ? C.warn : C.muted }}>
                                · Exp {new Date(it._expiryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}
                                {expirySoon && " ⚠"}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "center", fontFamily: "'DM Mono', monospace" }}>{it.pendingQty}</td>
                    <td style={{ padding: "6px 8px", textAlign: "center" }}>
                      <input type="number" min={0} max={it.pendingQty} value={it._issuedNow}
                        onChange={(e) => setRelease(r => ({
                          ...r,
                          indent: { ...r.indent, _formItems: r.indent._formItems.map((x, i) => i === idx ? { ...x, _issuedNow: e.target.value } : x) }
                        }))}
                        style={{ width: 70, padding: 5, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, textAlign: "center", fontFamily: "inherit", boxSizing: "border-box" }} />
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <input type="text" value={it._batch}
                        onChange={(e) => setRelease(r => ({
                          ...r,
                          indent: { ...r.indent, _formItems: r.indent._formItems.map((x, i) => i === idx ? { ...x, _batch: e.target.value } : x) }
                        }))}
                        placeholder="LOT-…"
                        style={{ width: "100%", padding: 5, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontFamily: "inherit", boxSizing: "border-box" }} />
                    </td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>
                      <input type="number" min={0} step="0.01" value={it._unitPrice}
                        onChange={(e) => setRelease(r => ({
                          ...r,
                          indent: { ...r.indent, _formItems: r.indent._formItems.map((x, i) => i === idx ? { ...x, _unitPrice: e.target.value } : x) }
                        }))}
                        style={{ width: 80, padding: 5, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, textAlign: "right", fontFamily: "inherit", boxSizing: "border-box" }} />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ fontSize: 11, color: C.muted, marginBottom: 14, padding: "8px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6 }}>
              <i className="pi pi-info-circle" style={{ marginRight: 4, color: C.success }} />
              On release, each item fires a reservation charge on the patient's IPD bill (Pharmacy / Medications category). The charge becomes final when the nurse marks the drug as GIVEN in MAR.
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={closeRelease} disabled={busy} style={{
                padding: "8px 16px", background: "#fff", color: C.dark, border: `1px solid ${C.border}`,
                borderRadius: 8, cursor: busy ? "wait" : "pointer", fontFamily: "inherit", fontWeight: 600,
              }}>Cancel</button>
              <button onClick={submitRelease} disabled={busy} style={{
                padding: "8px 18px", background: C.primary, color: "#fff", border: "none",
                borderRadius: 8, cursor: busy ? "wait" : "pointer", fontFamily: "inherit", fontWeight: 800,
              }}>
                {busy ? <><i className="pi pi-spin pi-spinner" /> Releasing…</> : <><i className="pi pi-send" style={{ marginRight: 6 }} />Release to ward</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
