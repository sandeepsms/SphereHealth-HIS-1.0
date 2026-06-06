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
  strength: "",  // R7hr-68 — for vasopressor / insulin / heparin drips
};

/* ─────────────────────────────────────────────────────────────────
   R7hr-68 — FLUID PRESETS
   Standard volume / rate / duration / additives for the 16 fluids
   in the datalist. On name match the empty fields in the form get
   auto-filled — never overwrites user-typed values, so the doctor
   can still override.
   Sources: AHA / NICE / ICMR standard adult infusion protocols.
───────────────────────────────────────────────────────────────── */
const FLUID_PRESETS = {
  "Normal Saline 0.9% (NS)":      { totalVolume: 500, rate: 100, duration: "Over 5 hours" },
  "Ringer Lactate (RL)":          { totalVolume: 500, rate: 100, duration: "Over 5 hours" },
  "Dextrose Normal Saline (DNS)": { totalVolume: 500, rate: 100, duration: "Over 5 hours" },
  "5% Dextrose (D5W)":            { totalVolume: 500, rate: 100, duration: "Over 5 hours" },
  "25% Dextrose":                 { totalVolume: 100, rate: 50,  duration: "Over 2 hours",  additives: "Hypoglycaemia correction — slow IV" },
  "50% Dextrose":                 { totalVolume: 50,  rate: 100, duration: "STAT — 1 dose", additives: "Hypoglycaemia rescue — STAT IV push" },
  "Mannitol 20%":                 { totalVolume: 100, rate: 200, duration: "Over 30 min",   additives: "Osmotic diuretic — monitor I/O, S.osm" },
  "20% Human Albumin":            { totalVolume: 100, rate: 25,  duration: "Over 4 hours",  additives: "Hypoalbuminemia — slow infusion" },
  "5% Albumin":                   { totalVolume: 250, rate: 100, duration: "Over 2.5 hours" },
  "3% Hypertonic Saline":         { totalVolume: 100, rate: 50,  duration: "Over 2 hours",  additives: "Hyponatremia correction — central line, monitor Na q2h" },
  "Insulin drip":                 { totalVolume: 50,  rate: 5,   duration: "Continuous — titrate", additives: "50 U Regular Insulin in 50 ml NS (1 U/ml) — titrate per CBG protocol — HAM (2-nurse check)" },
  "Heparin drip":                 { totalVolume: 250, rate: 18,  duration: "Continuous — titrate", additives: "25,000 U Heparin in 250 ml NS (100 U/ml) — bolus 80 U/kg, then 18 U/kg/hr — aPTT q6h — HAM" },
  "Noradrenaline drip":           { totalVolume: 50,  rate: 5,   duration: "Continuous — titrate", additives: "Single strength: 1 amp (2 mg/2 ml) in 48 ml NS = 40 mcg/ml — titrate to MAP ≥ 65 mmHg — central line — HAM" },
  "KCl correction":               { totalVolume: 100, rate: 50,  duration: "Over 2 hours",  additives: "20 mEq KCl in 100 ml NS — max 10 mEq/hr peripheral / 20 mEq/hr central — HAM (concentrated electrolyte)" },
  "Magnesium Sulphate":           { totalVolume: 100, rate: 50,  duration: "Over 2 hours",  additives: "2 g MgSO4 in 100 ml NS — monitor reflexes / RR / BP" },
  "Calcium Gluconate":            { totalVolume: 100, rate: 50,  duration: "Over 2 hours",  additives: "1 g (10 ml 10%) in 100 ml NS — slow infusion, cardiac monitor" },
};

/* ─────────────────────────────────────────────────────────────────
   R7hr-68 — STRENGTH RECIPES
   Concentration-scaled formulas. Doctors often order vasopressors /
   insulin / heparin at double or quad strength when running on a
   restricted-volume patient (paeds, cardiac, fluid-overload). Click
   a chip to swap the additives string + totalVolume.
   `volMl` is the FINAL bag volume; rate stays as the prior preset
   so the doctor's titration plan is preserved.
───────────────────────────────────────────────────────────────── */
const STRENGTH_RECIPES = {
  "Noradrenaline drip": {
    "Single (40 mcg/ml)":  { volMl: 50, additives: "Single strength: 1 amp (2 mg/2 ml) in 48 ml NS = 40 mcg/ml — titrate to MAP ≥ 65 mmHg — central line — HAM" },
    "Double (80 mcg/ml)":  { volMl: 50, additives: "Double strength: 2 amp (4 mg/4 ml) in 46 ml NS = 80 mcg/ml — titrate to MAP ≥ 65 mmHg — central line — HAM" },
    "Triple (120 mcg/ml)": { volMl: 50, additives: "Triple strength: 3 amp (6 mg/6 ml) in 44 ml NS = 120 mcg/ml — central line — HAM" },
    "Quad (160 mcg/ml)":   { volMl: 50, additives: "Quad strength: 4 amp (8 mg/8 ml) in 42 ml NS = 160 mcg/ml — central line — HAM" },
  },
  "Insulin drip": {
    "Single (1 U/ml)":  { volMl: 50, additives: "50 U Regular Insulin in 50 ml NS (1 U/ml) — titrate per CBG protocol — HAM (2-nurse check)" },
    "Double (2 U/ml)":  { volMl: 50, additives: "100 U Regular Insulin in 50 ml NS (2 U/ml) — titrate per CBG protocol — HAM (2-nurse check)" },
  },
  "Heparin drip": {
    "Standard (100 U/ml)": { volMl: 250, additives: "25,000 U Heparin in 250 ml NS (100 U/ml) — bolus 80 U/kg, then 18 U/kg/hr — aPTT q6h — HAM" },
    "Concentrated (200 U/ml)": { volMl: 250, additives: "50,000 U Heparin in 250 ml NS (200 U/ml) — for fluid-restricted patients — aPTT q6h — HAM" },
  },
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

  /* R7hr-68 — auto-fill preset on fluid name change.
     Triggered both by typing and by picking from the datalist.
     Only writes into EMPTY fields so the doctor's typed values are
     never clobbered. Resets `strength` whenever the fluid name
     changes since the strength recipe is fluid-specific. */
  const onFluidNameChange = (rawName) => {
    setNewInfusion(prev => {
      const next = { ...prev, name: rawName };
      const preset = FLUID_PRESETS[rawName];
      if (preset) {
        if (!prev.totalVolume) next.totalVolume = String(preset.totalVolume);
        if (!prev.rate)        next.rate        = String(preset.rate);
        if (!prev.duration)    next.duration    = preset.duration;
        if (!prev.additives && preset.additives) next.additives = preset.additives;
      }
      // Strength is fluid-specific — drop it when the fluid changes.
      if (rawName !== prev.name) next.strength = "";
      return next;
    });
  };

  /* R7hr-68 — strength chip click. Re-writes additives + totalVolume
     from the chosen recipe so the concentration formula is canonical
     instead of free-text. */
  const applyStrength = (label) => {
    const recipes = STRENGTH_RECIPES[newInfusion.name];
    if (!recipes || !recipes[label]) return;
    const r = recipes[label];
    setNewInfusion(prev => ({
      ...prev,
      strength:    label,
      totalVolume: String(r.volMl),
      additives:   r.additives,
    }));
  };

  const strengthOptions = STRENGTH_RECIPES[newInfusion.name]
    ? Object.keys(STRENGTH_RECIPES[newInfusion.name])
    : [];

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
          onChange={e => onFluidNameChange(e.target.value)}
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
          <option value="20% Human Albumin" />
          <option value="5% Albumin" />
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

      {/* R7hr-68 — preset / strength helper bar. Shows ONLY when the
          selected fluid has a preset or strength recipes. Keeps the
          form row clean when typing an ad-hoc / free-text fluid. */}
      {(FLUID_PRESETS[newInfusion.name] || strengthOptions.length > 0) && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "8px 12px", marginBottom: 12,
          background: `${C.accent}08`, border: `1px solid ${C.accent}30`,
          borderRadius: 8,
        }}>
          {FLUID_PRESETS[newInfusion.name] && (
            <span style={{ fontSize: 10.5, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: ".5px" }}>
              ✓ Standard preset applied
            </span>
          )}
          {strengthOptions.length > 0 && (
            <>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px" }}>
                · Strength:
              </span>
              {strengthOptions.map(label => (
                <button
                  key={label}
                  type="button"
                  onClick={() => applyStrength(label)}
                  style={{
                    padding: "4px 11px", borderRadius: 999,
                    border: `1.5px solid ${newInfusion.strength === label ? C.accent : C.border}`,
                    background:  newInfusion.strength === label ? C.accent : "white",
                    color:       newInfusion.strength === label ? "white"   : C.dark,
                    fontFamily: "inherit", fontSize: 11, fontWeight: 700,
                    cursor: "pointer", transition: "all .15s ease",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </button>
              ))}
            </>
          )}
        </div>
      )}

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
