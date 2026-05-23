import React, { useState } from "react";

/**
 * InfusionPanel — Self-contained IV-fluid / infusion order builder
 * used by OPD + Emergency doctor assessments.
 *
 * R7ay — Extracted from OPDAssessmentPage.jsx so the Emergency Department
 * doctor flow can drop in the same fluid/drug datalist + 6-cell row + table
 * UX. OPD continues to use its inline copy for now.
 *
 * Controlled API — parent owns the `value` array and gets notified via
 * `onChange(newArray)`:
 *
 *   <InfusionPanel value={infusions} onChange={setInfusions} theme={...} />
 *
 * Row shape (each element of `value`):
 *   { name, totalVolume, rate, duration, route, additives, instructions? }
 *
 * IMPORTANT — IV fluids route differently from PO meds: nurses see them
 * in the "Infusion Orders & Monitoring" tab, NOT the Medication MAR.
 * Routine fluids (NS / RL / DNS) are non-HAM; insulin / KCl / heparin
 * drips auto-tag as HAM on the backend, requiring 2-nurse verification.
 */

const DEFAULT_THEME = {
  border: "#e2e6ea",
  dark:   "#1a1d23",
  muted:  "#6b7280",
  bg:     "#f0f2f5",
  accent: "#0d9488",
};

const BLANK_INFUSION = {
  name: "",
  totalVolume: "",
  rate: "",
  duration: "",
  route: "IV Infusion",
  additives: "",
  instructions: "",
};

export default function InfusionPanel({ value = [], onChange, theme }) {
  const C = { ...DEFAULT_THEME, ...(theme || {}) };
  const [newInfusion, setNewInfusion] = useState(BLANK_INFUSION);
  // R7az-D4-HIGH-2: in-flight latch to block double-tap duplicates.
  const [isAddingInfusion, setIsAddingInfusion] = useState(false);

  const addInfusion = () => {
    if (isAddingInfusion) return;
    if (!newInfusion.name.trim()) return;
    setIsAddingInfusion(true);
    try {
      onChange([...(value || []), { ...newInfusion }]);
      setNewInfusion(BLANK_INFUSION);
    } finally {
      setTimeout(() => setIsAddingInfusion(false), 250);
    }
  };

  const removeInfusion = (idx) => {
    onChange((value || []).filter((_, i) => i !== idx));
  };

  return (
    <div>
      <p style={{ color: C.muted, fontSize: 11, marginTop: 0, marginBottom: 10 }}>
        For day-care / hydration / corrections. Routes to the nurse's
        <strong> Infusion Orders & Monitoring </strong> tab on save.
        Routine fluids are non-HAM; insulin / KCl / heparin drips auto-tag
        as <strong>HAM</strong> requiring 2-nurse verification.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) 110px 100px 110px minmax(0,1.5fr) auto", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <input
          value={newInfusion.name}
          onChange={e => setNewInfusion(p => ({ ...p, name: e.target.value }))}
          placeholder="Fluid / drug — e.g. NS 0.9%, RL, Insulin drip"
          list="ip-infusion-options"
          style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
        />
        <datalist id="ip-infusion-options">
          <option value="Normal Saline 0.9% (NS)" />
          <option value="Ringer Lactate (RL)" />
          <option value="Dextrose Normal Saline (DNS)" />
          <option value="5% Dextrose (D5W)" />
          <option value="25% Dextrose" />
          <option value="50% Dextrose" />
          <option value="Mannitol 20%" />
          <option value="3% Hypertonic Saline" />
          <option value="Insulin drip" />
          <option value="Heparin drip" />
          <option value="Noradrenaline drip" />
          <option value="KCl correction" />
          <option value="Magnesium Sulphate" />
          <option value="Calcium Gluconate" />
        </datalist>
        <input
          value={newInfusion.totalVolume}
          onChange={e => setNewInfusion(p => ({ ...p, totalVolume: e.target.value }))}
          placeholder="Vol (ml)"
          style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
        />
        <input
          value={newInfusion.rate}
          onChange={e => setNewInfusion(p => ({ ...p, rate: e.target.value }))}
          placeholder="Rate ml/hr *"
          style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
        />
        <input
          list="ip-infusion-duration-options"
          value={newInfusion.duration}
          onChange={e => setNewInfusion(p => ({ ...p, duration: e.target.value }))}
          placeholder="Duration"
          style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
        />
        <datalist id="ip-infusion-duration-options">
          <option value="STAT — 1 dose" />
          <option value="Over 1 hour" />
          <option value="Over 2 hours" />
          <option value="Over 4 hours" />
          <option value="Over 6 hours" />
          <option value="Over 8 hours" />
          <option value="Over 12 hours" />
          <option value="Over 24 hours" />
          <option value="Continuous — titrate" />
        </datalist>
        <input
          value={newInfusion.additives}
          onChange={e => setNewInfusion(p => ({ ...p, additives: e.target.value }))}
          placeholder="Additives / instructions (e.g. + KCl 20 mEq)"
          style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
        />
        <button
          onClick={addInfusion}
          disabled={isAddingInfusion}
          style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", cursor: isAddingInfusion ? "wait" : "pointer", fontWeight: 600, fontSize: 12, opacity: isAddingInfusion ? 0.6 : 1 }}
        >
          {isAddingInfusion ? "Adding…" : "+ Add"}
        </button>
      </div>
      {value.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>No infusions ordered.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: C.bg }}>
            {["Fluid / Drug", "Volume", "Rate", "Duration", "Additives"].map(h => (
              <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }}>{h}</th>
            ))}
            <th style={{ width: 36, borderBottom: `1px solid ${C.border}` }} aria-label="Remove" />
          </tr></thead>
          <tbody>{value.map((f, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "7px 10px", color: C.dark, fontWeight: 600 }}>{f.name || "—"}</td>
              <td style={{ padding: "7px 10px", color: C.dark }}>{f.totalVolume ? `${f.totalVolume} ml` : "—"}</td>
              <td style={{ padding: "7px 10px", color: C.dark, fontFamily: "'DM Mono', monospace" }}>{f.rate ? `${f.rate} ml/hr` : "—"}</td>
              <td style={{ padding: "7px 10px", color: C.dark }}>{f.duration || "—"}</td>
              <td style={{ padding: "7px 10px", color: C.muted, fontSize: 11 }}>{f.additives || "—"}</td>
              <td style={{ padding: "4px 6px", textAlign: "right" }}>
                <button
                  type="button"
                  onClick={() => removeInfusion(i)}
                  title={`Remove ${f.name || "this infusion"}`}
                  aria-label="Remove infusion"
                  style={{
                    width: 24, height: 24, border: "1px solid #fca5a5",
                    background: "#fef2f2", color: "#b91c1c",
                    borderRadius: 6, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "inherit", fontWeight: 700, fontSize: 13, lineHeight: 1,
                    padding: 0,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#fee2e2"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "#fef2f2"; }}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}
