/**
 * NurseOrdersPanel.jsx
 * Displays doctor orders for a patient. Nurses can acknowledge / progress / complete orders.
 * Polls every 30s. Props: { UHID, visitId, onConsentRequest }
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

const C = {
  purple: "#7c3aed", nurse: "#db2777", teal: "#0f766e",
  amber: "#d97706", danger: "#dc2626", success: "#059669",
  bg: "#f8fafc", card: "#fff", border: "#e2e8f0", muted: "#64748b", dark: "#0f172a",
};

const TYPE_COLOR = {
  Medication:   "#7c3aed",
  Investigation:"#0284c7",
  Procedure:    "#db2777",
  Diet:         "#059669",
  Activity:     "#d97706",
  Nursing:      "#0f766e",
};

const PRIORITY_STYLE = {
  STAT:    { bg: "#fef2f2", color: "#dc2626", label: "STAT" },
  Urgent:  { bg: "#fffbeb", color: "#d97706", label: "Urgent" },
  Routine: { bg: "#f1f5f9", color: "#64748b", label: "Routine" },
};

const STATUS_STYLE = {
  Pending:      { bg: "#fef3c7", color: "#d97706" },
  Acknowledged: { bg: "#dbeafe", color: "#1d4ed8" },
  InProgress:   { bg: "#e0e7ff", color: "#4f46e5" },
  Completed:    { bg: "#d1fae5", color: "#059669" },
  Cancelled:    { bg: "#fee2e2", color: "#dc2626" },
  OnHold:       { bg: "#f1f5f9", color: "#64748b" },
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

function OrderCard({ order, onStatusChange, onConsentRequest }) {
  const typeColor = TYPE_COLOR[order.orderType] || C.muted;
  const priorityS = PRIORITY_STYLE[order.priority] || PRIORITY_STYLE.Routine;
  const statusS = STATUS_STYLE[order.status] || STATUS_STYLE.Pending;
  const details = order.orderDetails || {};
  const displayName =
    details.displayName ||
    details.medicineName ||
    details.testName ||
    details.procedureName ||
    order.orderType;

  const needsConsent =
    order.orderType === "Procedure" &&
    details.consentRequired &&
    order.consentStatus === "Pending";

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: "12px 14px", marginBottom: 10,
      borderLeft: `4px solid ${typeColor}`,
      boxShadow: "0 1px 4px rgba(0,0,0,.04)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Top row: type badge + priority + name */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: typeColor + "15", color: typeColor }}>
              {order.orderType}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: priorityS.bg, color: priorityS.color }}>
              {priorityS.label}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.dark }}>
              {displayName}
            </span>
          </div>

          {/* Details row */}
          <div style={{ fontSize: 11, color: C.muted, display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
            {details.dose && <span>Dose: {details.dose}</span>}
            {details.frequency && <span>· {details.frequency}</span>}
            {details.duration && <span>· {details.duration}</span>}
            {details.route && <span>· {details.route}</span>}
            {details.urgency && <span>Urgency: {details.urgency}</span>}
            {details.instructions && <span>· {details.instructions}</span>}
            {details.procedureType && <span>Type: {details.procedureType}</span>}
            {details.estimatedDuration && <span>· Est: {details.estimatedDuration}</span>}
          </div>

          {/* Meta row */}
          <div style={{ fontSize: 10, color: "#94a3b8", display: "flex", gap: 8, alignItems: "center" }}>
            <span>By {order.orderedBy || "Doctor"}</span>
            <span>·</span>
            <span>{timeAgo(order.createdAt)}</span>
            {order.consentStatus && order.consentStatus !== "NotRequired" && (
              <>
                <span>·</span>
                <span style={{
                  fontWeight: 700,
                  color: order.consentStatus === "Obtained" ? C.success : order.consentStatus === "Declined" ? C.danger : C.amber,
                }}>
                  Consent: {order.consentStatus}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Status chip */}
        <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: statusS.bg, color: statusS.color, flexShrink: 0 }}>
          {order.status}
        </span>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        {order.status === "Pending" && (
          <button onClick={() => onStatusChange(order._id, "Acknowledged")}
            style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: "#dbeafe", color: "#1d4ed8", cursor: "pointer" }}>
            Acknowledge
          </button>
        )}
        {(order.status === "Pending" || order.status === "Acknowledged") && (
          <button onClick={() => onStatusChange(order._id, "InProgress")}
            style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: "#e0e7ff", color: "#4f46e5", cursor: "pointer" }}>
            In Progress
          </button>
        )}
        {order.status !== "Completed" && order.status !== "Cancelled" && (
          <button onClick={() => onStatusChange(order._id, "Completed")}
            style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: "#d1fae5", color: "#059669", cursor: "pointer" }}>
            Complete
          </button>
        )}
        {needsConsent && (
          <button onClick={() => onConsentRequest && onConsentRequest(order)}
            style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: "#fce7f3", color: "#be185d", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <i className="pi pi-lock" style={{ fontSize: 10 }} /> Take Consent
          </button>
        )}
      </div>
    </div>
  );
}

export default function NurseOrdersPanel({ UHID, visitId, onConsentRequest }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const intervalRef = useRef(null);

  const fetchOrders = useCallback(async () => {
    if (!UHID) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: "Pending,Acknowledged,InProgress" });
      if (UHID) params.append("UHID", UHID);
      if (visitId) params.append("visitId", visitId);
      const { data } = await axios.get(`${API_ENDPOINTS.DOCTOR_ORDERS}?${params.toString()}`);
      setOrders(data.data || []);
      setLastUpdated(new Date());
    } catch (_) {
      // silently ignore — nurse panel is non-critical
    } finally {
      setLoading(false);
    }
  }, [UHID, visitId]);

  useEffect(() => {
    fetchOrders();
    intervalRef.current = setInterval(fetchOrders, 30000);
    return () => clearInterval(intervalRef.current);
  }, [fetchOrders]);

  const handleStatusChange = async (orderId, newStatus) => {
    try {
      await axios.patch(`${API_ENDPOINTS.DOCTOR_ORDERS}/${orderId}`, { status: newStatus });
      setOrders((prev) =>
        prev.map((o) => (o._id === orderId ? { ...o, status: newStatus } : o))
      );
    } catch (_) {}
  };

  // Group by type
  const grouped = orders.reduce((acc, order) => {
    const type = order.orderType || "Other";
    if (!acc[type]) acc[type] = [];
    acc[type].push(order);
    return acc;
  }, {});

  const pendingCount = orders.filter((o) => o.status === "Pending").length;

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 20, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,.05)" }}>
      {/* Header */}
      <div style={{ padding: "12px 18px", background: C.nurse + "08", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <i className="pi pi-list" style={{ fontSize: 14, color: C.nurse }} />
          <span style={{ fontWeight: 700, fontSize: 13, color: C.nurse }}>Doctor Orders</span>
          {pendingCount > 0 && (
            <span style={{
              background: C.danger, color: "#fff",
              fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 20,
              animation: "pulse 1.5s infinite",
            }}>
              {pendingCount} Pending
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {lastUpdated && (
            <span style={{ fontSize: 10, color: C.muted }}>
              Updated {timeAgo(lastUpdated)}
            </span>
          )}
          <button onClick={fetchOrders} disabled={loading}
            style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11, color: C.muted, display: "flex", alignItems: "center", gap: 4 }}>
            <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} style={{ fontSize: 11 }} />
            Refresh
          </button>
        </div>
      </div>

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
          Object.entries(grouped).map(([type, typeOrders]) => (
            <div key={type} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: TYPE_COLOR[type] || C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: TYPE_COLOR[type] || C.muted, display: "inline-block" }} />
                {type} ({typeOrders.length})
              </div>
              {typeOrders.map((order) => (
                <OrderCard
                  key={order._id}
                  order={order}
                  onStatusChange={handleStatusChange}
                  onConsentRequest={onConsentRequest}
                />
              ))}
            </div>
          ))
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%,100% { opacity:1; }
          50%      { opacity:.6; }
        }
      `}</style>
    </div>
  );
}
