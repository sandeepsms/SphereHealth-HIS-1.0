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
  const val = value ?? "";

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
      {open && (results.length > 0 || busy || val.trim().length >= 2) && (
        <div style={{
          // Wider + taller per user feedback. minWidth lets the dropdown
          // spill beyond a narrow input cell (e.g. the Prescription row
          // on /opd-assessment has a 2fr column ≈ 200px; doctor wants to
          // read the full drug name). Capped at 92vw so we still fit on
          // a laptop screen. Height ~50% of viewport so most relevant
          // matches fit without scrolling.
          position: "absolute", top: "100%", left: 0, zIndex: 50,
          marginTop: 4,
          minWidth: 520,
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
                  display: "flex", width: "100%", textAlign: "left",
                  padding: "10px 12px", border: 0, gap: 12,
                  borderBottom: "1px solid #f1f5f9", background: "#fff",
                  cursor: "pointer", fontFamily: "inherit",
                  alignItems: "flex-start",
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
                  width: 46, height: 26,
                  background: fb.bg, color: fb.fg,
                  borderRadius: 6, fontWeight: 800, fontSize: 11,
                  letterSpacing: 0.5, fontFamily: "'DM Mono', monospace",
                  marginTop: 1,
                }}>
                  {fb.short}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, color: "#0f172a", fontSize: 14 }}>
                      {d.form ? `${d.form} ` : ""}{d.name}
                    </span>
                    {d.strength && (
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#0369a1", fontWeight: 700 }}>
                        {d.strength}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
                    {d.genericName && (
                      <span>
                        Generic: <strong>{d.genericName}</strong>
                      </span>
                    )}
                    {d.genericName && d.manufacturer && " · "}
                    {d.manufacturer && <span>{d.manufacturer}</span>}
                    {d.isHighAlert && (
                      <span style={{ marginLeft: 6, color: "#b91c1c", fontWeight: 700 }}>
                        ⚠ HIGH-ALERT
                      </span>
                    )}
                    {d.isLASA && (
                      <span style={{ marginLeft: 6, color: "#c2410c", fontWeight: 700 }}>
                        LASA
                      </span>
                    )}
                    {d.schedule && d.schedule !== "OTC" && (
                      <span style={{ marginLeft: 6, fontWeight: 700, color: "#7c3aed" }}>
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
        </div>
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
