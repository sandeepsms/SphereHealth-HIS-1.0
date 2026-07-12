/**
 * FullDietSection.jsx — R7hr(DOCS-FULL, owner 2026-07-12)
 * ─────────────────────────────────────────────────────────
 * Standalone-level diet plans inside the Complete Patient File: allergen
 * banner, clinical anchors (height / weight / BMI / conditions / food
 * preference), daily targets (calories / protein / fluid / salt), the
 * meal-by-meal plan table and restrictions / instructions + assigned-by —
 * instead of the old Date/Diet/Kcal register row.
 *
 * Data: `file.dietPlans[].full` = raw PatientDietPlan doc (DietitianModels:
 * assessment{…} + plan{templateName, meals[], targets…}). Model-key-first
 * chains; caller keeps the legacy MiniTable when no `full` is present.
 */
import React from "react";

const S = {
  card: { border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px", margin: "5px 0", breakInside: "avoid" },
  title: { fontSize: 10.5, fontWeight: 800, color: "#0f172a" },
  meta: { fontSize: 8.5, color: "#64748b", margin: "1px 0 3px" },
  h: { fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "#475569", margin: "4px 0 1px" },
  p: { fontSize: 10, color: "#0f172a", margin: "1px 0", lineHeight: 1.45, whiteSpace: "pre-wrap" },
  tbl: { width: "100%", borderCollapse: "collapse", fontSize: 9.5, margin: "3px 0 4px" },
  th: { border: "1px solid #e7edf3", background: "#f6f8fb", padding: "2px 6px", textAlign: "left", fontWeight: 800, textTransform: "uppercase", fontSize: 8.5, color: "#475569" },
  td: { border: "1px solid #eef2f6", padding: "2px 6px", verticalAlign: "top", color: "#0f172a" },
  warn: { border: "1.5px solid #fca5a5", background: "#fef2f2", borderRadius: 5, padding: "4px 8px", margin: "3px 0", fontSize: 9.5, fontWeight: 700, color: "#991b1b" },
  chip: { display: "inline-block", padding: "1px 8px", borderRadius: 4, fontSize: 9, fontWeight: 800, marginRight: 6, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#334155" },
  sign: { fontSize: 8.5, color: "#475569", marginTop: 3, borderTop: "1px dashed #e2e8f0", paddingTop: 2 },
};

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const has = (v) => Array.isArray(v) ? v.length > 0 : !!str(v);
const fmtD = (v) => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? str(v) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); };
// A bare ObjectId is an unresolved ref, not a name — never print it.
const actor = (v) => (/^[0-9a-f]{24}$/i.test(str(v)) ? "" : str(v));
const itemsOf = (m) => Array.isArray(m.items)
  ? m.items.map((it) => (typeof it === "string" ? it : str(it.name || it.en))).filter(Boolean).join(", ")
  : str(m.items || m.name || m.en);

export default function FullDietSection({ file }) {
  const plans = (file?.dietPlans || []).filter((d) => d.full);
  if (!plans.length) return null;
  return (
    <>
      {plans.map((d, i) => {
        const x = d.full || {};
        const a = x.assessment || {};
        const p = x.plan || {};
        const allergens = [].concat(a.allergens || [], a.allergies || []).map(str).filter(Boolean);
        const meals = Array.isArray(p.meals) && p.meals.length ? p.meals : (Array.isArray(x.meals) ? x.meals : []);
        return (
          <div key={i} style={S.card}>
            <div style={S.title}>
              {str(p.templateName || d.templateName) || "Custom Diet Plan"}
              {has(x.status || d.status) ? ` · ${str(x.status || d.status).toUpperCase()}` : ""}
            </div>
            <div style={S.meta}>
              {[x.startDate ? `From ${fmtD(x.startDate)}` : "", x.endDate ? `to ${fmtD(x.endDate)}` : "",
                has(actor(d.assignedBy)) ? `Assigned by ${actor(d.assignedBy)}` : "",
                x.followUpAt ? `Review ${fmtD(x.followUpAt)}` : ""].filter(Boolean).join(" · ")}
            </div>
            {allergens.length > 0 && <div style={S.warn}>⚠ FOOD ALLERGENS: {allergens.join(", ")}</div>}
            {(has(a.height) || has(a.weight) || has(a.bmi) || has(a.conditions) || has(a.foodPreference)) && (
              <div style={{ margin: "3px 0" }}>
                {has(a.height) && <span style={S.chip}>Ht {a.height} cm</span>}
                {has(a.weight) && <span style={S.chip}>Wt {a.weight} kg</span>}
                {has(a.bmi) && <span style={S.chip}>BMI {a.bmi}</span>}
                {has(a.conditions) && <span style={S.chip}>{Array.isArray(a.conditions) ? a.conditions.join(", ") : str(a.conditions)}</span>}
                {has(a.foodPreference) && <span style={S.chip}>{str(a.foodPreference)}</span>}
              </div>
            )}
            {(has(p.targetCalories) || has(p.targetProtein) || has(p.fluidRestriction) || has(p.saltRestriction)) && (
              <div style={S.p}>
                <strong>Daily targets:</strong>{" "}
                {[has(p.targetCalories) ? `${p.targetCalories} kcal` : "",
                  has(p.targetProtein) ? `${p.targetProtein} g protein` : "",
                  has(p.fluidRestriction) ? `Fluid: ${str(p.fluidRestriction)}` : "",
                  has(p.saltRestriction) ? `Salt: ${str(p.saltRestriction)}` : ""].filter(Boolean).join(" · ")}
              </div>
            )}
            {meals.length > 0 && (
              <table style={S.tbl}>
                <thead><tr>{["Meal / Time", "Items", "Kcal", "Protein (g)", "Notes"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {meals.map((mm, j) => (
                    <tr key={j}>
                      <td style={S.td}><strong>{str(mm.time || mm.name || mm.en) || "—"}</strong>{has(mm.timeHi) ? <div style={{ fontSize: 8, color: "#64748b" }}>{str(mm.timeHi)}</div> : null}</td>
                      <td style={S.td}>{itemsOf(mm) || "—"}</td>
                      <td style={S.td}>{has(mm.calories) ? mm.calories : "—"}</td>
                      <td style={S.td}>{has(mm.protein) ? mm.protein : "—"}</td>
                      <td style={S.td}>{str(mm.notes) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {has(p.customisations) && <><div style={S.h}>Customisations</div><div style={S.p}>{Array.isArray(p.customisations) ? p.customisations.map(str).filter(Boolean).join("; ") : str(p.customisations)}</div></>}
            {has(p.instructions || x.instructions) && <><div style={S.h}>Instructions</div><div style={S.p}>{str(p.instructions || x.instructions)}</div></>}
            {has(p.notes || d.notes) && <><div style={S.h}>Dietitian Notes</div><div style={S.p}>{str(p.notes || d.notes)}</div></>}
            {has(x.followUpNotes) && <div style={S.sign}>Follow-up: {str(x.followUpNotes)}</div>}
          </div>
        );
      })}
    </>
  );
}
