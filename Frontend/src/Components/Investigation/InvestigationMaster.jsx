// frontend/components/Investigation/InvestigationMaster.jsx
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
import { investigationService } from "../../Services/Investigation/investigationService";

// ── Constants ─────────────────────────────────────────────────
const CATEGORIES = [
  "PATHOLOGY",
  "RADIOLOGY",
  "CARDIOLOGY",
  "MICROBIOLOGY",
  "BIOCHEMISTRY",
  "ENDOSCOPY",
  "ULTRASONOGRAPHY",
  "OTHER",
].map((v) => ({ label: v, value: v }));

const TARIFF_TYPES = ["TPA", "CORPORATE"].map((v) => ({ label: v, value: v }));

const CAT_COLOR = {
  PATHOLOGY: { bg: "#fef3c7", color: "#92400e", dot: "#f59e0b" },
  RADIOLOGY: { bg: "#dbeafe", color: "#1e3a8a", dot: "#3b82f6" },
  CARDIOLOGY: { bg: "#fce7f3", color: "#9d174d", dot: "#ec4899" },
  MICROBIOLOGY: { bg: "#d1fae5", color: "#065f46", dot: "#10b981" },
  BIOCHEMISTRY: { bg: "#ede9fe", color: "#4c1d95", dot: "#8b5cf6" },
  ENDOSCOPY: { bg: "#fee2e2", color: "#7f1d1d", dot: "#ef4444" },
  ULTRASONOGRAPHY: { bg: "#e0f2fe", color: "#0c4a6e", dot: "#0891b2" },
  OTHER: { bg: "#f1f5f9", color: "#475569", dot: "#94a3b8" },
};

const BLANK_INV = {
  investigationCode: "",
  investigationName: "",
  shortName: "",
  category: "PATHOLOGY",
  subCategory: "",
  sampleType: "",
  defaultPrice: 0,
  tatHours: 24,
  reportTimeHours: 24,
  isTaxable: false,
  taxPercentage: 0,
  availableForTPA: true,
  requiresDoctorOrder: true,
  isPackage: false,
  description: "",
};

const BLANK_PRICE = {
  tariffType: "TPA",
  tpaId: null,
  price: 0,
  discount: 0,
  tpaApprovedLimit: null,
};

const BLANK_OVERRIDE = {
  UHID: "",
  overridePrice: 0,
  reason: "",
  isOneTime: true,
};

// ═══════════════════════════════════════════════════════════════
export default function InvestigationMaster() {
  const toast = useRef(null);

  const [investigations, setInvestigations] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    category: null,
    search: "",
    isPackage: null,
  });

  // Investigation form dialog
  const [showInvDlg, setShowInvDlg] = useState(false);
  const [editInv, setEditInv] = useState(null);
  const [invForm, setInvForm] = useState(BLANK_INV);

  // Pricing dialog
  const [showPriceDlg, setShowPriceDlg] = useState(false);
  const [selInv, setSelInv] = useState(null);
  const [pricing, setPricing] = useState([]);
  const [priceForm, setPriceForm] = useState(BLANK_PRICE);
  const [tpaList, setTpaList] = useState([]);

  // Doctor override dialog
  const [showOverrideDlg, setShowOverrideDlg] = useState(false);
  const [overrideForm, setOverrideForm] = useState(BLANK_OVERRIDE);

  // ── Load investigations ──────────────────────────────────────
  const load = async () => {
    setLoading(true);
    try {
      const params = { limit: 300 };
      if (filters.category) params.category = filters.category;
      if (filters.search) params.search = filters.search;
      if (filters.isPackage !== null) params.isPackage = filters.isPackage;
      const result = await investigationService.getAll(params);
      setInvestigations(result.investigations);
      setTotal(result.total);
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadTPA = async () => {
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api"}/tpa`,
      );
      const data = await res.json();
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

  const showToast = (severity, summary, detail) =>
    toast.current?.show({ severity, summary, detail, life: 3000 });

  // ── Seed ─────────────────────────────────────────────────────
  const handleSeed = async () => {
    setLoading(true);
    try {
      const result = await investigationService.seed();
      showToast(
        "success",
        "Seeded",
        `${result.created} tests added, ${result.skipped} already existed`,
      );
      load();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Add / Edit ────────────────────────────────────────────────
  const openAdd = () => {
    setEditInv(null);
    setInvForm(BLANK_INV);
    setShowInvDlg(true);
  };

  const openEdit = (inv) => {
    setEditInv(inv);
    setInvForm({
      investigationCode: inv.investigationCode,
      investigationName: inv.investigationName,
      shortName: inv.shortName || "",
      category: inv.category,
      subCategory: inv.subCategory || "",
      sampleType: inv.sampleType || "",
      defaultPrice: inv.defaultPrice,
      tatHours: inv.tatHours || 24,
      reportTimeHours: inv.reportTimeHours || 24,
      isTaxable: inv.isTaxable,
      taxPercentage: inv.taxPercentage || 0,
      availableForTPA: inv.availableForTPA,
      requiresDoctorOrder: inv.requiresDoctorOrder,
      isPackage: inv.isPackage,
      description: inv.description || "",
    });
    setShowInvDlg(true);
  };

  const handleSaveInv = async () => {
    if (!invForm.investigationCode || !invForm.investigationName) {
      return showToast("warn", "Required", "Code aur Name required hain");
    }
    setLoading(true);
    try {
      if (editInv) {
        await investigationService.update(editInv._id, invForm);
        showToast("success", "Updated", "Investigation updated");
      } else {
        await investigationService.create(invForm);
        showToast(
          "success",
          "Created",
          "Investigation created — CASH price auto-set",
        );
      }
      setShowInvDlg(false);
      setEditInv(null);
      load();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async (id) => {
    try {
      await investigationService.deactivate(id);
      showToast("warn", "Deactivated", "Investigation deactivated");
      load();
    } catch (e) {
      showToast("error", "Error", e.message);
    }
  };

  // ── Pricing ───────────────────────────────────────────────────
  const openPricing = async (inv) => {
    setSelInv(inv);
    const data = await investigationService.getPricing(inv._id);
    setPricing(data);
    setPriceForm(BLANK_PRICE);
    setShowPriceDlg(true);
  };

  const handleSavePricing = async () => {
    if (!priceForm.price || priceForm.price <= 0) {
      return showToast("warn", "Required", "Valid price daalo");
    }
    if (priceForm.tariffType === "TPA" && !priceForm.tpaId) {
      return showToast("warn", "Required", "TPA select karo");
    }
    setLoading(true);
    try {
      await investigationService.setPricing(selInv._id, priceForm);
      showToast("success", "Saved", "Pricing saved");
      const data = await investigationService.getPricing(selInv._id);
      setPricing(data);
      setPriceForm(BLANK_PRICE);
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Doctor Override ───────────────────────────────────────────
  const openOverride = (inv) => {
    setSelInv(inv);
    setOverrideForm(BLANK_OVERRIDE);
    setShowOverrideDlg(true);
  };

  const handleSaveOverride = async () => {
    if (!overrideForm.UHID) return showToast("warn", "Required", "UHID daalo");
    if (!overrideForm.overridePrice || overrideForm.overridePrice <= 0)
      return showToast("warn", "Required", "Override price daalo");
    setLoading(true);
    try {
      await investigationService.setDoctorOverride(selInv._id, overrideForm);
      showToast(
        "success",
        "Override Set",
        `${overrideForm.UHID} ke liye price override ho gaya`,
      );
      setShowOverrideDlg(false);
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Category badge ────────────────────────────────────────────
  const CatBadge = ({ cat }) => {
    const c = CAT_COLOR[cat] || CAT_COLOR.OTHER;
    return (
      <span
        style={{
          background: c.bg,
          color: c.color,
          borderRadius: 6,
          padding: "2px 8px",
          fontSize: 11,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: c.dot,
            display: "inline-block",
          }}
        />
        {cat}
      </span>
    );
  };

  const previewFinal =
    priceForm.price - (priceForm.price * (priceForm.discount || 0)) / 100;

  // ══════════════════════════════════════════════════════════════
  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "8px 12px" }}>
      <Toast ref={toast} position="top-right" />

      {/* ── Header / Filter bar ── */}
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
            <i className="pi pi-flask" style={{ marginRight: 6 }} />
            Investigation Master
          </span>

          <InputText
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Name / code / short name..."
            style={{ width: 230 }}
          />

          <Dropdown
            value={filters.category}
            options={[{ label: "All Categories", value: null }, ...CATEGORIES]}
            onChange={(e) => setFilters({ ...filters, category: e.value })}
            style={{ width: 180 }}
          />

          <Dropdown
            value={filters.isPackage}
            options={[
              { label: "All Types", value: null },
              { label: "Individual Tests", value: false },
              { label: "Packages Only", value: true },
            ]}
            onChange={(e) => setFilters({ ...filters, isPackage: e.value })}
            style={{ width: 160 }}
          />

          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button
              label="Seed Default Tests"
              icon="pi pi-database"
              severity="secondary"
              outlined
              tooltip="40+ default investigations load karega"
              onClick={handleSeed}
              loading={loading}
            />
            <Button
              label="Add Investigation"
              icon="pi pi-plus"
              severity="success"
              onClick={openAdd}
            />
          </div>
        </div>
      </Card>

      {/* ── Main Table ── */}
      <Card>
        <DataTable
          value={investigations}
          loading={loading}
          size="small"
          stripedRows
          header={
            <span style={{ fontSize: 13, color: "#6c757d" }}>
              {total} investigations total
            </span>
          }
          emptyMessage={
            <div style={{ textAlign: "center", padding: 40 }}>
              No investigations found. <b>"Seed Default Tests"</b> dabao to load
              karo.
            </div>
          }
        >
          <Column
            field="investigationCode"
            header="Code"
            style={{ fontFamily: "monospace", fontSize: 12, width: 120 }}
          />
          <Column
            header="Name"
            body={(r) => (
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {r.investigationName}
                </div>
                {r.shortName && (
                  <div style={{ fontSize: 11, color: "#6c757d" }}>
                    {r.shortName}
                  </div>
                )}
              </div>
            )}
            style={{ minWidth: 200 }}
          />
          <Column
            header="Category"
            body={(r) => <CatBadge cat={r.category} />}
            style={{ width: 140 }}
          />
          <Column
            header="Sub-Cat"
            body={(r) => (
              <span style={{ fontSize: 11, color: "#64748b" }}>
                {r.subCategory || "—"}
              </span>
            )}
            style={{ width: 130 }}
          />
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
            header="Default ₹"
            body={(r) => (
              <b style={{ color: "#0d6efd" }}>
                ₹{r.defaultPrice?.toLocaleString("en-IN")}
              </b>
            )}
            style={{ width: 100 }}
          />
          <Column
            header="TAT"
            body={(r) => <span style={{ fontSize: 11 }}>{r.tatHours}h</span>}
            style={{ width: 55 }}
          />
          <Column
            header="Type"
            body={(r) =>
              r.isPackage ? (
                <Tag
                  value="PACKAGE"
                  severity="warning"
                  style={{ fontSize: 9 }}
                />
              ) : (
                <Tag value="TEST" severity="info" style={{ fontSize: 9 }} />
              )
            }
            style={{ width: 75 }}
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
                  tooltip="TPA Pricing"
                  severity="info"
                  onClick={() => openPricing(r)}
                />
                <Button
                  icon="pi pi-user-edit"
                  text
                  size="small"
                  tooltip="Doctor Override"
                  severity="warning"
                  onClick={() => openOverride(r)}
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
            style={{ width: 140 }}
          />
        </DataTable>
      </Card>

      {/* ════════════════════════════════════════
          DIALOG: Add / Edit Investigation
      ════════════════════════════════════════ */}
      <Dialog
        visible={showInvDlg}
        style={{ width: "min(760px, 95vw)" }}
        header={
          editInv ? "Investigation Edit Karo" : "Naya Investigation Add Karo"
        }
        onHide={() => {
          setShowInvDlg(false);
          setEditInv(null);
        }}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              label="Cancel"
              severity="secondary"
              outlined
              onClick={() => setShowInvDlg(false)}
            />
            <Button
              label={editInv ? "Update" : "Create"}
              icon="pi pi-check"
              severity="success"
              onClick={handleSaveInv}
              loading={loading}
            />
          </div>
        }
      >
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
        >
          {/* Code */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Investigation Code *
            </label>
            <InputText
              value={invForm.investigationCode}
              onChange={(e) =>
                setInvForm({
                  ...invForm,
                  investigationCode: e.target.value.toUpperCase(),
                })
              }
              placeholder="PATH-001"
              style={{ width: "100%", fontFamily: "monospace" }}
              disabled={!!editInv}
            />
          </div>

          {/* Name */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Investigation Name *
            </label>
            <InputText
              value={invForm.investigationName}
              onChange={(e) =>
                setInvForm({ ...invForm, investigationName: e.target.value })
              }
              placeholder="Complete Blood Count"
              style={{ width: "100%" }}
            />
          </div>

          {/* Short Name */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Short Name
            </label>
            <InputText
              value={invForm.shortName}
              onChange={(e) =>
                setInvForm({ ...invForm, shortName: e.target.value })
              }
              placeholder="CBC"
              style={{ width: "100%" }}
            />
          </div>

          {/* Category */}
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
              value={invForm.category}
              options={CATEGORIES}
              onChange={(e) => setInvForm({ ...invForm, category: e.value })}
              style={{ width: "100%" }}
            />
          </div>

          {/* Sub Category */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Sub Category
            </label>
            <InputText
              value={invForm.subCategory}
              onChange={(e) =>
                setInvForm({ ...invForm, subCategory: e.target.value })
              }
              placeholder="Haematology"
              style={{ width: "100%" }}
            />
          </div>

          {/* Sample Type */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Sample Type
            </label>
            <InputText
              value={invForm.sampleType}
              onChange={(e) =>
                setInvForm({ ...invForm, sampleType: e.target.value })
              }
              placeholder="Blood / Urine / Stool"
              style={{ width: "100%" }}
            />
          </div>

          {/* Default Price */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              Default Price (₹) — CASH *
            </label>
            <InputNumber
              value={invForm.defaultPrice}
              onValueChange={(e) =>
                setInvForm({ ...invForm, defaultPrice: e.value })
              }
              mode="currency"
              currency="INR"
              locale="en-IN"
              style={{ width: "100%" }}
            />
            <small style={{ color: "#16a34a", fontSize: 11 }}>
              ✓ CASH pricing automatically set ho jaayegi
            </small>
          </div>

          {/* TAT */}
          <div>
            <label
              style={{
                fontWeight: 600,
                fontSize: 12,
                display: "block",
                marginBottom: 3,
              }}
            >
              TAT (hours)
            </label>
            <InputNumber
              value={invForm.tatHours}
              onValueChange={(e) =>
                setInvForm({ ...invForm, tatHours: e.value })
              }
              min={0}
              suffix=" hrs"
              style={{ width: "100%" }}
            />
          </div>

          {/* Toggles */}
          <div
            style={{
              display: "flex",
              gap: 20,
              alignItems: "center",
              paddingTop: 16,
              gridColumn: "span 2",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <InputSwitch
                checked={invForm.availableForTPA}
                onChange={(e) =>
                  setInvForm({ ...invForm, availableForTPA: e.value })
                }
              />
              <label style={{ fontSize: 12, fontWeight: 600 }}>
                TPA Available
              </label>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <InputSwitch
                checked={invForm.isTaxable}
                onChange={(e) => setInvForm({ ...invForm, isTaxable: e.value })}
              />
              <label style={{ fontSize: 12, fontWeight: 600 }}>Taxable</label>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <InputSwitch
                checked={invForm.requiresDoctorOrder}
                onChange={(e) =>
                  setInvForm({ ...invForm, requiresDoctorOrder: e.value })
                }
              />
              <label style={{ fontSize: 12, fontWeight: 600 }}>
                Doctor Order Required
              </label>
            </div>
          </div>

          {invForm.isTaxable && (
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
                value={invForm.taxPercentage}
                onValueChange={(e) =>
                  setInvForm({ ...invForm, taxPercentage: e.value })
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
              value={invForm.description}
              onChange={(e) =>
                setInvForm({ ...invForm, description: e.target.value })
              }
              placeholder="Optional"
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </Dialog>

      {/* ════════════════════════════════════════
          DIALOG: Pricing (TPA / Corporate)
      ════════════════════════════════════════ */}
      <Dialog
        visible={showPriceDlg}
        style={{ width: "min(740px, 95vw)" }}
        header={`💰 Pricing — ${selInv?.investigationName || ""}`}
        onHide={() => setShowPriceDlg(false)}
      >
        <TabView>
          {/* Existing pricing */}
          <TabPanel header="Existing Pricing">
            {/* CASH auto info */}
            <div
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 14,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <i className="pi pi-check-circle" style={{ color: "#16a34a" }} />
              <span style={{ fontSize: 13, color: "#166534" }}>
                <b>CASH Price:</b> ₹
                {selInv?.defaultPrice?.toLocaleString("en-IN")} — Default price
                se auto-set hai. Isko change karne ke liye investigation edit
                karo.
              </span>
            </div>

            <DataTable
              value={pricing}
              size="small"
              emptyMessage="Koi TPA/Corporate pricing set nahi. Default CASH price use hoga."
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
                body={(r) => `₹${r.price?.toLocaleString("en-IN")}`}
              />
              <Column
                header="Discount"
                body={(r) => (r.discount > 0 ? `${r.discount}%` : "—")}
              />
              <Column
                header="Final Price"
                body={(r) => (
                  <b style={{ color: "#0d6efd" }}>
                    ₹{r.finalPrice?.toLocaleString("en-IN")}
                  </b>
                )}
              />
              <Column
                header="TPA Limit"
                body={(r) =>
                  r.tpaApprovedLimit
                    ? `₹${r.tpaApprovedLimit?.toLocaleString("en-IN")}`
                    : "—"
                }
              />
            </DataTable>
          </TabPanel>

          {/* Add pricing */}
          <TabPanel header="Add / Update Pricing">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                maxWidth: 420,
              }}
            >
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
                <i className="pi pi-info-circle" style={{ color: "#16a34a" }} />
                <span style={{ fontSize: 13, color: "#166534" }}>
                  CASH price auto-set hai (₹
                  {selInv?.defaultPrice?.toLocaleString("en-IN")}). Yahan sirf{" "}
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
                    placeholder="Max TPA payega"
                    style={{ width: "100%" }}
                  />
                  <small style={{ color: "#6c757d" }}>
                    Baaki amount patient dega.
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
                Final Price:{" "}
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
                loading={loading}
              />
            </div>
          </TabPanel>
        </TabView>
      </Dialog>

      {/* ════════════════════════════════════════
          DIALOG: Doctor Override
      ════════════════════════════════════════ */}
      <Dialog
        visible={showOverrideDlg}
        style={{ width: "min(480px, 95vw)" }}
        header={`👨‍⚕️ Doctor Override — ${selInv?.investigationName || ""}`}
        onHide={() => setShowOverrideDlg(false)}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              label="Cancel"
              severity="secondary"
              outlined
              onClick={() => setShowOverrideDlg(false)}
            />
            <Button
              label="Save Override"
              icon="pi pi-check"
              severity="warning"
              onClick={handleSaveOverride}
              loading={loading}
            />
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
            Doctor kisi specific patient ke liye is investigation ka price
            override kar sakta hai. Yeh price <b>TPA / CASH</b> se zyada
            priority rakhta hai.
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
              Patient UHID *
            </label>
            <InputText
              value={overrideForm.UHID}
              onChange={(e) =>
                setOverrideForm({
                  ...overrideForm,
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
                fontSize: 13,
                display: "block",
                marginBottom: 4,
              }}
            >
              Override Price (₹) *
              <span
                style={{
                  fontWeight: 400,
                  color: "#6c757d",
                  marginLeft: 8,
                  fontSize: 11,
                }}
              >
                Default: ₹{selInv?.defaultPrice?.toLocaleString("en-IN")}
              </span>
            </label>
            <InputNumber
              value={overrideForm.overridePrice}
              onValueChange={(e) =>
                setOverrideForm({ ...overrideForm, overridePrice: e.value })
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
              Reason
            </label>
            <InputText
              value={overrideForm.reason}
              onChange={(e) =>
                setOverrideForm({ ...overrideForm, reason: e.target.value })
              }
              placeholder="e.g. Charity case, Staff discount"
              style={{ width: "100%" }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <InputSwitch
              checked={overrideForm.isOneTime}
              onChange={(e) =>
                setOverrideForm({ ...overrideForm, isOneTime: e.value })
              }
            />
            <div>
              <label style={{ fontWeight: 600, fontSize: 13 }}>
                One-Time Override
              </label>
              <div style={{ fontSize: 11, color: "#6c757d" }}>
                {overrideForm.isOneTime
                  ? "Sirf ek baar use hoga, phir normal price lagegi"
                  : "Jab tak manually hatao, tab tak active rahega"}
              </div>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
