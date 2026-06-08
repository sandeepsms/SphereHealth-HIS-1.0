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
 *   { name, genericName?, form?, dose, frequency, mealStatus, duration, route,
 *     // R7hr-128 — Parenteral dose dilution (drives MAR → I/O auto-feed):
 *     dilutionVolume?, dilutionFluid?, infuseOverMinutes? }
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
  // R7hr-128 — IV/IM/SC dilution metadata so MAR can auto-emit an
  // Intake row when nurse marks the dose GIVEN. Backend has carried
  // these fields since R7bq-1; only the IA fan-out service + this
  // form were missing the UI/wiring (R7hr-127 audit follow-up).
  dilutionVolume:    "",   // string in form ("100" mL)
  dilutionFluid:     "",   // diluent name (NS 0.9% / RL / D5W / SWFI / etc.)
  infuseOverMinutes: "",   // push/drip duration in minutes
};

// R7hr-128 — Routes that require a dilution diluent. Includes the
// common IV/IM/SC trio plus intrathecal/epidural where reconstitution
// volume is also clinically relevant. Used to conditionally reveal the
// dilution strip below the main 7-cell grid.
const PARENTERAL_ROUTES = new Set([
  "IV", "IM", "SC", "Intradermal", "Intra-articular", "Epidural", "Spinal",
]);
const isParenteralRoute = (r) => PARENTERAL_ROUTES.has(String(r || "").trim());

/* ─────────────────────────────────────────────────────────────────
   R7hr-71 — Map a drug's form ("Tablet" / "Injection" / "Cream"…)
   to its sensible default Route. The doctor can still override
   afterwards — this only fires when the autocomplete pick lands.
   String matching is loose (substring + lowercase) so DrugMaster
   form names like "Tab", "Cap-DR", "Eye Drops", "Inj (Vial)",
   "Cream / Ointment" all resolve correctly without an explicit
   match table.
───────────────────────────────────────────────────────────────── */
function routeFromForm(form) {
  if (!form) return "";
  const f = String(form).toLowerCase().trim();
  // Order matters — most specific first.
  if (f.includes("sublingual") || f === "sl")                        return "Sublingual";
  if (f.includes("buccal") || f.includes("lozenge"))                 return "Buccal";
  if (f.includes("eye drop") || f.includes("eye oint")
      || f.includes("ophthal"))                                      return "Eye drops";
  if (f.includes("ear drop") || f.includes("otic"))                  return "Ear drops";
  if (f.includes("nasal") || f.includes("nose"))                     return "Nasal";
  if (f.includes("inhal") || f === "mdi" || f === "dpi"
      || f.includes("rotacap"))                                      return "Inhalation";
  if (f.includes("nebul") || f.includes("respule"))                  return "Nebulization";
  if (f.includes("suppositor"))                                      return "Per Rectum";
  if (f.includes("pessar") || f.includes("vaginal"))                 return "Per Vagina";
  if (f.includes("patch") || f.includes("transderm"))                return "Transdermal";
  if (f.includes("cream") || f.includes("ointment") || f.includes("gel")
      || f.includes("lotion") || f.includes("paste") || f === "topical"
      || f.includes("scalp") || f.includes("shampoo"))               return "Topical";
  if (f.includes("inject") || f.includes("inj") || f === "vial"
      || f.includes("ampoule") || f.includes("amp") || f.includes("infusion"))
                                                                     return "IV";
  if (f.includes("tab") || f.includes("cap") || f.includes("syrup")
      || f.includes("suspension") || f.includes("powder") || f.includes("sachet")
      || f.includes("granule") || f.includes("solution") || f.includes("elixir")
      || f === "liquid" || f.includes("oral") || f.includes("chewable"))
                                                                     return "Oral";
  return "";
}

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
              // R7hr-71 — derive Route from drug form (Tab→Oral,
              // Inj→IV, Cream→Topical, Eye drops→Eye drops, etc.).
              // Only override if we can map the form confidently —
              // unknown forms keep whatever the doctor already had.
              const derivedRoute = routeFromForm(d.form);
              if (derivedRoute) next.route = derivedRoute;
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
        {/* R7hr-71 — Duration is optional, especially at IPD admission
            where the course end-date often isn't known until labs +
            specialist input come in. Placeholder makes that explicit. */}
        <input
          list="pp-duration-options"
          value={newMed.duration}
          onChange={e => setNewMed(p => ({ ...p, duration: e.target.value }))}
          placeholder="Duration (optional)"
          title="Duration is optional — leave blank for indefinite / titrated courses, fill if known"
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

      {/* R7hr-128 — Dilution strip
          Shown only for IV/IM/SC/intrathecal etc. Captures three small
          fields that the MAR auto-feed needs to write a correct Intake
          row: how many mL of diluent, which fluid, and the push/drip
          time. Without these the dose is administered but I/O cannot
          credit the volume to fluid balance (R7bq-3). For oral / topical
          / inhalation drugs the strip stays hidden so the form doesn't
          grow vertical noise.
          */}
      {isParenteralRoute(newMed.route) && (
        <div
          style={{
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 12,
            background: "#f0f9ff",
            display: "grid",
            gridTemplateColumns: "auto minmax(0, 100px) minmax(0, 1.2fr) minmax(0, 110px)",
            gap: 10,
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: "#0369a1" }}>
            💧 Dilution<br/>
            <span style={{ fontSize: 10, fontWeight: 500, color: "#0c4a6e" }}>(for I/O auto-credit)</span>
          </div>
          <input
            type="number"
            min="0"
            max="5000"
            value={newMed.dilutionVolume}
            onChange={(e) => setNewMed(p => ({ ...p, dilutionVolume: e.target.value }))}
            placeholder="Vol mL"
            title="How many mL of diluent — e.g. 100 for '100 mL NS'"
            style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark, background: "#fff" }}
          />
          <input
            list="pp-dilution-fluid-options"
            value={newMed.dilutionFluid}
            onChange={(e) => setNewMed(p => ({ ...p, dilutionFluid: e.target.value }))}
            placeholder="Diluent (NS 0.9% / RL / D5W …)"
            title="Which fluid to mix in — type or pick from suggestions"
            style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark, background: "#fff" }}
          />
          <datalist id="pp-dilution-fluid-options">
            <option value="NS 0.9%" />
            <option value="½ NS (0.45%)" />
            <option value="RL — Ringer Lactate" />
            <option value="D5W — 5% Dextrose" />
            <option value="D10W — 10% Dextrose" />
            <option value="D5 ½NS" />
            <option value="D5 NS" />
            <option value="SWFI — Sterile Water for Injection" />
            <option value="WFI — Water for Injection" />
            <option value="DNS — Dextrose Normal Saline" />
            <option value="Isolyte M" />
            <option value="Isolyte P" />
            <option value="Isolyte G" />
            <option value="Direct IV push (no diluent)" />
          </datalist>
          <input
            type="number"
            min="0"
            max="720"
            value={newMed.infuseOverMinutes}
            onChange={(e) => setNewMed(p => ({ ...p, infuseOverMinutes: e.target.value }))}
            placeholder="Over min"
            title="Push / drip duration in minutes — e.g. 30 for 'infuse over 30 min'"
            style={{ border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 10px", fontSize: 12, outline: "none", fontFamily: "inherit", color: C.dark, background: "#fff" }}
          />
        </div>
      )}

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
          <tbody>{value.map((m, i) => {
            // R7hr-128 — Compose the dilution sub-label so it sits
            // under the drug name on the same row. Only shown when the
            // doctor actually filled at least dilutionVolume.
            const hasDilution = m.dilutionVolume && Number(m.dilutionVolume) > 0;
            const dilutionText = hasDilution
              ? `in ${m.dilutionVolume} mL ${m.dilutionFluid || "NS 0.9%"}`
                  + (m.infuseOverMinutes && Number(m.infuseOverMinutes) > 0
                      ? ` over ${m.infuseOverMinutes} min`
                      : "")
              : null;
            return (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ padding: "7px 10px", color: C.dark }}>
                <div>{m.name || "—"}</div>
                {dilutionText && (
                  <div style={{ fontSize: 10, color: "#0369a1", fontWeight: 600, marginTop: 2 }}>
                    💧 {dilutionText}
                  </div>
                )}
              </td>
              {["dose", "frequency", "mealStatus", "duration", "route"].map(k => (
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
            );
          })}</tbody>
        </table>
      )}
    </div>
  );
}
