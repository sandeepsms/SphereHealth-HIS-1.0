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
import TEMPLATES from "../../Components/print/printables/PharmacyBillTemplates";
import PharmacyBill from "../../Components/print/printables/PharmacyBill";
import PharmacyRegister, { REGISTER_HEADERS } from "../../Components/print/printables/PharmacyRegister";
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

/* HIS UHID bridge — call this with a UHID and get back a normalised
   { patientId, patientName, age, gender, contact, doctorName, admissionId,
     saleType }. Tries the active-admission endpoint first (so IPD bills
     can link back to the admission); if that returns nothing, falls back
     to the patient-master lookup. */
async function lookupHisPatient(uhid) {
  if (!uhid || !uhid.trim()) return null;
  const token = localStorage.getItem("his_token");
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

const TABS = [
  { key: "dashboard", label: "Dashboard",  icon: "pi-th-large" },
  { key: "drugs",     label: "Drug Master",icon: "pi-list" },
  { key: "inventory", label: "Inventory",  icon: "pi-box" },
  { key: "grn",       label: "Goods Receipt", icon: "pi-download" },
  { key: "dispense",  label: "Dispense",   icon: "pi-shopping-cart" },
  { key: "sales",     label: "Sales Register", icon: "pi-receipt" },
  { key: "registers", label: "Registers",  icon: "pi-book" },
  { key: "suppliers", label: "Suppliers",  icon: "pi-truck" },
  { key: "settings",  label: "Settings",   icon: "pi-cog" },
];

const fmtINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const daysUntil = (d) => d ? Math.floor((new Date(d).getTime() - Date.now()) / 86400000) : null;

export default function PharmacyHomePage() {
  const [tab, setTab] = useState("dashboard");

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
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px" }}>Pharmacy</div>
            <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>
              Drug master · batch inventory · GRN · dispense · sales register
            </div>
          </div>
        </div>

        {/* Tab strip */}
        <div style={{
          background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
          padding: 6, marginBottom: 14, display: "flex", gap: 4, overflowX: "auto",
        }}>
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{
                  padding: "9px 16px", borderRadius: 8, border: "none",
                  background: active ? C.orangeL : "transparent",
                  color:      active ? C.orange  : C.muted,
                  fontWeight: 700, fontSize: 12.5, cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 7,
                  whiteSpace: "nowrap",
                  borderBottom: active ? `2px solid ${C.orange}` : "2px solid transparent",
                  transition: "all .12s",
                }}>
                <i className={`pi ${t.icon}`} style={{ fontSize: 11 }} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Tab body */}
        {tab === "dashboard" && <DashboardTab />}
        {tab === "drugs"     && <DrugsTab />}
        {tab === "inventory" && <InventoryTab />}
        {tab === "grn"       && <GRNTab />}
        {tab === "dispense"  && <DispenseTab />}
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

  return (
    <div>
      {/* KPI strip */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
          <KPI label="Drugs catalogued"   value={stats.drugsCount}                  color={C.text}    icon="pi-list" />
          <KPI label="Active batches"     value={stats.batchesInStock}              color={C.blue}    icon="pi-box" />
          <KPI label="Stock value"        value={fmtINR(stats.stockValue)}          color={C.green}   icon="pi-indian-rupee" />
          <KPI label="Expiring 90d"       value={stats.expiringWithin90Days}        color={C.amber}   icon="pi-clock" />
          <KPI label="Already expired"    value={stats.alreadyExpired}              color={C.red}     icon="pi-exclamation-triangle" />
          <KPI label="Today sales"        value={`${stats.todaySales.count} · ${fmtINR(stats.todaySales.total)}`} color={C.purple} icon="pi-receipt" />
        </div>
      )}

      {/* Alert sections */}
      <AlertSection title="Low stock — at or below reorder level" color={C.amber}
        empty="All drugs above reorder level."
        rows={alerts.lowStock} cols={[["drugName","Drug",2],["totalRemaining","On hand",1],["reorderLevel","Reorder at",1]]} />

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

  const refresh = async () => {
    try { setDrugs((await listDrugs({ q, category })).data || []); }
    catch (e) { toast.error(e.message); }
  };
  useEffect(() => { refresh(); }, [q, category]);

  const remove = async (d) => {
    if (!window.confirm(`Deactivate ${d.name}?`)) return;
    try { await deleteDrug(d._id); toast.success(`${d.name} deactivated`); refresh(); }
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
                <div style={{ fontWeight: 700 }}>{d.name}</div>
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
        <DrugModal drug={edit} onClose={() => { setEdit(null); setAdding(false); }} onSaved={refresh} />
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
   GRN TAB — record goods receipt
══════════════════════════════════════════════════════════════════ */
function GRNTab() {
  const [drugs, setDrugs] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState({
    drugId: "", supplierId: "", batchNo: "", mfgDate: "", expiryDate: "",
    quantityIn: 0, purchaseRate: 0, mrp: 0, salePrice: 0,
    invoiceNo: "", invoiceDate: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setDrugs((await listDrugs()).data || []);
        setSuppliers((await listSuppliers()).data || []);
      } catch (e) { toast.error(e.message); }
    })();
  }, []);

  const upd = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  const submit = async () => {
    if (!form.drugId || !form.batchNo || !form.expiryDate || !form.quantityIn) {
      toast.warn("Drug, batch, expiry, and quantity are required");
      return;
    }
    setSaving(true);
    try {
      const supplier = suppliers.find(s => s._id === form.supplierId);
      const r = await recordGRN({
        ...form,
        supplierName: supplier?.name || "",
        quantityIn:   Number(form.quantityIn),
        purchaseRate: Number(form.purchaseRate),
        mrp:          Number(form.mrp),
        salePrice:    Number(form.salePrice),
      });
      toast.success(`GRN ${r.grnNumber} recorded`);
      setForm({
        drugId: "", supplierId: "", batchNo: "", mfgDate: "", expiryDate: "",
        quantityIn: 0, purchaseRate: 0, mrp: 0, salePrice: 0, invoiceNo: "", invoiceDate: "",
      });
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Card title="Record Goods Receipt (GRN)" color={C.purple} icon="pi-download">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Field label="Drug *">
          <select className="his-select" value={form.drugId} onChange={upd("drugId")}>
            <option value="">Select drug…</option>
            {drugs.map(d => <option key={d._id} value={d._id}>{d.name} {d.strength && `· ${d.strength}`}</option>)}
          </select>
        </Field>
        <Field label="Supplier">
          <select className="his-select" value={form.supplierId} onChange={upd("supplierId")}>
            <option value="">Select supplier…</option>
            {suppliers.map(s => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Batch number *"><input className="his-field" value={form.batchNo} onChange={upd("batchNo")} placeholder="ABC123" /></Field>
        <Field label="Mfg date"><input type="date" className="his-field" value={form.mfgDate} onChange={upd("mfgDate")} /></Field>
        <Field label="Expiry date *"><input type="date" className="his-field" value={form.expiryDate} onChange={upd("expiryDate")} /></Field>
        <Field label="Quantity received *"><input type="number" className="his-field" value={form.quantityIn} onChange={upd("quantityIn")} /></Field>
        <Field label="Purchase rate ₹"><input type="number" className="his-field" value={form.purchaseRate} onChange={upd("purchaseRate")} /></Field>
        <Field label="MRP ₹"><input type="number" className="his-field" value={form.mrp} onChange={upd("mrp")} /></Field>
        <Field label="Sale price ₹"><input type="number" className="his-field" value={form.salePrice} onChange={upd("salePrice")} /></Field>
        <Field label="Invoice no."><input className="his-field" value={form.invoiceNo} onChange={upd("invoiceNo")} /></Field>
        <Field label="Invoice date"><input type="date" className="his-field" value={form.invoiceDate} onChange={upd("invoiceDate")} /></Field>
      </div>
      <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
        <button onClick={submit} disabled={saving}
          style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: saving ? "#94a3b8" : C.purple, color: "#fff", fontWeight: 800, fontSize: 13, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Recording…" : <><i className="pi pi-save" style={{ marginRight: 6 }} />Record GRN</>}
        </button>
      </div>
    </Card>
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
      openPrint("pharmacy-bill", {
        ...r.data,
        template:     phSet?.billTemplate || 1,
        defaultPaper: phSet?.defaultPaper || "half-a4",
        pharmacySettings: phSet,
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

          {/* UHID lookup — pulls HIS patient + active admission */}
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

          {hisLinked && (
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
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo]     = useState("");
  const [returnSale, setReturnSale] = useState(null);    // the bill being returned
  const [addItemsSale, setAddItemsSale] = useState(null); // the bill to add items to

  const refresh = async () => {
    try { setRows((await listSales({ q, from, to })).data || []); }
    catch (e) { toast.error(e.message); }
  };
  useEffect(() => { refresh(); }, [q, from, to]);

  const cancel = async (s) => {
    if (!window.confirm(`Cancel bill ${s.billNumber}? Stock will be restored.`)) return;
    try { await cancelSale(s._id); toast.success("Sale cancelled · stock restored"); refresh(); }
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
                    openPrint("pharmacy-bill", {
                      ...s,
                      template:      phSet?.billTemplate || 1,
                      defaultPaper:  phSet?.defaultPaper || "half-a4",
                      pharmacySettings: phSet,
                    });
                  }}
                  label="Print" />
                {(s.status === "Completed" || s.status === "Partial-Return" || s.status === "Supplemented") && (
                  <RowAction icon="pi-plus" color={C.green} onClick={() => setAddItemsSale(s)} label="Add" />
                )}
                {(s.status === "Completed" || s.status === "Partial-Return" || s.status === "Supplemented") && (
                  <RowAction icon="pi-undo" color={C.amber} onClick={() => setReturnSale(s)} label="Return" />
                )}
                {s.status === "Completed" && (
                  <RowAction icon="pi-times" color={C.red} onClick={() => cancel(s)} label="Cancel" />
                )}
              </td>
            </tr>
          ))}
      </Table>

      {returnSale && (
        <ReturnModal sale={returnSale}
          onClose={() => setReturnSale(null)}
          onDone={() => { setReturnSale(null); refresh(); }} />
      )}
      {addItemsSale && (
        <AddItemsModal sale={addItemsSale}
          onClose={() => setAddItemsSale(null)}
          onDone={() => { setAddItemsSale(null); refresh(); }} />
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
      });
      // Auto-open the revised tax invoice right after — caller can keep
      // both windows side-by-side.
      setTimeout(() => {
        openPrint("pharmacy-bill", {
          ...updated,
          template:     phSet?.billTemplate || 1,
          defaultPaper: phSet?.defaultPaper || "half-a4",
          pharmacySettings: phSet,
          // header overlay so the bill is clearly labelled as REVISED
          billLabel: "REVISED TAX INVOICE", revisionNote: `${updated.returns?.length || 1} return event(s) applied · latest ${rec.refundSlipNumber}`,
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
        openPrint("pharmacy-bill", {
          ...updated,
          template:     phSet?.billTemplate || 1,
          defaultPaper: phSet?.defaultPaper || "half-a4",
          pharmacySettings: phSet,
          billLabel: "REVISED TAX INVOICE",
          revisionNote: `Supplementary slip ${rec.supplementSlipNumber} · ${fmtINR(rec.addedTotal)} added`,
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
    if (!window.confirm(`Deactivate ${s.name}?`)) return;
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
