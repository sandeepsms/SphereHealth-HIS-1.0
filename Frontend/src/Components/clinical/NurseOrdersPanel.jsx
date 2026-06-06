/**
 * NurseOrdersPanel.jsx
 * Step-based doctor order workflow for nurses — mirrors the NABH audit-ready order prototype.
 * Each order type has sequential steps; each step records nurse name + timestamp.
 * Props: { UHID, visitId (accepted but ignored — see R7bo-LIVE-fix-3), onConsentRequest, refreshTrigger }
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";

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
    // R7hr-53 [P1-14] — prepend 'Acknowledged' so the medication step flow
    // mirrors the explicit acknowledge → prepare → administer sequence used
    // elsewhere on the chart. (Backend /step route must accept these names —
    // see deferred note re: per-type step allowlist validation.)
    return ["Acknowledged", "Prepared", "Administered"];
  }
  // R7hr-53 [P1-14] — IV_Fluid was falling through to the generic
  // ['Acknowledged','Done'] flow, hiding bag-spike + monitoring milestones
  // that the NABH IV register expects. Explicit branch restores the audit trail.
  if (type === "IV_Fluid") {
    return ["Acknowledged", "Bag-Spiked", "Started", "Monitoring", "Completed"];
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
function OrderCard({ order, nurseName, onStepDone, onConsentRequest, readOnly = false }) {
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

  // R7hr-84 — Phase C billing surfacing on the Complete buttons.
  // The nurse's step buttons end with the order's final step, which
  // POSTs to /api/doctor-orders/:id/step. The backend route moves
  // the order to status:'Completed' on the last step (or when an
  // already-Completed order is touched), which is the Phase C
  // billing trigger when orderDetails.serviceMasterId is set.
  //
  // - If serviceMasterId is set: append a "Will bill ₹{unitPrice}"
  //   chip next to the step buttons so the nurse can see the order
  //   will auto-bill on completion.
  // - If serviceMasterId is null AND orderType is one of the 11
  //   ServiceMaster-mappable types (the full mappable set minus
  //   Medication, which renders via MedOrderCard, and Investigation,
  //   which is billed via the lab dispatch path), show a soft amber
  //   inline note ABOVE the step buttons so the nurse knows the
  //   completion won't auto-bill and the order needs a service pick.
  const BILLABLE_ORDER_TYPES = new Set([
    "IV_Fluid", "Lab", "Radiology", "Procedure", "BloodTransfusion",
    "Diet", "Oxygen", "Physiotherapy", "Activity", "Nursing", "Consultation",
  ]);
  const hasServicePick   = details.serviceMasterId != null && details.serviceMasterId !== "";
  const isBillableType   = BILLABLE_ORDER_TYPES.has(order.orderType);
  const showWillBillChip = hasServicePick && details.unitPrice != null;
  const showNoPickNote   = !hasServicePick && isBillableType;

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

            {/* R7hr-83 — Catalogued service pill (read-only): shows the ServiceMaster
                row the doctor picked at order time, so the nurse can see the
                billable service name + price. Only renders when the order was
                placed against a catalogued service. */}
            {details.serviceCode && (
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 11, padding: "2px 8px", borderRadius: 20,
                background: "#f3f4f6", border: "1px solid #e5e7eb",
                color: C.dark, marginBottom: 4, marginTop: 2,
              }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: C.muted, letterSpacing: ".3px" }}>SVC</span>
                <span style={{ fontWeight: 700 }}>{details.serviceCode}</span>
                {details.serviceName && <span style={{ color: C.muted }}>— {details.serviceName}</span>}
                {details.unitPrice != null && <span style={{ color: C.muted }}>· ₹{details.unitPrice}</span>}
              </div>
            )}

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

        {/* ── R7hr-84 — Soft amber inline note ABOVE the step buttons when
                the order is a billable type but the doctor never picked a
                ServiceMaster row. Completion will move the order to
                'Completed' but Phase C billing won't fire, so the nurse
                needs to know the charge has to be added separately. ── */}
        {!allDone && !readOnly && showNoPickNote && (
          <div style={{
            marginTop: 10, padding: "6px 10px", borderRadius: 6,
            background: "#fffbeb", border: "1px solid #fde68a",
            color: "#92400e", fontSize: 10.5, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <i className="pi pi-exclamation-triangle" style={{ fontSize: 11, color: C.amber }} />
            No ServiceMaster pick — completion won't auto-bill. Add a service via Doctor Orders.
          </div>
        )}

        {/* ── Step buttons ── */}
        {!allDone && !readOnly && (
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
            {/* R7hr-84 — "Will bill ₹{unitPrice}" chip rendered inline next
                to the step buttons whenever the doctor picked a ServiceMaster
                row at order time. Tells the nurse the next/last step click
                will auto-fire the Phase C billing trigger. */}
            {showWillBillChip && (
              <span title={`ServiceMaster pick: ${details.serviceCode || ""}${details.serviceName ? " — " + details.serviceName : ""}`}
                style={{
                  padding: "4px 10px", fontSize: 10.5, fontWeight: 700,
                  borderRadius: 20, background: "#ecfdf5",
                  border: `1px solid ${C.success}40`, color: C.success,
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}>
                <i className="pi pi-indian-rupee" style={{ fontSize: 10 }} />
                Will bill ₹{details.unitPrice}
              </span>
            )}
          </div>
        )}

        {/* ── Read-only step pills (R7bq-J3) ──
            Same step names + ✓ for done, but no click handler and a flat
            gray look so the nurse sees the workflow at a glance without
            being prompted to act on a course-day that's already complete. */}
        {!allDone && readOnly && (
          <>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {steps.map((step, i) => {
                const done = i < doneCount;
                return (
                  <span
                    key={step}
                    style={{
                      padding: "5px 12px", fontSize: 11, fontWeight: 600,
                      borderRadius: 6, background: done ? "#d1fae5" : "#f1f5f9",
                      color: done ? C.success : "#94a3b8",
                      opacity: done ? 1 : 0.6,
                      display: "flex", alignItems: "center", gap: 4,
                      cursor: "default",
                    }}>
                    {done ? <span>✓</span> : null}
                    {step}
                  </span>
                );
              })}
            </div>
            <div style={{ marginTop: 8, fontSize: 10.5, fontWeight: 700, color: C.success, display: "flex", alignItems: "center", gap: 5 }}>
              <i className="pi pi-check-circle" style={{ fontSize: 11 }} />
              Today's actions complete
            </div>
          </>
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
        {/* R7hr-83 — Catalogued service pill (read-only). Mirrors OrderCard. */}
        {details.serviceCode && (
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            fontSize: 11, padding: "2px 8px", borderRadius: 20,
            background: "#f3f4f6", border: "1px solid #e5e7eb",
            color: "#0f172a", alignSelf: "flex-start", marginTop: 2,
          }}>
            <span style={{ fontSize: 9, fontWeight: 800, color: "#64748b", letterSpacing: ".3px" }}>SVC</span>
            <span style={{ fontWeight: 700 }}>{details.serviceCode}</span>
            {details.serviceName && <span style={{ color: "#64748b" }}>— {details.serviceName}</span>}
            {details.unitPrice != null && <span style={{ color: "#64748b" }}>· ₹{details.unitPrice}</span>}
          </div>
        )}
        <div style={{ fontSize: 11, color: "#64748b" }}>
          {details.dose && <span>{details.dose}</span>}
          {details.frequency && <span> · {details.frequency}</span>}
          {details.route && <span> · {details.route}</span>}
          {details.duration && <span> · {details.duration}</span>}
        </div>
        {/* R7bq-1 — show IV dilution + infuse-over so nurse knows the drip rate at the MAR card */}
        {details.dilutionVolume > 0 && (
          <div style={{ fontSize: 10.5, fontWeight: 600, color: "#0369a1", background: "#e0f2fe", border: "1px solid #bae6fd", padding: "3px 8px", borderRadius: 5, alignSelf: "flex-start", marginTop: 2 }}>
            💧 Dilute in <strong>{details.dilutionVolume} ml {details.dilutionFluid || "NS 0.9%"}</strong>
            {details.infuseOverMinutes > 0 && <> · infuse over <strong>{details.infuseOverMinutes} min</strong></>}
          </div>
        )}
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

// ── Date helpers ──────────────────────────────────────────────────────────────
function fmtNavDate(d) {
  if (d.toDateString() === new Date().toDateString()) return "📅 Today";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

// ── Main panel ────────────────────────────────────────────────────────────────
// R7bo-LIVE-fix-3 — `visitId` is intentionally dropped from the
// destructure (callers still pass it; React silently ignores unknown
// props). The server-side `visitId` filter caused "No orders yet" when
// the parent's `patient.ipdNo || patient.admissionNumber || patient._id`
// resolved to a different identifier than the doctor stamped on the
// order. UHID + the in-component date filter are sufficient scoping
// (Bug A guarantees one active admission per UHID).
export default function NurseOrdersPanel({ UHID, onConsentRequest, refreshTrigger }) {
  // R7bq-I — Auto-resolve the acting user from AuthContext so Admin / Nurse
  // don't have to type their name into a textbox before acting on an order.
  // The system already knows who's logged in; the JWT-decoded user gives us
  // fullName + role. Keep the field editable so a senior who's logging on
  // behalf of a junior can override, but DON'T block actions when the name
  // resolves from auth (it always will, since this panel mounts behind
  // attemptAuth on the parent page).
  const { user } = useAuth();
  const resolvedActorName =
    user?.fullName
    || [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim()
    || user?.name
    || user?.email
    || "";
  const actorRole = user?.role || "User";

  const [orders,      setOrders]      = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [ordersDate,  setOrdersDate]  = useState(new Date());   // date navigator
  const [nurseName,   setNurseName]   = useState(resolvedActorName);
  // Keep nurseName in sync when AuthContext finishes restoring (initial render
  // can see user=null while the /auth/me round-trip completes).
  useEffect(() => {
    if (resolvedActorName && !nurseName) setNurseName(resolvedActorName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedActorName]);
  const intervalRef = useRef(null);
  // R7az-D5-MED-3 / D4-HIGH-6 — Abort cleanup for both the initial fetch
  // and the 30s polling timer. Pre-fix, leaving the page mid-fetch could
  // setState on a dead component, and a UHID switch left an in-flight
  // request from the previous patient that would land afterwards and
  // overwrite the new patient's orders.
  const fetchAbortRef = useRef(null);
  // R7az-D5-CRIT-2 — Per-(orderId, stepIndex) in-flight ref so a fast
  // double-tap on the same step doesn't push the same audit-log row
  // twice (we saw nurse-side dupes when the request was slow).
  const stepInFlightRef = useRef(new Set());

  const isOrdersToday = ordersDate.toDateString() === new Date().toDateString();

  const fetchOrders = useCallback(async () => {
    if (!UHID) return;
    if (fetchAbortRef.current) {
      try { fetchAbortRef.current.abort(); } catch (_) { /* noop */ }
    }
    const ctrl = new AbortController();
    fetchAbortRef.current = ctrl;
    setLoading(true);
    try {
      // R7bo-LIVE-fix-3 — Drop the visitId server-side filter. A single
      // UHID can legitimately have both a legacy `ipdNo` (ADM26050002)
      // AND a new `admissionNumber` (IPD-2026-000001) on the same active
      // admission, OR (worse) two co-existing "Active" admission docs
      // from a pre-uniqueness-index era. Whichever value the parent
      // happens to pass via `visitId={patient.ipdNo || patient.admissionNumber || patient._id}`
      // would silently mismatch orders the doctor saved against the other
      // identifier, and the nurse panel would render "No orders yet"
      // despite the orders existing. Scoping by UHID + today's date is
      // sufficient (Bug A guarantees one active admission per UHID), and
      // the displayOrders date filter below already narrows to the
      // selected day. `visitId` is still accepted as a prop for backward
      // compatibility but is no longer load-bearing.
      const params = new URLSearchParams({ UHID });
      const { data } = await axios.get(`${API_ENDPOINTS.DOCTOR_ORDERS}?${params}`, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      // Tolerate both the standard {ok,data,count} shape and (defensively)
      // a bare array — single source of truth is `data.data`, but if a
      // middleware ever swaps to returning the array directly we still
      // render instead of showing a phantom "No orders yet".
      const next = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
      setOrders(next);
      setLastUpdated(new Date());
    } catch (_) { /* silent — abort or transient */ }
    finally { if (!ctrl.signal.aborted) setLoading(false); }
  }, [UHID]);

  useEffect(() => {
    fetchOrders();
    intervalRef.current = setInterval(fetchOrders, 30000);
    return () => {
      clearInterval(intervalRef.current);
      // R7az-D5-MED-3: abort any in-flight axios so the unmount is clean.
      if (fetchAbortRef.current) {
        try { fetchAbortRef.current.abort(); } catch (_) { /* noop */ }
      }
    };
  }, [fetchOrders]);

  // Immediately re-fetch when parent signals a refresh (e.g. after consent saved)
  useEffect(() => {
    if (refreshTrigger > 0) fetchOrders();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  // Date navigation
  const prevDay = () => { const d = new Date(ordersDate); d.setDate(d.getDate() - 1); setOrdersDate(d); };
  const nextDay = () => {
    if (isOrdersToday) return;
    const d = new Date(ordersDate); d.setDate(d.getDate() + 1);
    if (d <= new Date()) setOrdersDate(d);
  };

  // Nurse completes a step.
  // R7az-D5-CRIT-3 — Pre-fix, on POST failure we still PUSHED the step
  // into the local auditLog. Result: nurse saw the step as "done" while
  // the server still showed it pending, then the next 30s poll would
  // wipe it out (or — worse — the nurse triggered a duplicate POST
  // thinking it failed silently). Now: server is the single source of
  // truth. On error we toast the failure and DO NOT mutate local state.
  // We also dedup concurrent step taps via stepInFlightRef.
  const handleStepDone = async (orderId, step, totalSteps) => {
    // R7bq-I — fall back to AuthContext if the field is blank, so logged-in
    // users (Admin / Nurse) can act without typing their name first.
    const doneBy = (nurseName || resolvedActorName || "").trim();
    if (!doneBy) {
      toast.error("Cannot identify who's acting — please log in.");
      return;
    }
    const inFlightKey = `${orderId}:${step}`;
    if (stepInFlightRef.current.has(inFlightKey)) return;  // double-tap guard
    stepInFlightRef.current.add(inFlightKey);
    try {
      const { data } = await axios.post(
        `${API_ENDPOINTS.DOCTOR_ORDERS}/${orderId}/step`,
        { step, doneBy, totalSteps }
      );
      setOrders(prev => prev.map(o => o._id === orderId ? data.data : o));
    } catch (err) {
      toast.error(
        "Could not record step '" + step + "': "
        + (err.response?.data?.message || err.message)
        + " — please retry."
      );
      // Trigger a refetch so the panel reflects whatever the server
      // actually has (in case the request succeeded but the response
      // never reached us due to a flaky connection).
      fetchOrders();
    } finally {
      stepInFlightRef.current.delete(inFlightKey);
    }
  };

  // Always filter by the selected date (orderedAt) — today and history both consistent
  const ordersDateStr = ordersDate.toDateString();
  const displayOrders = orders.filter(o => {
    const d = new Date(o.orderedAt || o.createdAt);
    return d.toDateString() === ordersDateStr;
  });

  // R7bq-J3 — distinguish "course still running but today's work is done" from
  // "actively waiting for nurse to do something". Lab/Radiology/Procedure orders
  // without an administrationRecord stay actionable by status alone; only
  // Medication/IV_Fluid use the per-day slot check.
  const todayActionable = (o) => {
    if (!Array.isArray(o.administrationRecord) || !o.administrationRecord.length) return true;
    const start = new Date(); start.setHours(0,0,0,0);
    const end   = new Date(start); end.setDate(end.getDate() + 1);
    return o.administrationRecord.some(a => {
      if (a.isStatDose) return false;
      const d = a.scheduledDate ? new Date(a.scheduledDate) : null;
      if (!d || d < start || d >= end) return false;
      return ["pending","delayed"].includes(a.status);
    });
  };

  // R7bq-J3 — days remaining on the prescribed course, for the "TODAY DONE" chip.
  const daysLeft = (o) => {
    if (!o.endDate) return null;
    const end = new Date(o.endDate); end.setHours(0,0,0,0);
    const today = new Date(); today.setHours(0,0,0,0);
    return Math.max(0, Math.round((end - today) / 86400000));
  };

  // Group orders into buckets
  // R7hr-53 [P1-13] — priority-rank comparator with oldest-first tiebreaker.
  // Pre-fix the sort was binary (STAT vs not), so Urgent ranked identically to
  // Routine and queue order within a priority was non-deterministic.
  const priorityRank = { STAT: 0, Urgent: 1, Routine: 2, Default: 3 };
  const newOrders     = displayOrders.filter(o => o.status === "Pending").sort((a, b) => {
    const ra = priorityRank[a.priority] ?? 3;
    const rb = priorityRank[b.priority] ?? 3;
    if (ra !== rb) return ra - rb;
    // tiebreaker: oldest first
    const ta = new Date(a.orderedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.orderedAt || b.createdAt || 0).getTime();
    return ta - tb;
  });
  // R7hr-53 [P0-5] — add 'Active' (backend stamp for IV_Fluid) and 'Modified'
  // (result of doctor 'modify' action) to the in-progress bucket so they
  // don't silently disappear from the nurse panel.
  const inProgressAll = displayOrders.filter(o => ["InProgress","OnHold","Acknowledged","Active","Modified"].includes(o.status));
  const inProgress    = inProgressAll.filter(todayActionable);
  const todayDone     = inProgressAll.filter(o => !todayActionable(o));
  const completed     = displayOrders.filter(o => o.status === "Completed");
  const cancelled     = displayOrders.filter(o => ["Cancelled","Stopped"].includes(o.status));
  const pending       = newOrders.length;

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, marginBottom: 20, overflow: "hidden", boxShadow: "0 1px 8px rgba(0,0,0,.06)", fontFamily: "'DM Sans',sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ padding: "12px 18px", background: "linear-gradient(90deg, #db277710, #7c3aed08)", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <i className="pi pi-list" style={{ fontSize: 14, color: C.nurse }} />
          <span style={{ fontWeight: 800, fontSize: 13, color: C.nurse }}>Doctor Orders</span>
          {pending > 0 && isOrdersToday && (
            <span style={{ background: C.danger, color: "#fff", fontSize: 10, fontWeight: 800, padding: "2px 9px", borderRadius: 20, animation: "npulse 1.5s infinite" }}>
              {pending} New
            </span>
          )}
          {displayOrders.length > 0 && (
            <span style={{ fontSize: 11, color: C.muted }}>{displayOrders.length} order{displayOrders.length !== 1 ? "s" : ""} · {completed.length} done</span>
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

      {/* ── Date Navigator ── */}
      <div style={{ padding: "9px 18px", borderBottom: `1px solid ${C.border}`, background: "#fafbfe", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={prevDay}
          style={{ border: `1px solid ${C.border}`, background: "#fff", borderRadius: 7, padding: "4px 12px", cursor: "pointer", fontSize: 12, color: C.muted, fontWeight: 600 }}>
          ← Prev
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: isOrdersToday ? C.purple : C.dark }}>
            {fmtNavDate(ordersDate)}
            {!isOrdersToday && (
              <span style={{ fontWeight: 400, fontSize: 11, color: C.muted }}>
                {" — "}{ordersDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              </span>
            )}
          </span>
          {!isOrdersToday && (
            <button onClick={() => setOrdersDate(new Date())}
              style={{ border: `1px solid ${C.purple}40`, background: `${C.purple}0d`, borderRadius: 5, padding: "3px 9px", cursor: "pointer", fontSize: 10, color: C.purple, fontWeight: 700 }}>
              Today
            </button>
          )}
        </div>
        <button onClick={nextDay} disabled={isOrdersToday}
          style={{ border: `1px solid ${C.border}`, background: isOrdersToday ? "#f1f5f9" : "#fff", borderRadius: 7, padding: "4px 12px", cursor: isOrdersToday ? "not-allowed" : "pointer", fontSize: 12, color: isOrdersToday ? "#cbd5e1" : C.muted, fontWeight: 600 }}>
          Next →
        </button>
      </div>

      {/* ── Acting-as bar (R7bq-I) ──
            The signed-in user's name + role is pulled from AuthContext and
            stamped on every step click + administer call. Field is still
            editable (e.g. a senior signing on behalf of a junior), but no
            longer blocks actions when blank — we fall back to the auth
            identity inside the click handlers. */}
      <div style={{ padding: "10px 18px", borderBottom: `1px solid ${C.border}`, background: resolvedActorName ? "#f0fdf4" : "#fffbf0", display: "flex", alignItems: "center", gap: 10 }}>
        <i className={`pi ${resolvedActorName ? "pi-user-check" : "pi-user-edit"}`} style={{ fontSize: 13, color: resolvedActorName ? "#16a34a" : C.amber }} />
        <label style={{ fontSize: 11, fontWeight: 600, color: C.muted, whiteSpace: "nowrap" }}>Acting as:</label>
        <input
          value={nurseName}
          onChange={e => setNurseName(e.target.value)}
          placeholder={resolvedActorName ? "" : "Enter your name before taking action"}
          style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark, background: "#fff" }}
        />
        {resolvedActorName ? (
          <span style={{ fontSize: 10, color: "#16a34a", fontWeight: 700, whiteSpace: "nowrap", background: "#dcfce7", border: "1px solid #86efac", padding: "2px 8px", borderRadius: 4 }}>
            ✓ {actorRole}
          </span>
        ) : !nurseName.trim() && (
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
        ) : displayOrders.length === 0 ? (
          <div style={{ textAlign: "center", padding: "28px 0", color: C.muted, fontSize: 13 }}>
            <i className="pi pi-calendar" style={{ fontSize: 30, display: "block", marginBottom: 10, color: "#cbd5e1" }} />
            <div style={{ fontWeight: 700, fontSize: 14, color: C.dark, marginBottom: 4 }}>
              {isOrdersToday ? "No orders yet" : "No orders on this date"}
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>
              {isOrdersToday
                ? "Doctor has not placed any orders yet."
                : `No orders were placed on ${ordersDate.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`}
            </div>
            {!isOrdersToday && (
              <button onClick={() => setOrdersDate(new Date())}
                style={{ marginTop: 12, border: `1px solid ${C.purple}40`, background: `${C.purple}0d`, borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontSize: 11, color: C.purple, fontWeight: 700 }}>
                View Today's Orders
              </button>
            )}
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
                      <OrderCard order={order} nurseName={nurseName || resolvedActorName} onStepDone={handleStepDone} onConsentRequest={onConsentRequest} />
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
                      <OrderCard order={order} nurseName={nurseName || resolvedActorName} onStepDone={handleStepDone} onConsentRequest={onConsentRequest} />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── TODAY COMPLETE (R7bq-J3) ──
                Orders whose course is still running but today's scheduled work
                is done. Renders denser + green so the nurse can scan past them
                without thinking they need action. */}
            {todayDone.length > 0 && (
              <div style={{ marginBottom: 16, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.success, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 8 }}>
                  ✓ Today Complete — {todayDone.length} order{todayDone.length !== 1 ? "s" : ""} · course continues
                </div>
                {todayDone.map(order => {
                  const left = daysLeft(order);
                  const chipText = left == null
                    ? "TODAY DONE — course continues"
                    : `TODAY DONE · ${left} day${left !== 1 ? "s" : ""} left`;
                  return (
                    <div key={order._id} style={{ position: "relative" }}>
                      {order.orderType === "Medication" ? (
                        <MedOrderCard order={order} inProgress />
                      ) : (
                        <OrderCard order={order} nurseName={nurseName || resolvedActorName} onStepDone={handleStepDone} onConsentRequest={onConsentRequest} readOnly />
                      )}
                      <div style={{ position: "absolute", top: 8, right: 12, background: "#dcfce7", color: "#166534", border: "1px solid #86efac", borderRadius: 20, padding: "2px 9px", fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px", pointerEvents: "none" }}>
                        {chipText}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── COMPLETED ── */}
            {completed.length > 0 && (
              <div style={{ marginBottom: cancelled.length > 0 ? 16 : 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.success, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 8 }}>
                  ✅ Completed ({completed.length})
                </div>
                {completed.map(order => (
                  <OrderCard key={order._id} order={order} nurseName={nurseName || resolvedActorName} onStepDone={handleStepDone} onConsentRequest={onConsentRequest} />
                ))}
              </div>
            )}

            {/* ── CANCELLED / STOPPED (historical) ── */}
            {cancelled.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.danger, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 8 }}>
                  🚫 Cancelled / Stopped ({cancelled.length})
                </div>
                {cancelled.map(order => (
                  <OrderCard key={order._id} order={order} nurseName={nurseName || resolvedActorName} onStepDone={handleStepDone} onConsentRequest={onConsentRequest} />
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
