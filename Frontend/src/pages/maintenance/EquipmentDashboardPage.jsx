/**
 * EquipmentDashboardPage.jsx
 *
 * Single-screen inventory + tracker:
 *  - KPI strip: total, in-use, on-loan (homecare), service due, idle in warehouse
 *  - Quick-filter chips: All / Warehouse / Bed / Homecare / Service
 *  - Category & status secondary filters
 *  - Search box (asset tag / serial / name)
 *  - Master table with current location + per-row quick actions:
 *      Send Home (homecare)  |  Return  |  Log Service  |  Retire
 *  - Service-due banner at top (overdue + due-soon counts)
 *  - Three modals: Add Equipment · Assign to Homecare · Log Service
 */
import React, { useEffect, useMemo, useState } from "react";
import "../../Components/clinical/clinical-forms.css";
import { toast } from "react-toastify";
import {
  listEquipment, getEquipmentStats, createEquipment, assignEquipment,
  returnEquipment, logServiceEntry, retireEquipment,
  CATEGORIES, STATUSES,
} from "../../Services/equipmentService";

const C = {
  bg: "#f8fafc", card: "#fff", border: "#e2e8f0",
  text: "#0f172a", muted: "#64748b",
  amber: "#d97706", amberL: "#fffbeb",
  blue: "#4f46e5", blueL: "#eef2ff",
  green: "#16a34a", greenL: "#dcfce7",
  red: "#dc2626", redL: "#fef2f2",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  slate: "#475569",
  teal: "#0d9488", tealL: "#f0fdfa",
};

const LOC_PILL = {
  WAREHOUSE: { c: C.slate, bg: "#f1f5f9", label: "Warehouse", icon: "pi-box" },
  BED:       { c: C.blue,  bg: C.blueL,   label: "In-house bed", icon: "pi-th-large" },
  HOMECARE:  { c: C.teal,  bg: C.tealL,   label: "Homecare", icon: "pi-home" },
  SERVICE:   { c: C.amber, bg: C.amberL,  label: "Service",  icon: "pi-wrench" },
  RETIRED:   { c: C.red,   bg: C.redL,    label: "Retired",  icon: "pi-times-circle" },
};
const STATUS_C = {
  Available:        C.green,
  "In-use":         C.blue,
  "On-loan":        C.teal,
  "Under-service":  C.amber,
  "Out-of-service": C.red,
  Retired:          C.slate,
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const daysSince = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;
const daysUntil = (d) => d ? Math.floor((new Date(d).getTime() - Date.now()) / 86400000) : null;

export default function EquipmentDashboardPage() {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  // Filters
  const [locFilter, setLocFilter] = useState("");        // "" = All
  const [catFilter, setCatFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");

  // Modals
  const [addOpen, setAddOpen]       = useState(false);
  const [assignFor, setAssignFor]   = useState(null);    // equipment doc
  const [serviceFor, setServiceFor] = useState(null);
  const [returnFor, setReturnFor]   = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [eq, st] = await Promise.all([
        listEquipment(),
        getEquipmentStats(),
      ]);
      setItems(eq.data || []);
      setStats(st.data || null);
    } catch (e) {
      toast.error(e.message || "Failed to load equipment");
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  /* ── Client-side filtering ── */
  const filtered = useMemo(() => {
    const rx = q.trim() ? new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
    return items.filter(e => {
      if (locFilter    && e.currentLocation?.type !== locFilter) return false;
      if (catFilter    && e.category !== catFilter)              return false;
      if (statusFilter && e.status   !== statusFilter)           return false;
      if (rx && !(rx.test(e.name || "") || rx.test(e.assetTag || "") ||
                  rx.test(e.serialNo || "") || rx.test(e.model || ""))) return false;
      return true;
    });
  }, [items, locFilter, catFilter, statusFilter, q]);

  const serviceOverdue = stats?.serviceDue?.overdue ?? 0;
  const serviceDueSoon = stats?.serviceDue?.dueSoon ?? 0;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: 20, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>

        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg,#0d9488,#0f766e)",
          borderRadius: 14, padding: "16px 22px", marginBottom: 16,
          color: "#fff", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          boxShadow: "0 4px 14px rgba(13,148,136,.25)",
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
              Equipment Tracker
            </div>
            <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>
              Inventory · in-hospital · homecare loans · service history
            </div>
          </div>
          <button onClick={() => setAddOpen(true)}
            style={{
              padding: "9px 16px", borderRadius: 8,
              background: "rgba(255,255,255,.22)", border: "1.5px solid rgba(255,255,255,.35)",
              color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}>
            <i className="pi pi-plus" style={{ fontSize: 11 }} />
            Add Equipment
          </button>
          <button onClick={refresh} disabled={loading}
            style={{
              padding: "9px 16px", borderRadius: 8,
              background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.3)",
              color: "#fff", fontWeight: 700, fontSize: 12,
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}>
            <i className={`pi ${loading ? "pi-spin pi-spinner" : "pi-refresh"}`} style={{ fontSize: 11 }} />
            Refresh
          </button>
        </div>

        {/* KPI strip */}
        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
            {[
              { label: "Total units",     value: stats.total,                       color: C.text,   icon: "pi-list" },
              { label: "Available",        value: stats.byStatus.Available,          color: C.green,  icon: "pi-check-circle" },
              { label: "In-house (bed)",   value: stats.byLocation.BED,              color: C.blue,   icon: "pi-th-large" },
              { label: "Homecare on loan", value: stats.byLocation.HOMECARE,         color: C.teal,   icon: "pi-home" },
              { label: "Service overdue",  value: stats.serviceDue.overdue,          color: C.red,    icon: "pi-exclamation-triangle" },
              { label: "Daily homecare ₹", value: `₹${(stats.homecareDailyRevenue || 0).toLocaleString("en-IN")}`, color: C.purple, icon: "pi-indian-rupee" },
            ].map((k, i) => (
              <div key={i} style={{
                background: C.card, border: `1.5px solid ${C.border}`,
                borderRadius: 12, padding: "14px 16px",
                boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 4px 12px rgba(16,24,40,.06)",
                display: "flex", alignItems: "center", gap: 14,
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 10,
                  background: k.color + "12",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  <i className={`pi ${k.icon}`} style={{ fontSize: 16, color: k.color }} />
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginTop: 4 }}>{k.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Service-due banner */}
        {(serviceOverdue > 0 || serviceDueSoon > 0) && (
          <div style={{
            background: serviceOverdue > 0 ? C.redL : C.amberL,
            border: `1.5px solid ${serviceOverdue > 0 ? C.red : C.amber}30`,
            borderRadius: 10, padding: "10px 16px", marginBottom: 16,
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          }}>
            <i className="pi pi-exclamation-triangle" style={{ color: serviceOverdue > 0 ? C.red : C.amber, fontSize: 15 }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: serviceOverdue > 0 ? "#991b1b" : "#92400e" }}>
              {serviceOverdue > 0 && <>🔴 {serviceOverdue} overdue · </>}
              {serviceDueSoon > 0 && <>🟠 {serviceDueSoon} due in next 14 days</>}
            </span>
            <button onClick={() => setStatusFilter("Under-service") || setStatusFilter("")}
              style={{
                marginLeft: "auto", padding: "5px 11px", borderRadius: 6,
                border: `1.5px solid ${serviceOverdue > 0 ? C.red : C.amber}`,
                background: "#fff", color: serviceOverdue > 0 ? C.red : C.amber,
                fontWeight: 700, fontSize: 11, cursor: "pointer",
              }}>
              Filter overdue
            </button>
          </div>
        )}

        {/* Filters row */}
        <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {/* Location chips */}
          <div style={{ display: "flex", gap: 6 }}>
            {[["", "All"], ["WAREHOUSE", "Warehouse"], ["BED", "Bed"], ["HOMECARE", "Homecare"], ["SERVICE", "Service"]].map(([v, label]) => {
              const active = locFilter === v;
              const pill = LOC_PILL[v] || { c: C.slate, bg: "#f1f5f9" };
              return (
                <button key={v} onClick={() => setLocFilter(v)}
                  style={{
                    padding: "6px 12px", borderRadius: 7,
                    border: `1.5px solid ${active ? pill.c : C.border}`,
                    background: active ? pill.bg : "#fff",
                    color: active ? pill.c : C.muted,
                    fontWeight: 700, fontSize: 11.5, cursor: "pointer",
                  }}>{label}</button>
              );
            })}
          </div>
          <div style={{ width: 1, height: 22, background: C.border }} />
          <select className="his-select" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
            value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
          <select className="his-select" style={{ width: "auto", padding: "6px 10px", fontSize: 12 }}
            value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          <div style={{ flex: 1 }} />
          <input className="his-field" style={{ width: 220, padding: "6px 10px", fontSize: 12 }}
            placeholder="Search name / asset tag / serial…"
            value={q} onChange={e => setQ(e.target.value)} />
        </div>

        {/* Table */}
        <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 4px 12px rgba(16,24,40,.06)" }}>
          <div style={{ padding: "10px 16px", background: C.tealL, borderBottom: `1px solid ${C.teal}30`, display: "flex", alignItems: "center", gap: 8 }}>
            <i className="pi pi-list" style={{ fontSize: 13, color: C.teal }} />
            <span style={{ fontWeight: 800, fontSize: 13, color: C.teal }}>Equipment inventory</span>
            <span style={{ fontSize: 11, color: C.muted }}>· {filtered.length} of {items.length}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "30px 18px", textAlign: "center", color: C.muted, fontSize: 13, fontStyle: "italic" }}>
                {loading ? "Loading…" : items.length === 0 ? "No equipment recorded yet. Click Add Equipment to start." : "No equipment matches the current filters."}
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: `1.5px solid ${C.border}` }}>
                    {["Equipment","Asset / SN","Category","Status","Current location","Last service","Next due","Action"].map(h => (
                      <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", fontSize: 10, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e, i) => {
                    const loc = LOC_PILL[e.currentLocation?.type] || LOC_PILL.WAREHOUSE;
                    const overdue = e.nextServiceDue && new Date(e.nextServiceDue) < new Date();
                    const dueIn = daysUntil(e.nextServiceDue);
                    return (
                      <tr key={e._id} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 ? "#fafbfc" : "#fff" }}>
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                          <div style={{ fontWeight: 700, color: C.text }}>{e.name}</div>
                          <div style={{ fontSize: 10.5, color: C.muted }}>{e.manufacturer} {e.model && `· ${e.model}`}</div>
                        </td>
                        <td style={{ padding: "10px 12px", fontFamily: "DM Mono, monospace", fontSize: 11 }}>
                          <div>{e.assetTag || "—"}</div>
                          <div style={{ color: C.muted, fontSize: 10 }}>SN: {e.serialNo || "—"}</div>
                        </td>
                        <td style={{ padding: "10px 12px", color: C.muted, fontSize: 11.5 }}>{e.category}</td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{
                            padding: "3px 9px", borderRadius: 4,
                            background: (STATUS_C[e.status] || C.muted) + "12",
                            color: STATUS_C[e.status] || C.muted,
                            fontSize: 10, fontWeight: 800,
                            border: `1px solid ${STATUS_C[e.status] || C.muted}30`,
                          }}>{e.status}</span>
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            padding: "3px 9px", borderRadius: 4,
                            background: loc.bg, color: loc.c,
                            fontSize: 10.5, fontWeight: 700,
                            border: `1px solid ${loc.c}30`,
                          }}>
                            <i className={`pi ${loc.icon}`} style={{ fontSize: 10 }} />
                            {loc.label}
                          </span>
                          {e.currentLocation?.refLabel && (
                            <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>{e.currentLocation.refLabel}</div>
                          )}
                          {e.currentLocation?.type === "HOMECARE" && (() => {
                            const open = (e.assignments || []).slice().reverse().find(a => !a.returnedAt && a.locationType === "HOMECARE");
                            if (!open) return null;
                            return (
                              <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>
                                {open.patientName || open.patientUHID}{open.expectedReturn && ` · expect back ${fmtDate(open.expectedReturn)}`}
                              </div>
                            );
                          })()}
                        </td>
                        <td style={{ padding: "10px 12px", color: C.muted, fontSize: 11 }}>{fmtDate(e.lastService)}</td>
                        <td style={{ padding: "10px 12px", fontSize: 11, fontWeight: overdue ? 800 : 600,
                                     color: overdue ? C.red : (dueIn != null && dueIn <= 14 ? C.amber : C.muted) }}>
                          {e.nextServiceDue
                            ? overdue ? `Overdue ${Math.abs(dueIn)}d` : (dueIn === 0 ? "Today" : `In ${dueIn}d`)
                            : "—"}
                        </td>
                        <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", gap: 4 }}>
                            {e.currentLocation?.type === "WAREHOUSE" && (
                              <ActionBtn icon="pi-home" label="Send Home" color={C.teal}
                                onClick={() => setAssignFor(e)} />
                            )}
                            {(e.currentLocation?.type === "HOMECARE" || e.currentLocation?.type === "BED") && (
                              <ActionBtn icon="pi-undo" label="Return" color={C.blue}
                                onClick={() => setReturnFor(e)} />
                            )}
                            <ActionBtn icon="pi-wrench" label="Service" color={C.amber}
                              onClick={() => setServiceFor(e)} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {addOpen     && <AddModal     onClose={() => setAddOpen(false)}   onSaved={refresh} />}
      {assignFor   && <HomecareModal item={assignFor} onClose={() => setAssignFor(null)} onSaved={refresh} />}
      {serviceFor  && <ServiceModal  item={serviceFor} onClose={() => setServiceFor(null)} onSaved={refresh} />}
      {returnFor   && <ReturnModal   item={returnFor}  onClose={() => setReturnFor(null)}  onSaved={refresh} />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Reusable bits
══════════════════════════════════════════════════════════════════ */

function ActionBtn({ icon, label, color, onClick }) {
  return (
    <button onClick={onClick} title={label}
      style={{
        padding: "5px 10px", borderRadius: 6, border: `1.5px solid ${color}40`,
        background: "#fff", color,
        fontSize: 10.5, fontWeight: 700, cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 4,
        whiteSpace: "nowrap",
      }}
      onMouseEnter={ev => { ev.currentTarget.style.background = color + "0a"; }}
      onMouseLeave={ev => { ev.currentTarget.style.background = "#fff"; }}>
      <i className={`pi ${icon}`} style={{ fontSize: 10 }} />
      {label}
    </button>
  );
}

function ModalShell({ title, color, onClose, onSubmit, submitLabel = "Save", submitting, children }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 1100,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={ev => ev.stopPropagation()} style={{
        background: "#fff", borderRadius: 14, width: 560, maxWidth: "100%",
        maxHeight: "88vh", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 50px rgba(0,0,0,.25)", overflow: "hidden",
      }}>
        <div style={{
          padding: "14px 20px",
          background: `linear-gradient(135deg, ${color}, ${color}cc)`,
          color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 7, border: "none",
            background: "rgba(255,255,255,.18)", color: "#fff", cursor: "pointer",
          }}><i className="pi pi-times" /></button>
        </div>
        <div style={{ padding: "18px 20px", overflowY: "auto", flex: 1 }}>
          {children}
        </div>
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} disabled={submitting}
            style={{ padding: "8px 16px", borderRadius: 7, border: `1.5px solid ${C.border}`, background: "#fff", color: C.muted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={onSubmit} disabled={submitting}
            style={{ padding: "8px 20px", borderRadius: 7, border: "none", background: submitting ? "#94a3b8" : color, color: "#fff", fontWeight: 800, fontSize: 12, cursor: submitting ? "not-allowed" : "pointer" }}>
            {submitting ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Add Equipment ────────────────────────────────────────────── */
function AddModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    name: "", category: "Respiratory", assetTag: "", serialNo: "",
    manufacturer: "", model: "",
    purchaseDate: "", warrantyEnd: "", costPrice: 0,
    servicePolicyDays: 90, dailyRentalCharge: 0,
  });
  const [saving, setSaving] = useState(false);
  const upd = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  const submit = async () => {
    if (!form.name.trim()) { toast.warn("Equipment name is required"); return; }
    setSaving(true);
    try {
      await createEquipment({ ...form, costPrice: Number(form.costPrice || 0), servicePolicyDays: Number(form.servicePolicyDays || 90), dailyRentalCharge: Number(form.dailyRentalCharge || 0) });
      toast.success(`${form.name} added to inventory`);
      onSaved(); onClose();
    } catch (e) {
      toast.error(e.message || "Create failed");
    } finally { setSaving(false); }
  };
  return (
    <ModalShell title="Add Equipment to Inventory" color={C.teal} onClose={onClose} onSubmit={submit} submitting={saving}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Equipment name *"><input className="his-field" value={form.name} onChange={upd("name")} placeholder="BiPAP Machine" /></Field>
        <Field label="Category">
          <select className="his-select" value={form.category} onChange={upd("category")}>
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Asset tag"><input className="his-field" value={form.assetTag} onChange={upd("assetTag")} placeholder="SH-RESP-0012" /></Field>
        <Field label="Serial number"><input className="his-field" value={form.serialNo} onChange={upd("serialNo")} /></Field>
        <Field label="Manufacturer"><input className="his-field" value={form.manufacturer} onChange={upd("manufacturer")} placeholder="Philips" /></Field>
        <Field label="Model"><input className="his-field" value={form.model} onChange={upd("model")} placeholder="DreamStation 2" /></Field>
        <Field label="Purchase date"><input type="date" className="his-field" value={form.purchaseDate} onChange={upd("purchaseDate")} /></Field>
        <Field label="Warranty end"><input type="date" className="his-field" value={form.warrantyEnd} onChange={upd("warrantyEnd")} /></Field>
        <Field label="Cost price (₹)"><input type="number" className="his-field" value={form.costPrice} onChange={upd("costPrice")} /></Field>
        <Field label="Service every (days)"><input type="number" className="his-field" value={form.servicePolicyDays} onChange={upd("servicePolicyDays")} /></Field>
        <Field label="Daily rental charge (₹)"><input type="number" className="his-field" value={form.dailyRentalCharge} onChange={upd("dailyRentalCharge")} placeholder="Used when sent for homecare" /></Field>
      </div>
    </ModalShell>
  );
}

/* ── Send to Homecare ─────────────────────────────────────────── */
function HomecareModal({ item, onClose, onSaved }) {
  const [form, setForm] = useState({
    patientUHID: "", patientName: "", contactNumber: "", homeAddress: "",
    expectedReturn: "",
    dailyRentalCharge: item.dailyRentalCharge || 0,
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const upd = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  const submit = async () => {
    if (!form.patientName.trim() && !form.patientUHID.trim()) {
      toast.warn("Enter patient UHID or name");
      return;
    }
    setSaving(true);
    try {
      await assignEquipment(item._id, {
        locationType: "HOMECARE",
        refLabel: `${form.patientName || form.patientUHID} (home)`,
        patientUHID: form.patientUHID,
        patientName: form.patientName,
        contactNumber: form.contactNumber,
        homeAddress: form.homeAddress,
        expectedReturn: form.expectedReturn || null,
        dailyRentalCharge: Number(form.dailyRentalCharge || 0),
        notes: form.notes,
      });
      toast.success(`${item.name} sent to ${form.patientName || form.patientUHID}`);
      onSaved(); onClose();
    } catch (e) {
      toast.error(e.message || "Assign failed");
    } finally { setSaving(false); }
  };
  return (
    <ModalShell title={`Send ${item.name} to Homecare`} color={C.teal} onClose={onClose} onSubmit={submit} submitting={saving} submitLabel="Send home">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Patient UHID"><input className="his-field" value={form.patientUHID} onChange={upd("patientUHID")} placeholder="UH00000001" /></Field>
        <Field label="Patient name *"><input className="his-field" value={form.patientName} onChange={upd("patientName")} /></Field>
        <Field label="Contact number"><input className="his-field" value={form.contactNumber} onChange={upd("contactNumber")} placeholder="+91 …" /></Field>
        <Field label="Expected return"><input type="date" className="his-field" value={form.expectedReturn} onChange={upd("expectedReturn")} /></Field>
        <div style={{ gridColumn: "span 2" }}>
          <Field label="Home address"><textarea className="his-textarea" value={form.homeAddress} onChange={upd("homeAddress")} rows={2} /></Field>
        </div>
        <Field label="Daily rental ₹"><input type="number" className="his-field" value={form.dailyRentalCharge} onChange={upd("dailyRentalCharge")} /></Field>
        <Field label="Notes"><input className="his-field" value={form.notes} onChange={upd("notes")} placeholder="Condition · accessories" /></Field>
      </div>
    </ModalShell>
  );
}

/* ── Return ───────────────────────────────────────────────────── */
function ReturnModal({ item, onClose, onSaved }) {
  const [form, setForm] = useState({ condition: "Good", notes: "" });
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await returnEquipment(item._id, form);
      toast.success(`${item.name} returned (${form.condition})`);
      onSaved(); onClose();
    } catch (e) {
      toast.error(e.message || "Return failed");
    } finally { setSaving(false); }
  };
  return (
    <ModalShell title={`Return ${item.name} to warehouse`} color={C.blue} onClose={onClose} onSubmit={submit} submitting={saving} submitLabel="Confirm return">
      <Field label="Condition">
        <select className="his-select" value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value })}>
          {["Good","Damaged","Lost"].map(o => <option key={o}>{o}</option>)}
        </select>
      </Field>
      <Field label="Notes"><textarea className="his-textarea" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Cleaning required · accessory missing · etc." /></Field>
    </ModalShell>
  );
}

/* ── Service log ──────────────────────────────────────────────── */
function ServiceModal({ item, onClose, onSaved }) {
  const [form, setForm] = useState({
    serviceType: "Routine",
    performedBy: "", vendor: "", cost: 0,
    serviceDate: new Date().toISOString().slice(0, 10),
    nextDueDate: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const upd = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  const submit = async () => {
    setSaving(true);
    try {
      await logServiceEntry(item._id, { ...form, cost: Number(form.cost || 0) });
      toast.success(`Service logged for ${item.name}`);
      onSaved(); onClose();
    } catch (e) {
      toast.error(e.message || "Service log failed");
    } finally { setSaving(false); }
  };
  return (
    <ModalShell title={`Log service · ${item.name}`} color={C.amber} onClose={onClose} onSubmit={submit} submitting={saving} submitLabel="Save service log">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Service type">
          <select className="his-select" value={form.serviceType} onChange={upd("serviceType")}>
            {["Routine","Repair","Calibration","Cleaning","Recall","Other"].map(o => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Service date"><input type="date" className="his-field" value={form.serviceDate} onChange={upd("serviceDate")} /></Field>
        <Field label="Performed by"><input className="his-field" value={form.performedBy} onChange={upd("performedBy")} placeholder="Bio-medical engineer name" /></Field>
        <Field label="Vendor"><input className="his-field" value={form.vendor} onChange={upd("vendor")} placeholder="Vendor name" /></Field>
        <Field label="Cost (₹)"><input type="number" className="his-field" value={form.cost} onChange={upd("cost")} /></Field>
        <Field label="Next due (optional)">
          <input type="date" className="his-field" value={form.nextDueDate} onChange={upd("nextDueDate")} />
          <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Defaults to {item.servicePolicyDays || 90} days from today</div>
        </Field>
        <div style={{ gridColumn: "span 2" }}>
          <Field label="Notes"><textarea className="his-textarea" value={form.notes} onChange={upd("notes")} rows={2} /></Field>
        </div>
      </div>
    </ModalShell>
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
