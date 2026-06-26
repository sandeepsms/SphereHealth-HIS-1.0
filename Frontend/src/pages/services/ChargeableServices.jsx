// frontend/pages/services/ChargeableServices.jsx
// Manages dynamic chargeable services organized by domain (OPD, IPD, Emergency, DayCare, Common)
//
// Theme: re-skinned to match the HIS design used by PharmacyHomePage —
// gradient amber Hero + KPI strip + slate-bg + max-width container +
// admin-theme TabStrip. All existing functions / state / validation /
// API calls are preserved verbatim — only the styling/layout changed.
import React, { useState, useEffect, useRef } from "react";
import { API_ENDPOINTS } from "../../config/api";

// PrimeReact Imports
// (Tag / TabView / TabPanel / Tooltip / Button / Card all replaced
// with HIS inline-styled primitives — kept only the form controls and
// the DataTable that we still leverage for sorting/pagination.)
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { InputSwitch } from "primereact/inputswitch";
import { Dropdown } from "primereact/dropdown";
import { MultiSelect } from "primereact/multiselect";
import { Dialog } from "primereact/dialog";
import { Toast } from "primereact/toast";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";

import { useBilling } from "../../hooks/useBilling";
import { TabStrip } from "../../Components/admin-theme";

// ── HIS theme palette (matches PharmacyHomePage) ─────────────────
const C = {
  bg: "#f8fafc", card: "#fff", border: "#e2e8f0",
  text: "#0f172a", muted: "#64748b", subtle: "#f8fafc",
  amber: "#d97706", amberL: "#fffbeb",
  blue: "#4f46e5", blueL: "#eef2ff",
  green: "#16a34a", greenL: "#dcfce7",
  red: "#dc2626", redL: "#fef2f2",
  orange: "#ea580c", orangeL: "#fff7ed",
  teal: "#0d9488", tealL: "#ccfbf1",
  purple: "#7c3aed", purpleL: "#ede9fe",
  slate: "#475569",
};

// ── Category badge color map ─────────────────────────────────────
// Pairs of (bg, fg) for each service category — used by the inline
// pill replacing the PrimeReact Tag in the table. Categories not
// listed fall back to a neutral subtle/muted look.
const catColors = {
  CONSULTATION: { bg: C.amberL, fg: C.amber },
  DOCTOR:       { bg: C.amberL, fg: C.amber },
  NURSING:      { bg: C.blueL,  fg: C.blue  },
  PROCEDURE:    { bg: C.redL,   fg: C.red   },
  OT:           { bg: C.redL,   fg: C.red   },
  ICU:          { bg: C.redL,   fg: C.red   },
  ROOM:         { bg: C.tealL,  fg: C.teal  },
  PACKAGE:      { bg: C.purpleL, fg: C.purple },
  DAYCARE:      { bg: C.orangeL, fg: C.orange },
  REGISTRATION: { bg: "#f1f5f9", fg: C.slate },
  SUPPORT:      { bg: "#f1f5f9", fg: C.slate },
  DISCHARGE:    { bg: "#f1f5f9", fg: C.slate },
  OTHER:        { bg: "#f1f5f9", fg: C.slate },
};

// ── Doctor-order type colour map (12 enum values) ────────────────
// Used by the new "Doctor Order Type" column. Falls back to slate
// for unknown values. Palette aligned with the HIS-wide chip set.
const docOrderColors = {
  Medication:        { bg: C.purpleL, fg: C.purple   },
  IV_Fluid:          { bg: C.blueL,   fg: C.blue     },
  Lab:               { bg: C.tealL,   fg: C.teal     },
  Radiology:         { bg: "#eef2ff", fg: "#4338ca"  }, // indigo
  Procedure:         { bg: C.amberL,  fg: C.amber    },
  BloodTransfusion:  { bg: C.redL,    fg: C.red      },
  Diet:              { bg: C.greenL,  fg: C.green    },
  Oxygen:            { bg: "#ecfeff", fg: "#0e7490"  }, // cyan
  Physiotherapy:     { bg: "#fdf2f8", fg: "#be185d"  }, // pink
  Activity:          { bg: C.orangeL, fg: C.orange   },
  Nursing:           { bg: "#fff1f2", fg: "#be123c"  }, // rose
  Consultation:      { bg: "#f1f5f9", fg: C.slate    },
};

// Inline pill primitive — used for status/category/auto badges
// throughout the table so chrome stays consistent.
const pillStyle = (bg, fg) => ({
  padding: "3px 10px",
  background: bg,
  color: fg,
  borderRadius: 10,
  fontSize: 10,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: ".4px",
  display: "inline-block",
  whiteSpace: "nowrap",
});

// Section pill primitive — used inside dialogs to mark sub-sections
// (Identity / Pricing / Applicability, etc.).
const sectionPill = (bg, fg) => ({
  background: bg,
  color: fg,
  padding: "6px 12px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: ".5px",
  display: "inline-block",
  marginBottom: 10,
});

// ── Constants ────────────────────────────────────────────────────

const DOMAIN_TABS = [
  { label: "All", domain: null, color: "#4F46E5", icon: "pi-list" },
  { label: "OPD", domain: "OPD", color: "#10B981", icon: "pi-user" },
  { label: "IPD", domain: "IPD", color: "#6366f1", icon: "pi-home" },
  { label: "Emergency", domain: "EMERGENCY", color: "#EF4444", icon: "pi-bolt" },
  { label: "Day Care", domain: "DAYCARE", color: "#F59E0B", icon: "pi-sun" },
  { label: "Common", domain: "COMMON", color: "#6B7280", icon: "pi-globe" },
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

// 12 doctor-order categories (mirrors backend enum). Optional on every
// service row — null means this service is not part of the doctor-order
// flow (e.g. room rent, registration).
const DOC_ORDER_CATEGORIES = [
  "Medication",
  "IV_Fluid",
  "Lab",
  "Radiology",
  "Procedure",
  "BloodTransfusion",
  "Diet",
  "Oxygen",
  "Physiotherapy",
  "Activity",
  "Nursing",
  "Consultation",
];
const DOC_ORDER_OPTIONS = DOC_ORDER_CATEGORIES.map((v) => ({
  label: v.replace(/_/g, " "),
  value: v,
}));

const STATUS_OPTIONS = [
  { label: "All", value: null },
  { label: "Active", value: "true" },
  { label: "Inactive", value: "false" },
];

// ── Blank forms ──────────────────────────────────────────────────

const BLANK_SVC = {
  serviceCode: "",
  serviceName: "",
  domain: "OPD",
  category: "REGISTRATION",
  // Optional doctor-order bucket — Medication / Lab / Radiology / …
  // Surfaces this service in the matching doctor-order group.
  doctorOrderCategory: null,
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

  // Tab state — keep the same numeric activeTab so the rest of the
  // load() / handleTabChange logic doesn't need to change. We just
  // render the tab strip differently (admin-theme TabStrip instead
  // of PrimeReact TabView).
  const [activeTab, setActiveTab] = useState(0);

  // Services data
  const [services, setServices] = useState([]);
  const [total, setTotal] = useState(0);

  // Filters (shared across tabs, reset on tab switch)
  const [filters, setFilters] = useState({
    search: "",
    category: null,
    doctorOrderCategory: null,
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
        ...(filters.doctorOrderCategory && { doctorOrderCategory: filters.doctorOrderCategory }),
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
        m.default.get(API_ENDPOINTS.TPA)
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
  const handleTabChange = (idx) => {
    setActiveTab(idx);
    setFilters({ search: "", category: null, doctorOrderCategory: null, status: null });
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
      doctorOrderCategory: svc.doctorOrderCategory || null,
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
        color: C.text,
        fontWeight: 700,
      }}
    >
      {r.serviceCode}
    </span>
  );

  const categoryBodyTemplate = (r) => {
    const c = catColors[r.category] || { bg: "#f1f5f9", fg: C.slate };
    return <span style={pillStyle(c.bg, c.fg)}>{r.category}</span>;
  };

  // Doctor-order type pill — surfaces which doctor-order group this
  // service belongs to. null shows muted em-dash so admins can scan
  // for non-orderable rows (room rent, registration).
  const doctorOrderBodyTemplate = (r) => {
    if (!r.doctorOrderCategory) {
      return <span style={{ color: "#cbd5e1" }}>—</span>;
    }
    const c = docOrderColors[r.doctorOrderCategory] || { bg: "#f1f5f9", fg: C.slate };
    return (
      <span style={pillStyle(c.bg, c.fg)}>
        {r.doctorOrderCategory.replace(/_/g, " ")}
      </span>
    );
  };

  const billingTypeBodyTemplate = (r) => (
    <span style={{ fontSize: 11, color: C.muted }}>
      {r.billingType?.replace(/_/g, " ")}
    </span>
  );

  const priceBodyTemplate = (r) => (
    <b style={{ color: C.green }}>
      ₹{(r.defaultPrice || 0).toLocaleString("en-IN")}
    </b>
  );

  const autoChargedBodyTemplate = (r) =>
    r.isAutoCharged ? (
      <span style={pillStyle(C.amberL, C.amber)}>AUTO</span>
    ) : (
      <span style={{ color: "#cbd5e1" }}>—</span>
    );

  const statusBodyTemplate = (r) => (
    <span
      style={pillStyle(
        r.isActive ? C.greenL : C.redL,
        r.isActive ? "#15803d" : "#b91c1c"
      )}
    >
      {r.isActive ? "Active" : "Inactive"}
    </span>
  );

  // Row actions — three icon-buttons (edit / pricing / toggle) in
  // consistent HIS chrome (30x30, soft tinted border, white fill).
  const iconBtn = (icon, color, borderColor, onClick, title) => (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 30,
        height: 30,
        padding: 0,
        background: "#fff",
        color,
        border: `1.5px solid ${borderColor}`,
        borderRadius: 8,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background .12s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = borderColor + "22")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
    >
      <i className={icon} style={{ fontSize: 11 }} />
    </button>
  );

  const actionsBodyTemplate = (r) => (
    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
      {iconBtn("pi pi-pencil", C.blue, C.blueL, () => openEdit(r), "Edit")}
      {iconBtn("pi pi-tag", C.amber, C.amberL, () => openPricing(r), "Tier pricing")}
      {iconBtn(
        r.isActive ? "pi pi-ban" : "pi pi-check",
        r.isActive ? C.red : C.green,
        r.isActive ? C.redL : C.greenL,
        () => handleToggleActive(r),
        r.isActive ? "Deactivate" : "Activate"
      )}
    </div>
  );

  // ── Filter bar ───────────────────────────────────────────────
  // Search + 2 dropdowns + Clear button (only when any filter active)
  // + a small "X of Y shown" muted text floated right.
  const clearFilters = () =>
    setFilters({ search: "", category: null, doctorOrderCategory: null, status: null });
  const anyFilter = !!filters.search || !!filters.category || !!filters.doctorOrderCategory || filters.status !== null;

  const filterBar = (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 14,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 280px", minWidth: 240, position: "relative" }}>
          <i
            className="pi pi-search"
            style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 14, pointerEvents: "none" }}
          />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Search by name or code..."
            style={{
              width: "100%",
              padding: "10px 14px 10px 40px",
              border: `1.5px solid ${C.border}`,
              borderRadius: 9,
              fontSize: 13.5,
              fontFamily: "'DM Sans', sans-serif",
              color: C.text,
              background: "#fff",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
        {/* R7dk — Native <select> for clean vertical centering */}
        <select
          value={filters.category ?? ""}
          onChange={(e) => setFilters({ ...filters, category: e.target.value || null })}
          style={{
            minWidth: 180,
            height: 42,
            padding: "0 14px",
            border: `1.5px solid ${C.border}`,
            borderRadius: 9,
            fontSize: 13,
            fontFamily: "'DM Sans', sans-serif",
            color: filters.category ? C.text : "#94a3b8",
            background: "#fff",
            outline: "none",
            cursor: "pointer",
            appearance: "auto",
            boxSizing: "border-box",
          }}
        >
          <option value="">All Categories</option>
          {CATEGORIES.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {/* Doctor-order type filter — passes ?doctorOrderCategory=<v>
           to the LIST call so admins can scope to a single bucket
           (Medication / Lab / Radiology / …). */}
        <select
          value={filters.doctorOrderCategory ?? ""}
          onChange={(e) => setFilters({ ...filters, doctorOrderCategory: e.target.value || null })}
          style={{
            minWidth: 190,
            height: 42,
            padding: "0 14px",
            border: `1.5px solid ${C.border}`,
            borderRadius: 9,
            fontSize: 13,
            fontFamily: "'DM Sans', sans-serif",
            color: filters.doctorOrderCategory ? C.text : "#94a3b8",
            background: "#fff",
            outline: "none",
            cursor: "pointer",
            appearance: "auto",
            boxSizing: "border-box",
          }}
        >
          <option value="">All Doctor Order Types</option>
          {DOC_ORDER_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={filters.status ?? ""}
          onChange={(e) => setFilters({ ...filters, status: e.target.value || null })}
          style={{
            minWidth: 140,
            height: 42,
            padding: "0 14px",
            border: `1.5px solid ${C.border}`,
            borderRadius: 9,
            fontSize: 13,
            fontFamily: "'DM Sans', sans-serif",
            color: filters.status ? C.text : "#94a3b8",
            background: "#fff",
            outline: "none",
            cursor: "pointer",
            appearance: "auto",
            boxSizing: "border-box",
          }}
        >
          {STATUS_OPTIONS.map(opt => (
            <option key={String(opt.value)} value={opt.value ?? ""}>{opt.label}</option>
          ))}
        </select>
        {anyFilter && (
          <button
            onClick={clearFilters}
            style={{
              padding: "8px 14px",
              background: "#fff",
              color: C.muted,
              border: `1.5px solid ${C.border}`,
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: ".4px",
            }}
          >
            <i className="pi pi-times" style={{ marginRight: 6, fontSize: 10 }} />
            Clear
          </button>
        )}
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: C.muted,
            fontWeight: 600,
          }}
        >
          {services.length} of {total} shown
        </span>
      </div>
    </div>
  );

  // ── KPI strip ────────────────────────────────────────────────
  // Horizontal grid matching the PharmacyHomePage KPI tile pattern —
  // tinted icon box on the left, big number + uppercase muted label
  // on the right. Tints come from the C palette so the strip blends
  // with the rest of the HIS.
  const statsBar = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
        marginBottom: 14,
      }}
    >
      <KpiTile label="Active Services" value={activeCount}      color={C.green} icon="pi-check-circle" />
      <KpiTile label="Auto-Charged"    value={autoChargedCount} color={C.amber} icon="pi-sync" />
      <KpiTile label="Categories"      value={categoryCount}    color={C.blue}  icon="pi-tags" />
      <KpiTile label="Total"           value={total}            color={C.text}  icon="pi-list" />
    </div>
  );

  // ── DataTable (shared across tabs) ───────────────────────────
  // pt prop styles the table header to match the HIS subtle/muted look.
  const serviceTable = (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: 8,
      boxShadow: "0 1px 3px rgba(15,23,42,.04)",
    }}>
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
          <div style={{ padding: 48, textAlign: "center", color: C.muted }}>
            <i
              className="pi pi-inbox"
              style={{ fontSize: 36, color: "#cbd5e1" }}
            />
            <div style={{ marginTop: 12, fontSize: 14, fontWeight: 600 }}>
              {anyFilter
                ? "No services match your filters."
                : "No services yet."}
            </div>
            <div style={{ marginTop: 4, fontSize: 12 }}>
              {anyFilter
                ? "Try clearing the filters above."
                : 'Click "Seed Default Data" or "+ Add Service" to get started.'}
            </div>
          </div>
        }
        pt={{
          thead: { style: { fontSize: 11 } },
          headerRow: { style: { background: C.subtle } },
        }}
        style={{ fontSize: 13 }}
      >
        <Column
          field="serviceCode"
          header="Service Code"
          body={codeBodyTemplate}
          style={{ width: 130 }}
          headerStyle={headerStyle}
          bodyStyle={cellStyle}
          sortable
        />
        <Column
          field="serviceName"
          header="Service Name"
          style={{ minWidth: 200 }}
          headerStyle={headerStyle}
          bodyStyle={cellStyle}
          sortable
        />
        <Column
          header="Category"
          body={categoryBodyTemplate}
          style={{ width: 130 }}
          headerStyle={headerStyle}
          bodyStyle={cellStyle}
          sortable
          field="category"
        />
        {/* Doctor-order type pill — placed right after Category so the
           two classification columns sit together. Muted em-dash for
           services without a doctorOrderCategory. */}
        <Column
          header="Doctor Order Type"
          body={doctorOrderBodyTemplate}
          style={{ width: 150 }}
          headerStyle={headerStyle}
          bodyStyle={cellStyle}
          sortable
          field="doctorOrderCategory"
        />
        <Column
          header="Billing Type"
          body={billingTypeBodyTemplate}
          style={{ width: 120 }}
          field="billingType"
          headerStyle={headerStyle}
          bodyStyle={cellStyle}
          sortable
        />
        <Column
          header="Default Price"
          body={priceBodyTemplate}
          style={{ width: 120 }}
          field="defaultPrice"
          headerStyle={headerStyle}
          bodyStyle={cellStyle}
          sortable
        />
        <Column
          header="Auto Charged"
          body={autoChargedBodyTemplate}
          style={{ width: 100, textAlign: "center" }}
          headerStyle={headerStyle}
          bodyStyle={{ ...cellStyle, textAlign: "center" }}
        />
        <Column
          header="Status"
          body={statusBodyTemplate}
          style={{ width: 85 }}
          field="isActive"
          headerStyle={headerStyle}
          bodyStyle={cellStyle}
          sortable
        />
        <Column
          header="Actions"
          body={actionsBodyTemplate}
          style={{ width: 120 }}
          headerStyle={{ ...headerStyle, textAlign: "right" }}
          bodyStyle={{ ...cellStyle, textAlign: "right" }}
        />
      </DataTable>
    </div>
  );

  // ── Tabs for admin-theme TabStrip ────────────────────────────
  // Map DOMAIN_TABS into the { key, label, icon } shape that TabStrip
  // expects. Keys are stringified indices so handleTabChange can keep
  // using a number internally.
  const tabStripTabs = DOMAIN_TABS.map((t, i) => ({
    key: String(i),
    label: t.label,
    icon: t.icon,
  }));

  // ────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: 20, fontFamily: "'DM Sans', sans-serif" }}>
      <Toast ref={toast} position="top-right" />
      <ConfirmDialog />

      <div style={{ maxWidth: 1600, margin: "0 auto" }}>
        {/* ── Hero ── */}
        <div style={{
          background: "linear-gradient(135deg,#d97706,#b45309)",
          borderRadius: 14, padding: "16px 22px", marginBottom: 16,
          color: "#fff", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          boxShadow: "0 4px 14px rgba(217,119,6,.25)",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.32)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="pi pi-dollar" style={{ fontSize: 22 }} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px" }}>Chargeable Services</div>
            <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>
              Domain-scoped service catalog · per-tariff pricing · auto-charge rules · GST slabs
            </div>
          </div>
          {/* CTAs sit in the Hero right slot — same pattern as the rest
              of the HIS. Seed is muted (secondary), Add Service is the
              primary white-on-amber call-to-action. */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={handleSeed}
              disabled={billing.loading}
              title="Run once to load 80+ default services"
              style={{
                padding: "8px 14px",
                background: "rgba(255,255,255,.16)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,.32)",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: billing.loading ? "not-allowed" : "pointer",
                opacity: billing.loading ? 0.6 : 1,
              }}
            >
              <i className="pi pi-database" style={{ marginRight: 6 }} />
              Seed Default Data
            </button>
            <button
              onClick={openAdd}
              style={{
                padding: "8px 14px",
                background: "#fff",
                color: C.amber,
                border: "none",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 1px 3px rgba(0,0,0,.18)",
              }}
            >
              <i className="pi pi-plus" style={{ marginRight: 6 }} />
              Add Service
            </button>
          </div>
        </div>

        {/* ── Tab strip — admin-theme pill style ── */}
        <TabStrip
          tabs={tabStripTabs}
          value={String(activeTab)}
          onChange={(k) => handleTabChange(parseInt(k, 10))}
          accent={C.amber}
          accentL={C.amberL}
        />

        {/* ── KPI strip ── */}
        {statsBar}

        {/* ── Filters ── */}
        {filterBar}

        {/* ── Services table ── */}
        {serviceTable}
      </div>

      {/* ════════════════════════════════════════
          DIALOG: Add / Edit Service
          Full HIS treatment — accent header band, three section pills
          (Identity / Pricing & Tax / Applicability), pill-styled footer
          buttons.
      ════════════════════════════════════════ */}
      <Dialog
        visible={showSvcDlg}
        style={{ width: "min(740px, 95vw)" }}
        showHeader={false}
        contentStyle={{ padding: 0, borderRadius: "0 0 14px 14px" }}
        pt={{
          root: {
            style: {
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 20px 50px rgba(0,0,0,.3)",
            },
          },
        }}
        onHide={() => {
          setShowSvcDlg(false);
          setEditSvc(null);
        }}
        modal
        draggable={false}
        footer={null}
      >
        {/* ── Accent header band ── */}
        <div
          style={{
            background: `linear-gradient(135deg,${C.amber},#b45309)`,
            padding: "14px 22px",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: 14,
            borderRadius: "14px 14px 0 0",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "rgba(255,255,255,.18)",
              border: "1.5px solid rgba(255,255,255,.32)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <i
              className={editSvc ? "pi pi-pencil" : "pi pi-plus-circle"}
              style={{ fontSize: 18 }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.2px" }}>
              {editSvc ? "Edit Service" : "Add New Service"}
            </div>
            <div style={{ fontSize: 11.5, opacity: 0.9, marginTop: 2 }}>
              {editSvc
                ? "Update service details, billing rules, and applicability"
                : "Define identity, pricing rules, and where this service applies"}
            </div>
          </div>
          <button
            onClick={() => {
              setShowSvcDlg(false);
              setEditSvc(null);
            }}
            title="Close"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "rgba(255,255,255,.16)",
              border: "1px solid rgba(255,255,255,.32)",
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <i className="pi pi-times" style={{ fontSize: 12 }} />
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: "18px 22px 4px" }}>
          {/* ── Section: Identity ── */}
          <div style={sectionPill(C.amberL, C.amber)}>
            <i
              className="pi pi-id-card"
              style={{ marginRight: 6, fontSize: 10 }}
            />
            Identity
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
              marginBottom: 16,
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
                <small style={{ color: C.muted, fontSize: 11 }}>
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

            {/* Doctor Order Type (optional) — drives which doctor-order
               bucket this service surfaces in (Pharmacy / Lab / Radiology
               / …). Leave blank for non-orderable lines (room rent,
               registration, consult fee). Placed next to Category so
               the two classification dropdowns sit together. */}
            <div style={{ gridColumn: "span 2" }}>
              <label style={labelStyle}>Doctor Order Type (optional)</label>
              <Dropdown
                value={svcForm.doctorOrderCategory}
                options={DOC_ORDER_OPTIONS}
                onChange={(e) =>
                  setSvcForm({ ...svcForm, doctorOrderCategory: e.value })
                }
                placeholder="— Not applicable —"
                showClear
                style={{ width: "100%" }}
              />
              <small style={{ color: C.muted, fontSize: 11 }}>
                Flags which doctor-order group this service belongs to. Leave blank for non-orderable lines.
              </small>
            </div>

            {/* Sub Category */}
            <div style={{ gridColumn: "span 2" }}>
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
          </div>

          {/* ── Section: Pricing & Tax ── */}
          <div style={sectionPill(C.greenL, "#15803d")}>
            <i
              className="pi pi-dollar"
              style={{ marginRight: 6, fontSize: 10 }}
            />
            Pricing & Tax
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
              marginBottom: 12,
            }}
          >
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

            {/* Billing Type */}
            <div>
              <label style={labelStyle}>Billing Type *</label>
              <Dropdown
                value={svcForm.billingType}
                options={BILLING_TYPES}
                onChange={(e) =>
                  setSvcForm({ ...svcForm, billingType: e.value })
                }
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
          </div>

          {/* Switches row — Auto-Charge + Taxable toggles wrapped in a
              tinted card so they read as a single grouped control. */}
          <div
            style={{
              background: C.subtle,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              gap: 28,
              flexWrap: "wrap",
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <InputSwitch
                checked={svcForm.isAutoCharged}
                onChange={(e) =>
                  setSvcForm({ ...svcForm, isAutoCharged: e.value })
                }
                tooltip="Auto-added daily for IPD room/nursing charges"
                tooltipOptions={{ position: "top" }}
              />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                  Auto-Charge Daily
                </div>
                <div style={{ fontSize: 10.5, color: C.muted }}>
                  Auto-added each IPD day
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <InputSwitch
                checked={svcForm.isTaxable}
                onChange={(e) =>
                  setSvcForm({ ...svcForm, isTaxable: e.value })
                }
              />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                  Taxable
                </div>
                <div style={{ fontSize: 10.5, color: C.muted }}>
                  Apply GST on this service
                </div>
              </div>
            </div>
          </div>

          {/* ── Section: Applicability ── */}
          <div style={sectionPill(C.blueL, C.blue)}>
            <i
              className="pi pi-sitemap"
              style={{ marginRight: 6, fontSize: 10 }}
            />
            Applicability
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 14,
              marginBottom: 6,
            }}
          >
            {/* Applicable To */}
            <div>
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

            {/* Description */}
            <div>
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
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            padding: "14px 22px",
            borderTop: `1px solid ${C.border}`,
            background: C.subtle,
          }}
        >
          <button
            onClick={() => {
              setShowSvcDlg(false);
              setEditSvc(null);
            }}
            style={{
              padding: "8px 16px",
              background: "#fff",
              color: C.muted,
              border: `1.5px solid ${C.border}`,
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: ".4px",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSaveService}
            disabled={billing.loading}
            style={{
              padding: "8px 16px",
              background: `linear-gradient(135deg,${C.amber},#b45309)`,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 800,
              cursor: billing.loading ? "not-allowed" : "pointer",
              opacity: billing.loading ? 0.6 : 1,
              textTransform: "uppercase",
              letterSpacing: ".4px",
              boxShadow: "0 2px 6px rgba(217,119,6,.3)",
            }}
          >
            <i className="pi pi-check" style={{ marginRight: 6 }} />
            {editSvc ? "Update Service" : "Create Service"}
          </button>
        </div>
      </Dialog>

      {/* ════════════════════════════════════════
          DIALOG: Service Pricing
          Blue-accented gradient header + HIS pill tabs + mini-card tier
          rows. CASH is implicit (auto-from defaultPrice) so the table
          only shows custom TPA / CORPORATE rows.
      ════════════════════════════════════════ */}
      <Dialog
        visible={showPriceDlg}
        style={{ width: "min(760px, 95vw)" }}
        showHeader={false}
        contentStyle={{ padding: 0, borderRadius: "0 0 14px 14px" }}
        pt={{
          root: {
            style: {
              borderRadius: 14,
              overflow: "hidden",
              boxShadow: "0 20px 50px rgba(0,0,0,.3)",
            },
          },
        }}
        onHide={() => setShowPriceDlg(false)}
        modal
        draggable={false}
        footer={null}
      >
        {/* ── Accent header band (blue → indigo) ── */}
        <div
          style={{
            background: `linear-gradient(135deg,${C.blue},#3730a3)`,
            padding: "14px 22px",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            gap: 14,
            borderRadius: "14px 14px 0 0",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "rgba(255,255,255,.18)",
              border: "1.5px solid rgba(255,255,255,.32)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <i className="pi pi-tag" style={{ fontSize: 18 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 800,
                letterSpacing: "-.2px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Pricing — {selService?.serviceName}
            </div>
            {selService && (
              <div
                style={{
                  fontSize: 11.5,
                  opacity: 0.92,
                  marginTop: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    background: "rgba(255,255,255,.18)",
                    border: "1px solid rgba(255,255,255,.32)",
                    padding: "2px 8px",
                    borderRadius: 6,
                    fontFamily: "monospace",
                    fontWeight: 700,
                  }}
                >
                  {selService.serviceCode}
                </span>
                <span>
                  Default:{" "}
                  <b>
                    ₹{(selService.defaultPrice || 0).toLocaleString("en-IN")}
                  </b>
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowPriceDlg(false)}
            title="Close"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "rgba(255,255,255,.16)",
              border: "1px solid rgba(255,255,255,.32)",
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <i className="pi pi-times" style={{ fontSize: 12 }} />
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: "16px 22px 22px" }}>
          {/* ── HIS pill tabs (replaces PrimeReact TabView) ── */}
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 16,
              borderBottom: `1px solid ${C.border}`,
              padding: "0 0 10px",
            }}
          >
            {["Current Pricing", "Set Pricing"].map((label, idx) => {
              const active = pricingTabIdx === idx;
              return (
                <button
                  key={idx}
                  onClick={() => setPricingTabIdx(idx)}
                  style={{
                    padding: "8px 16px",
                    background: active ? C.blueL : "transparent",
                    color: active ? C.blue : C.muted,
                    border: "none",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: ".4px",
                    transition: "background .12s",
                  }}
                >
                  <i
                    className={`pi ${
                      idx === 0 ? "pi-list" : "pi-plus-circle"
                    }`}
                    style={{ marginRight: 6, fontSize: 10 }}
                  />
                  {label}
                </button>
              );
            })}
          </div>

          {/* ── Tab 1: Current Pricing ── */}
          {pricingTabIdx === 0 && (
            <div>
              {/* Info banner — CASH is implicit */}
              <div
                style={{
                  background: C.greenL,
                  border: `1px solid ${C.green}33`,
                  borderRadius: 10,
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                <i
                  className="pi pi-info-circle"
                  style={{ color: "#15803d", fontSize: 16 }}
                />
                <span style={{ fontSize: 12.5, color: "#166534" }}>
                  <b>CASH pricing</b> is auto-created from the service's
                  Default Price. Custom TPA / Corporate prices show below.
                </span>
              </div>

              {/* Mini-card list — each row is a tinted dashed card with the
                  tariff pill on the left and price/discount/limit pills on
                  the right. Replaces the PrimeReact DataTable so the
                  pricing panel reads light rather than grid-y. */}
              {pricing.length === 0 ? (
                <div
                  style={{
                    padding: 36,
                    textAlign: "center",
                    color: C.muted,
                    border: `1.5px dashed ${C.border}`,
                    borderRadius: 10,
                    background: C.subtle,
                  }}
                >
                  <i
                    className="pi pi-inbox"
                    style={{ fontSize: 30, color: "#cbd5e1" }}
                  />
                  <div
                    style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}
                  >
                    No custom pricing configured.
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11.5 }}>
                    Default price is used for CASH transactions.
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {pricing.map((r, i) => {
                    const tariffColor =
                      r.tariffType === "TPA"
                        ? { bg: C.greenL, fg: "#15803d" }
                        : r.tariffType === "CORPORATE"
                        ? { bg: C.blueL, fg: C.blue }
                        : { bg: "#f1f5f9", fg: C.slate };
                    return (
                      <div
                        key={i}
                        style={{
                          border: `1.5px dashed ${C.border}`,
                          borderRadius: 10,
                          padding: "10px 14px",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          flexWrap: "wrap",
                          background: "#fff",
                        }}
                      >
                        <span style={pillStyle(tariffColor.bg, tariffColor.fg)}>
                          {r.tariffType}
                        </span>
                        <div style={{ flex: "1 1 140px", minWidth: 120 }}>
                          <div
                            style={{
                              fontSize: 12.5,
                              fontWeight: 700,
                              color: C.text,
                            }}
                          >
                            {r.tpaId?.tpaName ||
                              r.corporateName ||
                              <span style={{ color: "#cbd5e1" }}>—</span>}
                          </div>
                          {r.tpaApprovedLimit ? (
                            <div
                              style={{
                                fontSize: 10.5,
                                color: C.muted,
                                marginTop: 2,
                              }}
                            >
                              TPA Limit: ₹
                              {r.tpaApprovedLimit.toLocaleString("en-IN")}
                            </div>
                          ) : null}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              color: C.muted,
                              fontWeight: 600,
                            }}
                          >
                            Price:
                          </span>
                          <b style={{ fontSize: 13, color: C.text }}>
                            ₹{(r.price || 0).toLocaleString("en-IN")}
                          </b>
                          {r.discount > 0 && (
                            <span style={pillStyle(C.redL, C.red)}>
                              -{r.discount}%
                            </span>
                          )}
                          <span style={{ color: "#cbd5e1", margin: "0 4px" }}>
                            ›
                          </span>
                          <b style={{ fontSize: 14, color: C.blue }}>
                            ₹{(r.finalPrice || 0).toLocaleString("en-IN")}
                          </b>
                          <span
                            style={pillStyle(
                              r.isActive ? C.greenL : "#f1f5f9",
                              r.isActive ? "#15803d" : C.slate
                            )}
                          >
                            {r.isActive ? "Active" : "Inactive"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Tab 2: Set Pricing ── */}
          {pricingTabIdx === 1 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {/* Info banner */}
              <div
                style={{
                  background: C.blueL,
                  border: `1px solid ${C.blue}33`,
                  borderRadius: 10,
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <i
                  className="pi pi-check-circle"
                  style={{ color: C.blue, fontSize: 16 }}
                />
                <span style={{ fontSize: 12.5, color: "#4338ca" }}>
                  <b>CASH price auto-set</b> — only set TPA / Corporate
                  prices here. CASH tariff tracks the service's Default
                  Price.
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
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
                  <div style={{ gridColumn: "span 2" }}>
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
                    <small style={{ color: C.muted, fontSize: 11 }}>
                      TPA will not pay beyond this limit. Remaining is
                      charged to the patient.
                    </small>
                  </div>
                )}
              </div>

              {/* Final price preview */}
              <div
                style={{
                  background: `linear-gradient(135deg,${C.amberL},#fde68a40)`,
                  border: `1px solid ${C.amber}33`,
                  borderRadius: 10,
                  padding: "12px 16px",
                  fontSize: 13,
                  color: C.slate,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  <i
                    className="pi pi-calculator"
                    style={{ marginRight: 8, color: C.amber }}
                  />
                  Final price after discount
                </span>
                <b style={{ color: C.amber, fontSize: 20 }}>
                  ₹
                  {(previewFinal || 0).toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                  })}
                </b>
              </div>

              {/* Save action */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                  paddingTop: 4,
                }}
              >
                <button
                  onClick={() => setShowPriceDlg(false)}
                  style={{
                    padding: "8px 16px",
                    background: "#fff",
                    color: C.muted,
                    border: `1.5px solid ${C.border}`,
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: ".4px",
                  }}
                >
                  Close
                </button>
                <button
                  onClick={handleSavePricing}
                  disabled={billing.loading}
                  style={{
                    padding: "8px 16px",
                    background: `linear-gradient(135deg,${C.blue},#3730a3)`,
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: billing.loading ? "not-allowed" : "pointer",
                    opacity: billing.loading ? 0.6 : 1,
                    textTransform: "uppercase",
                    letterSpacing: ".4px",
                    boxShadow: "0 2px 6px rgba(79,70,229,.3)",
                  }}
                >
                  <i className="pi pi-check" style={{ marginRight: 6 }} />
                  Save Pricing
                </button>
              </div>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}

// ── Shared inline-styles ────────────────────────────────────────────

const labelStyle = {
  fontWeight: 700,
  fontSize: 11,
  display: "block",
  marginBottom: 4,
  color: "#475569",
  textTransform: "uppercase",
  letterSpacing: ".4px",
};

// Header style matches the HIS Table primitive in admin-theme — small
// uppercase muted labels on a subtle background. Padding stays tight so
// dense rows fit on screen.
const headerStyle = {
  background: "#f8fafc",
  color: "#64748b",
  fontWeight: 700,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: ".4px",
  padding: "9px 12px",
};

// Cell padding to keep rows breathable and vertically centered. Applied
// to every Column via bodyStyle so the table reads as one consistent
// rhythm regardless of column content (icons, pills, numbers, text).
const cellStyle = {
  verticalAlign: "middle",
  padding: "10px 12px",
};

// ── KPI tile primitive ──────────────────────────────────────────────
// Local copy of admin-theme's KPI shape (kept inline so the file stays
// self-contained and so we don't have to import the named export when
// every other style here is already local). Renders the icon left, big
// number top-right, uppercase muted label bottom-right.
function KpiTile({ label, value, color, icon }) {
  return (
    <div style={{
      background: "#fff",
      border: "1.5px solid #e2e8f0",
      borderRadius: 12,
      padding: "14px 16px",
      boxShadow: "0 1px 3px rgba(15,23,42,.04)",
      display: "flex",
      alignItems: "center",
      gap: 12,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: color + "12",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        <i className={`pi ${icon}`} style={{ fontSize: 15, color }} />
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
        <div style={{
          fontSize: 10.5, fontWeight: 700, color: "#64748b",
          textTransform: "uppercase", letterSpacing: ".5px", marginTop: 4,
        }}>{label}</div>
      </div>
    </div>
  );
}
