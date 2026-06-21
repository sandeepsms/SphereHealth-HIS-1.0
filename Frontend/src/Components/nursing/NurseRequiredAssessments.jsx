// Components/nursing/NurseRequiredAssessments.jsx
// ════════════════════════════════════════════════════════════════════
// R7hr-231 — the nurse's view of the doctor-set assessment plan. Shows ONLY
// the assigned assessments as required duty cards (with today's done/min
// progress, soft-coloured pending/in-progress/done) + an "Extra Note ▾"
// dropdown for any other (un-assigned) assessment the nurse wants to do ad-hoc.
// Clicking a card / dropdown item opens that assessment via the parent's
// openModal (passed as onOpen). READ-ONLY guidance — never blocks. ADDITIVE.
// ════════════════════════════════════════════════════════════════════
import { useState } from "react";

export default function NurseRequiredAssessments({ modules = [], items = [], todayCounts = {}, assignedByName = "", onOpen }) {
  const [extraOpen, setExtraOpen] = useState(false);
  const byId = modules.reduce((m, x) => { m[x.id] = x; return m; }, {});
  const requiredIds = new Set(items.map((i) => i.type));
  const extras = modules.filter((m) => !requiredIds.has(m.id));

  const statusOf = (type, min) => {
    const done = todayCounts[type] || 0;
    if (min > 0 && done >= min) return { color: "#16a34a", bg: "#f0fdf4", label: "Done" };
    if (done > 0)               return { color: "#b45309", bg: "#fffbeb", label: "In progress" };
    return { color: "#dc2626", bg: "#fef2f2", label: "Pending" };
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>📋 Required Assessments — Today</div>
        <span style={{ fontSize: 11.5, color: "#64748b" }}>
          {assignedByName ? `Assigned by Dr. ${assignedByName.replace(/^Dr\.?\s*/i, "")}` : "Doctor-assigned"} · minimum times / day
        </span>
        <div style={{ marginLeft: "auto", position: "relative" }}>
          <button type="button" onClick={() => setExtraOpen((o) => !o)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "#334155" }}>
            ➕ Extra Note <span style={{ fontSize: 10 }}>▾</span>
          </button>
          {extraOpen && (
            <>
              <div onClick={() => setExtraOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 39 }} />
              <div style={{ position: "absolute", right: 0, top: "112%", zIndex: 40, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 12px 30px rgba(2,6,23,.18)", width: 270, maxHeight: 340, overflow: "auto", padding: 6 }}>
                <div style={{ padding: "4px 8px 6px", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: "#94a3b8" }}>Other assessments</div>
                {extras.length === 0 && <div style={{ padding: "8px 10px", fontSize: 12, color: "#94a3b8" }}>All assessments are in the plan.</div>}
                {extras.map((m) => (
                  <button key={m.id} type="button" onClick={() => { setExtraOpen(false); onOpen && onOpen(m); }}
                    style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px", border: "none", background: "transparent", cursor: "pointer", borderRadius: 7, textAlign: "left", fontSize: 12.5, color: "#0f172a" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "#f8fafc"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    <span style={{ width: 24, height: 24, borderRadius: 6, background: m.bg || "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <i className={`pi ${m.icon || "pi-file"}`} style={{ fontSize: 12, color: m.color || "#64748b" }} />
                    </span>
                    {m.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
        {items.map((it) => {
          const m = byId[it.type] || { label: it.label, color: "#64748b", bg: "#f1f5f9", icon: "pi-file", href: "" };
          const done = todayCounts[it.type] || 0;
          const st = statusOf(it.type, it.perDayMin);
          return (
            <button key={it.type} type="button" onClick={() => onOpen && onOpen(m)} title={it.label || m.label}
              style={{ background: "#fff", border: `1px solid ${st.color}33`, borderLeft: `4px solid ${st.color}`, borderRadius: 12, padding: "12px 14px", cursor: "pointer", textAlign: "left", display: "flex", flexDirection: "column", gap: 9 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, background: m.bg || "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <i className={`pi ${m.icon || "pi-file"}`} style={{ fontSize: 14, color: m.color || "#64748b" }} />
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{it.label || m.label}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: st.color }}>{done} / {it.perDayMin} today</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: st.color, background: st.bg, borderRadius: 999, padding: "2px 10px" }}>{st.label}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
