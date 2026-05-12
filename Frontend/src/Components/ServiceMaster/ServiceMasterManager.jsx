// frontend/components/ServiceMaster/ServiceMasterManager.jsx
// Admin panel to manage all hospital services and their pricing
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
import { InputSwitch } from "primereact/inputswitch";
import { TabView, TabPanel } from "primereact/tabview";
import { useBilling } from "../../hooks/useBilling";
import { API_ENDPOINTS } from "../../config/api";

// ── Select options ─────────────────────────────────────────────
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

// CASH auto-set hoti hai service create pe (defaultPrice se) — yahan sirf TPA/CORPORATE
const TARIFF_TYPES = ["TPA", "CORPORATE"].map((v) => ({ label: v, value: v }));

const CAT_SEVERITY = {
  ROOM: "warning",
  DOCTOR: "success",
  NURSING: "info",
  PROCEDURE: "danger",
  OT: "danger",
  ICU: "danger",
  REGISTRATION: "info",
  CONSULTATION: "success",
};

// ── Blank form ─────────────────────────────────────────────────
const BLANK_SVC = {
  serviceCode: "",
  serviceName: "",
  domain: "OPD",
  category: "REGISTRATION",
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
  price: 0,
  discount: 0,
  tpaApprovedLimit: null,
};

// ═══════════════════════════════════════════════════════════════
export default function ServiceMasterManager() {
  const toast = useRef(null);
  const billing = useBilling();

  const [services, setServices] = useState([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    category: null,
    domain: null,
    search: "",
  });

  // Service form dialog
  const [showSvcDlg, setShowSvcDlg] = useState(false);
  const [editSvc, setEditSvc] = useState(null);
  const [svcForm, setSvcForm] = useState(BLANK_SVC);

  // Pricing dialog
  const [showPriceDlg, setShowPriceDlg] = useState(false);
  const [selService, setSelService] = useState(null);
  const [pricing, setPricing] = useState([]);
  const [priceForm, setPriceForm] = useState(BLANK_PRICE);
  const [tpaList, setTpaList] = useState([]);

  // ── Load services ────────────────────────────────────────────
  const load = async () => {
    try {
      const params = {
        limit: 200,
        ...(filters.category && { category: filters.category }),
        ...(filters.domain && { domain: filters.domain }),
        ...(filters.search && { search: filters.search }),
      };
      const result = await billing.getAllServices(params);
      setServices(result.data || []);
      setTotal(result.total || 0);
    } catch {}
  };

  const loadTPA = async () => {
    try {
      const { data } = await import("axios").then((m) =>
        m.default.get(API_ENDPOINTS.TPA),
      );
      setTpaList(
        (data.data || []).map((t) => ({ label: t.tpaName, value: t._id })),
      );
    } catch {}
  };

  useEffect(() => {
    load();
  }, [filters]);
  useEffect(() => {
    loadTPA();
  }, []);

  // ── Seed default data ────────────────────────────────────────
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

  // ── Open add dialog ──────────────────────────────────────────
  const openAdd = () => {
    setEditSvc(null);
    setSvcForm(BLANK_SVC);
    setShowSvcDlg(true);
  };

  // ── Open edit dialog ─────────────────────────────────────────
  const openEdit = (svc) => {
    setEditSvc(svc);
    setSvcForm({
      serviceCode: svc.serviceCode,
      serviceName: svc.serviceName,
      domain: svc.domain,
      category: svc.category,
      billingType: svc.billingType,
      defaultPrice: svc.defaultPrice,
      isAutoCharged: svc.isAutoCharged,
      isTaxable: svc.isTaxable,
      taxPercentage: svc.taxPercentage || 0,
      applicableTo: svc.applicableTo,
      unitLabel: svc.unitLabel || "",
      description: svc.description || "",
    });
    setShowSvcDlg(true);
  };

  // ── Save service ─────────────────────────────────────────────
  const handleSaveService = async () => {
    try {
      if (editSvc) {
        await billing.updateService(editSvc._id, svcForm);
        toast.current?.show({
          severity: "success",
          summary: "Updated",
          detail: "Service updated",
          life: 2000,
        });
      } else {
        await billing.createService(svcForm);
        toast.current?.show({
          severity: "success",
          summary: "Created",
          detail: "Service created",
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

  // ── Deactivate service ───────────────────────────────────────
  const handleDeactivate = async (id) => {
    try {
      await billing.deleteService(id);
      toast.current?.show({
        severity: "warn",
        summary: "Deactivated",
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
  };

  // ── Open pricing dialog ───────────────────────────────────────
  const openPricing = async (svc) => {
    setSelService(svc);
    try {
      const data = await billing.getServicePricing(svc._id);
      setPricing(data);
    } catch {}
    setPriceForm(BLANK_PRICE);
    setShowPriceDlg(true);
  };

  // ── Save pricing ─────────────────────────────────────────────
  const handleSavePricing = async () => {
    try {
      await billing.setServicePricing(selService._id, priceForm);
      toast.current?.show({
        severity: "success",
        summary: "Pricing Saved",
        life: 2000,
      });
      const data = await billing.getServicePricing(selService._id);
      setPricing(data);
      setPriceForm(BLANK_PRICE);
    } catch (e) {
      toast.current?.show({
        severity: "error",
        summary: "Error",
        detail: e.message,
        life: 3000,
      });
    }
  };

  // ── Computed: finalPrice preview ─────────────────────────────
  const previewFinal =
    priceForm.price - (priceForm.price * (priceForm.discount || 0)) / 100;

  // ════════════════════════════════════════════════════════════
  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "8px 12px" }}>
      <Toast ref={toast} position="top-right" />

      {/* ── Filters bar ── */}
      <Card style={{ marginBottom: 8 }}>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 15, color: "#0d6efd" }}>
            <i className="pi pi-list" style={{ marginRight: 6 }} />
            Service Master
          </span>
          <InputText
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Name / code search..."
            style={{ width: 220 }}
          />
          <Dropdown
            value={filters.domain}
            options={[{ label: "All Domains", value: null }, ...DOMAINS]}
            onChange={(e) => setFilters({ ...filters, domain: e.value })}
            style={{ width: 150 }}
          />
          <Dropdown
            value={filters.category}
            options={[{ label: "All Categories", value: null }, ...CATEGORIES]}
            onChange={(e) => setFilters({ ...filters, category: e.value })}
            style={{ width: 180 }}
          />
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button
              label="Seed Default Data"
              icon="pi pi-database"
              severity="secondary"
              outlined
              tooltip="Run once — loads 80+ default services"
              onClick={handleSeed}
              loading={billing.loading}
            />
            <Button
              label="Add Service"
              icon="pi pi-plus"
              severity="success"
              onClick={openAdd}
            />
          </div>
        </div>
      </Card>

      {/* ── Main table ── */}
      <Card>
        <DataTable
          value={services}
          loading={billing.loading}
          size="small"
          stripedRows
          header={
            <span style={{ fontSize: 13, color: "#6c757d" }}>
              {total} services total
            </span>
          }
          emptyMessage={
            <div style={{ textAlign: "center", padding: 40 }}>
              No services found. <b>"Seed Default Data"</b> button dabao to load
              all default services.
            </div>
          }
        >
          <Column
            field="serviceCode"
            header="Code"
            style={{ fontFamily: "monospace", fontSize: 12, width: 130 }}
          />
          <Column
            field="serviceName"
            header="Service Name"
            style={{ minWidth: 200 }}
          />
          <Column
            header="Domain"
            body={(r) => (
              <Tag
                value={r.domain}
                severity="secondary"
                style={{ fontSize: 10 }}
              />
            )}
            style={{ width: 90 }}
          />
          <Column
            header="Category"
            body={(r) => (
              <Tag
                value={r.category}
                severity={CAT_SEVERITY[r.category] || "secondary"}
                style={{ fontSize: 10 }}
              />
            )}
            style={{ width: 120 }}
          />
          <Column
            header="Billing Type"
            body={(r) => (
              <span style={{ fontSize: 11, color: "#6c757d" }}>
                {r.billingType.replace(/_/g, " ")}
              </span>
            )}
            style={{ width: 120 }}
          />
          <Column
            header="Default ₹"
            body={(r) => <b>₹{r.defaultPrice.toLocaleString("en-IN")}</b>}
            style={{ width: 100 }}
          />
          <Column
            header="Auto?"
            body={(r) =>
              r.isAutoCharged ? (
                <Tag value="AUTO" severity="warning" style={{ fontSize: 9 }} />
              ) : (
                "—"
              )
            }
            style={{ width: 60 }}
          />
          <Column
            header="Status"
            body={(r) => (
              <Tag
                value={r.isActive ? "Active" : "Inactive"}
                severity={r.isActive ? "success" : "danger"}
                style={{ fontSize: 10 }}
              />
            )}
            style={{ width: 75 }}
          />
          <Column
            header="Actions"
            body={(r) => (
              <div style={{ display: "flex", gap: 4 }}>
                <Button
                  icon="pi pi-pencil"
                  text
                  size="small"
                  tooltip="Edit"
                  onClick={() => openEdit(r)}
                />
                <Button
                  icon="pi pi-tag"
                  text
                  size="small"
                  tooltip="Pricing"
                  severity="info"
                  onClick={() => openPricing(r)}
                />
                {r.isActive && (
                  <Button
                    icon="pi pi-trash"
                    text
                    size="small"
                    tooltip="Deactivate"
                    severity="danger"
                    onClick={() => handleDeactivate(r._id)}
                  />
                )}
              </div>
            )}
            style={{ width: 110 }}
          />
        </DataTable>
      </Card>

      {/* ════════════════════════════════════════
          DIALOG: Add / Edit Service
      ════════════════════════════════════════ */}
      <Dialog
        visible={showSvcDlg}
        style={{ width: "min(720px, 92vw)" }}
        header={editSvc ? "Service Edit Karo" : "Naya Service Add Karo"}
        onHide={() => {
          setShowSvcDlg(false);
          setEditSvc(null);
        }}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              label="Cancel"
              severity="secondary"
              outlined
              onClick={() => setShowSvcDlg(false)}
            />
            <Button
              label={editSvc ? "Update" : "Create"}
              icon="pi pi-check"
              severity="success"
              onClick={handleSaveService}
              loading={billing.loading}
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
              Service Code *
            </label>
            <InputText
              value={svcForm.serviceCode}
              onChange={(e) =>
                setSvcForm({
                  ...svcForm,
                  serviceCode: e.target.value.toUpperCase(),
                })
              }
              placeholder="IPD-RM-001"
              style={{ width: "100%", fontFamily: "monospace" }}
              disabled={!!editSvc}
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
              Service Name *
            </label>
            <InputText
              value={svcForm.serviceName}
              onChange={(e) =>
                setSvcForm({ ...svcForm, serviceName: e.target.value })
              }
              placeholder="General Ward Bed"
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
              Domain *
            </label>
            <Dropdown
              value={svcForm.domain}
              options={DOMAINS}
              onChange={(e) => setSvcForm({ ...svcForm, domain: e.value })}
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
              Category *
            </label>
            <Dropdown
              value={svcForm.category}
              options={CATEGORIES}
              onChange={(e) => setSvcForm({ ...svcForm, category: e.value })}
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
              Billing Type *
            </label>
            <Dropdown
              value={svcForm.billingType}
              options={BILLING_TYPES}
              onChange={(e) => setSvcForm({ ...svcForm, billingType: e.value })}
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
              Default Price (₹) *
            </label>
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
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Unit Label
            </label>
            <InputText
              value={svcForm.unitLabel}
              onChange={(e) =>
                setSvcForm({ ...svcForm, unitLabel: e.target.value })
              }
              placeholder="per day / per visit / per hour"
              style={{ width: "100%" }}
            />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              paddingTop: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <InputSwitch
                checked={svcForm.isAutoCharged}
                onChange={(e) =>
                  setSvcForm({ ...svcForm, isAutoCharged: e.value })
                }
              />
              <label style={{ fontSize: 12, fontWeight: 600 }}>
                Auto-Charge Daily
              </label>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <InputSwitch
                checked={svcForm.isTaxable}
                onChange={(e) => setSvcForm({ ...svcForm, isTaxable: e.value })}
              />
              <label style={{ fontSize: 12, fontWeight: 600 }}>Taxable</label>
            </div>
          </div>
          {svcForm.isTaxable && (
            <div>
              <label
                style={{
                  fontWeight: 600,
                  fontSize: 12,
                  display: "block",
                  marginBottom: 3,
                }}
              >
                Tax %
              </label>
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
          <div style={{ gridColumn: "span 2" }}>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Description
            </label>
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
          DIALOG: Pricing
      ════════════════════════════════════════ */}
      <Dialog
        visible={showPriceDlg}
        style={{ width: "min(720px, 92vw)" }}
        header={`💰 Pricing — ${selService?.serviceName || ""}`}
        onHide={() => setShowPriceDlg(false)}
      >
        <TabView>
          {/* Existing pricing */}
          <TabPanel header="Existing Pricing">
            <DataTable
              value={pricing}
              size="small"
              emptyMessage="No pricing configured. Default price will be used."
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
                  />
                )}
              />
              <Column header="TPA" body={(r) => r.tpaId?.tpaName || "—"} />
              <Column
                header="Price"
                body={(r) => `₹${r.price.toLocaleString("en-IN")}`}
              />
              <Column
                header="Discount"
                body={(r) => (r.discount > 0 ? `${r.discount}%` : "—")}
              />
              <Column
                header="Final Price"
                body={(r) => (
                  <b style={{ color: "#0d6efd" }}>
                    ₹{r.finalPrice.toLocaleString("en-IN")}
                  </b>
                )}
              />
              <Column
                header="TPA Limit"
                body={(r) =>
                  r.tpaApprovedLimit
                    ? `₹${r.tpaApprovedLimit.toLocaleString("en-IN")}`
                    : "—"
                }
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
              />
            </DataTable>
          </TabPanel>

          {/* Add / update pricing */}
          <TabPanel header="Add / Update Pricing">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                maxWidth: 420,
              }}
            >
              {/* CASH auto-set info */}
              <div
                style={{
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 8,
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <i
                  className="pi pi-check-circle"
                  style={{ color: "#16a34a", fontSize: 16 }}
                />
                <span style={{ fontSize: 13, color: "#166534" }}>
                  <b>CASH price auto-set hai</b> — service ka Default Price
                  automatically CASH tariff ban jaata hai. Yahan sirf{" "}
                  <b>TPA / Corporate</b> price set karo.
                </span>
              </div>
              <div>
                <label
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  Tariff Type *
                </label>
                <Dropdown
                  value={priceForm.tariffType}
                  options={TARIFF_TYPES}
                  onChange={(e) =>
                    setPriceForm({
                      ...priceForm,
                      tariffType: e.value,
                      tpaId: null,
                    })
                  }
                  style={{ width: "100%" }}
                />
              </div>

              {priceForm.tariffType === "TPA" && (
                <div>
                  <label
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    TPA Select Karo *
                  </label>
                  <Dropdown
                    value={priceForm.tpaId}
                    options={tpaList}
                    onChange={(e) =>
                      setPriceForm({ ...priceForm, tpaId: e.value })
                    }
                    placeholder="TPA select karo"
                    filter
                    style={{ width: "100%" }}
                  />
                </div>
              )}

              <div>
                <label
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  Price (₹) *
                </label>
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

              <div>
                <label
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  Discount (%)
                </label>
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

              {priceForm.tariffType === "TPA" && (
                <div>
                  <label
                    style={{
                      fontWeight: 600,
                      fontSize: 13,
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    TPA Approved Limit (₹)
                  </label>
                  <InputNumber
                    value={priceForm.tpaApprovedLimit}
                    onValueChange={(e) =>
                      setPriceForm({ ...priceForm, tpaApprovedLimit: e.value })
                    }
                    mode="currency"
                    currency="INR"
                    locale="en-IN"
                    placeholder="Max TPA will pay"
                    style={{ width: "100%" }}
                  />
                  <small style={{ color: "#6c757d" }}>
                    TPA is se zyada nahi dega. Remaining amount patient pays.
                  </small>
                </div>
              )}

              <div
                style={{
                  background: "#e7f3ff",
                  padding: "10px 14px",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                Final Price after discount:{" "}
                <b style={{ color: "#0d6efd", fontSize: 15 }}>
                  ₹
                  {(previewFinal || 0).toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                  })}
                </b>
              </div>

              <Button
                label="Save Pricing"
                icon="pi pi-check"
                severity="success"
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
