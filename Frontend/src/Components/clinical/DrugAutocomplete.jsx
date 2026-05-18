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
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          marginTop: 4, maxHeight: 280, overflowY: "auto",
          background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8,
          boxShadow: "0 10px 24px rgba(15,23,42,.12)",
        }}>
          {busy && results.length === 0 && (
            <div style={{ padding: 10, fontSize: 12, color: "#64748b" }}>
              <i className="pi pi-spin pi-spinner" /> Searching pharmacy master…
            </div>
          )}
          {results.map((d) => (
            <button
              key={d._id}
              type="button"
              onMouseDown={() => handlePick(d)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "8px 10px", border: 0,
                borderBottom: "1px solid #f1f5f9", background: "#fff",
                cursor: "pointer", fontFamily: "inherit",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#eff6ff")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontWeight: 700, color: "#0f172a", fontSize: 13 }}>
                  {d.name}
                  {d.strength ? ` · ${d.strength}` : ""}
                </span>
                {d.form && (
                  <span style={{ fontSize: 10, color: "#0e7490", background: "#ecfeff", padding: "1px 8px", borderRadius: 999, fontWeight: 700 }}>
                    {d.form}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
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
            </button>
          ))}
          {!busy && results.length === 0 && val.trim().length >= 2 && (
            <div style={{ padding: 10, fontSize: 12, color: "#94a3b8" }}>
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
