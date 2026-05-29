/**
 * RoomChargesPage.jsx — R7en
 *
 * Per-room-category daily-charges admin grid. Mirrors R7dp's
 * DoctorChargesPage pattern but applied to IPD bed categories.
 * Each row = ONE bed category (General Ward / Semi-Private / Private
 * / Deluxe / ICU / HDU / NICU / Suite); each column = ONE per-day
 * line item (bed rent, nursing, doctor visit, RMO, monitoring,
 * dietetics, housekeeping, linen) plus the half-day chargingRule.
 *
 * Inline cell editing — save on blur, optimistic update, debounced
 * by browser onBlur cadence (no separate debounce because rapid
 * typing in a number input fires a single blur).
 *
 * Backend contract (R7en):
 *   GET  /admin/room-charges               → list active categories
 *   PUT  /admin/room-charges/:id           → patch a single row
 *   POST /admin/room-charges               → create a new category
 *   POST /admin/room-charges/seed          → seed defaults (when empty)
 *   DEL  /admin/room-charges/:id           → soft-delete
 *
 * Permissions: Admin or Accountant only (sidebar gates the same way).
 * Doctors / Receptionists hitting the URL directly get an Access
 * Denied panel rather than a partial UI.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import roomCategoryChargesService from "../../Services/roomCategoryChargesService";
import { useAuth } from "../../context/AuthContext";

/* HIS palette — matches DoctorChargesPage / ServiceMasterManager. */
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
};

/* Charge-column metadata — drives the table header + the per-row cell
   render loop. Keeping it in one array means we can add or relabel a
   line item later without touching JSX in five places. */
const COLS = [
  { key: "bedRent",           label: "Bed Rent",        hint: "Daily room rent" },
  { key: "nursingCharge",     label: "Nursing",         hint: "Daily nursing service" },
  { key: "doctorVisitCharge", label: "Doctor Visit",    hint: "Daily ward round" },
  { key: "rmoCharge",         label: "RMO",             hint: "Resident medical officer" },
  { key: "monitoringCharge",  label: "Monitoring",      hint: "Continuous monitoring (ICU/HDU/NICU)" },
  { key: "dieteticsCharge",   label: "Dietetics",       hint: "Clinical dietetics" },
  { key: "housekeepingCharge",label: "Housekeeping",    hint: "Daily cleaning" },
  { key: "linenCharge",       label: "Linen",           hint: "Linen / laundry" },
];

const RULES = [
  { value: "Full",             label: "Full (no half-day)" },
  { value: "HalfOnAdmission",  label: "Half on Admission" },
  { value: "HalfOnDischarge",  label: "Half on Discharge" },
  { value: "HalfBoth",         label: "Half on Both (NABH)" },
];

const fmtINR = (n) => {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v === 0) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

const totalOf = (charges) =>
  COLS.reduce((acc, c) => acc + (Number(charges?.[c.key] || 0)), 0);

/* ──────────────────────────────────────────────────────────────────
   Page
─────────────────────────────────────────────────────────────────── */
export default function RoomChargesPage() {
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
            Room Charges is restricted to Admin and Accountant roles.
          </div>
        </div>
      </div>
    );
  }

  return <RoomChargesInner />;
}

function RoomChargesInner() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [busySeed, setBusySeed] = useState(false);
  const [busyAdd, setBusyAdd]   = useState(false);
  const [toast, setToast] = useState(null); // { type:"ok"|"err", text }

  /* Per-cell save state. Keyed by `${rowId}:${col}` → "saving" | "ok"
     | { error }. Cell consults to render spinner / check / error pill. */
  const [cellState, setCellState] = useState({});

  /* New-category dialog state. */
  const [addOpen, setAddOpen]       = useState(false);
  const [addCode, setAddCode]       = useState("");
  const [addName, setAddName]       = useState("");
  const [addRule, setAddRule]       = useState("HalfBoth");

  const fireToast = (type, text) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 2200);
  };

  /* Fetch matrix on mount. */
  const refetch = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const r = await roomCategoryChargesService.list();
      setRows(Array.isArray(r?.data) ? r.data : []);
    } catch (e) {
      setLoadError(e.response?.data?.message || e.message || "Failed to load room charges");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { refetch(); }, []);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.categoryCode || "").toLowerCase().includes(q)
      || (r.categoryName || "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  /* KPI strip. */
  const kpis = useMemo(() => {
    const totals = rows.map(r => totalOf(r.charges));
    const sum = totals.reduce((a, b) => a + b, 0);
    const avgDaily = totals.length ? Math.round(sum / totals.length) : 0;
    return {
      total: rows.length,
      configured: rows.filter(r => totalOf(r.charges) > 0).length,
      avgDaily,
      icuDaily: totalOf(rows.find(r => r.categoryCode === "ICU")?.charges || {}),
    };
  }, [rows]);

  /* Save a single cell. */
  const saveCell = async (row, col, newVal) => {
    const prevVal = Number(row.charges?.[col] || 0);
    const next = Number(newVal);
    if (!Number.isFinite(next) || next < 0) return;
    if (next === prevVal) return;

    const key = `${row._id}:${col}`;
    setCellState(s => ({ ...s, [key]: "saving" }));
    // Optimistic update.
    setRows(rs => rs.map(r =>
      r._id === row._id
        ? { ...r, charges: { ...(r.charges || {}), [col]: next } }
        : r
    ));
    try {
      await roomCategoryChargesService.update(row._id, { charges: { [col]: next } });
      setCellState(s => ({ ...s, [key]: "ok" }));
      setTimeout(() => {
        setCellState(s => {
          if (s[key] !== "ok") return s;
          const n = { ...s }; delete n[key]; return n;
        });
      }, 1500);
    } catch (e) {
      // Roll back.
      setRows(rs => rs.map(r =>
        r._id === row._id
          ? { ...r, charges: { ...(r.charges || {}), [col]: prevVal } }
          : r
      ));
      setCellState(s => ({
        ...s,
        [key]: { error: e.response?.data?.message || e.message || "Save failed" },
      }));
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

  /* Save chargingRule for a row. */
  const saveRule = async (row, newRule) => {
    if (!RULES.find(r => r.value === newRule)) return;
    if (newRule === row.chargingRule) return;
    const prev = row.chargingRule;
    setRows(rs => rs.map(r => r._id === row._id ? { ...r, chargingRule: newRule } : r));
    try {
      await roomCategoryChargesService.update(row._id, { chargingRule: newRule });
      fireToast("ok", `Updated ${row.categoryCode} → ${newRule}`);
    } catch (e) {
      setRows(rs => rs.map(r => r._id === row._id ? { ...r, chargingRule: prev } : r));
      fireToast("err", e.response?.data?.message || e.message || "Save failed");
    }
  };

  /* Soft-delete a row. */
  const deleteRow = async (row) => {
    if (!window.confirm(`Soft-delete "${row.categoryName}" (${row.categoryCode})? The matrix row will be retired; admissions on this category will fall back to ServiceMaster pricing.`)) return;
    try {
      await roomCategoryChargesService.remove(row._id);
      setRows(rs => rs.filter(r => r._id !== row._id));
      fireToast("ok", `Retired ${row.categoryCode}`);
    } catch (e) {
      fireToast("err", e.response?.data?.message || e.message || "Delete failed");
    }
  };

  /* Seed defaults. */
  const handleSeed = async () => {
    setBusySeed(true);
    try {
      const r = await roomCategoryChargesService.seedDefaults();
      if (r?.seeded) {
        fireToast("ok", `Seeded ${r.count} default categories`);
        await refetch();
      } else {
        fireToast("err", r?.message || "Collection not empty — refusing to overwrite");
      }
    } catch (e) {
      fireToast("err", e.response?.data?.message || e.message || "Seed failed");
    } finally {
      setBusySeed(false);
    }
  };

  /* Create new category. */
  const handleCreate = async () => {
    if (!addCode || !addName) {
      fireToast("err", "Both code and name are required");
      return;
    }
    setBusyAdd(true);
    try {
      const r = await roomCategoryChargesService.create({
        categoryCode: addCode.toUpperCase().trim(),
        categoryName: addName.trim(),
        chargingRule: addRule,
        charges: {},
      });
      if (r?.data) {
        setRows(rs => [...rs, r.data].sort((a, b) => a.categoryCode.localeCompare(b.categoryCode)));
        fireToast("ok", `Created ${r.data.categoryCode}`);
        setAddOpen(false); setAddCode(""); setAddName(""); setAddRule("HalfBoth");
      }
    } catch (e) {
      fireToast("err", e.response?.data?.message || e.message || "Create failed");
    } finally {
      setBusyAdd(false);
    }
  };

  return (
    <div style={{ minHeight: "calc(100vh - 52px)", background: C.bg, padding: 20, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>

        {/* Hero */}
        <div style={{
          background: "linear-gradient(135deg,#1d4ed8,#1e40af)",
          borderRadius: 14, padding: "16px 22px", marginBottom: 16,
          color: "#fff", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          boxShadow: "0 4px 14px rgba(29,78,216,.25)",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.32)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <i className="pi pi-table" style={{ fontSize: 22 }} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px" }}>
              Room / Bed Category Charges (per day)
            </div>
            <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>
              Daily bed rent, nursing, doctor visit, RMO, monitoring, dietetics, housekeeping &amp; linen. Half-day proration applies on admission + discharge day per each category's rule.
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12, marginBottom: 14,
        }}>
          <KPI label="Categories configured" value={`${kpis.configured} / ${kpis.total}`} color={C.text} icon="pi-th-large" />
          <KPI label="Avg daily total"        value={fmtINR(kpis.avgDaily)}              color={C.blue} icon="pi-indian-rupee" />
          <KPI label="ICU daily total"        value={fmtINR(kpis.icuDaily)}              color={C.red}  icon="pi-bolt" />
          <KPI label="Auto-billing"           value="Active"                              color={C.green} icon="pi-check-circle" />
        </div>

        {/* Filter bar */}
        <div style={{
          background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
          padding: "10px 14px", marginBottom: 14,
          display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
        }}>
          <input
            type="text"
            placeholder="Search by category code or name…"
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
          {search && (
            <button
              onClick={() => setSearch("")}
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

          <span style={{ marginLeft: "auto", fontSize: 11.5, color: C.muted, fontWeight: 600 }}>
            {visibleRows.length} of {rows.length} shown
          </span>

          <button
            onClick={() => setAddOpen(true)}
            style={{
              padding: "8px 14px", background: C.blue, color: "#fff",
              border: "none", borderRadius: 8, fontSize: 12,
              fontWeight: 700, cursor: "pointer",
            }}
          >
            <i className="pi pi-plus" style={{ fontSize: 11, marginRight: 6 }} />
            Add Category
          </button>
          {rows.length === 0 && (
            <button
              onClick={handleSeed}
              disabled={busySeed}
              style={{
                padding: "8px 14px",
                background: busySeed ? "#94a3b8" : C.green,
                color: "#fff", border: "none", borderRadius: 8,
                fontSize: 12, fontWeight: 700,
                cursor: busySeed ? "default" : "pointer",
              }}
            >
              <i className="pi pi-database" style={{ fontSize: 11, marginRight: 6 }} />
              {busySeed ? "Seeding…" : "Seed Defaults"}
            </button>
          )}
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
            boxShadow: "0 6px 16px rgba(0,0,0,.08)",
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
          <EmptyPanel onSeed={handleSeed} busy={busySeed} />
        ) : visibleRows.length === 0 ? (
          <div style={{
            background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
            padding: "32px 16px", textAlign: "center", color: C.muted, fontSize: 13,
          }}>
            No categories match the current filter.
          </div>
        ) : (
          <Table
            rows={visibleRows}
            cellState={cellState}
            onSaveCell={saveCell}
            onSaveRule={saveRule}
            onDelete={deleteRow}
          />
        )}

        {/* Add-category dialog */}
        {addOpen && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(15,23,42,.45)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000,
          }} onClick={() => !busyAdd && setAddOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{
              background: "#fff", borderRadius: 12, padding: 20, minWidth: 360,
              boxShadow: "0 12px 36px rgba(0,0,0,.18)",
            }}>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 14, color: C.text }}>
                Add Room Category
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input
                  type="text" placeholder="Category code (e.g. SUITE)" value={addCode}
                  onChange={(e) => setAddCode(e.target.value)}
                  style={{ padding: "9px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13 }}
                />
                <input
                  type="text" placeholder="Display name (e.g. VIP Suite)" value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  style={{ padding: "9px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13 }}
                />
                <select value={addRule} onChange={(e) => setAddRule(e.target.value)}
                  style={{ padding: "9px 12px", border: `1.5px solid ${C.border}`, borderRadius: 8, fontSize: 13, background: "#fff" }}
                >
                  {RULES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button onClick={() => !busyAdd && setAddOpen(false)} style={{
                    flex: 1, padding: "9px", border: `1.5px solid ${C.border}`, borderRadius: 8,
                    background: "#fff", color: C.text, fontWeight: 700, cursor: "pointer",
                  }}>Cancel</button>
                  <button onClick={handleCreate} disabled={busyAdd} style={{
                    flex: 1, padding: "9px", border: "none", borderRadius: 8,
                    background: busyAdd ? "#94a3b8" : C.blue, color: "#fff", fontWeight: 700,
                    cursor: busyAdd ? "default" : "pointer",
                  }}>{busyAdd ? "Creating…" : "Create"}</button>
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

const th = (extra = {}) => ({
  padding: "9px 10px",
  fontWeight: 800,
  fontSize: 10.5,
  color: C.muted,
  textTransform: "uppercase",
  letterSpacing: ".5px",
  textAlign: "right",
  ...extra,
});

function Table({ rows, cellState, onSaveCell, onSaveRule, onDelete }) {
  return (
    <div style={{
      background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
      overflow: "hidden",
    }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: C.subtle, borderBottom: `1.5px solid ${C.border}` }}>
              <th style={th({ minWidth: 180, textAlign: "left" })}>Category</th>
              {COLS.map(c => (
                <th key={c.key} style={th({ minWidth: 100 })} title={c.hint}>{c.label}</th>
              ))}
              <th style={th({ minWidth: 160, textAlign: "center" })}>Charging Rule</th>
              <th style={th({ minWidth: 90, textAlign: "right" })}>Total/Day</th>
              <th style={th({ minWidth: 60, textAlign: "center" })}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <Row
                key={row._id}
                row={row}
                striped={i % 2 === 1}
                cellState={cellState}
                onSaveCell={onSaveCell}
                onSaveRule={onSaveRule}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ row, striped, cellState, onSaveCell, onSaveRule, onDelete }) {
  const total = totalOf(row.charges);
  return (
    <tr style={{
      borderTop: `1px solid ${C.border}`,
      background: striped ? "#fafbfc" : "#fff",
    }}>
      <td style={{ padding: "9px 12px" }}>
        <div style={{ fontWeight: 800, color: C.text, fontSize: 13 }}>{row.categoryName}</div>
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1, fontFamily: "'DM Mono', monospace" }}>
          {row.categoryCode}
        </div>
      </td>
      {COLS.map(col => (
        <td key={col.key} style={{ padding: "8px 10px", textAlign: "right" }}>
          <ChargeCell
            row={row}
            col={col.key}
            state={cellState[`${row._id}:${col.key}`]}
            onSave={onSaveCell}
          />
        </td>
      ))}
      <td style={{ padding: "8px 10px", textAlign: "center" }}>
        <select
          value={row.chargingRule || "HalfBoth"}
          onChange={(e) => onSaveRule(row, e.target.value)}
          style={{
            padding: "5px 8px", border: `1.5px solid ${C.border}`,
            borderRadius: 6, fontSize: 11, background: "#fff",
            fontFamily: "'DM Sans', sans-serif", color: C.text,
            cursor: "pointer",
          }}
        >
          {RULES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </td>
      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 800, color: C.blue, fontFamily: "'DM Mono', monospace" }}>
        {fmtINR(total)}
      </td>
      <td style={{ padding: "8px 10px", textAlign: "center" }}>
        <button
          onClick={() => onDelete(row)}
          title="Soft-delete this category"
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

/* ChargeCell — controlled native number input. Local `draft` state
   holds the in-progress edit; we commit on blur. */
function ChargeCell({ row, col, state, onSave }) {
  const value = row.charges?.[col];
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const lastValueRef = useRef(value);

  useEffect(() => {
    if (value !== lastValueRef.current) {
      setDraft(value == null ? "" : String(value));
      lastValueRef.current = value;
    }
  }, [value]);

  const status = state === "saving" ? "saving"
              : state === "ok"      ? "ok"
              : (state && typeof state === "object" && state.error) ? "error"
              : "idle";

  const borderColor =
    status === "ok"    ? C.green
    : status === "error" ? C.red
    : C.border;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
      <input
        type="number"
        min={0}
        step={50}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onSave(row, col, draft === "" ? 0 : Number(draft))}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        placeholder="—"
        style={{
          width: 78, height: 30, padding: "0 7px",
          border: `1.5px solid ${borderColor}`, borderRadius: 6,
          fontSize: 12, fontFamily: "'DM Mono', monospace",
          textAlign: "right", color: C.text, background: "#fff",
          outline: "none", boxSizing: "border-box",
          transition: "border-color .15s",
        }}
      />
      <span style={{ width: 14, textAlign: "center", lineHeight: 1 }}
            title={status === "error" ? state.error : undefined}>
        {status === "saving" && <i className="pi pi-spin pi-spinner" style={{ fontSize: 10, color: C.muted }} />}
        {status === "ok"     && <i className="pi pi-check"          style={{ fontSize: 11, color: C.green }} />}
        {status === "error"  && <i className="pi pi-times"          style={{ fontSize: 11, color: C.red }} />}
      </span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div style={{
      background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
      padding: 16,
    }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{
          display: "flex", gap: 10, alignItems: "center",
          padding: "10px 0", borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
        }}>
          <div style={{ width: 180, height: 14, background: "#e2e8f0", borderRadius: 4 }} />
          {COLS.map((_c, ci) => (
            <div key={ci} style={{ flex: 1, height: 14, background: "#e2e8f0", borderRadius: 4, maxWidth: 80 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyPanel({ onSeed, busy }) {
  return (
    <div style={{
      background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
      padding: "44px 16px", textAlign: "center",
    }}>
      <i className="pi pi-table" style={{ fontSize: 32, color: C.muted, display: "block", marginBottom: 10 }} />
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>No room categories configured yet.</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 4, marginBottom: 16 }}>
        Seed the default 8 categories (General Ward, Semi-Private, Private, Deluxe, ICU, HDU, NICU, Suite) to get started.
      </div>
      <button onClick={onSeed} disabled={busy} style={{
        padding: "10px 18px", background: busy ? "#94a3b8" : C.green, color: "#fff",
        border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700,
        cursor: busy ? "default" : "pointer",
      }}>
        <i className="pi pi-database" style={{ marginRight: 7 }} />
        {busy ? "Seeding…" : "Seed Default Categories"}
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
      <div style={{ fontSize: 14, fontWeight: 800 }}>Couldn't load room charges</div>
      <div style={{ fontSize: 12, marginTop: 4, color: "#b91c1c" }}>{message}</div>
    </div>
  );
}
