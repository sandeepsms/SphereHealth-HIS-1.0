/**
 * BillingIntelligencePage.jsx
 * AI-powered billing hub — patient bill + AI charge suggester + nurse quick-charge grid
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";

// ─── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg: "#f8fafc", card: "#ffffff", border: "#e2e8f0",
  text: "#0f172a", muted: "#64748b", slateMid: "#334155",
  primary: "#0f766e", primaryL: "#f0fdfa", primaryMid: "#0d9488",
  green: "#16a34a", greenL: "#dcfce7", greenB: "#bbf7d0",
  amber: "#d97706", amberL: "#fffbeb", amberB: "#fde68a",
  red: "#dc2626", redL: "#fef2f2", redB: "#fecaca",
  blue: "#1d4ed8", blueL: "#eff6ff", blueB: "#bfdbfe",
  purple: "#7c3aed", purpleL: "#f5f3ff", purpleB: "#ddd6fe",
  indigo: "#4f46e5", indigoL: "#eef2ff", indigoB: "#c7d2fe",
  orange: "#ea580c", orangeL: "#fff7ed", orangeB: "#fed7aa",
  pink: "#db2777", pinkL: "#fdf2f8",
  teal: "#0d9488",
};

const fld = {
  padding: "9px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8,
  fontFamily: "'DM Sans',sans-serif", fontSize: 13, color: C.text,
  outline: "none", background: "white", width: "100%", boxSizing: "border-box",
};
const lbl = {
  display: "block", fontSize: 11, fontWeight: 700, color: C.muted,
  textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 5,
};

// ─── Service type metadata ─────────────────────────────────────────────────────
const SERVICE_TYPE_META = {
  nursing:      { label: "Nursing",       icon: "pi-heart",             color: C.teal,   bg: C.primaryL  },
  investigation:{ label: "Investigation", icon: "pi-desktop",           color: C.blue,   bg: C.blueL     },
  radiology:    { label: "Radiology",     icon: "pi-eye",               color: C.purple, bg: C.purpleL   },
  procedure:    { label: "Procedure",     icon: "pi-cog",               color: C.orange, bg: C.orangeL   },
  consultation: { label: "Consultation",  icon: "pi-user",              color: C.indigo, bg: C.indigoL   },
  package:      { label: "Package",       icon: "pi-box",               color: C.green,  bg: C.greenL    },
  room:         { label: "Room / Bed",    icon: "pi-building",          color: C.amber,  bg: C.amberL    },
  ot:           { label: "OT / Surgery",  icon: "pi-plus-circle",       color: C.red,    bg: C.redL      },
  icu:          { label: "ICU",           icon: "pi-exclamation-circle",color: C.red,    bg: C.redL      },
  other:        { label: "Other",         icon: "pi-list",              color: C.muted,  bg: "#f1f5f9"   },
};

const AI_CONFIDENCE_COLOR = (c) =>
  c >= 0.8 ? C.green : c >= 0.6 ? C.amber : C.muted;

const URGENCY_COLOR = { high: C.red, medium: C.amber, low: C.green };

// ─── Toast helper ─────────────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const show = useCallback((msg, type = "success") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);
  const Toast = () => (
    <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === "error" ? C.redL : t.type === "warn" ? C.amberL : C.greenL,
          border: `1.5px solid ${t.type === "error" ? C.redB : t.type === "warn" ? C.amberB : C.greenB}`,
          color: t.type === "error" ? C.red : t.type === "warn" ? C.amber : C.green,
          borderRadius: 10, padding: "10px 16px", fontSize: 13, fontWeight: 600,
          boxShadow: "0 4px 16px rgba(0,0,0,.12)", display: "flex", alignItems: "center", gap: 8, minWidth: 260,
        }}>
          <i className={`pi ${t.type === "error" ? "pi-times-circle" : t.type === "warn" ? "pi-exclamation-triangle" : "pi-check-circle"}`} style={{ fontSize: 15 }} />
          {t.msg}
        </div>
      ))}
    </div>
  );
  return { show, Toast };
}

// ─── Section card ─────────────────────────────────────────────────────────────
function SectionCard({ icon, title, color = C.primary, badge, children, action }) {
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14, marginBottom: 16, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
      <div style={{ padding: "12px 18px", background: "#f8fafc", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 28, height: 28, borderRadius: 7, background: color + "18", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <i className={`pi ${icon}`} style={{ fontSize: 13, color }} />
          </span>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{title}</span>
          {badge !== undefined && (
            <span style={{ background: color, color: "white", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10 }}>{badge}</span>
          )}
        </div>
        {action}
      </div>
      <div style={{ padding: "16px 18px" }}>{children}</div>
    </div>
  );
}

// ─── Patient type badge ────────────────────────────────────────────────────────
const PT_STYLE = {
  OPD:       { bg: C.greenL,  color: C.green,  border: C.greenB,  icon: "pi-user"              },
  IPD:       { bg: C.blueL,   color: C.blue,   border: C.blueB,   icon: "pi-building"          },
  EMERGENCY: { bg: C.redL,    color: C.red,     border: C.redB,    icon: "pi-bolt"              },
  DAYCARE:   { bg: C.amberL,  color: C.amber,  border: C.amberB,  icon: "pi-sun"               },
};

function PatientTypeBadge({ type }) {
  const s = PT_STYLE[type] || PT_STYLE.OPD;
  return (
    <span style={{ background: s.bg, color: s.color, border: `1.5px solid ${s.border}`, padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}>
      <i className={`pi ${s.icon}`} style={{ fontSize: 10 }} />{type}
    </span>
  );
}

// ─── Service tile ─────────────────────────────────────────────────────────────
function ServiceTile({ service, selected, onToggle }) {
  const meta = SERVICE_TYPE_META[service.serviceType] || SERVICE_TYPE_META.other;
  return (
    <div
      onClick={() => onToggle(service._id)}
      style={{
        border: `1.5px solid ${selected ? meta.color : C.border}`,
        borderRadius: 10, background: selected ? meta.bg : "white",
        padding: "10px 14px", cursor: "pointer", transition: "all .15s",
        position: "relative", minWidth: 0,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = meta.color + "80"; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = C.border; }}
    >
      {selected && (
        <span style={{ position: "absolute", top: -7, right: -7, width: 18, height: 18, background: meta.color, color: "white", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <i className="pi pi-check" style={{ fontSize: 9 }} />
        </span>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
        <i className={`pi ${meta.icon}`} style={{ fontSize: 12, color: selected ? meta.color : C.muted }} />
        <span style={{ fontWeight: 700, fontSize: 12, color: selected ? meta.color : C.text, lineHeight: 1.3 }}>{service.serviceName}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: C.muted, fontFamily: "monospace" }}>{service.serviceCode}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: selected ? meta.color : C.green }}>
          ₹{(service.defaultPrice || 0).toLocaleString("en-IN")}
        </span>
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: C.muted, background: "#f1f5f9", display: "inline-block", padding: "1px 6px", borderRadius: 4 }}>
        {service.billingType?.replace(/_/g, " ")}
      </div>
    </div>
  );
}

// ─── AI Suggestion card ────────────────────────────────────────────────────────
function AISuggestionCard({ suggestion, selected, onToggle }) {
  const meta = SERVICE_TYPE_META[suggestion.category] || SERVICE_TYPE_META.other;
  const confColor = AI_CONFIDENCE_COLOR(suggestion.confidence);
  const urgColor  = URGENCY_COLOR[suggestion.urgency] || C.muted;
  return (
    <div style={{
      border: `1.5px solid ${selected ? C.primary : C.border}`,
      borderRadius: 12, background: selected ? C.primaryL : "white",
      padding: "14px 16px", cursor: "pointer", transition: "all .15s",
      position: "relative",
    }} onClick={() => onToggle(suggestion.serviceId)}>
      {/* AI badge */}
      <div style={{ position: "absolute", top: -9, left: 14, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "white", fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 6, letterSpacing: ".5px", display: "flex", alignItems: "center", gap: 4 }}>
        <i className="pi pi-sparkle" style={{ fontSize: 8 }} /> AI SUGGESTED
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginTop: 4 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: selected ? C.primary : C.text, marginBottom: 4 }}>
            {suggestion.serviceName}
          </div>
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 8 }}>
            {suggestion.reason}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, padding: "2px 8px", borderRadius: 5 }}>
              <i className={`pi ${meta.icon}`} style={{ fontSize: 9, marginRight: 3 }} />{meta.label}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: urgColor, background: urgColor + "15", padding: "2px 8px", borderRadius: 5 }}>
              {(suggestion.urgency || "low").toUpperCase()} PRIORITY
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: confColor, background: confColor + "15", padding: "2px 8px", borderRadius: 5 }}>
              {Math.round((suggestion.confidence || 0) * 100)}% MATCH
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, border: `2px solid ${selected ? C.primary : C.border}`, background: selected ? C.primary : "white", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6, transition: "all .15s" }}>
            <i className="pi pi-check" style={{ fontSize: 12, color: selected ? "white" : C.muted }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Bill item row ─────────────────────────────────────────────────────────────
function BillItemRow({ item, onRemove, billOpen }) {
  const srcColor = {
    "Nurse": C.teal, "AI-Confirmed": C.purple, "Doctor": C.blue,
    "Lab": C.green, "Radiology": C.orange, "Auto": C.amber,
  }[item.addedBySource] || C.muted;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 12, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.serviceName}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
          {item.addedBySource && (
            <span style={{ fontSize: 9, fontWeight: 700, color: srcColor, background: srcColor + "15", padding: "1px 6px", borderRadius: 4 }}>
              {item.addedBySource}
            </span>
          )}
          {item.aiSuggested && (
            <span style={{ fontSize: 9, fontWeight: 700, color: C.purple, background: C.purpleL, padding: "1px 6px", borderRadius: 4 }}>
              <i className="pi pi-sparkle" style={{ fontSize: 8, marginRight: 2 }} />AI
            </span>
          )}
          <span style={{ fontSize: 9, color: C.muted }}>×{item.quantity}</span>
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: C.green }}>₹{(item.netAmount || 0).toLocaleString("en-IN")}</div>
      </div>
      {billOpen && onRemove && (
        <button onClick={() => onRemove(item._id)} style={{ width: 26, height: 26, borderRadius: 6, border: `1.5px solid ${C.redB}`, background: C.redL, color: C.red, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="pi pi-trash" style={{ fontSize: 10 }} />
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function BillingIntelligencePage() {
  const { user } = useAuth();
  const { show: showToast, Toast } = useToast();

  // ── Patient / Bill state ──
  const [searchVal,     setSearchVal]     = useState("");
  const [patientType,   setPatientType]   = useState("IPD");
  const [patient,       setPatient]       = useState(null);
  const [admission,     setAdmission]     = useState(null);
  const [bill,          setBill]          = useState(null);
  const [loadingPt,     setLoadingPt]     = useState(false);

  // ── Nurse service catalogue ──
  const [nurseServices, setNurseServices] = useState([]);
  const [serviceTab,    setServiceTab]    = useState("nursing");
  const [selectedSvcs,  setSelectedSvcs]  = useState({}); // { serviceId: true }
  const [addingCharges, setAddingCharges] = useState(false);

  // ── AI Suggester ──
  const [diagnosis,     setDiagnosis]     = useState("");
  const [aiResult,      setAiResult]      = useState(null);
  const [aiLoading,     setAiLoading]     = useState(false);
  const [selectedAI,    setSelectedAI]    = useState({}); // { serviceId: true }
  const [confirmingAI,  setConfirmingAI]  = useState(false);

  // ── Bill actions ──
  const [generatingBill, setGeneratingBill] = useState(false);
  const [removingItem,   setRemovingItem]   = useState(null);

  const authHeader = useCallback(() => {
    const t = localStorage.getItem("his_token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  }, []);

  // ── Load nurse service catalogue ──────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(API_ENDPOINTS.BILLING_NURSE_SERVICES, {
          params: { patientType },
          headers: authHeader(),
        });
        setNurseServices(Array.isArray(data) ? data : data.data || []);
      } catch { /* silent */ }
    })();
  }, [patientType]);

  // ── Search patient + load / create bill ───────────────────────────────────
  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!searchVal.trim()) return;
    setLoadingPt(true);
    setPatient(null); setBill(null); setAdmission(null);
    setAiResult(null); setSelectedAI({}); setSelectedSvcs({});
    try {
      // 1. Try admission lookup
      const admRes = await axios.get(API_ENDPOINTS.ADMISSIONS, {
        params: { uhid: searchVal.trim(), status: "Active", limit: 1 },
        headers: authHeader(),
      });
      const admArr = Array.isArray(admRes.data) ? admRes.data : admRes.data?.data || admRes.data?.admissions || [];
      const adm = admArr[0];

      if (adm) {
        setAdmission(adm);
        const ptype = adm.admissionType === "Daycare" ? "DAYCARE" :
                      adm.admissionType === "Emergency" ? "EMERGENCY" : "IPD";
        setPatientType(ptype);
        setDiagnosis(adm.reasonForAdmission || adm.provisionalDiagnosis || "");

        // 2. Get or create draft bill
        const billRes = await axios.post(`${API_ENDPOINTS.BILLING}/create`, {
          UHID: adm.UHID || searchVal.trim(),
          visitType: ptype,
          admissionId: adm._id,
        }, { headers: authHeader() });
        setBill(billRes.data?.data || billRes.data);
        setPatient(adm.patientId || { fullName: adm.patientName, UHID: adm.UHID });
        showToast(`${adm.patientName || "Patient"} loaded — ${ptype} bill ready`);
      } else {
        // OPD fallback
        const ptRes = await axios.get(`${API_ENDPOINTS.PATIENTS}?uhid=${searchVal.trim()}`, { headers: authHeader() });
        const ptArr = Array.isArray(ptRes.data) ? ptRes.data : ptRes.data?.data || [];
        const pt = ptArr[0];
        if (!pt) { showToast("No patient found for this UHID", "error"); return; }
        setPatient(pt);
        setPatientType("OPD");
        const billRes = await axios.post(`${API_ENDPOINTS.BILLING}/create`, {
          UHID: pt.uhid || pt.UHID || searchVal.trim(),
          visitType: "OPD",
        }, { headers: authHeader() });
        setBill(billRes.data?.data || billRes.data);
        showToast(`${pt.fullName || "Patient"} loaded — OPD bill ready`);
      }
    } catch (err) {
      showToast(err?.response?.data?.message || "Failed to load patient", "error");
    } finally { setLoadingPt(false); }
  };

  // ── Refresh bill ──────────────────────────────────────────────────────────
  const refreshBill = useCallback(async () => {
    if (!bill?._id) return;
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.BILLING}/${bill._id}`, { headers: authHeader() });
      setBill(data?.data || data);
    } catch { /* silent */ }
  }, [bill?._id]);

  // ── Toggle nurse service selection ────────────────────────────────────────
  const toggleSvc = (id) => setSelectedSvcs(prev => ({ ...prev, [id]: !prev[id] }));
  const selectedSvcCount = Object.values(selectedSvcs).filter(Boolean).length;

  // ── Add selected nurse charges to bill ───────────────────────────────────
  const addNurseCharges = async () => {
    if (!bill?._id || selectedSvcCount === 0) return;
    setAddingCharges(true);
    const ids = Object.entries(selectedSvcs).filter(([, v]) => v).map(([id]) => id);
    let added = 0, failed = 0;
    for (const serviceId of ids) {
      try {
        await axios.post(`${API_ENDPOINTS.BILLING}/${bill._id}/nurse-charge`, {
          serviceId,
          quantity: 1,
          nurseName: user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
          shift: (() => { const h = new Date().getHours(); return h < 14 ? "Morning" : h < 21 ? "Evening" : "Night"; })(),
          remarks: "Added via Billing Intelligence",
        }, { headers: authHeader() });
        added++;
      } catch { failed++; }
    }
    if (added) showToast(`${added} charge(s) added to bill`);
    if (failed) showToast(`${failed} service(s) could not be added`, "warn");
    setSelectedSvcs({});
    await refreshBill();
    setAddingCharges(false);
  };

  // ── AI Scan ───────────────────────────────────────────────────────────────
  const runAIScan = async () => {
    if (!bill?._id) return;
    setAiLoading(true); setAiResult(null); setSelectedAI({});
    try {
      const { data } = await axios.post(API_ENDPOINTS.BILLING_AI_SUGGEST, {
        billId: bill._id,
        diagnosis: diagnosis || "Not specified",
        patientType,
        additionalContext: admission ? [
          `Admitted: ${admission.admissionType || patientType}`,
          admission.department ? `Dept: ${admission.department}` : "",
        ].filter(Boolean) : [],
      }, { headers: authHeader() });
      setAiResult(data?.data || data);
      const count = data?.data?.suggestions?.length || 0;
      showToast(count > 0 ? `AI found ${count} potentially missed charge(s)` : "No missed charges detected — billing looks complete!", count > 0 ? "warn" : "success");
    } catch (err) {
      showToast(err?.response?.data?.message || "AI scan failed — check server logs", "error");
    } finally { setAiLoading(false); }
  };

  // ── Toggle AI suggestion ──────────────────────────────────────────────────
  const toggleAI = (id) => setSelectedAI(prev => ({ ...prev, [id]: !prev[id] }));
  const selectedAICount = Object.values(selectedAI).filter(Boolean).length;

  // ── Confirm AI suggestions ────────────────────────────────────────────────
  const confirmAISuggestions = async () => {
    if (!bill?._id || selectedAICount === 0) return;
    setConfirmingAI(true);
    const ids = Object.entries(selectedAI).filter(([, v]) => v).map(([id]) => id);
    try {
      const { data } = await axios.post(API_ENDPOINTS.BILLING_AI_CONFIRM, {
        billId: bill._id,
        serviceIds: ids,
        confirmedBy: user?.fullName || "Staff",
      }, { headers: authHeader() });
      const saved   = (data?.data || []).filter(r => r.status === "added").length;
      const errored = (data?.data || []).filter(r => r.status === "error").length;
      if (saved)   showToast(`${saved} AI-suggested charge(s) added to bill`);
      if (errored) showToast(`${errored} charge(s) could not be added`, "warn");
      setSelectedAI({});
      setAiResult(null);
      await refreshBill();
    } catch (err) {
      showToast(err?.response?.data?.message || "Failed to confirm suggestions", "error");
    } finally { setConfirmingAI(false); }
  };

  // ── Remove bill item ──────────────────────────────────────────────────────
  const removeBillItem = async (itemId) => {
    if (!bill?._id) return;
    setRemovingItem(itemId);
    try {
      await axios.delete(`${API_ENDPOINTS.BILLING}/${bill._id}/items/${itemId}`, { headers: authHeader() });
      showToast("Item removed");
      await refreshBill();
    } catch (err) {
      showToast(err?.response?.data?.message || "Failed to remove item", "error");
    } finally { setRemovingItem(null); }
  };

  // ── Generate bill ─────────────────────────────────────────────────────────
  const generateBill = async () => {
    if (!bill?._id) return;
    setGeneratingBill(true);
    try {
      await axios.post(`${API_ENDPOINTS.BILLING}/${bill._id}/generate`, {}, { headers: authHeader() });
      showToast("Bill generated successfully");
      await refreshBill();
    } catch (err) {
      showToast(err?.response?.data?.message || "Failed to generate bill", "error");
    } finally { setGeneratingBill(false); }
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const billItems     = bill?.billItems || [];
  const billTotal     = bill?.netAmount || 0;
  const billStatus    = bill?.billStatus || "DRAFT";
  const billOpen      = ["DRAFT", "GENERATED"].includes(billStatus);
  const servicesByType= nurseServices.reduce((acc, s) => {
    const t = s.serviceType || "other";
    if (!acc[t]) acc[t] = [];
    acc[t].push(s);
    return acc;
  }, {});
  const serviceTypes  = Object.keys(servicesByType);
  const selectedAmt   = Object.entries(selectedSvcs)
    .filter(([, v]) => v)
    .reduce((sum, [id]) => sum + (nurseServices.find(s => s._id === id)?.defaultPrice || 0), 0);

  const fmtDate = () => new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'DM Sans',sans-serif" }}>
      <Toast />

      {/* ── Sticky header ── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "linear-gradient(135deg,#1e293b,#0f766e)",
        padding: "14px 28px", display: "flex", justifyContent: "space-between", alignItems: "center",
        boxShadow: "0 4px 20px rgba(15,118,110,.2)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="pi pi-bolt" style={{ fontSize: 19, color: "#fff" }} />
          </div>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 18, letterSpacing: "-.3px" }}>
              Billing Intelligence
            </div>
            <div style={{ color: "rgba(255,255,255,.65)", fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ background: "rgba(255,255,255,.15)", borderRadius: 5, padding: "1px 8px", fontSize: 10, fontWeight: 700 }}>
                <i className="pi pi-sparkle" style={{ marginRight: 4, fontSize: 9 }} />Claude AI
              </span>
              AI-powered charge detection · Nurse quick-bill · Live ledger
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {bill && (
            <div style={{ background: "rgba(255,255,255,.12)", border: "1px solid rgba(255,255,255,.2)", borderRadius: 10, padding: "6px 14px", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: billStatus === "PAID" ? C.green : billStatus === "PARTIAL" ? C.amber : "#94a3b8" }} />
              <span style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{billStatus}</span>
              <span style={{ color: "rgba(255,255,255,.5)", fontSize: 11 }}>· ₹{billTotal.toLocaleString("en-IN")}</span>
            </div>
          )}
          <div style={{ background: "rgba(255,255,255,.15)", borderRadius: 20, padding: "5px 14px", fontSize: 11, fontWeight: 700, color: "#fff" }}>
            {fmtDate()}
          </div>
        </div>
      </div>

      <div style={{ padding: "20px 24px" }}>

        {/* ── Patient Search ── */}
        <SectionCard icon="pi-search" title="Load Patient" color={C.primary}
          action={
            <div style={{ display: "flex", gap: 8 }}>
              {["OPD","IPD","EMERGENCY","DAYCARE"].map(t => (
                <button key={t} onClick={() => setPatientType(t)} style={{
                  padding: "4px 12px", borderRadius: 14, border: `1.5px solid ${patientType === t ? PT_STYLE[t].color : C.border}`,
                  background: patientType === t ? PT_STYLE[t].bg : "white", color: patientType === t ? PT_STYLE[t].color : C.muted,
                  fontWeight: patientType === t ? 700 : 500, fontSize: 11, cursor: "pointer",
                }}>{t}</button>
              ))}
            </div>
          }
        >
          <form onSubmit={handleSearch} style={{ display: "flex", gap: 10 }}>
            <input
              value={searchVal}
              onChange={e => setSearchVal(e.target.value.toUpperCase())}
              placeholder="Enter UHID or Admission No…"
              style={{ ...fld, flex: 1, fontSize: 14 }}
              autoFocus
            />
            <button type="submit" disabled={loadingPt} style={{
              padding: "10px 28px", background: `linear-gradient(135deg,${C.primary},${C.primaryMid})`,
              color: "white", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: loadingPt ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8,
              boxShadow: `0 4px 12px ${C.primary}30`, whiteSpace: "nowrap",
            }}>
              <i className={`pi ${loadingPt ? "pi-spin pi-spinner" : "pi-search"}`} style={{ fontSize: 13 }} />
              {loadingPt ? "Loading…" : "Load Patient"}
            </button>
          </form>
        </SectionCard>

        {/* ── Patient Info Strip ── */}
        {(patient || admission) && (
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "14px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg,${C.primary},${C.primaryMid})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <i className="pi pi-user" style={{ fontSize: 20, color: "white" }} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>
                  {admission?.patientName || patient?.fullName || "Patient"}
                </div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                  {admission?.UHID || patient?.uhid || searchVal}
                  {admission?.admissionNumber && ` · Adm: ${admission.admissionNumber}`}
                </div>
              </div>
              <PatientTypeBadge type={patientType} />
              {[
                admission?.wardId?.wardName && `Ward: ${admission.wardId.wardName}`,
                admission?.bedId?.bedNumber && `Bed: ${admission.bedId.bedNumber}`,
                admission?.department && `Dept: ${admission.department}`,
              ].filter(Boolean).map(v => (
                <span key={v} style={{ fontSize: 11, color: C.muted, background: "#f1f5f9", padding: "4px 10px", borderRadius: 8 }}>{v}</span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => { setPatient(null); setAdmission(null); setBill(null); setAiResult(null); setSearchVal(""); setSelectedSvcs({}); setSelectedAI({}); }} style={{
                padding: "7px 14px", border: `1.5px solid ${C.border}`, borderRadius: 8, background: "white",
                fontSize: 12, fontWeight: 600, cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", gap: 5,
              }}>
                <i className="pi pi-times" style={{ fontSize: 11 }} /> Clear
              </button>
            </div>
          </div>
        )}

        {/* ── Main two-column layout ── */}
        {bill && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, alignItems: "start" }}>

            {/* ══════ LEFT COLUMN ══════ */}
            <div>

              {/* ── AI Charge Suggester ── */}
              <SectionCard
                icon="pi-sparkle"
                title="AI Charge Suggester"
                color={C.purple}
                badge={aiResult?.suggestions?.length || undefined}
                action={
                  <button onClick={runAIScan} disabled={aiLoading || !bill} style={{
                    padding: "7px 18px", background: aiLoading ? "#f5f3ff" : `linear-gradient(135deg,#7c3aed,#4f46e5)`,
                    color: aiLoading ? C.purple : "white", border: `1.5px solid ${C.purple}`,
                    borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: aiLoading ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", gap: 7, boxShadow: aiLoading ? "none" : "0 4px 12px rgba(124,58,237,.25)",
                  }}>
                    <i className={`pi ${aiLoading ? "pi-spin pi-spinner" : "pi-sparkle"}`} style={{ fontSize: 12 }} />
                    {aiLoading ? "Scanning…" : "AI Scan Bill"}
                  </button>
                }
              >
                {/* Diagnosis input */}
                <div style={{ marginBottom: 14 }}>
                  <label style={lbl}>Diagnosis / Reason for Admission <span style={{ color: C.muted, textTransform: "none", fontWeight: 400 }}>(AI reads this)</span></label>
                  <input
                    value={diagnosis}
                    onChange={e => setDiagnosis(e.target.value)}
                    placeholder="e.g. Type 2 Diabetes Mellitus with poor glycemic control, Hypertension…"
                    style={{ ...fld, fontStyle: diagnosis ? "normal" : "italic" }}
                  />
                </div>

                {/* Pre-scan placeholder */}
                {!aiResult && !aiLoading && (
                  <div style={{ textAlign: "center", padding: "28px 0", background: "#f8fafc", borderRadius: 10, border: `1.5px dashed ${C.purpleB}` }}>
                    <div style={{ width: 52, height: 52, borderRadius: 14, background: C.purpleL, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                      <i className="pi pi-sparkle" style={{ fontSize: 24, color: C.purple }} />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.slateMid, marginBottom: 6 }}>Claude AI Billing Assistant</div>
                    <div style={{ fontSize: 12, color: C.muted, maxWidth: 340, margin: "0 auto" }}>
                      Enter the patient's diagnosis above and click <strong>AI Scan Bill</strong>. Claude will analyse the current bill + diagnosis and identify potentially missed charges.
                    </div>
                  </div>
                )}

                {/* AI loading */}
                {aiLoading && (
                  <div style={{ textAlign: "center", padding: "32px 0" }}>
                    <div style={{ width: 44, height: 44, borderRadius: "50%", border: `3px solid ${C.purpleB}`, borderTopColor: C.purple, animation: "spin 1s linear infinite", margin: "0 auto 12px" }} />
                    <div style={{ fontSize: 13, color: C.muted }}>Claude is analysing the bill…</div>
                    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  </div>
                )}

                {/* AI results */}
                {aiResult && !aiLoading && (
                  <>
                    {/* Summary bar */}
                    <div style={{ background: C.purpleL, border: `1.5px solid ${C.purpleB}`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
                      <i className="pi pi-info-circle" style={{ color: C.purple, fontSize: 14 }} />
                      <span style={{ fontSize: 12, color: C.slateMid }}><strong>AI Summary:</strong> {aiResult.summary || "Scan complete."}</span>
                      <span style={{ marginLeft: "auto", fontSize: 10, color: C.muted }}>
                        Scanned {aiResult.scannedServiceCount} services · {aiResult.currentItemCount} already billed
                      </span>
                    </div>

                    {aiResult.suggestions?.length === 0 ? (
                      <div style={{ textAlign: "center", padding: "20px 0", color: C.green }}>
                        <i className="pi pi-check-circle" style={{ fontSize: 28, display: "block", marginBottom: 8 }} />
                        <div style={{ fontWeight: 700, fontSize: 14 }}>Bill looks complete!</div>
                        <div style={{ fontSize: 12, color: C.muted }}>No missed charges detected for this diagnosis.</div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
                          {aiResult.suggestions.map(s => (
                            <AISuggestionCard
                              key={s.serviceId}
                              suggestion={s}
                              selected={!!selectedAI[s.serviceId]}
                              onToggle={toggleAI}
                            />
                          ))}
                        </div>
                        {selectedAICount > 0 && (
                          <button onClick={confirmAISuggestions} disabled={confirmingAI} style={{
                            width: "100%", padding: "11px 0", background: `linear-gradient(135deg,#7c3aed,#4f46e5)`,
                            color: "white", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700,
                            cursor: confirmingAI ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                            boxShadow: "0 4px 16px rgba(124,58,237,.3)", opacity: confirmingAI ? .8 : 1,
                          }}>
                            <i className={`pi ${confirmingAI ? "pi-spin pi-spinner" : "pi-check"}`} style={{ fontSize: 13 }} />
                            {confirmingAI ? "Adding…" : `Add ${selectedAICount} AI Suggestion${selectedAICount > 1 ? "s" : ""} to Bill`}
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
              </SectionCard>

              {/* ── Nurse Quick-Charge Grid ── */}
              <SectionCard
                icon="pi-th-large"
                title="Quick Charge — Add to Bill"
                color={C.teal}
                badge={selectedSvcCount > 0 ? selectedSvcCount : undefined}
                action={selectedSvcCount > 0 && (
                  <button onClick={addNurseCharges} disabled={addingCharges} style={{
                    padding: "7px 18px", background: addingCharges ? C.primaryL : `linear-gradient(135deg,${C.primary},${C.primaryMid})`,
                    color: addingCharges ? C.primary : "white", border: `1.5px solid ${C.primary}`,
                    borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: addingCharges ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", gap: 7, boxShadow: `0 4px 12px ${C.primary}25`,
                  }}>
                    <i className={`pi ${addingCharges ? "pi-spin pi-spinner" : "pi-plus"}`} style={{ fontSize: 12 }} />
                    {addingCharges ? "Adding…" : `Add ${selectedSvcCount} · ₹${selectedAmt.toLocaleString("en-IN")}`}
                  </button>
                )}
              >
                {/* Type tabs */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
                  {serviceTypes.map(t => {
                    const meta = SERVICE_TYPE_META[t] || SERVICE_TYPE_META.other;
                    const isActive = serviceTab === t;
                    return (
                      <button key={t} onClick={() => setServiceTab(t)} style={{
                        padding: "6px 14px", borderRadius: 20,
                        border: `1.5px solid ${isActive ? meta.color : C.border}`,
                        background: isActive ? meta.bg : "white",
                        color: isActive ? meta.color : C.muted,
                        fontWeight: isActive ? 700 : 500, fontSize: 12, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 5,
                      }}>
                        <i className={`pi ${meta.icon}`} style={{ fontSize: 11 }} />
                        {meta.label}
                        <span style={{ fontSize: 10, background: isActive ? meta.color + "20" : "#f1f5f9", color: isActive ? meta.color : C.muted, padding: "0 5px", borderRadius: 6 }}>
                          {servicesByType[t]?.length || 0}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Service tiles */}
                {serviceTypes.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 0", color: C.muted }}>
                    <i className="pi pi-inbox" style={{ fontSize: 28, display: "block", marginBottom: 10, opacity: .4 }} />
                    <div style={{ fontSize: 13, fontWeight: 600 }}>No chargeable services loaded</div>
                    <div style={{ fontSize: 12, marginTop: 4 }}>Run the service seed script or add services via Service Master</div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                    {(servicesByType[serviceTab] || []).map(s => (
                      <ServiceTile
                        key={s._id}
                        service={s}
                        selected={!!selectedSvcs[s._id]}
                        onToggle={toggleSvc}
                      />
                    ))}
                    {(servicesByType[serviceTab] || []).length === 0 && (
                      <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "24px 0", color: C.muted, fontSize: 13 }}>
                        No {SERVICE_TYPE_META[serviceTab]?.label || serviceTab} services available for {patientType}
                      </div>
                    )}
                  </div>
                )}
              </SectionCard>
            </div>

            {/* ══════ RIGHT COLUMN — Live Bill Panel ══════ */}
            <div style={{ position: "sticky", top: 88 }}>

              {/* Bill status header */}
              <div style={{
                background: billStatus === "PAID" ? `linear-gradient(135deg,${C.green},#15803d)` :
                            billStatus === "PARTIAL" ? `linear-gradient(135deg,${C.amber},#b45309)` :
                            `linear-gradient(135deg,${C.slateMid},#0f172a)`,
                borderRadius: "14px 14px 0 0", padding: "14px 18px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <i className="pi pi-receipt" style={{ fontSize: 16, color: "white" }} />
                  <div>
                    <div style={{ color: "white", fontWeight: 700, fontSize: 14 }}>Live Bill</div>
                    <div style={{ color: "rgba(255,255,255,.65)", fontSize: 11 }}>{bill.billNumber || "Draft"} · {billStatus}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "white", fontWeight: 800, fontSize: 20 }}>₹{billTotal.toLocaleString("en-IN")}</div>
                  <div style={{ color: "rgba(255,255,255,.65)", fontSize: 10 }}>{billItems.length} item{billItems.length !== 1 ? "s" : ""}</div>
                </div>
              </div>

              {/* Bill items */}
              <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 14px 14px", padding: "16px 18px", maxHeight: "55vh", overflowY: "auto" }}>
                {billItems.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 0", color: C.muted }}>
                    <i className="pi pi-inbox" style={{ fontSize: 28, display: "block", marginBottom: 10, opacity: .4 }} />
                    <div style={{ fontSize: 12 }}>No items yet — add charges using the panels on the left</div>
                  </div>
                ) : (
                  billItems.map(item => (
                    <BillItemRow
                      key={item._id}
                      item={item}
                      billOpen={billOpen}
                      onRemove={removingItem === item._id ? null : () => removeBillItem(item._id)}
                    />
                  ))
                )}
              </div>

              {/* Totals panel */}
              <div style={{ background: "#f8fafc", border: `1.5px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 0 0", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { label: "Gross Amount",    value: bill.grossAmount     || 0 },
                  { label: "Discount",        value: bill.totalDiscount   || 0, neg: true },
                  { label: "Tax",             value: bill.taxAmount       || 0 },
                ].map(r => r.value !== 0 && (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted }}>
                    <span>{r.label}</span>
                    <span style={{ color: r.neg ? C.red : C.text }}>{r.neg ? "−" : ""}₹{r.value.toLocaleString("en-IN")}</span>
                  </div>
                ))}
                <div style={{ height: 1, background: C.border }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 800, color: C.text }}>
                  <span>Net Payable</span>
                  <span style={{ color: C.green }}>₹{billTotal.toLocaleString("en-IN")}</span>
                </div>
                {(bill.advancePaid || 0) > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted }}>
                    <span>Balance</span>
                    <span style={{ color: (bill.balanceAmount || 0) > 0 ? C.red : C.green }}>
                      ₹{(bill.balanceAmount || 0).toLocaleString("en-IN")}
                    </span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {billStatus === "DRAFT" && (
                  <button onClick={generateBill} disabled={generatingBill || billItems.length === 0} style={{
                    width: "100%", padding: "12px 0", background: billItems.length === 0 ? "#f1f5f9" : `linear-gradient(135deg,${C.primary},${C.primaryMid})`,
                    color: billItems.length === 0 ? C.muted : "white", border: "none", borderRadius: 10,
                    fontSize: 13, fontWeight: 700, cursor: billItems.length === 0 ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    boxShadow: billItems.length === 0 ? "none" : `0 4px 16px ${C.primary}30`,
                  }}>
                    <i className={`pi ${generatingBill ? "pi-spin pi-spinner" : "pi-file-check"}`} style={{ fontSize: 13 }} />
                    {generatingBill ? "Generating…" : "Generate Bill"}
                  </button>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={refreshBill}
                    style={{
                      flex: 1, padding: "9px 0", border: `1.5px solid ${C.border}`,
                      borderRadius: 9, background: "white", fontSize: 12, fontWeight: 600,
                      cursor: "pointer", color: C.muted, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    }}>
                    <i className="pi pi-refresh" style={{ fontSize: 11 }} /> Refresh
                  </button>
                  <button
                    onClick={() => window.open(`/billing/view/${bill._id}`, "_blank")}
                    style={{
                      flex: 1, padding: "9px 0", border: `1.5px solid ${C.indigoB}`,
                      borderRadius: 9, background: C.indigoL, fontSize: 12, fontWeight: 600,
                      cursor: "pointer", color: C.indigo, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    }}>
                    <i className="pi pi-external-link" style={{ fontSize: 11 }} /> Full Bill
                  </button>
                </div>
              </div>

              {/* AI + Source legend */}
              <div style={{ marginTop: 14, background: "#f8fafc", border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 8 }}>Charge Sources</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {[
                    { label: "Doctor",       color: C.blue   },
                    { label: "Nurse",        color: C.teal   },
                    { label: "AI-Confirmed", color: C.purple },
                    { label: "Lab",          color: C.green  },
                    { label: "Radiology",    color: C.orange },
                    { label: "Auto",         color: C.amber  },
                  ].map(s => (
                    <span key={s.label} style={{ fontSize: 10, fontWeight: 600, color: s.color, background: s.color + "15", padding: "2px 8px", borderRadius: 5 }}>
                      {s.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Empty state (no patient loaded) ── */}
        {!bill && !loadingPt && (
          <div style={{ textAlign: "center", padding: "60px 24px" }}>
            <div style={{
              width: 80, height: 80, borderRadius: 20,
              background: `linear-gradient(135deg,${C.primary},${C.primaryMid})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 20px", boxShadow: `0 8px 24px ${C.primary}30`,
            }}>
              <i className="pi pi-bolt" style={{ fontSize: 36, color: "white" }} />
            </div>
            <div style={{ fontWeight: 800, fontSize: 22, color: C.slateMid, marginBottom: 8 }}>AI Billing Intelligence</div>
            <div style={{ fontSize: 14, color: C.muted, maxWidth: 480, margin: "0 auto 32px" }}>
              Search for a patient by UHID above. The system will load their open bill, fetch nurse-chargeable services,
              and let Claude AI scan for missed charges based on the patient's diagnosis.
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
              {[
                { icon: "pi-sparkle",   color: C.purple, title: "Claude AI Scan",      desc: "Reads diagnosis + bill → finds missed charges" },
                { icon: "pi-th-large",  color: C.teal,   title: "Quick Charge Grid",   desc: "Nurses add investigations, procedures, devices" },
                { icon: "pi-receipt",   color: C.indigo, title: "Live Bill Ledger",     desc: "Real-time bill with source tracking per item" },
              ].map(f => (
                <div key={f.title} style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: "20px 24px", maxWidth: 200, textAlign: "left", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: f.color + "18", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                    <i className={`pi ${f.icon}`} style={{ fontSize: 18, color: f.color }} />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 5 }}>{f.title}</div>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
