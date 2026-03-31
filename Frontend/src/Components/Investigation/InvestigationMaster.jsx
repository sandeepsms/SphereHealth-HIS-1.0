import React, { useState, useEffect, useRef } from "react";
import { tpaService } from "../../Services/tpa/tpaService";
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

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

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

const PERFORMED_AT_OPTIONS = [
  { label: "Internal — hospital's own lab", value: "INTERNAL" },
  { label: "External — outside lab only", value: "EXTERNAL" },
  { label: "Both — either option", value: "BOTH" },
];

const PERFORMED_SEVERITY = {
  INTERNAL: "success",
  EXTERNAL: "warning",
  BOTH: "info",
};

const BLANK = {
  investigationName: "",
  shortName: "",
  category: "PATHOLOGY",
  subCategory: "",
  performedAt: "INTERNAL",
  sampleType: "",
  defaultPrice: 0,
  tatHours: 24,
  isTaxable: false,
  taxPercentage: 0,
  availableForTPA: true,
  requiresDoctorOrder: true,
  description: "",
};

const BLANK_PRICE = {
  tariffType: "TPA",
  tpaId: null,
  price: 0,
  discount: 0,
  tpaApprovedLimit: null,
};

const lbl = {
  fontWeight: 600,
  fontSize: 12,
  display: "block",
  marginBottom: 4,
};

export default function InvestigationMaster() {
  const toast = useRef(null);
  const [investigations, setInvestigations] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    search: "",
    category: null,
    performedAt: null,
  });

  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState(BLANK);

  const [showPricing, setShowPricing] = useState(false);
  const [selItem, setSelItem] = useState(null);
  const [pricing, setPricing] = useState([]);
  const [priceForm, setPriceForm] = useState(BLANK_PRICE);
  const [tpaList, setTpaList] = useState([]);

  const showToast = (s, sum, det) =>
    toast.current?.show({ severity: s, summary: sum, detail: det, life: 3000 });

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 300 });
      if (filters.category) params.append("category", filters.category);
      if (filters.performedAt)
        params.append("performedAt", filters.performedAt);
      if (filters.search) params.append("search", filters.search);
      const res = await fetch(`${API}/investigations?${params}`);
      const data = await res.json();
      setInvestigations(data.data || []);
      setTotal(data.total || 0);
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadTPA = async () => {
    try {
      const res = await tpaService.getAllTPAs();
      const list = res.data || res || [];
      setTpaList(list.map((t) => ({ label: t.tpaName, value: t._id })));
    } catch {}
  };

  useEffect(() => {
    load();
  }, [filters]);
  useEffect(() => {
    loadTPA();
  }, []);

  const handleSeed = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/investigations/seed`, { method: "POST" });
      const data = await res.json();
      const r = data.data || data;
      showToast(
        "success",
        "Seeded",
        `${r.created || 0} added, ${r.skipped || 0} already existed`,
      );
      load();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditItem(null);
    setForm(BLANK);
    setShowForm(true);
  };

  const openEdit = (item) => {
    setEditItem(item);
    setForm({
      investigationName: item.investigationName,
      shortName: item.shortName || "",
      category: item.category,
      subCategory: item.subCategory || "",
      performedAt: item.performedAt || "INTERNAL",
      sampleType: item.sampleType || "",
      defaultPrice: item.defaultPrice,
      tatHours: item.tatHours || 24,
      isTaxable: item.isTaxable,
      taxPercentage: item.taxPercentage || 0,
      availableForTPA: item.availableForTPA,
      requiresDoctorOrder: item.requiresDoctorOrder,
      description: item.description || "",
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.investigationName)
      return showToast("warn", "Required", "Investigation Name is required");
    setLoading(true);
    try {
      const url = editItem
        ? `${API}/investigations/${editItem._id}`
        : `${API}/investigations`;
      const method = editItem ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showToast(
        "success",
        editItem ? "Updated" : "Created",
        editItem
          ? "Investigation updated"
          : "Investigation created — CASH + TPA pricing auto-set",
      );
      setShowForm(false);
      load();
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeactivate = async (id) => {
    try {
      await fetch(`${API}/investigations/${id}`, { method: "DELETE" });
      showToast("warn", "Deactivated", "Investigation deactivated");
      load();
    } catch (e) {
      showToast("error", "Error", e.message);
    }
  };

  const openPricing = async (item) => {
    setSelItem(item);
    const res = await fetch(`${API}/investigations/${item._id}/pricing`);
    const data = await res.json();
    setPricing(data.data || []);
    setPriceForm(BLANK_PRICE);
    setShowPricing(true);
  };

  const handleSavePricing = async () => {
    if (!priceForm.price || priceForm.price <= 0)
      return showToast("warn", "Required", "Enter a valid price");
    if (priceForm.tariffType === "TPA" && !priceForm.tpaId)
      return showToast("warn", "Required", "Select a TPA");
    setLoading(true);
    try {
      const tpa = tpaList.find((t) => t.value === priceForm.tpaId);
      const res = await fetch(`${API}/investigations/${selItem._id}/pricing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...priceForm, tpaName: tpa?.label || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      showToast("success", "Saved", "Pricing updated");
      const r2 = await fetch(`${API}/investigations/${selItem._id}/pricing`);
      const d2 = await r2.json();
      setPricing(d2.data || []);
      setPriceForm(BLANK_PRICE);
    } catch (e) {
      showToast("error", "Error", e.message);
    } finally {
      setLoading(false);
    }
  };

  const previewFinal =
    priceForm.price - (priceForm.price * (priceForm.discount || 0)) / 100;

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "8px 12px" }}>
      <Toast ref={toast} position="top-right" />

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
            <i className="pi pi-flask" style={{ marginRight: 6 }} />
            Investigation Master
          </span>
          <InputText
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Search by name..."
            style={{ width: 220 }}
          />
          <Dropdown
            value={filters.category}
            options={[{ label: "All Categories", value: null }, ...CATEGORIES]}
            onChange={(e) => setFilters({ ...filters, category: e.value })}
            style={{ width: 180 }}
          />
          <Dropdown
            value={filters.performedAt}
            options={[
              { label: "All Types", value: null },
              { label: "Internal only", value: "INTERNAL" },
              { label: "External only", value: "EXTERNAL" },
              { label: "Both", value: "BOTH" },
            ]}
            onChange={(e) => setFilters({ ...filters, performedAt: e.value })}
            style={{ width: 160 }}
          />
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button
              label="Load Default Tests"
              icon="pi pi-database"
              severity="secondary"
              outlined
              onClick={handleSeed}
              loading={loading}
              tooltip="Loads 35+ default investigations with CASH + TPA pricing"
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

      {/* Table */}
      <Card>
        <DataTable
          value={investigations}
          loading={loading}
          size="small"
          stripedRows
          header={
            <span style={{ fontSize: 13, color: "#6c757d" }}>
              {total} investigations
            </span>
          }
          emptyMessage='No investigations. Click "Load Default Tests" to get started.'
        >
          <Column
            field="investigationCode"
            header="Code"
            style={{ fontFamily: "monospace", fontSize: 12, width: 110 }}
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
            style={{ minWidth: 180 }}
          />
          <Column
            header="Category"
            body={(r) => (
              <Tag
                value={r.category}
                severity="secondary"
                style={{ fontSize: 10 }}
              />
            )}
            style={{ width: 130 }}
          />
          <Column
            header="Sub Category"
            body={(r) => (
              <span style={{ fontSize: 11, color: "#64748b" }}>
                {r.subCategory || "—"}
              </span>
            )}
            style={{ width: 140 }}
          />
          <Column
            header="Performed At"
            body={(r) => (
              <Tag
                value={r.performedAt}
                severity={PERFORMED_SEVERITY[r.performedAt] || "secondary"}
                style={{ fontSize: 10 }}
              />
            )}
            style={{ width: 110 }}
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
            header="Default Price"
            body={(r) => (
              <b style={{ color: "#0d6efd" }}>
                ₹{r.defaultPrice?.toLocaleString("en-IN")}
              </b>
            )}
            style={{ width: 110 }}
          />
          <Column
            header="TAT"
            body={(r) => <span style={{ fontSize: 11 }}>{r.tatHours}h</span>}
            style={{ width: 55 }}
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

      {/* ── ADD / EDIT DIALOG ── */}
      <Dialog
        visible={showForm}
        style={{ width: "min(760px, 96vw)" }}
        header={
          editItem
            ? `Edit — ${editItem.investigationName}`
            : "Add New Investigation"
        }
        onHide={() => {
          setShowForm(false);
          setEditItem(null);
        }}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button
              label="Cancel"
              severity="secondary"
              outlined
              onClick={() => setShowForm(false)}
            />
            <Button
              label={editItem ? "Update" : "Create"}
              icon="pi pi-check"
              severity="success"
              onClick={handleSave}
              loading={loading}
            />
          </div>
        }
      >
        {/* Auto-code info */}
        {!editItem && (
          <div
            style={{
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              borderRadius: 8,
              padding: "8px 14px",
              marginBottom: 14,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "#166534",
            }}
          >
            <i className="pi pi-info-circle" />
            Investigation Code will be <b>auto-generated</b> based on category
            (e.g. PATH-001, RAD-005)
          </div>
        )}

        {editItem && (
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "8px 14px",
              marginBottom: 14,
              fontSize: 13,
              color: "#475569",
            }}
          >
            Code:{" "}
            <b style={{ fontFamily: "monospace" }}>
              {editItem.investigationCode}
            </b>
          </div>
        )}

        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
        >
          <div style={{ gridColumn: "span 2" }}>
            <label style={lbl}>Investigation Name *</label>
            <InputText
              value={form.investigationName}
              onChange={(e) =>
                setForm({ ...form, investigationName: e.target.value })
              }
              placeholder="Complete Blood Count"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={lbl}>Short Name</label>
            <InputText
              value={form.shortName}
              onChange={(e) => setForm({ ...form, shortName: e.target.value })}
              placeholder="CBC"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={lbl}>Category *</label>
            <Dropdown
              value={form.category}
              options={CATEGORIES}
              onChange={(e) => setForm({ ...form, category: e.value })}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={lbl}>Sub Category</label>
            <InputText
              value={form.subCategory}
              onChange={(e) =>
                setForm({ ...form, subCategory: e.target.value })
              }
              placeholder="Haematology, CT Scan..."
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={lbl}>Performed At *</label>
            <Dropdown
              value={form.performedAt}
              options={PERFORMED_AT_OPTIONS}
              onChange={(e) => setForm({ ...form, performedAt: e.value })}
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={lbl}>Sample Type</label>
            <InputText
              value={form.sampleType}
              onChange={(e) => setForm({ ...form, sampleType: e.target.value })}
              placeholder="Blood / Urine / Stool"
              style={{ width: "100%" }}
            />
          </div>

          <div>
            <label style={lbl}>Default Price (₹) — CASH *</label>
            <InputNumber
              value={form.defaultPrice}
              onValueChange={(e) => setForm({ ...form, defaultPrice: e.value })}
              mode="currency"
              currency="INR"
              locale="en-IN"
              style={{ width: "100%" }}
            />
            <small style={{ color: "#16a34a", fontSize: 11 }}>
              CASH + all TPA pricings auto-created from this price
            </small>
          </div>

          <div>
            <label style={lbl}>TAT (hours)</label>
            <InputNumber
              value={form.tatHours}
              onValueChange={(e) => setForm({ ...form, tatHours: e.value })}
              min={0}
              suffix=" hrs"
              style={{ width: "100%" }}
            />
          </div>

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
                checked={form.availableForTPA}
                onChange={(e) => setForm({ ...form, availableForTPA: e.value })}
              />
              <label style={{ fontSize: 12, fontWeight: 600 }}>
                TPA Available
              </label>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <InputSwitch
                checked={form.requiresDoctorOrder}
                onChange={(e) =>
                  setForm({ ...form, requiresDoctorOrder: e.value })
                }
              />
              <label style={{ fontSize: 12, fontWeight: 600 }}>
                Requires Doctor Order
              </label>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <InputSwitch
                checked={form.isTaxable}
                onChange={(e) => setForm({ ...form, isTaxable: e.value })}
              />
              <label style={{ fontSize: 12, fontWeight: 600 }}>Taxable</label>
            </div>
          </div>

          {form.isTaxable && (
            <div>
              <label style={lbl}>Tax %</label>
              <InputNumber
                value={form.taxPercentage}
                onValueChange={(e) =>
                  setForm({ ...form, taxPercentage: e.value })
                }
                suffix="%"
                min={0}
                max={28}
                style={{ width: "100%" }}
              />
            </div>
          )}
        </div>
      </Dialog>

      {/* ── PRICING DIALOG ── */}
      <Dialog
        visible={showPricing}
        style={{ width: "min(760px, 96vw)" }}
        header={`Pricing — ${selItem?.investigationName || ""}`}
        onHide={() => setShowPricing(false)}
      >
        <TabView>
          <TabPanel header="Current Pricing">
            <div
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 14,
                fontSize: 13,
                color: "#166534",
              }}
            >
              <i className="pi pi-check-circle" style={{ marginRight: 6 }} />
              <b>CASH ₹{selItem?.defaultPrice?.toLocaleString("en-IN")}</b> —
              auto-set. All TPAs also auto-created with this price. Override any
              TPA price below.
            </div>
            <DataTable
              value={pricing}
              size="small"
              emptyMessage="No pricing found."
            >
              <Column
                header="Tariff"
                body={(r) => (
                  <Tag
                    value={r.tariffType}
                    severity={
                      r.tariffType === "TPA"
                        ? "success"
                        : r.tariffType === "CASH"
                          ? "secondary"
                          : "info"
                    }
                  />
                )}
                style={{ width: 90 }}
              />
              <Column
                header="TPA"
                body={(r) => r.tpaName || r.tpaId?.tpaName || "—"}
              />
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

          <TabPanel header="Override Pricing">
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
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 13,
                  color: "#92400e",
                }}
              >
                Override price for a specific TPA. CASH price — edit the
                investigation's default price.
              </div>

              <div>
                <label style={lbl}>Tariff Type *</label>
                <Dropdown
                  value={priceForm.tariffType}
                  options={[
                    { label: "TPA", value: "TPA" },
                    { label: "Corporate", value: "CORPORATE" },
                  ]}
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
                  <label style={lbl}>Select TPA *</label>
                  <Dropdown
                    value={priceForm.tpaId}
                    options={tpaList}
                    onChange={(e) =>
                      setPriceForm({ ...priceForm, tpaId: e.value })
                    }
                    placeholder="Select TPA"
                    filter
                    style={{ width: "100%" }}
                  />
                </div>
              )}

              <div>
                <label style={lbl}>Override Price (₹) *</label>
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
                <label style={lbl}>Discount (%)</label>
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
                  <label style={lbl}>TPA Approved Limit (₹)</label>
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
                  <small style={{ color: "#6c757d", fontSize: 11 }}>
                    Amount above this is paid by the patient.
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
                Final price:{" "}
                <b style={{ color: "#0d6efd", fontSize: 15 }}>
                  ₹
                  {(previewFinal || 0).toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                  })}
                </b>
              </div>

              <Button
                label="Save Override"
                icon="pi pi-check"
                severity="success"
                onClick={handleSavePricing}
                loading={loading}
              />
            </div>
          </TabPanel>
        </TabView>
      </Dialog>
    </div>
  );
}
