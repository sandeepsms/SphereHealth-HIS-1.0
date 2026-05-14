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
import "../../Components/clinical/clinical-forms.css";
import { toast } from "react-toastify";
import {
  listDrugs, createDrug, updateDrug, deleteDrug,
  listSuppliers, createSupplier, updateSupplier, deleteSupplier,
  recordGRN, listBatches, stockRollup,
  dispense, listSales, cancelSale,
  getStats, getAlerts,
  DRUG_FORMS, DRUG_CATEGORIES, PAYMENT_MODES, SALE_TYPES,
} from "../../Services/pharmacyService";

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
  { key: "suppliers", label: "Suppliers",  icon: "pi-truck" },
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
        {tab === "suppliers" && <SuppliersTab />}
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
function DispenseTab() {
  const [rollup, setRollup] = useState([]);
  const [items, setItems]   = useState([]);   // current cart
  const [patient, setPatient] = useState({ patientUHID: "", patientName: "", contactNumber: "", age: "", gender: "", doctorName: "" });
  const [saleType, setSaleType] = useState("Walk-in");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [saving, setSaving] = useState(false);
  const [drugSearch, setDrugSearch] = useState("");

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
        items: items.map(it => ({
          drugId: it.drugId, drugName: it.drugName,
          quantity: Number(it.quantity), unitPrice: Number(it.unitPrice),
          gstRate: Number(it.gstRate), discountPercent: Number(it.discountPercent),
        })),
      });
      toast.success(`Bill ${r.data.billNumber} · ${fmtINR(r.data.grandTotal)}`);
      setItems([]);
      setPatient({ patientUHID: "", patientName: "", contactNumber: "", age: "", gender: "", doctorName: "" });
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
          <Field label="UHID"><input className="his-field" value={patient.patientUHID} onChange={e => setPatient(p => ({ ...p, patientUHID: e.target.value }))} placeholder="UH00000001 (optional)" /></Field>
          <Field label="Patient name"><input className="his-field" value={patient.patientName} onChange={e => setPatient(p => ({ ...p, patientName: e.target.value }))} /></Field>
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
                <span style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 800,
                  background: s.status === "Completed" ? C.greenL : s.status === "Cancelled" ? C.redL : C.subtle,
                  color:      s.status === "Completed" ? C.green  : s.status === "Cancelled" ? C.red  : C.muted,
                  border: `1px solid ${s.status === "Completed" ? C.green : s.status === "Cancelled" ? C.red : C.border}30`,
                }}>{s.status}</span>
              </td>
              <td style={{ padding: "8px 12px" }}>
                {s.status === "Completed" && (
                  <RowAction icon="pi-times" color={C.red} onClick={() => cancel(s)} label="Cancel" />
                )}
              </td>
            </tr>
          ))}
      </Table>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   SUPPLIERS TAB
══════════════════════════════════════════════════════════════════ */
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
