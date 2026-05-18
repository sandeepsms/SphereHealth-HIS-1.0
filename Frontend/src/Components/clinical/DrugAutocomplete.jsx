/**
 * DrugAutocomplete.jsx — shared drug-master typeahead for any place
 * a doctor types a medicine name in the HIS.
 *
 * Used by:
 *   • DoctorOrdersPanel  — IPD "Medication" order form
 *   • OPDAssessmentPage  — inline Prescription row
 *   • (Future) Discharge Summary medication list, MAR add-ad-hoc, etc.
 *
 * The component is intentionally form-shape agnostic — it doesn't
 * know whether the caller stores meds in a `form` object, a single
 * `newMed` state, or a row inside an array. The caller passes:
 *   value          current input string (controlled)
 *   onChange(str)  called on every keystroke
 *   onPick(drug)   called when the user clicks a dropdown row;
 *                  receives the full PharmacyDrug record so the
 *                  caller can mirror generic / strength / form
 *                  into whatever fields it cares about
 *
 * Backend contract: GET /api/pharmacy/drugs/search?q=<min 2 chars>
 *   returns { success, data: [{_id, name, genericName, strength,
 *             form, manufacturer, isHighAlert, isLASA, schedule}…] }
 *
 * Empty / no-match state still allows the doctor to keep typing
 * manually — never block prescription entry, because a brand-new
 * SKU might arrive before pharmacy admin updates the master.
 */
import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

/* Short prefix + colour per dosage form. Lets the doctor scan the
   dropdown by shape ("which one's the syrup?") before reading the
   name. Keys match the Drug model's `form` enum verbatim, so a new
   form value added on the backend just falls through to FORM_DEFAULT
   without breaking the layout. */
const FORM_BADGE = {
  Tablet:      { short: "TAB", bg: "#dbeafe", fg: "#1d4ed8" },
  Capsule:     { short: "CAP", bg: "#fef3c7", fg: "#a16207" },
  Syrup:       { short: "SYP", bg: "#fce7f3", fg: "#be185d" },
  Injection:   { short: "INJ", bg: "#fee2e2", fg: "#b91c1c" },
  Drops:       { short: "DRP", bg: "#e0f2fe", fg: "#0369a1" },
  Cream:       { short: "CRM", bg: "#fef9c3", fg: "#854d0e" },
  Ointment:    { short: "OIN", bg: "#fef9c3", fg: "#854d0e" },
  Inhaler:     { short: "INH", bg: "#dcfce7", fg: "#15803d" },
  Patch:       { short: "PAT", bg: "#ede9fe", fg: "#6d28d9" },
  Powder:      { short: "PWD", bg: "#f3e8ff", fg: "#7e22ce" },
  Suppository: { short: "SUP", bg: "#ffe4e6", fg: "#9f1239" },
};
const FORM_DEFAULT = { short: "RX",  bg: "#f1f5f9", fg: "#475569" };
const formBadge = (form) => FORM_BADGE[form] || FORM_DEFAULT;

/* Doctor-friendly short prefix written INTO the prescription text
   when an autocomplete row is picked. Matches Indian Rx convention:
   "Tab Paracetamol 500mg", "Cap Amoxicillin 500mg", "Syp Crocin 60ml".
   Forms that don't have a customary abbreviation use the full word
   (Cream / Inhaler / Drops). Empty for "Other" / unknown so we don't
   prepend noise like "Other Whatever". */
export const FORM_PREFIX = {
  Tablet:      "Tab",
  Capsule:     "Cap",
  Syrup:       "Syp",
  Injection:   "Inj",
  Drops:       "Drops",
  Cream:       "Cream",
  Ointment:    "Oint",
  Inhaler:     "Inhaler",
  Patch:       "Patch",
  Powder:      "Powder",
  Suppository: "Supp",
  Other:       "",
};

/* Canonical display name for a drug — used both by the dropdown
   row label and (more importantly) by the value written into the
   prescription form when the doctor picks a row. Keeps the on-screen
   text identical to what gets stored, which the audit log / print
   receipt then consumes verbatim.

   Example outputs:
     {form:"Tablet", name:"Paracetamol 500mg"}  → "Tab Paracetamol 500mg"
     {form:"Cream",  name:"Mupirocin 2%"}       → "Cream Mupirocin 2%"
     {form:"Other",  name:"Custom Compound"}    → "Custom Compound"
     {              name:"Just A Name"}         → "Just A Name"          */
export function drugDisplayName(drug) {
  if (!drug || !drug.name) return "";
  const px = drug.form ? (FORM_PREFIX[drug.form] ?? drug.form) : "";
  return px ? `${px} ${drug.name}` : drug.name;
}

export default function DrugAutocomplete({
  label,
  value,
  onChange,
  onPick,
  placeholder = "Start typing — e.g. Amox, Paracet, Aug…",
  // Optional cosmetic overrides — defaults match the his-* theme but
  // pages with their own input styling can pass `useInlineStyle` and
  // bring their own classes via inputClassName.
  inputClassName = "his-field",
  inputStyle,
  showLabel = true,
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const debRef = useRef(null);
  const inputRef = useRef(null);
  // Portal-rendered dropdown needs absolute viewport coordinates,
  // recomputed whenever the input moves (scroll, resize, focus).
  // Tracking left/top/width separately so we can also widen the
  // dropdown beyond the input's narrow grid cell.
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });
  const val = value ?? "";

  // Recompute dropdown position whenever it's open, on scroll, and
  // on resize. Using getBoundingClientRect → coords relative to the
  // viewport → matches `position: fixed` rendering in the portal.
  useEffect(() => {
    if (!open) return;
    const recalc = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    recalc();
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
    };
  }, [open]);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    const q = (val || "").trim();
    if (q.length < 2) { setResults([]); return; }
    const ac = new AbortController();
    debRef.current = setTimeout(async () => {
      setBusy(true);
      try {
        const { data } = await axios.get(
          `${API_ENDPOINTS.BASE}/pharmacy/drugs/search`,
          { params: { q }, signal: ac.signal },
        );
        if (!ac.signal.aborted) setResults(data?.data || []);
      } catch (e) {
        if (!axios.isCancel(e)) console.warn("[DrugAutocomplete]", e?.message);
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    }, 200);
    return () => { ac.abort(); if (debRef.current) clearTimeout(debRef.current); };
  }, [val]);

  const handlePick = (drug) => {
    if (typeof onPick === "function") onPick(drug);
    setOpen(false);
    setResults([]);
  };

  return (
    <div style={{ position: "relative" }}>
      {showLabel && label && <label className="his-label">{label}</label>}
      <input
        ref={inputRef}
        className={inputClassName}
        style={inputStyle}
        type="text"
        placeholder={placeholder}
        value={val}
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange && onChange(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        autoComplete="off"
      />
      {open && (results.length > 0 || busy || val.trim().length >= 2) && createPortal(
        <div style={{
          // Portal-rendered at <body> root so the dropdown escapes any
          // ancestor `overflow: hidden` (the Prescription Card on
          // /opd-assessment was clipping it to ~3 rows even though 14
          // results were returned). `position: fixed` + computed
          // input-bound coords keep it visually attached to the input
          // while scrolling. min/max width still apply so it stays
          // wider than the 200px input cell but caps at 92vw.
          position: "fixed",
          left: pos.left,
          top: pos.top,
          zIndex: 9000,
          minWidth: Math.max(pos.width, 520),
          maxWidth: "min(720px, 92vw)",
          width: "max-content",
          maxHeight: "min(440px, 60vh)", overflowY: "auto",
          background: "#fff", border: "1px solid #cbd5e1", borderRadius: 10,
          boxShadow: "0 12px 30px rgba(15,23,42,.18)",
        }}>
          {busy && results.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: "#64748b" }}>
              <i className="pi pi-spin pi-spinner" /> Searching pharmacy master…
            </div>
          )}
          {results.map((d) => {
            const fb = formBadge(d.form);
            return (
              <button
                key={d._id}
                type="button"
                onMouseDown={() => handlePick(d)}
                style={{
                  // Compact row: 5-line ratio per user — 5 medicines must
                  // fit without scrolling. Total row height now ~36-40px
                  // (4-5 rows in the previous 280px = 1 row each every
                  // 70px). Padding cut from 10px → 5px; fonts dropped a
                  // tier; badge shrunk from 46x26 → 36x18 — still legible
                  // but no longer the visual anchor.
                  display: "flex", width: "100%", textAlign: "left",
                  padding: "5px 10px", border: 0, gap: 8,
                  borderBottom: "1px solid #f1f5f9", background: "#fff",
                  cursor: "pointer", fontFamily: "inherit",
                  alignItems: "center",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#eff6ff")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
              >
                {/* Form prefix badge — left-aligned so the doctor reads
                    SHAPE before NAME (TAB Paracetamol vs SYP Paracetamol).
                    Coloured per FORM_BADGE map so the dropdown is also
                    visually scannable by colour. */}
                <span style={{
                  flexShrink: 0,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 36, height: 18,
                  background: fb.bg, color: fb.fg,
                  borderRadius: 4, fontWeight: 800, fontSize: 10,
                  letterSpacing: 0.4, fontFamily: "'DM Mono', monospace",
                }}>
                  {fb.short}
                </span>
                <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, color: "#0f172a", fontSize: 12 }}>
                      {d.form ? `${d.form} ` : ""}{d.name}
                    </span>
                    {d.strength && (
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#0369a1", fontWeight: 700 }}>
                        {d.strength}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>
                    {d.genericName && (
                      <span>
                        Generic: <strong>{d.genericName}</strong>
                      </span>
                    )}
                    {d.genericName && d.manufacturer && " · "}
                    {d.manufacturer && <span>{d.manufacturer}</span>}
                    {d.isHighAlert && (
                      <span style={{ marginLeft: 5, color: "#b91c1c", fontWeight: 700 }}>
                        ⚠ HIGH-ALERT
                      </span>
                    )}
                    {d.isLASA && (
                      <span style={{ marginLeft: 5, color: "#c2410c", fontWeight: 700 }}>
                        LASA
                      </span>
                    )}
                    {d.schedule && d.schedule !== "OTC" && (
                      <span style={{ marginLeft: 5, fontWeight: 700, color: "#7c3aed" }}>
                        Sch-{d.schedule}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
          {!busy && results.length === 0 && val.trim().length >= 2 && (
            <div style={{ padding: 12, fontSize: 12, color: "#94a3b8" }}>
              No drug found — you can still type the name manually.
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * Best-effort parse of a strength string like "500 mg" / "5 mg/5 mL"
 * into a numeric value + unit. Exposed for callers that want to
 * pre-fill a separate dose / unit pair without reimplementing this.
 *
 * Returns { value: Number | null, unit: String | null }.
 */
export function parseStrength(strength) {
  if (!strength) return { value: null, unit: null };
  const m = String(strength).match(/^\s*([\d.]+)\s*([a-zA-Z/%μ]+)?/);
  if (!m) return { value: null, unit: null };
  return { value: Number(m[1]) || null, unit: m[2] || null };
}
