// pages/bed/BedTransfersListPage.jsx
// Bed Transfers list — exposes the existing 2-stage transfer workflow
// (doctor initiates → nurse handover → optional cancel) as a page so
// the nurse-in-charge can see a queue of pending handovers and an
// audit log of completed/cancelled transfers without having to dig
// through individual patient files.
//
// Backend: GET/POST/PUT  /api/bed-transfers  (routes/Patient/bedTransferRoutes.js)

import React, { useEffect, useMemo, useState } from "react";
import { API_ENDPOINTS } from "../../config/api";
import authFetch from "../../utils/authFetch";
import "../patient/patient-file.css";

const STATUS_META = {
  PendingHandover: { label: "Pending Handover", color: "#92400e", bg: "#fef3c7", border: "#fcd34d", icon: "pi-hourglass" },
  Complete:        { label: "Completed",        color: "#15803d", bg: "#dcfce7", border: "#bbf7d0", icon: "pi-check-circle" },
  Cancelled:       { label: "Cancelled",        color: "#991b1b", bg: "#fee2e2", border: "#fca5a5", icon: "pi-times-circle" },
};

const fmtDateTime = (d) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(d); }
};

const BedTransfersListPage = () => {
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [filterStatus, setFilterStatus] = useState("PendingHandover"); // default: nurse's action queue
  const [search, setSearch]       = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  // ── Load all transfers (backend supports ?status= but we fetch
  //     everything and filter client-side so the counts stay in sync). ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    authFetch(API_ENDPOINTS.BED_TRANSFERS)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data
                   : Array.isArray(data?.data) ? data.data
                   : Array.isArray(data?.transfers) ? data.transfers
                   : [];
        setTransfers(list);
      })
      .catch(e => { if (!cancelled) setError(e.message || "Failed to load transfers"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshTick]);

  const counts = useMemo(() => ({
    PendingHandover: transfers.filter(t => t.status === "PendingHandover").length,
    Complete:        transfers.filter(t => t.status === "Complete").length,
    Cancelled:       transfers.filter(t => t.status === "Cancelled").length,
    All:             transfers.length,
  }), [transfers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transfers
      .filter(t => filterStatus === "All" || t.status === filterStatus)
      .filter(t => !q
        || (t.UHID || "").toLowerCase().includes(q)
        || (t.patientName || "").toLowerCase().includes(q)
        || (t.transferNo || "").toLowerCase().includes(q)
        || (t.fromBedNumber || "").toLowerCase().includes(q)
        || (t.toBedNumber || "").toLowerCase().includes(q))
      .sort((a, b) => new Date(b.createdAt || b.requestedAt) - new Date(a.createdAt || a.requestedAt));
  }, [transfers, filterStatus, search]);

  return (
    <div style={{ padding: "20px 28px", fontFamily: "'DM Sans', sans-serif" }}>
      {/* ── Page header ── */}
      <div style={{
        background: "linear-gradient(135deg, #7c3aed, #5b21b6)",
        borderRadius: 14, padding: "18px 24px", color: "white",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 16, boxShadow: "0 6px 22px rgba(124,58,237,.25)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="pi pi-arrows-h" style={{ fontSize: 22 }} />
          </div>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: ".3px" }}>Bed Transfers</div>
            <div style={{ fontSize: 12, opacity: .85 }}>Two-stage workflow — Doctor initiates → Nurse handover</div>
          </div>
        </div>
        <button onClick={() => setRefreshTick(t => t + 1)}
          style={{ background: "rgba(255,255,255,.2)", border: "none", color: "white", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <i className="pi pi-refresh" /> Refresh
        </button>
      </div>

      {/* ── Status filter pills + counts ── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        {[
          { id: "PendingHandover", label: "Pending Handover", color: "#92400e", bg: "#fef3c7" },
          { id: "Complete",        label: "Completed",        color: "#15803d", bg: "#dcfce7" },
          { id: "Cancelled",       label: "Cancelled",        color: "#991b1b", bg: "#fee2e2" },
          { id: "All",             label: "All",              color: "#475569", bg: "#f1f5f9" },
        ].map(f => {
          const active = filterStatus === f.id;
          return (
            <button key={f.id} onClick={() => setFilterStatus(f.id)}
              style={{
                padding: "7px 14px", borderRadius: 999,
                border: `1.5px solid ${active ? f.color : "#e2e8f0"}`,
                background: active ? f.bg : "white",
                color: active ? f.color : "#475569",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6,
                transition: "all .15s",
              }}>
              {f.label}
              <span style={{
                background: active ? f.color : "#e2e8f0",
                color: active ? "white" : "#64748b",
                padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 800,
              }}>{counts[f.id] ?? 0}</span>
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search UHID / name / transfer no / bed…"
          style={{
            padding: "8px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0",
            fontSize: 12, fontFamily: "inherit", minWidth: 280, outline: "none",
          }}
        />
      </div>

      {/* ── Body ── */}
      {error && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: "12px 16px", borderRadius: 10, fontSize: 12, marginBottom: 14 }}>
          <i className="pi pi-exclamation-triangle" style={{ marginRight: 6 }} />
          {error}
        </div>
      )}
      {loading && (
        <div style={{ textAlign: "center", padding: 40, color: "#64748b", fontSize: 13 }}>
          <i className="pi pi-spin pi-spinner" style={{ fontSize: 22 }} /> Loading transfers…
        </div>
      )}
      {!loading && filtered.length === 0 && !error && (
        <div style={{ textAlign: "center", padding: 60, color: "#94a3b8", background: "white", borderRadius: 12, border: "1.5px dashed #e2e8f0" }}>
          <i className="pi pi-inbox" style={{ fontSize: 36, display: "block", marginBottom: 10 }} />
          <div style={{ fontWeight: 700, fontSize: 14, color: "#475569" }}>
            No {filterStatus === "All" ? "" : STATUS_META[filterStatus]?.label.toLowerCase() + " "}transfers yet
          </div>
          <div style={{ fontSize: 11, marginTop: 4 }}>
            Doctor-initiated transfers will appear here for nurse handover.
          </div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map(t => {
            const s = STATUS_META[t.status] || STATUS_META.PendingHandover;
            return (
              <div key={t._id} style={{
                background: "white", border: "1.5px solid #e2e8f0", borderLeft: `4px solid ${s.color}`,
                borderRadius: 12, padding: "14px 18px", display: "grid",
                gridTemplateColumns: "1fr auto", gap: 14, alignItems: "start",
              }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {/* Top row: transfer no + status + patient */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700, color: "#475569", background: "#f1f5f9", padding: "2px 8px", borderRadius: 6 }}>
                      {t.transferNo || "—"}
                    </span>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "2px 10px", borderRadius: 999,
                      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
                      fontSize: 11, fontWeight: 700,
                    }}>
                      <i className={`pi ${s.icon}`} style={{ fontSize: 10 }} />
                      {s.label}
                    </span>
                    <span style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>{t.patientName || "Unknown"}</span>
                    <span style={{ fontSize: 11, color: "#64748b" }}>UHID: <strong>{t.UHID}</strong></span>
                  </div>

                  {/* Bed move row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                    <span style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "3px 9px", borderRadius: 6, fontWeight: 700 }}>
                      <i className="pi pi-sign-out" style={{ fontSize: 10, marginRight: 4 }} />
                      {t.fromWardName || "—"} · {t.fromRoomNumber || "—"} · Bed {t.fromBedNumber || "—"}
                    </span>
                    <i className="pi pi-arrow-right" style={{ color: "#94a3b8", fontSize: 11 }} />
                    <span style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d", padding: "3px 9px", borderRadius: 6, fontWeight: 700 }}>
                      <i className="pi pi-sign-in" style={{ fontSize: 10, marginRight: 4 }} />
                      {t.toWardName || "—"} · {t.toRoomNumber || "—"} · Bed {t.toBedNumber || "—"}
                    </span>
                  </div>

                  {/* Reason + notes */}
                  {t.reason && (
                    <div style={{ fontSize: 12, color: "#475569" }}>
                      <strong>Reason:</strong> {t.reason}
                    </div>
                  )}
                  {t.shiftingNotes && (
                    <div style={{ fontSize: 12, color: "#475569", background: "#f8fafc", padding: "6px 10px", borderRadius: 6, borderLeft: "2px solid #cbd5e1" }}>
                      <strong style={{ color: "#3730a3" }}>Doctor's note:</strong> {t.shiftingNotes}
                    </div>
                  )}
                  {t.handoverNotes && (
                    <div style={{ fontSize: 12, color: "#475569", background: "#f0fdf4", padding: "6px 10px", borderRadius: 6, borderLeft: "2px solid #86efac" }}>
                      <strong style={{ color: "#166534" }}>Nurse handover:</strong> {t.handoverNotes}
                    </div>
                  )}

                  {/* Bottom row: by-whom + when */}
                  <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    <span><i className="pi pi-user" style={{ fontSize: 10, marginRight: 4 }} />
                      Requested: <strong>{t.requestedBy || "—"}</strong> · {fmtDateTime(t.requestedAt || t.createdAt)}
                    </span>
                    {t.handoverAt && (
                      <span><i className="pi pi-check" style={{ fontSize: 10, marginRight: 4 }} />
                        Handover: <strong>{t.handoverBy || "—"}</strong> · {fmtDateTime(t.handoverAt)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right column placeholder for future Complete/Cancel buttons.
                    Action UI is intentionally NOT wired here — actions are
                    initiated from the patient file / bed visual layout where
                    full context is available. This page is read-only audit. */}
                <div style={{ alignSelf: "center" }}>
                  <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>
                    Read-only audit
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BedTransfersListPage;
