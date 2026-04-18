// frontend/pages/services/ChargeableServices.jsx
// Manages dynamic chargeable services organized by domain (OPD, IPD, Emergency, DayCare, Common)
import React, { useState, useEffect, useRef } from "react";

// PrimeReact Imports
import { Card } from "primereact/card";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { InputSwitch } from "primereact/inputswitch";
import { Dropdown } from "primereact/dropdown";
import { MultiSelect } from "primereact/multiselect";
import { Dialog } from "primereact/dialog";
import { Toast } from "primereact/toast";
import { Tag } from "primereact/tag";
import { TabView, TabPanel } from "primereact/tabview";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Tooltip } from "primereact/tooltip";

import { useBilling } from "../../hooks/useBilling";

// ── Constants ────────────────────────────────────────────────────

const DOMAIN_TABS = [
  { label: "All", domain: null, color: "#4F46E5" },
  { label: "OPD", domain: "OPD", color: "#10B981" },
  { label: "IPD", domain: "IPD", color: "#3B82F6" },
  { label: "Emergency", domain: "EMERGENCY", color: "#EF4444" },
  { label: "Day Care", domain: "DAYCARE", color: "#F59E0B" },
  { label: "Common", domain: "COMMON", color: "#6B7280" },
];

const CATEGORIES = [
  "REGISTRATION",
  "ROOM",
  "DOCTOR",
  "NURSING",
  "PROCEDURE",
  "OT",
  "ICU",
  "SUPPORT",
  "DISCHARGE",
  "PACKAGE",
  "CONSULTATION",
  "DAYCARE",
  "OTHER",
].map((v) => ({ label: v, value: v }));

const DOMAINS = ["IPD", "OPD", "EMERGENCY", "DAYCARE", "COMMON"].map((v) => ({
  label: v,
  value: v,
}));

const BILLING_TYPES = [
  "ONE_TIME",
  "PER_DAY",
  "PER_HOUR",
  "PER_VISIT",
  "PER_SESSION",
  "PER_PROCEDURE",
  "PER_UNIT",
].map((v) => ({ label: v.replace(/_/g, " "), value: v }));

const APPLICABLE_TO_OPTIONS = ["OPD", "IPD", "DAYCARE", "EMERGENCY", "ALL"].map(
  (v) => ({ label: v, value: v })
);

// Only TPA and CORPORATE — CASH is auto-created from defaultPrice
const TARIFF_TYPES = ["TPA", "CORPORATE"].map((v) => ({ label: v, value: v }));

const STATUS_OPTIONS = [
  { label: "All", value: null },
  { label: "Active", value: "true" },
  { label: "Inactive", value: "false" },
];

const CAT_SEVERITY = {
  ROOM: "warning",
  DOCTOR: "success",
  NURSING: "info",
  PROCEDURE: "danger",
  OT: "danger",
  ICU: "danger",
  REGISTRATION: "secondary",
  CONSULTATION: "secondary",
  SUPPORT: "secondary",
  DISCHARGE: "secondary",
  PACKAGE: "secondary",
  DAYCARE: "secondary",
  OTHER: "secondary",
};

// ── Blank forms ──────────────────────────────────────────────────

const BLANK_SVC = {
  serviceCode: "",
  serviceName: "",
  domain: "OPD",
  category: "REGISTRATION",
  subCategory: "",
  billingType: "ONE_TIME",
  defaultPrice: 0,
  isAutoCharged: false,
  isTaxable: false,
  taxPercentage: 0,
  applicableTo: ["ALL"],
  unitLabel: "",
  description: "",
};

const BLANK_PRICE = {
  tariffType: "TPA",
  tpaId: null,
  corporateName: "",
  price: 0,
  discount: 0,
  tpaApprovedLimit: null,
};

// ════════════════════════════════════════════════════════════════
export default function ChargeableServices() {
  const toast = useRef(null);
  const billing = useBilling();

  // Tab state
  const [activeTab, setActiveTab] = useState(0);

  // Services data
  const [services, setServices] = useState([]);
  const [total, setTotal] = useState(0);

  // Filters (shared across tabs, reset on tab switch)
  const [filters, setFilters] = useState({
    search: "",
    category: null,
    status: null,
  });

  // Service dialog
  const [showSvcDlg, setShowSvcDlg] = useState(false);
  const [editSvc, setEditSvc] = useState(null);
  const [svcForm, setSvcForm] = useState(BLANK_SVC);

  // Pricing dialog
  const [showPriceDlg, setShowPriceDlg] = useState(false);
  const [selService, setSelService] = useState(null);
  const [pricing, setPricing] = useState([]);
  const [priceForm, setPriceForm] = useState(BLANK_PRICE);
  const [pricingTabIdx, setPricingTabIdx] = useState(0);
  const [tpaList, setTpaList] = useState([]);

  // ── Derived current domain ───────────────────────────────────
  const currentDomain = DOMAIN_TABS[activeTab].domain;
  const currentColor = DOMAIN_TABS[activeTab].color;

  // ── Load services ────────────────────────────────────────────
  const load = async (domainOverride) => {
    try {
      const domain = domainOverride !== undefined ? domainOverride : currentDomain;
      const params = {
        limit: 200,
        ...(domain && { domain }),
        ...(filters.category && { category: filters.category }),
        ...(filters.search && { search: filters.search }),
        ...(filters.status !== null && filters.status !== undefined && {
          isActive: filters.status,
        }),
      };
      const result = await billing.getAllServices(params);
      setServices(result.data || []);
      setTotal(result.total || 0);
    } catch (e) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: "Failed to load services",
        life: 3000,
      });
    }
  };

  // ── Load TPA list for pricing dialog ────────────────────────
  const loadTPA = async () => {
    try {
      const { data } = await import("axios").then((m) =>
        m.default.get(
          `${import.meta.env.VITE_API_URL || "http://localhost:5000"}/api/tpa`
        )
      );
      setTpaList(
        (data.data || []).map((t) => ({ label: t.tpaName, value: t._id }))
      );
    } catch {}
  };

  useEffect(() => {
    load();
  }, [activeTab, filters]);

  useEffect(() => {
    loadTPA();
  }, []);

  // ── Tab switch: reset filters ────────────────────────────────
  const handleTabChange = (e) => {
    setActiveTab(e.index);
    setFilters({ search: "", category: null, status: null });
  };

  // ── Mini stats for current domain ───────────────────────────
  const activeCount = services.filter((s) => s.isActive).length;
  const autoChargedCount = services.filter((s) => s.isAutoCharged).length;
  const categorySet = new Set(services.map((s) => s.category));
  const categoryCount = categorySet.size;

  // ── Seed handler ─────────────────────────────────────────────
  const handleSeed = async () => {
    try {
      const result = await billing.seedServices();
      toast.current?.show({
        severity: "success",
        summary: "Seeded",
        detail: `${result.created} services created, ${result.skipped} already existed`,
        life: 4000,
      });
      load();
    } catch (e) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: e.message,
        life: 3000,
      });
    }
  };

  // ── Open Add dialog ──────────────────────────────────────────
  const openAdd = () => {
    setEditSvc(null);
    setSvcForm({
      ...BLANK_SVC,
      domain: currentDomain || "OPD",
    });
    setShowSvcDlg(true);
  };

  // ── Open Edit dialog ─────────────────────────────────────────
  const openEdit = (svc) => {
    setEditSvc(svc);
    setSvcForm({
      serviceCode: svc.serviceCode,
      serviceName: svc.serviceName,
      domain: svc.domain,
      category: svc.category,
      subCategory: svc.subCategory || "",
      billingType: svc.billingType,
      defaultPrice: svc.defaultPrice,
      isAutoCharged: svc.isAutoCharged,
      isTaxable: svc.isTaxable,
      taxPercentage: svc.taxPercentage || 0,
      applicableTo: svc.applicableTo || ["ALL"],
      unitLabel: svc.unitLabel || "",
      description: svc.description || "",
    });
    setShowSvcDlg(true);
  };

  // ── Save service ─────────────────────────────────────────────
  const handleSaveService = async () => {
    if (!svcForm.serviceCode.trim()) {
      toast.current?.show({
        severity: "warn",
        summary: "Validation",
        detail: "Service Code is required",
        life: 3000,
      });
      return;
    }
    if (!svcForm.serviceName.trim()) {
      toast.current?.show({
        severity: "warn",
        summary: "Validation",
        detail: "Service Name is required",
        life: 3000,
      });
      return;
    }
    try {
      if (editSvc) {
        await billing.updateService(editSvc._id, svcForm);
        toast.current?.show({
          severity: "success",
          summary: "Updated",
          detail: "Service updated successfully",
          life: 2000,
        });
      } else {
        await billing.createService(svcForm);
        toast.current?.show({
          severity: "success",
          summary: "Created",
          detail: "Service created successfully",
          life: 2000,
        });
      }
      setShowSvcDlg(false);
      setEditSvc(null);
      load();
    } catch (e) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: e.message,
        life: 3000,
      });
    }
  };

  // ── Toggle active / deactivate ───────────────────────────────
  const handleToggleActive = (svc) => {
    if (svc.isActive) {
      // Deactivate — ask confirmation
      confirmDialog({
        message: `Deactivate "${svc.serviceName}"? It will no longer be available for billing.`,
        header: "Confirm Deactivation",
        icon: "pi pi-exclamation-triangle",
        acceptClassName: "p-button-danger",
        acceptLabel: "Deactivate",
        rejectLabel: "Cancel",
        accept: async () => {
          try {
            await billing.deleteService(svc._id);
            toast.current?.show({
              severity: "warn",
              summary: "Deactivated",
              detail: `${svc.serviceName} has been deactivated`,
              life: 2500,
            });
            load();
          } catch (e) {
            toast.current?.show({
              severity: "error",
              summary: "Error",
              detail: e.message,
              life: 3000,
            });
          }
        },
      });
    } else {
      // Re-activate
      (async () => {
        try {
          await billing.updateService(svc._id, { isActive: true });
          toast.current?.show({
            severity: "success",
            summary: "Activated",
            detail: `${svc.serviceName} has been activated`,
            life: 2000,
          });
          load();
        } catch (e) {
          toast.current?.show({
            severity: "error",
            summary: "Error",
            detail: e.message,
            life: 3000,
          });
        }
      })();
    }
  };

  // ── Open pricing dialog ───────────────────────────────────────
  const openPricing = async (svc) => {
    setSelService(svc);
    setPricingTabIdx(0);
    setPriceForm(BLANK_PRICE);
    try {
      const data = await billing.getServicePricing(svc._id);
      setPricing(data || []);
    } catch {
      setPricing([]);
    }
    setShowPriceDlg(true);
  };

  // ── Save pricing ─────────────────────────────────────────────
  const handleSavePricing = async () => {
    try {
      await billing.setServicePricing(selService._id, priceForm);
      toast.current?.show({
        severity: "success",
        summary: "Pricing Saved",
        detail: "Pricing record saved successfully",
        life: 2000,
      });
      // Refresh pricing list
      const data = await billing.getServicePricing(selService._id);
      setPricing(data || []);
      setPriceForm(BLANK_PRICE);
      setPricingTabIdx(0);
    } catch (e) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: e.message,
        life: 3000,
      });
    }
  };

  // ── Computed final price preview ─────────────────────────────
  const previewFinal =
    (priceForm.price || 0) -
    ((priceForm.price || 0) * (priceForm.discount || 0)) / 100;

  // ════════════════════════════════════════════════════════════
  // ── Column body templates ────────────────────────────────────

  const codeBodyTemplate = (r) => (
    <span
      style={{
        fontFamily: "monospace",
        fontSize: 12,
        color: "#374151",
        fontWeight: 600,
      }}
    >
      {r.serviceCode}
    </span>
  );

  const categoryBodyTemplate = (r) => (
    <Tag
      value={r.category}
      severity={CAT_SEVERITY[r.category] || "secondary"}
      style={{ fontSize: 10 }}
    />
  );

  const billingTypeBodyTemplate = (r) => (
    <span style={{ fontSize: 11, color: "#6B7280" }}>
      {r.billingType?.replace(/_/g, " ")}
    </span>
  );

  const priceBodyTemplate = (r) => (
    <b style={{ color: "#059669" }}>
      ₹{(r.defaultPrice || 0).toLocaleString("en-IN")}
    </b>
  );

  const autoChargedBodyTemplate = (r) =>
    r.isAutoCharged ? (
      <Tag value="AUTO" severity="warning" style={{ fontSize: 9 }} />
    ) : (
      <span style={{ color: "#9CA3AF" }}>—</span>
    );

  const statusBodyTemplate = (r) => (
    <Tag
      value={r.isActive ? "Active" : "Inactive"}
      severity={r.isActive ? "success" : "danger"}
      style={{ fontSize: 10 }}
    />
  );

  const actionsBodyTemplate = (r) => (
    <div style={{ display: "flex", gap: 4 }}>
      <Button
        icon="pi pi-pencil"
        rounded
        outlined
        size="small"
        style={{ color: "#4F46E5", borderColor: "#4F46E5", width: 30, height: 30 }}
        tooltip="Edit Service"
        tooltipOptions={{ position: "top" }}
        onClick={() => openEdit(r)}
      />
      <Button
        icon="pi pi-tag"
        rounded
        outlined
        size="small"
        style={{ color: "#3B82F6", borderColor: "#3B82F6", width: 30, height: 30 }}
        tooltip="Manage Pricing"
        tooltipOptions={{ position: "top" }}
        onClick={() => openPricing(r)}
      />
      <Button
        icon={r.isActive ? "pi pi-ban" : "pi pi-check"}
        rounded
        outlined
        size="small"
        style={{
          color: r.isActive ? "#EF4444" : "#10B981",
          borderColor: r.isActive ? "#EF4444" : "#10B981",
          width: 30,
          height: 30,
        }}
        tooltip={r.isActive ? "Deactivate" : "Activate"}
        tooltipOptions={{ position: "top" }}
        onClick={() => handleToggleActive(r)}
      />
    </div>
  );

  // ── Filter bar ───────────────────────────────────────────────
  const filterBar = (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        flexWrap: "wrap",
        padding: "0.5rem 0",
      }}
    >
      <span className="p-input-icon-left" style={{ flex: "1 1 220px", minWidth: 180 }}>
        <i className="pi pi-search" />
        <InputText
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          placeholder="Search by name or code..."
          className="p-inputtext-sm"
          style={{ width: "100%" }}
        />
      </span>
      <Dropdown
        value={filters.category}
        options={[{ label: "All Categories", value: null }, ...CATEGORIES]}
        onChange={(e) => setFilters({ ...filters, category: e.value })}
        placeholder="Category"
        className="p-inputtext-sm"
        style={{ minWidth: 180 }}
      />
      <Dropdown
        value={filters.status}
        options={STATUS_OPTIONS}
        onChange={(e) => setFilters({ ...filters, status: e.value })}
        placeholder="Status"
        className="p-inputtext-sm"
        style={{ minWidth: 140 }}
      />
    </div>
  );

  // ── Mini stats bar ───────────────────────────────────────────
  const statsBar = (color) => (
    <div
      style={{
        display: "flex",
        gap: 12,
        marginBottom: 12,
        flexWrap: "wrap",
      }}
    >
      {[
        { label: "Active Services", value: activeCount, icon: "pi-check-circle" },
        { label: "Auto-Charged", value: autoChargedCount, icon: "pi-sync" },
        { label: "Categories", value: categoryCount, icon: "pi-tags" },
        { label: "Total", value: total, icon: "pi-list" },
      ].map((stat) => (
        <div
          key={stat.label}
          style={{
            background: "#F9FAFB",
            border: "1px solid #E5E7EB",
            borderRadius: 8,
            padding: "8px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 140,
          }}
        >
          <i
            className={`pi ${stat.icon}`}
            style={{ color, fontSize: 18 }}
          />
          <div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#1F2937",
                lineHeight: 1.1,
              }}
            >
              {stat.value}
            </div>
            <div style={{ fontSize: 11, color: "#6B7280" }}>{stat.label}</div>
          </div>
        </div>
      ))}
    </div>
  );

  // ── DataTable (shared across tabs) ───────────────────────────
  const serviceTable = (color) => (
    <DataTable
      value={services}
      loading={billing.loading}
      size="small"
      stripedRows
      paginator
      rows={15}
      rowsPerPageOptions={[10, 15, 25, 50]}
      dataKey="_id"
      emptyMessage={
        <div style={{ textAlign: "center", padding: 40 }}>
          <i
            className="pi pi-inbox"
            style={{ fontSize: "2.5rem", color: "#9CA3AF" }}
          />
          <p style={{ color: "#6B7280", marginTop: 12 }}>
            No services found.{" "}
            <b>Use "Seed Default Data"</b> to load 80+ default services.
          </p>
        </div>
      }
      style={{ fontSize: 13 }}
    >
      <Column
        field="serviceCode"
        header="Service Code"
        body={codeBodyTemplate}
        style={{ width: 130 }}
        sortable
      />
      <Column
        field="serviceName"
        header="Service Name"
        style={{ minWidth: 200 }}
        sortable
      />
      <Column
        header="Category"
        body={categoryBodyTemplate}
        style={{ width: 130 }}
        sortable
        field="category"
      />
      <Column
        header="Billing Type"
        body={billingTypeBodyTemplate}
        style={{ width: 120 }}
        field="billingType"
        sortable
      />
      <Column
        header="Default Price"
        body={priceBodyTemplate}
        style={{ width: 120 }}
        field="defaultPrice"
        sortable
      />
      <Column
        header="Auto Charged"
        body={autoChargedBodyTemplate}
        style={{ width: 100, textAlign: "center" }}
      />
      <Column
        header="Status"
        body={statusBodyTemplate}
        style={{ width: 85 }}
        field="isActive"
        sortable
      />
      <Column
        header="Actions"
        body={actionsBodyTemplate}
        style={{ width: 120 }}
      />
    </DataTable>
  );

  // ────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#F9FAFB" }}>
      <Toast ref={toast} position="top-right" />
      <ConfirmDialog />

      {/* ── Page container ── */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          padding: "1rem 1.25rem",
          minHeight: "100vh",
        }}
      >
        {/* ── Page header ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 16,
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                color: "#1F2937",
                fontWeight: 700,
                fontSize: 22,
              }}
            >
              <i
                className="pi pi-th-large"
                style={{ marginRight: 8, color: "#4F46E5" }}
              />
              Chargeable Services
            </h2>
            <p style={{ margin: "2px 0 0", color: "#6B7280", fontSize: 13 }}>
              Manage hospital services, pricing and billing configuration
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button
              label="Seed Default Data"
              icon="pi pi-database"
              severity="secondary"
              outlined
              size="small"
              tooltip="Run once to load 80+ default services"
              tooltipOptions={{ position: "bottom" }}
              onClick={handleSeed}
              loading={billing.loading}
            />
            <Button
              label="Add Service"
              icon="pi pi-plus"
              size="small"
              style={{
                backgroundColor: "#4F46E5",
                borderColor: "#4F46E5",
              }}
              onClick={openAdd}
            />
          </div>
        </div>

        {/* ── Domain Tab View ── */}
        <TabView
          activeIndex={activeTab}
          onTabChange={handleTabChange}
          style={{ marginTop: 0 }}
        >
          {DOMAIN_TABS.map((tab, idx) => (
            <TabPanel
              key={tab.label}
              header={
                <span
                  style={{
                    fontWeight: activeTab === idx ? 700 : 500,
                    color: activeTab === idx ? tab.color : "#6B7280",
                    fontSize: 13,
                  }}
                >
                  {tab.domain ? (
                    <i
                      className={
                        tab.domain === "OPD"
                          ? "pi pi-user"
                          : tab.domain === "IPD"
                          ? "pi pi-home"
                          : tab.domain === "EMERGENCY"
                          ? "pi pi-bolt"
                          : tab.domain === "DAYCARE"
                          ? "pi pi-sun"
                          : "pi pi-globe"
                      }
                      style={{ marginRight: 5, color: tab.color }}
                    />
                  ) : (
                    <i
                      className="pi pi-list"
                      style={{ marginRight: 5, color: tab.color }}
                    />
                  )}
                  {tab.label}
                </span>
              }
            >
              {/* Mini stats bar */}
              {statsBar(tab.color)}

              {/* Filter bar */}
              {filterBar}

              {/* Services table */}
              {serviceTable(tab.color)}
            </TabPanel>
          ))}
        </TabView>
      </div>

      {/* ════════════════════════════════════════
          DIALOG: Add / Edit Service
      ════════════════════════════════════════ */}
      <Dialog
        visible={showSvcDlg}
        style={{ width: "min(720px, 95vw)" }}
        header={
          <span style={{ color: "#1F2937", fontWeight: 700, fontSize: 16 }}>
            <i
              className={editSvc ? "pi pi-pencil" : "pi pi-plus-circle"}
              style={{ marginRight: 8, color: "#4F46E5" }}
            />
            {editSvc ? "Edit Service" : "Add New Service"}
          </span>
        }
        onHide={() => {
          setShowSvcDlg(false);
          setEditSvc(null);
        }}
        modal
        draggable={false}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              label="Cancel"
              severity="secondary"
              outlined
              size="small"
              onClick={() => {
                setShowSvcDlg(false);
                setEditSvc(null);
              }}
            />
            <Button
              label={editSvc ? "Update Service" : "Create Service"}
              icon="pi pi-check"
              size="small"
              style={{ backgroundColor: "#4F46E5", borderColor: "#4F46E5" }}
              onClick={handleSaveService}
              loading={billing.loading}
            />
          </div>
        }
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
          }}
        >
          {/* Service Code */}
          <div>
            <label style={labelStyle}>Service Code *</label>
            <InputText
              value={svcForm.serviceCode}
              onChange={(e) =>
                setSvcForm({
                  ...svcForm,
                  serviceCode: e.target.value.toUpperCase(),
                })
              }
              placeholder="e.g. IPD-RM-001"
              style={{ width: "100%", fontFamily: "monospace" }}
              disabled={!!editSvc}
            />
            {!!editSvc && (
              <small style={{ color: "#9CA3AF", fontSize: 11 }}>
                Service code cannot be changed after creation
              </small>
            )}
          </div>

          {/* Service Name */}
          <div>
            <label style={labelStyle}>Service Name *</label>
            <InputText
              value={svcForm.serviceName}
              onChange={(e) =>
                setSvcForm({ ...svcForm, serviceName: e.target.value })
              }
              placeholder="e.g. General Ward Bed"
              style={{ width: "100%" }}
            />
          </div>

          {/* Domain */}
          <div>
            <label style={labelStyle}>Domain *</label>
            <Dropdown
              value={svcForm.domain}
              options={DOMAINS}
              onChange={(e) => setSvcForm({ ...svcForm, domain: e.value })}
              style={{ width: "100%" }}
            />
          </div>

          {/* Category */}
          <div>
            <label style={labelStyle}>Category *</label>
            <Dropdown
              value={svcForm.category}
              options={CATEGORIES}
              onChange={(e) => setSvcForm({ ...svcForm, category: e.value })}
              style={{ width: "100%" }}
            />
          </div>

          {/* Sub Category */}
          <div>
            <label style={labelStyle}>Sub Category</label>
            <InputText
              value={svcForm.subCategory}
              onChange={(e) =>
                setSvcForm({ ...svcForm, subCategory: e.target.value })
              }
              placeholder="e.g. Deluxe, AC Ward"
              style={{ width: "100%" }}
            />
          </div>

          {/* Billing Type */}
          <div>
            <label style={labelStyle}>Billing Type *</label>
            <Dropdown
              value={svcForm.billingType}
              options={BILLING_TYPES}
              onChange={(e) => setSvcForm({ ...svcForm, billingType: e.value })}
              style={{ width: "100%" }}
            />
          </div>

          {/* Default Price */}
          <div>
            <label style={labelStyle}>Default Price ₹ *</label>
            <InputNumber
              value={svcForm.defaultPrice}
              onValueChange={(e) =>
                setSvcForm({ ...svcForm, defaultPrice: e.value })
              }
              mode="currency"
              currency="INR"
              locale="en-IN"
              style={{ width: "100%" }}
            />
          </div>

          {/* Unit Label */}
          <div>
            <label style={labelStyle}>Unit Label</label>
            <InputText
              value={svcForm.unitLabel}
              onChange={(e) =>
                setSvcForm({ ...svcForm, unitLabel: e.target.value })
              }
              placeholder="per day / per visit / per hour"
              style={{ width: "100%" }}
            />
          </div>

          {/* Applicable To */}
          <div style={{ gridColumn: "span 2" }}>
            <label style={labelStyle}>Applicable To</label>
            <MultiSelect
              value={svcForm.applicableTo}
              options={APPLICABLE_TO_OPTIONS}
              onChange={(e) =>
                setSvcForm({ ...svcForm, applicableTo: e.value })
              }
              placeholder="Select patient categories"
              display="chip"
              style={{ width: "100%" }}
            />
          </div>

          {/* Switches row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              paddingTop: 8,
              gridColumn: svcForm.isTaxable ? "1 / 2" : "span 2",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <InputSwitch
                checked={svcForm.isAutoCharged}
                onChange={(e) =>
                  setSvcForm({ ...svcForm, isAutoCharged: e.value })
                }
                tooltip="Auto-added daily for IPD room/nursing charges"
                tooltipOptions={{ position: "top" }}
              />
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                Auto-Charge Daily
              </label>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <InputSwitch
                checked={svcForm.isTaxable}
                onChange={(e) =>
                  setSvcForm({ ...svcForm, isTaxable: e.value })
                }
              />
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                Taxable
              </label>
            </div>
          </div>

          {/* Tax % — only when taxable */}
          {svcForm.isTaxable && (
            <div>
              <label style={labelStyle}>Tax %</label>
              <InputNumber
                value={svcForm.taxPercentage}
                onValueChange={(e) =>
                  setSvcForm({ ...svcForm, taxPercentage: e.value })
                }
                suffix="%"
                min={0}
                max={28}
                style={{ width: "100%" }}
              />
            </div>
          )}

          {/* Description */}
          <div style={{ gridColumn: "span 2" }}>
            <label style={labelStyle}>Description</label>
            <InputText
              value={svcForm.description}
              onChange={(e) =>
                setSvcForm({ ...svcForm, description: e.target.value })
              }
              placeholder="Optional description"
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </Dialog>

      {/* ════════════════════════════════════════
          DIALOG: Service Pricing
      ════════════════════════════════════════ */}
      <Dialog
        visible={showPriceDlg}
        style={{ width: "min(720px, 95vw)" }}
        header={
          <div>
            <span style={{ color: "#1F2937", fontWeight: 700, fontSize: 16 }}>
              <i
                className="pi pi-tag"
                style={{ marginRight: 8, color: "#3B82F6" }}
              />
              Pricing — {selService?.serviceName}
            </span>
            {selService && (
              <div style={{ marginTop: 4 }}>
                <Tag
                  value={selService.serviceCode}
                  severity="secondary"
                  style={{ fontFamily: "monospace", fontSize: 11 }}
                />
                <span
                  style={{
                    marginLeft: 8,
                    color: "#6B7280",
                    fontSize: 12,
                  }}
                >
                  Default: ₹
                  {(selService.defaultPrice || 0).toLocaleString("en-IN")}
                </span>
              </div>
            )}
          </div>
        }
        onHide={() => setShowPriceDlg(false)}
        modal
        draggable={false}
      >
        <TabView
          activeIndex={pricingTabIdx}
          onTabChange={(e) => setPricingTabIdx(e.index)}
        >
          {/* ── Tab 1: Current Pricing ── */}
          <TabPanel header="Current Pricing">
            <div
              style={{
                background: "#F0FDF4",
                border: "1px solid #BBF7D0",
                borderRadius: 8,
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <i
                className="pi pi-info-circle"
                style={{ color: "#16A34A", fontSize: 16 }}
              />
              <span style={{ fontSize: 13, color: "#166534" }}>
                <b>CASH pricing</b> is auto-created from the service's Default
                Price and updated automatically when the default price changes.
              </span>
            </div>

            <DataTable
              value={pricing}
              size="small"
              stripedRows
              emptyMessage="No custom pricing configured. Default price is used for CASH transactions."
            >
              <Column
                header="Tariff"
                body={(r) => (
                  <Tag
                    value={r.tariffType}
                    severity={
                      r.tariffType === "TPA"
                        ? "success"
                        : r.tariffType === "CORPORATE"
                        ? "info"
                        : "secondary"
                    }
                    style={{ fontSize: 10 }}
                  />
                )}
                style={{ width: 100 }}
              />
              <Column
                header="TPA / Corporate"
                body={(r) =>
                  r.tpaId?.tpaName || r.corporateName || <span style={{ color: "#9CA3AF" }}>—</span>
                }
                style={{ minWidth: 140 }}
              />
              <Column
                header="Price"
                body={(r) => `₹${(r.price || 0).toLocaleString("en-IN")}`}
                style={{ width: 110 }}
              />
              <Column
                header="Discount"
                body={(r) =>
                  r.discount > 0 ? (
                    <span style={{ color: "#EF4444" }}>{r.discount}%</span>
                  ) : (
                    <span style={{ color: "#9CA3AF" }}>—</span>
                  )
                }
                style={{ width: 80 }}
              />
              <Column
                header="Final Price"
                body={(r) => (
                  <b style={{ color: "#4F46E5" }}>
                    ₹{(r.finalPrice || 0).toLocaleString("en-IN")}
                  </b>
                )}
                style={{ width: 110 }}
              />
              <Column
                header="TPA Limit"
                body={(r) =>
                  r.tpaApprovedLimit
                    ? `₹${r.tpaApprovedLimit.toLocaleString("en-IN")}`
                    : <span style={{ color: "#9CA3AF" }}>—</span>
                }
                style={{ width: 110 }}
              />
              <Column
                header="Active"
                body={(r) => (
                  <Tag
                    value={r.isActive ? "Yes" : "No"}
                    severity={r.isActive ? "success" : "secondary"}
                    style={{ fontSize: 10 }}
                  />
                )}
                style={{ width: 70 }}
              />
            </DataTable>
          </TabPanel>

          {/* ── Tab 2: Set Pricing ── */}
          <TabPanel header="Set Pricing">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                maxWidth: 440,
              }}
            >
              {/* Info banner */}
              <div
                style={{
                  background: "#EFF6FF",
                  border: "1px solid #BFDBFE",
                  borderRadius: 8,
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <i
                  className="pi pi-check-circle"
                  style={{ color: "#2563EB", fontSize: 16 }}
                />
                <span style={{ fontSize: 13, color: "#1E40AF" }}>
                  <b>CASH price auto-set</b> — only set TPA / Corporate prices
                  here. CASH tariff is managed via the service's Default Price.
                </span>
              </div>

              {/* Tariff Type */}
              <div>
                <label style={labelStyle}>Tariff Type *</label>
                <Dropdown
                  value={priceForm.tariffType}
                  options={TARIFF_TYPES}
                  onChange={(e) =>
                    setPriceForm({
                      ...priceForm,
                      tariffType: e.value,
                      tpaId: null,
                      corporateName: "",
                    })
                  }
                  style={{ width: "100%" }}
                />
              </div>

              {/* TPA selector */}
              {priceForm.tariffType === "TPA" && (
                <div>
                  <label style={labelStyle}>Select TPA *</label>
                  <Dropdown
                    value={priceForm.tpaId}
                    options={tpaList}
                    onChange={(e) =>
                      setPriceForm({ ...priceForm, tpaId: e.value })
                    }
                    placeholder="Select a TPA..."
                    filter
                    style={{ width: "100%" }}
                    emptyMessage="No TPA records found"
                  />
                </div>
              )}

              {/* Corporate Name */}
              {priceForm.tariffType === "CORPORATE" && (
                <div>
                  <label style={labelStyle}>Corporate Name *</label>
                  <InputText
                    value={priceForm.corporateName}
                    onChange={(e) =>
                      setPriceForm({
                        ...priceForm,
                        corporateName: e.target.value,
                      })
                    }
                    placeholder="e.g. Tata Consultancy Services"
                    style={{ width: "100%" }}
                  />
                </div>
              )}

              {/* Price */}
              <div>
                <label style={labelStyle}>Price (₹) *</label>
                <InputNumber
                  value={priceForm.price}
                  onValueChange={(e) =>
                    setPriceForm({ ...priceForm, price: e.value })
                  }
                  mode="currency"
                  currency="INR"
                  locale="en-IN"
                  style={{ width: "100%" }}
                />
              </div>

              {/* Discount */}
              <div>
                <label style={labelStyle}>Discount (%)</label>
                <InputNumber
                  value={priceForm.discount}
                  onValueChange={(e) =>
                    setPriceForm({ ...priceForm, discount: e.value })
                  }
                  suffix="%"
                  min={0}
                  max={100}
                  style={{ width: "100%" }}
                />
              </div>

              {/* TPA Approved Limit */}
              {priceForm.tariffType === "TPA" && (
                <div>
                  <label style={labelStyle}>TPA Approved Limit (₹)</label>
                  <InputNumber
                    value={priceForm.tpaApprovedLimit}
                    onValueChange={(e) =>
                      setPriceForm({
                        ...priceForm,
                        tpaApprovedLimit: e.value,
                      })
                    }
                    mode="currency"
                    currency="INR"
                    locale="en-IN"
                    placeholder="Max amount TPA will pay"
                    style={{ width: "100%" }}
                  />
                  <small style={{ color: "#6B7280", fontSize: 11 }}>
                    TPA will not pay beyond this limit. Remaining is charged to
                    the patient.
                  </small>
                </div>
              )}

              {/* Final price preview */}
              <div
                style={{
                  background: "#F5F3FF",
                  border: "1px solid #DDD6FE",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 13,
                  color: "#4B5563",
                }}
              >
                Final price after discount:{" "}
                <b style={{ color: "#4F46E5", fontSize: 16 }}>
                  ₹
                  {(previewFinal || 0).toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                  })}
                </b>
              </div>

              <Button
                label="Save Pricing"
                icon="pi pi-check"
                style={{ backgroundColor: "#4F46E5", borderColor: "#4F46E5" }}
                onClick={handleSavePricing}
                loading={billing.loading}
              />
            </div>
          </TabPanel>
        </TabView>
      </Dialog>
    </div>
  );
}

// ── Shared label style ───────────────────────────────────────────
const labelStyle = {
  fontWeight: 600,
  fontSize: 12,
  display: "block",
  marginBottom: 4,
  color: "#374151",
};
