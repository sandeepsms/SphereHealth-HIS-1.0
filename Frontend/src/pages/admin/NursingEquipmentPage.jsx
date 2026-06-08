/**
 * NursingEquipmentPage.jsx — R7hr-164
 *
 * Admin master catalogue for the "Equipment Used This Shift" tile that
 * nurses use from NursingNotes.jsx. Admins (and Accountants, for parity
 * with Room Charges + Doctor Charges) set up the items + prices once;
 * nurses tick a chip per shift and `autoBillingService.onEquipmentCharged`
 * fans the charge into the IPD ledger.
 *
 * Backend contract:
 *   GET    /api/nursing-charges/items        → list (isActive=true only)
 *   POST   /api/nursing-charges/items        → create
 *   PUT    /api/nursing-charges/items/:id    → update fields
 *   DELETE /api/nursing-charges/items/:id    → soft-delete (isActive=false)
 *
 * Permissions: master mutations require `departments.write`
 * (Admin only). Reads require `billing.read` (Admin / Accountant /
 * Receptionist / TPA Coordinator) — the route file gates the same way.
 * Route is gated to Admin + Accountant matching RoomChargesPage convention.
 *
 * Fields (NursingConsumableItem schema):
 *   name              — display label nurses see
 *   category          — 8-enum (Oxygen & Respiratory / IV & Lines /
 *                        Monitoring / Wound & Skin / Urinary / Feeding /
 *                        Disposables / Other)
 *   unitPrice         — INR per use
 *   chargeOncePerDay  — dedup flag; the autoBillingService respects this
 *                        via `dailyDedup` so the same patient isn't billed
 *                        the same per-day item twice on one calendar day.
 *
 * R28-safe: this is a brand-new admin page on a backend that's already
 * live and seeded. Nothing about the existing NursingNotes.jsx wiring
 * or autoBillingService.onEquipmentCharged path is touched.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import nursingChargesService from "../../Services/nursingChargesService";
import { useAuth } from "../../context/AuthContext";

/* HIS palette — same tokens RoomChargesPage uses so theme is consistent. */
const C = {
  bg: "#f8fafc",
  card: "#fff",
  border: "#e2e8f0",
  text: "#0f172a",
  muted: "#64748b",
  subtle: "#f8fafc",
  orange: "#ea580c",
  orangeL: "#fff7ed",
  blue: "#1d4ed8",
  blueL: "#eff6ff",
  green: "#16a34a",
  greenL: "#dcfce7",
  red: "#dc2626",
  redL: "#fef2f2",
  amber: "#d97706",
  amberL: "#fffbeb",
  slate: "#475569",
  pink: "#db2777",
};

/* The 8 NursingConsumableItem categories — mirrored from the model enum.
   `color` drives the category chip + grouped section header. */
const CATEGORIES = [
  { key: "Oxygen & Respiratory", color: "#0891b2", light: "#ecfeff", icon: "pi-cloud" },
  { key: "IV & Lines",           color: "#7c3aed", light: "#f5f3ff", icon: "pi-share-alt" },
  { key: "Monitoring",           color: "#1d4ed8", light: "#eff6ff", icon: "pi-eye" },
  { key: "Wound & Skin",         color: "#db2777", light: "#fdf2f8", icon: "pi-bandage" },
  { key: "Urinary",              color: "#d97706", light: "#fffbeb", icon: "pi-circle-on" },
  { key: "Feeding",              color: "#16a34a", light: "#f0fdf4", icon: "pi-apple" },
  { key: "Disposables",          color: "#64748b", light: "#f8fafc", icon: "pi-box" },
  { key: "Other",                color: "#475569", light: "#f8fafc", icon: "pi-tag" },
];

const CATEGORY_KEYS = CATEGORIES.map(c => c.key);
const catMeta = (k) => CATEGORIES.find(c => c.key === k) || CATEGORIES[CATEGORIES.length - 1];

const fmtINR = (n) => {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v === 0) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

/* ──────────────────────────────────────────────────────────────────
   Page
─────────────────────────────────────────────────────────────────── */
export default function NursingEquipmentPage() {
  const { user } = useAuth();
  const isAuthorized = user && (user.role === "Admin" || user.role === "Accountant");

  if (!isAuthorized) {
    return (
      <div style={{ minHeight: "calc(100vh - 52px)", background: C.bg, padding: 20 }}>
        <div style={{
          padding: 40, maxWidth: 520, margin: "60px auto", textAlign: "center",
          background: "#fff", border: "1.5px solid #fecaca", borderRadius: 12,
        }}>
          <i className="pi pi-lock" style={{ fontSize: 36, color: C.red, marginBottom: 10, display: "block" }} />
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>Access denied</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>
            Nursing Equipment Master is restricted to Admin and Accountant roles.
          </div>
        </div>
      </div>
    );
  }

  return <NursingEquipmentInner />;
}

function NursingEquipmentInner() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [busyAdd, setBusyAdd] = useState(false);
  const [toast, setToast] = useState(null);

  /* Per-cell save state. `${rowId}:${field}` → "saving" | "ok" | { error } */
  const [cellState, setCellState] = useState({});

  /* Add-item dialog. */
  const [addOpen, setAddOpen]   = useState(false);
  const [addName, setAddName]   = useState("");
  const [addCat,  setAddCat]    = useState("Disposables");
  const [addPrice, setAddPrice] = useState("");
  const [addOnce,  setAddOnce]  = useState(true);

  const fireToast = (type, text) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 2200);
  };

  const refetch = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const r = await nursingChargesService.listItems();
      // Backend may return raw array or {data:[…]} envelope — handle both.
      const arr = Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [];
      setRows(arr);
    } catch (e) {
      setLoadError(e.response?.data?.message || e.message || "Failed to load equipment items");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refetch(); }, []);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterCat !== "All" && r.category !== filterCat) return false;
      if (!q) return true;
      return (r.name || "").toLowerCase().includes(q)
          || (r.category || "").toLowerCase().includes(q);
    });
  }, [rows, search, filterCat]);

  /* Group filtered rows by category for the sectioned table render. */
  const grouped = useMemo(() => {
    const m = new Map();
    for (const c of CATEGORY_KEYS) m.set(c, []);
    for (const r of visibleRows) {
      const k = m.has(r.category) ? r.category : "Other";
      m.get(k).push(r);
    }
    return Array.from(m.entries()).filter(([_, list]) => list.length > 0);
  }, [visibleRows]);

  const kpis = useMemo(() => {
    const active = rows.filter(r => r.isActive !== false);
    const sumPx  = active.reduce((acc, r) => acc + Number(r.unitPrice || 0), 0);
    const cats   = new Set(active.map(r => r.category || "Other"));
    return {
      total: active.length,
      categories: cats.size,
      avgPrice: active.length ? Math.round(sumPx / active.length) : 0,
      onceADay: active.filter(r => r.chargeOncePerDay).length,
    };
  }, [rows]);

  /* Save a single field. Optimistic update with rollback on error. */
  const saveField = async (row, field, newVal) => {
    const prev = row[field];
    if (prev === newVal) return;
    if (field === "unitPrice") {
      const v = Number(newVal);
      if (!Number.isFinite(v) || v < 0) return;
    }
    const key = `${row._id}:${field}`;
    setCellState(s => ({ ...s, [key]: "saving" }));
    setRows(rs => rs.map(r => r._id === row._id ? { ...r, [field]: newVal } : r));
    try {
      await nursingChargesService.updateItem(row._id, { [field]: newVal });
      setCellState(s => ({ ...s, [key]: "ok" }));
      setTimeout(() => {
        setCellState(s => {
          if (s[key] !== "ok") return s;
          const n = { ...s }; delete n[key]; return n;
        });
      }, 1500);
    } catch (e) {
      setRows(rs => rs.map(r => r._id === row._id ? { ...r, [field]: prev } : r));
      setCellState(s => ({
        ...s,
        [key]: { error: e.response?.data?.message || e.message || "Save failed" },
      }));
      fireToast("err", e.response?.data?.message || e.message || "Save failed");
      setTimeout(() => {
        setCellState(s => {
          if (typeof s[key] === "object" && s[key]?.error) {
            const n = { ...s }; delete n[key]; return n;
          }
          return s;
        });
      }, 3500);
    }
  };

  /* Soft-delete a row. */
  const deleteRow = async (row) => {
    if (!window.confirm(`Retire "${row.name}" from the equipment catalogue? Nurses won't see this item on future shifts; existing charges already billed are unaffected.`)) return;
    try {
      await nursingChargesService.deleteItem(row._id);
      // Soft-delete sets isActive=false; refetch hides it (we filter isActive=true on load).
      setRows(rs => rs.filter(r => r._id !== row._id));
      fireToast("ok", `Retired "${row.name}"`);
    } catch (e) {
      fireToast("err", e.response?.data?.message || e.message || "Retire failed");
    }
  };

  /* Create new item. */
  const handleCreate = async () => {
    if (!addName.trim()) {
      fireToast("err", "Name is required");
      return;
    }
    const px = Number(addPrice);
    if (!Number.isFinite(px) || px < 0) {
      fireToast("err", "Enter a valid unit price (₹0 or more)");
      return;
    }
    setBusyAdd(true);
    try {
      const r = await nursingChargesService.createItem({
        name: addName.trim(),
        category: addCat,
        unitPrice: px,
        chargeOncePerDay: !!addOnce,
      });
      const created = r?.data || r;
      if (created && created._id) {
        setRows(rs => [...rs, created]);
        fireToast("ok", `Added "${created.name}"`);
        setAddOpen(false);
        setAddName(""); setAddCat("Disposables"); setAddPrice(""); setAddOnce(true);
      } else {
        await refetch();
        setAddOpen(false);
      }
    } catch (e) {
      fireToast("err", e.response?.data?.message || e.message || "Create failed");
    } finally {
      setBusyAdd(false);
    }
  };

  return (
    <div style={{ minHeight: "calc(100vh - 52px)", background: C.bg, padding: 20, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1500, margin: "0 auto" }}>

        {/* Hero — pink palette to signal nursing surface (matches Sidebar Nurse color). */}
        <div style={{
          background: "linear-gradient(135deg,#db2777,#be185d)",
          borderRadius: 14, padding: "16px 22px", marginBottom: 16,
          color: "#fff", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          boxShadow: "0 4px 14px rgba(219,39,119,.25)",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.32)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="pi pi-heart" style={{ fontSize: 22 }} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px" }}>
              Nursing Equipment Master (per-use charges)
            </div>
            <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>
              Master catalogue for "Equipment Used This Shift" on the Nursing Notes tile. Nurses tick chips per shift; each tick auto-bills the IPD ledger. <strong>Charge-once-per-day</strong> items dedup automatically so the same patient isn't billed twice in one calendar day.
            </div>
          </div>
          <button
            onClick={() => setAddOpen(true)}
            style={{
              padding: "10px 16px", background: "#fff", color: C.pink,
              border: "none", borderRadius: 10, fontSize: 13, fontWeight: 800,
              cursor: "pointer", textTransform: "uppercase", letterSpacing: ".4px",
            }}
          >
            <i className="pi pi-plus" style={{ fontSize: 11, marginRight: 6 }} />
            Add Item
          </button>
        </div>

        {/* KPI strip */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12, marginBottom: 14,
        }}>
          <KPI label="Active items"     value={kpis.total}                color={C.text}  icon="pi-list" />
          <KPI label="Categories used"  value={`${kpis.categories} / ${CATEGORIES.length}`} color={C.blue}  icon="pi-th-large" />
          <KPI label="Avg unit price"   value={fmtINR(kpis.avgPrice)}     color={C.green} icon="pi-indian-rupee" />
          <KPI label="Charge-once-a-day" value={kpis.onceADay}            color={C.amber} icon="pi-calendar" />
        </div>

        {/* Filter bar */}
        <div style={{
          background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
          padding: "10px 14px", marginBottom: 14,
          display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
        }}>
          <input
            type="text"
            placeholder="Search by item name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              minWidth: 240, height: 38, padding: "0 12px",
              border: `1.5px solid ${C.border}`, borderRadius: 8,
              fontSize: 12.5, fontFamily: "'DM Sans', sans-serif",
              color: C.text, background: "#fff", outline: "none",
              boxSizing: "border-box",
            }}
          />
          <select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
            style={{
              minWidth: 200, height: 38, padding: "0 12px",
              border: `1.5px solid ${C.border}`, borderRadius: 8,
              fontSize: 12.5, fontFamily: "'DM Sans', sans-serif",
              color: C.text, background: "#fff", outline: "none",
              boxSizing: "border-box", cursor: "pointer",
            }}
          >
            <option value="All">All categories</option>
            {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.key}</option>)}
          </select>
          {(search || filterCat !== "All") && (
            <button
              onClick={() => { setSearch(""); setFilterCat("All"); }}
              style={{
                padding: "7px 12px", background: "#fff", color: C.muted,
                border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 11,
                fontWeight: 700, cursor: "pointer",
                textTransform: "uppercase", letterSpacing: ".4px",
              }}
            >
              Clear filters
            </button>
          )}
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: C.muted, fontWeight: 600 }}>
            {visibleRows.length} of {rows.length} shown
          </span>
        </div>

        {/* Toast */}
        {toast && (
          <div style={{
            position: "fixed", top: 80, right: 20, zIndex: 1000,
            padding: "10px 14px",
            background: toast.type === "ok" ? C.greenL : C.redL,
            border: `1.5px solid ${toast.type === "ok" ? C.green : C.red}`,
            color: toast.type === "ok" ? C.green : C.red,
            borderRadius: 8, fontSize: 12.5, fontWeight: 700,
            boxShadow: "0 6px 16px rgba(0,0,0,.08)", maxWidth: 360,
          }}>
            <i className={`pi ${toast.type === "ok" ? "pi-check" : "pi-times"}`} style={{ marginRight: 6 }} />
            {toast.text}
          </div>
        )}

        {/* Body */}
        {loadError ? (
          <ErrorPanel message={loadError} />
        ) : loading ? (
          <SkeletonRows />
        ) : rows.length === 0 ? (
          <EmptyPanel onAdd={() => setAddOpen(true)} />
        ) : visibleRows.length === 0 ? (
          <div style={{
            background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
            padding: "32px 16px", textAlign: "center", color: C.muted, fontSize: 13,
          }}>
            No items match the current filter.
          </div>
        ) : (
          <CategoryGroups
            grouped={grouped}
            cellState={cellState}
            onSaveField={saveField}
            onDelete={deleteRow}
          />
        )}

        {/* Add-item dialog */}
        {addOpen && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(15,23,42,.45)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000,
          }} onClick={() => !busyAdd && setAddOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{
              background: "#fff", borderRadius: 12, padding: 22, minWidth: 380,
              boxShadow: "0 12px 36px rgba(0,0,0,.18)",
            }}>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 14, color: C.text }}>
                <i className="pi pi-plus" style={{ marginRight: 7, color: C.pink }} />
                Add Equipment Item
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Field label="Item name">
                  <input
                    type="text"
                    placeholder="e.g. Pulse Oximeter (per day)"
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    style={inputStyle()}
                    autoFocus
                  />
                </Field>
                <Field label="Category">
                  <select
                    value={addCat}
                    onChange={(e) => setAddCat(e.target.value)}
                    style={{ ...inputStyle(), cursor: "pointer" }}
                  >
                    {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.key}</option>)}
                  </select>
                </Field>
                <Field label="Unit price (₹)">
                  <input
                    type="number" min={0} step={10}
                    placeholder="e.g. 200"
                    value={addPrice}
                    onChange={(e) => setAddPrice(e.target.value)}
                    style={inputStyle()}
                  />
                </Field>
                <label style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "9px 12px", background: addOnce ? C.amberL : "#f8fafc",
                  border: `1.5px solid ${addOnce ? C.amber : C.border}`,
                  borderRadius: 8, cursor: "pointer", fontSize: 12.5,
                  color: addOnce ? "#92400e" : C.text, fontWeight: 600,
                }}>
                  <input
                    type="checkbox" checked={addOnce}
                    onChange={(e) => setAddOnce(e.target.checked)}
                    style={{ width: 15, height: 15, cursor: "pointer" }}
                  />
                  Charge once per calendar day (auto-dedup)
                </label>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={() => !busyAdd && setAddOpen(false)} style={{
                    flex: 1, padding: "10px", border: `1.5px solid ${C.border}`, borderRadius: 8,
                    background: "#fff", color: C.text, fontWeight: 700, cursor: "pointer",
                  }}>Cancel</button>
                  <button onClick={handleCreate} disabled={busyAdd} style={{
                    flex: 1, padding: "10px", border: "none", borderRadius: 8,
                    background: busyAdd ? "#94a3b8" : C.pink, color: "#fff", fontWeight: 700,
                    cursor: busyAdd ? "default" : "pointer",
                  }}>
                    <i className="pi pi-check" style={{ fontSize: 11, marginRight: 6 }} />
                    {busyAdd ? "Adding…" : "Add Item"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Sub-components
─────────────────────────────────────────────────────────────────── */
function KPI({ label, value, color, icon }) {
  return (
    <div style={{
      background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
      padding: "12px 14px", display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 9,
        background: `${color}10`, color, display: "flex",
        alignItems: "center", justifyContent: "center",
      }}>
        <i className={`pi ${icon}`} style={{ fontSize: 14 }} />
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</div>
        <div style={{ fontSize: 17, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const inputStyle = () => ({
  width: "100%", padding: "9px 12px",
  border: `1.5px solid ${C.border}`, borderRadius: 8,
  fontSize: 13, fontFamily: "'DM Sans', sans-serif",
  color: C.text, background: "#fff", outline: "none",
  boxSizing: "border-box",
});

const th = (extra = {}) => ({
  padding: "9px 10px",
  fontWeight: 800,
  fontSize: 10.5,
  color: C.muted,
  textTransform: "uppercase",
  letterSpacing: ".5px",
  textAlign: "left",
  ...extra,
});

function CategoryGroups({ grouped, cellState, onSaveField, onDelete }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {grouped.map(([cat, items]) => {
        const meta = catMeta(cat);
        const subtotal = items.reduce((acc, r) => acc + Number(r.unitPrice || 0), 0);
        return (
          <div key={cat} style={{
            background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
            overflow: "hidden",
          }}>
            {/* Category section header */}
            <div style={{
              padding: "10px 14px", background: meta.light,
              borderBottom: `1.5px solid ${C.border}`,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: meta.color, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <i className={`pi ${meta.icon}`} style={{ fontSize: 13 }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: meta.color }}>{cat}</div>
                <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 1 }}>
                  {items.length} item{items.length === 1 ? "" : "s"} · subtotal {fmtINR(subtotal)}
                </div>
              </div>
            </div>
            {/* Items table */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: C.subtle, borderBottom: `1.5px solid ${C.border}` }}>
                    <th style={th({ minWidth: 240 })}>Item name</th>
                    <th style={th({ minWidth: 180 })}>Category</th>
                    <th style={th({ minWidth: 120, textAlign: "right" })}>Unit price</th>
                    <th style={th({ minWidth: 180, textAlign: "center" })}>Charge once/day</th>
                    <th style={th({ minWidth: 60, textAlign: "center" })}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row, i) => (
                    <Row
                      key={row._id}
                      row={row}
                      striped={i % 2 === 1}
                      cellState={cellState}
                      onSaveField={onSaveField}
                      onDelete={onDelete}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Row({ row, striped, cellState, onSaveField, onDelete }) {
  return (
    <tr style={{
      borderTop: `1px solid ${C.border}`,
      background: striped ? "#fafbfc" : "#fff",
    }}>
      <td style={{ padding: "9px 12px" }}>
        <NameCell
          row={row}
          state={cellState[`${row._id}:name`]}
          onSave={onSaveField}
        />
      </td>
      <td style={{ padding: "9px 12px" }}>
        <CategoryCell
          row={row}
          state={cellState[`${row._id}:category`]}
          onSave={onSaveField}
        />
      </td>
      <td style={{ padding: "9px 12px", textAlign: "right" }}>
        <PriceCell
          row={row}
          state={cellState[`${row._id}:unitPrice`]}
          onSave={onSaveField}
        />
      </td>
      <td style={{ padding: "9px 12px", textAlign: "center" }}>
        <OnceCell
          row={row}
          state={cellState[`${row._id}:chargeOncePerDay`]}
          onSave={onSaveField}
        />
      </td>
      <td style={{ padding: "9px 12px", textAlign: "center" }}>
        <button
          onClick={() => onDelete(row)}
          title="Retire this item from the catalogue"
          style={{
            padding: "5px 8px", border: `1px solid ${C.border}`,
            borderRadius: 6, background: "#fff", color: C.red,
            cursor: "pointer", fontSize: 11,
          }}
        >
          <i className="pi pi-trash" style={{ fontSize: 11 }} />
        </button>
      </td>
    </tr>
  );
}

/* ─────── individual editable cells ─────── */

function statusOf(state) {
  return state === "saving" ? "saving"
       : state === "ok"     ? "ok"
       : (state && typeof state === "object" && state.error) ? "error"
       : "idle";
}

function StatusDot({ status, errorMsg }) {
  return (
    <span style={{ width: 14, textAlign: "center", lineHeight: 1, display: "inline-block" }}
          title={status === "error" ? errorMsg : undefined}>
      {status === "saving" && <i className="pi pi-spin pi-spinner" style={{ fontSize: 10, color: C.muted }} />}
      {status === "ok"     && <i className="pi pi-check"          style={{ fontSize: 11, color: C.green }} />}
      {status === "error"  && <i className="pi pi-times"          style={{ fontSize: 11, color: C.red }} />}
    </span>
  );
}

function NameCell({ row, state, onSave }) {
  const [draft, setDraft] = useState(row.name || "");
  const lastRef = useRef(row.name);
  useEffect(() => {
    if (row.name !== lastRef.current) { setDraft(row.name || ""); lastRef.current = row.name; }
  }, [row.name]);
  const status = statusOf(state);
  const borderColor = status === "ok" ? C.green : status === "error" ? C.red : C.border;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onSave(row, "name", draft.trim() || row.name)}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        style={{
          flex: 1, height: 32, padding: "0 10px",
          border: `1.5px solid ${borderColor}`, borderRadius: 6,
          fontSize: 13, color: C.text, background: "#fff",
          outline: "none", boxSizing: "border-box", fontWeight: 600,
          transition: "border-color .15s",
        }}
      />
      <StatusDot status={status} errorMsg={state?.error} />
    </div>
  );
}

function CategoryCell({ row, state, onSave }) {
  const meta = catMeta(row.category);
  const status = statusOf(state);
  const borderColor = status === "ok" ? C.green : status === "error" ? C.red : C.border;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <select
        value={row.category || "Other"}
        onChange={(e) => onSave(row, "category", e.target.value)}
        style={{
          height: 30, padding: "0 8px",
          border: `1.5px solid ${borderColor}`, borderRadius: 6,
          fontSize: 11.5, fontFamily: "'DM Sans', sans-serif",
          color: meta.color, background: meta.light, fontWeight: 700,
          cursor: "pointer", outline: "none",
        }}
      >
        {CATEGORIES.map(c => <option key={c.key} value={c.key} style={{ background: "#fff", color: C.text }}>{c.key}</option>)}
      </select>
      <StatusDot status={status} errorMsg={state?.error} />
    </div>
  );
}

function PriceCell({ row, state, onSave }) {
  const [draft, setDraft] = useState(row.unitPrice == null ? "" : String(row.unitPrice));
  const lastRef = useRef(row.unitPrice);
  useEffect(() => {
    if (row.unitPrice !== lastRef.current) {
      setDraft(row.unitPrice == null ? "" : String(row.unitPrice));
      lastRef.current = row.unitPrice;
    }
  }, [row.unitPrice]);
  const status = statusOf(state);
  const borderColor = status === "ok" ? C.green : status === "error" ? C.red : C.border;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
      <span style={{ color: C.muted, fontSize: 11.5, fontWeight: 700 }}>₹</span>
      <input
        type="number" min={0} step={10}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onSave(row, "unitPrice", draft === "" ? 0 : Number(draft))}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        placeholder="—"
        style={{
          width: 92, height: 30, padding: "0 8px",
          border: `1.5px solid ${borderColor}`, borderRadius: 6,
          fontSize: 12, fontFamily: "'DM Mono', monospace",
          textAlign: "right", color: C.text, background: "#fff",
          outline: "none", boxSizing: "border-box",
          transition: "border-color .15s",
        }}
      />
      <StatusDot status={status} errorMsg={state?.error} />
    </div>
  );
}

function OnceCell({ row, state, onSave }) {
  const status = statusOf(state);
  const v = !!row.chargeOncePerDay;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <label style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 999,
        background: v ? C.amberL : "#f1f5f9",
        border: `1.5px solid ${v ? C.amber : C.border}`,
        color: v ? "#92400e" : C.muted,
        fontSize: 11, fontWeight: 700, cursor: "pointer",
      }}>
        <input
          type="checkbox" checked={v}
          onChange={(e) => onSave(row, "chargeOncePerDay", e.target.checked)}
          style={{ width: 13, height: 13, cursor: "pointer", accentColor: C.amber }}
        />
        {v ? "Once / day" : "Per use"}
      </label>
      <StatusDot status={status} errorMsg={state?.error} />
    </div>
  );
}

function SkeletonRows() {
  return (
    <div style={{
      background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
      padding: 16,
    }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{
          display: "flex", gap: 10, alignItems: "center",
          padding: "10px 0", borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
        }}>
          <div style={{ width: 240, height: 14, background: "#e2e8f0", borderRadius: 4 }} />
          <div style={{ width: 140, height: 14, background: "#e2e8f0", borderRadius: 4 }} />
          <div style={{ width: 80,  height: 14, background: "#e2e8f0", borderRadius: 4 }} />
          <div style={{ width: 100, height: 14, background: "#e2e8f0", borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

function EmptyPanel({ onAdd }) {
  return (
    <div style={{
      background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
      padding: "44px 16px", textAlign: "center",
    }}>
      <i className="pi pi-heart" style={{ fontSize: 32, color: C.muted, display: "block", marginBottom: 10 }} />
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>No equipment items configured yet.</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 4, marginBottom: 16, maxWidth: 460, marginLeft: "auto", marginRight: "auto", lineHeight: 1.55 }}>
        Add the first item — name, category, unit price, and whether it should be charged once per calendar day. Nurses will see it on the "Equipment Used This Shift" tile in Nursing Notes.
      </div>
      <button onClick={onAdd} style={{
        padding: "10px 18px", background: C.pink, color: "#fff",
        border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700,
        cursor: "pointer",
      }}>
        <i className="pi pi-plus" style={{ marginRight: 7 }} />
        Add First Item
      </button>
    </div>
  );
}

function ErrorPanel({ message }) {
  return (
    <div style={{
      background: C.redL, border: `1.5px solid ${C.red}`, borderRadius: 12,
      padding: "20px 16px", textAlign: "center", color: C.red,
    }}>
      <i className="pi pi-exclamation-triangle" style={{ fontSize: 22, marginBottom: 8, display: "block" }} />
      <div style={{ fontSize: 14, fontWeight: 800 }}>Couldn't load equipment items</div>
      <div style={{ fontSize: 12, marginTop: 4, color: "#b91c1c" }}>{message}</div>
    </div>
  );
}
