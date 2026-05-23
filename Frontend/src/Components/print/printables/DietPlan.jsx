// Components/print/printables/DietPlan.jsx
// Diet plan printable — issued by the dietitian for the patient
// (in-patient or OPD-counselling). Replaces the legacy inline
// `window.open` HTML print in the Dietitian console with a proper
// PrintShell-wrapped, audit-tracked template.
//
// Carries: patient demographics, allergens (RED banner), per-meal
// composition (table with item / qty / calories / protein), target
// macros, restrictions, dietitian + (for therapeutic diets) doctor
// counter-sign.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const MEAL_ORDER = ["earlyMorning", "breakfast", "midMorning", "lunch", "evening", "dinner", "bedtime", "snack"];
const MEAL_LABEL = {
  earlyMorning: "Early Morning",
  breakfast:    "Breakfast",
  midMorning:   "Mid-Morning",
  lunch:        "Lunch",
  evening:      "Evening Snack",
  dinner:       "Dinner",
  bedtime:      "Bedtime",
  snack:        "Snack",
};

const DietPlan = ({ settings, receipt = {} }) => {
  const r = receipt;
  const isTherapeutic = !!r.therapeutic || !!r.requiresDoctorSignoff;
  const meals = r.meals || {};
  const allergens = Array.isArray(r.allergens) ? r.allergens : (r.allergens ? [r.allergens] : []);

  return (
    <PrintShell
      settings={settings}
      documentTitle={isTherapeutic ? "Therapeutic Diet Plan" : "Diet Plan"}
      serialNo={r.planNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Patient",      value: r.patientName },
        { label: "UHID",         value: r.uhid },
        { label: "Age / Sex",    value: [r.age && `${r.age}Y`, r.gender].filter(Boolean).join(" / ") },
        { label: "Bed / Ward",   value: [r.bedNumber, r.wardName].filter(Boolean).join(" · ") },
        { label: "Diet Type",    value: r.dietType || "Normal" },
        { label: "Plan Date",    value: fmtDateTime(r.planDate || new Date()) },
      ]}
      signatureLabels={isTherapeutic
        ? ["Dietitian", "Treating Doctor — Counter-sign"]
        : ["Dietitian", "Patient / Attendant"]}
    >
      {/* Allergen RED banner */}
      {allergens.length > 0 && (
        <div style={{
          background: "linear-gradient(135deg, #fee2e2, #fecaca)",
          border: "2px solid #fca5a5",
          borderRadius: 8, padding: "10px 14px", marginBottom: 12,
        }}>
          <div style={{ fontSize: 10, color: "#7f1d1d", textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 800 }}>
            ⚠ Allergens / Strict Avoid
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#7f1d1d", marginTop: 4 }}>
            {allergens.join("  ·  ")}
          </div>
        </div>
      )}

      {/* Clinical anchor (height/weight/BMI/dx) */}
      <div className="pr-section">
        <div className="pr-section__title">Clinical Anchors</div>
        <table className="pr-table" style={{ fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={{ width: "20%", fontWeight: 700 }}>Height</td>
              <td>{r.height ? `${r.height} cm` : "—"}</td>
              <td style={{ width: "20%", fontWeight: 700 }}>Weight</td>
              <td>{r.weight ? `${r.weight} kg` : "—"}</td>
              <td style={{ width: "15%", fontWeight: 700 }}>BMI</td>
              <td>{r.bmi || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Diagnosis</td>
              <td colSpan={5}>{r.diagnosis || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Goal</td>
              <td colSpan={5}>{r.dietGoal || r.goal || "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Target macros */}
      <div className="pr-section">
        <div className="pr-section__title">Daily Target Macros</div>
        <div className="pr-section__body" style={{ fontSize: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, textAlign: "center", background: "#f8fafc" }}>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Calories</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{r.targetCalories || "—"}</div>
              <div style={{ fontSize: 9, color: "#64748b" }}>kcal</div>
            </div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, textAlign: "center", background: "#f8fafc" }}>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Protein</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{r.targetProtein || "—"}</div>
              <div style={{ fontSize: 9, color: "#64748b" }}>g</div>
            </div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, textAlign: "center", background: "#f8fafc" }}>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Carbs</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{r.targetCarbs || "—"}</div>
              <div style={{ fontSize: 9, color: "#64748b" }}>g</div>
            </div>
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, textAlign: "center", background: "#f8fafc" }}>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Fat</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{r.targetFat || "—"}</div>
              <div style={{ fontSize: 9, color: "#64748b" }}>g</div>
            </div>
          </div>
          {r.fluidRestriction && (
            <div style={{ marginTop: 6 }}><strong>Fluid restriction:</strong> {r.fluidRestriction}</div>
          )}
        </div>
      </div>

      {/* Meals table */}
      <div className="pr-section">
        <div className="pr-section__title">Meal Plan</div>
        <table className="pr-table" style={{ fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Meal</th>
              <th>Items</th>
              <th style={{ width: 70 }} className="center">Qty</th>
              <th style={{ width: 70 }} className="right">Cal (kcal)</th>
              <th style={{ width: 70 }} className="right">Protein (g)</th>
            </tr>
          </thead>
          <tbody>
            {MEAL_ORDER.flatMap((mealKey) => {
              const arr = Array.isArray(meals[mealKey]) ? meals[mealKey] : [];
              if (arr.length === 0) return [];
              return arr.map((it, j) => (
                <tr key={`${mealKey}-${j}`} style={{ pageBreakInside: "avoid" }}>
                  {j === 0
                    ? <td rowSpan={arr.length} style={{ fontWeight: 700, verticalAlign: "top" }}>{MEAL_LABEL[mealKey]}</td>
                    : null}
                  <td>{it.item || it.name || "—"}
                    {it.notes && <div className="muted" style={{ fontSize: 9.5 }}>{it.notes}</div>}
                  </td>
                  <td className="center">{it.quantity || it.qty || "—"}</td>
                  <td className="right">{it.calories || "—"}</td>
                  <td className="right">{it.protein || "—"}</td>
                </tr>
              ));
            })}
            {Object.keys(meals).length === 0 && (
              <tr><td colSpan={5} className="muted center" style={{ padding: 12 }}>No meals specified.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Restrictions / instructions */}
      {(r.restrictions || r.instructions) && (
        <div className="pr-section">
          <div className="pr-section__title">Restrictions &amp; Instructions</div>
          <div className="pr-section__body" style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }}>
            {r.restrictions && <div><strong>Restrictions:</strong> {Array.isArray(r.restrictions) ? r.restrictions.join(", ") : r.restrictions}</div>}
            {r.instructions && <div style={{ marginTop: 4 }}><strong>Instructions:</strong> {r.instructions}</div>}
          </div>
        </div>
      )}

      {/* Issuer */}
      <div className="pr-section">
        <div className="pr-section__title">Issued By</div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          <div><strong>Dietitian:</strong> {r.dietitianName || "—"}</div>
          {r.dietitianRegNo && <div><strong>RD #:</strong> <span style={{ fontFamily: "'DM Mono', monospace" }}>{r.dietitianRegNo}</span></div>}
          {isTherapeutic && (
            <div style={{ marginTop: 6, padding: "6px 10px", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4 }}>
              <strong>Therapeutic diet — requires treating-doctor counter-sign.</strong>
              {r.treatingDoctor && <div>Doctor: {r.treatingDoctor}</div>}
            </div>
          )}
        </div>
      </div>
    </PrintShell>
  );
};

export default DietPlan;
