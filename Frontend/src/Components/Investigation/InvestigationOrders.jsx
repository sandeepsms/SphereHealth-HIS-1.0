import React, { useState, useEffect, useRef } from "react";
import { printOrderSlip, printReport } from "./investigationPrint";
import { Card } from "primereact/card";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { Toast } from "primereact/toast";
import { Tag } from "primereact/tag";
import { InputNumber } from "primereact/inputnumber";
import { InputTextarea } from "primereact/inputtextarea";
import { MultiSelect } from "primereact/multiselect";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

const ORDER_STATUS = {
  PENDING: { label: "Pending", severity: "warning" },
  SAMPLE_COLLECTED: { label: "Sample Collected", severity: "info" },
  IN_PROGRESS: { label: "In Progress", severity: "info" },
  COMPLETED: { label: "Completed", severity: "success" },
  CANCELLED: { label: "Cancelled", severity: "danger" },
};

const RESULT_STATUS_COLOR = {
  PENDING: "#f59e0b",
  IN_PROGRESS: "#3b82f6",
  COMPLETED: "#8b5cf6",
  VERIFIED: "#10b981",
};

const PRIORITY_COLOR = {
  ROUTINE: "#6c757d",
  URGENT: "#f59e0b",
  STAT: "#dc2626",
};

const BLANK_NEW_ORDER = {
  UHID: "",
  patientName: "",
  contactNumber: "",
  visitType: "OPD",
  orderedBy: "DOCTOR",
  doctorName: "",
  doctorNote: "",
  paymentType: "CASH",
  tpaId: null,
  tpaName: null,
  items: [],
  priority: "ROUTINE",
  notes: "",
};

export default function InvestigationOrders() {
  const toast = useRef(null);
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({});

  const [filters, setFilters] = useState({
    UHID: "",
    orderStatus: null,
    priority: null,
    fromDate: "",
    toDate: "",
  });

  // New order dialog
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [investigations, setInvestigations] = useState([]);
  const [tpaList, setTpaList] = useState([]);
  const [newOrder, setNewOrder] = useState(BLANK_NEW_ORDER);

  // Order detail dialog
  const [showDetail, setShowDetail] = useState(false);
  const [selOrder, setSelOrder] = useState(null);

  // Result entry dialog
  const [showResults, setShowResults] = useState(false);
  const [resultForms, setResultForms] = useState([]);

  // External result dialog
  const [showExternal, setShowExternal] = useState(false);
  const [selExternalItem, setSelExternalItem] = useState(null);
  const [externalForm, setExternalForm] = useState({
    externalLabName: "",
    externalReportRef: "",
    interpretation: "",
  });

  const showToast = (s, sum, det) =>
    toast.current?.show({ severity: s, summary: sum, detail: det, life: 3000 });

  // ── Load ──────────────────────────────────────────────────────
  const loadOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 100 });
      if (filters.UHID) params.append("UHID", filters.UHID);
      if (filters.orderStatus)
        params.append("orderStatus", filters.orderStatus);
      if (filters.priority) params.append("priority", filters.priority);
      if (filters.fromDate) params.append("fromDate", filters.fromDate);
      if (filters.toDate) params.append("toDate", filters.toDate);

      const res = await fetch(`${API}/investigation-orders?${params}`);
      const data = await res.json();
      setOrders(data.data || []);
      setTotal(data.total || 0);
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSummary = async () => {
    try {
      const res = await fetch(`${API}/investigation-orders/summary`);
      const data = await res.json();
      setSummary(data.data || {});
    } catch {}
  };

  const loadInvestigations = async () => {
    try {
      const res = await fetch(`${API}/investigations?limit=300`);
      const data = await res.json();
      setInvestigations(
        (data.data || []).map((i) => ({
          label: `${i.investigationCode} — ${i.investigationName}`,
          value: i._id,
          category: i.category,
          price: i.defaultPrice,
          sampleType: i.sampleType,
          performedAt: i.performedAt,
        })),
      );
    } catch {}
  };

  const loadTPA = async () => {
    try {
      const res = await fetch(`${API}/tpa`);
      const data = await res.json();
      setTpaList(
        (data.data || []).map((t) => ({
          label: t.tpaName,
          value: t._id,
          name: t.tpaName,
        })),
      );
    } catch {}
  };

  useEffect(() => {
    loadOrders();
    loadSummary();
  }, [filters]);
  useEffect(() => {
    loadInvestigations();
    loadTPA();
  }, []);

  // ── Create Order ──────────────────────────────────────────────
  const handleCreateOrder = async () => {
    if (!newOrder.UHID)
      return showToast("warn", "Required", "Enter patient UHID");
    if (!newOrder.items.length)
      return showToast("warn", "Required", "Select at least one test");

    setLoading(true);
    try {
      // Build items with performedAt from investigation master
      const items = newOrder.items.map((id) => {
        const inv = investigations.find((i) => i.value === id);
        return {
          investigationId: id,
          performedAt:
            inv?.performedAt === "EXTERNAL" ? "EXTERNAL" : "INTERNAL",
        };
      });

      const payload = {
        ...newOrder,
        patientId: newOrder.UHID,
        items,
      };
      delete payload.items; // will be re-added below
      payload.items = items;

      const res = await fetch(`${API}/investigation-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, investigationIds: undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      showToast(
        "success",
        "Order Created",
        `Order #${data.data?.orderNumber} created`,
      );
      setShowNewOrder(false);
      setNewOrder(BLANK_NEW_ORDER);
      loadOrders();
      loadSummary();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Open Detail ───────────────────────────────────────────────
  const openDetail = async (order) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/investigation-orders/${order._id}`);
      const data = await res.json();
      setSelOrder(data.data);
      setShowDetail(true);
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Sample Collect ────────────────────────────────────────────
  const handleCollectSample = async (orderId) => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/investigation-orders/${orderId}/collect-sample`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collectedBy: "Lab Staff" }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showToast("success", "Sample Collected", "Sample collected successfully");
      openDetail({ _id: orderId });
      loadOrders();
      loadSummary();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Open Result Entry (internal) ──────────────────────────────
  const openResultEntry = (order) => {
    const forms = (order.items || [])
      .filter(
        (i) => i.performedAt === "INTERNAL" && i.resultStatus !== "VERIFIED",
      )
      .map((item) => ({
        itemId: item._id,
        investigationName: item.investigationName,
        results: item.results?.length
          ? item.results
          : [
              {
                parameterName: "",
                value: "",
                unit: "",
                normalRange: "",
                isAbnormal: false,
              },
            ],
        interpretation: item.interpretation || "",
      }));
    setResultForms(forms);
    setShowResults(true);
  };

  const handleSaveResults = async () => {
    if (!selOrder) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/investigation-orders/${selOrder._id}/enter-results`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemResults: resultForms,
            enteredBy: "Lab Technician",
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showToast("success", "Results Saved", "Results saved successfully");
      setShowResults(false);
      openDetail({ _id: selOrder._id });
      loadOrders();
      loadSummary();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── External Result Entry ─────────────────────────────────────
  const openExternalEntry = (order, item) => {
    setSelOrder(order);
    setSelExternalItem(item);
    setExternalForm({
      externalLabName: item.externalLabName || "",
      externalReportRef: item.externalReportRef || "",
      interpretation: item.interpretation || "",
    });
    setShowExternal(true);
  };

  const handleSaveExternal = async () => {
    if (!externalForm.externalLabName)
      return showToast("warn", "Required", "Enter the external lab name");
    setLoading(true);
    try {
      const res = await fetch(
        `${API}/investigation-orders/${selOrder._id}/enter-external-result`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemId: selExternalItem._id,
            enteredBy: "Staff",
            ...externalForm,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showToast(
        "success",
        "External Result Saved",
        "External report details saved",
      );
      setShowExternal(false);
      openDetail({ _id: selOrder._id });
      loadOrders();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Verify ────────────────────────────────────────────────────
  const handleVerify = async (orderId) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/investigation-orders/${orderId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifiedBy: "Pathologist" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showToast("success", "Verified", "Results verified successfully");
      openDetail({ _id: orderId });
      loadOrders();
      loadSummary();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Cancel ────────────────────────────────────────────────────
  const handleCancel = async (orderId) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/investigation-orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cancelledBy: "Staff",
          reason: "Cancelled by staff",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showToast("warn", "Cancelled", "Order cancelled");
      setShowDetail(false);
      loadOrders();
      loadSummary();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Result form helpers ───────────────────────────────────────
  const addResultRow = (fi) => {
    const u = [...resultForms];
    u[fi].results.push({
      parameterName: "",
      value: "",
      unit: "",
      normalRange: "",
      isAbnormal: false,
    });
    setResultForms(u);
  };

  const updateResult = (fi, ri, field, value) => {
    const u = [...resultForms];
    u[fi].results[ri][field] = value;
    setResultForms(u);
  };

  const updateInterpretation = (fi, value) => {
    const u = [...resultForms];
    u[fi].interpretation = value;
    setResultForms(u);
  };

  // ── Summary Card ──────────────────────────────────────────────
  const SCard = ({ label, value, color }) => (
    <div
      style={{
        background: "#fff",
        border: `2px solid ${color}20`,
        borderRadius: 10,
        padding: "12px 18px",
        flex: 1,
        minWidth: 110,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "#6c757d",
          fontWeight: 600,
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color }}>{value ?? "—"}</div>
    </div>
  );

  const selectedTotal = newOrder.items.reduce((s, id) => {
    const inv = investigations.find((i) => i.value === id);
    return s + (inv?.price || 0);
  }, 0);

  // ══════════════════════════════════════════════════════════════
  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "8px 12px" }}>
      <Toast ref={toast} position="top-right" />

      {/* Summary */}
      <div
        style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}
      >
        <SCard
          label="Today's Orders"
          value={summary.todayOrders}
          color="#0891b2"
        />
        <SCard label="Pending" value={summary.pending} color="#f59e0b" />
        <SCard label="In Progress" value={summary.inProgress} color="#3b82f6" />
        <SCard
          label="Completed Today"
          value={summary.completed}
          color="#10b981"
        />
        <SCard label="Urgent" value={summary.urgent} color="#dc2626" />
      </div>

      {/* Filter Bar */}
      <Card style={{ marginBottom: 8 }}>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 15, color: "#0891b2" }}>
            <i className="pi pi-list" style={{ marginRight: 6 }} />
            Investigation Orders
          </span>

          <InputText
            value={filters.UHID}
            onChange={(e) =>
              setFilters({ ...filters, UHID: e.target.value.toUpperCase() })
            }
            placeholder="Search by UHID..."
            style={{ width: 160 }}
          />

          <Dropdown
            value={filters.orderStatus}
            options={[
              { label: "All Status", value: null },
              ...Object.entries(ORDER_STATUS).map(([v, c]) => ({
                label: c.label,
                value: v,
              })),
            ]}
            onChange={(e) => setFilters({ ...filters, orderStatus: e.value })}
            style={{ width: 170 }}
          />

          <Dropdown
            value={filters.priority}
            options={[
              { label: "All Priority", value: null },
              { label: "Routine", value: "ROUTINE" },
              { label: "Urgent", value: "URGENT" },
              { label: "STAT", value: "STAT" },
            ]}
            onChange={(e) => setFilters({ ...filters, priority: e.value })}
            style={{ width: 130 }}
          />

          <InputText
            type="date"
            value={filters.fromDate}
            onChange={(e) =>
              setFilters({ ...filters, fromDate: e.target.value })
            }
            style={{ width: 140 }}
          />
          <InputText
            type="date"
            value={filters.toDate}
            onChange={(e) => setFilters({ ...filters, toDate: e.target.value })}
            style={{ width: 140 }}
          />

          <div style={{ marginLeft: "auto" }}>
            <Button
              label="New Order"
              icon="pi pi-plus"
              severity="success"
              onClick={() => setShowNewOrder(true)}
            />
          </div>
        </div>
      </Card>

      {/* Orders Table */}
      <Card>
        <DataTable
          value={orders}
          loading={loading}
          size="small"
          stripedRows
          header={
            <span style={{ fontSize: 13, color: "#6c757d" }}>
              {total} orders
            </span>
          }
          emptyMessage="No orders found"
        >
          <Column
            field="orderNumber"
            header="Order #"
            style={{ fontFamily: "monospace", fontSize: 12, width: 160 }}
          />
          <Column
            header="Patient"
            body={(r) => (
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {r.patientId?.fullName || r.patientName || "—"}
                </div>
                <div style={{ fontSize: 11, color: "#6c757d" }}>{r.UHID}</div>
              </div>
            )}
            style={{ minWidth: 140 }}
          />
          <Column
            header="Tests"
            body={(r) => (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {(r.items || []).slice(0, 3).map((i, idx) => (
                  <span
                    key={idx}
                    style={{
                      background:
                        i.performedAt === "EXTERNAL" ? "#fef3c7" : "#e0f2fe",
                      color:
                        i.performedAt === "EXTERNAL" ? "#92400e" : "#0369a1",
                      borderRadius: 4,
                      padding: "1px 6px",
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  >
                    {i.investigationCode}
                    {i.performedAt === "EXTERNAL" && " (Ext)"}
                  </span>
                ))}
                {r.items?.length > 3 && (
                  <span style={{ fontSize: 10, color: "#6c757d" }}>
                    +{r.items.length - 3} more
                  </span>
                )}
              </div>
            )}
            style={{ minWidth: 200 }}
          />
          <Column
            header="Status"
            body={(r) => {
              const s = ORDER_STATUS[r.orderStatus] || ORDER_STATUS.PENDING;
              return (
                <Tag
                  value={s.label}
                  severity={s.severity}
                  style={{ fontSize: 10 }}
                />
              );
            }}
            style={{ width: 130 }}
          />
          <Column
            header="Priority"
            body={(r) => (
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 12,
                  color: PRIORITY_COLOR[r.priority],
                }}
              >
                {r.priority}
              </span>
            )}
            style={{ width: 80 }}
          />
          <Column
            header="Amount"
            body={(r) => <b>₹{r.totalAmount?.toLocaleString("en-IN")}</b>}
            style={{ width: 90 }}
          />
          <Column
            header="Date"
            body={(r) => (
              <span style={{ fontSize: 11 }}>
                {new Date(r.createdAt).toLocaleDateString("en-IN")}
              </span>
            )}
            style={{ width: 90 }}
          />
          <Column
            header="Actions"
            body={(r) => (
              <div style={{ display: "flex", gap: 4 }}>
                <Button
                  icon="pi pi-eye"
                  text
                  size="small"
                  tooltip="View Details"
                  onClick={() => openDetail(r)}
                />
                {r.orderStatus === "PENDING" && (
                  <Button
                    icon="pi pi-send"
                    text
                    size="small"
                    severity="info"
                    tooltip="Collect Sample"
                    onClick={() => handleCollectSample(r._id)}
                  />
                )}
              </div>
            )}
            style={{ width: 90 }}
          />
        </DataTable>
      </Card>

      {/* ═══ NEW ORDER DIALOG ═══ */}
      <Dialog
        visible={showNewOrder}
        style={{ width: "min(820px, 96vw)" }}
        header="New Investigation Order"
        onHide={() => {
          setShowNewOrder(false);
          setNewOrder(BLANK_NEW_ORDER);
        }}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              label="Cancel"
              severity="secondary"
              outlined
              onClick={() => setShowNewOrder(false)}
            />
            <Button
              label="Create Order"
              icon="pi pi-check"
              severity="success"
              onClick={handleCreateOrder}
              loading={loading}
            />
          </div>
        }
      >
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
        >
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Patient UHID *
            </label>
            <InputText
              value={newOrder.UHID}
              onChange={(e) =>
                setNewOrder({ ...newOrder, UHID: e.target.value.toUpperCase() })
              }
              placeholder="UH00000001"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Patient Name
            </label>
            <InputText
              value={newOrder.patientName}
              onChange={(e) =>
                setNewOrder({ ...newOrder, patientName: e.target.value })
              }
              placeholder="Auto-filled from UHID"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Visit Type
            </label>
            <Dropdown
              value={newOrder.visitType}
              options={["OPD", "IPD", "DAYCARE", "EMERGENCY", "WALKIN"].map(
                (v) => ({ label: v, value: v }),
              )}
              onChange={(e) => setNewOrder({ ...newOrder, visitType: e.value })}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Priority
            </label>
            <Dropdown
              value={newOrder.priority}
              options={[
                { label: "Routine", value: "ROUTINE" },
                { label: "Urgent", value: "URGENT" },
                { label: "STAT", value: "STAT" },
              ]}
              onChange={(e) => setNewOrder({ ...newOrder, priority: e.value })}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Referring Doctor
            </label>
            <InputText
              value={newOrder.doctorName}
              onChange={(e) =>
                setNewOrder({ ...newOrder, doctorName: e.target.value })
              }
              placeholder="Dr. Name"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Payment Type
            </label>
            <Dropdown
              value={newOrder.paymentType}
              options={["CASH", "TPA", "CORPORATE"].map((v) => ({
                label: v,
                value: v,
              }))}
              onChange={(e) =>
                setNewOrder({ ...newOrder, paymentType: e.value, tpaId: null })
              }
              style={{ width: "100%" }}
            />
          </div>

          {newOrder.paymentType === "TPA" && (
            <div>
              <label
                style={{
                  fontWeight: 600,
                  fontSize: 12,
                  display: "block",
                  marginBottom: 3,
                }}
              >
                TPA *
              </label>
              <Dropdown
                value={newOrder.tpaId}
                options={tpaList}
                onChange={(e) => {
                  const t = tpaList.find((x) => x.value === e.value);
                  setNewOrder({
                    ...newOrder,
                    tpaId: e.value,
                    tpaName: t?.name || null,
                  });
                }}
                placeholder="Select TPA"
                filter
                style={{ width: "100%" }}
              />
            </div>
          )}

          <div style={{ gridColumn: "span 2" }}>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Clinical Note
            </label>
            <InputText
              value={newOrder.doctorNote}
              onChange={(e) =>
                setNewOrder({ ...newOrder, doctorNote: e.target.value })
              }
              placeholder="e.g. Fever for 3 days, rule out Dengue"
              style={{ width: "100%" }}
            />
          </div>

          <div style={{ gridColumn: "span 2" }}>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Select Tests *{" "}
              <span style={{ fontWeight: 400, color: "#6c757d" }}>
                ({newOrder.items.length} selected)
              </span>
            </label>
            <MultiSelect
              value={newOrder.items}
              options={investigations}
              onChange={(e) => setNewOrder({ ...newOrder, items: e.value })}
              placeholder="Search and select tests..."
              filter
              display="chip"
              style={{ width: "100%" }}
              itemTemplate={(opt) => (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    width: "100%",
                    gap: 8,
                  }}
                >
                  <span>{opt.label}</span>
                  <div
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        background:
                          opt.performedAt === "EXTERNAL"
                            ? "#fef3c7"
                            : "#e0f2fe",
                        color:
                          opt.performedAt === "EXTERNAL"
                            ? "#92400e"
                            : "#0369a1",
                        borderRadius: 4,
                        padding: "1px 5px",
                      }}
                    >
                      {opt.performedAt}
                    </span>
                    <b style={{ color: "#0d6efd" }}>₹{opt.price}</b>
                  </div>
                </div>
              )}
            />
          </div>

          {newOrder.items.length > 0 && (
            <div
              style={{
                gridColumn: "span 2",
                background: "#e7f3ff",
                borderRadius: 8,
                padding: "10px 14px",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                Selected Tests:
              </div>
              {newOrder.items.map((id) => {
                const inv = investigations.find((i) => i.value === id);
                return inv ? (
                  <div
                    key={id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      marginBottom: 3,
                    }}
                  >
                    <span
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      {inv.label.split(" — ")[1]}
                      {inv.performedAt === "EXTERNAL" && (
                        <span
                          style={{
                            fontSize: 10,
                            background: "#fef3c7",
                            color: "#92400e",
                            borderRadius: 4,
                            padding: "1px 5px",
                          }}
                        >
                          External
                        </span>
                      )}
                    </span>
                    <b>₹{inv.price?.toLocaleString("en-IN")}</b>
                  </div>
                ) : null;
              })}
              <div
                style={{
                  borderTop: "1px solid #bee3f8",
                  marginTop: 8,
                  paddingTop: 6,
                  display: "flex",
                  justifyContent: "space-between",
                  fontWeight: 700,
                }}
              >
                <span>Total (CASH estimate)</span>
                <span style={{ color: "#0d6efd" }}>
                  ₹{selectedTotal.toLocaleString("en-IN")}
                </span>
              </div>
            </div>
          )}
        </div>
      </Dialog>

      {/* ═══ ORDER DETAIL DIALOG ═══ */}
      <Dialog
        visible={showDetail && !!selOrder}
        style={{ width: "min(920px, 96vw)" }}
        header={
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span>Order — {selOrder?.orderNumber}</span>
            {selOrder && (
              <Tag
                value={ORDER_STATUS[selOrder.orderStatus]?.label}
                severity={ORDER_STATUS[selOrder.orderStatus]?.severity}
              />
            )}
            {selOrder?.priority !== "ROUTINE" && (
              <span
                style={{
                  color: PRIORITY_COLOR[selOrder?.priority],
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {selOrder?.priority}
              </span>
            )}
          </div>
        }
        onHide={() => {
          setShowDetail(false);
          setSelOrder(null);
        }}
      >
        {selOrder && (
          <div>
            {/* Patient info */}
            <div
              style={{
                background: "#f8fafc",
                borderRadius: 8,
                padding: "10px 16px",
                marginBottom: 14,
                display: "flex",
                gap: 28,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: "#6c757d" }}>Patient</div>
                <b>{selOrder.patientId?.fullName || selOrder.patientName}</b>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#6c757d" }}>UHID</div>
                <b style={{ fontFamily: "monospace" }}>{selOrder.UHID}</b>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#6c757d" }}>Doctor</div>
                <b>{selOrder.doctorName || "—"}</b>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#6c757d" }}>Payment</div>
                <Tag
                  value={selOrder.paymentType}
                  severity="secondary"
                  style={{ fontSize: 10 }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#6c757d" }}>Total</div>
                <b style={{ color: "#0d6efd" }}>
                  ₹{selOrder.totalAmount?.toLocaleString("en-IN")}
                </b>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#6c757d" }}>
                  Internal / External
                </div>
                <b>
                  {selOrder.internalTestsCount} / {selOrder.externalTestsCount}
                </b>
              </div>
              {selOrder.doctorNote && (
                <div style={{ width: "100%" }}>
                  <div style={{ fontSize: 11, color: "#6c757d" }}>
                    Clinical Note
                  </div>
                  <i>{selOrder.doctorNote}</i>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 14,
                flexWrap: "wrap",
              }}
            >
              {selOrder.orderStatus === "PENDING" && (
                <Button
                  label="Collect Sample"
                  icon="pi pi-send"
                  severity="info"
                  size="small"
                  onClick={() => handleCollectSample(selOrder._id)}
                  loading={loading}
                />
              )}
              {["SAMPLE_COLLECTED", "IN_PROGRESS"].includes(
                selOrder.orderStatus,
              ) &&
                selOrder.items?.some(
                  (i) =>
                    i.performedAt === "INTERNAL" &&
                    i.resultStatus !== "VERIFIED",
                ) && (
                  <Button
                    label="Enter Results (Internal)"
                    icon="pi pi-pencil"
                    severity="warning"
                    size="small"
                    onClick={() => openResultEntry(selOrder)}
                  />
                )}
              {selOrder.orderStatus !== "CANCELLED" &&
                selOrder.items?.some((i) => i.resultStatus === "COMPLETED") && (
                  <Button
                    label="Verify Results"
                    icon="pi pi-verified"
                    severity="success"
                    size="small"
                    onClick={() => handleVerify(selOrder._id)}
                    loading={loading}
                  />
                )}
              {selOrder.orderStatus === "COMPLETED" && (
                <Button
                  label="Print Report"
                  icon="pi pi-print"
                  severity="secondary"
                  size="small"
                  onClick={async () => {
                    await fetch(
                      `${API}/investigation-orders/${selOrder._id}/print`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ printedBy: "Staff" }),
                      },
                    );
                    printReport(selOrder);
                  }}
                />
              )}
              <Button
                label="Print Order Slip"
                icon="pi pi-file-export"
                severity="secondary"
                outlined
                size="small"
                onClick={() => printOrderSlip(selOrder)}
              />
              {!["COMPLETED", "CANCELLED"].includes(selOrder.orderStatus) && (
                <Button
                  label="Cancel Order"
                  icon="pi pi-times"
                  severity="danger"
                  outlined
                  size="small"
                  onClick={() => handleCancel(selOrder._id)}
                  loading={loading}
                />
              )}
            </div>

            {/* Tests table */}
            <DataTable value={selOrder.items} size="small" stripedRows>
              <Column
                field="investigationCode"
                header="Code"
                style={{ fontFamily: "monospace", fontSize: 12, width: 110 }}
              />
              <Column field="investigationName" header="Test Name" />
              <Column
                header="Where"
                body={(r) => (
                  <Tag
                    value={r.performedAt}
                    severity={
                      r.performedAt === "EXTERNAL" ? "warning" : "success"
                    }
                    style={{ fontSize: 10 }}
                  />
                )}
                style={{ width: 90 }}
              />
              <Column
                header="Sample"
                body={(r) => {
                  if (r.performedAt === "EXTERNAL")
                    return (
                      <span style={{ fontSize: 11, color: "#6c757d" }}>
                        N/A
                      </span>
                    );
                  return (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color:
                          r.sampleStatus === "COLLECTED"
                            ? "#10b981"
                            : r.sampleStatus === "REJECTED"
                              ? "#dc2626"
                              : "#f59e0b",
                      }}
                    >
                      {r.sampleStatus}
                    </span>
                  );
                }}
                style={{ width: 120 }}
              />
              <Column
                header="Result"
                body={(r) => (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: RESULT_STATUS_COLOR[r.resultStatus],
                    }}
                  >
                    {r.resultStatus}
                  </span>
                )}
                style={{ width: 100 }}
              />
              <Column
                header="Price"
                body={(r) => `₹${r.chargedPrice?.toLocaleString("en-IN")}`}
                style={{ width: 80 }}
              />
              <Column
                header="External Lab"
                body={(r) =>
                  r.performedAt === "EXTERNAL"
                    ? r.externalLabName || (
                        <span style={{ color: "#6c757d" }}>Not set</span>
                      )
                    : "—"
                }
                style={{ width: 130 }}
              />
              <Column
                header="Actions"
                body={(r) =>
                  r.performedAt === "EXTERNAL" &&
                  r.resultStatus !== "VERIFIED" ? (
                    <Button
                      label="Add Report"
                      icon="pi pi-file"
                      text
                      size="small"
                      severity="warning"
                      onClick={() => openExternalEntry(selOrder, r)}
                    />
                  ) : null
                }
                style={{ width: 110 }}
              />
            </DataTable>
          </div>
        )}
      </Dialog>

      {/* ═══ INTERNAL RESULT ENTRY DIALOG ═══ */}
      <Dialog
        visible={showResults}
        style={{ width: "min(880px, 96vw)" }}
        header="Enter Results (Internal Tests)"
        onHide={() => setShowResults(false)}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              label="Cancel"
              severity="secondary"
              outlined
              onClick={() => setShowResults(false)}
            />
            <Button
              label="Save Results"
              icon="pi pi-check"
              severity="success"
              onClick={handleSaveResults}
              loading={loading}
            />
          </div>
        }
      >
        <div style={{ maxHeight: "65vh", overflowY: "auto" }}>
          {resultForms.map((form, fi) => (
            <div
              key={form.itemId}
              style={{
                marginBottom: 20,
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: "#f1f5f9",
                  padding: "8px 14px",
                  fontWeight: 700,
                  fontSize: 13,
                  color: "#0891b2",
                }}
              >
                {form.investigationName}
              </div>
              <div style={{ padding: 14 }}>
                {form.results.map((row, ri) => (
                  <div
                    key={ri}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 1fr 1fr 2fr auto",
                      gap: 8,
                      marginBottom: 8,
                      alignItems: "center",
                    }}
                  >
                    <InputText
                      value={row.parameterName}
                      onChange={(e) =>
                        updateResult(fi, ri, "parameterName", e.target.value)
                      }
                      placeholder="Parameter name"
                      style={{ width: "100%" }}
                    />
                    <InputText
                      value={row.value}
                      onChange={(e) =>
                        updateResult(fi, ri, "value", e.target.value)
                      }
                      placeholder="Value"
                      style={{ width: "100%" }}
                    />
                    <InputText
                      value={row.unit}
                      onChange={(e) =>
                        updateResult(fi, ri, "unit", e.target.value)
                      }
                      placeholder="Unit"
                      style={{ width: "100%" }}
                    />
                    <InputText
                      value={row.normalRange}
                      onChange={(e) =>
                        updateResult(fi, ri, "normalRange", e.target.value)
                      }
                      placeholder="Normal range"
                      style={{ width: "100%" }}
                    />
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <input
                        type="checkbox"
                        checked={row.isAbnormal}
                        onChange={(e) =>
                          updateResult(fi, ri, "isAbnormal", e.target.checked)
                        }
                      />
                      <label style={{ fontSize: 11, color: "#dc2626" }}>
                        Abnormal
                      </label>
                    </div>
                  </div>
                ))}
                <Button
                  label="+ Add Row"
                  text
                  size="small"
                  onClick={() => addResultRow(fi)}
                  style={{ marginBottom: 8 }}
                />
                <div>
                  <label
                    style={{
                      fontWeight: 600,
                      fontSize: 12,
                      display: "block",
                      marginBottom: 3,
                    }}
                  >
                    Interpretation / Remarks
                  </label>
                  <InputTextarea
                    value={form.interpretation}
                    onChange={(e) => updateInterpretation(fi, e.target.value)}
                    rows={2}
                    style={{ width: "100%" }}
                    placeholder="Overall interpretation..."
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Dialog>

      {/* ═══ EXTERNAL RESULT DIALOG ═══ */}
      <Dialog
        visible={showExternal}
        style={{ width: "min(480px, 96vw)" }}
        header={`External Report — ${selExternalItem?.investigationName || ""}`}
        onHide={() => setShowExternal(false)}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              label="Cancel"
              severity="secondary"
              outlined
              onClick={() => setShowExternal(false)}
            />
            <Button
              label="Save"
              icon="pi pi-check"
              severity="success"
              onClick={handleSaveExternal}
              loading={loading}
            />
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              color: "#92400e",
            }}
          >
            This test was performed at an external lab. Enter the lab details
            and report reference below.
          </div>

          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              External Lab Name *
            </label>
            <InputText
              value={externalForm.externalLabName}
              onChange={(e) =>
                setExternalForm({
                  ...externalForm,
                  externalLabName: e.target.value,
                })
              }
              placeholder="e.g. Metropolis, SRL, Dr. Lal PathLabs"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Report Reference / ID
            </label>
            <InputText
              value={externalForm.externalReportRef}
              onChange={(e) =>
                setExternalForm({
                  ...externalForm,
                  externalReportRef: e.target.value,
                })
              }
              placeholder="Report number or barcode"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Interpretation / Summary
            </label>
            <InputTextarea
              value={externalForm.interpretation}
              onChange={(e) =>
                setExternalForm({
                  ...externalForm,
                  interpretation: e.target.value,
                })
              }
              rows={3}
              placeholder="Key findings from the external report..."
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
