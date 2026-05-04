/**
 * NurseOrdersPanel.jsx
 * Step-based doctor order workflow for nurses — mirrors the NABH audit-ready order prototype.
 * Each order type has sequential steps; each step records nurse name + timestamp.
 * Props: { UHID, visitId, onConsentRequest }
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

const C = {
  purple: "#7c3aed", nurse: "#db2777", teal: "#0f766e",
  amber: "#d97706", danger: "#dc2626", success: "#059669",
  blue: "#0284c7", bg: "#f8fafc", card: "#fff",
  border: "#e2e8f0", muted: "#64748b", dark: "#0f172a",
};

const TYPE_COLOR = {
  Medication:    "#7c3aed",
  Investigation: "#0284c7",
  Procedure:     "#db2777",
  Diet:          "#059669",
  Activity:      "#d97706",
  Nursing:       "#0f766e",
};

// ── Step definitions per order type (matches prototype logic) ─────────────────
function getSteps(order) {
  const type = order.orderType;
  const subtype = order.orderDetails?.urgency || order.orderDetails?.procedureType || "";

  if (type === "Investigation") {
    if (subtype === "Radiology" || (order.orderDetails?.testName || "").toLowerCase().includes("xray") ||
        (order.orderDetails?.testName || "").toLowerCase().includes("ct") ||
        (order.orderDetails?.testName || "").toLowerCase().includes("mri")) {
      return ["Scheduled", "Done", "Report Collected"];
    }
    return ["Sample Collected", "Sample Sent", "Report Received"];
  }
  if (type === "Procedure") {
    return ["Consent Taken", "Patient Prepped", "Procedure Done"];
  }
  if (type === "Medication") {
    return ["Prepared", "Administered"];
  }
  if (type === "Diet") {
    return ["Ordered", "Prepared", "Delivered"];
  }
  if (type === "Activity") {
    return ["Instructed", "Started", "Completed"];
  }
  return ["Acknowledged", "Done"];
}

const PRIORITY_STYLE = {
  STAT:    { bg: "#fef2f2", color: "#dc2626" },
  Urgent:  { bg: "#fffbeb", color: "#d97706" },
  Routine: { bg: "#f1f5f9", color: "#64748b" },
};

const STATUS_BG = {
  Pending:      { bg: "#fef3c7", color: "#d97706" },
  Acknowledged: { bg: "#dbeafe", color: "#1d4ed8" },
  InProgress:   { bg: "#e0e7ff", color: "#4f46e5" },
  Completed:    { bg: "#d1fae5", color: "#059669" },
  Cancelled:    { bg: "#fee2e2", color: "#dc2626" },
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtTime(dateStr) {
  return new Date(dateStr).toLocaleString("en-IN", {
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

// ── Single order card with step buttons + inline audit trail ──────────────────
function OrderCard({ order, nurseName, onStepDone, onConsentRequest }) {
  const [expanded, setExpanded] = useState(false);
  const typeColor = TYPE_COLOR[order.orderType] || C.muted;
  const priorityS = PRIORITY_STYLE[order.priority] || PRIORITY_STYLE.Routine;
  const statusS   = STATUS_BG[order.status] || STATUS_BG.Pending;
  const details   = order.orderDetails || {};

  const displayName =
    details.displayName || details.medicineName ||
    details.testName || details.procedureName || order.orderType;

  const steps       = getSteps(order);
  const doneCount   = (order.auditLog || []).length;
  const nextStep    = steps[doneCount];          // undefined when all done
  const allDone     = doneCount >= steps.length;

  const needsConsent =
    order.orderType === "Procedure" &&
    details.consentRequired &&
    order.consentStatus === "Pending";

  // Running status text e.g. "New → Sample Collected → Sample Sent"
  const flowText = ["New", ...(order.auditLog || []).map(l => l.step)].join(" → ");

  return (
    <div style={{
      background: C.card,
      border: `1px solid ${allDone ? C.success + "50" : C.border}`,
      borderRadius: 10,
      marginBottom: 10,
      borderLeft: `4px solid ${allDone ? C.success : typeColor}`,
      boxShadow: "0 1px 4px rgba(0,0,0,.04)",
      overflow: "hidden",
    }}>
      {/* ── Card header ── */}
      <div style={{ padding: "11px 14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Badges row */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: typeColor + "15", color: typeColor }}>
                {order.orderType}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: priorityS.bg, color: priorityS.color }}>
                {order.priority || "Routine"}
              </span>
              {allDone && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#d1fae5", color: C.success }}>
                  ✓ Completed
                </span>
              )}
            </div>

            {/* Order name */}
            <div style={{ fontSize: 13, fontWeight: 700, color: C.dark, marginBottom: 2 }}>{displayName}</div>

            {/* Details */}
            <div style={{ fontSize: 11, color: C.muted, display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
              {details.dose && <span>Dose: {details.dose}</span>}
              {details.frequency && <span>· {details.frequency}</span>}
              {details.route && <span>· {details.route}</span>}
              {details.urgency && <span>Urgency: {details.urgency}</span>}
              {details.procedureType && <span>Type: {details.procedureType}</span>}
              {details.estimatedDuration && <span>· Est: {details.estimatedDuration}</span>}
              {details.instructions && <span>· {details.instructions}</span>}
            </div>

            {/* Running flow text */}
            <div style={{ fontSize: 10, color: C.muted, fontStyle: "italic", marginBottom: 2 }}>{flowText}</div>

            {/* Meta */}
            <div style={{ fontSize: 10, color: "#94a3b8", display: "flex", gap: 6, alignItems: "center" }}>
              <span>By {order.orderedBy || "Doctor"}</span>
              <span>·</span>
              <span>{timeAgo(order.createdAt)}</span>
              {order.consentStatus && order.consentStatus !== "NotRequired" && (
                <span style={{ fontWeight: 700, color: order.consentStatus === "Obtained" ? C.success : C.amber }}>
                  · Consent: {order.consentStatus}
                </span>
              )}
            </div>
          </div>

          {/* Status chip + expand toggle */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
            <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: statusS.bg, color: statusS.color }}>
              {order.status}
            </span>
            {(order.auditLog || []).length > 0 && (
              <button onClick={() => setExpanded(p => !p)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: C.muted, padding: 0 }}>
                {expanded ? "▲ Hide log" : "▼ View log"}
              </button>
            )}
          </div>
        </div>

        {/* ── Step buttons ── */}
        {!allDone && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {steps.map((step, i) => {
              const done = i < doneCount;
              const isNext = i === doneCount;
              return (
                <button
                  key={step}
                  disabled={!isNext || !nurseName?.trim()}
                  onClick={() => onStepDone(order._id, step, steps.length)}
                  title={!nurseName?.trim() ? "Enter your name above first" : done ? "Already done" : ""}
                  style={{
                    padding: "5px 12px", fontSize: 11, fontWeight: 600,
                    border: "none", borderRadius: 6, cursor: isNext && nurseName?.trim() ? "pointer" : "not-allowed",
                    background: done ? "#d1fae5" : isNext ? typeColor : "#f1f5f9",
                    color: done ? C.success : isNext ? "#fff" : "#94a3b8",
                    opacity: done || isNext ? 1 : 0.5,
                    transition: "all .15s",
                    display: "flex", alignItems: "center", gap: 4,
                  }}>
                  {done ? <span>✓</span> : isNext ? <i className="pi pi-arrow-right" style={{ fontSize: 9 }} /> : null}
                  {step}
                </button>
              );
            })}
          </div>
        )}

        {/* ── Take Consent button — always visible when consent is pending (even after steps done) ── */}
        {needsConsent && (
          <div style={{ marginTop: allDone ? 10 : 6 }}>
            <button onClick={() => onConsentRequest && onConsentRequest(order)}
              style={{ padding: "5px 14px", fontSize: 11, fontWeight: 700, border: "1.5px solid #be185d", borderRadius: 6, background: "#fce7f3", color: "#be185d", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              <i className="pi pi-fingerprint" style={{ fontSize: 11 }} /> Capture Biometric Consent
            </button>
          </div>
        )}
      </div>

      {/* ── Audit trail log (expandable) ── */}
      {expanded && (order.auditLog || []).length > 0 && (
        <div style={{ borderTop: `1px solid ${C.border}`, background: "#f8fafc", padding: "10px 14px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>
            Audit Trail
          </div>
          {(order.auditLog || []).map((entry, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 5 }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: typeColor + "20", border: `1.5px solid ${typeColor}40`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: typeColor }}>{i + 1}</span>
              </div>
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, color: C.dark }}>{entry.step}</span>
                <span style={{ fontSize: 10, color: C.muted }}> by <b>{entry.doneBy}</b></span>
                <span style={{ fontSize: 10, color: "#94a3b8" }}> @ {fmtTime(entry.doneAt)}</span>
                {entry.notes && <div style={{ fontSize: 10, color: C.muted, fontStyle: "italic" }}>{entry.notes}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Medication order display (administered via Treatment Chart MAR below) ──────
function MedOrderCard({ order, inProgress }) {
  const details = order.orderDetails || {};
  const isSTAT  = order.priority === "STAT";
  const borderColor = isSTAT ? "#dc2626" : inProgress ? "#1d4ed8" : "#db2777";
  const bgColor     = isSTAT ? "#fef2f2" : inProgress ? "#eff6ff" : "#fdf2f8";

  return (
    <div style={{
      border: `1.5px solid ${borderColor}40`, borderRadius: 10, marginBottom: 8,
      borderLeft: `4px solid ${borderColor}`, background: bgColor, padding: "10px 14px",
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {isSTAT && (
            <span style={{ background: "#dc2626", color: "#fff", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 4 }}>STAT</span>
          )}
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#db277715", color: "#db2777" }}>Medication</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: inProgress ? "#dbeafe" : "#fef3c7", color: inProgress ? "#1d4ed8" : "#d97706" }}>
            {order.status}
          </span>
          {order.hamFlag && <span style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5", fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 4 }}>🔴 HAM</span>}
        </div>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>{details.medicineName || "Medication"}</div>
        <div style={{ fontSize: 11, color: "#64748b" }}>
          {details.dose && <span>{details.dose}</span>}
          {details.frequency && <span> · {details.frequency}</span>}
          {details.route && <span> · {details.route}</span>}
          {details.duration && <span> · {details.duration}</span>}
        </div>
        <div style={{ fontSize: 10, color: "#94a3b8" }}>
          Ordered by {order.orderedBy || "Doctor"} · {timeAgo(order.createdAt)}
        </div>
      </div>
      <div style={{ background: inProgress ? "#dbeafe" : "#fce7f3", border: `1px solid ${inProgress ? "#93c5fd" : "#f9a8d4"}`, borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 600, color: inProgress ? "#1d4ed8" : "#be185d", flexShrink: 0, textAlign: "center" }}>
        <i className="pi pi-arrow-down" style={{ fontSize: 10, marginRight: 4 }} />
        {inProgress ? "Recording in Treatment Chart ↓" : "Administer via Treatment Chart (MAR) ↓"}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function NurseOrdersPanel({ UHID, visitId, onConsentRequest, refreshTrigger }) {
  const [orders,      setOrders]      = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [nurseName,   setNurseName]   = useState(() => {
    try {
      const u = JSON.parse(localStorage.getItem("his_user") || "{}");
      return u.fullName || u.firstName ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : u.name || "";
    } catch { return ""; }
  });
  const intervalRef = useRef(null);

  const fetchOrders = useCallback(async () => {
    if (!UHID) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ UHID, status: "Pending,Acknowledged,InProgress,Completed" });
      if (visitId) params.append("visitId", visitId);
      const { data } = await axios.get(`${API_ENDPOINTS.DOCTOR_ORDERS}?${params}`);
      setOrders(data.data || []);
      setLastUpdated(new Date());
    } catch (_) {}
    finally { setLoading(false); }
  }, [UHID, visitId]);

  useEffect(() => {
    fetchOrders();
    intervalRef.current = setInterval(fetchOrders, 30000);
    return () => clearInterval(intervalRef.current);
  }, [fetchOrders]);

  // Immediately re-fetch when parent signals a refresh (e.g. after consent saved)
  useEffect(() => {
    if (refreshTrigger > 0) fetchOrders();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  // Nurse completes a step
  const handleStepDone = async (orderId, step, totalSteps) => {
    if (!nurseName.trim()) return;
    try {
      const { data } = await axios.post(
        `${API_ENDPOINTS.DOCTOR_ORDERS}/${orderId}/step`,
        { step, doneBy: nurseName.trim(), totalSteps }
      );
      setOrders(prev => prev.map(o => o._id === orderId ? data.data : o));
    } catch (_) {
      // Optimistic update on failure
      setOrders(prev => prev.map(o => {
        if (o._id !== orderId) return o;
        const newLog = [...(o.auditLog || []), { step, doneBy: nurseName, doneAt: new Date().toISOString() }];
        const done = newLog.length >= totalSteps;
        return { ...o, auditLog: newLog, currentStepIndex: newLog.length - 1, status: done ? "Completed" : "InProgress" };
      }));
    }
  };

  // Group orders into 3 buckets
  const newOrders    = orders.filter(o => o.status === "Pending").sort((a,b) => a.priority === "STAT" ? -1 : b.priority === "STAT" ? 1 : 0);
  const inProgress   = orders.filter(o => ["InProgress","OnHold","Acknowledged"].includes(o.status));
  const completed    = orders.filter(o => o.status === "Completed");
  const cancelled    = orders.filter(o => o.status === "Cancelled");
  const pending      = newOrders.length;

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 20, overflow: "hidden", boxShadow: "0 1px 8px rgba(0,0,0,.06)", fontFamily: "'DM Sans',sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ padding: "12px 18px", background: "linear-gradient(90deg, #db277710, #7c3aed08)", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <i className="pi pi-list" style={{ fontSize: 14, color: C.nurse }} />
          <span style={{ fontWeight: 800, fontSize: 13, color: C.nurse }}>Doctor Orders</span>
          {pending > 0 && (
            <span style={{ background: C.danger, color: "#fff", fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 20, animation: "npulse 1.5s infinite" }}>
              {pending} New
            </span>
          )}
          {orders.length > 0 && (
            <span style={{ fontSize: 11, color: C.muted }}>{orders.length} total · {completed.length} done</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {lastUpdated && <span style={{ fontSize: 10, color: C.muted }}>Updated {timeAgo(lastUpdated)}</span>}
          <button onClick={fetchOrders} disabled={loading}
            style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, color: C.muted, display: "flex", alignItems: "center", gap: 4 }}>
            <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} style={{ fontSize: 11 }} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Nurse name bar ── */}
      <div style={{ padding: "10px 18px", borderBottom: `1px solid ${C.border}`, background: "#fffbf0", display: "flex", alignItems: "center", gap: 10 }}>
        <i className="pi pi-user-edit" style={{ fontSize: 13, color: C.amber }} />
        <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, whiteSpace: "nowrap" }}>Nurse Name:</label>
        <input
          value={nurseName}
          onChange={e => setNurseName(e.target.value)}
          placeholder="Enter your name before taking action"
          style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark, background: "#fff" }}
        />
        {!nurseName.trim() && (
          <span style={{ fontSize: 10, color: C.amber, fontWeight: 600, whiteSpace: "nowrap" }}>Required to act on orders</span>
        )}
      </div>

      {/* ── Orders body ── */}
      <div style={{ padding: "14px 18px" }}>
        {!UHID ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: C.muted, fontSize: 13 }}>
            <i className="pi pi-info-circle" style={{ fontSize: 24, display: "block", marginBottom: 8 }} />
            Select a patient to view doctor orders.
          </div>
        ) : loading && orders.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: C.muted }}>
            <i className="pi pi-spin pi-spinner" style={{ fontSize: 22 }} />
          </div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: C.muted, fontSize: 13 }}>
            <i className="pi pi-check-circle" style={{ fontSize: 28, display: "block", marginBottom: 8, color: C.success }} />
            No active orders — Doctor has not placed any orders yet.
          </div>
        ) : (
          <>
            {/* ── NEW ORDERS ── */}
            {newOrders.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: C.danger, textTransform: "uppercase", letterSpacing: ".6px" }}>
                    🔔 New Orders
                  </div>
                  <span style={{ background: C.danger, color: "#fff", fontSize: 10, fontWeight: 800, padding: "1px 8px", borderRadius: 20 }}>{newOrders.length}</span>
                  <span style={{ fontSize: 10, color: C.muted }}>— Pending nurse action</span>
                </div>
                {newOrders.map(order => (
                  <div key={order._id}>
                    {order.orderType === "Medication" ? (
                      <MedOrderCard order={order} />
                    ) : (
                      <OrderCard order={order} nurseName={nurseName} onStepDone={handleStepDone} onConsentRequest={onConsentRequest} />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── IN PROGRESS ── */}
            {inProgress.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 8 }}>
                  ⏳ In Progress ({inProgress.length})
                </div>
                {inProgress.map(order => (
                  <div key={order._id}>
                    {order.orderType === "Medication" ? (
                      <MedOrderCard order={order} inProgress />
                    ) : (
                      <OrderCard order={order} nurseName={nurseName} onStepDone={handleStepDone} onConsentRequest={onConsentRequest} />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── COMPLETED ── */}
            {completed.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.success, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 8 }}>
                  ✅ Completed ({completed.length})
                </div>
                {completed.map(order => (
                  <OrderCard key={order._id} order={order} nurseName={nurseName} onStepDone={handleStepDone} onConsentRequest={onConsentRequest} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes npulse { 0%,100%{opacity:1} 50%{opacity:.5} }
      `}</style>
    </div>
  );
}
