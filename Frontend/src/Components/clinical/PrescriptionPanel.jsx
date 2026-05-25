import React, { useState } from "react";
import DrugAutocomplete, { drugDisplayName, parseStrength } from "./DrugAutocomplete";

/**
 * PrescriptionPanel — Self-contained Rx builder used by OPD + Emergency
 * + (future) IPD doctor assessments.
 *
 * R7ay — Extracted from OPDAssessmentPage.jsx so the Emergency Department
 * doctor flow can drop in the same DrugAutocomplete + 7-cell row + table
 * UX without duplicating ~230 lines of JSX. OPD continues to use its own
 * inline copy for now; the inline OPD version will migrate to this
 * component in a follow-up cleanup.
 *
 * Controlled API: parent owns the `value` array and gets notified via
 * `onChange(newArray)` whenever a row is added or removed. The "new
 * row" build-up state lives INSIDE this component so the parent isn't
 * cluttered with temporary input bookkeeping.
 *
 *   <PrescriptionPanel
 *     value={meds}                  // Array of saved prescription rows
 *     onChange={setMeds}            // Called with the new array
 *     theme={{ warn, border, dark, muted, bg }}   // Optional color override
 *   />
 *
 * Row shape (each element of `value`):
 *   { name, genericName?, form?, dose, frequency, mealStatus, duration, route }
 */

const DEFAULT_THEME = {
  warn:   "#d97706",
  border: "#e2e6ea",
  dark:   "#1a1d23",
  muted:  "#6b7280",
  bg:     "#f0f2f5",
};

const BLANK_MED = {
  name: "",
  genericName: "",
  form: "",
  dose: "",
  frequency: "",
  mealStatus: "",
  duration: "",
  route: "Oral",
};

export default function PrescriptionPanel({ value = [], onChange, theme }) {
  const C = { ...DEFAULT_THEME, ...(theme || {}) };
  const [newMed, setNewMed] = useState(BLANK_MED);
  // R7az-D4-HIGH-2: disable + Add while a row is being committed so a
  // double-click on the button doesn't create two identical rows.
  const [isAddingMed, setIsAddingMed] = useState(false);

  const addMed = () => {
    if (isAddingMed) return;
    if (!newMed.name.trim()) return;
    setIsAddingMed(true);
    try {
      onChange([...(value || []), { ...newMed }]);
      setNewMed(BLANK_MED);
    } finally {
      // Short re-enable so a fast click still feels responsive but
      // double-tap protection holds.
      setTimeout(() => setIsAddingMed(false), 250);
    }
  };

  const removeMed = (idx) => {
    onChange((value || []).filter((_, i) => i !== idx));
  };

  return (
    <div>
      {/* 7-cell grid: Medicine | Dose | Frequency | Meal | Duration | Route | + Add.
          minmax(0, …) so each fr column collapses to its share rather than
          falling back to min-content (which previously crushed Medicine to
          ~20px). Medicine gets 1.8fr because "Tab Paracetamol 500mg" is
          typically the longest cell. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.8fr) minmax(0,0.7fr) minmax(0,1fr) minmax(0,0.95fr) minmax(0,0.95fr) minmax(0,1fr) auto", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <DrugAutocomplete
          value={newMed.name}
          onChange={(v) => setNewMed(p => ({ ...p, name: v }))}
          onPick={(d) => {
            // Mirror form-prefix + generic + strength so audit + print get
            // structured fields. Display name follows Indian Rx convention
            // ("Tab Paracetamol 500mg" / "Cap Amoxicillin 500mg").
            setNewMed(p => {
              const next = { ...p, name: drugDisplayName(d) };
              if (d.genericName) next.genericName = d.genericName;
              const { value: dv, unit } = parseStrength(d.strength);
              if (dv && unit) next.dose = `${dv}${unit}`;
              else if (d.strength) next.dose = d.strength;
              if (d.form) next.form = d.form;
              return next;
            });
          }}
          placeholder="Medicine * — start typing"
          inputStyle={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark, width: "100%" }}
          inputClassName=""
          showLabel={false}
        />
        <input
          value={newMed.dose}
          onChange={e => setNewMed(p => ({ ...p, dose: e.target.value }))}
          placeholder="Dose"
          style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
        />
        <select
          value={newMed.frequency}
          onChange={e => setNewMed(p => ({ ...p, frequency: e.target.value }))}
          style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: newMed.frequency ? C.dark : "#94a3b8", background: "#fff" }}
        >
          <option value="">Frequency</option>
          <optgroup label="Common">
            <option value="OD">OD — Once daily</option>
            <option value="BD">BD — Twice daily (1-0-1)</option>
            <option value="TDS">TDS — Thrice daily (1-1-1)</option>
            <option value="QID">QID — Four times daily</option>
            <option value="HS">HS — At bedtime</option>
            <option value="SOS">SOS — As needed (PRN)</option>
            <option value="Stat">Stat — Single dose now</option>
            <option value="Stat & SOS">Stat & SOS — First dose now, repeat PRN</option>
          </optgroup>
          <optgroup label="Hourly">
            <option value="q1h">q1h — Every 1 hour</option>
            <option value="q2h">q2h — Every 2 hours</option>
            <option value="q4h">q4h — Every 4 hours</option>
            <option value="q6h">q6h — Every 6 hours</option>
            <option value="q8h">q8h — Every 8 hours</option>
            <option value="q12h">q12h — Every 12 hours</option>
          </optgroup>
          <optgroup label="Less frequent">
            <option value="Alt day">Alt day — Every other day</option>
            <option value="Weekly">Weekly</option>
            <option value="Twice weekly">Twice weekly</option>
            <option value="Monthly">Monthly</option>
          </optgroup>
        </select>
        <select
          value={newMed.mealStatus}
          onChange={e => setNewMed(p => ({ ...p, mealStatus: e.target.value }))}
          title="Meal status"
          style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: newMed.mealStatus ? C.dark : "#94a3b8", background: "#fff" }}
        >
          <option value="">Meal status</option>
          <option value="After Food">After Food (PC)</option>
          <option value="Before Food">Before Food (AC)</option>
          <option value="With Food">With Food</option>
          <option value="Empty Stomach">Empty Stomach</option>
          <option value="Before Breakfast">Before Breakfast (BBF)</option>
          <option value="After Breakfast">After Breakfast (ABF)</option>
          <option value="Bedtime">At Bedtime (HS)</option>
          <option value="Any Time">Any Time</option>
        </select>
        <input
          list="pp-duration-options"
          value={newMed.duration}
          onChange={e => setNewMed(p => ({ ...p, duration: e.target.value }))}
          placeholder="Duration"
          style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark }}
        />
        <datalist id="pp-duration-options">
          <option value="1 day" />
          <option value="3 days" />
          <option value="5 days" />
          <option value="7 days" />
          <option value="10 days" />
          <option value="14 days" />
          <option value="1 week" />
          <option value="2 weeks" />
          <option value="3 weeks" />
          <option value="1 month" />
          <option value="2 months" />
          <option value="3 months" />
          <option value="6 months" />
          <option value="1 year" />
          <option value="Single dose" />
          <option value="Until reviewed" />
          <option value="Continuous / Long-term" />
        </datalist>
        <select
          value={newMed.route}
          onChange={e => setNewMed(p => ({ ...p, route: e.target.value }))}
          style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: newMed.route ? C.dark : "#94a3b8", background: "#fff" }}
        >
          <option value="">Route</option>
          <optgroup label="Enteral">
            <option value="Oral">Oral (PO)</option>
            <option value="Sublingual">Sublingual (SL)</option>
            <option value="Buccal">Buccal</option>
            <option value="NG Tube">NG Tube</option>
            <option value="PEG Tube">PEG Tube</option>
            <option value="Per Rectum">Per Rectum (PR)</option>
          </optgroup>
          <optgroup label="Parenteral">
            <option value="IV">IV — Intravenous</option>
            <option value="IM">IM — Intramuscular</option>
            <option value="SC">SC — Subcutaneous</option>
            <option value="Intradermal">Intradermal (ID)</option>
            <option value="Intra-articular">Intra-articular</option>
            <option value="Epidural">Epidural</option>
            <option value="Spinal">Spinal / Intrathecal</option>
          </optgroup>
          <optgroup label="Topical / Local">
            <option value="Topical">Topical (skin)</option>
            <option value="Transdermal">Transdermal Patch</option>
            <option value="Eye drops">Eye drops</option>
            <option value="Ear drops">Ear drops</option>
            <option value="Nasal">Nasal</option>
            <option value="Inhalation">Inhalation</option>
            <option value="Nebulization">Nebulization</option>
            <option value="Per Vagina">Per Vagina (PV)</option>
            <option value="Local infiltration">Local infiltration</option>
          </optgroup>
        </select>
        <button
          onClick={addMed}
          disabled={isAddingMed}
          style={{ background: C.warn, color: "#fff", border: "none", borderRadius: 7, padding: "8px 14px", cursor: isAddingMed ? "wait" : "pointer", fontWeight: 600, fontSize: 12, opacity: isAddingMed ? 0.6 : 1 }}
        >
          {isAddingMed ? "Adding…" : "+ Add"}
        </button>
      </div>
      {value.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 12, margin: 0 }}>No medications prescribed.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: C.bg }}>
            {["Medicine", "Dose", "Frequency", "Meal", "Duration", "Route"].map(h => (
              <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontWeight: 600, color: C.muted, borderBottom: `1px solid ${C.border}` }}>{h}</th>
            ))}
            <th style={{ width: 36, borderBottom: `1px solid ${C.border}` }} aria-label="Remove" />
          </tr></thead>
          <tbody>{value.map((m, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
              {["name", "dose", "frequency", "mealStatus", "duration", "route"].map(k => (
                <td key={k} style={{ padding: "7px 10px", color: C.dark }}>{m[k] || "—"}</td>
              ))}
              <td style={{ padding: "4px 6px", textAlign: "right" }}>
                <button
                  type="button"
                  onClick={() => removeMed(i)}
                  title={`Remove ${m.name || "this medication"}`}
                  aria-label="Remove medication"
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
