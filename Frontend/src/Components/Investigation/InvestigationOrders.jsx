import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";   // R7hr(LAB-TAT): interceptor-authed /reports call
import { tpaService } from "../../Services/tpa/tpaService";
import patientService from "../../Services/patient/patientService";
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
import { ProgressBar } from "primereact/progressbar";

import { API_BASE_URL as API } from "../../config/api";
import { useAuth } from "../../context/AuthContext";

// ── Constants ────────────────────────────────────────────────────────────────
const ORDER_STATUS = {
  PENDING: { label: "Pending", severity: "warning" },
  SAMPLE_COLLECTED: { label: "Sample Collected", severity: "info" },
  IN_PROGRESS: { label: "In Progress", severity: "info" },
  COMPLETED: { label: "Completed", severity: "success" },
  CANCELLED: { label: "Cancelled", severity: "danger" },
};

const RESULT_COLOR = {
  PENDING: "#f59e0b",
  IN_PROGRESS: "#6366f1",
  COMPLETED: "#8b5cf6",
  VERIFIED: "#10b981",
};

const PRIORITY_COLOR = {
  ROUTINE: "#6c757d",
  URGENT: "#f59e0b",
  STAT: "#dc2626",
};

const BLANK_ORDER = {
  UHID: "",
  patientId: "",
  patientName: "",
  contactNumber: "",
  visitType: "OPD",
  orderedBy: "COUNTER",
  doctorName: "",
  doctorNote: "",
  paymentType: "CASH",
  tpaId: null,
  tpaName: null,
  selectedInvestigations: [],
  priority: "ROUTINE",
  notes: "",
};

// ── Print functions ───────────────────────────────────────────────────────────
const printOrderSlip = (order) => {
  const patient = order.patientId || {};
  const doctorName = order.doctorName || "—";
  const rows = (order.items || [])
    .map(
      (item) => `
    <tr>
      <td>${item.investigationCode || "—"}</td>
      <td>${item.investigationName}</td>
      <td><span style="background:${item.performedAt === "EXTERNAL" ? "#fef3c7" : "#d1fae5"};color:${item.performedAt === "EXTERNAL" ? "#92400e" : "#065f46"};padding:2px 8px;border-radius:10px;font-size:11px">${item.performedAt}</span></td>
      <td>${item.sampleType || "—"}</td>
      <td>₹${(item.chargedPrice || 0).toLocaleString("en-IN")}</td>
    </tr>`,
    )
    .join("");

  const win = window.open("", "_blank", "width=800,height=600");
  win.document
    .write(`<!DOCTYPE html><html><head><title>Order Slip — ${order.orderNumber}</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;padding:20px}
  .hdr{text-align:center;border-bottom:2px solid #0891b2;padding-bottom:10px;margin-bottom:14px}
  .hdr h1{font-size:18px;color:#0891b2}.info{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;border:1px solid #ddd;padding:10px;border-radius:6px;margin-bottom:14px}
  .lbl{font-size:10px;color:#666}.val{font-weight:bold}table{width:100%;border-collapse:collapse}
  th{background:#0891b2;color:#fff;padding:7px 10px;text-align:left;font-size:11px}
  td{padding:6px 10px;border-bottom:1px solid #eee;font-size:11px}tr:nth-child(even)td{background:#f9f9f9}
  .tot td{font-weight:bold;background:#e0f7fa!important}.ftr{margin-top:20px;border-top:1px solid #ddd;padding-top:10px;display:flex;justify-content:space-between;font-size:10px;color:#666}
  @media print{body{padding:10px}@page{margin:10mm}}</style></head><body>
  <div class="hdr"><h1>Spherehealth Medical Solutions</h1><p>Investigation Order Slip</p></div>
  <div style="margin-bottom:10px;font-size:14px;font-weight:bold;color:#0891b2">
    Order: ${order.orderNumber || "—"} &nbsp;|&nbsp; Date: ${new Date(order.createdAt).toLocaleDateString("en-IN")}
    &nbsp;|&nbsp; Priority: <span style="color:${PRIORITY_COLOR[order.priority]}">${order.priority}</span>
  </div>
  <div class="info">
    <div><div class="lbl">Patient</div><div class="val">${patient.fullName || order.patientName || "—"}</div></div>
    <div><div class="lbl">UHID</div><div class="val">${order.UHID}</div></div>
    <div><div class="lbl">Doctor</div><div class="val">${doctorName}</div></div>
    <div><div class="lbl">Payment</div><div class="val">${order.paymentType}${order.tpaName ? ` — ${order.tpaName}` : ""}</div></div>
    <div><div class="lbl">Clinical Note</div><div class="val">${order.doctorNote || "—"}</div></div>
    <div><div class="lbl">Visit Type</div><div class="val">${order.visitType}</div></div>
  </div>
  <table><thead><tr><th>Code</th><th>Test Name</th><th>Where</th><th>Sample</th><th>Price</th></tr></thead>
  <tbody>${rows}<tr class="tot"><td colspan="4">Total</td><td>₹${(order.totalAmount || 0).toLocaleString("en-IN")}</td></tr></tbody></table>
  <div class="ftr"><span>Printed: ${new Date().toLocaleString("en-IN")}</span><span>Internal: ${order.internalTestsCount || 0} | External: ${order.externalTestsCount || 0}</span></div>
  <script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
};

const printReport = (order) => {
  const patient = order.patientId || {};
  const sections = (order.items || [])
    .map((item) => {
      const resultRows = (item.results || [])
        .map(
          (r) =>
            `<tr><td>${r.parameterName}</td>
       <td style="font-weight:bold;color:${r.isAbnormal ? "#dc2626" : "#222"}">${r.value}${r.isAbnormal ? " ⚠" : ""}</td>
       <td>${r.unit || "—"}</td><td>${r.normalRange || "—"}</td>
       <td>${r.isAbnormal ? '<span style="color:#dc2626">Abnormal</span>' : '<span style="color:#16a34a">Normal</span>'}</td></tr>`,
        )
        .join("");
      return `<div style="margin-bottom:18px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
      <div style="background:#0891b2;color:#fff;padding:7px 12px;font-weight:bold;font-size:13px;display:flex;gap:12px">
        <span>${item.investigationName}</span><span style="font-size:10px;opacity:.8;font-family:monospace">${item.investigationCode || ""}</span>
        ${item.performedAt === "EXTERNAL" ? `<span style="font-size:10px;background:#fef3c7;color:#92400e;padding:1px 8px;border-radius:10px">External — ${item.externalLabName || "Outside Lab"}</span>` : ""}
      </div>
      ${
        item.results?.length
          ? `<table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#e0f7fa"><th style="padding:6px 10px;text-align:left;font-size:11px">Parameter</th><th style="padding:6px 10px;text-align:left;font-size:11px">Result</th><th style="padding:6px 10px;text-align:left;font-size:11px">Unit</th><th style="padding:6px 10px;text-align:left;font-size:11px">Normal Range</th><th style="padding:6px 10px;text-align:left;font-size:11px">Flag</th></tr></thead>
        <tbody>${resultRows}</tbody></table>`
          : `<p style="padding:10px 12px;color:#888;font-style:italic">No results entered</p>`
      }
      ${item.interpretation ? `<div style="padding:6px 12px;background:#fffbeb;border-top:1px solid #fde68a;font-size:11px"><b>Interpretation:</b> ${item.interpretation}</div>` : ""}
      ${item.verifiedBy ? `<div style="padding:4px 12px;font-size:10px;color:#16a34a;background:#f0fdf4">Verified by: <b>${item.verifiedBy}</b></div>` : ""}
    </div>`;
    })
    .join("");

  const win = window.open("", "_blank", "width=900,height=700");
  win.document
    .write(`<!DOCTYPE html><html><head><title>Report — ${order.orderNumber}</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:12px;padding:20px}
  .hdr{text-align:center;border-bottom:2px solid #0891b2;padding-bottom:10px;margin-bottom:14px}
  .hdr h1{font-size:18px;color:#0891b2}.info{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px 24px;border:1px solid #ddd;padding:10px;border-radius:6px;background:#f8fafc;margin-bottom:14px}
  .lbl{font-size:10px;color:#666}.val{font-weight:bold}.sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:30px;text-align:center}
  .sline{border-top:1px solid #333;margin-bottom:4px}.ftr{margin-top:20px;border-top:1px solid #ddd;padding-top:10px;display:flex;justify-content:space-between;font-size:10px;color:#666}
  @media print{body{padding:10px}@page{margin:10mm}}</style></head><body>
  <div class="hdr"><h1>Spherehealth Medical Solutions</h1><p>Laboratory Investigation Report</p></div>
  <div style="text-align:center;font-size:15px;font-weight:bold;margin-bottom:14px">INVESTIGATION REPORT</div>
  <div class="info">
    <div><div class="lbl">Patient</div><div class="val">${patient.fullName || order.patientName || "—"}</div></div>
    <div><div class="lbl">UHID</div><div class="val">${order.UHID}</div></div>
    <div><div class="lbl">Order No.</div><div class="val">${order.orderNumber}</div></div>
    <div><div class="lbl">Doctor</div><div class="val">${order.doctorName || "—"}</div></div>
    <div><div class="lbl">Date</div><div class="val">${new Date(order.createdAt).toLocaleDateString("en-IN")}</div></div>
    <div><div class="lbl">Payment</div><div class="val">${order.paymentType}${order.tpaName ? ` — ${order.tpaName}` : ""}</div></div>
    ${order.doctorNote ? `<div style="grid-column:span 3"><div class="lbl">Clinical Note</div><div class="val">${order.doctorNote}</div></div>` : ""}
  </div>
  ${sections}
  <div class="sign"><div><div class="sline"></div><div style="font-size:11px">Lab Technician</div></div><div><div class="sline"></div><div style="font-size:11px">Pathologist / Radiologist</div></div></div>
  <div class="ftr"><span>Printed: ${new Date().toLocaleString("en-IN")}</span><span>${order.orderNumber} | ${order.UHID}</span></div>
  <script>window.onload=()=>window.print()</script></body></html>`);
  win.document.close();
};

// ════════════════════════════════════════════════════════════════════════════════
export default function InvestigationOrders() {
  const toast = useRef(null);
  // R7bb-E/D5-HIGH-5 — Cancel Order is gated by lab.cancel (Admin/Doctor).
  // Lab Tech can print/dispatch but mustn't void a clinician's order
  // (cancel also reverses billing). Sample rejection is a different flow.
  const { can } = useAuth();
  const canCancel = typeof can === "function" ? can("lab.cancel") : false;

  // List state
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({});
  // R7hr(LAB-TAT tile): collection→verify TAT over the last 30 days from
  // /reports/lab-tat (gate lab.read — same roles as this page). The page's
  // own fetch() calls carry no auth header, so this uses axios (global
  // Bearer interceptor). 403/failure → null → tiles simply don't render.
  const [labTat, setLabTat] = useState(null);
  useEffect(() => {
    axios.get(`${API}/reports/lab-tat`)
      .then((r) => {
        const d = r.data?.data || r.data || {};
        setLabTat(d.overall?.count > 0 ? d.overall : null);
      })
      .catch(() => setLabTat(null));
  }, []);
  // R7hr-314 — seed the status filter from ?status= so the Lab dashboard
  // tiles deep-link: Result Entry → ?status=SAMPLE_COLLECTED, Dispatch
  // Reports → ?status=COMPLETED (else the worklist opens unfiltered).
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    UHID: "",
    orderStatus: searchParams.get("status") || null,
    priority: null,
    fromDate: "",
    toDate: "",
  });

  // Master data
  const [investigations, setInvestigations] = useState([]);
  const [tpaList, setTpaList] = useState([]);

  // New order dialog
  const [showNew, setShowNew] = useState(false);
  const [newOrder, setNewOrder] = useState(BLANK_ORDER);
  const [patientSuggestions, setPatientSuggestions] = useState([]);
  const [uhidLoading, setUhidLoading] = useState(false);

  // Detail dialog
  const [showDetail, setShowDetail] = useState(false);
  const [selOrder, setSelOrder] = useState(null);

  // Results dialog
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

  // ── Load ────────────────────────────────────────────────────────────────────
  const loadOrders = useCallback(async () => {
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
  }, [filters]);

  const loadSummary = async () => {
    try {
      const res = await fetch(`${API}/investigation-orders/summary`);
      const data = await res.json();
      setSummary(data.data || {});
    } catch {}
  };

  const loadInvestigations = async () => {
    try {
      const res = await fetch(`${API}/investigations?limit=300&isActive=true`);
      const data = await res.json();
      setInvestigations(
        (data.data || []).map((i) => ({
          label: `${i.investigationCode} — ${i.investigationName}`,
          value: i._id,
          code: i.investigationCode,
          name: i.investigationName,
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
      const res = await tpaService.getAllTPAs();
      const list = res.data || res || [];
      setTpaList(
        list.map((t) => ({ label: t.tpaName, value: t._id, name: t.tpaName })),
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

  // ── UHID search ─────────────────────────────────────────────────────────────
  const handleUHIDChange = async (val) => {
    setNewOrder({
      ...newOrder,
      UHID: val.toUpperCase(),
      patientId: "",
      patientName: "",
      contactNumber: "",
    });
    if (val.length < 3) {
      setPatientSuggestions([]);
      return;
    }
    setUhidLoading(true);
    try {
      const res = await patientService.searchPatients(val, 5);
      setPatientSuggestions(res.data || []);
    } catch {
    } finally {
      setUhidLoading(false);
    }
  };

  const selectPatient = (p) => {
    setNewOrder({
      ...newOrder,
      UHID: p.UHID,
      patientId: p._id,
      patientName: p.fullName || p.name,
      contactNumber: p.contactNumber || "",
      paymentType: p.tpa ? "TPA" : "CASH",
      tpaId: p.tpa?._id || p.tpa || null,
      tpaName: p.tpaName || null,
    });
    setPatientSuggestions([]);
  };

  // ── Create Order ─────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!newOrder.UHID)
      return showToast("warn", "Required", "Enter patient UHID");
    if (!newOrder.patientId)
      return showToast("warn", "Required", "Select patient from suggestions");
    if (!newOrder.selectedInvestigations.length)
      return showToast("warn", "Required", "Select at least one test");

    setLoading(true);
    try {
      const items = newOrder.selectedInvestigations.map((id) => {
        const inv = investigations.find((i) => i.value === id);
        return {
          investigationId: id,
          performedAt:
            inv?.performedAt === "EXTERNAL" ? "EXTERNAL" : "INTERNAL",
        };
      });

      const payload = {
        patientId: newOrder.patientId,
        UHID: newOrder.UHID,
        patientName: newOrder.patientName,
        contactNumber: newOrder.contactNumber,
        visitType: newOrder.visitType,
        orderedBy: newOrder.orderedBy,
        doctorName: newOrder.doctorName || null,
        doctorNote: newOrder.doctorNote || null,
        paymentType: newOrder.paymentType,
        tpaId: newOrder.tpaId,
        tpaName: newOrder.tpaName,
        items,
        priority: newOrder.priority,
        notes: newOrder.notes || null,
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
        `Order #${data.data?.orderNumber} created`,
      );
      setShowNew(false);
      setNewOrder(BLANK_ORDER);
      loadOrders();
      loadSummary();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Open Detail ──────────────────────────────────────────────────────────────
  const openDetail = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/investigation-orders/${id}`);
      const data = await res.json();
      setSelOrder(data.data);
      setShowDetail(true);
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Collect Sample ────────────────────────────────────────────────────────────
  const handleCollect = async (orderId) => {
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
      await openDetail(orderId);
      loadOrders();
      loadSummary();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Verify ────────────────────────────────────────────────────────────────────
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
      showToast("success", "Verified", "Results verified");
      await openDetail(orderId);
      loadOrders();
      loadSummary();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Cancel ────────────────────────────────────────────────────────────────────
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

  // ── Results ───────────────────────────────────────────────────────────────────
  const openResultEntry = (order) => {
    const forms = (order.items || [])
      .filter(
        (i) => i.performedAt === "INTERNAL" && i.resultStatus !== "VERIFIED",
      )
      .map((item) => ({
        itemId: item._id,
        name: item.investigationName,
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
            itemResults: resultForms.map((f) => ({
              itemId: f.itemId,
              results: f.results,
              interpretation: f.interpretation,
            })),
            enteredBy: "Lab Technician",
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showToast("success", "Saved", "Results saved");
      setShowResults(false);
      await openDetail(selOrder._id);
      loadOrders();
      loadSummary();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── External Result ───────────────────────────────────────────────────────────
  const openExternal = (order, item) => {
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
      return showToast("warn", "Required", "Enter lab name");
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
      showToast("success", "Saved", "External report saved");
      setShowExternal(false);
      await openDetail(selOrder._id);
      loadOrders();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Result form helpers ───────────────────────────────────────────────────────
  const addRow = (fi) => {
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
  const updateRow = (fi, ri, k, v) => {
    const u = [...resultForms];
    u[fi].results[ri][k] = v;
    setResultForms(u);
  };
  const updateInterp = (fi, v) => {
    const u = [...resultForms];
    u[fi].interpretation = v;
    setResultForms(u);
  };

  // ── Summary Cards ─────────────────────────────────────────────────────────────
  const SCard = ({ label, val, color }) => (
    <div
      style={{
        background: "var(--color-background-secondary)",
        border: `2px solid ${color}30`,
        borderRadius: 10,
        padding: "12px 18px",
        flex: 1,
        minWidth: 110,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--color-text-secondary)",
          fontWeight: 600,
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 800, color }}>{val ?? "—"}</div>
    </div>
  );

  const selectedTotal = newOrder.selectedInvestigations.reduce((s, id) => {
    const inv = investigations.find((i) => i.value === id);
    return s + (inv?.price || 0);
  }, 0);

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "8px 12px" }}>
      <Toast ref={toast} position="top-right" />

      {/* Summary Cards */}
      <div
        style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}
      >
        <SCard
          label="Today's Orders"
          val={summary.todayOrders}
          color="#0891b2"
        />
        <SCard label="Pending" val={summary.pending} color="#f59e0b" />
        <SCard label="In Progress" val={summary.inProgress} color="#6366f1" />
        <SCard
          label="Completed Today"
          val={summary.completed}
          color="#10b981"
        />
        <SCard label="Urgent" val={summary.urgent} color="#dc2626" />
        {labTat && (
          <>
            <SCard label="TAT Avg · 30d" val={`${labTat.avgMins}m`} color="#7c3aed" />
            <SCard label="TAT Max · 30d" val={`${labTat.maxMins}m`} color="#64748b" />
          </>
        )}
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
            <i className="pi pi-list" style={{ marginRight: 6 }} />{" "}
            Investigation Orders
          </span>
          <InputText
            value={filters.UHID}
            onChange={(e) =>
              setFilters({ ...filters, UHID: e.target.value.toUpperCase() })
            }
            placeholder="Search UHID..."
            style={{ width: 150 }}
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
              onClick={() => setShowNew(true)}
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
            <span
              style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
            >
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
                <div
                  style={{ fontSize: 11, color: "var(--color-text-secondary)" }}
                >
                  {r.UHID}
                </div>
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
                    {i.performedAt === "EXTERNAL" ? " (Ext)" : ""}
                  </span>
                ))}
                {r.items?.length > 3 && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    +{r.items.length - 3}
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
                  tooltip="View"
                  onClick={() => openDetail(r._id)}
                />
                <Button
                  icon="pi pi-print"
                  text
                  size="small"
                  tooltip="Order Slip"
                  severity="secondary"
                  onClick={() => printOrderSlip(r)}
                />
                {r.orderStatus === "PENDING" && (
                  <Button
                    icon="pi pi-send"
                    text
                    size="small"
                    severity="info"
                    tooltip="Collect Sample"
                    onClick={() => handleCollect(r._id)}
                  />
                )}
              </div>
            )}
            style={{ width: 110 }}
          />
        </DataTable>
      </Card>

      {/* ═══ NEW ORDER DIALOG ═══ */}
      <Dialog
        visible={showNew}
        style={{ width: "min(860px, 96vw)" }}
        header="New Investigation Order"
        onHide={() => {
          setShowNew(false);
          setNewOrder(BLANK_ORDER);
          setPatientSuggestions([]);
        }}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              label="Cancel"
              severity="secondary"
              outlined
              onClick={() => setShowNew(false)}
            />
            <Button
              label="Create Order"
              icon="pi pi-check"
              severity="success"
              onClick={handleCreate}
              loading={loading}
            />
          </div>
        }
      >
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
        >
          {/* UHID with search */}
          <div style={{ position: "relative" }}>
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
            <span className="p-input-icon-right" style={{ width: "100%" }}>
              {uhidLoading && <i className="pi pi-spin pi-spinner" />}
              <InputText
                value={newOrder.UHID}
                onChange={(e) => handleUHIDChange(e.target.value)}
                placeholder="Type UHID or name..."
                style={{ width: "100%" }}
              />
            </span>
            {patientSuggestions.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  background: "var(--color-background-primary)",
                  border: "1px solid var(--color-border-secondary)",
                  borderRadius: 8,
                  zIndex: 999,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                }}
              >
                {patientSuggestions.map((p) => (
                  <div
                    key={p._id}
                    onClick={() => selectPatient(p)}
                    style={{
                      padding: "8px 12px",
                      cursor: "pointer",
                      borderBottom: "1px solid var(--color-border-tertiary)",
                      fontSize: 13,
                    }}
                    onMouseEnter={(e) =>
                      (e.target.style.background =
                        "var(--color-background-secondary)")
                    }
                    onMouseLeave={(e) =>
                      (e.target.style.background = "transparent")
                    }
                  >
                    <b>{p.UHID}</b> — {p.fullName || p.name} —{" "}
                    {p.contactNumber || ""}
                  </div>
                ))}
              </div>
            )}
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
              readOnly
              style={{
                width: "100%",
                background: "var(--color-background-secondary)",
              }}
              placeholder="Auto-filled"
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
              placeholder="e.g. Fever 3 days, rule out dengue"
              style={{ width: "100%" }}
            />
          </div>

          {/* Test selection */}
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
              <span
                style={{
                  fontWeight: 400,
                  color: "var(--color-text-secondary)",
                }}
              >
                ({newOrder.selectedInvestigations.length} selected)
              </span>
            </label>
            <MultiSelect
              value={newOrder.selectedInvestigations}
              options={investigations}
              onChange={(e) =>
                setNewOrder({ ...newOrder, selectedInvestigations: e.value })
              }
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
                  <span style={{ fontSize: 13 }}>{opt.label}</span>
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
                    <b style={{ color: "#0d6efd", fontSize: 12 }}>
                      ₹{opt.price}
                    </b>
                  </div>
                </div>
              )}
            />
          </div>

          {/* Selected tests preview */}
          {newOrder.selectedInvestigations.length > 0 && (
            <div
              style={{
                gridColumn: "span 2",
                background: "var(--color-background-info)",
                borderRadius: 8,
                padding: "10px 14px",
              }}
            >
              {newOrder.selectedInvestigations.map((id) => {
                const inv = investigations.find((i) => i.value === id);
                return inv ? (
                  <div
                    key={id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <span
                        style={{
                          fontFamily: "monospace",
                          fontSize: 11,
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        {inv.code}
                      </span>
                      {inv.name}
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
                    <b style={{ color: "#0d6efd" }}>
                      ₹{inv.price?.toLocaleString("en-IN")}
                    </b>
                  </div>
                ) : null;
              })}
              <div
                style={{
                  borderTop: "1px solid var(--color-border-secondary)",
                  marginTop: 8,
                  paddingTop: 6,
                  display: "flex",
                  justifyContent: "space-between",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                <span>Estimated Total (CASH)</span>
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
        style={{ width: "min(960px, 96vw)" }}
        header={
          selOrder ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span>Order — {selOrder.orderNumber}</span>
              <Tag
                value={ORDER_STATUS[selOrder.orderStatus]?.label}
                severity={ORDER_STATUS[selOrder.orderStatus]?.severity}
              />
              {selOrder.priority !== "ROUTINE" && (
                <span
                  style={{
                    color: PRIORITY_COLOR[selOrder.priority],
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {selOrder.priority}
                </span>
              )}
            </div>
          ) : (
            "Order Detail"
          )
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
                background: "var(--color-background-secondary)",
                borderRadius: 8,
                padding: "10px 16px",
                marginBottom: 14,
                display: "flex",
                gap: 24,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div
                  style={{ fontSize: 11, color: "var(--color-text-secondary)" }}
                >
                  Patient
                </div>
                <b>{selOrder.patientId?.fullName || selOrder.patientName}</b>
              </div>
              <div>
                <div
                  style={{ fontSize: 11, color: "var(--color-text-secondary)" }}
                >
                  UHID
                </div>
                <b style={{ fontFamily: "monospace" }}>{selOrder.UHID}</b>
              </div>
              <div>
                <div
                  style={{ fontSize: 11, color: "var(--color-text-secondary)" }}
                >
                  Doctor
                </div>
                <b>{selOrder.doctorName || "—"}</b>
              </div>
              <div>
                <div
                  style={{ fontSize: 11, color: "var(--color-text-secondary)" }}
                >
                  Payment
                </div>
                <Tag
                  value={selOrder.paymentType}
                  severity="secondary"
                  style={{ fontSize: 10 }}
                />
              </div>
              <div>
                <div
                  style={{ fontSize: 11, color: "var(--color-text-secondary)" }}
                >
                  Total
                </div>
                <b style={{ color: "#0d6efd" }}>
                  ₹{selOrder.totalAmount?.toLocaleString("en-IN")}
                </b>
              </div>
              <div>
                <div
                  style={{ fontSize: 11, color: "var(--color-text-secondary)" }}
                >
                  Internal / External
                </div>
                <b>
                  {selOrder.internalTestsCount} / {selOrder.externalTestsCount}
                </b>
              </div>
              {selOrder.doctorNote && (
                <div style={{ width: "100%" }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    Note
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
                  onClick={() => handleCollect(selOrder._id)}
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
                    label="Enter Results"
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
              <Button
                label="Print Order Slip"
                icon="pi pi-file-export"
                severity="secondary"
                outlined
                size="small"
                onClick={() => printOrderSlip(selOrder)}
              />
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
              {/* R7bb-E/D5-HIGH-5 — Cancel gated by lab.cancel. */}
              {canCancel && !["COMPLETED", "CANCELLED"].includes(selOrder.orderStatus) && (
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

            {/* Items table */}
            <DataTable value={selOrder.items} size="small" stripedRows>
              <Column
                field="investigationCode"
                header="Code"
                style={{ fontFamily: "monospace", fontSize: 11, width: 100 }}
              />
              <Column
                field="investigationName"
                header="Test Name"
                style={{ minWidth: 160 }}
              />
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
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        N/A
                      </span>
                    );
                  const colors = {
                    PENDING: "#f59e0b",
                    COLLECTED: "#10b981",
                    RECEIVED_AT_LAB: "#6366f1",
                    REJECTED: "#dc2626",
                  };
                  return (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: colors[r.sampleStatus] || "#6c757d",
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
                      color: RESULT_COLOR[r.resultStatus],
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
                        <span style={{ color: "var(--color-text-secondary)" }}>
                          Not set
                        </span>
                      )
                    : "—"
                }
                style={{ width: 130 }}
              />
              <Column
                header="Actions"
                style={{ width: 110 }}
                body={(r) =>
                  r.performedAt === "EXTERNAL" &&
                  r.resultStatus !== "VERIFIED" ? (
                    <Button
                      label="Add Report"
                      icon="pi pi-file"
                      text
                      size="small"
                      severity="warning"
                      onClick={() => openExternal(selOrder, r)}
                    />
                  ) : null
                }
              />
            </DataTable>

            {/* Action log */}
            {selOrder.actionLog?.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 12,
                    color: "var(--color-text-secondary)",
                    marginBottom: 6,
                  }}
                >
                  Action Log
                </div>
                {selOrder.actionLog
                  .slice()
                  .reverse()
                  .map((log, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: 12,
                        fontSize: 11,
                        marginBottom: 4,
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      <span style={{ fontFamily: "monospace", minWidth: 140 }}>
                        {new Date(log.performedAt).toLocaleString("en-IN")}
                      </span>
                      <span
                        style={{
                          fontWeight: 600,
                          color: "var(--color-text-primary)",
                        }}
                      >
                        {log.action}
                      </span>
                      <span>{log.performedBy}</span>
                      {log.remarks && (
                        <span style={{ color: "var(--color-text-tertiary)" }}>
                          — {log.remarks}
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* ═══ RESULTS ENTRY DIALOG ═══ */}
      <Dialog
        visible={showResults}
        style={{ width: "min(900px, 96vw)" }}
        header="Enter Results — Internal Tests"
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
          {resultForms.length === 0 && (
            <p
              style={{
                color: "var(--color-text-secondary)",
                fontStyle: "italic",
              }}
            >
              No pending internal tests to enter results for.
            </p>
          )}
          {resultForms.map((form, fi) => (
            <div
              key={form.itemId}
              style={{
                marginBottom: 20,
                border: "1px solid var(--color-border-secondary)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: "#0891b2",
                  color: "#fff",
                  padding: "8px 14px",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {form.name}
              </div>
              <div style={{ padding: 14 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 1fr 2fr auto",
                    gap: 6,
                    marginBottom: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--color-text-secondary)",
                  }}
                >
                  <span>Parameter</span>
                  <span>Value</span>
                  <span>Unit</span>
                  <span>Normal Range</span>
                  <span>Flag</span>
                </div>
                {form.results.map((row, ri) => (
                  <div
                    key={ri}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 1fr 1fr 2fr auto",
                      gap: 6,
                      marginBottom: 8,
                      alignItems: "center",
                    }}
                  >
                    <InputText
                      value={row.parameterName}
                      onChange={(e) =>
                        updateRow(fi, ri, "parameterName", e.target.value)
                      }
                      placeholder="Parameter"
                      style={{ width: "100%" }}
                    />
                    <InputText
                      value={row.value}
                      onChange={(e) =>
                        updateRow(fi, ri, "value", e.target.value)
                      }
                      placeholder="Value"
                      style={{
                        width: "100%",
                        color: row.isAbnormal ? "#dc2626" : undefined,
                        fontWeight: row.isAbnormal ? 700 : undefined,
                      }}
                    />
                    <InputText
                      value={row.unit}
                      onChange={(e) =>
                        updateRow(fi, ri, "unit", e.target.value)
                      }
                      placeholder="Unit"
                      style={{ width: "100%" }}
                    />
                    <InputText
                      value={row.normalRange}
                      onChange={(e) =>
                        updateRow(fi, ri, "normalRange", e.target.value)
                      }
                      placeholder="Normal"
                      style={{ width: "100%" }}
                    />
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <input
                        type="checkbox"
                        checked={row.isAbnormal}
                        onChange={(e) =>
                          updateRow(fi, ri, "isAbnormal", e.target.checked)
                        }
                      />
                      <label style={{ fontSize: 11, color: "#dc2626" }}>
                        H/L
                      </label>
                    </div>
                  </div>
                ))}
                <Button
                  label="+ Add Row"
                  text
                  size="small"
                  onClick={() => addRow(fi)}
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
                    Interpretation
                  </label>
                  <InputTextarea
                    value={form.interpretation}
                    onChange={(e) => updateInterp(fi, e.target.value)}
                    rows={2}
                    style={{ width: "100%" }}
                    placeholder="Overall findings..."
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
        style={{ width: "min(500px, 96vw)" }}
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
            below.
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
              Key Findings / Interpretation
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
