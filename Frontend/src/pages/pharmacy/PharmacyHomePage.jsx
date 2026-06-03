/**
 * PharmacyHomePage.jsx
 *
 * Single-page pharmacy module with 6 tabs:
 *   Dashboard · Drugs · Inventory · GRN · Dispense · Sales · Suppliers
 *
 * Theme matches the rest of the HIS: gradient hero, KPI strip,
 * sectioned cards, his-field inputs, tight modals.
 */
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import "../../Components/clinical/clinical-forms.css";
import { toast } from "react-toastify";
import { API_ENDPOINTS } from "../../config/api";
import { openPrint } from "../../Components/print/openPrint";
import { TabStrip } from "../../Components/admin-theme";
import { useAuth } from "../../context/AuthContext";
import TEMPLATES from "../../Components/print/printables/PharmacyBillTemplates";
import PharmacyBill from "../../Components/print/printables/PharmacyBill";
import PharmacyRegister, { REGISTER_HEADERS } from "../../Components/print/printables/PharmacyRegister";
import PharmacyIndentsPage from "./PharmacyIndentsPage";
import opdService from "../../Services/patient/opdService";
import { IS_PHARMACY_STANDALONE, PHARMACY_MODE_LABEL } from "../../config/pharmacyMode";
import {
  listDrugs, createDrug, updateDrug, deleteDrug,
  listSuppliers, createSupplier, updateSupplier, deleteSupplier,
  recordGRN, listBatches, stockRollup,
  dispense, listSales, cancelSale, returnSaleItems, addItemsToSale,
  getStats, getAlerts,
  getPharmacySettings, updatePharmacySettings,
  getSalesRegister, getPurchaseRegister, getStockRegister,
  getScheduleHRegister, getExpiryRegister, getGstSummary,
  DRUG_FORMS, DRUG_CATEGORIES, PAYMENT_MODES, SALE_TYPES,
} from "../../Services/pharmacyService";
import { confirm } from "../../Components/common/ConfirmDialog";
import { useVisiblePoll, useDebounce } from "../../utils/pollingHelpers";

/* HIS UHID bridge — call this with a UHID and get back a normalised
   { patientId, patientName, age, gender, contact, doctorName, admissionId,
     saleType }. Tries the active-admission endpoint first (so IPD bills
     can link back to the admission); if that returns nothing, falls back
     to the patient-master lookup. */
async function lookupHisPatient(uhid) {
  if (!uhid || !uhid.trim()) return null;
  const token = (sessionStorage.getItem("his_token"));
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const r = await axios.get(`${API_ENDPOINTS.BASE}/admissions/active?UHID=${encodeURIComponent(uhid.trim())}`, { headers });
    const list = Array.isArray(r.data) ? r.data : r.data?.data || [];
    const adm = list[0];
    if (adm) {
      const pat = adm.patientId && typeof adm.patientId === "object" ? adm.patientId : null;
      return {
        patientUHID:  adm.UHID,
        patientName:  adm.patientName || pat?.fullName || "",
        age:          pat?.age || "",
        gender:       pat?.gender || adm.gender || "",
        contactNumber:pat?.contactNumber || pat?.phone || adm.contactNumber || "",
        doctorName:   adm.attendingDoctor || "",
        admissionId:  adm._id,
        admissionNumber: adm.admissionNumber,
        saleType:     adm.admissionType === "OPD" ? "OPD" : "IPD",
        source:       "admission",
      };
    }
  } catch (_) { /* try patient master next */ }
  try {
    const r = await axios.get(`${API_ENDPOINTS.BASE}/patients/uhid/${encodeURIComponent(uhid.trim())}`, { headers });
    const pat = r.data?.data || r.data;
    if (pat && (pat.UHID || pat._id)) {
      return {
        patientUHID:  pat.UHID || uhid.trim(),
        patientName:  pat.fullName || pat.patientName || "",
        age:          pat.age || "",
        gender:       pat.gender || "",
        contactNumber:pat.contactNumber || pat.phone || "",
        doctorName:   "",
        admissionId:  null,
        saleType:     "OPD",
        source:       "patient",
      };
    }
  } catch (_) {}
  return null;
}

const C = {
  bg: "#f8fafc", card: "#fff", border: "#e2e8f0",
  text: "#0f172a", muted: "#64748b", subtle: "#f8fafc",
  amber: "#d97706", amberL: "#fffbeb",
  blue: "#1d4ed8", blueL: "#eff6ff",
  green: "#16a34a", greenL: "#dcfce7",
  red: "#dc2626", redL: "#fef2f2",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  pink: "#db2777", pinkL: "#fdf2f8",
  teal: "#0d9488", tealL: "#f0fdfa",
  orange: "#ea580c", orangeL: "#fff7ed",
  slate: "#475569",
};

// Static tab skeleton — the Live Indents tab gets its `badge` + `badgeTone`
// computed at render time from a poll of the open-indents queue (see
// useLiveIndentStats below). Lives inside the Pharmacy tab strip (rather
// than the sidebar) so the pharmacist sees it next to Dispense + Sales —
// their primary surface.
const BASE_TABS = [
  { key: "dashboard", label: "Dashboard",  icon: "pi-th-large" },
  { key: "drugs",     label: "Drug Master",icon: "pi-list" },
  { key: "inventory", label: "Inventory",  icon: "pi-box" },
  { key: "grn",       label: "Goods Receipt", icon: "pi-download" },
  { key: "dispense",  label: "Dispense",   icon: "pi-shopping-cart" },
  // R7cr — OPD Rx Lookup: pharmacist enters a UHID, sees today's
  // doctor-written prescriptions for that patient (diagnosis +
  // medicines + dose + frequency + meal status) and dispenses each
  // line with one click. Avoids re-typing the drug list off a paper
  // prescription and prevents transcription errors.
  { key: "opdrx",     label: "OPD Rx",     icon: "pi-file" },
  // R7cu — IPD Credit Ledger: pharmacist sees every active IPD admission
  // with pharmacy outstanding > 0, drills in to collect payment. The
  // discharge flow is HARD-blocked at the backend until this clears.
  { key: "ipdcredit", label: "IPD Credit", icon: "pi-credit-card" },
  { key: "indents",   label: "Live Indents", icon: "pi-inbox" }, // badge + tone wired dynamically
  { key: "sales",     label: "Sales Register", icon: "pi-receipt" },
  { key: "registers", label: "Registers",  icon: "pi-book" },
  { key: "suppliers", label: "Suppliers",  icon: "pi-truck" },
  { key: "settings",  label: "Settings",   icon: "pi-cog" },
];

// R7da — Decimal128-aware. listSales / listDrugs / batches etc. all use
// `.lean()` server-side, which bypasses the model's toJSON transform —
// so Decimal128 money fields arrive as either `{$numberDecimal:"320"}`
// (extended JSON) or raw Decimal128 BSON objects. Number(d128) → NaN
// in either case, which surfaced as "₹NaN" in the Sales Register row.
// This helper unwraps both shapes before formatting.
const _toNumDec = (v) => {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "object") {
    if (v.$numberDecimal != null) {
      const n = Number(v.$numberDecimal); return Number.isFinite(n) ? n : 0;
    }
    if (typeof v.toString === "function") {
      const n = Number(v.toString()); return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }
  const n = Number(v); return Number.isFinite(n) ? n : 0;
};
const fmtINR = (n) => `₹${_toNumDec(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const daysUntil = (d) => d ? Math.floor((new Date(d).getTime() - Date.now()) / 86400000) : null;

/* ─── Live Indents poll ──────────────────────────────────────────────────
   Drives the Live Indents tab's badge text + tone. Polled at 15 s — slower
   than PharmacyIndentsPage's own 10 s queue refresh because we only need
   counts here, not row-level freshness.

   Tone matrix:
     • STAT count > 0           → "urgent" (red + soft pulse, label = STAT count)
     • Urgent count > 0 (no STAT) → "warn"   (amber, label = open count)
     • Open count > 0            → "normal" (blue, label = open count)
     • No open indents           → "idle"   (green, label = "LIVE" — always shown)

   The pill is ALWAYS rendered (idle is green and calm, not absent) so the
   pharmacist always knows the queue is being watched, per the user spec
   "always resonant, different colour code per situation". */
function useLiveIndentStats(pollMs = 15000) {
  const [stats, setStats] = useState({ open: 0, stat: 0, urgent: 0 });

  // R7bh-F9 / R7bg-9-HIGH-4 — visibility-gated. When the pharmacist
  // tabs away to Dispense, the badge poll pauses and resumes on
  // return. Drops ~240 background requests/hour per idle tab.
  const fetchStats = React.useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_ENDPOINTS.BASE}/indents?openOnly=true`);
      const list = Array.isArray(data?.data) ? data.data : [];
      const stat    = list.filter(i => i.urgency === "STAT").length;
      const urgent  = list.filter(i => i.urgency === "Urgent").length;
      setStats({ open: list.length, stat, urgent });
    } catch (_) {
      // Non-fatal — keep the last-known counts. The dedicated
      // PharmacyIndentsPage will surface its own error toast if needed.
    }
  }, []);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useVisiblePoll(fetchStats, pollMs, []);

  return stats;
}

// Pure helper: given the indent stats, decide badge label + tone for the
// Live Indents tab. Exported-style helper so the matrix is easy to test +
// adjust without touching the polling logic.
function indentBadgeFor(stats) {
  if (!stats || (stats.open === 0 && stats.stat === 0 && stats.urgent === 0)) {
    return { badge: "LIVE", badgeTone: "idle" };           // green — all clear
  }
  if (stats.stat > 0) {
    return { badge: String(stats.stat), badgeTone: "urgent" }; // red + pulse
  }
  if (stats.urgent > 0) {
    return { badge: String(stats.open), badgeTone: "warn" };   // amber
  }
  return { badge: String(stats.open), badgeTone: "normal" };   // blue
}

export default function PharmacyHomePage() {
  const [tab, setTab] = useState("dashboard");

  // Poll open indents and recompute the Live Indents tab badge/tone every
  // render. useMemo keeps the array reference stable when counts haven't
  // changed so TabStrip doesn't re-mount its buttons unnecessarily.
  const indentStats = useLiveIndentStats();
  const tabs = useMemo(() => {
    const { badge, badgeTone } = indentBadgeFor(indentStats);
    // R7cs — Standalone mode: hide tabs that depend on hospital state.
    //   • "opdrx" — needs OPD visits + doctor prescriptions
    //   • "indents" — needs IPD admissions + nurse workflow
    // These collections don't exist (or are empty) in a retail-pharmacy
    // deployment. Hiding the tab is the first guard; the second guard is
    // the backend, which 404s the underlying routes when PHARMACY_MODE
    // === standalone so a leaked token can't reach them either.
    // R7cu — IPD Credit also depends on hospital admission collections,
    // so it's hidden in standalone retail mode alongside opdrx/indents.
    const filtered = IS_PHARMACY_STANDALONE
      ? BASE_TABS.filter(t => t.key !== "opdrx" && t.key !== "indents" && t.key !== "ipdcredit")
      : BASE_TABS;
    return filtered.map(t =>
      t.key === "indents" ? { ...t, badge, badgeTone } : t
    );
  }, [indentStats]);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: 20, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>

        {/* Hero */}
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
            <i className="pi pi-box" style={{ fontSize: 22 }} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px" }}>
              Pharmacy
              {/* R7cs — deployment-shape badge so the user always knows
                  whether they're in Hospital or Retail Pharmacy mode.
                  Retail hides indents + OPD-Rx + UHID lookup. */}
              {IS_PHARMACY_STANDALONE && (
                <span style={{
                  marginLeft: 10, padding: "2px 9px", borderRadius: 10,
                  fontSize: 10, fontWeight: 700, letterSpacing: ".4px",
                  background: "rgba(255,255,255,.22)", border: "1px solid rgba(255,255,255,.35)",
                  textTransform: "uppercase", verticalAlign: "middle",
                }}>{PHARMACY_MODE_LABEL}</span>
              )}
            </div>
            <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>
              {IS_PHARMACY_STANDALONE
                ? "Drug master · batch inventory · GRN · counter dispense · sales register"
                : "Drug master · batch inventory · GRN · dispense · sales register"}
            </div>
          </div>
        </div>

        {/* Tab strip — shared admin TabStrip for design consistency.
            The Live Indents tab carries a dynamic badge + tone so the
            pharmacist can spot STAT/urgent work from any other tab. */}
        <TabStrip tabs={tabs} value={tab} onChange={setTab} accent={C.orange} accentL={C.orangeL} />

        {/* Tab body */}
        {tab === "dashboard" && <DashboardTab />}
        {tab === "drugs"     && <DrugsTab />}
        {tab === "inventory" && <InventoryTab />}
        {tab === "grn"       && <GRNTab />}
        {tab === "dispense"  && <DispenseTab />}
        {tab === "opdrx"     && <OPDRxTab />}
        {tab === "ipdcredit" && <IPDCreditTab />}
        {tab === "indents"   && <PharmacyIndentsPage embedded />}
        {tab === "sales"     && <SalesTab />}
        {tab === "registers" && <RegistersTab />}
        {tab === "suppliers" && <SuppliersTab />}
        {tab === "settings"  && <SettingsTab />}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   DASHBOARD TAB
══════════════════════════════════════════════════════════════════ */
function DashboardTab() {
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState({ lowStock: [], outOfStock: [], expiringSoon: [], expired: [] });

  const refresh = async () => {
    try {
      const [s, a] = await Promise.all([getStats(), getAlerts()]);
      setStats(s.data); setAlerts(a.data);
    } catch (e) { toast.error(e.message); }
  };
  useEffect(() => { refresh(); }, []);

  // R7bd-E-8 / A2-MED-7 — clicking the Low Stock KPI tile scrolls down
  // to the corresponding alert section (which already lists each drug
  // + on-hand + reorder level). We don't duplicate the table here.
  const scrollToLowStock = () => {
    const el = document.getElementById("pharmacy-low-stock-section");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Aggregate count from the alerts payload — backend endpoint already
  // returns the de-duplicated set so we just len() it.
  const lowStockCount = (alerts.lowStock || []).length + (alerts.outOfStock || []).length;

  return (
    <div>
      {/* KPI strip */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
          <KPI label="Drugs catalogued"   value={stats.drugsCount}                  color={C.text}    icon="pi-list" />
          <KPI label="Active batches"     value={stats.batchesInStock}              color={C.blue}    icon="pi-box" />
          <KPI label="Stock value"        value={fmtINR(stats.stockValue)}          color={C.green}   icon="pi-indian-rupee" />
          {/* R7bd-E-8 / A2-MED-7 — Low Stock KPI tile. Surfaces count
              from /pharmacy/alerts (lowStock + outOfStock). Click
              scrolls to the expanded list below. Tooltip-only — no
              ward filter wired yet (deferred). */}
          <div onClick={lowStockCount ? scrollToLowStock : undefined}
            style={{ cursor: lowStockCount ? "pointer" : "default" }}
            title={lowStockCount ? "Click to expand the low-stock list" : "All drugs above reorder level"}>
            <KPI label="Low stock"          value={lowStockCount}                     color={C.amber}   icon="pi-bell" />
          </div>
          <KPI label="Expiring 90d"       value={stats.expiringWithin90Days}        color={C.amber}   icon="pi-clock" />
          <KPI label="Already expired"    value={stats.alreadyExpired}              color={C.red}     icon="pi-exclamation-triangle" />
          <KPI label="Today sales"        value={`${stats.todaySales.count} · ${fmtINR(stats.todaySales.total)}`} color={C.purple} icon="pi-receipt" />
        </div>
      )}

      {/* Alert sections */}
      {/* R7bd-E-8: anchor id so the KPI tile can scroll to this section. */}
      <div id="pharmacy-low-stock-section">
        <AlertSection title="Low stock — at or below reorder level" color={C.amber}
          empty="All drugs above reorder level."
          rows={alerts.lowStock} cols={[["drugName","Drug",2],["totalRemaining","On hand",1],["reorderLevel","Reorder at",1]]} />
      </div>

      <AlertSection title="Out of stock" color={C.red}
        empty="No drugs out of stock."
        rows={alerts.outOfStock} cols={[["drugName","Drug",2],["reorderLevel","Reorder at",1]]} />

      <AlertSection title="Expiring in next 90 days" color={C.amber}
        empty="No batches expiring in the next 90 days."
        rows={alerts.expiringSoon.map(b => ({
          ...b,
          expiryStr: `${fmtDate(b.expiryDate)} · ${daysUntil(b.expiryDate)}d left`,
        }))}
        cols={[["drugName","Drug",2],["batchNo","Batch",1],["remaining","Qty",1],["expiryStr","Expires",2]]} />

      <AlertSection title="Already expired — quarantine + discard" color={C.red}
        empty="No expired stock."
        rows={alerts.expired.map(b => ({ ...b, expiryStr: fmtDate(b.expiryDate) }))}
        cols={[["drugName","Drug",2],["batchNo","Batch",1],["remaining","Qty",1],["expiryStr","Expired",2]]} />
    </div>
  );
}

function AlertSection({ title, color, rows, cols, empty }) {
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, marginBottom: 14, overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", background: `${color}08`, borderBottom: `1px solid ${color}20`, display: "flex", alignItems: "center", gap: 8 }}>
        <i className="pi pi-exclamation-circle" style={{ color, fontSize: 13 }} />
        <span style={{ fontWeight: 800, fontSize: 13, color }}>{title}</span>
        <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 4, background: `${color}15`, color, fontSize: 10.5, fontWeight: 800 }}>{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: "18px 16px", textAlign: "center", color: C.muted, fontSize: 12, fontStyle: "italic" }}>{empty}</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: C.subtle }}>
            {cols.map(([_, h]) => <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 800, fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.slice(0, 25).map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                {cols.map(([k]) => <td key={k} style={{ padding: "8px 12px" }}>{r[k]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   DRUGS TAB — master CRUD
══════════════════════════════════════════════════════════════════ */
function DrugsTab() {
  const [drugs, setDrugs] = useState([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [edit, setEdit] = useState(null);
  const [adding, setAdding] = useState(false);
  // R7bh-F9 / R7bg-4-HIGH-1 — debounce the search box so we only hit
  // /pharmacy/drugs after the pharmacist pauses typing (300 ms).
  const debouncedQ = useDebounce(q, 300);

  const refresh = async (signal) => {
    try { setDrugs((await listDrugs({ q: debouncedQ, category }, { signal })).data || []); }
    catch (e) {
      // Aborts are expected when typing fast — swallow silently.
      if (e.name === "AbortError") return;
      toast.error(e.message);
    }
  };
  // R7bh-F9 / R7bg-4-HIGH-1 — AbortController cancels the previous
  // in-flight request when the user keeps typing / flips category,
  // preventing a stale response from clobbering fresh data.
  useEffect(() => {
    const ctrl = new AbortController();
    refresh(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, category]);
  // Local refresh wrapper for modal callbacks (no signal needed — they
  // fire once on user action and won't race themselves).
  const refreshNoSignal = () => refresh();

  const remove = async (d) => {
    // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
    if (!(await confirm({
      title: "Deactivate drug?",
      body: `"${d.name}" will be marked inactive and removed from new prescriptions. Existing dispense history is preserved.`,
      danger: true,
      confirmLabel: "Deactivate",
    }))) return;
    try { await deleteDrug(d._id); toast.success(`${d.name} deactivated`); refreshNoSignal(); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      {/* Filters */}
      <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input className="his-field" style={{ width: 280, padding: "6px 10px", fontSize: 12 }}
          placeholder="Search name / generic / brand…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="his-select" style={{ width: 180, padding: "6px 10px", fontSize: 12 }}
          value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {DRUG_CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={() => setAdding(true)}
          style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: C.orange, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
          <i className="pi pi-plus" style={{ marginRight: 6 }} />Add Drug
        </button>
      </div>

      <Table cols={["Drug / Generic","Form / Strength","Category","Manufacturer","Reorder @","GST","Sale ₹","Action"]}>
        {drugs.length === 0 ? <EmptyRow span={8} text="No drugs match." /> :
          drugs.map((d, i) => (
            <tr key={d._id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
              <td style={{ padding: "9px 12px" }}>
                <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                  {d.name}
                  {/* R7bd-E-7 / A2-HIGH-7 — cold-chain badge so a pharmacist
                      sees at a glance which SKUs need 2-8 °C handling
                      (vaccines, insulin, biologics). Backend flag is
                      requiresRefrigeration on DrugModel. */}
                  {d.requiresRefrigeration && (
                    <span title="Cold-chain — must stay at 2-8 °C"
                      style={{ padding: "2px 6px", borderRadius: 4, background: "#dbeafe", color: "#1d4ed8", fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px", whiteSpace: "nowrap" }}>
                      ❄ COLD
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: C.muted }}>{d.genericName || "—"}</div>
              </td>
              <td style={{ padding: "9px 12px" }}>{d.form} · {d.strength || "—"}</td>
              <td style={{ padding: "9px 12px" }}>{d.category}</td>
              <td style={{ padding: "9px 12px", color: C.muted }}>{d.manufacturer || "—"}</td>
              <td style={{ padding: "9px 12px" }}>{d.reorderLevel || 10}</td>
              <td style={{ padding: "9px 12px" }}>{d.gstRate}%</td>
              <td style={{ padding: "9px 12px", fontWeight: 700 }}>{fmtINR(d.defaultSalePrice)}</td>
              <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                <RowAction icon="pi-pencil" color={C.blue} onClick={() => setEdit(d)} label="Edit" />
                <RowAction icon="pi-trash"  color={C.red}  onClick={() => remove(d)}    label="Off" />
              </td>
            </tr>
          ))}
      </Table>

      {(adding || edit) && (
        <DrugModal drug={edit} onClose={() => { setEdit(null); setAdding(false); }} onSaved={refreshNoSignal} />
      )}
    </div>
  );
}

function DrugModal({ drug, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: "", genericName: "", brandName: "", manufacturer: "",
    form: "Tablet", strength: "", pack: "",
    category: "Other", schedule: "",
    hsnCode: "", gstRate: 12,
    reorderLevel: 10, defaultSalePrice: 0,
    isHighAlert: false, isLASA: false, isNarcotic: false,
    ...drug,
  });
  const [saving, setSaving] = useState(false);
  const upd = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const submit = async () => {
    if (!form.name.trim()) { toast.warn("Drug name required"); return; }
    setSaving(true);
    try {
      if (drug?._id) await updateDrug(drug._id, form);
      else await createDrug(form);
      toast.success(`${form.name} saved`);
      onSaved(); onClose();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={drug?._id ? "Edit Drug" : "Add Drug to Master"} color={C.orange} onClose={onClose} onSubmit={submit} submitting={saving} size={620}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Drug name *"><input className="his-field" value={form.name} onChange={upd("name")} placeholder="Paracetamol 500mg" /></Field>
        <Field label="Generic name"><input className="his-field" value={form.genericName} onChange={upd("genericName")} placeholder="Acetaminophen" /></Field>
        <Field label="Brand name"><input className="his-field" value={form.brandName} onChange={upd("brandName")} placeholder="Crocin" /></Field>
        <Field label="Manufacturer"><input className="his-field" value={form.manufacturer} onChange={upd("manufacturer")} /></Field>
        <Field label="Form">
          <select className="his-select" value={form.form} onChange={upd("form")}>{DRUG_FORMS.map(o => <option key={o}>{o}</option>)}</select>
        </Field>
        <Field label="Strength"><input className="his-field" value={form.strength} onChange={upd("strength")} placeholder="500 mg" /></Field>
        <Field label="Pack"><input className="his-field" value={form.pack} onChange={upd("pack")} placeholder="10 tabs/strip" /></Field>
        <Field label="Category">
          <select className="his-select" value={form.category} onChange={upd("category")}>{DRUG_CATEGORIES.map(o => <option key={o}>{o}</option>)}</select>
        </Field>
        <Field label="Schedule">
          <select className="his-select" value={form.schedule} onChange={upd("schedule")}>
            {["","G","H","H1","X","OTC"].map(o => <option key={o} value={o}>{o || "—"}</option>)}
          </select>
        </Field>
        <Field label="HSN code"><input className="his-field" value={form.hsnCode} onChange={upd("hsnCode")} /></Field>
        <Field label="GST %"><input type="number" className="his-field" value={form.gstRate} onChange={upd("gstRate")} /></Field>
        <Field label="Reorder level (units)"><input type="number" className="his-field" value={form.reorderLevel} onChange={upd("reorderLevel")} /></Field>
        <Field label="Default sale ₹"><input type="number" className="his-field" value={form.defaultSalePrice} onChange={upd("defaultSalePrice")} /></Field>
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 18, flexWrap: "wrap" }}>
        <Check label="High-alert med (insulin / opioid)" v={form.isHighAlert} on={() => setForm(p => ({ ...p, isHighAlert: !p.isHighAlert }))} />
        <Check label="LASA (look-alike / sound-alike)"  v={form.isLASA}      on={() => setForm(p => ({ ...p, isLASA: !p.isLASA }))} />
        <Check label="Narcotic"                          v={form.isNarcotic}  on={() => setForm(p => ({ ...p, isNarcotic: !p.isNarcotic }))} />
        {/* R7bd-E-7 / A2-HIGH-7 — flip the cold-chain flag from the
            modal. Surface badge on the drug row picks this up
            immediately on refresh. */}
        <Check label="Cold-chain (2-8 °C)"               v={form.requiresRefrigeration} on={() => setForm(p => ({ ...p, requiresRefrigeration: !p.requiresRefrigeration }))} />
      </div>
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════════════
   INVENTORY TAB — stock rollup + batch detail
══════════════════════════════════════════════════════════════════ */
function InventoryTab() {
  const [rollup, setRollup] = useState([]);
  const [batches, setBatches] = useState([]);
  const [showBatches, setShowBatches] = useState(null);   // drugId
  const refresh = async () => {
    try {
      const r = await stockRollup();
      setRollup(r.data || []);
    } catch (e) { toast.error(e.message); }
  };
  useEffect(() => { refresh(); }, []);

  const openBatches = async (drugId) => {
    try {
      const r = await listBatches({ drugId });
      setBatches(r.data || []);
      setShowBatches(drugId);
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <Table cols={["Drug","Category","On hand","Batches","Nearest expiry","Reorder @","Sale ₹","Action"]}>
        {rollup.length === 0 ? <EmptyRow span={8} text="No stock yet — record a GRN to add inventory." /> :
          rollup.map((r, i) => {
            const low = r.totalRemaining <= (r.reorderLevel || 10);
            const expSoon = r.nearestExpiry && new Date(r.nearestExpiry) <= new Date(Date.now() + 90 * 86400000);
            return (
              <tr key={r.drugId} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                <td style={{ padding: "9px 12px", fontWeight: 700 }}>{r.drugName}</td>
                <td style={{ padding: "9px 12px", color: C.muted }}>{r.category || "—"}</td>
                <td style={{ padding: "9px 12px" }}>
                  <span style={{ fontWeight: 800, color: low ? C.red : C.text }}>{r.totalRemaining}</span>
                  {low && <span style={{ marginLeft: 6, padding: "2px 6px", borderRadius: 4, background: C.redL, color: C.red, fontSize: 9, fontWeight: 800 }}>LOW</span>}
                </td>
                <td style={{ padding: "9px 12px" }}>{r.batchCount}</td>
                <td style={{ padding: "9px 12px", color: expSoon ? C.amber : C.muted, fontWeight: expSoon ? 700 : 400 }}>
                  {fmtDate(r.nearestExpiry)}
                  {expSoon && <span style={{ marginLeft: 6, fontSize: 10 }}>· {daysUntil(r.nearestExpiry)}d</span>}
                </td>
                <td style={{ padding: "9px 12px" }}>{r.reorderLevel}</td>
                <td style={{ padding: "9px 12px" }}>{fmtINR(r.latestSale)}</td>
                <td style={{ padding: "8px 12px" }}>
                  <RowAction icon="pi-eye" color={C.blue} onClick={() => openBatches(r.drugId)} label="Batches" />
                </td>
              </tr>
            );
          })}
      </Table>

      {showBatches && (
        <Modal title="Batch detail" color={C.blue} onClose={() => setShowBatches(null)} hideFooter size={780}>
          <Table cols={["Batch","Mfg","Expiry","In","Out","Remaining","Sale ₹","MRP","Supplier"]} compact>
            {batches.length === 0 ? <EmptyRow span={9} text="No batches for this drug." /> :
              batches.map(b => {
                const expired = b.expiryDate && new Date(b.expiryDate) < new Date();
                return (
                  <tr key={b._id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "7px 10px", fontFamily: "DM Mono, monospace" }}>{b.batchNo}</td>
                    <td style={{ padding: "7px 10px", color: C.muted }}>{fmtDate(b.mfgDate)}</td>
                    <td style={{ padding: "7px 10px", color: expired ? C.red : C.text, fontWeight: expired ? 700 : 400 }}>{fmtDate(b.expiryDate)}</td>
                    <td style={{ padding: "7px 10px" }}>{b.quantityIn}</td>
                    <td style={{ padding: "7px 10px", color: C.muted }}>{b.quantityOut}</td>
                    <td style={{ padding: "7px 10px", fontWeight: 700 }}>{b.remaining}</td>
                    <td style={{ padding: "7px 10px" }}>{fmtINR(b.salePrice)}</td>
                    <td style={{ padding: "7px 10px", color: C.muted }}>{fmtINR(b.mrp)}</td>
                    <td style={{ padding: "7px 10px", color: C.muted }}>{b.supplierName || "—"}</td>
                  </tr>
                );
              })}
          </Table>
        </Modal>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   GRN TAB — record goods receipt (R7du: user-friendly redesign)
   Sections: help banner + Drug/Supplier + Batch/Expiry + Pricing/Invoice
   Smart: today defaults · sale-price auto-suggest · live margin + batch
   value · expiry shelf-life hint · MRP guard · datalist drug search ·
   Save-and-add-another for multi-line invoices.
══════════════════════════════════════════════════════════════════ */
function GRNTab() {
  const todayISO = new Date().toISOString().slice(0, 10);
  const blankForm = () => ({
    drugId: "", supplierId: "", batchNo: "", mfgDate: "", expiryDate: "",
    quantityIn: "", purchaseRate: "", mrp: "", salePrice: "",
    invoiceNo: "", invoiceDate: todayISO,
  });

  const [drugs, setDrugs] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState(blankForm());
  const [drugQuery, setDrugQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastGRN, setLastGRN] = useState(null);
  // Track whether sale price has been user-edited. While true, MRP keeps
  // pushing live updates so multi-digit typing (1 → 15 → 150) tracks
  // properly. Flips to false the moment the user types in salePrice
  // directly, so we never overwrite their explicit choice.
  const [autoSalePrice, setAutoSalePrice] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setDrugs((await listDrugs()).data || []);
        setSuppliers((await listSuppliers()).data || []);
      } catch (e) { toast.error(e.message); }
    })();
  }, []);

  // Datalist label → drug. Tries exact label match first; falls back to a
  // case-insensitive prefix match so partial typing still resolves.
  const drugLabel = (d) => `${d.name}${d.strength ? " · " + d.strength : ""}`;
  const selectedDrug = useMemo(() => {
    const q = drugQuery.trim();
    if (!q) return null;
    const ql = q.toLowerCase();
    return drugs.find(d => drugLabel(d).toLowerCase() === ql)
        || drugs.find(d => drugLabel(d).toLowerCase().startsWith(ql))
        || null;
  }, [drugQuery, drugs]);

  useEffect(() => {
    setForm(p => {
      const next = selectedDrug?._id || "";
      return p.drugId === next ? p : { ...p, drugId: next };
    });
  }, [selectedDrug]);

  const upd = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  // MRP entered → keep sale price live-tracked at MRP -10% until user
  // overrides. This makes typing "150" → 1 → 15 → 150 update salePrice
  // through 0.9 → 13.5 → 135 instead of locking at 0.9 forever.
  const onMrpChange = (e) => {
    const val = e.target.value;
    setForm(p => {
      const next = { ...p, mrp: val };
      if (autoSalePrice && Number(val) > 0) {
        next.salePrice = (Math.round(Number(val) * 0.9 * 100) / 100).toString();
      } else if (autoSalePrice && val === "") {
        next.salePrice = "";
      }
      return next;
    });
  };

  // User typed in sale price → stop auto-tracking from MRP. Clearing
  // the field re-enables auto-suggest from MRP.
  const onSalePriceChange = (e) => {
    const val = e.target.value;
    setAutoSalePrice(val === "");
    setForm(p => ({ ...p, salePrice: val }));
  };

  // Derived metrics
  const qty   = Number(form.quantityIn)   || 0;
  const pRate = Number(form.purchaseRate) || 0;
  const mrp   = Number(form.mrp)          || 0;
  const sale  = Number(form.salePrice)    || 0;
  const batchValue = qty * pRate;
  const marginAbs  = sale - pRate;
  const marginPct  = pRate > 0 ? Math.round((marginAbs / pRate) * 100) : 0;

  // Expiry shelf-life hint
  let expiryHint = null;
  if (form.expiryDate) {
    const days = Math.floor((new Date(form.expiryDate) - new Date()) / 86400000);
    if (days < 0)        expiryHint = { color: C.red,    text: `Already expired ${-days} day(s) ago` };
    else if (days < 180) expiryHint = { color: C.amber,  text: `Short shelf life — ${days} day(s) remaining` };
    else                 expiryHint = { color: C.green,  text: `${Math.round(days / 30)} months shelf life ✓` };
  }

  // Mfg-after-expiry guard
  const mfgAfterExpiry = form.mfgDate && form.expiryDate && form.mfgDate > form.expiryDate;
  // Sale > MRP is illegal in India
  const saleAboveMrp = mrp > 0 && sale > mrp;

  const submit = async (addAnother) => {
    if (!form.drugId)       { toast.warn("Select a drug from the list");     return; }
    if (!form.batchNo)      { toast.warn("Batch number is required");        return; }
    if (!form.expiryDate)   { toast.warn("Expiry date is required");         return; }
    if (qty <= 0)           { toast.warn("Quantity must be greater than 0"); return; }
    if (mfgAfterExpiry)     { toast.warn("Mfg date cannot be after expiry"); return; }
    if (saleAboveMrp)       { toast.warn("Sale price cannot exceed MRP");    return; }
    setSaving(true);
    try {
      const supplier = suppliers.find(s => s._id === form.supplierId);
      const r = await recordGRN({
        ...form,
        supplierName: supplier?.name || "",
        quantityIn:   qty,
        purchaseRate: pRate,
        mrp:          mrp,
        salePrice:    sale,
      });
      toast.success(`GRN ${r.grnNumber} recorded`);
      setLastGRN({ number: r.grnNumber, drug: drugLabel(selectedDrug || {}) || "—", supplier: supplier?.name || "—", qty });
      if (addAnother) {
        // Keep supplier + invoice context — typical multi-line invoice
        setForm(p => ({
          ...blankForm(),
          supplierId: p.supplierId,
          invoiceNo:  p.invoiceNo,
          invoiceDate: p.invoiceDate,
        }));
      } else {
        setForm(blankForm());
      }
      setDrugQuery("");
      setAutoSalePrice(true);
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const Req  = () => <span style={{ color: C.red, fontWeight: 800, marginLeft: 2 }}>*</span>;
  const hint = (color, text) => <div style={{ fontSize: 11, color, marginTop: 4, fontWeight: 600 }}>{text}</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Help banner — answers "what is GRN, why am I filling this?" */}
      <div style={{ background: C.purpleL, border: `1px solid ${C.purple}33`, borderRadius: 10, padding: "11px 14px", display: "flex", gap: 12, alignItems: "flex-start" }}>
        <i className="pi pi-info-circle" style={{ color: C.purple, fontSize: 18, marginTop: 1 }} />
        <div style={{ fontSize: 12, color: C.text, lineHeight: 1.55 }}>
          <strong style={{ color: C.purple }}>GRN — Goods Receipt Note.</strong>{" "}
          Record every batch you receive from a supplier here. Required for D&amp;C Rules §65, NABH MOM.4 audit trail, and GST input-tax credit. Each entry creates a stock batch consumed FEFO (first-expiry-first-out) when you dispense.
        </div>
      </div>

      {/* Success ribbon — confirms what just happened */}
      {lastGRN && (
        <div style={{ background: C.greenL, border: `1px solid ${C.green}55`, borderRadius: 10, padding: "9px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 12, color: C.green, fontWeight: 700 }}>
            <i className="pi pi-check-circle" style={{ marginRight: 6 }} />
            GRN <span style={{ fontFamily: "DM Mono, monospace" }}>{lastGRN.number}</span> recorded — {lastGRN.drug} ({lastGRN.qty} units) from {lastGRN.supplier}
          </div>
          <button onClick={() => setLastGRN(null)} title="Dismiss"
            style={{ background: "transparent", border: "none", color: C.green, cursor: "pointer", fontSize: 13 }}>
            <i className="pi pi-times" />
          </button>
        </div>
      )}

      <Card title="Record Goods Receipt (GRN)" color={C.purple} icon="pi-download">
        {/* ── Section 1: Drug & Supplier ─────────────────────────── */}
        <GRNSection icon="pi-tag" text="Drug & Supplier" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
          <Field label={<>Drug<Req /></>}>
            <input
              className="his-field"
              list="grn-drugs-list"
              placeholder="Type drug name to search…"
              value={drugQuery}
              onChange={(e) => setDrugQuery(e.target.value)}
              autoComplete="off"
            />
            <datalist id="grn-drugs-list">
              {drugs.map(d => <option key={d._id} value={drugLabel(d)} />)}
            </datalist>
            {selectedDrug
              ? hint(C.green, `✓ ${drugLabel(selectedDrug)}${selectedDrug.form ? " · " + selectedDrug.form : ""}${selectedDrug.category ? " · " + selectedDrug.category : ""}`)
              : hint(C.muted, drugQuery ? "No drug matched — refine search or add via Drug Master" : "Start typing — autocomplete suggests from drug master")
            }
          </Field>

          <Field label="Supplier">
            <select className="his-select" value={form.supplierId} onChange={upd("supplierId")}>
              <option value="">Select supplier…</option>
              {suppliers.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
            {hint(C.muted, "Optional — links batch to purchase register & supplier ledger")}
          </Field>
        </div>

        {/* ── Section 2: Batch & Expiry ──────────────────────────── */}
        <GRNSection icon="pi-box" text="Batch & Expiry" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 18 }}>
          <Field label={<>Batch number<Req /></>}>
            <input className="his-field" value={form.batchNo} onChange={upd("batchNo")} placeholder="e.g. ABC123" />
            {hint(C.muted, "Printed on the strip / vial")}
          </Field>
          <Field label="Manufacturing date">
            <input type="date" className="his-field" max={todayISO}
              value={form.mfgDate} onChange={upd("mfgDate")} />
            {mfgAfterExpiry && hint(C.red, "Mfg date is after expiry — please check")}
          </Field>
          <Field label={<>Expiry date<Req /></>}>
            <input type="date" className="his-field" min={todayISO}
              value={form.expiryDate} onChange={upd("expiryDate")} />
            {expiryHint && hint(expiryHint.color, expiryHint.text)}
          </Field>
        </div>

        {/* ── Section 3: Pricing & Invoice ───────────────────────── */}
        <GRNSection icon="pi-receipt" text="Pricing & Invoice" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
          <Field label={<>Quantity received<Req /></>}>
            <input type="number" min="1" className="his-field"
              value={form.quantityIn} onChange={upd("quantityIn")} placeholder="e.g. 100" />
          </Field>
          <Field label="Purchase rate ₹ / unit">
            <input type="number" min="0" step="0.01" className="his-field"
              value={form.purchaseRate} onChange={upd("purchaseRate")} placeholder="0.00" />
          </Field>
          <Field label="MRP ₹ / unit">
            <input type="number" min="0" step="0.01" className="his-field"
              value={form.mrp} onChange={onMrpChange} placeholder="0.00" />
            {mrp > 0 && hint(C.muted, "Sale price auto-suggested at MRP −10%")}
          </Field>
          <Field label="Sale price ₹ / unit">
            <input type="number" min="0" step="0.01" className="his-field"
              value={form.salePrice} onChange={onSalePriceChange} placeholder="auto from MRP" />
            {saleAboveMrp && hint(C.red, "Sale price cannot exceed MRP")}
            {!autoSalePrice && hint(C.muted, "Manual override — clear field to re-link to MRP")}
          </Field>
          <Field label="Invoice number">
            <input className="his-field" value={form.invoiceNo} onChange={upd("invoiceNo")} placeholder="e.g. INV-2026-001" />
          </Field>
          <Field label="Invoice date">
            <input type="date" className="his-field" max={todayISO}
              value={form.invoiceDate} onChange={upd("invoiceDate")} />
          </Field>
          <div />
          <div />
        </div>

        {/* Live metrics — only when there's something to show */}
        {(qty > 0 || pRate > 0 || sale > 0) && (
          <div style={{ marginTop: 14, padding: "11px 16px", background: C.subtle, border: `1px solid ${C.border}`, borderRadius: 10, display: "flex", gap: 32, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ color: C.muted, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700 }}>Batch value</div>
              <div style={{ color: C.text, fontWeight: 800, fontSize: 15, marginTop: 3 }}>{fmtINR(batchValue)}</div>
            </div>
            <div>
              <div style={{ color: C.muted, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700 }}>Margin / unit</div>
              <div style={{ color: marginAbs >= 0 ? C.green : C.red, fontWeight: 800, fontSize: 15, marginTop: 3 }}>
                {fmtINR(marginAbs)}{pRate > 0 && <span style={{ fontWeight: 600, fontSize: 12, marginLeft: 4 }}>({marginPct}%)</span>}
              </div>
            </div>
            {qty > 0 && sale > 0 && (
              <div>
                <div style={{ color: C.muted, fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 700 }}>Potential revenue</div>
                <div style={{ color: C.purple, fontWeight: 800, fontSize: 15, marginTop: 3 }}>{fmtINR(qty * sale)}</div>
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div style={{ marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 11, color: C.muted }}>
            <i className="pi pi-info-circle" style={{ marginRight: 4 }} />
            Fields marked <span style={{ color: C.red, fontWeight: 800 }}>*</span> are required
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => { setForm(blankForm()); setDrugQuery(""); setAutoSalePrice(true); }} disabled={saving}
              style={{ padding: "9px 16px", borderRadius: 8, border: `1.5px solid ${C.border}`, background: "#fff", color: C.muted, fontWeight: 700, fontSize: 12, cursor: saving ? "not-allowed" : "pointer" }}>
              <i className="pi pi-refresh" style={{ marginRight: 6 }} />Reset
            </button>
            <button onClick={() => submit(true)} disabled={saving}
              title="Save this batch and start another — keeps supplier + invoice"
              style={{ padding: "9px 18px", borderRadius: 8, border: `1.5px solid ${C.purple}`, background: "#fff", color: C.purple, fontWeight: 800, fontSize: 12, cursor: saving ? "not-allowed" : "pointer" }}>
              <i className="pi pi-plus" style={{ marginRight: 6 }} />Save &amp; add another
            </button>
            <button onClick={() => submit(false)} disabled={saving}
              style={{ padding: "10px 22px", borderRadius: 8, border: "none", background: saving ? "#94a3b8" : C.purple, color: "#fff", fontWeight: 800, fontSize: 13, cursor: saving ? "not-allowed" : "pointer" }}>
              {saving ? "Recording…" : <><i className="pi pi-save" style={{ marginRight: 6 }} />Record GRN</>}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// Small section divider used inside GRN tab — purple icon + uppercase
// label with a dashed underline. Keeps the three field groups visually
// distinct without inflating the card to multiple Cards.
function GRNSection({ icon, text }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, paddingBottom: 6, borderBottom: `1px dashed ${C.border}` }}>
      <i className={`pi ${icon}`} style={{ color: C.purple, fontSize: 12 }} />
      <span style={{ fontWeight: 800, fontSize: 11.5, color: C.purple, textTransform: "uppercase", letterSpacing: ".5px" }}>{text}</span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   DISPENSE TAB — sell to patient / walk-in
══════════════════════════════════════════════════════════════════ */
// Module-level cache for pharmacy settings so we don't re-fetch on every
// dispense / sales print. Cleared when Settings tab saves a change.
let _phSettings = null;
async function getCachedPhSettings() {
  if (_phSettings) return _phSettings;
  try { _phSettings = (await getPharmacySettings()).data || null; } catch { _phSettings = null; }
  return _phSettings;
}
function invalidatePhSettings() { _phSettings = null; }

function DispenseTab() {
  const [rollup, setRollup] = useState([]);
  const [items, setItems]   = useState([]);   // current cart
  const [patient, setPatient] = useState({ patientUHID: "", patientName: "", contactNumber: "", age: "", gender: "", doctorName: "" });
  const [admissionId, setAdmissionId] = useState(null);
  const [admissionNumber, setAdmissionNumber] = useState("");
  const [hisLinked, setHisLinked]   = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [saleType, setSaleType] = useState("Walk-in");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [saving, setSaving] = useState(false);
  const [drugSearch, setDrugSearch] = useState("");

  // Pull HIS patient from UHID — auto-fills name/age/gender/contact/doctor
  // and links the bill to the active admission so IPD pharmacy bills can
  // flow back into the billing ledger.
  const fetchByUHID = async () => {
    const u = patient.patientUHID.trim();
    if (!u) { toast.warn("Enter a UHID to look up"); return; }
    setLookupBusy(true);
    try {
      const hit = await lookupHisPatient(u);
      if (!hit) {
        // Critical: any STALE admissionId from a prior lookup must be
        // wiped, otherwise the next dispense submit would link THIS
        // patient to the previous patient's admission ledger.
        setAdmissionId(null);
        setAdmissionNumber("");
        setHisLinked(false);
        setSaleType("Walk-in");
        toast.error(`No patient found for ${u} in HIS — selling as Walk-in. Re-enter UHID if this is wrong.`);
        return;
      }
      setPatient({
        patientUHID:  hit.patientUHID,
        patientName:  hit.patientName,
        age:          hit.age,
        gender:       hit.gender,
        contactNumber:hit.contactNumber,
        doctorName:   hit.doctorName,
      });
      setAdmissionId(hit.admissionId);
      setAdmissionNumber(hit.admissionNumber || "");
      setSaleType(hit.saleType || "OPD");
      setHisLinked(true);
      toast.success(`Linked ${hit.patientName} (${hit.source === "admission" ? `IPD · ${hit.admissionNumber || hit.admissionId}` : "OPD"})`);
    } catch (e) {
      toast.error(e.message || "UHID lookup failed");
    } finally { setLookupBusy(false); }
  };

  const clearLink = () => {
    setPatient({ patientUHID: "", patientName: "", contactNumber: "", age: "", gender: "", doctorName: "" });
    setAdmissionId(null); setAdmissionNumber(""); setHisLinked(false); setSaleType("Walk-in");
  };

  useEffect(() => { (async () => {
    try { setRollup((await stockRollup()).data || []); } catch (e) { toast.error(e.message); }
  })(); }, []);

  const matches = useMemo(() => {
    if (!drugSearch.trim()) return [];
    const rx = new RegExp(drugSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    return rollup.filter(r => rx.test(r.drugName || "")).slice(0, 8);
  }, [drugSearch, rollup]);

  const addItem = (r) => {
    if (items.some(it => it.drugId === r.drugId)) {
      toast.info(`${r.drugName} already in cart — update qty below`);
      return;
    }
    setItems(p => [...p, {
      drugId: r.drugId, drugName: r.drugName,
      quantity: 1, unitPrice: r.latestSale || 0, gstRate: 12, discountPercent: 0,
      available: r.totalRemaining,
    }]);
    setDrugSearch("");
  };

  const updItem = (idx, k, v) => setItems(p => p.map((it, i) => i === idx ? { ...it, [k]: v } : it));
  const rmItem  = (idx)        => setItems(p => p.filter((_, i) => i !== idx));

  // Totals
  const tot = useMemo(() => {
    let sub = 0, disc = 0, gst = 0;
    items.forEach(it => {
      const qty = Number(it.quantity || 0), unit = Number(it.unitPrice || 0);
      const gross = qty * unit;
      const d = gross * Number(it.discountPercent || 0) / 100;
      const tax = (gross - d) * Number(it.gstRate || 0) / 100;
      sub += gross; disc += d; gst += tax;
    });
    const grand = (sub - disc) + gst;
    return { sub, disc, gst, grand };
  }, [items]);

  const submit = async () => {
    if (items.length === 0) { toast.warn("Add at least one item"); return; }
    setSaving(true);
    try {
      const r = await dispense({
        ...patient, saleType, paymentMode,
        admissionId, admissionNumber,
        items: items.map(it => ({
          drugId: it.drugId, drugName: it.drugName,
          quantity: Number(it.quantity), unitPrice: Number(it.unitPrice),
          gstRate: Number(it.gstRate), discountPercent: Number(it.discountPercent),
        })),
      });
      toast.success(`Bill ${r.data.billNumber} · ${fmtINR(r.data.grandTotal)}`);
      // Auto-open the GST tax-invoice — paper-size selector lives in
      // the print window toolbar (half-A4 default for pharmacy).
      // Pharmacy settings travel with the payload so the bill renders
      // the right header/footer (hospital vs outsourced).
      const phSet = await getCachedPhSettings();
      // R7eo-B — Pattern B caller payload gap fix: derive billLabel +
      // forward customer GST identity so the pharmacy template can title
      // it Cash Memo / Tax Invoice / Pharmacy Bill and render the B2B
      // GSTIN block when set.
      openPrint("pharmacy-bill", {
        ...r.data,
        template:     phSet?.billTemplate || 1,
        defaultPaper: phSet?.defaultPaper || "half-a4",
        pharmacySettings: phSet,
        billLabel:        r.data.saleType === "Walk-in" ? "Cash Memo" : r.data.customerGstin ? "Tax Invoice" : "Pharmacy Bill",
        customerGstin:    r.data.customerGstin     || null,
        customerLegalName:r.data.customerLegalName || null,
        customerAddress:  r.data.customerAddress   || null,
        customerState:    r.data.customerState     || null,
        placeOfSupply:    r.data.placeOfSupply     || null,
        saleType:         r.data.saleType          || null,
        // R7bh-F1 / META-1: PrintAudit anchor — PharmacyBill maps to
        // PharmacySale in ENTITY_MODEL. Bumps printCount + writes
        // DUPLICATE watermark on reprints (GST §35 / D&C audit trail).
        printAudit: {
          entityType:   "PharmacyBill",
          entityId:     r.data._id,
          entityNumber: r.data.billNumber,
          UHID:         r.data.UHID || r.data.patient?.UHID,
          patientName:  r.data.patientName || r.data.patient?.fullName,
        },
      });
      setItems([]);
      clearLink();
      setRollup((await stockRollup()).data || []);
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
      {/* Cart */}
      <Card title="New Sale / Dispense" color={C.green} icon="pi-shopping-cart">
        <div style={{ position: "relative", marginBottom: 10 }}>
          <input className="his-field" placeholder="Search drug to add…"
            value={drugSearch} onChange={e => setDrugSearch(e.target.value)} />
          {matches.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: "0 8px 20px rgba(0,0,0,.1)", maxHeight: 240, overflow: "auto", zIndex: 10 }}>
              {matches.map(m => (
                <button key={m.drugId} onClick={() => addItem(m)}
                  style={{ width: "100%", padding: "8px 12px", border: "none", background: "#fff", textAlign: "left", cursor: "pointer", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ fontWeight: 700 }}>{m.drugName}</span>
                  <span style={{ color: C.muted }}>Stock: {m.totalRemaining} · {fmtINR(m.latestSale)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Table cols={["Drug","Qty","Unit ₹","GST %","Disc %","Net ₹",""]} compact>
          {items.length === 0 ? <EmptyRow span={7} text="Cart empty — search a drug above." /> :
            items.map((it, idx) => {
              const gross = (it.quantity || 0) * (it.unitPrice || 0);
              const dAmt  = gross * (it.discountPercent || 0) / 100;
              const gAmt  = (gross - dAmt) * (it.gstRate || 0) / 100;
              const net   = (gross - dAmt) + gAmt;
              const overStock = Number(it.quantity) > it.available;
              return (
                <tr key={idx} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: "6px 10px" }}>
                    <div style={{ fontWeight: 700 }}>{it.drugName}</div>
                    <div style={{ fontSize: 10, color: overStock ? C.red : C.muted }}>
                      Available: {it.available}{overStock && " · over-stock!"}
                    </div>
                  </td>
                  <td style={{ padding: "4px 10px" }}>
                    <input type="number" className="his-field" style={{ width: 70, padding: "4px 6px", fontSize: 11, borderColor: overStock ? C.red : undefined }}
                      value={it.quantity} onChange={e => updItem(idx, "quantity", e.target.value)} />
                  </td>
                  <td style={{ padding: "4px 10px" }}>
                    <input type="number" className="his-field" style={{ width: 80, padding: "4px 6px", fontSize: 11 }}
                      value={it.unitPrice} onChange={e => updItem(idx, "unitPrice", e.target.value)} />
                  </td>
                  <td style={{ padding: "4px 10px" }}>
                    <input type="number" className="his-field" style={{ width: 60, padding: "4px 6px", fontSize: 11 }}
                      value={it.gstRate} onChange={e => updItem(idx, "gstRate", e.target.value)} />
                  </td>
                  <td style={{ padding: "4px 10px" }}>
                    <input type="number" className="his-field" style={{ width: 60, padding: "4px 6px", fontSize: 11 }}
                      value={it.discountPercent} onChange={e => updItem(idx, "discountPercent", e.target.value)} />
                  </td>
                  <td style={{ padding: "6px 10px", fontWeight: 800, color: C.green }}>{fmtINR(net)}</td>
                  <td style={{ padding: "4px 10px" }}>
                    <button onClick={() => rmItem(idx)} style={{ width: 26, height: 26, border: "none", borderRadius: 5, background: C.redL, color: C.red, cursor: "pointer" }}>
                      <i className="pi pi-times" style={{ fontSize: 10 }} />
                    </button>
                  </td>
                </tr>
              );
            })}
        </Table>

        {/* Totals */}
        <div style={{ marginTop: 14, padding: "12px 14px", background: C.subtle, border: `1px solid ${C.border}`, borderRadius: 8, display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
          <Row label="Subtotal" value={fmtINR(tot.sub)} />
          <Row label="Discount" value={`− ${fmtINR(tot.disc)}`} valueColor={C.red} />
          <Row label="GST" value={`+ ${fmtINR(tot.gst)}`} valueColor={C.muted} />
          <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: 6, marginTop: 4 }}>
            <Row label="Grand total" value={fmtINR(tot.grand)} bold large valueColor={C.green} />
          </div>
        </div>
      </Card>

      {/* Patient + payment */}
      <Card title="Patient & Payment" color={C.blue} icon="pi-user">
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>

          {/* R7cs — UHID lookup is HIS-only. In a retail/standalone
              pharmacy deployment there's no Patient or Admission DB to
              query, so we hide the field entirely. The dispense flow
              then takes the walk-in path by default — pharmacist
              optionally types patient name / contact below if they
              want to capture it for a Schedule H register entry. */}
          {!IS_PHARMACY_STANDALONE && (
            <Field label="UHID — pull from HIS">
              <div style={{ display: "flex", gap: 6 }}>
                <input className="his-field" style={{ flex: 1, fontFamily: "DM Mono, monospace" }}
                  value={patient.patientUHID}
                  placeholder="UH00000001 (or leave empty for walk-in)"
                  onChange={e => setPatient(p => ({ ...p, patientUHID: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") fetchByUHID(); }} />
                <button onClick={fetchByUHID} disabled={lookupBusy || !patient.patientUHID.trim()}
                  style={{ padding: "8px 14px", borderRadius: 7, border: "none",
                    background: lookupBusy ? "#94a3b8" : C.blue, color: "#fff",
                    fontWeight: 700, fontSize: 11.5,
                    cursor: lookupBusy || !patient.patientUHID.trim() ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap" }}>
                  {lookupBusy ? <i className="pi pi-spin pi-spinner" style={{ fontSize: 10 }} />
                              : <><i className="pi pi-search" style={{ fontSize: 10, marginRight: 4 }} />Fetch</>}
                </button>
              </div>
            </Field>
          )}

          {hisLinked && !IS_PHARMACY_STANDALONE && (
            <div style={{
              padding: "9px 12px", background: C.greenL, border: `1.5px solid ${C.green}40`,
              borderRadius: 7, display: "flex", alignItems: "center", gap: 8,
            }}>
              <i className="pi pi-link" style={{ color: C.green, fontSize: 12 }} />
              <div style={{ flex: 1, fontSize: 11.5, fontWeight: 700, color: "#166534" }}>
                Linked to HIS · {saleType}
                {admissionNumber && <span style={{ marginLeft: 6, fontFamily: "DM Mono, monospace", color: C.green }}>{admissionNumber}</span>}
              </div>
              <button onClick={clearLink} title="Unlink"
                style={{ width: 22, height: 22, borderRadius: 5, border: "none", background: "#fff", color: C.muted, cursor: "pointer", fontSize: 10 }}>
                <i className="pi pi-times" />
              </button>
            </div>
          )}

          <Field label="Patient name"><input className="his-field" value={patient.patientName} onChange={e => setPatient(p => ({ ...p, patientName: e.target.value }))} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Age"><input className="his-field" value={patient.age || ""} onChange={e => setPatient(p => ({ ...p, age: e.target.value }))} /></Field>
            <Field label="Gender">
              <select className="his-select" value={patient.gender || ""} onChange={e => setPatient(p => ({ ...p, gender: e.target.value }))}>
                <option value="">—</option>
                {["Male","Female","Other"].map(g => <option key={g}>{g}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Contact"><input className="his-field" value={patient.contactNumber} onChange={e => setPatient(p => ({ ...p, contactNumber: e.target.value }))} /></Field>
          <Field label="Doctor"><input className="his-field" value={patient.doctorName} onChange={e => setPatient(p => ({ ...p, doctorName: e.target.value }))} /></Field>
          <Field label="Sale type">
            <select className="his-select" value={saleType} onChange={e => setSaleType(e.target.value)}>
              {SALE_TYPES.map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Payment mode">
            <select className="his-select" value={paymentMode} onChange={e => setPaymentMode(e.target.value)}>
              {PAYMENT_MODES.map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <button onClick={submit} disabled={saving || items.length === 0}
            style={{ padding: "11px 20px", borderRadius: 8, border: "none", background: saving || items.length === 0 ? "#94a3b8" : C.green, color: "#fff", fontWeight: 800, fontSize: 13, cursor: saving || items.length === 0 ? "not-allowed" : "pointer", marginTop: 6 }}>
            {saving ? "Saving…" : <><i className="pi pi-check" style={{ marginRight: 6 }} />Complete sale · {fmtINR(tot.grand)}</>}
          </button>
        </div>
      </Card>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   SALES TAB — history register
══════════════════════════════════════════════════════════════════ */
function SalesTab() {
  const { can } = useAuth();
  // Doctors can land here because the route allows {Admin, Pharmacist, Doctor},
  // but the destructive operations (cancel / return / add-items) are
  // Pharmacist+Admin only per pharmacy.cancel / pharmacy.return / pharmacy.add-items.
  // Hide the buttons so the UX matches what the API will accept.
  const canCancel   = can("pharmacy.cancel");
  const canReturn   = can("pharmacy.return");
  const canAddItems = can("pharmacy.add-items");
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo]     = useState("");
  const [returnSale, setReturnSale] = useState(null);    // the bill being returned
  const [addItemsSale, setAddItemsSale] = useState(null); // the bill to add items to
  // R7bh-F9 / R7bg-4-HIGH-1 — debounce the bill / patient / UHID search.
  const debouncedQ = useDebounce(q, 300);

  const refresh = async (signal) => {
    try { setRows((await listSales({ q: debouncedQ, from, to }, { signal })).data || []); }
    catch (e) {
      if (e.name === "AbortError") return;
      toast.error(e.message);
    }
  };
  // R7bh-F9 / R7bg-4-HIGH-1 — AbortController per debounced query so
  // a slow response doesn't overwrite a fresher one.
  useEffect(() => {
    const ctrl = new AbortController();
    refresh(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, from, to]);
  const refreshNoSignal = () => refresh();

  const cancel = async (s) => {
    // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
    if (!(await confirm({
      title: "Cancel pharmacy bill?",
      body: `Bill ${s.billNumber} will be voided and all dispensed stock will be returned to inventory. This cannot be undone.`,
      danger: true,
      confirmLabel: "Cancel bill",
      cancelLabel: "Keep",
    }))) return;
    try { await cancelSale(s._id); toast.success("Sale cancelled · stock restored"); refreshNoSignal(); }
    catch (e) { toast.error(e.message); }
  };

  // Status pill colour mapping
  const STATUS_COL = {
    Completed:        { c: C.green,  bg: C.greenL  },
    "Partial-Return": { c: C.amber,  bg: C.amberL  },
    Refunded:         { c: C.purple, bg: C.purpleL },
    Cancelled:        { c: C.red,    bg: C.redL    },
    Hold:             { c: C.muted,  bg: C.subtle  },
  };

  return (
    <div>
      <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input className="his-field" placeholder="Search bill / patient / UHID…" style={{ width: 260, padding: "6px 10px", fontSize: 12 }} value={q} onChange={e => setQ(e.target.value)} />
        <Field label="From"><input type="date" className="his-field" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" className="his-field" value={to} onChange={e => setTo(e.target.value)} /></Field>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{rows.length} bills</span>
      </div>

      <Table cols={["Bill #","Date","Patient","Type","Items","Grand ₹","Payment","Status","Action"]}>
        {rows.length === 0 ? <EmptyRow span={9} text="No sales for the selected filters." /> :
          rows.map((s, i) => (
            <tr key={s._id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
              <td style={{ padding: "9px 12px", fontFamily: "DM Mono, monospace", fontSize: 11 }}>{s.billNumber}</td>
              <td style={{ padding: "9px 12px", color: C.muted }}>{new Date(s.createdAt).toLocaleString("en-IN")}</td>
              <td style={{ padding: "9px 12px" }}>
                <div style={{ fontWeight: 700 }}>{s.patientName || "Walk-in"}</div>
                <div style={{ fontSize: 10.5, color: C.muted }}>{s.patientUHID || "—"}</div>
              </td>
              <td style={{ padding: "9px 12px" }}>{s.saleType}</td>
              <td style={{ padding: "9px 12px" }}>{s.items?.length || 0}</td>
              <td style={{ padding: "9px 12px", fontWeight: 800 }}>{fmtINR(s.grandTotal)}</td>
              <td style={{ padding: "9px 12px" }}>{s.paymentMode}</td>
              <td style={{ padding: "9px 12px" }}>
                {(() => {
                  const sc = STATUS_COL[s.status] || STATUS_COL.Hold;
                  return (
                    <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 800,
                      background: sc.bg, color: sc.c, border: `1px solid ${sc.c}30` }}>{s.status}</span>
                  );
                })()}
                {(s.returns?.length > 0) && (
                  <div style={{ fontSize: 9.5, color: C.muted, marginTop: 2 }}>
                    {s.returns.length} return{s.returns.length === 1 ? "" : "s"} · ₹{(s.returns || []).reduce((t, r) => t + (r.refundAmount || 0), 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </div>
                )}
              </td>
              <td style={{ padding: "8px 12px" }}>
                <RowAction icon="pi-print" color={C.blue}
                  onClick={async () => {
                    const phSet = await getCachedPhSettings();
                    // R7eo-B — Pattern B caller payload gap fix: forward
                    // billLabel + B2B GST identity so the reprint shows
                    // the same title and GST block as the original.
                    openPrint("pharmacy-bill", {
                      ...s,
                      template:      phSet?.billTemplate || 1,
                      defaultPaper:  phSet?.defaultPaper || "half-a4",
                      pharmacySettings: phSet,
                      billLabel:         s.saleType === "Walk-in" ? "Cash Memo" : s.customerGstin ? "Tax Invoice" : "Pharmacy Bill",
                      customerGstin:     s.customerGstin     || null,
                      customerLegalName: s.customerLegalName || null,
                      customerAddress:   s.customerAddress   || null,
                      customerState:     s.customerState     || null,
                      placeOfSupply:     s.placeOfSupply     || null,
                      saleType:          s.saleType          || null,
                      // R7bh-F1 / META-1: PrintAudit anchor — reprint
                      // from the sales register bumps printCount on
                      // the PharmacySale so DUPLICATE watermark fires.
                      printAudit: {
                        entityType:   "PharmacyBill",
                        entityId:     s._id,
                        entityNumber: s.billNumber,
                        UHID:         s.UHID || s.patient?.UHID,
                        patientName:  s.patientName || s.patient?.fullName,
                      },
                    });
                  }}
                  label="Print" />
                {canAddItems && (s.status === "Completed" || s.status === "Partial-Return" || s.status === "Supplemented") && (
                  <RowAction icon="pi-plus" color={C.green} onClick={() => setAddItemsSale(s)} label="Add" />
                )}
                {canReturn && (s.status === "Completed" || s.status === "Partial-Return" || s.status === "Supplemented") && (
                  <RowAction icon="pi-undo" color={C.amber} onClick={() => setReturnSale(s)} label="Return" />
                )}
                {canCancel && s.status === "Completed" && (
                  <RowAction icon="pi-times" color={C.red} onClick={() => cancel(s)} label="Cancel" />
                )}
              </td>
            </tr>
          ))}
      </Table>

      {returnSale && (
        <ReturnModal sale={returnSale}
          onClose={() => setReturnSale(null)}
          onDone={() => { setReturnSale(null); refreshNoSignal(); }} />
      )}
      {addItemsSale && (
        <AddItemsModal sale={addItemsSale}
          onClose={() => setAddItemsSale(null)}
          onDone={() => { setAddItemsSale(null); refreshNoSignal(); }} />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   RETURN MODAL — per-item qty picker, refund mode, prints refund slip
══════════════════════════════════════════════════════════════════ */
function ReturnModal({ sale, onClose, onDone }) {
  // Compute remaining-returnable per item: original qty - sum of already returned
  const alreadyReturned = useMemo(() => {
    const m = {};
    for (const r of (sale.returns || [])) {
      for (const ri of (r.refundedItems || [])) {
        const k = String(ri.saleItemId || "");
        m[k] = (m[k] || 0) + Number(ri.quantity || 0);
      }
    }
    return m;
  }, [sale]);

  const [picks, setPicks] = useState({});        // saleItemId → qty
  const [refundMode, setRefundMode] = useState(sale.paymentMode || "Cash");
  const [reason, setReason]   = useState("");
  const [notes,  setNotes]    = useState("");
  const [saving, setSaving]   = useState(false);

  const setQty = (id, max, val) => {
    const n = Math.max(0, Math.min(Number(max), Number(val) || 0));
    setPicks(p => ({ ...p, [id]: n }));
  };

  // Live recompute — what would the refund look like?
  const summary = useMemo(() => {
    let qtyTotal = 0, gross = 0, disc = 0, taxable = 0, gst = 0, net = 0;
    for (const it of (sale.items || [])) {
      const k = String(it._id);
      const q = Number(picks[k] || 0);
      if (q <= 0) continue;
      const unit = Number(it.unitPrice || 0);
      const dPct = Number(it.discountPercent || 0);
      const gPct = Number(it.gstRate || 12);
      const g = q * unit;
      const d = g * dPct / 100;
      const t = g - d;
      const tx= t * gPct / 100;
      qtyTotal += q;
      gross    += g;
      disc     += d;
      taxable  += t;
      gst      += tx;
      net      += t + tx;
    }
    return {
      qtyTotal,
      gross: round2(gross), disc: round2(disc),
      taxable: round2(taxable), gst: round2(gst), net: round2(net),
    };
  }, [picks, sale]);

  const submit = async () => {
    const items = Object.entries(picks)
      .filter(([, q]) => Number(q) > 0)
      .map(([saleItemId, quantity]) => ({ saleItemId, quantity: Number(quantity) }));
    if (items.length === 0) { toast.warn("Pick at least one item with quantity > 0"); return; }
    setSaving(true);
    try {
      const r = await returnSaleItems(sale._id, { items, refundMode, reason, notes });
      const updated = r.data.sale;
      const rec     = r.data.returnRecord;
      toast.success(`Refund ${rec.refundSlipNumber} · ₹${rec.refundAmount.toLocaleString("en-IN")} via ${refundMode}`);

      // Print refund slip + revised bill — both honour current pharmacy settings
      const phSet = await getCachedPhSettings();
      openPrint("refund-receipt", {
        receiptNo: rec.refundSlipNumber,
        patientName: updated.patientName, uhid: updated.patientUHID, ipdNo: updated.admissionNumber,
        date: rec.refundedAt,
        approvedBy: rec.refundedBy,
        refundedBy: rec.refundedBy,
        amount: rec.refundAmount, method: refundMode.toLowerCase(),
        refNo: rec.refundSlipNumber, reason: reason || `Pharmacy item return (${items.length} line(s))`,
        sourceReceiptNo: updated.billNumber, sourceMethod: updated.paymentMode,
        sourceAmount: updated.grandTotal, runningBalance: updated.balanceDue || 0,
        // R7bh-F1 / META-1: PrintAudit anchor — pharmacy refund slip
        // is tracked against its parent PharmacySale (RefundReceipt
        // entityType maps to PatientBill in the controller, but for
        // pharmacy refunds we want the printCount to land on the
        // PharmacySale; use PharmacyBill entityType so the $inc hits
        // the right collection).
        printAudit: {
          entityType:   "PharmacyBill",
          entityId:     updated._id,
          entityNumber: rec.refundSlipNumber,
          UHID:         updated.patientUHID || updated.UHID,
          patientName:  updated.patientName,
        },
      });
      // Auto-open the revised tax invoice right after — caller can keep
      // both windows side-by-side.
      setTimeout(() => {
        // R7eo-B — Pattern B caller payload gap fix: forward B2B GST
        // identity onto the revised invoice so the reprint matches the
        // original tax invoice format. billLabel stays "REVISED TAX
        // INVOICE" — this is the post-return reprint variant.
        openPrint("pharmacy-bill", {
          ...updated,
          template:     phSet?.billTemplate || 1,
          defaultPaper: phSet?.defaultPaper || "half-a4",
          pharmacySettings: phSet,
          // header overlay so the bill is clearly labelled as REVISED
          billLabel: "REVISED TAX INVOICE", revisionNote: `${updated.returns?.length || 1} return event(s) applied · latest ${rec.refundSlipNumber}`,
          customerGstin:     updated.customerGstin     || null,
          customerLegalName: updated.customerLegalName || null,
          customerAddress:   updated.customerAddress   || null,
          customerState:     updated.customerState     || null,
          placeOfSupply:     updated.placeOfSupply     || null,
          saleType:          updated.saleType          || null,
          // R7bh-F1 / META-1: PrintAudit anchor — revised invoice
          // reprint after a return event.
          printAudit: {
            entityType:   "PharmacyBill",
            entityId:     updated._id,
            entityNumber: updated.billNumber,
            UHID:         updated.patientUHID || updated.UHID,
            patientName:  updated.patientName,
          },
        });
      }, 350);

      onDone();
    } catch (e) {
      toast.error(e.message);
    } finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 12, width: "min(880px, 98vw)",
        maxHeight: "92vh", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 50px rgba(0,0,0,.25)", overflow: "hidden",
      }}>
        <div style={{ padding: "12px 18px",
          background: `linear-gradient(135deg,${C.amber},#b45309)`,
          color: "#fff", display: "flex", alignItems: "center", gap: 10,
        }}>
          <i className="pi pi-undo" style={{ fontSize: 16 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Return items · {sale.billNumber}</div>
            <div style={{ fontSize: 11, opacity: .85 }}>{sale.patientName || "Walk-in"}{sale.patientUHID && ` · ${sale.patientUHID}`} · sold {new Date(sale.createdAt).toLocaleDateString("en-IN")}</div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "rgba(255,255,255,.18)", color: "#fff", cursor: "pointer" }}><i className="pi pi-times" /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <div style={{ marginBottom: 10, padding: "8px 12px", background: C.amberL, border: `1.5px solid ${C.amber}30`, borderRadius: 7, fontSize: 11.5, color: "#92400e" }}>
            <i className="pi pi-info-circle" style={{ marginRight: 5 }} />
            Set the quantity for each item the patient is returning. The refund is recomputed live with the same GST + discount as the original line — stock will be restored to its original batch on submit.
          </div>

          <Table cols={["Drug","Batch · Expiry","Sold","Already returned","Returnable","Return now","Refund ₹"]} compact>
            {(sale.items || []).map(it => {
              const id = String(it._id);
              const sold = Number(it.quantity || 0);
              const alreadyN = Number(alreadyReturned[id] || 0);
              const remaining = sold - alreadyN;
              const pick = Number(picks[id] || 0);
              const unit = Number(it.unitPrice || 0);
              const dPct = Number(it.discountPercent || 0);
              const gPct = Number(it.gstRate || 12);
              const g = pick * unit;
              const d = g * dPct / 100;
              const net = (g - d) * (1 + gPct / 100);
              const fullyDone = remaining === 0;
              return (
                <tr key={id} style={{ borderTop: `1px solid ${C.border}`, background: fullyDone ? "#fafbfc" : "#fff" }}>
                  <td style={{ padding: "7px 10px" }}>
                    <div style={{ fontWeight: 700 }}>{it.drugName}</div>
                    <div style={{ fontSize: 10, color: C.muted }}>₹{unit.toFixed(2)}/unit · GST {gPct}%{dPct > 0 && ` · disc ${dPct}%`}</div>
                  </td>
                  <td style={{ padding: "7px 10px", fontSize: 10.5, fontFamily: "DM Mono, monospace" }}>
                    {it.batchNo || "—"}
                    <div style={{ color: C.muted, fontSize: 9.5 }}>{it.expiryDate ? new Date(it.expiryDate).toLocaleDateString("en-IN") : "—"}</div>
                  </td>
                  <td style={{ padding: "7px 10px", textAlign: "right" }}>{sold}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: alreadyN > 0 ? C.amber : C.muted }}>{alreadyN}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: remaining > 0 ? C.text : C.muted }}>{remaining}</td>
                  <td style={{ padding: "5px 10px" }}>
                    <input type="number" min="0" max={remaining} disabled={fullyDone}
                      className="his-field" style={{ width: 70, padding: "4px 8px", fontSize: 12 }}
                      value={picks[id] || ""}
                      onChange={e => setQty(id, remaining, e.target.value)}
                      placeholder={remaining > 0 ? "0" : "—"} />
                  </td>
                  <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800, color: C.green }}>
                    {pick > 0 ? `₹${net.toFixed(2)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </Table>

          <div style={{ marginTop: 14, padding: "10px 14px", background: C.subtle, border: `1px solid ${C.border}`, borderRadius: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
              <Row label="Items being returned"     value={`${summary.qtyTotal} unit(s)`} />
              <Row label="Gross"                    value={fmtINR(summary.gross)} />
              {summary.disc > 0 && <Row label="Discount" value={`− ${fmtINR(summary.disc)}`} valueColor={C.red} />}
              <Row label="Taxable"                  value={fmtINR(summary.taxable)} />
              <Row label="GST"                      value={`+ ${fmtINR(summary.gst)}`} />
              <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: 6, marginTop: 4 }}>
                <Row label="Refund to patient" value={fmtINR(summary.net)} bold large valueColor={C.green} />
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Refund mode">
              <select className="his-select" value={refundMode} onChange={e => setRefundMode(e.target.value)}>
                {["Cash","Card","UPI","Adjusted","Credit-note"].map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Reason (optional)"><input className="his-field" value={reason} onChange={e => setReason(e.target.value)} placeholder="Wrong med · adverse reaction · over-ordered" /></Field>
          </div>
          <div style={{ marginTop: 10 }}>
            <Field label="Internal notes (optional)">
              <textarea className="his-textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Batch returned to vendor on …, fitness-for-resale confirmed by …" />
            </Field>
          </div>
        </div>

        <div style={{ padding: "10px 18px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 11, color: C.muted }}>
            <i className="pi pi-info-circle" style={{ marginRight: 5 }} />
            Refund slip + revised bill will print automatically after submit.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={{ padding: "8px 14px", borderRadius: 7, border: `1.5px solid ${C.border}`, background: "#fff", color: C.muted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Cancel</button>
            <button onClick={submit} disabled={saving || summary.qtyTotal === 0}
              style={{ padding: "8px 18px", borderRadius: 7, border: "none",
                background: saving || summary.qtyTotal === 0 ? "#94a3b8" : C.amber,
                color: "#fff", fontWeight: 800, fontSize: 12,
                cursor: saving || summary.qtyTotal === 0 ? "not-allowed" : "pointer" }}>
              {saving ? "Processing…" : <><i className="pi pi-check" style={{ marginRight: 6 }} />Process return · {fmtINR(summary.net)}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   ADD ITEMS MODAL — append missed items to an already-saved bill
   via a supplementary invoice (debit note). Original items[] is
   never touched; everything goes into sale.supplements[] with a
   sequential SUP-PHM-YYYYMMDD-NNNN slip number.
══════════════════════════════════════════════════════════════════ */
function AddItemsModal({ sale, onClose, onDone }) {
  const [rollup, setRollup] = useState([]);
  const [items, setItems]   = useState([]);   // newly added items
  const [drugSearch, setDrugSearch] = useState("");
  const [paymentMode, setPaymentMode] = useState(sale.paymentMode || "Cash");
  const [reason, setReason] = useState("");
  const [notes, setNotes]   = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { (async () => {
    try { setRollup((await stockRollup()).data || []); }
    catch (e) { toast.error(e.message); }
  })(); }, []);

  const matches = useMemo(() => {
    if (!drugSearch.trim()) return [];
    const rx = new RegExp(drugSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    return rollup.filter(r => rx.test(r.drugName || "")).slice(0, 8);
  }, [drugSearch, rollup]);

  const addItem = (r) => {
    if (items.some(it => it.drugId === r.drugId)) {
      toast.info(`${r.drugName} already in addendum — update qty below`);
      return;
    }
    setItems(p => [...p, {
      drugId: r.drugId, drugName: r.drugName,
      quantity: 1, unitPrice: r.latestSale || 0, gstRate: 12, discountPercent: 0,
      available: r.totalRemaining,
    }]);
    setDrugSearch("");
  };
  const updItem = (idx, k, v) => setItems(p => p.map((it, i) => i === idx ? { ...it, [k]: v } : it));
  const rmItem  = (idx)        => setItems(p => p.filter((_, i) => i !== idx));

  const tot = useMemo(() => {
    let sub = 0, disc = 0, gst = 0;
    items.forEach(it => {
      const qty = Number(it.quantity || 0), unit = Number(it.unitPrice || 0);
      const gross = qty * unit;
      const d = gross * Number(it.discountPercent || 0) / 100;
      const tax = (gross - d) * Number(it.gstRate || 0) / 100;
      sub += gross; disc += d; gst += tax;
    });
    const grand = Math.round(((sub - disc) + gst) * 100) / 100;
    return { sub: round2(sub), disc: round2(disc), gst: round2(gst), grand };
  }, [items]);

  const submit = async () => {
    if (items.length === 0) { toast.warn("Add at least one item to the addendum"); return; }
    setSaving(true);
    try {
      const r = await addItemsToSale(sale._id, {
        items: items.map(it => ({
          drugId: it.drugId, drugName: it.drugName,
          quantity: Number(it.quantity), unitPrice: Number(it.unitPrice),
          gstRate: Number(it.gstRate), discountPercent: Number(it.discountPercent),
        })),
        paymentMode, reason, notes,
      });
      const updated = r.data.sale;
      const rec     = r.data.supplementRecord;
      toast.success(`Addendum ${rec.supplementSlipNumber} · ${fmtINR(rec.addedTotal)} added to ${sale.billNumber}`);

      // Auto-print revised tax invoice — patient + pharmacy each need a copy
      const phSet = await getCachedPhSettings();
      setTimeout(() => {
        // R7eo-B — Pattern B caller payload gap fix: forward B2B GST
        // identity onto the supplementary reprint so the debit-note
        // matches the original tax invoice. billLabel stays "REVISED
        // TAX INVOICE" — this is the post-addendum reprint variant.
        openPrint("pharmacy-bill", {
          ...updated,
          template:     phSet?.billTemplate || 1,
          defaultPaper: phSet?.defaultPaper || "half-a4",
          pharmacySettings: phSet,
          billLabel: "REVISED TAX INVOICE",
          revisionNote: `Supplementary slip ${rec.supplementSlipNumber} · ${fmtINR(rec.addedTotal)} added`,
          customerGstin:     updated.customerGstin     || null,
          customerLegalName: updated.customerLegalName || null,
          customerAddress:   updated.customerAddress   || null,
          customerState:     updated.customerState     || null,
          placeOfSupply:     updated.placeOfSupply     || null,
          saleType:          updated.saleType          || null,
          // R7bh-F1 / META-1: PrintAudit anchor — supplementary
          // (debit-note) reprint tracked against the parent sale.
          printAudit: {
            entityType:   "PharmacyBill",
            entityId:     updated._id,
            entityNumber: updated.billNumber,
            UHID:         updated.patientUHID || updated.UHID,
            patientName:  updated.patientName,
          },
        });
      }, 350);

      onDone();
    } catch (e) {
      toast.error(e.message);
    } finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 12, width: "min(880px, 98vw)",
        maxHeight: "92vh", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 50px rgba(0,0,0,.25)", overflow: "hidden",
      }}>
        <div style={{ padding: "12px 18px",
          background: `linear-gradient(135deg,${C.green},#15803d)`,
          color: "#fff", display: "flex", alignItems: "center", gap: 10,
        }}>
          <i className="pi pi-plus-circle" style={{ fontSize: 16 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Add items · {sale.billNumber}</div>
            <div style={{ fontSize: 11, opacity: .85 }}>{sale.patientName || "Walk-in"}{sale.patientUHID && ` · ${sale.patientUHID}`} · sold {new Date(sale.createdAt).toLocaleDateString("en-IN")}</div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "rgba(255,255,255,.18)", color: "#fff", cursor: "pointer" }}><i className="pi pi-times" /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <div style={{ marginBottom: 10, padding: "8px 12px", background: "#dcfce7", border: "1.5px solid #16a34a30", borderRadius: 7, fontSize: 11.5, color: "#166534" }}>
            <i className="pi pi-info-circle" style={{ marginRight: 5 }} />
            Items added here become a <b>supplementary invoice</b> (GST debit note) linked to the original bill. The original tax invoice stays unchanged — both prints together form the complete sale.
          </div>

          <div style={{ position: "relative", marginBottom: 10 }}>
            <input className="his-field" placeholder="Search drug to add…"
              value={drugSearch} onChange={e => setDrugSearch(e.target.value)} />
            {matches.length > 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: "0 8px 20px rgba(0,0,0,.1)", maxHeight: 240, overflow: "auto", zIndex: 10 }}>
                {matches.map(m => (
                  <button key={m.drugId} onClick={() => addItem(m)}
                    style={{ width: "100%", padding: "8px 12px", border: "none", background: "#fff", textAlign: "left", cursor: "pointer", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ fontWeight: 700 }}>{m.drugName}</span>
                    <span style={{ color: C.muted }}>Stock: {m.totalRemaining} · {fmtINR(m.latestSale)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <Table cols={["Drug","Qty","Unit ₹","GST %","Disc %","Net ₹",""]} compact>
            {items.length === 0
              ? <EmptyRow span={7} text="No items yet — search a drug above to add to the addendum." />
              : items.map((it, idx) => {
                const gross = (it.quantity || 0) * (it.unitPrice || 0);
                const dAmt  = gross * (it.discountPercent || 0) / 100;
                const gAmt  = (gross - dAmt) * (it.gstRate || 0) / 100;
                const net   = (gross - dAmt) + gAmt;
                const overStock = Number(it.quantity) > it.available;
                return (
                  <tr key={idx} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: "6px 10px" }}>
                      <div style={{ fontWeight: 700 }}>{it.drugName}</div>
                      <div style={{ fontSize: 10, color: overStock ? C.red : C.muted }}>
                        Available: {it.available}{overStock && " · over-stock!"}
                      </div>
                    </td>
                    <td style={{ padding: "4px 10px" }}>
                      <input type="number" className="his-field" style={{ width: 70, padding: "4px 6px", fontSize: 11, borderColor: overStock ? C.red : undefined }}
                        value={it.quantity} onChange={e => updItem(idx, "quantity", e.target.value)} />
                    </td>
                    <td style={{ padding: "4px 10px" }}>
                      <input type="number" className="his-field" style={{ width: 80, padding: "4px 6px", fontSize: 11 }}
                        value={it.unitPrice} onChange={e => updItem(idx, "unitPrice", e.target.value)} />
                    </td>
                    <td style={{ padding: "4px 10px" }}>
                      <input type="number" className="his-field" style={{ width: 60, padding: "4px 6px", fontSize: 11 }}
                        value={it.gstRate} onChange={e => updItem(idx, "gstRate", e.target.value)} />
                    </td>
                    <td style={{ padding: "4px 10px" }}>
                      <input type="number" className="his-field" style={{ width: 60, padding: "4px 6px", fontSize: 11 }}
                        value={it.discountPercent} onChange={e => updItem(idx, "discountPercent", e.target.value)} />
                    </td>
                    <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, color: C.green }}>{fmtINR(net)}</td>
                    <td style={{ padding: "4px 10px", textAlign: "center" }}>
                      <button onClick={() => rmItem(idx)} title="Remove"
                        style={{ width: 22, height: 22, borderRadius: 4, border: "none", background: C.redL, color: C.red, cursor: "pointer", fontSize: 11 }}>
                        <i className="pi pi-times" />
                      </button>
                    </td>
                  </tr>
                );
              })}
          </Table>

          <div style={{ marginTop: 12, padding: "10px 14px", background: C.subtle, borderRadius: 8, border: `1px solid ${C.border}` }}>
            <Row label="Subtotal" value={fmtINR(tot.sub)} />
            <Row label="Discount" value={`− ${fmtINR(tot.disc)}`} valueColor={C.muted} />
            <Row label="GST" value={`+ ${fmtINR(tot.gst)}`} valueColor={C.muted} />
            <div style={{ borderTop: `1px dashed ${C.border}`, marginTop: 6, paddingTop: 6 }}>
              <Row label="Addendum total" value={fmtINR(tot.grand)} valueColor={C.green} bold large />
            </div>
          </div>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Payment mode">
              <select className="his-select" value={paymentMode} onChange={e => setPaymentMode(e.target.value)}>
                {["Cash","Card","UPI","Mixed","Credit"].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Reason (optional)">
              <input className="his-field" value={reason} onChange={e => setReason(e.target.value)} placeholder="Missed at counter · doctor added later" />
            </Field>
          </div>
          <div style={{ marginTop: 10 }}>
            <Field label="Internal notes (optional)">
              <textarea className="his-textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any operational note for the audit log" />
            </Field>
          </div>
        </div>

        <div style={{ padding: "10px 16px", borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 10.5, color: C.muted }}>
            <i className="pi pi-print" style={{ marginRight: 5 }} />
            A revised tax invoice will print automatically after submit.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 7, border: `1.5px solid ${C.border}`, background: "#fff", color: C.muted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Cancel</button>
            <button onClick={submit} disabled={saving || items.length === 0}
              style={{ padding: "8px 18px", borderRadius: 7, border: "none",
                background: saving || items.length === 0 ? "#86efac" : C.green,
                color: "#fff", fontWeight: 800, fontSize: 12, cursor: saving || items.length === 0 ? "not-allowed" : "pointer" }}>
              {saving ? "Adding…" : <><i className="pi pi-check" style={{ marginRight: 6 }} />Add items · {fmtINR(tot.grand)}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function round2(n) { return Math.round(n * 100) / 100; }

/* ════════════════════════════════════════════════════════════════
   SUPPLIERS TAB
══════════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════
   REGISTERS TAB — D&C Rules + GST mandated audit logs
══════════════════════════════════════════════════════════════════ */
const REGISTER_DEFS = [
  { key: "sales",      label: "Sales Register",    icon: "pi-receipt",   color: C.green,  desc: "Bill-wise GST · CGST/SGST split per HSN" },
  { key: "purchase",   label: "Purchase Register", icon: "pi-download",  color: C.purple, desc: "GRN-wise input tax credit · supplier-wise" },
  { key: "stock",      label: "Stock Register",    icon: "pi-box",       color: C.blue,   desc: "Form 35 · opening + receipt + issue + closing per drug" },
  { key: "schedule-h", label: "Schedule H/H1/X",   icon: "pi-shield",    color: C.red,    desc: "Rx-mandatory drugs · prescriber + patient · D&C audit" },
  { key: "expiry",     label: "Expiry Register",   icon: "pi-clock",     color: C.amber,  desc: "Batches expiring soon + already expired · return-to-vendor" },
  { key: "gst",        label: "GST Summary",       icon: "pi-percentage",color: C.pink,   desc: "GSTR-1 / GSTR-3B feeder · daily / monthly totals" },
];

function RegistersTab() {
  const [reg, setReg] = useState("sales");
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const [from, setFrom] = useState(monthStart);
  const [to,   setTo]   = useState(today);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchers = {
    sales:        getSalesRegister,
    purchase:     getPurchaseRegister,
    stock:        getStockRegister,
    "schedule-h": getScheduleHRegister,
    expiry:       getExpiryRegister,
    gst:          getGstSummary,
  };

  /* Build a print payload tailored to whichever register is active.
     Each register has its own column shape, so we map them per key.
     Routes through openPrint("pharmacy-register", ...) → opens the
     standard print window with paper-size + hospital header. */
  const printRegister = async () => {
    if (!data) { toast.warn("No data to print"); return; }
    const phSet = await getCachedPhSettings();
    const meta  = REGISTER_DEFS.find(r => r.key === reg);
    const subtitle = reg === "expiry"
      ? "Batches expiring within 90 days"
      : `${new Date(from).toLocaleDateString("en-IN")} → ${new Date(to).toLocaleDateString("en-IN")}`;

    const fmtMoney = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

    let columns = [], rows = [], totals = {};
    if (reg === "sales") {
      columns = [
        { key: "date",       label: "Date",     nowrap: true, muted: true },
        { key: "billNumber", label: "Bill #",   mono: true,   bold: true },
        { key: "patientName",label: "Patient" },
        { key: "ref",        label: "UHID/Adm", muted: true },
        { key: "saleType",   label: "Type",     nowrap: true },
        { key: "itemsCount", label: "Items",    align: "right" },
        { key: "taxable",    label: "Taxable",  align: "right" },
        { key: "cgst",       label: "CGST",     align: "right", muted: true },
        { key: "sgst",       label: "SGST",     align: "right", muted: true },
        { key: "grand",      label: "Grand",    align: "right", bold: true },
        { key: "paymentMode",label: "Pay" },
      ];
      rows = (data.rows || []).map(r => ({
        date: new Date(r.date).toLocaleDateString("en-IN"),
        billNumber: r.billNumber, patientName: r.patientName,
        ref: r.admissionNumber || r.patientUHID || "—",
        saleType: r.saleType, itemsCount: r.itemsCount,
        taxable: fmtMoney(r.taxable), cgst: fmtMoney(r.cgst), sgst: fmtMoney(r.sgst),
        grand: `₹${fmtMoney(r.grandTotal)}`, paymentMode: r.paymentMode,
      }));
      totals = data.totals && {
        Bills: data.totals.bills,
        "Taxable": `₹${fmtMoney(data.totals.taxable)}`,
        "GST": `₹${fmtMoney(data.totals.gstTotal)}`,
        "Grand total": `₹${fmtMoney(data.totals.grandTotal)}`,
      };
    } else if (reg === "purchase") {
      columns = [
        { key: "date",     label: "GRN Date", nowrap: true, muted: true },
        { key: "grn",      label: "GRN #",    mono: true },
        { key: "invoice",  label: "Invoice #",mono: true },
        { key: "supplier", label: "Supplier" },
        { key: "drug",     label: "Drug",     bold: true },
        { key: "hsn",      label: "HSN" },
        { key: "batch",    label: "Batch",    mono: true },
        { key: "expiry",   label: "Expiry",   muted: true },
        { key: "qty",      label: "Qty",      align: "right" },
        { key: "rate",     label: "Rate",     align: "right" },
        { key: "taxable",  label: "Taxable",  align: "right" },
        { key: "tax",      label: "GST",      align: "right", muted: true },
        { key: "gross",    label: "Gross",    align: "right", bold: true },
      ];
      rows = (data.rows || []).map(r => ({
        date: new Date(r.invoiceDate).toLocaleDateString("en-IN"),
        grn: r.grnNumber, invoice: r.invoiceNo, supplier: r.supplier, drug: r.drug,
        hsn: r.hsn, batch: r.batch,
        expiry: r.expiry ? new Date(r.expiry).toLocaleDateString("en-IN") : "—",
        qty: r.qty, rate: fmtMoney(r.rate),
        taxable: fmtMoney(r.taxable), tax: fmtMoney(r.tax), gross: `₹${fmtMoney(r.gross)}`,
      }));
      totals = data.totals && {
        GRNs: data.totals.grnCount, "Taxable": `₹${fmtMoney(data.totals.taxable)}`,
        "Input GST": `₹${fmtMoney(data.totals.tax)}`,
        "Gross": `₹${fmtMoney(data.totals.gross)}`,
      };
    } else if (reg === "stock") {
      columns = [
        { key: "drugName", label: "Drug", bold: true },
        { key: "category", label: "Category", muted: true },
        { key: "hsn",      label: "HSN" },
        { key: "opening",  label: "Opening", align: "right" },
        { key: "receipts", label: "Receipts", align: "right" },
        { key: "issued",   label: "Issued",   align: "right" },
        { key: "closing",  label: "Closing",  align: "right", bold: true },
        { key: "reorder",  label: "Reorder",  align: "right", muted: true },
        { key: "status",   label: "Status",   nowrap: true },
      ];
      rows = (data.rows || []).map(r => ({
        drugName: r.drugName, category: r.category, hsn: r.hsn,
        opening: r.opening, receipts: `+${r.receipts}`, issued: `−${r.issued}`,
        closing: r.closing, reorder: r.reorderLevel,
        status: r.closing < r.reorderLevel ? "BELOW REORDER" : "OK",
      }));
      totals = { "Drugs with movement": (data.rows || []).length };
    } else if (reg === "schedule-h") {
      columns = [
        { key: "date",       label: "Date",   nowrap: true, muted: true },
        { key: "billNumber", label: "Bill #", mono: true },
        { key: "patientName",label: "Patient", bold: true },
        { key: "patientUHID",label: "UHID" },
        { key: "doctorName", label: "Doctor" },
        { key: "rx",         label: "Rx Ref"  },
        { key: "drugName",   label: "Drug",   bold: true },
        { key: "schedule",   label: "Sch" },
        { key: "batch",      label: "Batch",  mono: true },
        { key: "expiry",     label: "Expiry", muted: true },
        { key: "qty",        label: "Qty",    align: "right", bold: true },
        { key: "flags",      label: "Flags" },
      ];
      rows = (data.rows || []).map(r => ({
        date: new Date(r.date).toLocaleString("en-IN"),
        billNumber: r.billNumber, patientName: r.patientName, patientUHID: r.patientUHID,
        doctorName: r.doctorName, rx: r.prescriptionRef, drugName: r.drugName,
        schedule: r.schedule, batch: r.batchNo,
        expiry: r.expiryDate ? new Date(r.expiryDate).toLocaleDateString("en-IN") : "—",
        qty: r.quantity,
        flags: [r.isHighAlert && "HAM", r.isNarcotic && "NARC"].filter(Boolean).join(" · ") || "—",
      }));
      totals = { "Rx dispenses": (data.rows || []).length };
    } else if (reg === "expiry") {
      columns = [
        { key: "drug",     label: "Drug",      bold: true },
        { key: "category", label: "Category",  muted: true },
        { key: "batchNo",  label: "Batch",     mono: true },
        { key: "supplier", label: "Supplier" },
        { key: "expiry",   label: "Expiry",    nowrap: true },
        { key: "days",     label: "Days",      nowrap: true, bold: true },
        { key: "remaining",label: "Qty",       align: "right", bold: true },
        { key: "rate",     label: "Sale ₹",    align: "right" },
        { key: "value",    label: "Value",     align: "right", bold: true },
        { key: "status",   label: "Status",    nowrap: true },
      ];
      rows = (data.rows || []).map(r => ({
        drug: r.drug, category: r.category, batchNo: r.batchNo, supplier: r.supplier,
        expiry: new Date(r.expiryDate).toLocaleDateString("en-IN"),
        days: r.daysToExpiry < 0 ? `${Math.abs(r.daysToExpiry)}d ago` : `${r.daysToExpiry}d`,
        remaining: r.remaining, rate: fmtMoney(r.salePrice),
        value: `₹${fmtMoney(r.value)}`, status: r.status,
      }));
      totals = { Batches: (data.rows || []).length, "Locked value": `₹${fmtMoney(data.totalValue)}` };
    } else if (reg === "gst") {
      columns = [
        { key: "gstRate",   label: "GST Slab", bold: true },
        { key: "billCount", label: "Bills" },
        { key: "qty",       label: "Qty",       align: "right" },
        { key: "taxable",   label: "Taxable",   align: "right" },
        { key: "cgst",      label: "CGST",      align: "right" },
        { key: "sgst",      label: "SGST",      align: "right" },
        { key: "tax",       label: "Total Tax", align: "right", bold: true },
        { key: "gross",     label: "Gross",     align: "right", bold: true },
      ];
      rows = (data.buckets || []).map(b => ({
        gstRate: `${b.gstRate}%`, billCount: b.billCount, qty: b.qty,
        taxable: fmtMoney(b.taxable), cgst: fmtMoney(b.cgst), sgst: fmtMoney(b.sgst),
        tax: fmtMoney(b.tax), gross: `₹${fmtMoney(b.taxable + b.tax)}`,
      }));
      totals = {
        Taxable: `₹${fmtMoney(data.grandTaxable)}`,
        CGST:    `₹${fmtMoney(data.grandCGST)}`,
        SGST:    `₹${fmtMoney(data.grandSGST)}`,
        "Total tax": `₹${fmtMoney(data.grandTax)}`,
      };
    }

    // Pass header style + paper + orientation EXPLICITLY (not just inside
    // pharmacySettings) so the printable never silently falls back to its
    // hardcoded defaults if the settings doc is stale or unreachable.
    //
    // IMPORTANT: registers always default to A4. The pharmacySettings.defaultPaper
    // is the user's preferred paper for BILLS (typically Half-A4 receipts) —
    // registers routinely have 50+ rows and would either get clipped or repeat
    // uselessly on Half-A4 doubling mode. The toolbar still lets the operator
    // switch to Half-A4 manually if they really want.
    openPrint("pharmacy-register", {
      type:  reg, title: meta?.label || "Register", subtitle,
      color: meta?.color || "#475569",
      columns, rows, totals,
      headerStyle:   phSet?.registerHeader || 1,
      defaultPaper:  "a4",
      defaultOrient: phSet?.registerOrientation || "portrait",
      pharmacySettings: phSet,
    });
  };

  const load = async () => {
    setLoading(true);
    try {
      const params = reg === "expiry" ? { within: 90 }
                    : reg === "stock" ? { from, to }
                    : { from, to };
      const r = await fetchers[reg](params);
      setData(r.data);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [reg, from, to]);

  return (
    <div>
      {/* Register switcher chips */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, marginBottom: 14 }}>
        {REGISTER_DEFS.map(r => {
          const active = reg === r.key;
          return (
            <button key={r.key} onClick={() => setReg(r.key)}
              style={{
                padding: "12px 14px", borderRadius: 10,
                border: `1.5px solid ${active ? r.color : C.border}`,
                background: active ? `${r.color}08` : "#fff",
                cursor: "pointer", textAlign: "left",
                display: "flex", alignItems: "center", gap: 10,
                transition: "all .15s",
              }}>
              <div style={{
                width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                background: r.color + (active ? "20" : "10"),
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <i className={`pi ${r.icon}`} style={{ color: r.color, fontSize: 15 }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 12.5, color: active ? r.color : C.text }}>{r.label}</div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Print button always available (expiry register has no date range) */}
      {reg === "expiry" && (
        <div style={{ marginBottom: 14, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={printRegister}
            style={{ padding: "8px 16px", borderRadius: 8, border: `1.5px solid ${C.orange}`, background: "#fff", color: C.orange, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            <i className="pi pi-print" style={{ marginRight: 6 }} />Print register
          </button>
        </div>
      )}

      {/* Date range (except for Expiry which uses days-within) */}
      {reg !== "expiry" && (
        <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Field label="From"><input type="date" className="his-field" value={from} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className="his-field" value={to} onChange={e => setTo(e.target.value)} /></Field>
          <div style={{ flex: 1 }} />
          <button onClick={load} disabled={loading}
            style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: loading ? "#94a3b8" : C.orange, color: "#fff", fontWeight: 700, fontSize: 12, cursor: loading ? "not-allowed" : "pointer" }}>
            <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} style={{ marginRight: 6 }} />Refresh
          </button>
          <button onClick={printRegister}
            style={{ padding: "8px 16px", borderRadius: 8, border: `1.5px solid ${C.orange}`, background: "#fff", color: C.orange, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            <i className="pi pi-print" style={{ marginRight: 6 }} />Print register
          </button>
        </div>
      )}

      {/* Body per register */}
      {reg === "sales"      && <SalesRegisterTbl      data={data} loading={loading} />}
      {reg === "purchase"   && <PurchaseRegisterTbl   data={data} loading={loading} />}
      {reg === "stock"      && <StockRegisterTbl      data={data} loading={loading} />}
      {reg === "schedule-h" && <ScheduleHRegisterTbl  data={data} loading={loading} />}
      {reg === "expiry"     && <ExpiryRegisterTbl     data={data} loading={loading} />}
      {reg === "gst"        && <GstSummaryTbl         data={data} loading={loading} />}
    </div>
  );
}

function _RegisterShell({ title, color, totals, children }) {
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(15,23,42,.04)" }}>
      <div style={{ padding: "10px 16px", background: `${color}08`, borderBottom: `1px solid ${color}20`, display: "flex", alignItems: "center", gap: 12 }}>
        <i className="pi pi-book" style={{ color, fontSize: 14 }} />
        <span style={{ fontWeight: 800, fontSize: 13, color }}>{title}</span>
        {totals}
      </div>
      <div style={{ overflowX: "auto" }}>{children}</div>
    </div>
  );
}

function SalesRegisterTbl({ data, loading }) {
  if (loading) return <Card title="Loading…" color={C.green} icon="pi-spin pi-spinner"><div /></Card>;
  const rows = data?.rows || [];
  const t = data?.totals;
  return (
    <_RegisterShell title="Sales Register" color={C.green}
      totals={t && <span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>
        {t.bills} bills · taxable {fmtINR(t.taxable)} · GST {fmtINR(t.gstTotal)} · <b style={{ color: C.green }}>{fmtINR(t.grandTotal)}</b>
      </span>}>
      <Table cols={["Date","Bill #","Patient","UHID/Adm","Type","Items","Taxable","CGST","SGST","Total","Pay"]} compact>
        {rows.length === 0 ? <EmptyRow span={11} text="No bills in this range." /> :
          rows.map(r => (
            <tr key={r._id} style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={{ padding: "6px 10px", color: C.muted }}>{new Date(r.date).toLocaleDateString("en-IN")}</td>
              <td style={{ padding: "6px 10px", fontFamily: "DM Mono, monospace", fontSize: 11 }}>{r.billNumber}</td>
              <td style={{ padding: "6px 10px" }}>{r.patientName}</td>
              <td style={{ padding: "6px 10px", color: C.muted, fontSize: 11 }}>{r.admissionNumber || r.patientUHID || "—"}</td>
              <td style={{ padding: "6px 10px" }}>{r.saleType}</td>
              <td style={{ padding: "6px 10px" }}>{r.itemsCount}</td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>{fmtINR(r.taxable)}</td>
              <td style={{ padding: "6px 10px", textAlign: "right", color: C.muted }}>{fmtINR(r.cgst)}</td>
              <td style={{ padding: "6px 10px", textAlign: "right", color: C.muted }}>{fmtINR(r.sgst)}</td>
              <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700 }}>{fmtINR(r.grandTotal)}</td>
              <td style={{ padding: "6px 10px" }}>{r.paymentMode}</td>
            </tr>
          ))}
      </Table>
    </_RegisterShell>
  );
}

function PurchaseRegisterTbl({ data, loading }) {
  if (loading) return null;
  const rows = data?.rows || []; const t = data?.totals;
  return (
    <_RegisterShell title="Purchase Register" color={C.purple}
      totals={t && <span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>
        {t.grnCount} GRNs · taxable {fmtINR(t.taxable)} · input GST {fmtINR(t.tax)} · gross <b style={{ color: C.purple }}>{fmtINR(t.gross)}</b>
      </span>}>
      <Table cols={["GRN Date","GRN #","Invoice #","Supplier","Drug","HSN","Batch","Expiry","Qty","Rate","Taxable","GST","Gross"]} compact>
        {rows.length === 0 ? <EmptyRow span={13} text="No purchases recorded in this range." /> :
          rows.map(r => (
            <tr key={r._id} style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={{ padding: "6px 10px", color: C.muted }}>{new Date(r.invoiceDate).toLocaleDateString("en-IN")}</td>
              <td style={{ padding: "6px 10px", fontFamily: "DM Mono, monospace", fontSize: 10.5 }}>{r.grnNumber}</td>
              <td style={{ padding: "6px 10px", fontFamily: "DM Mono, monospace", fontSize: 10.5 }}>{r.invoiceNo}</td>
              <td style={{ padding: "6px 10px" }}>{r.supplier}</td>
              <td style={{ padding: "6px 10px", fontWeight: 600 }}>{r.drug}</td>
              <td style={{ padding: "6px 10px" }}>{r.hsn}</td>
              <td style={{ padding: "6px 10px", fontFamily: "DM Mono, monospace", fontSize: 10 }}>{r.batch}</td>
              <td style={{ padding: "6px 10px", color: C.muted }}>{fmtDate(r.expiry)}</td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>{r.qty}</td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>{fmtINR(r.rate)}</td>
              <td style={{ padding: "6px 10px", textAlign: "right" }}>{fmtINR(r.taxable)}</td>
              <td style={{ padding: "6px 10px", textAlign: "right", color: C.muted }}>{fmtINR(r.tax)}</td>
              <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700 }}>{fmtINR(r.gross)}</td>
            </tr>
          ))}
      </Table>
    </_RegisterShell>
  );
}

function StockRegisterTbl({ data, loading }) {
  if (loading) return null;
  const rows = data?.rows || [];
  return (
    <_RegisterShell title="Stock Register · Form 35" color={C.blue}
      totals={<span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>{rows.length} drugs with movement</span>}>
      <Table cols={["Drug","Category","HSN","Opening","Receipts","Issued","Closing","Reorder","Status"]} compact>
        {rows.length === 0 ? <EmptyRow span={9} text="No stock movement in this range." /> :
          rows.map(r => {
            const low = r.closing < r.reorderLevel;
            return (
              <tr key={r.drugId} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: "6px 10px", fontWeight: 600 }}>{r.drugName}</td>
                <td style={{ padding: "6px 10px", color: C.muted }}>{r.category}</td>
                <td style={{ padding: "6px 10px" }}>{r.hsn}</td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>{r.opening}</td>
                <td style={{ padding: "6px 10px", textAlign: "right", color: C.green }}>+{r.receipts}</td>
                <td style={{ padding: "6px 10px", textAlign: "right", color: C.red }}>−{r.issued}</td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 800 }}>{r.closing}</td>
                <td style={{ padding: "6px 10px", color: C.muted }}>{r.reorderLevel}</td>
                <td style={{ padding: "6px 10px" }}>
                  <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 9.5, fontWeight: 800,
                    background: low ? C.redL : C.greenL, color: low ? C.red : C.green,
                    border: `1px solid ${low ? C.red : C.green}30` }}>
                    {low ? "BELOW REORDER" : "OK"}
                  </span>
                </td>
              </tr>
            );
          })}
      </Table>
    </_RegisterShell>
  );
}

function ScheduleHRegisterTbl({ data, loading }) {
  if (loading) return null;
  const rows = data?.rows || [];
  return (
    <_RegisterShell title="Schedule H / H1 / X Register" color={C.red}
      totals={<span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>{rows.length} prescription-mandatory dispenses</span>}>
      <Table cols={["Date","Bill #","Patient","UHID","Doctor","Rx Ref","Drug","Schedule","Batch","Expiry","Qty","Flags"]} compact>
        {rows.length === 0 ? <EmptyRow span={12} text="No Schedule H drugs dispensed in this range." /> :
          rows.map((r, i) => (
            <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={{ padding: "6px 10px", color: C.muted }}>{new Date(r.date).toLocaleString("en-IN")}</td>
              <td style={{ padding: "6px 10px", fontFamily: "DM Mono, monospace", fontSize: 10.5 }}>{r.billNumber}</td>
              <td style={{ padding: "6px 10px", fontWeight: 600 }}>{r.patientName}</td>
              <td style={{ padding: "6px 10px" }}>{r.patientUHID}</td>
              <td style={{ padding: "6px 10px" }}>{r.doctorName}</td>
              <td style={{ padding: "6px 10px", fontSize: 10.5 }}>{r.prescriptionRef}</td>
              <td style={{ padding: "6px 10px", fontWeight: 600 }}>{r.drugName}</td>
              <td style={{ padding: "6px 10px" }}>
                <span style={{ padding: "2px 8px", borderRadius: 4, background: C.redL, color: C.red, fontWeight: 800, fontSize: 9.5, border: `1px solid ${C.red}30` }}>
                  Sch {r.schedule}
                </span>
              </td>
              <td style={{ padding: "6px 10px", fontFamily: "DM Mono, monospace", fontSize: 10 }}>{r.batchNo}</td>
              <td style={{ padding: "6px 10px", color: C.muted }}>{fmtDate(r.expiryDate)}</td>
              <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700 }}>{r.quantity}</td>
              <td style={{ padding: "6px 10px" }}>
                {r.isHighAlert && <span style={{ marginRight: 4, padding: "1px 5px", borderRadius: 3, background: "#fee2e2", color: C.red, fontWeight: 800, fontSize: 9 }}>HAM</span>}
                {r.isNarcotic  && <span style={{ padding: "1px 5px", borderRadius: 3, background: "#fef3c7", color: C.amber, fontWeight: 800, fontSize: 9 }}>NARC</span>}
              </td>
            </tr>
          ))}
      </Table>
    </_RegisterShell>
  );
}

function ExpiryRegisterTbl({ data, loading }) {
  if (loading) return null;
  const rows = data?.rows || [];
  const totalValue = data?.totalValue || 0;
  const statusC = {
    EXPIRED: { c: C.red,   bg: C.redL },
    URGENT:  { c: C.red,   bg: C.redL },
    SOON:    { c: C.amber, bg: C.amberL },
    WATCH:   { c: C.blue,  bg: C.blueL },
  };
  return (
    <_RegisterShell title="Expiry Register · next 90 days" color={C.amber}
      totals={<span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>{rows.length} batches · value <b style={{ color: C.amber }}>{fmtINR(totalValue)}</b></span>}>
      <Table cols={["Drug","Category","Batch","Supplier","Expiry","Days","Remaining","Sale ₹","Value","Status"]} compact>
        {rows.length === 0 ? <EmptyRow span={10} text="No batches expiring within 90 days." /> :
          rows.map((r, i) => {
            const st = statusC[r.status] || statusC.WATCH;
            return (
              <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: "6px 10px", fontWeight: 600 }}>{r.drug}</td>
                <td style={{ padding: "6px 10px", color: C.muted }}>{r.category}</td>
                <td style={{ padding: "6px 10px", fontFamily: "DM Mono, monospace", fontSize: 10 }}>{r.batchNo}</td>
                <td style={{ padding: "6px 10px" }}>{r.supplier}</td>
                <td style={{ padding: "6px 10px", color: r.daysToExpiry < 0 ? C.red : C.amber, fontWeight: 700 }}>{fmtDate(r.expiryDate)}</td>
                <td style={{ padding: "6px 10px", color: r.daysToExpiry < 0 ? C.red : C.muted, fontWeight: 700 }}>{r.daysToExpiry < 0 ? `${Math.abs(r.daysToExpiry)}d ago` : `${r.daysToExpiry}d`}</td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700 }}>{r.remaining}</td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>{fmtINR(r.salePrice)}</td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700 }}>{fmtINR(r.value)}</td>
                <td style={{ padding: "6px 10px" }}>
                  <span style={{ padding: "2px 8px", borderRadius: 4, background: st.bg, color: st.c, fontWeight: 800, fontSize: 9.5, border: `1px solid ${st.c}30` }}>{r.status}</span>
                </td>
              </tr>
            );
          })}
      </Table>
    </_RegisterShell>
  );
}

function GstSummaryTbl({ data, loading }) {
  if (loading) return null;
  const buckets = data?.buckets || [];
  return (
    <_RegisterShell title="GST Summary · GSTR-1 / GSTR-3B feeder" color={C.pink}
      totals={<span style={{ fontSize: 11, color: C.muted, marginLeft: "auto" }}>
        Taxable <b>{fmtINR(data?.grandTaxable)}</b> · CGST {fmtINR(data?.grandCGST)} · SGST {fmtINR(data?.grandSGST)} · Total tax <b style={{ color: C.pink }}>{fmtINR(data?.grandTax)}</b>
      </span>}>
      <Table cols={["GST Slab","Bills","Qty","Taxable","CGST","SGST","Total Tax","Gross"]} compact>
        {buckets.length === 0 ? <EmptyRow span={8} text="No taxable sales in this range." /> :
          buckets.map(b => (
            <tr key={b.gstRate} style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={{ padding: "7px 10px", fontWeight: 800, color: C.pink }}>{b.gstRate}%</td>
              <td style={{ padding: "7px 10px" }}>{b.billCount}</td>
              <td style={{ padding: "7px 10px", textAlign: "right" }}>{b.qty}</td>
              <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtINR(b.taxable)}</td>
              <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtINR(b.cgst)}</td>
              <td style={{ padding: "7px 10px", textAlign: "right" }}>{fmtINR(b.sgst)}</td>
              <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700 }}>{fmtINR(b.tax)}</td>
              <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700 }}>{fmtINR(b.taxable + b.tax)}</td>
            </tr>
          ))}
      </Table>
    </_RegisterShell>
  );
}

/* ════════════════════════════════════════════════════════════════
   SETTINGS TAB — Pharmacy identity (in-house vs outsourced)
══════════════════════════════════════════════════════════════════ */
/* Demo data driving the template thumbnails + preview modal. Real
   pharmacy data isn't fetched here — every template renders the same
   sample bill so users can compare layouts apples-to-apples. */
const DEMO_BILL = {
  billNumber: "PHM-DEMO-0042",
  createdAt: new Date().toISOString(),
  patientName: "Mrs. Asha Sharma", patientUHID: "UH00000099",
  age: 52, gender: "Female", contactNumber: "+91-9876543210",
  doctorName: "Dr. Mehta", admissionNumber: "ADM-2026-0042",
  saleType: "IPD", paymentMode: "Cash", createdBy: "Pharmacist · Mr. Sharma",
  items: [
    { drugName: "Paracetamol 500mg", strength: "500mg · Tablet",  hsnCode: "30049011", batchNo: "PAR-001", expiryDate: "2027-09-01", quantity: 20, unitPrice: 2.5, gstRate: 12, discountPercent: 0, schedule: "OTC" },
    { drugName: "Azithromycin 500mg", strength: "500mg · Tablet", hsnCode: "30049099", batchNo: "AZI-021", expiryDate: "2027-06-15", quantity: 5,  unitPrice: 78,  gstRate: 12, discountPercent: 5, schedule: "H"   },
    { drugName: "Pantoprazole 40mg",  strength: "40mg · Tablet",  hsnCode: "30049079", batchNo: "PAN-088", expiryDate: "2028-02-28", quantity: 10, unitPrice: 8.5, gstRate: 12, discountPercent: 0, schedule: "H"   },
    { drugName: "Insulin Actrapid",   strength: "40 IU/mL · 10mL",hsnCode: "30043910", batchNo: "ACT-17", expiryDate: "2026-12-31", quantity: 1,  unitPrice: 165, gstRate: 5,  discountPercent: 0, schedule: "H"   },
  ],
};
const DEMO_SETTINGS = {
  hospitalName: "SphereHealth Multispeciality Hospital",
  tagline: "Compassionate care · NABH accredited",
  showLogoInPrint: false,
  addressLine1: "Plot 12, Sector 21", city: "New Delhi", state: "Delhi", pincode: "110001",
  phone1: "+91-11-4567-8900", email: "info@spherehealth.com",
  gstin: "07ABCDE1234F1Z5", drugLicenseNo: "DL/20B/2024-001",
  bankName: "HDFC Bank", accountNo: "XXXXXXXX1234", ifscCode: "HDFC0000123",
  printHeaderColor: "#1e293b", printAccentColor: "#1d4ed8",
  billFooterNote: "Thank you for choosing SphereHealth — get well soon!",
  termsLine1: "Goods once sold are not returnable unless the seal is intact (within 7 days).",
  termsLine2: "Medicines must be stored as per pack instructions.",
  termsLine3: "This is a computer-generated invoice. Subject to local jurisdiction.",
};

/* Sample register data so each header style renders with real content
   in the thumbnail and modal previews. */
const DEMO_REGISTER = {
  type: "sales",
  title: "Sales Register",
  subtitle: "01 May 2026 → 14 May 2026",
  color: "#16a34a",
  columns: [
    { key: "date",       label: "Date",      nowrap: true, muted: true },
    { key: "billNumber", label: "Bill #",    mono: true, bold: true },
    { key: "patient",    label: "Patient" },
    { key: "taxable",    label: "Taxable",   align: "right" },
    { key: "cgst",       label: "CGST",      align: "right", muted: true },
    { key: "sgst",       label: "SGST",      align: "right", muted: true },
    { key: "grand",      label: "Grand",     align: "right", bold: true },
  ],
  rows: [
    { date: "14 May 2026", billNumber: "PHM-DEMO-0042", patient: "Asha Sharma",       taxable: "165.00", cgst: "9.90",  sgst: "9.90",  grand: "₹184.80" },
    { date: "14 May 2026", billNumber: "PHM-DEMO-0043", patient: "Ravi Kumar",        taxable: "850.00", cgst: "51.00", sgst: "51.00", grand: "₹952.00" },
    { date: "14 May 2026", billNumber: "PHM-DEMO-0044", patient: "Priya Verma",       taxable: "320.50", cgst: "19.23", sgst: "19.23", grand: "₹358.96" },
    { date: "14 May 2026", billNumber: "PHM-DEMO-0045", patient: "Mr. JaiBhagwan",    taxable: "192.00", cgst: "11.52", sgst: "11.52", grand: "₹215.04" },
    { date: "14 May 2026", billNumber: "PHM-DEMO-0046", patient: "Walk-in customer",  taxable: "60.00",  cgst: "3.60",  sgst: "3.60",  grand: "₹67.20" },
  ],
  totals: { Bills: 5, "Taxable": "₹1,587.50", "GST": "₹190.50", "Grand total": "₹1,778.00" },
};

function RegisterPreviewModal({ headerId, isActive, settingsDoc, onClose, onUse }) {
  const meta = REGISTER_HEADERS.find(h => h.id === headerId) || REGISTER_HEADERS[0];
  const phSettings = settingsDoc ? { ...settingsDoc, registerHeader: headerId } : null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,.65)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 14, width: "min(1100px, 98vw)",
        maxHeight: "94vh", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,.35)",
      }}>
        <div style={{
          padding: "12px 18px", display: "flex", alignItems: "center", gap: 10,
          background: "linear-gradient(135deg,#0d9488,#0f766e)", color: "#fff",
          borderTopLeftRadius: 14, borderTopRightRadius: 14,
        }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,.22)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>#{meta.id}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{meta.label}</div>
            <div style={{ fontSize: 11, opacity: .85 }}>{meta.sub}</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: "rgba(255,255,255,.18)", color: "#fff", cursor: "pointer" }}><i className="pi pi-times" /></button>
        </div>
        <div style={{ flex: 1, overflow: "auto", background: "#e2e8f0", padding: 18 }}>
          <div style={{ background: "#fff", boxShadow: "0 6px 22px rgba(15,23,42,.18)", maxWidth: 1000, margin: "0 auto" }}>
            <PharmacyRegister
              settings={DEMO_SETTINGS}
              receipt={{ ...DEMO_REGISTER, headerStyle: headerId, pharmacySettings: phSettings }}
            />
          </div>
        </div>
        <div style={{ padding: "10px 18px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 11, color: C.muted }}>
            <i className="pi pi-info-circle" style={{ marginRight: 5 }} />
            Sample data. Your real registers print with patient + bill data from the database.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 7, border: `1.5px solid ${C.border}`, background: "#fff", color: C.muted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Close</button>
            <button onClick={onUse} disabled={isActive}
              style={{ padding: "8px 20px", borderRadius: 7, border: "none",
                background: isActive ? "#86efac" : "#0d9488", color: "#fff",
                fontWeight: 800, fontSize: 12, cursor: isActive ? "default" : "pointer" }}>
              {isActive ? <><i className="pi pi-check" style={{ marginRight: 6 }} />Currently selected</> : <><i className="pi pi-check-circle" style={{ marginRight: 6 }} />Use this header</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplatePreviewModal({ tplId, isActive, settingsDoc, onClose, onUse }) {
  const tpl = TEMPLATES.find(t => t.id === tplId) || TEMPLATES[0];
  const isInh = tpl.audience === "in-house";
  // Build a "pharmacySettings" snapshot from the in-progress settings doc so the
  // preview reflects the manager's outsourced identity in real time.
  const phSettings = settingsDoc ? { ...settingsDoc, billTemplate: tplId } : null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,.65)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 14,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 14, width: "min(1100px, 98vw)",
        maxHeight: "94vh", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,.35)",
      }}>
        <div style={{
          padding: "12px 18px", display: "flex", alignItems: "center", gap: 10,
          background: "linear-gradient(135deg,#7c3aed,#5b21b6)", color: "#fff",
          borderTopLeftRadius: 14, borderTopRightRadius: 14,
        }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,.22)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>#{tpl.id}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{tpl.label}</div>
            <div style={{ fontSize: 11, opacity: .85 }}>{tpl.sub} · {isInh ? "In-house" : "Outsourced"}</div>
          </div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: "none", background: "rgba(255,255,255,.18)", color: "#fff", cursor: "pointer" }}><i className="pi pi-times" /></button>
        </div>
        <div style={{ flex: 1, overflow: "auto", background: "#e2e8f0", padding: 18 }}>
          <div style={{ background: "#fff", boxShadow: "0 6px 22px rgba(15,23,42,.18)", maxWidth: 880, margin: "0 auto" }}>
            <PharmacyBill
              settings={DEMO_SETTINGS}
              receipt={{ ...DEMO_BILL, template: tplId, pharmacySettings: phSettings }}
            />
          </div>
        </div>
        <div style={{ padding: "10px 18px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 11, color: C.muted }}>
            <i className="pi pi-info-circle" style={{ marginRight: 5 }} />
            Sample data shown — your real bills will use this template with actual patient and item data.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 7, border: `1.5px solid ${C.border}`, background: "#fff", color: C.muted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Close</button>
            <button onClick={onUse} disabled={isActive}
              style={{ padding: "8px 20px", borderRadius: 7, border: "none",
                background: isActive ? "#86efac" : "#7c3aed", color: "#fff",
                fontWeight: 800, fontSize: 12, cursor: isActive ? "default" : "pointer" }}>
              {isActive ? <><i className="pi pi-check" style={{ marginRight: 6 }} />Currently selected</> : <><i className="pi pi-check-circle" style={{ marginRight: 6 }} />Use this template</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsTab() {
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);
  const [previewTpl, setPreviewTpl] = useState(null);
  const [previewReg, setPreviewReg] = useState(null);
  const upd = (k) => (e) => setS(p => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  useEffect(() => { (async () => {
    try { setS((await getPharmacySettings()).data); } catch (e) { toast.error(e.message); }
  })(); }, []);

  const onLogoFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { toast.error("Logo must be under 1 MB"); return; }
    const reader = new FileReader();
    reader.onload = () => setS(p => ({ ...p, logo: reader.result }));
    reader.readAsDataURL(f);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await updatePharmacySettings(s);
      setS(r.data);
      invalidatePhSettings();
      toast.success("Pharmacy settings saved · prints will use the new header/footer immediately");
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  if (!s) return <div style={{ padding: 30, textAlign: "center", color: C.muted }}>Loading settings…</div>;

  const isOutsourced = s.mode === "outsourced";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>

      {/* TEMPLATE PICKER — top of Settings */}
      <Card title="Bill print template" color={C.purple} icon="pi-palette">
        <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 12 }}>
          Pick a layout for every pharmacy bill. <b>Click any thumbnail to preview at full size</b> — then click "Use this" inside the preview to apply.
          Templates <b>1-5</b> are tuned for in-house, <b>6-10</b> for outsourced retail pharmacies.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {TEMPLATES.map(t => {
            const active = (s.billTemplate || 1) === t.id;
            const isInh  = t.audience === "in-house";
            const accent = isInh ? C.blue : C.orange;
            return (
              <div key={t.id}
                style={{
                  borderRadius: 10,
                  border: `2px solid ${active ? accent : C.border}`,
                  background: "#fff",
                  overflow: "hidden",
                  position: "relative",
                  cursor: "pointer",
                  boxShadow: active ? `0 6px 18px ${accent}30` : "0 1px 3px rgba(15,23,42,.05)",
                  transition: "transform .15s, box-shadow .15s",
                }}
                onClick={() => setPreviewTpl(t.id)}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 22px ${accent}35`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = active ? `0 6px 18px ${accent}30` : "0 1px 3px rgba(15,23,42,.05)"; }}
              >
                {/* Thumbnail viewport — scales a real PharmacyBill to ~210px wide */}
                <div style={{
                  height: 200, overflow: "hidden", position: "relative",
                  background: "#f1f5f9",
                  borderBottom: `1px solid ${C.border}`,
                }}>
                  <div style={{
                    transform: "scale(0.27)", transformOrigin: "top left",
                    width: "370%", pointerEvents: "none",
                  }}>
                    <PharmacyBill settings={DEMO_SETTINGS} receipt={{ ...DEMO_BILL, template: t.id }} />
                  </div>
                  {active && (
                    <div style={{
                      position: "absolute", top: 8, right: 8,
                      width: 26, height: 26, borderRadius: "50%",
                      background: accent, color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: "0 2px 8px rgba(0,0,0,.2)",
                    }}>
                      <i className="pi pi-check" style={{ fontSize: 12 }} />
                    </div>
                  )}
                  <div style={{
                    position: "absolute", top: 8, left: 8,
                    padding: "2px 8px", borderRadius: 4,
                    background: "rgba(0,0,0,.7)", color: "#fff",
                    fontSize: 9.5, fontWeight: 800, letterSpacing: ".4px",
                  }}>#{t.id}</div>
                </div>
                {/* Label strip */}
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: active ? accent : C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.label}
                    </div>
                    <span style={{
                      flexShrink: 0, fontSize: 8.5, fontWeight: 800,
                      padding: "1px 6px", borderRadius: 3,
                      background: isInh ? "#dbeafe" : "#fed7aa",
                      color:      isInh ? "#1e40af" : "#9a3412",
                      letterSpacing: ".4px", textTransform: "uppercase",
                    }}>
                      {isInh ? "In-house" : "Outsourced"}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.sub}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Full-size preview modal */}
        {previewTpl != null && (
          <TemplatePreviewModal
            tplId={previewTpl}
            isActive={(s.billTemplate || 1) === previewTpl}
            settingsDoc={s}
            onClose={() => setPreviewTpl(null)}
            onUse={() => {
              setS(p => ({ ...p, billTemplate: previewTpl }));
              setPreviewTpl(null);
              toast.success(`Template #${previewTpl} selected — Save to apply`);
            }}
          />
        )}
        <div style={{ marginTop: 12 }}>
          <Field label="Default paper size">
            <select className="his-select" style={{ width: 200 }} value={s.defaultPaper || "half-a4"} onChange={upd("defaultPaper")}>
              <option value="half-a4">Half-A4 (210 × 148.5mm) · recommended</option>
              <option value="a4">A4 (210 × 297mm) · formal invoice</option>
              <option value="a5">A5 (148 × 210mm) · compact</option>
            </select>
          </Field>
        </div>
      </Card>

      {/* REGISTER HEADER PICKER */}
      <Card title="Register print style" color={C.teal} icon="pi-book">
        <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 12 }}>
          Statutory registers (Sales · Purchase · Stock · Schedule H · Expiry · GST) print with the header style picked here.
          The hospital identity comes from <b>Hospital Settings</b> when in-house, otherwise from the identity fields below.
          Click any card to preview at full size with sample data.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {REGISTER_HEADERS.map(h => {
            const active = (s.registerHeader || 1) === h.id;
            return (
              <div key={h.id}
                onClick={() => setPreviewReg(h.id)}
                style={{
                  borderRadius: 10, border: `2px solid ${active ? C.teal : C.border}`,
                  background: "#fff", overflow: "hidden", cursor: "pointer",
                  boxShadow: active ? `0 6px 18px ${C.teal}30` : "0 1px 3px rgba(15,23,42,.05)",
                  transition: "transform .15s, box-shadow .15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "none"; }}
              >
                <div style={{ height: 160, overflow: "hidden", position: "relative", background: "#f1f5f9", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ transform: "scale(0.28)", transformOrigin: "top left", width: "360%", pointerEvents: "none" }}>
                    <PharmacyRegister
                      settings={DEMO_SETTINGS}
                      receipt={{ ...DEMO_REGISTER, headerStyle: h.id, pharmacySettings: { ...s, registerHeader: h.id } }} />
                  </div>
                  {active && (
                    <div style={{ position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: "50%", background: C.teal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,.2)" }}>
                      <i className="pi pi-check" style={{ fontSize: 12 }} />
                    </div>
                  )}
                  <div style={{ position: "absolute", top: 8, left: 8, padding: "2px 8px", borderRadius: 4, background: "rgba(0,0,0,.7)", color: "#fff", fontSize: 9.5, fontWeight: 800 }}>#{h.id}</div>
                </div>
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: active ? C.teal : C.text }}>{h.label}</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{h.sub}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Per-register toggles */}
        <div style={{ marginTop: 16, padding: "12px 14px", border: `1.5px solid ${C.border}`, borderRadius: 9, background: C.subtle }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 10 }}>Register options</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <Check label="Show logo on register"           v={s.registerShowLogo    !== false} on={() => setS(p => ({ ...p, registerShowLogo:    !(p.registerShowLogo !== false) }))} />
            <Check label="Show GSTIN"                       v={s.registerShowGstin   !== false} on={() => setS(p => ({ ...p, registerShowGstin:   !(p.registerShowGstin !== false) }))} />
            <Check label="Show Drug Licence No."            v={s.registerShowDL      !== false} on={() => setS(p => ({ ...p, registerShowDL:      !(p.registerShowDL !== false) }))} />
            <Check label="Show contact (phone / email)"     v={s.registerShowContact !== false} on={() => setS(p => ({ ...p, registerShowContact: !(p.registerShowContact !== false) }))} />
            <Check label="Add S.No. column"                 v={s.registerSerialColumn !== false} on={() => setS(p => ({ ...p, registerSerialColumn:!(p.registerSerialColumn !== false) }))} />
            <Check label="Signatures (Prepared/Checked/Authorised)" v={s.registerSignatures !== false} on={() => setS(p => ({ ...p, registerSignatures: !(p.registerSignatures !== false) }))} />
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="Page orientation">
              <select className="his-select" style={{ width: 200 }} value={s.registerOrientation || "portrait"} onChange={upd("registerOrientation")}>
                <option value="portrait">Portrait · recommended (standard registers)</option>
                <option value="landscape">Landscape · for very wide tables</option>
              </select>
            </Field>
          </div>
        </div>

        {previewReg != null && (
          <RegisterPreviewModal
            headerId={previewReg}
            isActive={(s.registerHeader || 1) === previewReg}
            settingsDoc={s}
            onClose={() => setPreviewReg(null)}
            onUse={() => {
              setS(p => ({ ...p, registerHeader: previewReg }));
              setPreviewReg(null);
              toast.success(`Register header style #${previewReg} selected — Save to apply`);
            }}
          />
        )}
      </Card>

      {/* IDENTITY FIELDS BLOCK */}
      <Card title="Pharmacy identity" color={C.orange} icon="pi-cog">
        {/* Mode toggle */}
        <div style={{ marginBottom: 14, padding: "12px 14px", background: C.subtle, border: `1.5px solid ${C.border}`, borderRadius: 9 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>
            Print mode
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { v: "in-house",    label: "In-house",   sub: "Use hospital header/footer", icon: "pi-building" },
              { v: "outsourced",  label: "Outsourced", sub: "Third-party pharmacy identity below", icon: "pi-truck" },
            ].map(o => {
              const active = s.mode === o.v;
              return (
                <button key={o.v} onClick={() => setS(p => ({ ...p, mode: o.v }))}
                  style={{
                    flex: 1, padding: "11px 14px", borderRadius: 9,
                    border: `1.5px solid ${active ? C.orange : C.border}`,
                    background: active ? C.orangeL : "#fff",
                    cursor: "pointer", textAlign: "left",
                    display: "flex", alignItems: "center", gap: 10,
                  }}>
                  <i className={`pi ${o.icon}`} style={{ color: active ? C.orange : C.muted, fontSize: 14 }} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 12.5, color: active ? C.orange : C.text }}>{o.label}</div>
                    <div style={{ fontSize: 10.5, color: C.muted }}>{o.sub}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {!isOutsourced && (
          <div style={{ padding: "10px 14px", background: C.blueL, border: `1px solid ${C.blue}30`, borderRadius: 8, fontSize: 12, color: "#1e3a8a", marginBottom: 14 }}>
            <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
            Currently in-house. Pharmacy bills carry the hospital's header/footer from <b>Admin → Hospital Settings</b>. Switch to "Outsourced" to enter custom identity below.
          </div>
        )}

        {/* Identity fields — only meaningful when outsourced, but always editable */}
        <div style={{ opacity: isOutsourced ? 1 : 0.55, pointerEvents: isOutsourced ? "auto" : "none" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 12, marginBottom: 12 }}>
            <Field label="Pharmacy name *"><input className="his-field" value={s.pharmacyName || ""} onChange={upd("pharmacyName")} placeholder="MediCare Pharma Pvt Ltd" /></Field>
            <Field label="Tagline"><input className="his-field" value={s.tagline || ""} onChange={upd("tagline")} placeholder="Trusted since 1998" /></Field>
          </div>

          <Field label="Logo (PNG / JPG · ≤1 MB)">
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {s.logo && (
                <img src={s.logo} alt="logo" style={{ width: 60, height: 60, objectFit: "contain", border: `1.5px solid ${C.border}`, borderRadius: 8, background: "#fff" }} />
              )}
              <input type="file" accept="image/*" onChange={onLogoFile} className="his-field" />
              {s.logo && (
                <button onClick={() => setS(p => ({ ...p, logo: "" }))} style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", color: C.red, fontSize: 11, cursor: "pointer" }}>Remove</button>
              )}
            </div>
          </Field>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Address line 1"><input className="his-field" value={s.addressLine1 || ""} onChange={upd("addressLine1")} /></Field>
            <Field label="Address line 2"><input className="his-field" value={s.addressLine2 || ""} onChange={upd("addressLine2")} /></Field>
            <Field label="City"><input className="his-field" value={s.city || ""} onChange={upd("city")} /></Field>
            <Field label="State"><input className="his-field" value={s.state || ""} onChange={upd("state")} /></Field>
            <Field label="Pincode"><input className="his-field" value={s.pincode || ""} onChange={upd("pincode")} /></Field>
            <Field label="Phone 1"><input className="his-field" value={s.phone1 || ""} onChange={upd("phone1")} /></Field>
            <Field label="Phone 2"><input className="his-field" value={s.phone2 || ""} onChange={upd("phone2")} /></Field>
            <Field label="Email"><input className="his-field" value={s.email || ""} onChange={upd("email")} /></Field>
          </div>

          <div style={{ marginTop: 14, padding: "12px 14px", border: `1.5px solid ${C.red}25`, background: C.redL + "55", borderRadius: 9 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.red, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 }}>
              Regulatory / tax — appears on every printed bill
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="GSTIN *"><input className="his-field" value={s.gstin || ""} onChange={upd("gstin")} placeholder="27ABCDE1234F1Z5" /></Field>
              <Field label="PAN"><input className="his-field" value={s.panNumber || ""} onChange={upd("panNumber")} /></Field>
              <Field label="Drug License No. *"><input className="his-field" value={s.drugLicenseNo || ""} onChange={upd("drugLicenseNo")} placeholder="MH/20B/2024-001" /></Field>
              <Field label="Drug License Expiry"><input type="date" className="his-field" value={s.drugLicenseExp ? s.drugLicenseExp.slice(0,10) : ""} onChange={upd("drugLicenseExp")} /></Field>
              <Field label="FSSAI No"><input className="his-field" value={s.fssaiNumber || ""} onChange={upd("fssaiNumber")} /></Field>
            </div>
          </div>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            <Field label="Bank name"><input className="his-field" value={s.bankName || ""} onChange={upd("bankName")} /></Field>
            <Field label="Account no"><input className="his-field" value={s.bankAccount || ""} onChange={upd("bankAccount")} /></Field>
            <Field label="IFSC"><input className="his-field" value={s.ifscCode || ""} onChange={upd("ifscCode")} /></Field>
            <Field label="UPI ID"><input className="his-field" value={s.upiId || ""} onChange={upd("upiId")} placeholder="pharma@upi" /></Field>
          </div>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Header colour"><input type="color" className="his-field" style={{ height: 38 }} value={s.headerColor || "#ea580c"} onChange={upd("headerColor")} /></Field>
            <Field label="Accent colour"><input type="color" className="his-field" style={{ height: 38 }} value={s.accentColor || "#c2410c"} onChange={upd("accentColor")} /></Field>
          </div>

          <div style={{ marginTop: 14 }}>
            <Field label="Footer note">
              <textarea className="his-textarea" rows={2} value={s.footerNote || ""} onChange={upd("footerNote")} placeholder="Thank you for choosing MediCare Pharma" />
            </Field>
          </div>
        </div>

        <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={save} disabled={saving}
            style={{ padding: "10px 22px", borderRadius: 8, border: "none", background: saving ? "#94a3b8" : C.orange, color: "#fff", fontWeight: 800, fontSize: 13, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Saving…" : <><i className="pi pi-save" style={{ marginRight: 6 }} />Save settings</>}
          </button>
        </div>
      </Card>

      {/* Preview tip strip */}
      <div style={{ padding: "10px 14px", background: C.purpleL, border: `1px solid ${C.purple}30`, borderRadius: 8, fontSize: 11.5, color: "#5b21b6" }}>
        <i className="pi pi-info-circle" style={{ marginRight: 6 }} />
        Tip — open <b>/print-gallery → Pharmacy Tax Invoice</b> after saving to preview the selected template with demo data. Or click <b>Print</b> on any row in the Sales Register to print a real bill with the new template.
      </div>
    </div>
  );
}

function SuppliersTab() {
  const [rows, setRows] = useState([]);
  const [edit, setEdit] = useState(null);
  const [adding, setAdding] = useState(false);
  const refresh = async () => {
    try { setRows((await listSuppliers()).data || []); }
    catch (e) { toast.error(e.message); }
  };
  useEffect(() => { refresh(); }, []);
  const remove = async (s) => {
    // R7ax-FIX-CONFIRM: replaced window.confirm with themed ConfirmDialog
    if (!(await confirm({
      title: "Deactivate supplier?",
      body: `"${s.name}" will be marked inactive and removed from new GRN dropdowns. Existing purchase history is preserved.`,
      danger: true,
      confirmLabel: "Deactivate",
    }))) return;
    try { await deleteSupplier(s._id); toast.success("Supplier deactivated"); refresh(); }
    catch (e) { toast.error(e.message); }
  };
  return (
    <div>
      <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setAdding(true)} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: C.orange, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
          <i className="pi pi-plus" style={{ marginRight: 6 }} />Add Supplier
        </button>
      </div>
      <Table cols={["Name","Contact","Phone","GSTIN","Drug Licence","Credit days","Action"]}>
        {rows.length === 0 ? <EmptyRow span={7} text="No suppliers yet." /> :
          rows.map((s, i) => (
            <tr key={s._id} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
              <td style={{ padding: "9px 12px", fontWeight: 700 }}>{s.name}</td>
              <td style={{ padding: "9px 12px", color: C.muted }}>{s.contactPerson || "—"}</td>
              <td style={{ padding: "9px 12px" }}>{s.phone}</td>
              <td style={{ padding: "9px 12px", fontFamily: "DM Mono, monospace", fontSize: 11 }}>{s.gstin || "—"}</td>
              <td style={{ padding: "9px 12px", fontFamily: "DM Mono, monospace", fontSize: 11 }}>{s.drugLicenseNo || "—"}</td>
              <td style={{ padding: "9px 12px" }}>{s.creditDays}d</td>
              <td style={{ padding: "8px 12px" }}>
                <RowAction icon="pi-pencil" color={C.blue} onClick={() => setEdit(s)} label="Edit" />
                <RowAction icon="pi-trash"  color={C.red}  onClick={() => remove(s)}  label="Off" />
              </td>
            </tr>
          ))}
      </Table>
      {(adding || edit) && (
        <SupplierModal supplier={edit} onClose={() => { setEdit(null); setAdding(false); }} onSaved={refresh} />
      )}
    </div>
  );
}

function SupplierModal({ supplier, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: "", contactPerson: "", phone: "", email: "", address: "", city: "", state: "", pincode: "",
    gstin: "", panNumber: "", drugLicenseNo: "", bankAccount: "", ifscCode: "", creditDays: 30,
    ...supplier,
  });
  const [saving, setSaving] = useState(false);
  const upd = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  const submit = async () => {
    if (!form.name.trim()) { toast.warn("Supplier name required"); return; }
    setSaving(true);
    try {
      if (supplier?._id) await updateSupplier(supplier._id, form);
      else await createSupplier(form);
      toast.success(`${form.name} saved`);
      onSaved(); onClose();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={supplier?._id ? "Edit Supplier" : "Add Supplier"} color={C.orange} onClose={onClose} onSubmit={submit} submitting={saving} size={620}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Name *"><input className="his-field" value={form.name} onChange={upd("name")} /></Field>
        <Field label="Contact person"><input className="his-field" value={form.contactPerson} onChange={upd("contactPerson")} /></Field>
        <Field label="Phone"><input className="his-field" value={form.phone} onChange={upd("phone")} /></Field>
        <Field label="Email"><input className="his-field" value={form.email} onChange={upd("email")} /></Field>
        <div style={{ gridColumn: "span 2" }}><Field label="Address"><textarea className="his-textarea" rows={2} value={form.address} onChange={upd("address")} /></Field></div>
        <Field label="City"><input className="his-field" value={form.city} onChange={upd("city")} /></Field>
        <Field label="State"><input className="his-field" value={form.state} onChange={upd("state")} /></Field>
        <Field label="Pincode"><input className="his-field" value={form.pincode} onChange={upd("pincode")} /></Field>
        <Field label="GSTIN"><input className="his-field" value={form.gstin} onChange={upd("gstin")} /></Field>
        <Field label="PAN"><input className="his-field" value={form.panNumber} onChange={upd("panNumber")} /></Field>
        <Field label="Drug Licence No."><input className="his-field" value={form.drugLicenseNo} onChange={upd("drugLicenseNo")} /></Field>
        <Field label="Bank account"><input className="his-field" value={form.bankAccount} onChange={upd("bankAccount")} /></Field>
        <Field label="IFSC"><input className="his-field" value={form.ifscCode} onChange={upd("ifscCode")} /></Field>
        <Field label="Credit days"><input type="number" className="his-field" value={form.creditDays} onChange={upd("creditDays")} /></Field>
      </div>
    </Modal>
  );
}

/* ════════════════════════════════════════════════════════════════
   PRIMITIVES
══════════════════════════════════════════════════════════════════ */
function KPI({ label, value, color, icon }) {
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 3px rgba(15,23,42,.04)", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: color + "12", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <i className={`pi ${icon}`} style={{ fontSize: 15, color }} />
      </div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginTop: 4 }}>{label}</div>
      </div>
    </div>
  );
}

function Card({ title, color, icon, children }) {
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(15,23,42,.04)" }}>
      <div style={{ padding: "10px 16px", background: color + "08", borderBottom: `1px solid ${color}20`, display: "flex", alignItems: "center", gap: 8 }}>
        <i className={`pi ${icon}`} style={{ color, fontSize: 13 }} />
        <span style={{ fontWeight: 800, fontSize: 13, color }}>{title}</span>
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

function Table({ cols, children, compact }) {
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "auto", boxShadow: "0 1px 3px rgba(15,23,42,.04)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: compact ? 11.5 : 12 }}>
        <thead>
          <tr style={{ background: C.subtle, borderBottom: `1.5px solid ${C.border}` }}>
            {cols.map(c => (
              <th key={c} style={{ padding: compact ? "7px 10px" : "9px 12px", textAlign: "left", fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", fontSize: 10, whiteSpace: "nowrap" }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function EmptyRow({ span, text }) {
  return <tr><td colSpan={span} style={{ padding: "24px 16px", textAlign: "center", color: C.muted, fontSize: 12, fontStyle: "italic" }}>{text}</td></tr>;
}

function RowAction({ icon, label, color, onClick }) {
  return (
    <button onClick={onClick} title={label} style={{ marginRight: 4, padding: "4px 10px", borderRadius: 5, border: `1px solid ${color}40`, background: "#fff", color, fontSize: 10.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
      <i className={`pi ${icon}`} style={{ fontSize: 10 }} />{label}
    </button>
  );
}

function Modal({ title, color, onClose, onSubmit, submitting, submitLabel = "Save", children, hideFooter, size = 560 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: size, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 50px rgba(0,0,0,.25)", overflow: "hidden" }}>
        <div style={{ padding: "12px 18px", background: `linear-gradient(135deg, ${color}, ${color}cc)`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "rgba(255,255,255,.18)", color: "#fff", cursor: "pointer" }}><i className="pi pi-times" /></button>
        </div>
        <div style={{ padding: "16px 18px", overflowY: "auto", flex: 1 }}>{children}</div>
        {!hideFooter && (
          <div style={{ padding: "10px 18px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} disabled={submitting} style={{ padding: "8px 16px", borderRadius: 7, border: `1.5px solid ${C.border}`, background: "#fff", color: C.muted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Cancel</button>
            <button onClick={onSubmit} disabled={submitting} style={{ padding: "8px 20px", borderRadius: 7, border: "none", background: submitting ? "#94a3b8" : color, color: "#fff", fontWeight: 800, fontSize: 12, cursor: submitting ? "not-allowed" : "pointer" }}>{submitting ? "Saving…" : submitLabel}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

function Check({ label, v, on }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, color: v ? C.text : C.muted }}>
      <input type="checkbox" checked={!!v} onChange={on} />{label}
    </label>
  );
}

function Row({ label, value, valueColor, bold, large }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontWeight: bold ? 800 : 600 }}>
      <span style={{ color: C.muted, fontSize: large ? 13 : 11.5 }}>{label}</span>
      <span style={{ color: valueColor || C.text, fontSize: large ? 16 : 12 }}>{value}</span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   R7cr — OPD Rx LOOKUP TAB
   Pharmacist enters a UHID, gets today's OPD visits for that
   patient with diagnosis + prescribed medicines, and dispenses
   each line with one click via the existing /pharmacy/sales POST.
   Reuses dispense() service so the sale lands in the same
   register / GST / FEFO pipeline as a walk-in counter sale —
   no parallel codepath.
══════════════════════════════════════════════════════════════════ */
function OPDRxTab() {
  const [uhidInput, setUhidInput]   = useState("");
  const [loading, setLoading]       = useState(false);
  const [visits, setVisits]         = useState([]);    // recent OPD visits for the UHID
  const [patient, setPatient]       = useState(null);  // first visit's patientId populated doc
  const [searchedUhid, setSearchedUhid] = useState("");
  // R7cx — day-window selector. Default 7 because today-only was too
  // narrow (patient walks in 1-2 days after the visit and the panel
  // showed empty). Pharmacist can widen to 15/30 if hunting for an
  // older prescription, or narrow to 1 (today only) if there's noise.
  const [windowDays, setWindowDays] = useState(7);
  // R7cw — track API failure separately from "successfully returned
  // empty list". Pre-R7cw a 404 on the new R7cr endpoint left the
  // empty-state ("No OPD visit today") rendering — misleading because
  // the patient might actually have a visit but the route 404'd
  // because backend hadn't been restarted. Now we render distinct
  // states for {idle, loading, ok-empty, ok-data, api-failed}.
  const [loadError, setLoadError]   = useState(null);   // string or null
  // Quick-dispense modal state. We never push into the regular
  // DispenseTab cart — each prescription row dispenses as its own
  // sale so the pharmacist isn't blocked finishing visit-A before
  // starting visit-B (common when two doctors prescribe the same
  // morning).
  const [qdOpen, setQdOpen]         = useState(false);
  const [qdMed, setQdMed]           = useState(null);   // the prescription row being sold
  const [qdDrug, setQdDrug]         = useState(null);   // matched inventory drug (id + price)
  const [qdMatches, setQdMatches]   = useState([]);     // inventory search results
  const [qdDrugSearch, setQdDrugSearch] = useState(""); // drug autocomplete input
  const [qdQty, setQdQty]           = useState(1);
  const [qdUnitPrice, setQdUnitPrice] = useState(0);
  const [qdPaymentMode, setQdPaymentMode] = useState("Cash");
  const [qdSaving, setQdSaving]     = useState(false);
  // R7cy — FEFO batch info for the selected drug. The drug master does
  // NOT carry a reliable sellPrice — the real price lives on each
  // PharmacyDrugBatch row (set at GRN time, varies by purchase lot).
  // Backend dispense() also reads price from batch.salePrice and
  // IGNORES any client-supplied unitPrice (R7bh-F4 hardening). So we
  // mirror that here for the UI preview — pull the FEFO batch on
  // drug-pick and use its salePrice / batchNo / expiryDate.
  const [qdFefoBatch, setQdFefoBatch] = useState(null);
  const [qdBatchLoading, setQdBatchLoading] = useState(false);

  // R7dv — "Dispense All" state. One click on a visit auto-matches every
  // prescribed medicine against inventory, computes the needed quantity
  // from frequency × duration, caps it at the FEFO batch's remaining
  // stock, then opens a preview modal where the pharmacist confirms /
  // tweaks before a SINGLE multi-item dispense() POST hits the wire.
  const [daOpen, setDaOpen]             = useState(false);
  const [daVisit, setDaVisit]           = useState(null);
  const [daItems, setDaItems]           = useState([]); // [{med, drug, batch, needed, qty, unitPrice, status, note}]
  const [daPaymentMode, setDaPaymentMode] = useState("Cash");
  const [daSaving, setDaSaving]         = useState(false);
  const [daPreparing, setDaPreparing]   = useState(false);

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

  // Load recent Rx (default 7 days) for the typed UHID. Empty array =
  // no visits in the window (handled with a friendly empty state,
  // not an error).
  const load = async (uhidArg, daysArg) => {
    const u = (uhidArg ?? uhidInput).trim().toUpperCase();
    const d = Number(daysArg ?? windowDays) || 7;
    if (!u) { toast.warn("Enter a UHID"); return; }
    setLoading(true); setSearchedUhid(u); setLoadError(null);
    try {
      const r = await opdService.getTodayRxByUHID(u, d);
      const list = Array.isArray(r?.data?.data) ? r.data.data : [];
      setVisits(list);
      setPatient(list[0]?.patientId || null);
      if (list.length === 0) {
        toast.info(`No OPD visit in last ${d} day${d === 1 ? "" : "s"} for ${u}`);
      }
    } catch (e) {
      // R7cw: distinguish missing-route (backend restart needed) from
      // a real lookup error so the operator sees an actionable message
      // and the empty-state below doesn't lie about there being no
      // visit when really the API never executed.
      const status = e?.response?.status;
      const serverMsg = e?.response?.data?.message;
      const isMissingRoute = status === 404 || serverMsg === "Route not found";
      const friendly = isMissingRoute
        ? "OPD Rx endpoint unavailable — backend may need restart to pick up R7cr routes."
        : (serverMsg || e.message || "Lookup failed");
      toast.error(friendly);
      setLoadError(friendly);
      setVisits([]); setPatient(null);
    } finally {
      setLoading(false);
    }
  };

  const clearAll = () => {
    setUhidInput(""); setSearchedUhid(""); setVisits([]); setPatient(null); setLoadError(null);
  };

  // R7cr — open the quick-dispense modal pre-filled from a prescription
  // row. The drug-name autocomplete is seeded with the prescribed name
  // so the pharmacist's first keystroke is usually unnecessary.
  const openQuickDispense = async (med, visit) => {
    setQdMed({ ...med, _visit: visit });
    setQdDrug(null);
    setQdQty(1);
    setQdUnitPrice(0);
    setQdPaymentMode("Cash");
    const seed = String(med?.medicineName || "").replace(/^(tab\.?|cap\.?|syp\.?|inj\.?|cream|oint\.?|drop[s]?)\s+/i, "").trim();
    setQdDrugSearch(seed);
    setQdMatches([]);
    setQdOpen(true);
    // Auto-fire one search so the modal opens with candidates visible.
    if (seed.length >= 2) {
      try {
        const list = await listDrugs({ q: seed, limit: 10 });
        setQdMatches(Array.isArray(list) ? list : (list?.data || []));
      } catch (_) { /* non-fatal */ }
    }
  };

  // Debounced drug search inside the modal (250ms — same as Dispense tab).
  const debouncedSearch = useDebounce(qdDrugSearch, 250);
  useEffect(() => {
    let cancelled = false;
    if (!qdOpen) return;
    const q = (debouncedSearch || "").trim();
    if (q.length < 2) { setQdMatches([]); return; }
    (async () => {
      try {
        const list = await listDrugs({ q, limit: 10 });
        if (cancelled) return;
        setQdMatches(Array.isArray(list) ? list : (list?.data || []));
      } catch (_) { if (!cancelled) setQdMatches([]); }
    })();
    return () => { cancelled = true; };
  }, [debouncedSearch, qdOpen]);

  const pickDrug = async (drug) => {
    setQdDrug(drug);
    setQdDrugSearch(drug.brandName || drug.genericName || drug.name || "");
    setQdMatches([]);
    setQdFefoBatch(null);
    setQdUnitPrice(0);
    // R7cy — drug master almost never carries a usable sellPrice
    // (price is set per-batch at GRN time). Fetch in-stock batches,
    // pick the FEFO winner (earliest expiry, not yet expired, with
    // qty remaining), and use its salePrice. Falls back to any
    // master-level price field if the batch fetch fails or returns
    // nothing — the user can still override the field manually.
    setQdBatchLoading(true);
    try {
      const r = await listBatches({ drugId: drug._id });
      const list = Array.isArray(r) ? r : (r?.data || []);
      const now = Date.now();
      const fefo = list
        .filter(b => {
          const rem = Number(b.remaining ?? b.qtyRemaining ?? b.qty ?? 0);
          const exp = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
          return rem > 0 && exp > now;
        })
        .sort((a, b) => {
          const ea = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
          const eb = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
          return ea - eb;
        })[0];
      if (fefo) {
        setQdFefoBatch(fefo);
        const price = Number(fefo.salePrice ?? fefo.sellPrice ?? fefo.mrp ?? 0);
        if (price > 0) setQdUnitPrice(price);
      } else {
        const mrp = Number(drug.sellPrice || drug.mrp || drug.unitPrice || 0);
        if (mrp > 0) setQdUnitPrice(mrp);
      }
    } catch (_) {
      const mrp = Number(drug.sellPrice || drug.mrp || drug.unitPrice || 0);
      if (mrp > 0) setQdUnitPrice(mrp);
    } finally {
      setQdBatchLoading(false);
    }
  };

  const submitQuickDispense = async () => {
    if (!qdDrug?._id) { toast.warn("Select a drug from the inventory"); return; }
    const qty = Number(qdQty);
    if (!Number.isFinite(qty) || qty <= 0) { toast.warn("Quantity must be > 0"); return; }
    const price = Number(qdUnitPrice);
    if (!Number.isFinite(price) || price < 0) { toast.warn("Invalid unit price"); return; }
    setQdSaving(true);
    // R7cz — Resolve doctor name + prescription ref ONCE so the same
    // values flow both to the top-level sale and to the per-item Rx
    // payload below. The backend dispense() Schedule H/H1/X gate
    // (D&C Rule 65) rejects with 400 RX_REF_REQUIRED unless BOTH
    // prescriptionRef AND prescriberName are present on the item OR
    // the sale. The OPD visitNumber IS the prescription identifier
    // for an in-hospital OPD-Rx dispense, so we pass it through.
    const visit = qdMed?._visit || {};
    const docName = visit.consultantName ||
      (visit.doctorId?.personalInfo
        ? `Dr. ${visit.doctorId.personalInfo.firstName || ""} ${visit.doctorId.personalInfo.lastName || ""}`.trim()
        : "");
    const rxRef = visit.visitNumber || "";
    try {
      const r = await dispense({
        patientUHID:     searchedUhid,
        patientName:     patient?.fullName || visit.patientName || "",
        age:             patient?.age || "",
        gender:          patient?.gender || "",
        contactNumber:   patient?.contactNumber || "",
        doctorName:      docName,
        // R7cz — sale-level fallback the backend reads when item-level
        // fields are absent (we set both, belt-and-braces). For Schedule
        // H drugs this satisfies the prescriber + Rx-ref requirement.
        prescriptionRef: rxRef,
        saleType:        "OPD",
        paymentMode:     qdPaymentMode,
        items: [{
          drugId:          qdDrug._id,
          drugName:        qdDrug.brandName || qdDrug.genericName || qdDrug.name,
          quantity:        qty,
          unitPrice:       price,
          gstRate:         Number(qdDrug.gstRate || qdDrug.taxPercentage || 0),
          discountPercent: 0,
          // R7cz — per-item Rx fields, same values as sale-level.
          // Item-level wins in the backend check; passing both lets the
          // gate succeed even if a future change picks one path or the
          // other.
          prescriptionRef: rxRef,
          prescriberName:  docName,
        }],
        // Audit trail — link this sale back to the OPD visit so the
        // pharmacist's bill can be reconciled to the prescription.
        sourceContext: {
          source:      "OPD-Rx",
          visitNumber: rxRef,
          medicineRef: qdMed?.medicineName || "",
          dosage:      qdMed?.dosage || "",
          frequency:   qdMed?.frequency || "",
          duration:    qdMed?.duration || "",
        },
      });
      const billNo = r?.data?.billNumber || r?.data?.data?.billNumber || "";
      toast.success(`Dispensed — Bill ${billNo}`);
      setQdOpen(false);
    } catch (e) {
      const msg = e?.response?.data?.message || e.message || "Dispense failed";
      toast.error(msg);
    } finally {
      setQdSaving(false);
    }
  };

  /* ── R7dv — Dispense All (one-click) ──────────────────────────────
     Auto-matches every prescribed medicine against the inventory drug
     master + FEFO batch, computes needed qty, caps at stock, opens a
     preview modal where the pharmacist can tweak qty before a SINGLE
     multi-item dispense() POST. No per-row clicks needed.
  ──────────────────────────────────────────────────────────────── */

  // Strip "Tab/Cap/Syp/Inj/Cream/Oint/Drops" form prefix so the
  // inventory search hits the molecule name. e.g. "Tab Paracetamol
  // 500mg" → "Paracetamol 500mg".
  const stripFormPrefix = (name) =>
    String(name || "").replace(/^(tab\.?|cap\.?|syp\.?|inj\.?|cream|oint\.?|drop[s]?)\s+/i, "").trim();

  // R7ho-FIX: parens-stripped fallback. Backend uses a contains-regex
  // search, so "Bifilac probiotic" (no parens) does NOT substring-match
  // a stored row named "Bifilac (probiotic)" (the " (" between is in
  // the way). Conversely, "ORS sachets (WHO formula)" does not match a
  // row named "ORS sachets WHO formula" (clean). The two-shot below
  // tries the original query first (preserves matches against parens-
  // named SKUs), then a parens-stripped retry to catch clean-named
  // SKUs. Both branches use the same scoring so the best candidate
  // surfaces regardless of the SKU author's punctuation choice.
  const stripPunctuation = (s) =>
    String(s || "")
      .replace(/[()\[\]{},;:!?]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  // Frequency → doses/day. Covers the abbreviations our doctors use.
  const parseFrequency = (f) => {
    const x = String(f || "").toUpperCase();
    if (/Q4H|6\s*[×x]/.test(x)) return 6;
    if (/QID|Q6H/.test(x)) return 4;
    if (/TDS|TID|Q8H/.test(x)) return 3;
    if (/BD|BID|Q12H/.test(x)) return 2;
    if (/OD|QD|HS|MORN|EVE|NIGHT/.test(x)) return 1;
    if (/SOS|PRN/.test(x)) return 1;
    return 1;
  };

  // Duration → days. "5 days" / "x 5 days" / "5d" all → 5. Default 5.
  const parseDuration = (d) => {
    const m = String(d || "").match(/(\d+)/);
    return m ? Math.max(1, Number(m[1])) : 5;
  };

  // Best-match: search inventory for the medicine name (form prefix
  // stripped) and pick the candidate whose normalised name most
  // closely matches the prescription.
  // R7ho-FIX: two-shot search — original query first, then parens-
  // stripped fallback. Catches both punctuation styles a doctor or
  // pharmacist might have used when authoring the SKU master.
  const matchInventoryDrug = async (medicineName) => {
    const q = stripFormPrefix(medicineName);
    if (q.length < 2) return null;
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const targetN = norm(q);
    const scoreList = (list) => list.map(d => {
      const candidates = [d.brandName, d.genericName, d.name].filter(Boolean).map(norm);
      let best = 0;
      for (const c of candidates) {
        if (c === targetN) best = Math.max(best, 100);
        else if (c.startsWith(targetN) || targetN.startsWith(c)) best = Math.max(best, 80);
        else if (c.includes(targetN) || targetN.includes(c)) best = Math.max(best, 60);
      }
      return { d, s: best };
    }).sort((a, b) => b.s - a.s);
    try {
      // Shot 1 — original query
      let r = await listDrugs({ q, limit: 8 });
      let list = Array.isArray(r) ? r : (r?.data || []);
      if (list.length) {
        const scored = scoreList(list);
        if (scored[0]?.s >= 60) return scored[0].d;
      }
      // Shot 2 — parens-stripped fallback (covers SKUs stored without
      // punctuation when the Rx text carries it, or vice versa).
      const qClean = stripPunctuation(q);
      if (qClean && qClean !== q) {
        r = await listDrugs({ q: qClean, limit: 8 });
        list = Array.isArray(r) ? r : (r?.data || []);
        if (list.length) {
          const scored = scoreList(list);
          if (scored[0]?.s >= 60) return scored[0].d;
          return scored[0]?.d || list[0];
        }
      }
      // Final fallback — first hit from whatever shot 1 produced
      return list[0] || null;
    } catch (_) { return null; }
  };

  // Pull the FEFO batch: in-stock + earliest expiry not yet expired.
  // Returns null if no batch available.
  const findFefoBatch = async (drugId) => {
    try {
      const r = await listBatches({ drugId });
      const list = Array.isArray(r) ? r : (r?.data || []);
      const now = Date.now();
      return list
        .filter(b => {
          const rem = Number(b.remaining ?? b.qtyRemaining ?? b.qty ?? 0);
          const exp = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
          return rem > 0 && exp > now;
        })
        .sort((a, b) => {
          const ea = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
          const eb = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
          return ea - eb;
        })[0] || null;
    } catch (_) { return null; }
  };

  // One-click trigger: open the modal, then resolve every prescribed
  // medicine in parallel. Each row shows real-time status while
  // resolving (matching → batch → ready / out-of-stock / no-match).
  const openDispenseAll = async (visit) => {
    const meds = Array.isArray(visit.prescribedMedications) ? visit.prescribedMedications : [];
    if (meds.length === 0) { toast.info("No prescribed medicines in this visit"); return; }
    setDaVisit(visit);
    setDaItems(meds.map((med, i) => ({
      _id: i, med, drug: null, batch: null,
      needed: 0, qty: 0, unitPrice: 0,
      status: "matching", note: "",
    })));
    setDaPaymentMode("Cash");
    setDaOpen(true);
    setDaPreparing(true);

    // Resolve all in parallel — usually <500ms total.
    const resolved = await Promise.all(meds.map(async (med) => {
      const needed = parseFrequency(med.frequency) * parseDuration(med.duration);
      const drug = await matchInventoryDrug(med.medicineName);
      if (!drug) {
        return { med, drug: null, batch: null, needed, qty: 0, unitPrice: 0,
                 status: "no-match", note: `No inventory match for "${stripFormPrefix(med.medicineName)}"` };
      }
      const batch = await findFefoBatch(drug._id);
      if (!batch) {
        const fallbackPrice = Number(drug.sellPrice || drug.mrp || drug.unitPrice || 0);
        return { med, drug, batch: null, needed, qty: 0, unitPrice: fallbackPrice,
                 status: "out-of-stock", note: "No in-stock batch — GRN required" };
      }
      const stock = Number(batch.remaining ?? batch.qtyRemaining ?? 0);
      const qty   = Math.min(needed, stock);                              // cap at stock
      const price = Number(batch.salePrice ?? batch.sellPrice ?? batch.mrp ?? 0);
      const isShort = qty < needed;
      return { med, drug, batch, needed, qty, unitPrice: price,
               status: isShort ? "short" : "ready",
               note: isShort ? `Only ${stock} in stock (need ${needed})` : "" };
    }));

    setDaItems(resolved.map((r, i) => ({ ...r, _id: i })));
    setDaPreparing(false);
  };

  const updateDaQty = (id, raw) => {
    setDaItems(prev => prev.map(it => {
      if (it._id !== id) return it;
      const stock = Number(it.batch?.remaining ?? it.batch?.qtyRemaining ?? 0);
      const n = Math.max(0, Number(raw) || 0);
      // Don't let the user dispense more than stock — backend would 400 anyway.
      const capped = stock > 0 ? Math.min(n, stock) : n;
      return { ...it, qty: capped };
    }));
  };

  const removeDaRow = (id) => {
    setDaItems(prev => prev.filter(it => it._id !== id));
  };

  const daSellable = daItems.filter(it => it.drug && it.qty > 0 && it.batch);
  const daTotal    = daSellable.reduce((s, it) => s + (Number(it.qty) * Number(it.unitPrice || 0)), 0);
  const daSkipped  = daItems.length - daSellable.length;

  const submitDispenseAll = async () => {
    if (daSellable.length === 0) { toast.warn("Nothing to dispense — every row is skipped"); return; }
    const visit = daVisit || {};
    const docName = visit.consultantName ||
      (visit.doctorId?.personalInfo
        ? `Dr. ${visit.doctorId.personalInfo.firstName || ""} ${visit.doctorId.personalInfo.lastName || ""}`.trim()
        : "");
    const rxRef = visit.visitNumber || "";
    setDaSaving(true);
    try {
      const r = await dispense({
        patientUHID:     searchedUhid,
        patientName:     patient?.fullName || visit.patientName || "",
        age:             patient?.age || "",
        gender:          patient?.gender || "",
        contactNumber:   patient?.contactNumber || "",
        doctorName:      docName,
        prescriptionRef: rxRef,
        saleType:        "OPD",
        paymentMode:     daPaymentMode,
        items: daSellable.map(it => ({
          drugId:          it.drug._id,
          drugName:        it.drug.brandName || it.drug.genericName || it.drug.name,
          quantity:        Number(it.qty),
          unitPrice:       Number(it.unitPrice),
          gstRate:         Number(it.drug.gstRate || it.drug.taxPercentage || 0),
          discountPercent: 0,
          prescriptionRef: rxRef,
          prescriberName:  docName,
        })),
        sourceContext: {
          source:      "OPD-Rx-DispenseAll",
          visitNumber: rxRef,
          itemCount:   daSellable.length,
        },
      });
      const billNo = r?.data?.billNumber || r?.data?.data?.billNumber || "";
      toast.success(`Dispensed ${daSellable.length} item${daSellable.length === 1 ? "" : "s"} — Bill ${billNo}`);
      setDaOpen(false);
      setDaVisit(null);
      setDaItems([]);
    } catch (e) {
      const msg = e?.response?.data?.message || e.message || "Dispense failed";
      toast.error(msg);
    } finally {
      setDaSaving(false);
    }
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      {/* Header row — UHID input + Load + Clear */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 16 }}>
        <div style={{ flex: "0 0 280px" }}>
          <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: C.muted, marginBottom: 4 }}>
            Patient UHID
          </label>
          <input
            className="his-input"
            value={uhidInput}
            onChange={(e) => setUhidInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") load(); }}
            placeholder="UH00000001"
            autoFocus
            style={{ width: "100%", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700 }}
          />
        </div>
        <button onClick={() => load()} disabled={loading || !uhidInput.trim()} style={{
          padding: "8px 18px", background: C.orange, color: "#fff", border: "none",
          borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: loading ? "not-allowed" : "pointer",
        }}>
          <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-search"}`} style={{ marginRight: 6 }} />
          {loading ? "Loading…" : "Load Rx"}
        </button>
        {/* R7cx — day-window selector. Default 7d; reload immediately
            when changed (only if we already have a searched UHID,
            otherwise the new value just becomes the next-search default). */}
        <div>
          <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: C.muted, marginBottom: 4 }}>
            Window
          </label>
          <select
            className="his-select"
            value={windowDays}
            onChange={(e) => {
              const d = Number(e.target.value);
              setWindowDays(d);
              if (searchedUhid) load(searchedUhid, d);
            }}
            style={{ fontSize: 12, padding: "8px 10px", minWidth: 120 }}
          >
            <option value={1}>Today only</option>
            <option value={3}>Last 3 days</option>
            <option value={7}>Last 7 days</option>
            <option value={15}>Last 15 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>
        {(searchedUhid || visits.length > 0) && (
          <button onClick={clearAll} style={{
            padding: "8px 14px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`,
            borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: "pointer",
          }}>
            <i className="pi pi-times" style={{ marginRight: 4 }} />
            Clear
          </button>
        )}
        <div style={{ marginLeft: "auto", fontSize: 11, color: C.muted, fontWeight: 600 }}>
          <i className="pi pi-calendar" style={{ marginRight: 4 }} />
          {today}
        </div>
      </div>

      {/* Patient header strip (only after a successful load) */}
      {patient && (
        <div style={{
          background: "#fff7ed", border: `1px solid #fed7aa`, borderRadius: 10,
          padding: "12px 16px", marginBottom: 16,
          display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center",
        }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>
            {patient.fullName || "—"}
          </div>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700, color: C.orange }}>
            {patient.UHID}
          </span>
          {patient.age != null && <span style={{ fontSize: 12, color: C.muted }}>{patient.age}y</span>}
          {patient.gender && <span style={{ fontSize: 12, color: C.muted }}>· {patient.gender}</span>}
          {patient.contactNumber && (
            <span style={{ fontSize: 12, color: C.muted }}>
              <i className="pi pi-phone" style={{ fontSize: 10, marginRight: 3 }} />
              {patient.contactNumber}
            </span>
          )}
          <span style={{ marginLeft: "auto", background: "#fff", border: `1px solid ${C.border}`, padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, color: C.text }}>
            {visits.length} visit{visits.length === 1 ? "" : "s"} today
          </span>
        </div>
      )}

      {/* R7cw — API failure state (e.g. 404 because backend didn't pick
          up the R7cr OPD-Rx route). Surface the actionable error rather
          than the misleading "no visit today" empty state. */}
      {searchedUhid && !loading && loadError && (
        <div style={{ padding: 24, background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 10, color: "#b91c1c", fontSize: 13 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <i className="pi pi-exclamation-triangle" style={{ fontSize: 18 }} />
            <strong>Could not load OPD prescriptions for {searchedUhid}</strong>
          </div>
          <div style={{ fontSize: 11.5, color: "#991b1b" }}>{loadError}</div>
        </div>
      )}

      {/* No-data state — only when the API succeeded with an empty result.
          R7cx: message reflects the active window, with a quick widen
          shortcut so the pharmacist can extend to 30 days in one click
          if the patient's prescription is older than the default 7. */}
      {searchedUhid && !loading && !loadError && visits.length === 0 && (
        <div style={{ padding: 36, textAlign: "center", background: "#f8fafc", border: `1px dashed ${C.border}`, borderRadius: 10, color: C.muted, fontSize: 13 }}>
          <i className="pi pi-info-circle" style={{ fontSize: 22, marginBottom: 8, display: "block" }} />
          No OPD visit found in the last {windowDays} day{windowDays === 1 ? "" : "s"} for <strong style={{ color: C.text }}>{searchedUhid}</strong>.<br/>
          <span style={{ fontSize: 11 }}>
            {windowDays < 30 ? (
              <>Try a wider window:
                {[15, 30].filter(d => d > windowDays).map(d => (
                  <button
                    key={d}
                    onClick={() => { setWindowDays(d); load(searchedUhid, d); }}
                    style={{
                      marginLeft: 8, padding: "2px 9px", border: `1px solid ${C.orange}`,
                      background: "#fff", color: C.orange, borderRadius: 12,
                      fontSize: 10, fontWeight: 700, cursor: "pointer",
                    }}
                  >Last {d} days</button>
                ))}
                {" "}or use the Dispense tab for a counter sale.
              </>
            ) : (
              <>Patient may not have visited OPD in the last 30 days — use the Dispense tab for a counter sale.</>
            )}
          </span>
        </div>
      )}

      {/* Per-visit cards */}
      {visits.map((v) => {
        const meds = Array.isArray(v.prescribedMedications) ? v.prescribedMedications : [];
        const doctorName = v.consultantName || (v.doctorId?.personalInfo
          ? `Dr. ${v.doctorId.personalInfo.firstName || ""} ${v.doctorId.personalInfo.lastName || ""}`.trim()
          : "—");
        const deptName = v.departmentId?.departmentName || v.department || "—";
        const dxParts = [
          v.provisionalDiagnosis && `Provisional: ${v.provisionalDiagnosis}`,
          v.workingDiagnosis     && `Working: ${v.workingDiagnosis}`,
          v.finalDiagnosis       && `Final: ${v.finalDiagnosis}`,
        ].filter(Boolean);
        return (
          <div key={v._id || v.visitNumber} style={{
            border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 14, overflow: "hidden",
          }}>
            {/* Visit header bar */}
            <div style={{
              background: "#fff", padding: "10px 14px", borderBottom: `1px solid ${C.border}`,
              display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center",
            }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700, color: C.text }}>
                {v.visitNumber}
              </span>
              <span style={{ fontSize: 12, color: C.muted }}>
                {new Date(v.visitDate).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span style={{ fontSize: 12, color: C.muted }}>· {deptName}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.orange }}>· {doctorName}</span>
              {/* Right-aligned cluster: status pill + R7dv one-click Dispense-All */}
              <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                {v.status && (
                  <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                    background: v.status === "Completed" ? "#dcfce7" : "#dbeafe",
                    color:      v.status === "Completed" ? "#15803d" : "#1d4ed8",
                    textTransform: "uppercase", letterSpacing: ".4px",
                  }}>{v.status}</span>
                )}
                {meds.length > 0 && (
                  <button
                    onClick={() => openDispenseAll(v)}
                    style={{
                      padding: "5px 14px", background: C.orange, color: "#fff", border: "none",
                      borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: "pointer",
                      boxShadow: "0 1px 3px rgba(234,88,12,.3)",
                    }}
                    title="Auto-match all prescribed medicines against inventory, cap quantities at stock, and confirm in one shot"
                  >
                    <i className="pi pi-bolt" style={{ marginRight: 5, fontSize: 11 }} />
                    Dispense All ({meds.length})
                  </button>
                )}
              </div>
            </div>

            {/* Complaint + diagnosis */}
            <div style={{ padding: "10px 14px", background: "#fafafa", borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.text }}>
              {v.chiefComplaint && (
                <div style={{ marginBottom: 4 }}>
                  <span style={{ color: C.muted, fontWeight: 600 }}>Complaint: </span>
                  {v.chiefComplaint}
                </div>
              )}
              {dxParts.length > 0 && (
                <div>
                  <span style={{ color: C.muted, fontWeight: 600 }}>Diagnosis: </span>
                  {dxParts.join(" · ")}
                  {v.icd10Code && <span style={{ marginLeft: 8, fontFamily: "'DM Mono', monospace", fontSize: 11, color: C.muted }}>[{v.icd10Code}]</span>}
                </div>
              )}
              {!v.chiefComplaint && dxParts.length === 0 && (
                <span style={{ color: C.muted, fontStyle: "italic" }}>No diagnosis recorded yet — doctor may still be assessing.</span>
              )}
            </div>

            {/* Medicines table */}
            {meds.length === 0 ? (
              <div style={{ padding: 18, textAlign: "center", color: C.muted, fontSize: 12, fontStyle: "italic" }}>
                No medicines prescribed in this visit.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px", color: C.muted, fontWeight: 700 }}>Medicine</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px", color: C.muted, fontWeight: 700, width: 110 }}>Dose</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px", color: C.muted, fontWeight: 700, width: 110 }}>Frequency</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px", color: C.muted, fontWeight: 700, width: 100 }}>Duration</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px", color: C.muted, fontWeight: 700, width: 110 }}>Meal</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px", color: C.muted, fontWeight: 700, width: 130 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {meds.map((m, i) => (
                    <tr key={i} style={{ borderTop: i === 0 ? "none" : `1px solid ${C.border}` }}>
                      <td style={{ padding: "8px 12px", fontWeight: 700, color: C.text }}>
                        {m.medicineName || "—"}
                        {m.instructions && (
                          <div style={{ fontSize: 10, fontWeight: 500, color: C.muted, marginTop: 1, fontStyle: "italic" }}>
                            {m.instructions}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "8px 12px", color: C.text }}>{m.dosage || "—"}</td>
                      <td style={{ padding: "8px 12px", color: C.text }}>{m.frequency || "—"}</td>
                      <td style={{ padding: "8px 12px", color: C.text }}>{m.duration || "—"}</td>
                      <td style={{ padding: "8px 12px", color: C.text }}>
                        {m.mealStatus
                          ? <span style={{ padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: "#e0f2fe", color: "#0369a1" }}>{m.mealStatus}</span>
                          : "—"}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right" }}>
                        <button onClick={() => openQuickDispense(m, v)} style={{
                          padding: "5px 12px", background: C.orange, color: "#fff", border: "none",
                          borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                        }}>
                          <i className="pi pi-check" style={{ marginRight: 4, fontSize: 10 }} />
                          Dispense
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {v.advice && (
              <div style={{ padding: "10px 14px", background: "#fffbeb", borderTop: `1px solid ${C.border}`, fontSize: 11, color: "#a16207" }}>
                <strong>Advice: </strong>{v.advice}
              </div>
            )}
          </div>
        );
      })}

      {/* Quick-Dispense Modal — small, single-line sale per click. */}
      {qdOpen && (
        <div onClick={() => !qdSaving && setQdOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,.55)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 520, maxWidth: "90vw", background: "#fff", borderRadius: 14,
            boxShadow: "0 20px 50px rgba(0,0,0,.3)", padding: 22,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>
                <i className="pi pi-shopping-cart" style={{ marginRight: 6, color: C.orange }} />
                Quick Dispense
              </div>
              <button onClick={() => !qdSaving && setQdOpen(false)} style={{
                background: "transparent", border: "none", fontSize: 20, color: C.muted, cursor: "pointer",
              }}>×</button>
            </div>

            {/* Doctor's prescription block — reminds the pharmacist what's
                being sold so they can sanity-check qty (e.g. 5 days × TDS
                = 15 tabs, not 5). */}
            <div style={{ background: "#fff7ed", border: `1px solid #fed7aa`, borderRadius: 8, padding: "8px 12px", fontSize: 11.5, color: C.text, marginBottom: 14 }}>
              <div><strong>{qdMed?.medicineName}</strong></div>
              <div style={{ color: C.muted, marginTop: 2 }}>
                {[qdMed?.dosage, qdMed?.frequency, qdMed?.duration, qdMed?.mealStatus].filter(Boolean).join(" · ")}
              </div>
              {qdMed?.instructions && <div style={{ color: C.muted, marginTop: 2, fontStyle: "italic" }}>{qdMed.instructions}</div>}
            </div>

            {/* Inventory drug picker */}
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: C.muted, marginBottom: 4 }}>
              Inventory Drug
            </label>
            <input
              className="his-input"
              value={qdDrugSearch}
              onChange={(e) => { setQdDrugSearch(e.target.value); setQdDrug(null); }}
              placeholder="Search brand or generic…"
              style={{ width: "100%", marginBottom: 6 }}
            />
            {qdMatches.length > 0 && !qdDrug && (
              <div style={{
                border: `1px solid ${C.border}`, borderRadius: 8, maxHeight: 180, overflowY: "auto",
                marginBottom: 10, background: "#fff",
              }}>
                {qdMatches.map((d) => (
                  <div key={d._id} onClick={() => pickDrug(d)} style={{
                    padding: "7px 12px", cursor: "pointer", fontSize: 12, borderBottom: `1px solid ${C.border}`,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#fff7ed"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
                  >
                    <div>
                      <div style={{ fontWeight: 700, color: C.text }}>{d.brandName || d.genericName || d.name}</div>
                      {d.genericName && d.brandName && <div style={{ fontSize: 10, color: C.muted }}>{d.genericName}</div>}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.orange }}>
                      ₹{Number(d.sellPrice || d.mrp || 0).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {qdDrug && (
              <div style={{ padding: "8px 12px", background: "#dcfce7", color: "#15803d", borderRadius: 6, fontSize: 11.5, marginBottom: 10 }}>
                <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                  <i className="pi pi-check" />
                  {qdDrug.brandName || qdDrug.genericName || qdDrug.name} — selected
                </div>
                {/* R7cy — surface FEFO batch info so the pharmacist sees
                    WHERE the price came from and which physical stock will
                    be consumed. Empty-stock warning if no in-stock batch
                    was found — backend will reject the sale, so flag it
                    early instead of letting submit fail. */}
                {qdBatchLoading ? (
                  <div style={{ fontSize: 10.5, color: "#166534", marginTop: 3, fontStyle: "italic" }}>
                    <i className="pi pi-spin pi-spinner" style={{ marginRight: 4, fontSize: 10 }} />
                    Looking up FEFO batch…
                  </div>
                ) : qdFefoBatch ? (
                  <div style={{ fontSize: 10.5, color: "#166534", marginTop: 3 }}>
                    Batch <strong style={{ fontFamily: "'DM Mono', monospace" }}>{qdFefoBatch.batchNo}</strong>
                    {qdFefoBatch.expiryDate && (
                      <> · exp {new Date(qdFefoBatch.expiryDate).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</>
                    )}
                    {" · "}stock {Number(qdFefoBatch.remaining ?? qdFefoBatch.qtyRemaining ?? 0)}
                    {" · "}price ₹{Number(qdFefoBatch.salePrice ?? qdFefoBatch.sellPrice ?? 0).toFixed(2)}
                  </div>
                ) : (
                  <div style={{ fontSize: 10.5, color: "#b91c1c", marginTop: 3, fontWeight: 600 }}>
                    <i className="pi pi-exclamation-triangle" style={{ marginRight: 4, fontSize: 10 }} />
                    No in-stock batch — GRN this drug first or pick a different brand.
                  </div>
                )}
              </div>
            )}

            {/* Qty + price + payment */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: C.muted, marginBottom: 3 }}>Qty</label>
                <input type="number" min="1" className="his-input" value={qdQty}
                  onChange={(e) => setQdQty(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: C.muted, marginBottom: 3 }}>Unit ₹</label>
                <input type="number" min="0" step="0.01" className="his-input" value={qdUnitPrice}
                  onChange={(e) => setQdUnitPrice(e.target.value)} style={{ width: "100%" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: C.muted, marginBottom: 3 }}>Payment</label>
                <select className="his-select" value={qdPaymentMode}
                  onChange={(e) => setQdPaymentMode(e.target.value)} style={{ width: "100%" }}>
                  {(PAYMENT_MODES || ["Cash", "Card", "UPI"]).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>
                Total: ₹{(Number(qdQty || 0) * Number(qdUnitPrice || 0)).toFixed(2)}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setQdOpen(false)} disabled={qdSaving} style={{
                  padding: "8px 16px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`,
                  borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: qdSaving ? "not-allowed" : "pointer",
                }}>Cancel</button>
                <button onClick={submitQuickDispense} disabled={qdSaving || !qdDrug} style={{
                  padding: "8px 18px", background: (qdSaving || !qdDrug) ? "#94a3b8" : C.orange,
                  color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12,
                  cursor: (qdSaving || !qdDrug) ? "not-allowed" : "pointer",
                }}>
                  <i className={`pi ${qdSaving ? "pi-spin pi-spinner" : "pi-check"}`} style={{ marginRight: 5 }} />
                  {qdSaving ? "Dispensing…" : "Confirm & Sell"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* R7dv — Dispense-All Modal: bulk sale of every prescribed med. */}
      {daOpen && (
        <div onClick={() => !daSaving && setDaOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,.55)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 940, maxWidth: "96vw", maxHeight: "90vh", background: "#fff", borderRadius: 14,
            boxShadow: "0 20px 50px rgba(0,0,0,.3)", display: "flex", flexDirection: "column",
          }}>
            {/* Header */}
            <div style={{
              padding: "14px 22px", borderBottom: `1px solid ${C.border}`,
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: `linear-gradient(135deg, ${C.orange}, ${C.orange}cc)`, color: "#fff",
            }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>
                  <i className="pi pi-bolt" style={{ marginRight: 8 }} />
                  Dispense All — Bulk Sale
                </div>
                <div style={{ fontSize: 11, opacity: 0.95, marginTop: 2 }}>
                  {daVisit?.visitNumber || ""} · {patient?.fullName || ""} ({searchedUhid})
                  {daVisit?.consultantName && <> · {daVisit.consultantName}</>}
                </div>
              </div>
              <button onClick={() => !daSaving && setDaOpen(false)} disabled={daSaving} style={{
                width: 30, height: 30, borderRadius: 7, border: "none",
                background: "rgba(255,255,255,.2)", color: "#fff",
                cursor: daSaving ? "not-allowed" : "pointer", fontSize: 16,
              }}>×</button>
            </div>

            {/* Help banner */}
            <div style={{ padding: "10px 22px", background: "#fff7ed", borderBottom: `1px solid ${C.border}`, fontSize: 11.5, color: "#9a3412", display: "flex", alignItems: "center", gap: 8 }}>
              <i className="pi pi-info-circle" style={{ fontSize: 14 }} />
              <span>
                Each prescribed medicine auto-matched against inventory + FEFO batch. Qty is computed from frequency × duration and capped at available stock. Edit any qty inline, then confirm to fire a single multi-item sale.
              </span>
            </div>

            {/* Table */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 22px" }}>
              {daPreparing ? (
                <div style={{ padding: 40, textAlign: "center", color: C.muted, fontSize: 13 }}>
                  <i className="pi pi-spin pi-spinner" style={{ fontSize: 24, marginBottom: 10, display: "block" }} />
                  Auto-matching {daItems.length} medicine{daItems.length === 1 ? "" : "s"} against inventory…
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9", borderBottom: `2px solid ${C.border}` }}>
                      <th style={{ padding: "8px 8px", textAlign: "left",  fontSize: 10, color: C.muted, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px" }}>Prescribed</th>
                      <th style={{ padding: "8px 8px", textAlign: "left",  fontSize: 10, color: C.muted, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px" }}>Matched (FEFO Batch)</th>
                      <th style={{ padding: "8px 6px", textAlign: "center",fontSize: 10, color: C.muted, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", width: 70 }}>Stock</th>
                      <th style={{ padding: "8px 6px", textAlign: "center",fontSize: 10, color: C.muted, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", width: 70 }}>Need</th>
                      <th style={{ padding: "8px 6px", textAlign: "center",fontSize: 10, color: C.muted, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", width: 100 }}>Dispense</th>
                      <th style={{ padding: "8px 6px", textAlign: "right", fontSize: 10, color: C.muted, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", width: 80 }}>Rate</th>
                      <th style={{ padding: "8px 6px", textAlign: "right", fontSize: 10, color: C.muted, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", width: 90 }}>Line ₹</th>
                      <th style={{ padding: "8px 4px", width: 32 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {daItems.map((it) => {
                      const stock = Number(it.batch?.remaining ?? it.batch?.qtyRemaining ?? 0);
                      const isReady    = it.status === "ready";
                      const isShort    = it.status === "short";
                      const isOOS      = it.status === "out-of-stock";
                      const isNoMatch  = it.status === "no-match";
                      const rowBg = isNoMatch || isOOS ? "#fef2f2" : isShort ? "#fefce8" : "#fff";
                      const lineTotal = Number(it.qty) * Number(it.unitPrice || 0);
                      return (
                        <tr key={it._id} style={{ borderBottom: `1px solid ${C.border}`, background: rowBg }}>
                          <td style={{ padding: "9px 8px", verticalAlign: "top" }}>
                            <div style={{ fontWeight: 700, color: C.text, fontSize: 12 }}>{it.med?.medicineName || "—"}</div>
                            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>
                              {[it.med?.dosage, it.med?.frequency, it.med?.duration].filter(Boolean).join(" · ")}
                            </div>
                          </td>
                          <td style={{ padding: "9px 8px", verticalAlign: "top" }}>
                            {isNoMatch ? (
                              <span style={{ color: C.red, fontWeight: 700, fontSize: 11 }}>
                                <i className="pi pi-times-circle" style={{ marginRight: 4 }} />No inventory match
                              </span>
                            ) : isOOS ? (
                              <span style={{ color: C.red, fontWeight: 700, fontSize: 11 }}>
                                <i className="pi pi-exclamation-triangle" style={{ marginRight: 4 }} />
                                {it.drug?.brandName || it.drug?.genericName || it.drug?.name} — out of stock
                              </span>
                            ) : (
                              <>
                                <div style={{ fontWeight: 700, color: C.text, fontSize: 11.5 }}>
                                  {it.drug?.brandName || it.drug?.genericName || it.drug?.name}
                                </div>
                                <div style={{ fontSize: 10, color: C.muted, marginTop: 1, fontFamily: "DM Mono, monospace" }}>
                                  {it.batch?.batchNo}{it.batch?.expiryDate && <> · exp {new Date(it.batch.expiryDate).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })}</>}
                                </div>
                              </>
                            )}
                          </td>
                          <td style={{ padding: "9px 6px", textAlign: "center", fontWeight: 700, color: isOOS || isNoMatch ? C.muted : (stock < it.needed ? C.amber : C.green) }}>
                            {isNoMatch ? "—" : stock}
                          </td>
                          <td style={{ padding: "9px 6px", textAlign: "center", color: C.muted, fontWeight: 600 }}>
                            {it.needed}
                          </td>
                          <td style={{ padding: "9px 6px", textAlign: "center" }}>
                            <input
                              type="number" min="0" max={stock || undefined}
                              value={it.qty}
                              disabled={isNoMatch || isOOS}
                              onChange={(e) => updateDaQty(it._id, e.target.value)}
                              style={{
                                width: 70, padding: "4px 6px", textAlign: "center",
                                border: `1.5px solid ${C.border}`, borderRadius: 6, fontSize: 12, fontWeight: 700,
                                color: isNoMatch || isOOS ? C.muted : C.text,
                                background: isNoMatch || isOOS ? "#f8fafc" : "#fff",
                              }}
                            />
                          </td>
                          <td style={{ padding: "9px 6px", textAlign: "right", color: C.muted, fontWeight: 600 }}>
                            {it.unitPrice > 0 ? `₹${Number(it.unitPrice).toFixed(2)}` : "—"}
                          </td>
                          <td style={{ padding: "9px 6px", textAlign: "right", fontWeight: 800, color: lineTotal > 0 ? C.text : C.muted }}>
                            {lineTotal > 0 ? fmtINR(lineTotal) : "—"}
                          </td>
                          <td style={{ padding: "9px 4px", textAlign: "center" }}>
                            <button onClick={() => removeDaRow(it._id)} title="Skip this medicine" style={{
                              width: 24, height: 24, padding: 0, borderRadius: 5,
                              border: `1px solid ${C.border}`, background: "#fff", color: C.muted,
                              fontSize: 11, cursor: "pointer",
                            }}>
                              <i className="pi pi-times" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {daItems.length === 0 && (
                      <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: C.muted, fontStyle: "italic" }}>No items left — all skipped.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: "14px 22px", borderTop: `1px solid ${C.border}`, background: "#f8fafc",
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap",
            }}>
              <div style={{ display: "flex", gap: 24, alignItems: "center", fontSize: 12 }}>
                <div>
                  <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>Items</div>
                  <div style={{ color: C.text, fontWeight: 800, fontSize: 15, marginTop: 1 }}>
                    {daSellable.length}<span style={{ color: C.muted, fontSize: 11, fontWeight: 600 }}> / {daItems.length}</span>
                    {daSkipped > 0 && <span style={{ marginLeft: 8, fontSize: 10.5, color: C.amber, fontWeight: 700 }}>({daSkipped} skipped)</span>}
                  </div>
                </div>
                <div>
                  <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>Total</div>
                  <div style={{ color: C.orange, fontWeight: 800, fontSize: 17, marginTop: 1 }}>{fmtINR(daTotal)}</div>
                </div>
                <div>
                  <div style={{ color: C.muted, fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>Payment</div>
                  <select className="his-select" value={daPaymentMode} onChange={(e) => setDaPaymentMode(e.target.value)}
                    style={{ fontSize: 12, padding: "5px 8px", minWidth: 100 }}>
                    {(PAYMENT_MODES || ["Cash", "Card", "UPI"]).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => !daSaving && setDaOpen(false)} disabled={daSaving} style={{
                  padding: "9px 18px", background: "#fff", color: C.muted, border: `1.5px solid ${C.border}`,
                  borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: daSaving ? "not-allowed" : "pointer",
                }}>Cancel</button>
                <button onClick={submitDispenseAll} disabled={daSaving || daPreparing || daSellable.length === 0} style={{
                  padding: "10px 22px",
                  background: (daSaving || daPreparing || daSellable.length === 0) ? "#94a3b8" : C.orange,
                  color: "#fff", border: "none", borderRadius: 8, fontWeight: 800, fontSize: 13,
                  cursor: (daSaving || daPreparing || daSellable.length === 0) ? "not-allowed" : "pointer",
                  boxShadow: "0 2px 5px rgba(234,88,12,.3)",
                }}>
                  <i className={`pi ${daSaving ? "pi-spin pi-spinner" : "pi-check-circle"}`} style={{ marginRight: 6 }} />
                  {daSaving ? "Dispensing…" : `Confirm & Sell ${daSellable.length} item${daSellable.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   R7cu — IPD CREDIT LEDGER TAB
   Pharmacist sees every active IPD admission with pharmacy
   outstanding > 0, drills in to collect payment. The discharge
   flow at admissionController.clearFinalBill is HARD-blocked
   on the same outstanding > 0 condition, so this tab is the
   only place that credit can be cleared before discharge.
══════════════════════════════════════════════════════════════════ */
function IPDCreditTab() {
  const [loading, setLoading]   = useState(false);
  const [rows, setRows]         = useState([]);
  const [summary, setSummary]   = useState({ admissions: 0, totalOutstanding: 0 });
  const [openAdm, setOpenAdm]   = useState(null);  // selected admission detail blob
  const [openLoading, setOpenLoading] = useState(false);

  // R7cv — Per-day history of all IPD credit sales (both outstanding +
  // already-paid). Pharmacist asked for "every IPD jisme pharmacy se
  // credit pr kuch gya hai" — not just current outstanding.
  const [histLoading, setHistLoading] = useState(false);
  const [hist, setHist]               = useState([]);                // [{dateKey, totalDispensed, ..., bills:[]}]
  const [histSummary, setHistSummary] = useState({ days: 0, bills: 0, totalDispensed: 0, totalCollected: 0, totalOutstanding: 0 });
  const [histDays, setHistDays]       = useState(30);                // window selector
  const [expandedDay, setExpandedDay] = useState(null);              // dateKey of the open day-card

  // Per-bill collection modal — open with `setCollect({sale, max})`.
  const [collect, setCollect] = useState(null);
  const [colAmt, setColAmt]   = useState("");
  const [colMode, setColMode] = useState("Cash");
  const [colTxn, setColTxn]   = useState("");
  const [colNotes, setColNotes] = useState("");
  const [colSaving, setColSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API_ENDPOINTS.BASE}/pharmacy/credit/ipd-admissions`);
      setRows(r?.data?.data || []);
      setSummary(r?.data?.summary || { admissions: 0, totalOutstanding: 0 });
    } catch (e) {
      // R7cv: if the new credit route 404s, the backend likely needs
      // restart — make the message actionable instead of just relaying
      // a generic "Route not found".
      const status = e?.response?.status;
      const isMissingRoute = status === 404 || e?.response?.data?.message === "Route not found";
      toast.error(isMissingRoute
        ? "Pharmacy credit endpoint unavailable — backend may need restart to pick up R7cu routes."
        : (e?.response?.data?.message || "Failed to load IPD credit ledger"));
    } finally { setLoading(false); }
  };
  const loadHistory = async (days = histDays) => {
    setHistLoading(true);
    try {
      const r = await axios.get(`${API_ENDPOINTS.BASE}/pharmacy/credit/ipd-history?days=${days}`);
      setHist(r?.data?.data || []);
      setHistSummary(r?.data?.summary || { days: 0, bills: 0, totalDispensed: 0, totalCollected: 0, totalOutstanding: 0 });
    } catch (e) {
      // Quietly fail — the outstanding view above is the primary, the
      // history is the audit overlay. A backend-restart-pending toast
      // already fires from load() so we don't double-notify.
      console.warn("[IPDCreditTab] history fetch failed:", e?.message);
      setHist([]);
    } finally { setHistLoading(false); }
  };
  useEffect(() => { load(); loadHistory(); }, []);

  const openAdmission = async (adm) => {
    setOpenLoading(true);
    setOpenAdm({ admission: null, openSales: [], closedSales: [], totalOutstanding: 0, _meta: adm });
    try {
      const r = await axios.get(`${API_ENDPOINTS.BASE}/pharmacy/credit/admission/${adm.admissionId}`);
      setOpenAdm({ ...(r?.data?.data || {}), _meta: adm });
    } catch (e) {
      toast.error(e?.response?.data?.message || "Failed to load credit detail");
    } finally { setOpenLoading(false); }
  };

  const startCollect = (sale) => {
    const bal = Number(sale.balanceDue?.toString?.() ?? sale.balanceDue ?? 0);
    setCollect({ sale, max: bal });
    setColAmt(String(bal.toFixed(2)));   // default = clear in full
    setColMode("Cash");
    setColTxn("");
    setColNotes("");
  };

  const submitCollect = async () => {
    if (!collect?.sale?._id) return;
    const amt = Number(colAmt);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.warn("Enter a positive collection amount"); return;
    }
    if (amt > collect.max + 0.01) {
      toast.warn(`Amount cannot exceed outstanding ₹${collect.max.toFixed(2)}`); return;
    }
    setColSaving(true);
    try {
      const r = await axios.post(
        `${API_ENDPOINTS.BASE}/pharmacy/sales/${collect.sale._id}/collect-credit`,
        { amount: amt, mode: colMode, txnRef: colTxn, notes: colNotes },
      );
      toast.success(r?.data?.message || "Collection recorded");
      setCollect(null);
      // Refresh both the list AND the open admission drawer so the
      // outstanding numbers move immediately. Also reload the per-day
      // history (R7cv) so today's collected total bumps + outstanding
      // drops in real-time.
      await load();
      await loadHistory();
      if (openAdm?._meta) await openAdmission(openAdm._meta);
    } catch (e) {
      const msg = e?.response?.data?.message || e.message || "Collect failed";
      toast.error(msg);
    } finally { setColSaving(false); }
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      {/* Hero strip */}
      <div style={{ display: "flex", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "#92400e" }}>
            Admissions with Outstanding
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#92400e", marginTop: 4, fontFamily: "'DM Mono', monospace" }}>
            {summary.admissions}
          </div>
        </div>
        <div style={{ flex: "1 1 220px", background: "#fee2e2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "#b91c1c" }}>
            Total Pharmacy Outstanding
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#b91c1c", marginTop: 4, fontFamily: "'DM Mono', monospace" }}>
            {fmtINR(summary.totalOutstanding)}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
          <button onClick={load} disabled={loading} style={{
            padding: "8px 14px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`,
            borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12,
          }}>
            <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} style={{ marginRight: 5 }} />
            Refresh
          </button>
        </div>
      </div>

      {/* Hard-block notice */}
      <div style={{
        background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af",
        borderRadius: 8, padding: "8px 14px", fontSize: 11.5, marginBottom: 14,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <i className="pi pi-lock" style={{ fontSize: 12 }} />
        <span><strong>Discharge gate active.</strong> Until every row below shows ₹0 outstanding, the receptionist cannot clear the patient's final bill — they'll see a 409 with a deep-link to this tab.</span>
      </div>

      {loading && rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: C.muted }}>
          <i className="pi pi-spin pi-spinner" style={{ fontSize: 24 }} />
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 36, textAlign: "center", background: "#f0fdf4", border: "1px dashed #86efac", borderRadius: 10, color: "#15803d", fontSize: 13 }}>
          <i className="pi pi-check-circle" style={{ fontSize: 22, marginBottom: 8, display: "block" }} />
          All IPD pharmacy bills are fully paid. No admissions blocking discharge.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f1f5f9" }}>
              <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>Admission</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>Patient</th>
              <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>Bed / Ward</th>
              <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", width: 80 }}>Bills</th>
              <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", width: 130 }}>Outstanding</th>
              <th style={{ padding: "8px 12px", textAlign: "right", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", width: 110 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={String(r.admissionId)} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: "8px 12px", fontFamily: "'DM Mono', monospace", fontWeight: 700, color: C.text }}>
                  {r.admissionNumber}
                  {r.admissionStatus !== "Active" && (
                    <span style={{ marginLeft: 6, fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "#f1f5f9", color: C.muted, fontWeight: 700 }}>
                      {r.admissionStatus}
                    </span>
                  )}
                </td>
                <td style={{ padding: "8px 12px", color: C.text }}>
                  <div style={{ fontWeight: 700 }}>{r.patientFullName || "—"}</div>
                  <div style={{ fontSize: 10, color: C.muted, fontFamily: "'DM Mono', monospace" }}>{r.UHID}</div>
                </td>
                <td style={{ padding: "8px 12px", color: C.text, fontSize: 11 }}>
                  {r.bedNumber} · {r.wardName}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right", color: C.text, fontFamily: "'DM Mono', monospace" }}>
                  {r.billCount}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 800, color: "#b91c1c", fontFamily: "'DM Mono', monospace" }}>
                  {fmtINR(r.outstanding)}
                </td>
                <td style={{ padding: "8px 12px", textAlign: "right" }}>
                  <button onClick={() => openAdmission(r)} style={{
                    padding: "5px 12px", background: C.orange, color: "#fff", border: "none",
                    borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                  }}>
                    <i className="pi pi-arrow-right" style={{ marginRight: 4, fontSize: 10 }} />
                    Collect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── R7cv: Per-Day History ─────────────────────────────────
          The outstanding table above is "what blocks discharge RIGHT
          NOW". This section is "what went out on credit, every day,
          regardless of whether it's been paid since" — pharmacist
          audit view + cross-check against ward registers. */}
      <div style={{ marginTop: 22 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, letterSpacing: ".2px" }}>
            <i className="pi pi-calendar" style={{ marginRight: 6, color: C.orange }} />
            Day-wise IPD Credit Ledger
          </div>
          <select
            value={histDays}
            onChange={(e) => { const d = Number(e.target.value); setHistDays(d); loadHistory(d); }}
            className="his-select"
            style={{ fontSize: 11, padding: "4px 10px" }}
          >
            <option value={7}>Last 7 days</option>
            <option value={15}>Last 15 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
            <option value={180}>Last 180 days</option>
          </select>
          <div style={{ marginLeft: "auto", fontSize: 11, color: C.muted }}>
            {histSummary.bills} bill{histSummary.bills === 1 ? "" : "s"} · Dispensed <strong style={{ color: C.text }}>{fmtINR(histSummary.totalDispensed)}</strong>
            {" · "}Collected <strong style={{ color: C.green }}>{fmtINR(histSummary.totalCollected)}</strong>
            {histSummary.totalOutstanding > 0 && <> · Outstanding <strong style={{ color: "#b91c1c" }}>{fmtINR(histSummary.totalOutstanding)}</strong></>}
          </div>
        </div>

        {histLoading && hist.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: C.muted }}>
            <i className="pi pi-spin pi-spinner" style={{ fontSize: 20 }} />
          </div>
        ) : hist.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", background: "#f8fafc", border: `1px dashed ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 12 }}>
            No IPD credit dispensed in the last {histDays} days.
          </div>
        ) : (
          <div>
            {hist.map((day) => {
              const open  = expandedDay === day.dateKey;
              const date  = new Date(day.dateKey);
              const label = date.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
              return (
                <div key={day.dateKey} style={{ border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
                  <div onClick={() => setExpandedDay(open ? null : day.dateKey)} style={{
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px", background: open ? "#fff7ed" : "#fff",
                  }}>
                    <i className={`pi ${open ? "pi-chevron-down" : "pi-chevron-right"}`} style={{ fontSize: 11, color: C.muted }} />
                    <span style={{ fontWeight: 800, fontSize: 12.5, color: C.text }}>{label}</span>
                    <span style={{ fontSize: 11, color: C.muted, padding: "1px 8px", background: "#f1f5f9", borderRadius: 10, fontWeight: 700 }}>
                      {day.billCount} bill{day.billCount === 1 ? "" : "s"}
                    </span>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontSize: 11.5 }}>
                      <span><span style={{ color: C.muted }}>Dispensed </span><strong style={{ color: C.text, fontFamily: "'DM Mono', monospace" }}>{fmtINR(day.totalDispensed)}</strong></span>
                      <span><span style={{ color: C.muted }}>Collected </span><strong style={{ color: C.green, fontFamily: "'DM Mono', monospace" }}>{fmtINR(day.totalCollected)}</strong></span>
                      <span>
                        <span style={{ color: C.muted }}>Outstanding </span>
                        <strong style={{
                          color: day.totalOutstanding > 0 ? "#b91c1c" : "#15803d",
                          fontFamily: "'DM Mono', monospace",
                        }}>{fmtINR(day.totalOutstanding)}</strong>
                      </span>
                    </div>
                  </div>
                  {open && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, borderTop: `1px solid ${C.border}` }}>
                      <thead>
                        <tr style={{ background: "#fafafa" }}>
                          <th style={{ padding: "6px 12px", textAlign: "left", fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Bill #</th>
                          <th style={{ padding: "6px 12px", textAlign: "left", fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Admission</th>
                          <th style={{ padding: "6px 12px", textAlign: "left", fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Patient</th>
                          <th style={{ padding: "6px 12px", textAlign: "left", fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" }}>Items</th>
                          <th style={{ padding: "6px 12px", textAlign: "right", fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", width: 100 }}>Total</th>
                          <th style={{ padding: "6px 12px", textAlign: "right", fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", width: 100 }}>Paid</th>
                          <th style={{ padding: "6px 12px", textAlign: "right", fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", width: 110 }}>Outstanding</th>
                          <th style={{ padding: "6px 12px", textAlign: "center", fontSize: 10, color: C.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", width: 90 }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {day.bills.map(b => (
                          // R7db-2 — Use a composite key. INDENT rows reuse the
                          // PatientBill _id across multiple days, so a plain
                          // b._id collides. Suffix with dateKey + source.
                          <tr key={`${b._id}-${day.dateKey}-${b.source || "SALE"}`} style={{ borderTop: `1px solid ${C.border}` }}>
                            <td style={{ padding: "6px 12px", fontFamily: "'DM Mono', monospace", color: C.text, fontWeight: 700 }}>
                              {b.billNumber}
                              {/* R7db-2 — source pill: INDENT (ward) vs SALE (counter) */}
                              {b.source === "INDENT" && (
                                <span style={{ marginLeft: 6, fontSize: 8, fontWeight: 800, color: "#fff", background: "#b45309", padding: "1px 5px", borderRadius: 3 }}>
                                  INDENT
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "6px 12px", fontFamily: "'DM Mono', monospace", color: C.muted, fontSize: 10.5 }}>{b.admissionNumber || "—"}</td>
                            <td style={{ padding: "6px 12px", color: C.text }}>
                              <div style={{ fontWeight: 600 }}>{b.patientName || "—"}</div>
                              <div style={{ fontSize: 9.5, color: C.muted, fontFamily: "'DM Mono', monospace" }}>{b.UHID}</div>
                            </td>
                            <td style={{ padding: "6px 12px", color: C.muted, fontSize: 10.5, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                              title={(b.items || []).map(i => `${i.drugName} × ${i.quantity}`).join(", ")}>
                              {(b.items || []).slice(0, 2).map(i => `${i.drugName} × ${i.quantity}`).join(", ")}
                              {(b.items || []).length > 2 && ` +${b.items.length - 2}`}
                            </td>
                            <td style={{ padding: "6px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: C.text }}>{fmtINR(b.grandTotal)}</td>
                            <td style={{ padding: "6px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: C.green }}>{fmtINR(b.amountPaid)}</td>
                            <td style={{ padding: "6px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: b.balanceDue > 0 ? "#b91c1c" : "#15803d", fontWeight: 700 }}>
                              {fmtINR(b.balanceDue)}
                            </td>
                            <td style={{ padding: "6px 12px", textAlign: "center" }}>
                              <span style={{
                                padding: "2px 8px", borderRadius: 10, fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px",
                                background: b.cleared ? "#dcfce7" : "#fef3c7",
                                color:      b.cleared ? "#15803d" : "#a16207",
                              }}>
                                {b.cleared ? "Paid" : "Credit"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Drill-down drawer */}
      {openAdm && (
        <div onClick={() => setOpenAdm(null)} style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,.55)",
          display: "flex", alignItems: "stretch", justifyContent: "flex-end", zIndex: 9999,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 720, maxWidth: "95vw", background: "#fff",
            boxShadow: "-12px 0 40px rgba(0,0,0,.3)", padding: 22, overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>
                Pharmacy Credit — {openAdm._meta?.admissionNumber}
              </div>
              <button onClick={() => setOpenAdm(null)} style={{
                background: "transparent", border: "none", fontSize: 22, color: C.muted, cursor: "pointer",
              }}>×</button>
            </div>

            {openLoading || !openAdm.admission ? (
              <div style={{ padding: 60, textAlign: "center", color: C.muted }}>
                <i className="pi pi-spin pi-spinner" style={{ fontSize: 24 }} />
              </div>
            ) : (
              <>
                <div style={{ background: "#f8fafc", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 11.5 }}>
                  <div style={{ fontWeight: 800, color: C.text, fontSize: 13, marginBottom: 4 }}>
                    {openAdm.admission.patientId?.fullName || openAdm._meta?.patientName}
                  </div>
                  <div style={{ color: C.muted }}>
                    <span style={{ fontFamily: "'DM Mono', monospace" }}>{openAdm.admission.UHID}</span>
                    {openAdm.admission.patientId?.age != null && <> · {openAdm.admission.patientId.age}y</>}
                    {openAdm.admission.patientId?.gender && <> · {openAdm.admission.patientId.gender}</>}
                    {openAdm.admission.patientId?.contactNumber && <> · <i className="pi pi-phone" style={{ fontSize: 9 }} /> {openAdm.admission.patientId.contactNumber}</>}
                  </div>
                  <div style={{ color: C.muted, marginTop: 2 }}>
                    Bed {openAdm.admission.bedId?.bedNumber || openAdm.admission.bedNumber || "—"} · {openAdm.admission.bedId?.wardName || openAdm.admission.wardName || openAdm.admission.department || "—"}
                    {/* R7ey-F39: attendingDoctor is canonical; primaryConsultant was phantom */}
                    {(openAdm.admission.attendingDoctor || openAdm.admission.primaryConsultant) && <> · {openAdm.admission.attendingDoctor || openAdm.admission.primaryConsultant}</>}
                  </div>
                </div>

                {/* Open (outstanding) bills */}
                <div style={{ fontSize: 11, fontWeight: 800, color: "#b91c1c", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>
                  Outstanding Bills · {fmtINR(openAdm.totalOutstanding)}
                </div>
                {openAdm.openSales.length === 0 ? (
                  <div style={{ padding: 18, textAlign: "center", color: "#15803d", background: "#f0fdf4", borderRadius: 8, fontSize: 12, marginBottom: 14 }}>
                    <i className="pi pi-check-circle" style={{ marginRight: 6 }} />
                    Fully cleared — discharge is unblocked.
                  </div>
                ) : (
                  <div style={{ marginBottom: 14 }}>
                    {openAdm.openSales.map((s) => {
                      const bal   = Number(s.balanceDue?.toString?.() ?? s.balanceDue ?? 0);
                      const total = Number(s.grandTotal?.toString?.() ?? s.grandTotal ?? 0);
                      const paid  = Number(s.amountPaid?.toString?.() ?? s.amountPaid ?? 0);
                      return (
                        <div key={s._id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 12, color: C.text }}>
                              {s.billNumber}
                            </span>
                            <span style={{ fontSize: 10, color: C.muted }}>
                              {new Date(s.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, marginBottom: 6 }}>
                            <span>Total {fmtINR(total)} · Paid {fmtINR(paid)}</span>
                            <strong style={{ color: "#b91c1c" }}>Due {fmtINR(bal)}</strong>
                          </div>
                          {Array.isArray(s.items) && s.items.length > 0 && (
                            <div style={{ fontSize: 10.5, color: C.muted, marginBottom: 8, fontStyle: "italic" }}>
                              {s.items.slice(0, 3).map(i => i.drugName).join(", ")}
                              {s.items.length > 3 && ` +${s.items.length - 3} more`}
                            </div>
                          )}
                          <button onClick={() => startCollect(s)} style={{
                            padding: "6px 14px", background: C.green, color: "#fff", border: "none",
                            borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                          }}>
                            <i className="pi pi-wallet" style={{ marginRight: 5, fontSize: 10 }} />
                            Collect ₹{bal.toFixed(2)}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* R7db-2 — Ward-dispensed indent items (PatientBill PHARM-* lines).
                    These never become PharmacySale rows — they live on the
                    admission's IPD PatientBill via autoBillingService.onIndentReleased.
                    Collection happens through the receptionist's bill-payment flow,
                    not the pharmacy collect-credit endpoint, so we surface them
                    as read-only here with a deep-link to the patient billing page. */}
                {Array.isArray(openAdm.openBills) && openAdm.openBills.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#b45309", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6, marginTop: 4 }}>
                      Ward-Dispensed (Indent) · {fmtINR(openAdm.breakdown?.wardIndent || 0)}
                    </div>
                    <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", fontSize: 10.5, color: "#92400e", marginBottom: 8, lineHeight: 1.5 }}>
                      <i className="pi pi-info-circle" style={{ marginRight: 5 }} />
                      Drugs released to the ward against nurse-raised indents.
                      Charged on the IPD bill and collected at the reception
                      billing counter (not at the pharmacy counter).
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      {openAdm.openBills.map((b) => (
                        <div key={b._id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8, background: "#fffbeb" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 12, color: C.text }}>
                              {b.billNumber}
                              <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: "#fff", background: "#b45309", padding: "1px 6px", borderRadius: 4 }}>
                                INDENT
                              </span>
                            </span>
                            <span style={{ fontSize: 10, color: C.muted }}>
                              {b.createdAt && new Date(b.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}
                              {" · "}{b.billStatus}
                            </span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, marginBottom: 6 }}>
                            <span>Pharmacy items {fmtINR(b.pharmNet)} · Bill bal {fmtINR(b.billBalance)}</span>
                            <strong style={{ color: "#b45309" }}>Pharmacy share {fmtINR(b.pharmBalance)}</strong>
                          </div>
                          {Array.isArray(b.items) && b.items.length > 0 && (
                            <div style={{ fontSize: 10.5, color: C.muted, fontStyle: "italic" }}>
                              {b.items.slice(0, 4).map(i => `${i.serviceName || i.serviceCode} ×${i.quantity}`).join(", ")}
                              {b.items.length > 4 && ` +${b.items.length - 4} more`}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Already-paid bills (history) */}
                {openAdm.closedSales.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#15803d", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>
                      Already Cleared
                    </div>
                    <div style={{ fontSize: 11 }}>
                      {openAdm.closedSales.map((s) => {
                        const total = Number(s.grandTotal?.toString?.() ?? s.grandTotal ?? 0);
                        return (
                          <div key={s._id} style={{ padding: "6px 12px", border: `1px solid ${C.border}`, borderRadius: 6, marginBottom: 4, display: "flex", justifyContent: "space-between", color: C.muted }}>
                            <span style={{ fontFamily: "'DM Mono', monospace" }}>{s.billNumber}</span>
                            <span>{fmtINR(total)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Collection modal */}
      {collect && (
        <div onClick={() => !colSaving && setCollect(null)} style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,.55)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 460, maxWidth: "90vw", background: "#fff", borderRadius: 14, padding: 22,
            boxShadow: "0 20px 50px rgba(0,0,0,.3)",
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 12 }}>
              <i className="pi pi-wallet" style={{ marginRight: 6, color: C.green }} />
              Collect Pharmacy Credit
            </div>
            <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", fontSize: 11.5, color: "#92400e", marginBottom: 12 }}>
              <strong>{collect.sale.billNumber}</strong> · Outstanding <strong>₹{collect.max.toFixed(2)}</strong>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", marginBottom: 3 }}>Amount</label>
                <input type="number" min="0" step="0.01" className="his-input"
                  value={colAmt} onChange={(e) => setColAmt(e.target.value)}
                  style={{ width: "100%", fontFamily: "'DM Mono', monospace", fontWeight: 700 }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", marginBottom: 3 }}>Mode</label>
                <select className="his-select" value={colMode}
                  onChange={(e) => setColMode(e.target.value)} style={{ width: "100%" }}>
                  {["Cash", "Card", "UPI", "Mixed"].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", marginBottom: 3 }}>Txn Ref (optional)</label>
              <input className="his-input" value={colTxn}
                onChange={(e) => setColTxn(e.target.value)}
                placeholder="UPI ref / card last-4 / cheque #"
                style={{ width: "100%" }} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", marginBottom: 3 }}>Notes (optional)</label>
              <input className="his-input" value={colNotes}
                onChange={(e) => setColNotes(e.target.value)}
                placeholder="e.g. paid by family member at counter"
                style={{ width: "100%" }} />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setCollect(null)} disabled={colSaving} style={{
                padding: "8px 16px", background: "#fff", color: C.muted, border: `1px solid ${C.border}`,
                borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: colSaving ? "not-allowed" : "pointer",
              }}>Cancel</button>
              <button onClick={submitCollect} disabled={colSaving} style={{
                padding: "8px 18px", background: colSaving ? "#94a3b8" : C.green,
                color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12,
                cursor: colSaving ? "not-allowed" : "pointer",
              }}>
                <i className={`pi ${colSaving ? "pi-spin pi-spinner" : "pi-check"}`} style={{ marginRight: 5 }} />
                {colSaving ? "Recording…" : "Confirm Collection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
