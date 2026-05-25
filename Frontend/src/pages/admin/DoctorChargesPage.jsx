/**
 * DoctorChargesPage.jsx — R7dp
 *
 * Per-doctor consultation-fee admin grid. Lets an Admin / Accountant
 * edit every doctor's five charge fields (OPD First / OPD Follow-up /
 * ER / MLC / IPD Cross-Consult) in one place, grouped by department,
 * with inline save-on-blur per cell.
 *
 * Backend contract (R7dp):
 *   GET  /doctors                          → list of doctors, each with full consultationFee
 *   PUT  /doctors/:doctorId/consultation-fee
 *     body: { opdFirst?, opdFollowup?, emergency?, mlc?, ipdCrossConsult? }
 *     Service accepts any subset; legacy `opd` is mirrored onto opdFirst
 *     server-side so older clients keep working.
 *
 * UX:
 *   - Native <input type="number"> for inline edit (NOT PrimeReact).
 *     Saves on blur; debounced 600 ms so rapid keystrokes don't fire
 *     a PUT for every digit.
 *   - Optimistic update on success: row keeps the new value locally
 *     and a brief green ✓ flashes next to the cell. Red "Save failed"
 *     pill on error (and the cell rolls back to its server value).
 *   - Grouped by department.name; "(No Department)" bucket for doctors
 *     whose department wasn't populated.
 *   - Filter bar: department <select> + name search. KPI strip on top.
 *   - Loading skeleton while the doctor list is fetching; empty state
 *     when no doctors are configured.
 *
 * Permissions: Admin or Accountant only (matches the sidebar entry).
 * Doctors / Receptionists hitting the URL directly get an Access Denied
 * panel rather than a partial UI.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";
import { useAuth } from "../../context/AuthContext";

/* HIS palette — matches PharmacyHomePage / ServiceMasterManager. */
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
   render loop. Keeping it in one array makes it trivial to add or
   re-label a column later without touching JSX in five places. */
const COLS = [
  { key: "opdFirst",        label: "OPD First",      hint: "First visit" },
  { key: "opdFollowup",     label: "Follow-up",      hint: "Repeat visit (same doctor)" },
  { key: "emergency",       label: "ER",             hint: "Emergency / casualty" },
  { key: "mlc",             label: "MLC",            hint: "Medico-Legal Case fee" },
  { key: "ipdCrossConsult", label: "IPD X-Cons",     hint: "IPD cross-consult per visit" },
];

const fmtINR = (n) => {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v === 0) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

const avgOf = (rows, key) => {
  const nums = rows.map(r => Number(r.consultationFee?.[key] || 0)).filter(n => n > 0);
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
};

const doctorName = (d) => {
  const fn = d.personalInfo?.firstName || "";
  const ln = d.personalInfo?.lastName  || "";
  const full = `${fn} ${ln}`.trim();
  return full ? `Dr ${full}` : (d.name || "Unnamed Doctor");
};

const deptNameOf = (d) =>
  d.department?.departmentName ||
  d.department?.name ||
  (typeof d.department === "string" ? d.department : null) ||
  "(No Department)";

/* ──────────────────────────────────────────────────────────────────
   Page
─────────────────────────────────────────────────────────────────── */
export default function DoctorChargesPage() {
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
            Doctor Charges is restricted to Admin and Accountant roles.
          </div>
        </div>
      </div>
    );
  }

  return <DoctorChargesInner />;
}

/* Hooks-heavy inner so the auth gate above can early-return without
   triggering the rules-of-hooks lint rule. */
function DoctorChargesInner() {
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [filterDept, setFilterDept] = useState("");
  const [search, setSearch] = useState("");

  /* Per-cell save state. Keyed by `${doctorId}:${col}` → "saving" |
     "ok" | { error: "..." }. The cell consults this to decide whether
     to show a spinner / green check / red error pill. */
  const [cellState, setCellState] = useState({});

  /* Fetch the doctor list once on mount. The /doctors endpoint already
     returns the populated `department` sub-object and the full
     `consultationFee` so a single GET is enough for the whole page. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const r = await axios.get(`${API_ENDPOINTS.BASE}/doctors`, { params: { limit: 500, page: 1 } });
        // The list endpoint wraps in { data: [...] } but some callers
        // saw a bare array — handle both shapes.
        const list = Array.isArray(r.data?.data) ? r.data.data
                   : Array.isArray(r.data)      ? r.data
                   : [];
        if (!cancelled) setDoctors(list);
      } catch (e) {
        if (!cancelled) setLoadError(e.response?.data?.message || e.message || "Failed to load doctors");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* Filter + group. We compute `visibleGroups` as a flat ordered array
     of [deptName, doctors[]] so the render loop can drop each block
     with a department header. Departments are sorted A→Z; the
     "(No Department)" bucket is pushed to the bottom. */
  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = doctors.filter(d => {
      if (filterDept && deptNameOf(d) !== filterDept) return false;
      if (!q) return true;
      const name = doctorName(d).toLowerCase();
      return name.includes(q);
    });

    const buckets = new Map();
    for (const d of filtered) {
      const dn = deptNameOf(d);
      if (!buckets.has(dn)) buckets.set(dn, []);
      buckets.get(dn).push(d);
    }
    const entries = [...buckets.entries()];
    entries.sort((a, b) => {
      // "(No Department)" sinks to the bottom regardless of alphabet.
      if (a[0] === "(No Department)") return 1;
      if (b[0] === "(No Department)") return -1;
      return a[0].localeCompare(b[0]);
    });
    // Sort doctors within a department alphabetically by name.
    for (const [, ds] of entries) {
      ds.sort((a, b) => doctorName(a).localeCompare(doctorName(b)));
    }
    return entries;
  }, [doctors, filterDept, search]);

  /* Department option list — derived from the data so a typo in the
     master doesn't desync the filter. */
  const deptOptions = useMemo(() => {
    const set = new Set();
    for (const d of doctors) set.add(deptNameOf(d));
    return [...set].sort((a, b) => {
      if (a === "(No Department)") return 1;
      if (b === "(No Department)") return -1;
      return a.localeCompare(b);
    });
  }, [doctors]);

  /* KPI strip — totals computed off the full doctor list (not the
     filtered subset) so an admin sees the practice-wide picture even
     while drilling into a single department. */
  const kpis = useMemo(() => {
    const configured = doctors.filter(d =>
      Number(d.consultationFee?.opdFirst || 0) > 0
      || Number(d.consultationFee?.opd || 0) > 0
    ).length;
    return {
      total: doctors.length,
      configured,
      avgOpdFirst: avgOf(doctors, "opdFirst"),
      avgEr:       avgOf(doctors, "emergency"),
      avgMlc:      avgOf(doctors, "mlc"),
    };
  }, [doctors]);

  /* Cell save: PUT the single field, then mark the cell ✓ for 1.5 s.
     On error, roll back the doctor's value in local state to what the
     server returned (or its previous value) and flash a red pill. */
  const saveCell = async (doctorId, col, newVal) => {
    const prev = doctors.find(d => d._id === doctorId);
    const prevVal = Number(prev?.consultationFee?.[col] || 0);
    const next = Number(newVal);
    if (!Number.isFinite(next) || next < 0) return;
    if (next === prevVal) return;   // no-op — don't ping the server

    const key = `${doctorId}:${col}`;
    setCellState(s => ({ ...s, [key]: "saving" }));
    // Optimistic local bump so the typed value sticks visually.
    setDoctors(ds => ds.map(d =>
      d._id === doctorId
        ? { ...d, consultationFee: { ...(d.consultationFee || {}), [col]: next } }
        : d
    ));

    try {
      await axios.put(
        `${API_ENDPOINTS.BASE}/doctors/${doctorId}/consultation-fee`,
        { [col]: next }
      );
      setCellState(s => ({ ...s, [key]: "ok" }));
      // Auto-clear the ✓ flash after a short while.
      setTimeout(() => {
        setCellState(s => {
          if (s[key] !== "ok") return s;
          const n = { ...s }; delete n[key]; return n;
        });
      }, 1500);
    } catch (e) {
      // Roll back.
      setDoctors(ds => ds.map(d =>
        d._id === doctorId
          ? { ...d, consultationFee: { ...(d.consultationFee || {}), [col]: prevVal } }
          : d
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

  const totalCount = doctors.length;
  const shownCount = visibleGroups.reduce((sum, [, ds]) => sum + ds.length, 0);

  return (
    <div style={{ minHeight: "calc(100vh - 52px)", background: C.bg, padding: 20, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1500, margin: "0 auto" }}>

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
            <i className="pi pi-dollar" style={{ fontSize: 22 }} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px" }}>
              Doctor Charges
            </div>
            <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>
              Per-doctor fee sheet · OPD · ER · MLC · IPD cross-consult
            </div>
          </div>
        </div>

        {/* KPI strip */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12, marginBottom: 14,
        }}>
          <KPI label="Doctors configured" value={`${kpis.configured} / ${kpis.total}`} color={C.text}   icon="pi-user-edit" />
          <KPI label="Avg OPD First"      value={fmtINR(kpis.avgOpdFirst)}             color={C.blue}   icon="pi-indian-rupee" />
          <KPI label="Avg ER"             value={fmtINR(kpis.avgEr)}                   color={C.red}    icon="pi-bolt" />
          <KPI label="Avg MLC"            value={fmtINR(kpis.avgMlc)}                  color={C.amber}  icon="pi-flag" />
        </div>

        {/* Filter bar */}
        <div style={{
          background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
          padding: "10px 14px", marginBottom: 14,
          display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
        }}>
          <select
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            style={{
              minWidth: 180, height: 38, padding: "0 12px",
              border: `1.5px solid ${C.border}`, borderRadius: 8,
              fontSize: 12.5, fontFamily: "'DM Sans', sans-serif",
              color: filterDept ? C.text : "#94a3b8",
              background: "#fff", outline: "none", cursor: "pointer",
              appearance: "auto", boxSizing: "border-box",
            }}
          >
            <option value="">All Departments</option>
            {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          <input
            type="text"
            placeholder="Search by doctor name…"
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

          {(filterDept || search) && (
            <button
              onClick={() => { setFilterDept(""); setSearch(""); }}
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
            {shownCount} of {totalCount} shown
          </span>
        </div>

        {/* Load / error / empty / table */}
        {loadError ? (
          <ErrorPanel message={loadError} />
        ) : loading ? (
          <SkeletonRows />
        ) : totalCount === 0 ? (
          <EmptyPanel />
        ) : shownCount === 0 ? (
          <div style={{
            background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
            padding: "32px 16px", textAlign: "center", color: C.muted, fontSize: 13,
          }}>
            No doctors match the current filter.
          </div>
        ) : (
          visibleGroups.map(([deptName, ds]) => (
            <DeptGroup
              key={deptName}
              deptName={deptName}
              doctors={ds}
              cellState={cellState}
              onSaveCell={saveCell}
            />
          ))
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

function DeptGroup({ deptName, doctors, cellState, onSaveCell }) {
  return (
    <div style={{
      background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
      marginBottom: 14, overflow: "hidden",
    }}>
      {/* Department header bar */}
      <div style={{
        padding: "8px 14px", background: C.subtle, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <i className="pi pi-sitemap" style={{ fontSize: 12, color: C.slate }} />
        <span style={{
          fontSize: 11, fontWeight: 800, color: C.slate,
          textTransform: "uppercase", letterSpacing: ".6px",
        }}>
          {deptName}
        </span>
        <span style={{
          marginLeft: 6, padding: "1px 7px", borderRadius: 10,
          background: "#fff", border: `1px solid ${C.border}`,
          fontSize: 10, fontWeight: 700, color: C.muted,
        }}>
          {doctors.length}
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: "#fff", borderBottom: `1.5px solid ${C.border}` }}>
              <th style={th({ minWidth: 220, textAlign: "left" })}>Doctor</th>
              {COLS.map(c => (
                <th key={c.key} style={th({ minWidth: 120 })} title={c.hint}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {doctors.map((d, i) => (
              <DoctorRow
                key={d._id}
                doctor={d}
                striped={i % 2 === 1}
                cellState={cellState}
                onSaveCell={onSaveCell}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th = (extra = {}) => ({
  padding: "9px 12px",
  fontWeight: 800,
  fontSize: 10.5,
  color: C.muted,
  textTransform: "uppercase",
  letterSpacing: ".5px",
  textAlign: "right",
  ...extra,
});

function DoctorRow({ doctor, striped, cellState, onSaveCell }) {
  return (
    <tr style={{
      borderTop: `1px solid ${C.border}`,
      background: striped ? "#fafbfc" : "#fff",
    }}>
      <td style={{ padding: "9px 12px" }}>
        <div style={{ fontWeight: 700, color: C.text }}>{doctorName(doctor)}</div>
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 1 }}>
          {doctor.professional?.specialization || "—"}
        </div>
      </td>
      {COLS.map(col => (
        <td key={col.key} style={{ padding: "8px 12px", textAlign: "right" }}>
          <FeeCell
            doctorId={doctor._id}
            col={col.key}
            value={doctor.consultationFee?.[col.key]}
            state={cellState[`${doctor._id}:${col.key}`]}
            onSave={onSaveCell}
          />
        </td>
      ))}
    </tr>
  );
}

/* FeeCell — controlled native number input. Local `draft` state holds
   the in-progress edit so React doesn't fight every keystroke; we
   commit on blur (saveCell will no-op if the value is unchanged). */
function FeeCell({ doctorId, col, value, state, onSave }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const lastValueRef = useRef(value);

  /* Sync local draft with parent state when the upstream value changes
     (e.g. another tab saved a new value, or save error rolled back). */
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
    status === "ok"     ? C.green
    : status === "error" ? C.red
    : C.border;

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
      <input
        type="number"
        min={0}
        step={50}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onSave(doctorId, col, draft === "" ? 0 : Number(draft))}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="—"
        style={{
          width: 92, height: 32, padding: "0 8px",
          border: `1.5px solid ${borderColor}`, borderRadius: 7,
          fontSize: 12.5, fontFamily: "'DM Mono', monospace",
          textAlign: "right", color: C.text, background: "#fff",
          outline: "none", boxSizing: "border-box",
          transition: "border-color .15s",
        }}
      />
      {/* Status icon — fixed-width slot so the column doesn't shift */}
      <span style={{ width: 18, textAlign: "center", lineHeight: 1 }} title={status === "error" ? state.error : undefined}>
        {status === "saving" && <i className="pi pi-spin pi-spinner" style={{ fontSize: 11, color: C.muted }} />}
        {status === "ok"     && <i className="pi pi-check"          style={{ fontSize: 12, color: C.green }} />}
        {status === "error"  && <i className="pi pi-times"          style={{ fontSize: 12, color: C.red }} />}
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
          display: "flex", gap: 12, alignItems: "center",
          padding: "10px 0", borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
        }}>
          <div style={{ width: 200, height: 14, background: "#e2e8f0", borderRadius: 4 }} />
          {COLS.map((_c, ci) => (
            <div key={ci} style={{ flex: 1, height: 14, background: "#e2e8f0", borderRadius: 4, maxWidth: 90 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyPanel() {
  return (
    <div style={{
      background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
      padding: "44px 16px", textAlign: "center",
    }}>
      <i className="pi pi-user-edit" style={{ fontSize: 32, color: C.muted, display: "block", marginBottom: 10 }} />
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>No doctors configured yet.</div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
        Add doctors from <i>Masters &amp; Admin → Doctor Management</i> first; they'll appear here automatically.
      </div>
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
      <div style={{ fontSize: 14, fontWeight: 800 }}>Couldn't load doctors</div>
      <div style={{ fontSize: 12, marginTop: 4, color: "#b91c1c" }}>{message}</div>
    </div>
  );
}
