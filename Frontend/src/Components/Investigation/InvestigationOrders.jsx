// frontend/components/Investigation/InvestigationOrders.jsx
// Complete Lab workflow: Order → Sample → Results → Report
import React, { useState, useEffect, useRef } from "react";
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
import { TabView, TabPanel } from "primereact/tabview";
import { MultiSelect } from "primereact/multiselect";
import { InputTextarea } from "primereact/inputtextarea";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

// ── Status configs ─────────────────────────────────────────────
const ORDER_STATUS = {
  PENDING: { label: "Pending", severity: "warning", icon: "pi-clock" },
  SAMPLE_COLLECTED: {
    label: "Sample Collected",
    severity: "info",
    icon: "pi-send",
  },
  IN_PROGRESS: {
    label: "In Progress",
    severity: "info",
    icon: "pi-spin pi-spinner",
  },
  COMPLETED: {
    label: "Completed",
    severity: "success",
    icon: "pi-check-circle",
  },
  CANCELLED: {
    label: "Cancelled",
    severity: "danger",
    icon: "pi-times-circle",
  },
};

const RESULT_STATUS = {
  PENDING: { label: "Pending", color: "#f59e0b" },
  IN_PROGRESS: { label: "Processing", color: "#3b82f6" },
  COMPLETED: { label: "Completed", color: "#8b5cf6" },
  VERIFIED: { label: "Verified", color: "#10b981" },
};

const PRIORITY_COLOR = {
  ROUTINE: "#6c757d",
  URGENT: "#f59e0b",
  STAT: "#dc2626",
};

// ═══════════════════════════════════════════════════════════════
export default function InvestigationOrders() {
  const toast = useRef(null);
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({});

  // Filters
  const [filters, setFilters] = useState({
    UHID: "",
    orderStatus: null,
    priority: null,
    fromDate: "",
    toDate: "",
  });

  // New Order dialog
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [investigations, setInvestigations] = useState([]);
  const [tpaList, setTpaList] = useState([]);
  const [newOrderForm, setNewOrderForm] = useState({
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
    selectedInvIds: [],
    priority: "ROUTINE",
    notes: "",
  });

  // Order detail / actions dialog
  const [showDetail, setShowDetail] = useState(false);
  const [selOrder, setSelOrder] = useState(null);

  // Result entry dialog
  const [showResults, setShowResults] = useState(false);
  const [resultForms, setResultForms] = useState([]);

  // ── Load ──────────────────────────────────────────────────────
  const loadOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.UHID) params.append("UHID", filters.UHID);
      if (filters.orderStatus)
        params.append("orderStatus", filters.orderStatus);
      if (filters.priority) params.append("priority", filters.priority);
      if (filters.fromDate) params.append("fromDate", filters.fromDate);
      if (filters.toDate) params.append("toDate", filters.toDate);
      params.append("limit", "100");

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

  const showToast = (s, sum, det) =>
    toast.current?.show({ severity: s, summary: sum, detail: det, life: 3000 });

  // ── Create Order ──────────────────────────────────────────────
  const handleCreateOrder = async () => {
    if (!newOrderForm.UHID) return showToast("warn", "Required", "UHID daalo");
    if (!newOrderForm.selectedInvIds.length)
      return showToast("warn", "Required", "Kam se kam ek test select karo");

    setLoading(true);
    try {
      const payload = {
        ...newOrderForm,
        patientId: newOrderForm.UHID, // backend will resolve
        investigationIds: newOrderForm.selectedInvIds,
      };
      const res = await fetch(`${API}/investigation-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showToast(
        "success",
        "Order Created",
        `Order #${data.data.orderNumber} create ho gaya`,
      );
      setShowNewOrder(false);
      resetNewOrderForm();
      loadOrders();
      loadSummary();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const resetNewOrderForm = () =>
    setNewOrderForm({
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
      selectedInvIds: [],
      priority: "ROUTINE",
      notes: "",
    });

  // ── Open detail ───────────────────────────────────────────────
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
      showToast("success", "Sample Collected", "Sample collect ho gaya");
      openDetail({ _id: orderId });
      loadOrders();
      loadSummary();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Open Result Entry ─────────────────────────────────────────
  const openResultEntry = (order) => {
    const forms = (order.items || [])
      .filter((i) => i.resultStatus !== "VERIFIED")
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
      showToast("success", "Results Saved", "Results enter ho gaye");
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

  // ── Verify ────────────────────────────────────────────────────
  const handleVerify = async (orderId) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/investigation-orders/${orderId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifiedBy: "Dr. Senior" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showToast("success", "Verified", "Results verify ho gaye");
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
          reason: "Patient request",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showToast("warn", "Cancelled", "Order cancel ho gaya");
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
  const addResultRow = (formIdx) => {
    const updated = [...resultForms];
    updated[formIdx].results.push({
      parameterName: "",
      value: "",
      unit: "",
      normalRange: "",
      isAbnormal: false,
    });
    setResultForms(updated);
  };

  const updateResult = (formIdx, rowIdx, field, value) => {
    const updated = [...resultForms];
    updated[formIdx].results[rowIdx][field] = value;
    setResultForms(updated);
  };

  const updateInterpretation = (formIdx, value) => {
    const updated = [...resultForms];
    updated[formIdx].interpretation = value;
    setResultForms(updated);
  };

  // ── Summary cards ─────────────────────────────────────────────
  const SummaryCard = ({ label, value, color, icon }) => (
    <div
      style={{
        background: "#fff",
        border: `2px solid ${color}20`,
        borderRadius: 10,
        padding: "14px 20px",
        flex: 1,
        minWidth: 120,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "#6c757d",
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color }}>{value ?? "—"}</div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════
  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "8px 12px" }}>
      <Toast ref={toast} position="top-right" />

      {/* ── Summary Strip ── */}
      <div
        style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}
      >
        <SummaryCard
          label="Aaj ke Orders"
          value={summary.todayOrders}
          color="#0891b2"
          icon="pi-plus"
        />
        <SummaryCard
          label="Pending"
          value={summary.pending}
          color="#f59e0b"
          icon="pi-clock"
        />
        <SummaryCard
          label="In Progress"
          value={summary.inProgress}
          color="#3b82f6"
          icon="pi-spinner"
        />
        <SummaryCard
          label="Completed Today"
          value={summary.completed}
          color="#10b981"
          icon="pi-check"
        />
        <SummaryCard
          label="Urgent"
          value={summary.urgent}
          color="#dc2626"
          icon="pi-exclamation-triangle"
        />
      </div>

      {/* ── Filter Bar ── */}
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
            placeholder="UHID search..."
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
            style={{ width: 140 }}
          />

          <InputText
            type="date"
            value={filters.fromDate}
            onChange={(e) =>
              setFilters({ ...filters, fromDate: e.target.value })
            }
            style={{ width: 145 }}
          />
          <InputText
            type="date"
            value={filters.toDate}
            onChange={(e) => setFilters({ ...filters, toDate: e.target.value })}
            style={{ width: 145 }}
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

      {/* ── Orders Table ── */}
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
          emptyMessage="Koi order nahi mila"
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
            style={{ minWidth: 150 }}
          />
          <Column
            header="Tests"
            body={(r) => (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {(r.items || []).slice(0, 3).map((i) => (
                  <span
                    key={i._id}
                    style={{
                      background: "#e0f2fe",
                      color: "#0369a1",
                      borderRadius: 4,
                      padding: "1px 6px",
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  >
                    {i.investigationCode}
                  </span>
                ))}
                {r.items?.length > 3 && (
                  <span style={{ fontSize: 10, color: "#6c757d" }}>
                    +{r.items.length - 3} more
                  </span>
                )}
              </div>
            )}
            style={{ minWidth: 180 }}
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
            header="Doctor"
            body={(r) =>
              r.doctorId ? (
                <span style={{ fontSize: 12 }}>
                  Dr. {r.doctorId.personalInfo?.firstName}{" "}
                  {r.doctorId.personalInfo?.lastName}
                </span>
              ) : (
                <span style={{ color: "#6c757d", fontSize: 12 }}>Walk-in</span>
              )
            }
            style={{ width: 140 }}
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
                    tooltip="Collect Sample"
                    severity="info"
                    onClick={() => handleCollectSample(r._id)}
                  />
                )}
              </div>
            )}
            style={{ width: 100 }}
          />
        </DataTable>
      </Card>

      {/* ═══════════════════════════════════════
          NEW ORDER DIALOG
      ═══════════════════════════════════════ */}
      <Dialog
        visible={showNewOrder}
        style={{ width: "min(800px, 96vw)" }}
        header="🧪 New Investigation Order"
        onHide={() => {
          setShowNewOrder(false);
          resetNewOrderForm();
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
          {/* Patient */}
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
              value={newOrderForm.UHID}
              onChange={(e) =>
                setNewOrderForm({
                  ...newOrderForm,
                  UHID: e.target.value.toUpperCase(),
                })
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
              value={newOrderForm.patientName}
              onChange={(e) =>
                setNewOrderForm({
                  ...newOrderForm,
                  patientName: e.target.value,
                })
              }
              placeholder="Auto-fetch hoga UHID se"
              style={{ width: "100%" }}
            />
          </div>

          {/* Visit Type + Priority */}
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
              value={newOrderForm.visitType}
              options={["OPD", "IPD", "DAYCARE", "EMERGENCY", "WALKIN"].map(
                (v) => ({ label: v, value: v }),
              )}
              onChange={(e) =>
                setNewOrderForm({ ...newOrderForm, visitType: e.value })
              }
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
              value={newOrderForm.priority}
              options={[
                { label: "Routine", value: "ROUTINE" },
                { label: "⚠️ Urgent", value: "URGENT" },
                { label: "🚨 STAT", value: "STAT" },
              ]}
              onChange={(e) =>
                setNewOrderForm({ ...newOrderForm, priority: e.value })
              }
              style={{ width: "100%" }}
            />
          </div>

          {/* Doctor */}
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
              value={newOrderForm.doctorName}
              onChange={(e) =>
                setNewOrderForm({ ...newOrderForm, doctorName: e.target.value })
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
              Ordered By
            </label>
            <Dropdown
              value={newOrderForm.orderedBy}
              options={["DOCTOR", "COUNTER", "WALKIN"].map((v) => ({
                label: v,
                value: v,
              }))}
              onChange={(e) =>
                setNewOrderForm({ ...newOrderForm, orderedBy: e.value })
              }
              style={{ width: "100%" }}
            />
          </div>

          {/* Payment */}
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
              value={newOrderForm.paymentType}
              options={["CASH", "TPA", "CORPORATE"].map((v) => ({
                label: v,
                value: v,
              }))}
              onChange={(e) =>
                setNewOrderForm({
                  ...newOrderForm,
                  paymentType: e.value,
                  tpaId: null,
                  tpaName: null,
                })
              }
              style={{ width: "100%" }}
            />
          </div>
          {newOrderForm.paymentType === "TPA" && (
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
                value={newOrderForm.tpaId}
                options={tpaList}
                onChange={(e) => {
                  const tpa = tpaList.find((t) => t.value === e.value);
                  setNewOrderForm({
                    ...newOrderForm,
                    tpaId: e.value,
                    tpaName: tpa?.name || null,
                  });
                }}
                placeholder="Select TPA"
                filter
                style={{ width: "100%" }}
              />
            </div>
          )}

          {/* Clinical note */}
          <div style={{ gridColumn: "span 2" }}>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Clinical Note / Reason
            </label>
            <InputText
              value={newOrderForm.doctorNote}
              onChange={(e) =>
                setNewOrderForm({ ...newOrderForm, doctorNote: e.target.value })
              }
              placeholder="e.g. Fever since 3 days, r/o Dengue"
              style={{ width: "100%" }}
            />
          </div>

          {/* Investigations */}
          <div style={{ gridColumn: "span 2" }}>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Investigations * &nbsp;
              <span style={{ fontWeight: 400, color: "#6c757d" }}>
                ({newOrderForm.selectedInvIds.length} selected)
              </span>
            </label>
            <MultiSelect
              value={newOrderForm.selectedInvIds}
              options={investigations}
              onChange={(e) =>
                setNewOrderForm({ ...newOrderForm, selectedInvIds: e.value })
              }
              placeholder="Tests select karo..."
              filter
              optionGroupLabel="category"
              display="chip"
              style={{ width: "100%" }}
              itemTemplate={(opt) => (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    width: "100%",
                  }}
                >
                  <span>{opt.label}</span>
                  <span style={{ color: "#0d6efd", fontWeight: 600 }}>
                    ₹{opt.price}
                  </span>
                </div>
              )}
            />
          </div>

          {/* Price preview */}
          {newOrderForm.selectedInvIds.length > 0 && (
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
              {newOrderForm.selectedInvIds.map((id) => {
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
                    <span>{inv.label.split(" — ")[1]}</span>
                    <span style={{ fontWeight: 600 }}>
                      ₹{inv.price?.toLocaleString("en-IN")}
                    </span>
                  </div>
                ) : null;
              })}
              <div
                style={{
                  borderTop: "1px solid #bee3f8",
                  marginTop: 8,
                  paddingTop: 6,
                  fontWeight: 700,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>Total (CASH)</span>
                <span style={{ color: "#0d6efd" }}>
                  ₹
                  {newOrderForm.selectedInvIds
                    .reduce(
                      (sum, id) =>
                        sum +
                        (investigations.find((i) => i.value === id)?.price ||
                          0),
                      0,
                    )
                    .toLocaleString("en-IN")}
                </span>
              </div>
            </div>
          )}
        </div>
      </Dialog>

      {/* ═══════════════════════════════════════
          ORDER DETAIL DIALOG
      ═══════════════════════════════════════ */}
      <Dialog
        visible={showDetail && !!selOrder}
        style={{ width: "min(900px, 96vw)" }}
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
                ⚡ {selOrder?.priority}
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
            {/* Patient info strip */}
            <div
              style={{
                background: "#f8fafc",
                borderRadius: 8,
                padding: "10px 16px",
                marginBottom: 16,
                display: "flex",
                gap: 30,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: "#6c757d" }}>Patient</div>
                <div style={{ fontWeight: 700 }}>
                  {selOrder.patientId?.fullName || selOrder.patientName}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#6c757d" }}>UHID</div>
                <div style={{ fontWeight: 700, fontFamily: "monospace" }}>
                  {selOrder.UHID}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#6c757d" }}>Doctor</div>
                <div style={{ fontWeight: 600 }}>
                  {selOrder.doctorName ||
                    selOrder.doctorId?.personalInfo?.firstName ||
                    "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#6c757d" }}>Payment</div>
                <div>
                  <Tag
                    value={selOrder.paymentType}
                    severity="secondary"
                    style={{ fontSize: 10 }}
                  />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#6c757d" }}>Total</div>
                <div style={{ fontWeight: 700, color: "#0d6efd" }}>
                  ₹{selOrder.totalAmount?.toLocaleString("en-IN")}
                </div>
              </div>
              {selOrder.doctorNote && (
                <div style={{ gridColumn: "span 5" }}>
                  <div style={{ fontSize: 11, color: "#6c757d" }}>
                    Clinical Note
                  </div>
                  <div style={{ fontStyle: "italic" }}>
                    {selOrder.doctorNote}
                  </div>
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
              ) && (
                <Button
                  label="Enter Results"
                  icon="pi pi-pencil"
                  severity="warning"
                  size="small"
                  onClick={() => openResultEntry(selOrder)}
                />
              )}
              {selOrder.orderStatus === "IN_PROGRESS" &&
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
                    showToast(
                      "success",
                      "Printed",
                      "Report print mark ho gaya",
                    );
                  }}
                />
              )}
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
                header="Sample"
                body={(r) =>
                  r.sampleType ? (
                    <Tag
                      value={r.sampleType}
                      severity="secondary"
                      style={{ fontSize: 10 }}
                    />
                  ) : (
                    "—"
                  )
                }
                style={{ width: 80 }}
              />
              <Column
                header="Sample Status"
                body={(r) => (
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
                )}
                style={{ width: 130 }}
              />
              <Column
                header="Result Status"
                body={(r) => {
                  const s =
                    RESULT_STATUS[r.resultStatus] || RESULT_STATUS.PENDING;
                  return (
                    <span
                      style={{ fontSize: 11, fontWeight: 700, color: s.color }}
                    >
                      {s.label}
                    </span>
                  );
                }}
                style={{ width: 110 }}
              />
              <Column
                header="Price"
                body={(r) => `₹${r.chargedPrice?.toLocaleString("en-IN")}`}
                style={{ width: 80 }}
              />
              <Column
                header="Results"
                body={(r) =>
                  r.results?.length ? (
                    <div style={{ fontSize: 11 }}>
                      {r.results.slice(0, 2).map((res, i) => (
                        <div
                          key={i}
                          style={{
                            color: res.isAbnormal ? "#dc2626" : "#374151",
                          }}
                        >
                          {res.parameterName}: <b>{res.value}</b> {res.unit}
                          {res.isAbnormal && " ⚠️"}
                        </div>
                      ))}
                      {r.results.length > 2 && (
                        <div style={{ color: "#6c757d" }}>
                          +{r.results.length - 2} more
                        </div>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: "#6c757d", fontSize: 11 }}>—</span>
                  )
                }
              />
            </DataTable>
          </div>
        )}
      </Dialog>

      {/* ═══════════════════════════════════════
          RESULT ENTRY DIALOG
      ═══════════════════════════════════════ */}
      <Dialog
        visible={showResults}
        style={{ width: "min(860px, 96vw)" }}
        header="📋 Result Entry"
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
          {resultForms.map((form, formIdx) => (
            <div
              key={form.itemId}
              style={{
                marginBottom: 24,
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: "#f1f5f9",
                  padding: "10px 14px",
                  fontWeight: 700,
                  fontSize: 13,
                  color: "#0891b2",
                }}
              >
                {form.investigationName}
              </div>
              <div style={{ padding: 14 }}>
                {/* Result rows */}
                {form.results.map((row, rowIdx) => (
                  <div
                    key={rowIdx}
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
                        updateResult(
                          formIdx,
                          rowIdx,
                          "parameterName",
                          e.target.value,
                        )
                      }
                      placeholder="Parameter (e.g. Haemoglobin)"
                      style={{ width: "100%" }}
                    />
                    <InputText
                      value={row.value}
                      onChange={(e) =>
                        updateResult(formIdx, rowIdx, "value", e.target.value)
                      }
                      placeholder="Value"
                      style={{ width: "100%" }}
                    />
                    <InputText
                      value={row.unit}
                      onChange={(e) =>
                        updateResult(formIdx, rowIdx, "unit", e.target.value)
                      }
                      placeholder="Unit (g/dL)"
                      style={{ width: "100%" }}
                    />
                    <InputText
                      value={row.normalRange}
                      onChange={(e) =>
                        updateResult(
                          formIdx,
                          rowIdx,
                          "normalRange",
                          e.target.value,
                        )
                      }
                      placeholder="Normal range (13-17)"
                      style={{ width: "100%" }}
                    />
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <input
                        type="checkbox"
                        checked={row.isAbnormal}
                        onChange={(e) =>
                          updateResult(
                            formIdx,
                            rowIdx,
                            "isAbnormal",
                            e.target.checked,
                          )
                        }
                        style={{ cursor: "pointer" }}
                      />
                      <label style={{ fontSize: 11, color: "#dc2626" }}>
                        Abnormal
                      </label>
                    </div>
                  </div>
                ))}
                <Button
                  label="+ Row"
                  text
                  size="small"
                  onClick={() => addResultRow(formIdx)}
                  style={{ marginBottom: 8 }}
                />

                {/* Interpretation */}
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
                    onChange={(e) =>
                      updateInterpretation(formIdx, e.target.value)
                    }
                    rows={2}
                    placeholder="Overall interpretation..."
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
