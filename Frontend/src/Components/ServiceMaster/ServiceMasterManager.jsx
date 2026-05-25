// frontend/components/ServiceMaster/ServiceMasterManager.jsx
// Admin panel to manage all hospital services and their pricing
import React, { useState, useEffect, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { Toast } from "primereact/toast";
import { InputNumber } from "primereact/inputnumber";
import { InputSwitch } from "primereact/inputswitch";
import { TabView, TabPanel } from "primereact/tabview";
import { useBilling } from "../../hooks/useBilling";
import { API_ENDPOINTS } from "../../config/api";

// ── HIS theme palette (matches PharmacyHomePage) ───────────────
const C = {
  bg: "#f8fafc", card: "#fff", border: "#e2e8f0",
  text: "#0f172a", muted: "#64748b", subtle: "#f8fafc",
  amber: "#d97706", amberL: "#fffbeb",
  blue: "#1d4ed8", blueL: "#eff6ff",
  green: "#16a34a", greenL: "#dcfce7",
  red: "#dc2626", redL: "#fef2f2",
  orange: "#ea580c", orangeL: "#fff7ed",
  teal: "#0d9488", tealL: "#f0fdfa",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  slate: "#475569",
};

// ── Domain + Category pill colour maps ─────────────────────────
const DOMAIN_PILL = {
  COMMON:    { bg: C.blueL,   fg: C.blue },
  OPD:       { bg: C.greenL,  fg: "#15803d" },
  IPD:       { bg: C.blueL,   fg: C.blue },
  EMERGENCY: { bg: C.redL,    fg: "#b91c1c" },
  DAYCARE:   { bg: C.amberL,  fg: C.amber },
};
const CAT_PILL = {
  CONSULTATION: { bg: C.greenL,  fg: "#15803d" },
  NURSING:      { bg: C.blueL,   fg: C.blue   },
  PROCEDURE:    { bg: C.redL,    fg: "#b91c1c"},
  OT:           { bg: C.redL,    fg: "#b91c1c"},
  ICU:          { bg: C.redL,    fg: "#b91c1c"},
  ROOM:         { bg: C.tealL,   fg: C.teal   },
  DOCTOR:       { bg: C.greenL,  fg: "#15803d"},
  REGISTRATION: { bg: C.subtle,  fg: C.muted  },
  SUPPORT:      { bg: C.subtle,  fg: C.muted  },
  DISCHARGE:    { bg: C.subtle,  fg: C.muted  },
  PACKAGE:      { bg: C.purpleL, fg: C.purple },
  DAYCARE:      { bg: C.amberL,  fg: C.amber  },
  OTHER:        { bg: C.subtle,  fg: C.muted  },
};

// Inline HIS pill (used for domain / category / status badges).
const Pill = ({ map, value }) => {
  const c = (map && map[value]) || { bg: C.subtle, fg: C.muted };
  return (
    <span style={{
      padding: "3px 10px", background: c.bg, color: c.fg, borderRadius: 10,
      fontSize: 10, fontWeight: 800, letterSpacing: ".3px",
    }}>
      {value}
    </span>
  );
};

// ── Reusable HIS-style input/label snippets (for dialog fields) ─
const HIS_INPUT = {
  padding: "10px 14px", border: `1.5px solid ${C.border}`, borderRadius: 9,
  fontFamily: "'DM Sans', sans-serif", fontSize: 13.5, color: C.text, width: "100%",
};
const HIS_LABEL = {
  display: "block", fontSize: 11, fontWeight: 700, color: C.muted,
  textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6,
};
// Shared header style applied to every DataTable Column (and via pt fallback).
const COL_HEADER_STYLE = {
  fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase",
  letterSpacing: ".4px", background: C.subtle, padding: "10px 12px",
};
const COL_BODY_STYLE = {
  fontSize: 12.5, color: C.text, padding: "10px 12px",
};

// ── Reusable section header pill (for dialog sections) ─────────
const SectionLabel = ({ children, color = C.orange, bg = C.orangeL }) => (
  <div style={{
    background: bg, color, padding: "6px 12px", borderRadius: 6,
    fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5,
    display: "inline-block", marginBottom: 10,
  }}>
    {children}
  </div>
);

// ── KPI tile ───────────────────────────────────────────────────
const KpiTile = ({ icon, label, value, color, bg }) => (
  <div style={{
    flex: 1, minWidth: 180, background: C.card, border: `1px solid ${C.border}`,
    borderRadius: 12, padding: 14, display: "flex", alignItems: "center", gap: 12,
  }}>
    <div style={{
      width: 40, height: 40, borderRadius: 10, background: bg, color,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>
      <i className={icon} style={{ fontSize: 18 }} />
    </div>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.text, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 2, fontWeight: 600 }}>
        {label}
      </div>
    </div>
  </div>
);

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
  // ── ANH tariff fields (optional — populated for imported packages) ─
  // tierPricing pairs with the patient's room category at billing time:
  //   GENW/DAYCARE → generalWard · SEMI → semiPrivate · PVT/ICU/NICU → private.
  // Admins edit any tier here; the engine picks the matching one per
  // admission. generalWard also feeds the CASH list price by default.
  tierPricing: { generalWard: 0, semiPrivate: 0, private: 0 },
  // Free-text from the rate card, surfaced on the receipt.
  inclusions: "",
  exclusions: "",
  // For MMP-style PER_DAY packages — switch back to la carte after this many days.
  maxLOSDays: 0,
  // Comma-separated diagnosis keywords for the auto-matcher (e.g. "dengue, fever").
  diagnosisTagsText: "",
  // Speciality / department label — surfaces in package filters.
  speciality: "",
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
      // ANH tariff fields — fall back to zero / empty if the row was
      // created via the old form (pre-extension) so the controls render.
      tierPricing: {
        generalWard: svc.tierPricing?.generalWard ?? 0,
        semiPrivate: svc.tierPricing?.semiPrivate ?? 0,
        private:     svc.tierPricing?.private     ?? 0,
      },
      inclusions: svc.inclusions || "",
      exclusions: svc.exclusions || "",
      maxLOSDays: svc.maxLOSDays || 0,
      diagnosisTagsText: Array.isArray(svc.diagnosisTags) ? svc.diagnosisTags.join(", ") : "",
      speciality: svc.speciality || "",
    });
    setShowSvcDlg(true);
  };

  // ── Save service ─────────────────────────────────────────────
  // Transform UI-only fields into the API shape before POST:
  //   diagnosisTagsText → diagnosisTags[]  (split on commas, trim, dedupe)
  //   tierPricing fields zero-stripped only when ALL three are 0 (otherwise
  //   we'd nuke the patient-tier pricing for any save by an unaware editor).
  const handleSaveService = async () => {
    try {
      const payload = {
        ...svcForm,
        diagnosisTags: String(svcForm.diagnosisTagsText || "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
          .filter((t, i, a) => a.indexOf(t) === i),
      };
      delete payload.diagnosisTagsText;
      // If the admin left every tier at 0, drop the whole subdoc so the
      // engine falls back to `defaultPrice` rather than billing ₹0/day.
      const tp = payload.tierPricing;
      if (!tp || (!tp.generalWard && !tp.semiPrivate && !tp.private)) {
        delete payload.tierPricing;
      }
      if (editSvc) {
        await billing.updateService(editSvc._id, payload);
        toast.current?.show({
          severity: "success",
          summary: "Updated",
          detail: "Service updated",
          life: 2000,
        });
      } else {
        await billing.createService(payload);
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

  // ── Computed KPIs ────────────────────────────────────────────
  const kpiActive = services.filter((s) => s.isActive).length;
  const kpiWithTier = services.filter((s) => {
    const tp = s.tierPricing;
    return tp && (tp.generalWard || tp.semiPrivate || tp.private);
  }).length;
  const kpiWithDxTags = services.filter(
    (s) => Array.isArray(s.diagnosisTags) && s.diagnosisTags.length > 0,
  ).length;

  // ════════════════════════════════════════════════════════════
  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: 20, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>
        <Toast ref={toast} position="top-right" />

        {/* ── Hero band (orange — matches sidebar gear active state) ── */}
        <div style={{
          background: "linear-gradient(135deg,#ea580c,#c2410c)",
          borderRadius: 14, padding: "16px 22px", marginBottom: 16,
          color: "#fff", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          boxShadow: "0 4px 14px rgba(234,88,12,.25)",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.32)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="pi pi-cog" style={{ fontSize: 22 }} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px" }}>Service Master</div>
            <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>
              Service catalog · tier pricing (CASH/TPA/CORPORATE) · package inclusions · diagnosis tagging
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              label="Seed Default Data"
              icon="pi pi-database"
              tooltip="Run once — loads 80+ default services"
              onClick={handleSeed}
              loading={billing.loading}
              style={{
                background: "rgba(255,255,255,.18)",
                border: "1px solid rgba(255,255,255,.32)",
                color: "#fff",
              }}
            />
            <Button
              label="Add Service"
              icon="pi pi-plus"
              onClick={openAdd}
              style={{
                background: "#fff",
                color: C.orange,
                border: "1px solid #fff",
                fontWeight: 700,
              }}
            />
          </div>
        </div>

        {/* ── KPI strip ── */}
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <KpiTile icon="pi pi-list" label="Total Services" value={total || services.length} color={C.blue} bg={C.blueL} />
          <KpiTile icon="pi pi-check-circle" label="Active" value={kpiActive} color={C.green} bg={C.greenL} />
          <KpiTile icon="pi pi-money-bill" label="With Tier Pricing" value={kpiWithTier} color={C.orange} bg={C.orangeL} />
          <KpiTile icon="pi pi-tags" label="With Diagnosis Tags" value={kpiWithDxTags} color={C.teal} bg={C.tealL} />
        </div>

        {/* ── Filters bar ── */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: 14, marginBottom: 14,
        }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <i className="pi pi-filter" style={{ color: C.orange, fontSize: 14 }} />
            <span style={{
              fontSize: 11, fontWeight: 800, color: C.muted,
              textTransform: "uppercase", letterSpacing: ".5px", marginRight: 6,
            }}>
              Filters
            </span>
            <span style={{ flex: "1 1 240px", minWidth: 200, position: "relative", display: "inline-flex", alignItems: "center" }}>
              <i
                className="pi pi-search"
                style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 13, pointerEvents: "none", zIndex: 1 }}
              />
              <InputText
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                placeholder="Search by name or code…"
                className="p-inputtext-sm"
                style={{ width: "100%", paddingLeft: 34 }}
              />
            </span>
            <Dropdown
              value={filters.domain}
              options={[{ label: "All Domains", value: null }, ...DOMAINS]}
              onChange={(e) => setFilters({ ...filters, domain: e.value })}
              placeholder="Domain"
              className="p-inputtext-sm"
              style={{ minWidth: 170 }}
            />
            <Dropdown
              value={filters.category}
              options={[{ label: "All Categories", value: null }, ...CATEGORIES]}
              onChange={(e) => setFilters({ ...filters, category: e.value })}
              placeholder="Category"
              className="p-inputtext-sm"
              style={{ minWidth: 170 }}
            />
            {(filters.search || filters.domain || filters.category) && (
              <button
                onClick={() => setFilters({ category: null, domain: null, search: "" })}
                style={{
                  padding: "7px 12px", background: "#fff", color: C.muted,
                  border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 11,
                  fontWeight: 700, cursor: "pointer",
                  textTransform: "uppercase", letterSpacing: ".4px",
                }}
              >
                Clear
              </button>
            )}
            <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted, fontWeight: 600 }}>
              {services.length} of {total || services.length} shown
            </span>
          </div>
        </div>

        {/* ── Main table ── */}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: 16, marginBottom: 16,
        }}>
        <DataTable
          value={services}
          loading={billing.loading}
          size="small"
          stripedRows
          pt={{
            table:     { style: { width: "100%" } },
            thead:     { style: { background: C.subtle } },
            headerRow: { style: { background: C.subtle } },
          }}
          emptyMessage={
            <div style={{ padding: 48, textAlign: "center", color: C.muted }}>
              <i className="pi pi-inbox" style={{ fontSize: 36, color: "#cbd5e1" }} />
              <div style={{ marginTop: 12, fontSize: 14, fontWeight: 600 }}>
                {filters.search || filters.domain || filters.category
                  ? "No services match your filters."
                  : "No services yet."}
              </div>
              <div style={{ marginTop: 4, fontSize: 12 }}>
                {filters.search || filters.domain || filters.category
                  ? "Try clearing the filters above."
                  : "Click \"Seed Default Data\" or \"+ Add Service\" to begin."}
              </div>
            </div>
          }
        >
          <Column
            field="serviceCode"
            header="Code"
            sortable
            headerStyle={{ ...COL_HEADER_STYLE, width: 130 }}
            bodyStyle={{ ...COL_BODY_STYLE, fontFamily: "'DM Mono', monospace" }}
          />
          <Column
            field="serviceName"
            header="Service Name"
            sortable
            headerStyle={{ ...COL_HEADER_STYLE, minWidth: 200 }}
            bodyStyle={{ ...COL_BODY_STYLE, fontWeight: 600 }}
          />
          <Column
            header="Domain"
            body={(r) => <Pill map={DOMAIN_PILL} value={r.domain} />}
            headerStyle={{ ...COL_HEADER_STYLE, width: 100 }}
            bodyStyle={COL_BODY_STYLE}
          />
          <Column
            header="Category"
            body={(r) => <Pill map={CAT_PILL} value={r.category} />}
            headerStyle={{ ...COL_HEADER_STYLE, width: 130 }}
            bodyStyle={COL_BODY_STYLE}
          />
          <Column
            header="Billing Type"
            body={(r) => (
              <span style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: ".2px" }}>
                {r.billingType.replace(/_/g, " ")}
              </span>
            )}
            headerStyle={{ ...COL_HEADER_STYLE, width: 130 }}
            bodyStyle={COL_BODY_STYLE}
          />
          <Column
            header="Default ₹"
            body={(r) => (
              <span style={{
                fontFamily: "'DM Mono', monospace", fontWeight: 700, color: C.orange,
              }}>
                ₹{r.defaultPrice.toLocaleString("en-IN")}
              </span>
            )}
            headerStyle={{ ...COL_HEADER_STYLE, width: 110 }}
            bodyStyle={COL_BODY_STYLE}
          />
          <Column
            header="Auto?"
            body={(r) =>
              r.isAutoCharged ? (
                <span style={{
                  padding: "3px 8px", background: C.amberL, color: C.amber, borderRadius: 10,
                  fontSize: 10, fontWeight: 800, letterSpacing: ".3px",
                }}>
                  AUTO
                </span>
              ) : (
                <span style={{ color: C.muted }}>—</span>
              )
            }
            headerStyle={{ ...COL_HEADER_STYLE, width: 70 }}
            bodyStyle={COL_BODY_STYLE}
          />
          <Column
            header="Status"
            body={(r) => (
              <span style={{
                padding: "3px 10px",
                background: r.isActive ? C.greenL : C.redL,
                color: r.isActive ? "#15803d" : "#b91c1c",
                borderRadius: 10, fontSize: 10, fontWeight: 800,
                textTransform: "uppercase", letterSpacing: ".4px",
              }}>
                {r.isActive ? "Active" : "Inactive"}
              </span>
            )}
            headerStyle={{ ...COL_HEADER_STYLE, width: 90 }}
            bodyStyle={COL_BODY_STYLE}
          />
          <Column
            header="Actions"
            body={(r) => (
              <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                <button
                  onClick={() => openEdit(r)}
                  title="Edit"
                  style={{
                    width: 30, height: 30, padding: 0, background: "#fff", color: C.blue,
                    border: `1.5px solid ${C.blueL}`, borderRadius: 8, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <i className="pi pi-pencil" style={{ fontSize: 11 }} />
                </button>
                <button
                  onClick={() => openPricing(r)}
                  title="Tier pricing"
                  style={{
                    width: 30, height: 30, padding: 0, background: "#fff", color: C.orange,
                    border: `1.5px solid ${C.orangeL}`, borderRadius: 8, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <i className="pi pi-tag" style={{ fontSize: 11 }} />
                </button>
                {r.isActive && (
                  <button
                    onClick={() => handleDeactivate(r._id)}
                    title="Delete"
                    style={{
                      width: 30, height: 30, padding: 0, background: "#fff", color: C.red,
                      border: `1.5px solid ${C.redL}`, borderRadius: 8, cursor: "pointer",
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <i className="pi pi-trash" style={{ fontSize: 11 }} />
                  </button>
                )}
              </div>
            )}
            headerStyle={{ ...COL_HEADER_STYLE, width: 120, textAlign: "right" }}
            bodyStyle={{ ...COL_BODY_STYLE, textAlign: "right" }}
          />
        </DataTable>
        </div>

      {/* ════════════════════════════════════════
          DIALOG: Add / Edit Service
      ════════════════════════════════════════ */}
      <Dialog
        visible={showSvcDlg}
        style={{ width: "min(780px, 94vw)" }}
        header={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: C.orangeL, color: C.orange,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <i className={editSvc ? "pi pi-pencil" : "pi pi-plus"} style={{ fontSize: 14 }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>
                {editSvc ? "Edit Service" : "New Service"}
              </div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>
                {editSvc ? editSvc.serviceCode : "Define a billable service line"}
              </div>
            </div>
          </div>
        }
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
              onClick={handleSaveService}
              loading={billing.loading}
              style={{
                background: `linear-gradient(135deg, ${C.orange}, #c2410c)`,
                border: "none",
                color: "#fff",
                fontWeight: 700,
              }}
            />
          </div>
        }
      >
        {/* Orange accent band */}
        <div style={{
          height: 4, background: `linear-gradient(90deg, ${C.orange}, #c2410c)`,
          borderRadius: 2, marginBottom: 14,
        }} />

        {/* IDENTITY section */}
        <SectionLabel>Identity</SectionLabel>
        <div
          style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14,
            border: `1px dashed ${C.border}`, padding: "12px 14px",
            borderRadius: 8, marginBottom: 14,
          }}
        >
          <div>
            <label style={HIS_LABEL}>Service Code *</label>
            <InputText
              value={svcForm.serviceCode}
              onChange={(e) =>
                setSvcForm({
                  ...svcForm,
                  serviceCode: e.target.value.toUpperCase(),
                })
              }
              placeholder="IPD-RM-001"
              style={{ ...HIS_INPUT, fontFamily: "'DM Mono', monospace" }}
              disabled={!!editSvc}
            />
          </div>
          <div>
            <label style={HIS_LABEL}>Service Name *</label>
            <InputText
              value={svcForm.serviceName}
              onChange={(e) =>
                setSvcForm({ ...svcForm, serviceName: e.target.value })
              }
              placeholder="General Ward Bed"
              style={HIS_INPUT}
            />
          </div>
          <div>
            <label style={HIS_LABEL}>Domain *</label>
            <Dropdown
              value={svcForm.domain}
              options={DOMAINS}
              onChange={(e) => setSvcForm({ ...svcForm, domain: e.value })}
              className="p-inputtext-sm"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={HIS_LABEL}>Category *</label>
            <Dropdown
              value={svcForm.category}
              options={CATEGORIES}
              onChange={(e) => setSvcForm({ ...svcForm, category: e.value })}
              className="p-inputtext-sm"
              style={{ width: "100%" }}
            />
          </div>
        </div>

        {/* PRICING section */}
        <SectionLabel>Pricing</SectionLabel>
        <div
          style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14,
            border: `1px dashed ${C.border}`, padding: "12px 14px",
            borderRadius: 8, marginBottom: 14,
          }}
        >
          <div>
            <label style={HIS_LABEL}>Billing Type *</label>
            <Dropdown
              value={svcForm.billingType}
              options={BILLING_TYPES}
              onChange={(e) => setSvcForm({ ...svcForm, billingType: e.value })}
              className="p-inputtext-sm"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={HIS_LABEL}>Default Price (₹) *</label>
            <InputNumber
              value={svcForm.defaultPrice}
              onValueChange={(e) =>
                setSvcForm({ ...svcForm, defaultPrice: e.value })
              }
              mode="currency"
              currency="INR"
              locale="en-IN"
              inputStyle={HIS_INPUT}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={HIS_LABEL}>Unit Label</label>
            <InputText
              value={svcForm.unitLabel}
              onChange={(e) =>
                setSvcForm({ ...svcForm, unitLabel: e.target.value })
              }
              placeholder="per day / per visit / per hour"
              style={HIS_INPUT}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20, paddingTop: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <InputSwitch
                checked={svcForm.isAutoCharged}
                onChange={(e) =>
                  setSvcForm({ ...svcForm, isAutoCharged: e.value })
                }
              />
              <label style={{
                fontSize: 11, fontWeight: 700, color: C.muted,
                textTransform: "uppercase", letterSpacing: ".4px",
              }}>
                Auto-Charge Daily
              </label>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <InputSwitch
                checked={svcForm.isTaxable}
                onChange={(e) => setSvcForm({ ...svcForm, isTaxable: e.value })}
              />
              <label style={{
                fontSize: 11, fontWeight: 700, color: C.muted,
                textTransform: "uppercase", letterSpacing: ".4px",
              }}>
                Taxable
              </label>
            </div>
          </div>
          {svcForm.isTaxable && (
            <div>
              <label style={HIS_LABEL}>Tax %</label>
              <InputNumber
                value={svcForm.taxPercentage}
                onValueChange={(e) =>
                  setSvcForm({ ...svcForm, taxPercentage: e.value })
                }
                suffix="%"
                min={0}
                max={28}
                inputStyle={HIS_INPUT}
                style={{ width: "100%" }}
              />
            </div>
          )}
          <div style={{ gridColumn: "span 2" }}>
            <label style={HIS_LABEL}>Description</label>
            <InputText
              value={svcForm.description}
              onChange={(e) =>
                setSvcForm({ ...svcForm, description: e.target.value })
              }
              placeholder="Optional description"
              style={HIS_INPUT}
            />
          </div>

          {/* ────────────────────────────────────────────────────────
              TIER PRICING (per-room-category)
              Patient's room category drives the engine's lookup:
                GENW/DAYCARE → generalWard · SEMI → semiPrivate
                · PVT/ICU/NICU → private.
              CASH list price defaults to General Ward tier.
          ──────────────────────────────────────────────────────── */}
          <div style={{
            gridColumn: "span 2", marginTop: 4,
            border: `1px dashed ${C.border}`, padding: "12px 14px",
            borderRadius: 8, marginBottom: 4,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 800, color: C.muted,
              textTransform: "uppercase", letterSpacing: ".5px",
              marginBottom: 12, display: "flex", alignItems: "center", gap: 8,
            }}>
              <i className="pi pi-money-bill" style={{ color: C.orange }} /> Tier Pricing
              <span style={{
                marginLeft: "auto", fontSize: 10, fontWeight: 600,
                color: C.muted, textTransform: "none", letterSpacing: 0,
              }}>
                CASH = General Ward tier
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <div>
                <label style={HIS_LABEL}>General Ward (₹)</label>
                <InputNumber
                  value={svcForm.tierPricing?.generalWard ?? 0}
                  onValueChange={(e) => setSvcForm({ ...svcForm, tierPricing: { ...svcForm.tierPricing, generalWard: e.value || 0 } })}
                  mode="currency" currency="INR" locale="en-IN"
                  inputStyle={HIS_INPUT}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={HIS_LABEL}>Semi-Private (₹)</label>
                <InputNumber
                  value={svcForm.tierPricing?.semiPrivate ?? 0}
                  onValueChange={(e) => setSvcForm({ ...svcForm, tierPricing: { ...svcForm.tierPricing, semiPrivate: e.value || 0 } })}
                  mode="currency" currency="INR" locale="en-IN"
                  inputStyle={HIS_INPUT}
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={HIS_LABEL}>Private / ICU / NICU (₹)</label>
                <InputNumber
                  value={svcForm.tierPricing?.private ?? 0}
                  onValueChange={(e) => setSvcForm({ ...svcForm, tierPricing: { ...svcForm.tierPricing, private: e.value || 0 } })}
                  mode="currency" currency="INR" locale="en-IN"
                  inputStyle={HIS_INPUT}
                  style={{ width: "100%" }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* DIAGNOSIS & PACKAGES section */}
        <SectionLabel>Diagnosis &amp; Packages</SectionLabel>
        <div
          style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12,
            border: `1px dashed ${C.border}`, padding: "12px 14px",
            borderRadius: 8, marginBottom: 6,
          }}
        >
          <div>
            <label style={HIS_LABEL}>Speciality</label>
            <InputText
              value={svcForm.speciality || ""}
              onChange={(e) => setSvcForm({ ...svcForm, speciality: e.target.value })}
              placeholder="e.g. Cardiology, ENT, Medical Management"
              style={HIS_INPUT}
            />
          </div>
          <div>
            <label style={HIS_LABEL}>Max LOS (days, 0 = uncapped)</label>
            <InputNumber
              value={svcForm.maxLOSDays ?? 0}
              onValueChange={(e) => setSvcForm({ ...svcForm, maxLOSDays: e.value || 0 })}
              min={0} max={90}
              suffix=" d"
              inputStyle={HIS_INPUT}
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <small style={{ color: C.muted, fontSize: 11 }}>
              After Max LOS, per-day billing reverts to room + nursing + investigations.
            </small>
          </div>

          <div style={{ gridColumn: "span 3" }}>
            <label style={HIS_LABEL}>
              Diagnosis Tags (comma-separated, used for auto-matching)
            </label>
            <InputText
              value={svcForm.diagnosisTagsText || ""}
              onChange={(e) => setSvcForm({ ...svcForm, diagnosisTagsText: e.target.value })}
              placeholder="e.g. dengue, fever, septicaemia, chikungunya"
              style={HIS_INPUT}
            />
            <small style={{ color: C.muted, fontSize: 11 }}>
              When an admission's diagnosis matches &ge; 2 of these tags (or 1 if only one is set), this package auto-attaches.
            </small>
          </div>

          <div style={{ gridColumn: "span 3" }}>
            <label style={HIS_LABEL}>Inclusions</label>
            <InputText
              value={svcForm.inclusions || ""}
              onChange={(e) => setSvcForm({ ...svcForm, inclusions: e.target.value })}
              placeholder="What this package covers (free text from rate card)"
              style={HIS_INPUT}
            />
          </div>
          <div style={{ gridColumn: "span 3" }}>
            <label style={HIS_LABEL}>Exclusions</label>
            <InputText
              value={svcForm.exclusions || ""}
              onChange={(e) => setSvcForm({ ...svcForm, exclusions: e.target.value })}
              placeholder="What's NOT included (charged separately)"
              style={HIS_INPUT}
            />
          </div>
        </div>
      </Dialog>

      {/* ════════════════════════════════════════
          DIALOG: Pricing
      ════════════════════════════════════════ */}
      <Dialog
        visible={showPriceDlg}
        style={{ width: "min(760px, 94vw)" }}
        header={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: C.orangeL, color: C.orange,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <i className="pi pi-tag" style={{ fontSize: 14 }} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>
                Tariff Pricing
              </div>
              <div style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>
                {selService?.serviceName || ""}
              </div>
            </div>
          </div>
        }
        onHide={() => setShowPriceDlg(false)}
      >
        <TabView>
          {/* Existing pricing */}
          <TabPanel header="Existing Pricing">
            <DataTable
              value={pricing}
              size="small"
              stripedRows
              pt={{
                thead:     { style: { background: C.subtle } },
                headerRow: { style: { background: C.subtle } },
              }}
              emptyMessage={
                <div style={{ padding: 32, textAlign: "center", color: C.muted }}>
                  <i className="pi pi-inbox" style={{ fontSize: 28, color: "#cbd5e1" }} />
                  <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}>
                    No pricing configured.
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12 }}>
                    Default price will be used.
                  </div>
                </div>
              }
            >
              <Column
                header="Tariff"
                body={(r) => {
                  const tariffMap = {
                    TPA:       { bg: C.greenL, fg: "#15803d" },
                    CORPORATE: { bg: C.blueL,  fg: C.blue    },
                    CASH:      { bg: C.subtle, fg: C.muted   },
                  };
                  const c = tariffMap[r.tariffType] || { bg: C.subtle, fg: C.muted };
                  return (
                    <span style={{
                      padding: "3px 10px", background: c.bg, color: c.fg, borderRadius: 10,
                      fontSize: 10, fontWeight: 800, letterSpacing: ".3px",
                    }}>
                      {r.tariffType}
                    </span>
                  );
                }}
                headerStyle={COL_HEADER_STYLE}
                bodyStyle={COL_BODY_STYLE}
              />
              <Column
                header="TPA"
                body={(r) => r.tpaId?.tpaName || <span style={{ color: C.muted }}>—</span>}
                headerStyle={COL_HEADER_STYLE}
                bodyStyle={COL_BODY_STYLE}
              />
              <Column
                header="Price"
                body={(r) => (
                  <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
                    ₹{r.price.toLocaleString("en-IN")}
                  </span>
                )}
                headerStyle={COL_HEADER_STYLE}
                bodyStyle={COL_BODY_STYLE}
              />
              <Column
                header="Discount"
                body={(r) =>
                  r.discount > 0
                    ? <span style={{ color: C.amber, fontWeight: 600 }}>{r.discount}%</span>
                    : <span style={{ color: C.muted }}>—</span>
                }
                headerStyle={COL_HEADER_STYLE}
                bodyStyle={COL_BODY_STYLE}
              />
              <Column
                header="Final Price"
                body={(r) => (
                  <span style={{
                    fontFamily: "'DM Mono', monospace", fontWeight: 700, color: C.orange,
                  }}>
                    ₹{r.finalPrice.toLocaleString("en-IN")}
                  </span>
                )}
                headerStyle={COL_HEADER_STYLE}
                bodyStyle={COL_BODY_STYLE}
              />
              <Column
                header="TPA Limit"
                body={(r) =>
                  r.tpaApprovedLimit
                    ? (
                      <span style={{ fontFamily: "'DM Mono', monospace" }}>
                        ₹{r.tpaApprovedLimit.toLocaleString("en-IN")}
                      </span>
                    )
                    : <span style={{ color: C.muted }}>—</span>
                }
                headerStyle={COL_HEADER_STYLE}
                bodyStyle={COL_BODY_STYLE}
              />
              <Column
                header="Active"
                body={(r) => (
                  <span style={{
                    padding: "3px 10px",
                    background: r.isActive ? C.greenL : C.subtle,
                    color: r.isActive ? "#15803d" : C.muted,
                    borderRadius: 10, fontSize: 10, fontWeight: 800,
                    textTransform: "uppercase", letterSpacing: ".4px",
                  }}>
                    {r.isActive ? "Yes" : "No"}
                  </span>
                )}
                headerStyle={COL_HEADER_STYLE}
                bodyStyle={COL_BODY_STYLE}
              />
            </DataTable>
          </TabPanel>

          {/* Add / update pricing */}
          <TabPanel header="Add / Update Pricing">
            <div style={{
              display: "flex", flexDirection: "column", gap: 14, maxWidth: 440,
            }}>
              {/* CASH auto-set info */}
              <div style={{
                background: C.greenL, border: `1px solid #bbf7d0`,
                borderRadius: 8, padding: "10px 14px",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <i className="pi pi-check-circle" style={{ color: "#16a34a", fontSize: 16 }} />
                <span style={{ fontSize: 12.5, color: "#166534", lineHeight: 1.4 }}>
                  <b>CASH price auto-set hai</b> — service ka Default Price
                  automatically CASH tariff ban jaata hai. Yahan sirf{" "}
                  <b>TPA / Corporate</b> price set karo.
                </span>
              </div>

              <div>
                <label style={HIS_LABEL}>Tariff Type *</label>
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
                  className="p-inputtext-sm"
                  style={{ width: "100%" }}
                />
              </div>

              {priceForm.tariffType === "TPA" && (
                <div>
                  <label style={HIS_LABEL}>TPA Select Karo *</label>
                  <Dropdown
                    value={priceForm.tpaId}
                    options={tpaList}
                    onChange={(e) =>
                      setPriceForm({ ...priceForm, tpaId: e.value })
                    }
                    placeholder="TPA select karo"
                    filter
                    className="p-inputtext-sm"
                    style={{ width: "100%" }}
                  />
                </div>
              )}

              <div>
                <label style={HIS_LABEL}>Price (₹) *</label>
                <InputNumber
                  value={priceForm.price}
                  onValueChange={(e) =>
                    setPriceForm({ ...priceForm, price: e.value })
                  }
                  mode="currency"
                  currency="INR"
                  locale="en-IN"
                  inputStyle={HIS_INPUT}
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={HIS_LABEL}>Discount (%)</label>
                <InputNumber
                  value={priceForm.discount}
                  onValueChange={(e) =>
                    setPriceForm({ ...priceForm, discount: e.value })
                  }
                  suffix="%"
                  min={0}
                  max={100}
                  inputStyle={HIS_INPUT}
                  style={{ width: "100%" }}
                />
              </div>

              {priceForm.tariffType === "TPA" && (
                <div>
                  <label style={HIS_LABEL}>TPA Approved Limit (₹)</label>
                  <InputNumber
                    value={priceForm.tpaApprovedLimit}
                    onValueChange={(e) =>
                      setPriceForm({ ...priceForm, tpaApprovedLimit: e.value })
                    }
                    mode="currency"
                    currency="INR"
                    locale="en-IN"
                    placeholder="Max TPA will pay"
                    inputStyle={HIS_INPUT}
                    style={{ width: "100%" }}
                  />
                  <small style={{ color: C.muted, fontSize: 11 }}>
                    TPA is se zyada nahi dega. Remaining amount patient pays.
                  </small>
                </div>
              )}

              <div style={{
                background: C.orangeL, border: `1px solid ${C.orange}33`,
                padding: "12px 14px", borderRadius: 8,
                fontSize: 12.5, color: C.slate,
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: C.muted,
                  textTransform: "uppercase", letterSpacing: ".4px",
                }}>
                  Final Price after discount
                </span>
                <b style={{
                  color: C.orange, fontSize: 18,
                  fontFamily: "'DM Mono', monospace",
                }}>
                  ₹{(previewFinal || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </b>
              </div>

              <Button
                label="Save Pricing"
                icon="pi pi-check"
                onClick={handleSavePricing}
                loading={billing.loading}
                style={{
                  background: `linear-gradient(135deg, ${C.orange}, #c2410c)`,
                  border: "none",
                  color: "#fff",
                  fontWeight: 700,
                }}
              />
            </div>
          </TabPanel>
        </TabView>
      </Dialog>
      </div>
    </div>
  );
}
