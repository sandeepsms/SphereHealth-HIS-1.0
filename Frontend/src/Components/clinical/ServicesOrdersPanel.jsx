import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { toMoney } from "../../utils/money";
import { confirm } from "../common/ConfirmDialog";
import { promptInput } from "../common/InputDialog";
import ServiceAutocomplete from "./ServiceAutocomplete";

/**
 * ServicesOrdersPanel — Unified "Services & Orders → DRAFT bill" panel
 * used by OPD + Emergency doctor assessments.
 *
 * R7ay — Extracted from OPDAssessmentPage.jsx so the Emergency Department
 * doctor flow can drop in the same DRAFT-bill + ServiceAutocomplete + Active /
 * Billed / Cancelled split. OPD continues to use its inline copy for now;
 * a follow-up cleanup will migrate OPD to this component too.
 *
 * Props:
 *   uhid       — patient UHID string (required to spin up the draft bill)
 *   visitType  — "OPD" | "ER" | "Daycare"  (determines the bill's visitType)
 *   addedBy    — display name of the ordering doctor (audit trail)
 *   theme      — { border, dark, muted, bg, accent } colour overrides
 *
 * The component manages ALL its own state internally — orderItems, the
 * draft bill id, the new-row form, and the saving spinner. Parents don't
 * need to plumb any of this through.
 */

const DEFAULT_THEME = {
  border: "#e2e6ea",
  dark:   "#1a1d23",
  muted:  "#6b7280",
  bg:     "#f0f2f5",
  accent: "#0284c7",
};

const STATUS_PILL = {
  Ordered:    { bg: "#dbeafe", fg: "#1d4ed8", label: "Ordered" },
  InProgress: { bg: "#fef3c7", fg: "#a16207", label: "In Progress" },
  Completed:  { bg: "#dcfce7", fg: "#15803d", label: "Billed" },
  Cancelled:  { bg: "#fee2e2", fg: "#b91c1c", label: "Cancelled" },
};

/* R7bp-OPD-FILTER: visitType is the bill's own enum ("OPD" | "ER" |
   "Daycare"), but ServiceMaster.applicableTo uses a different enum
   ("OPD" | "IPD" | "DAYCARE" | "EMERGENCY" | "ALL"). Map between them
   so the autocomplete actually filters to context-relevant rows. Without
   this, Emergency was sending applicableTo="ER" which matched only rows
   tagged "ALL" — every Emergency-specific service was invisible. */
const VISIT_TYPE_TO_APPLICABLE = {
  OPD:     "OPD",
  ER:      "EMERGENCY",
  Daycare: "DAYCARE",
  IPD:     "IPD",
};

export default function ServicesOrdersPanel({ uhid, visitType = "OPD", addedBy = "Doctor", theme }) {
  const C = { ...DEFAULT_THEME, ...(theme || {}) };
  const applicableTo = VISIT_TYPE_TO_APPLICABLE[visitType] || visitType;

  const [newOrder, setNewOrder] = useState({ service: null, name: "", qty: 1, urgency: "Routine", instructions: "" });
  const [orderItems, setOrderItems] = useState([]);
  const [orderBillId, setOrderBillId] = useState(null);
  const [orderBillNum, setOrderBillNum] = useState("");
  const [orderSaving, setOrderSaving] = useState(false);
  // R7bp-OPD-DUP — Synchronous re-entrancy lock. A useState boolean
  // wouldn't help here: two rapid clicks both run before React commits
  // the first setOrderSaving(true), so both pass the if-check. A ref
  // flips synchronously in the same tick → the second click bails out.
  const orderSavingRef = useRef(false);

  /* ─── DRAFT-bill load on mount / uhid change ──────────────────
     Look for an existing DRAFT for this UHID + visitType so the doctor
     sees the partial bill if they revisit the page or another team
     member started it earlier. Silent fallback when no DRAFT — the next
     add-service click will spin one up via ensureDraftBill(). */
  const refreshDraftBill = async (signal) => {
    if (!uhid) return;
    try {
      const { data } = await axios.get(
        `${API_ENDPOINTS.BASE}/billing/uhid/${encodeURIComponent(uhid)}`,
        signal ? { signal } : undefined,
      );
      const bills = data?.bills || data?.data?.bills || [];
      const draft = bills.find(b => b.visitType === visitType && b.billStatus === "DRAFT");
      if (draft) {
        setOrderBillId(draft._id);
        setOrderBillNum(draft.billNumber || "(DRAFT)");
        setOrderItems(Array.isArray(draft.billItems) ? draft.billItems : []);
      }
    } catch (e) {
      if (e?.name !== "CanceledError" && e?.name !== "AbortError") {
        console.debug("[ServicesOrdersPanel] draft lookup skipped:", e?.message);
      }
    }
  };

  useEffect(() => {
    if (!uhid) return;
    const ac = new AbortController();
    refreshDraftBill(ac.signal);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uhid, visitType]);

  const ensureDraftBill = async () => {
    if (orderBillId) return orderBillId;
    if (!uhid) throw new Error("Patient UHID unknown — cannot create bill");
    const { data } = await axios.post(`${API_ENDPOINTS.BASE}/billing/create`, {
      UHID:      uhid,
      visitType,
    });
    const bill = data?.data || data;
    if (!bill?._id) throw new Error("Could not create draft bill");
    setOrderBillId(bill._id);
    setOrderBillNum(bill.billNumber || "(DRAFT)");
    setOrderItems(Array.isArray(bill.billItems) ? bill.billItems : []);
    return bill._id;
  };

  const addOrderToBill = async () => {
    // R7bp-OPD-DUP — Synchronous re-entrancy guard. The button is also
    // `disabled` while orderSaving is true, but React batches the state
    // update so a hardware double-click (or an axios retry) can still fire
    // two onClicks before the disabled paint lands. The ref flips
    // immediately so the second call short-circuits before its POST.
    if (orderSavingRef.current) return;
    orderSavingRef.current = true;
    const svc = newOrder.service;
    if (!svc?._id) {
      orderSavingRef.current = false;
      return toast.warn("Pick a service from the list first");
    }
    const qty = Math.max(1, Number(newOrder.qty) || 1);

    setOrderSaving(true);
    try {
      const billId = await ensureDraftBill();
      const { data } = await axios.post(
        `${API_ENDPOINTS.BASE}/billing/${billId}/add-service`,
        {
          serviceId: svc._id,
          quantity: qty,
          remarks: [newOrder.urgency, newOrder.instructions].filter(Boolean).join(" · ") || undefined,
          addedBySource: "Doctor",
          addedBy,
          addedByRole: "Doctor",
        },
      );
      const bill = data?.data || data;
      setOrderItems(Array.isArray(bill?.billItems) ? bill.billItems : []);
      setOrderBillNum(bill?.billNumber || orderBillNum || "(DRAFT)");
      // PD-02 — Sticky urgency + instructions across rapid multi-add.
      // Pre-PD-02 every successful add reset urgency to "Routine" and
      // wiped instructions, so a doctor ordering 6 STAT-Fasting labs had
      // to re-pick the urgency and re-type the instructions 6 times.
      // Now we reset only the per-row fields (service / name / qty) and
      // KEEP the shared row metadata so the doctor types it once and
      // adds 6 tests with 6 quick autocomplete picks. The IPD IA pattern
      // (R7hr-69 chip-flow) would be the richer fix; this is the smallest
      // additive nudge that materially solves the click-fatigue UX.
      setNewOrder(prev => ({
        service: null,
        name: "",
        qty: 1,
        urgency:      prev.urgency      || "Routine",
        instructions: prev.instructions || "",
      }));
      toast.success(`${svc.serviceName} ordered — will bill once completed`);
    } catch (e) {
      // R7bp-OPD-DUP — Surface the real backend error so the user isn't
      // staring at a silent UI. Special-case E11000 (Mongo duplicate-key)
      // because the bill-number generator briefly trips it when two writes
      // race; the row almost always lands on the next render, so we
      // auto-refresh after 1s and tell the user to retry.
      const status = e?.response?.status;
      const serverMsg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        "Could not add to bill";
      const isDupKey =
        /E11000/i.test(serverMsg) ||
        /duplicate key/i.test(serverMsg) ||
        e?.response?.data?.code === 11000;
      if (isDupKey) {
        toast.error("Looks like the bill is still being created — please retry in a second.");
        setTimeout(() => { refreshDraftBill().catch(() => {}); }, 1000);
      } else {
        toast.error(`Failed to add service: ${serverMsg}${status ? ` (${status})` : ""}`);
      }
    } finally {
      setOrderSaving(false);
      orderSavingRef.current = false;
    }
  };

  const removeOrderFromBill = async (item) => {
    if (!orderBillId || !item?._id) return;
    if (!(await confirm({
      title: "Remove from bill?",
      body: `"${item.serviceName}" will be removed from the draft bill. If the lab has already started this order, ask reception before removing.`,
      danger: true,
      confirmLabel: "Remove",
    }))) return;
    try {
      const { data } = await axios.delete(
        `${API_ENDPOINTS.BASE}/billing/${orderBillId}/items/${item._id}`,
      );
      const bill = data?.data || data;
      setOrderItems(Array.isArray(bill?.billItems) ? bill.billItems : []);
      toast.success("Removed from bill");
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not remove — bill may already be generated");
    }
  };

  const completeOrderItem = async (item) => {
    if (!orderBillId || !item?._id) return;
    try {
      const { data } = await axios.patch(
        `${API_ENDPOINTS.BASE}/billing/${orderBillId}/items/${item._id}/complete`,
      );
      const bill = data?.data || data;
      setOrderItems(Array.isArray(bill?.billItems) ? bill.billItems : []);
      toast.success(`${item.serviceName} marked completed — now billable`);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not complete order");
    }
  };

  const cancelOrderItem = async (item) => {
    if (!orderBillId || !item?._id) return;
    const reason = await promptInput({
      title: `Cancel order "${item.serviceName}"?`,
      body:  "Enter a brief reason. This goes into the bill's audit trail and is visible to reception.",
      placeholder: "e.g. Doctor advised to defer — repeat next visit",
      required: true,
      multiline: false,
      confirmLabel: "Cancel order",
      cancelLabel: "Keep order",
      danger: true,
    });
    if (reason == null) return;
    try {
      const { data } = await axios.patch(
        `${API_ENDPOINTS.BASE}/billing/${orderBillId}/items/${item._id}/cancel-order`,
        { cancelReason: reason },
      );
      const bill = data?.data || data;
      setOrderItems(Array.isArray(bill?.billItems) ? bill.billItems : []);
      toast.success(`Order cancelled: ${item.serviceName}`);
    } catch (e) {
      toast.error(e?.response?.data?.message || "Could not cancel order");
    }
  };

  /* ─── Render helpers ─────────────────────────────────────────── */
  const isBillable  = (it) => !it.orderStatus || it.orderStatus === "Completed";
  const isCancelled = (it) => it.orderStatus === "Cancelled";
  const activeOrders   = orderItems.filter(it => !isBillable(it) && !isCancelled(it));
  const billedItems    = orderItems.filter(isBillable);
  const cancelledItems = orderItems.filter(isCancelled);
  const activeTotal = activeOrders.reduce((s, it) => s + toMoney(it.netAmount), 0);
  const billedTotal = billedItems.reduce((s, it) => s + toMoney(it.netAmount), 0);

  const renderRow = (it) => {
    const status = it.orderStatus || "Completed";
    const pill = STATUS_PILL[status] || STATUS_PILL.Completed;
    return (
      <tr key={it._id} style={{ borderBottom: `1px solid ${C.border}`, opacity: status === "Cancelled" ? 0.55 : 1 }}>
        <td style={{ padding: "7px 10px", color: C.dark, fontWeight: 500 }}>
          {it.serviceName}
          {it.category && <span style={{ fontSize: 10, color: C.muted, marginLeft: 6 }}>· {it.category}</span>}
          <span style={{
            display: "inline-block", marginLeft: 8,
            padding: "1px 7px", borderRadius: 999,
            background: pill.bg, color: pill.fg,
            fontSize: 9, fontWeight: 800, textTransform: "uppercase",
            letterSpacing: 0.3, verticalAlign: "middle",
          }}>{pill.label}</span>
        </td>
        <td style={{ padding: "7px 10px", color: C.muted, fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{it.serviceCode || "—"}</td>
        <td style={{ padding: "7px 10px", color: C.dark, fontFamily: "'DM Mono', monospace" }}>{it.quantity ?? 1}</td>
        <td style={{ padding: "7px 10px", color: C.muted, fontFamily: "'DM Mono', monospace" }}>
          ₹{toMoney(it.unitPrice).toLocaleString("en-IN")}
        </td>
        <td style={{ padding: "7px 10px", color: status === "Completed" ? C.dark : C.muted, fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>
          ₹{toMoney(it.netAmount).toLocaleString("en-IN")}
        </td>
        <td style={{ padding: "7px 10px", color: C.muted, fontSize: 11 }}>{it.remarks || "—"}</td>
        <td style={{ padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
          {(status === "Ordered" || status === "InProgress") && (
            <>
              <button type="button" onClick={() => completeOrderItem(it)}
                title={`Mark ${it.serviceName} completed (will charge ₹${toMoney(it.netAmount).toLocaleString("en-IN")} to the bill)`}
                aria-label="Mark completed"
                style={{ width: 26, height: 24, border: "1px solid #86efac", background: "#ecfdf5", color: "#15803d", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", fontWeight: 700, fontSize: 12, lineHeight: 1, padding: 0, marginRight: 4 }}
              >✓</button>
              <button type="button" onClick={() => cancelOrderItem(it)}
                title={`Cancel order ${it.serviceName} (audit-preserved, not charged)`}
                aria-label="Cancel order"
                style={{ width: 26, height: 24, border: "1px solid #fcd34d", background: "#fffbeb", color: "#a16207", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", fontWeight: 700, fontSize: 13, lineHeight: 1, padding: 0 }}
              >⊘</button>
            </>
          )}
          {(status !== "Ordered" && status !== "InProgress") && (
            <button type="button" onClick={() => removeOrderFromBill(it)}
              title={`Remove ${it.serviceName}`}
              aria-label="Remove service"
              style={{ width: 24, height: 24, border: "1px solid #fca5a5", background: "#fef2f2", color: "#b91c1c", borderRadius: 6, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", fontWeight: 700, fontSize: 13, lineHeight: 1, padding: 0 }}
              onMouseEnter={e => { e.currentTarget.style.background = "#fee2e2"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#fef2f2"; }}
            >×</button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div>
      {orderBillId && (
        <div style={{
          marginBottom: 10, padding: "8px 12px",
          background: "#f0f9ff", border: "1px solid #bae6fd",
          borderRadius: 8, fontSize: 12, color: "#075985",
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        }}>
          <i className="pi pi-receipt" style={{ color: C.accent }} />
          <span>
            Linked to DRAFT bill <strong style={{ fontFamily: "'DM Mono', monospace" }}>{orderBillNum}</strong>
            {" "}— orders appear under <strong>Active Orders</strong> and are billed to the patient only after the executing team marks them complete.
          </span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2.2fr) minmax(0,0.6fr) minmax(0,0.9fr) minmax(0,1.4fr) auto", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <ServiceAutocomplete
          value={newOrder.name}
          applicableTo={applicableTo}
          onChange={(v) => setNewOrder(p => ({ ...p, name: v, service: null }))}
          onPick={(s) => setNewOrder(p => ({
            ...p,
            service: s,
            name: `${s.serviceCode ? s.serviceCode + " · " : ""}${s.serviceName}`,
          }))}
          placeholder="Service / Investigation / Procedure — start typing"
          inputStyle={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark, width: "100%" }}
          inputClassName=""
          showLabel={false}
        />
        <input
          type="number" min="1" step="1"
          value={newOrder.qty}
          onChange={e => setNewOrder(p => ({ ...p, qty: e.target.value === "" ? 1 : Number(e.target.value) }))}
          placeholder="Qty"
          title="Quantity / Units"
          style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
        />
        <select
          value={newOrder.urgency}
          onChange={e => setNewOrder(p => ({ ...p, urgency: e.target.value }))}
          style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark, background: "#fff" }}
        >
          <option value="Routine">Routine</option>
          <option value="Urgent">Urgent</option>
          <option value="STAT">STAT</option>
        </select>
        <input
          value={newOrder.instructions}
          onChange={e => setNewOrder(p => ({ ...p, instructions: e.target.value }))}
          placeholder="Special instructions (optional)"
          style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
        />
        <button
          onClick={addOrderToBill}
          disabled={orderSaving || !newOrder.service}
          title={newOrder.service ? "" : "Pick a service from the dropdown first"}
          style={{
            background: !newOrder.service ? "#cbd5e1" : (orderSaving ? "#7dd3fc" : C.accent),
            color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px",
            cursor: orderSaving || !newOrder.service ? "not-allowed" : "pointer",
            fontWeight: 600, fontSize: 12,
            display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          <i className={`pi ${orderSaving ? "pi-spin pi-spinner" : "pi-plus"}`} />
          {orderSaving ? "Adding…" : "Add to Bill"}
        </button>
      </div>

      {orderItems.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>
          No orders yet. Pick a lab test, imaging, consumable, or minor procedure above —
          it'll go to Active Orders. The patient is only billed once the executing team confirms completion.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: C.bg }}>
            {["Service / Order", "Code", "Qty", "Rate", "Net", "Notes"].map(h => (
              <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }}>{h}</th>
            ))}
            <th style={{ width: 70, borderBottom: `1px solid ${C.border}` }} aria-label="Actions" />
          </tr></thead>
          <tbody>
            {activeOrders.length > 0 && (
              <tr style={{ background: "#eff6ff" }}>
                <td colSpan={7} style={{ padding: "6px 10px", color: "#1d4ed8", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  <i className="pi pi-clock" style={{ marginRight: 6 }} />
                  Active Orders · {activeOrders.length} pending · ₹{activeTotal.toLocaleString("en-IN")} will bill on completion
                </td>
              </tr>
            )}
            {activeOrders.map(renderRow)}

            {billedItems.length > 0 && (
              <tr style={{ background: "#ecfdf5" }}>
                <td colSpan={7} style={{ padding: "6px 10px", color: "#15803d", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  <i className="pi pi-check-circle" style={{ marginRight: 6 }} />
                  Billed (Completed) · {billedItems.length} item{billedItems.length === 1 ? "" : "s"}
                </td>
              </tr>
            )}
            {billedItems.map(renderRow)}

            {cancelledItems.length > 0 && (
              <tr style={{ background: "#fef2f2" }}>
                <td colSpan={7} style={{ padding: "6px 10px", color: "#b91c1c", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  <i className="pi pi-ban" style={{ marginRight: 6 }} />
                  Cancelled · {cancelledItems.length} item{cancelledItems.length === 1 ? "" : "s"} (audit only, not charged)
                </td>
              </tr>
            )}
            {cancelledItems.map(renderRow)}

            <tr style={{ background: C.bg, fontWeight: 700, borderTop: `2px solid ${C.border}` }}>
              <td colSpan={4} style={{ padding: "8px 10px", color: "#1d4ed8", textTransform: "uppercase", fontSize: 11, letterSpacing: 0.4 }}>
                Pending orders (not yet billed)
              </td>
              <td style={{ padding: "8px 10px", color: "#1d4ed8", fontFamily: "'DM Mono', monospace", fontSize: 13 }}>
                ₹{activeTotal.toLocaleString("en-IN")}
              </td>
              <td colSpan={2} />
            </tr>
            <tr style={{ background: C.bg, fontWeight: 700 }}>
              <td colSpan={4} style={{ padding: "8px 10px", color: "#0f172a", textTransform: "uppercase", fontSize: 11, letterSpacing: 0.4 }}>
                Billed total (due now)
              </td>
              <td style={{ padding: "8px 10px", color: "#0f172a", fontFamily: "'DM Mono', monospace", fontSize: 13 }}>
                ₹{billedTotal.toLocaleString("en-IN")}
              </td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
