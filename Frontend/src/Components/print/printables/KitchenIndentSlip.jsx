// Components/print/printables/KitchenIndentSlip.jsx
// ════════════════════════════════════════════════════════════════════
// R7bj-F2 — Kitchen Indent Slip (NABH COP.18). Single-meal tray slip
// the cook hands to the Ward Boy. Slug registration (F7 owns
// printables/index.js) — F7 will add:
//   "kitchen-indent-slip": { component: KitchenIndentSlip,
//                            title: "Kitchen Indent Slip",
//                            defaultPaper: "half-a4" }
//
// printCount drives the duplicate watermark via PrintShell (matches
// every other printable in the registry).
// ════════════════════════════════════════════════════════════════════

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const MEAL_LABEL = {
  EARLY_MORNING:   "Early Morning",
  BREAKFAST:       "Breakfast",
  MID_MORNING:     "Mid-Morning",
  LUNCH:           "Lunch",
  AFTERNOON_SNACK: "Afternoon Snack",
  DINNER:          "Dinner",
  BEDTIME:         "Bedtime",
  RT_FEED:         "RT Feed (tube)",
  OTHER:           "Other",
};

const fmtTime = (d) => d
  ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
  : "—";
const fmtDate = (d) => d
  ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "—";

export default function KitchenIndentSlip({ settings = {}, receipt = {} }) {
  const r = receipt || {};
  const printCount = toNum(r.printCount);
  const mealLabel  = MEAL_LABEL[r.mealSlot] || r.mealSlotLabel || r.mealSlot || "—";
  const allergens  = Array.isArray(r.allergens) ? r.allergens.filter(Boolean) : [];
  const items      = Array.isArray(r.items) ? r.items.filter(Boolean) : [];
  const contras    = Array.isArray(r.contraindications) ? r.contraindications.filter(Boolean) : [];

  return (
    <PrintShell
      settings={settings}
      documentTitle="Kitchen Indent Slip"
      serialNo={r.ipdNo || (r._id ? String(r._id).slice(-8).toUpperCase() : undefined)}
      printCount={printCount}
      infoItems={[
        { label: "Patient",     value: r.patientName || "—" },
        { label: "UHID",        value: r.UHID || r.uhid || "—" },
        { label: "IPD No",      value: r.ipdNo || "—" },
        { label: "Bed / Ward",  value: [r.bedNumber, r.ward].filter(Boolean).join(" · ") || "—" },
        { label: "Meal",        value: mealLabel },
        { label: "Scheduled",   value: fmtDate(r.scheduledFor) },
        { label: "Status",      value: r.status || "PENDING" },
        { label: "Food Pref.",  value: r.foodPreference || "—" },
      ]}
      signatureLabels={["Prepared By", "Served By / Ward Boy"]}
    >
      {/* ── Allergen banner — the entire point of the printed slip ── */}
      {allergens.length > 0 ? (
        <div style={{
          background: "#fef2f2",
          border: "2px solid #dc2626",
          borderRadius: 8,
          padding: "12px 14px",
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 11, color: "#7f1d1d", fontWeight: 700, letterSpacing: ".6px", textTransform: "uppercase", marginBottom: 4 }}>
            ⚠ Allergens — DO NOT SERVE
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#7f1d1d" }}>
            {allergens.join(" · ")}
          </div>
        </div>
      ) : (
        <div style={{
          background: "#f0fdf4",
          border: "1.5px solid #86efac",
          borderRadius: 8,
          padding: "8px 12px",
          marginBottom: 14,
          fontSize: 11,
          color: "#166534",
        }}>
          No allergens recorded for this patient.
        </div>
      )}

      {/* ── Meal items ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "#475569", fontWeight: 700, letterSpacing: ".4px", textTransform: "uppercase", marginBottom: 6 }}>
          Meal Items
        </div>
        {items.length > 0 ? (
          <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13, lineHeight: 1.7 }}>
            {items.map((it, i) => (<li key={i}>{it}</li>))}
          </ul>
        ) : (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>—</div>
        )}
      </div>

      {/* ── Nutritional targets ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 12 }}>
        {r.targetCalories != null && (
          <div style={{ background: "#f8fafc", padding: "6px 10px", borderRadius: 6, fontSize: 11 }}>
            <span style={{ color: "#64748b" }}>Calories: </span>
            <strong>{r.targetCalories} kcal</strong>
          </div>
        )}
        {r.targetProtein != null && (
          <div style={{ background: "#f8fafc", padding: "6px 10px", borderRadius: 6, fontSize: 11 }}>
            <span style={{ color: "#64748b" }}>Protein: </span>
            <strong>{r.targetProtein} g</strong>
          </div>
        )}
        {r.saltRestriction != null && (
          <div style={{ background: "#f8fafc", padding: "6px 10px", borderRadius: 6, fontSize: 11 }}>
            <span style={{ color: "#64748b" }}>Salt: </span>
            <strong>{r.saltRestriction} g</strong>
          </div>
        )}
        {r.fluidRestriction != null && (
          <div style={{ background: "#f8fafc", padding: "6px 10px", borderRadius: 6, fontSize: 11 }}>
            <span style={{ color: "#64748b" }}>Fluid: </span>
            <strong>{r.fluidRestriction} ml</strong>
          </div>
        )}
        {r.swallowingNote && r.swallowingNote !== "normal" && (
          <div style={{ background: "#fef3c7", padding: "6px 10px", borderRadius: 6, fontSize: 11, gridColumn: "span 2" }}>
            <span style={{ color: "#92400e", fontWeight: 700 }}>Swallowing: </span>
            <strong>{r.swallowingNote}</strong>
          </div>
        )}
      </div>

      {/* ── Contraindications + instructions ── */}
      {contras.length > 0 && (
        <div style={{ marginBottom: 12, fontSize: 11 }}>
          <strong style={{ color: "#92400e" }}>Avoid:</strong> {contras.join(", ")}
        </div>
      )}
      {r.instructions && (
        <div style={{ marginBottom: 12, fontSize: 11 }}>
          <strong style={{ color: "#475569" }}>Notes:</strong> {r.instructions}
        </div>
      )}

      {/* ── Served-at timestamp ── */}
      <div style={{
        marginTop: 18, paddingTop: 10, borderTop: "1.5px dashed #cbd5e1",
        display: "flex", gap: 18, fontSize: 11, color: "#475569", flexWrap: "wrap",
      }}>
        <div>
          <span style={{ color: "#64748b" }}>Prepared at: </span>
          <strong>{r.preparedAt ? fmtTime(r.preparedAt) : "—"}</strong>
          {r.preparedByName && <span style={{ marginLeft: 6 }}>by {r.preparedByName}</span>}
        </div>
        <div>
          <span style={{ color: "#64748b" }}>Served at: </span>
          <strong>{r.servedAt ? fmtTime(r.servedAt) : "—"}</strong>
          {r.servedByName && <span style={{ marginLeft: 6 }}>by {r.servedByName}</span>}
        </div>
        {r.deliveredAt && (
          <div>
            <span style={{ color: "#64748b" }}>Delivered at: </span>
            <strong>{fmtTime(r.deliveredAt)}</strong>
            {r.deliveredByName && <span style={{ marginLeft: 6 }}>by {r.deliveredByName}</span>}
          </div>
        )}
      </div>
    </PrintShell>
  );
}
