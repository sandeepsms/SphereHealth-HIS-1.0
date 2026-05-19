/**
 * ServiceAutocomplete.jsx — typeahead over the hospital ServiceMaster
 * (lab tests, imaging, procedures, consumables, room types, packages).
 *
 * Mirrors the structure of DrugAutocomplete (portal-rendered dropdown
 * with form prefix on each row) so the doctor's muscle memory carries
 * between the prescription + service rows on /opd-assessment.
 *
 * Backend contract: GET /api/services?search=<min 2 chars>&isActive=true
 *   returns { success, services: [{_id, serviceCode, serviceName,
 *             category, domain, billingType, defaultPrice, applicableTo}…] }
 * On pick, the caller receives the full ServiceMaster doc and can
 * mirror code / category / price into whatever fields they care about.
 */
import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { API_ENDPOINTS } from "../../config/api";

/* Short prefix + colour per service category. Same visual language
   as DrugAutocomplete — the doctor sees TYPE first, name second. */
const CATEGORY_BADGE = {
  CONSULTATION: { short: "CON", bg: "#dbeafe", fg: "#1d4ed8" },
  ROOM:         { short: "BED", bg: "#ede9fe", fg: "#6d28d9" },
  NURSING:      { short: "NRS", bg: "#fce7f3", fg: "#be185d" },
  LAB:          { short: "LAB", bg: "#fef9c3", fg: "#854d0e" },
  RADIOLOGY:    { short: "RAD", bg: "#ffe4e6", fg: "#9f1239" },
  IMAGING:      { short: "IMG", bg: "#ffe4e6", fg: "#9f1239" },
  PROCEDURE:    { short: "PRC", bg: "#fed7aa", fg: "#c2410c" },
  SURGERY:      { short: "SUR", bg: "#fecaca", fg: "#b91c1c" },
  PHYSIOTHERAPY:{ short: "PHY", bg: "#dcfce7", fg: "#15803d" },
  CONSUMABLE:   { short: "CON", bg: "#e0f2fe", fg: "#0369a1" },
  EQUIPMENT:    { short: "EQP", bg: "#f3e8ff", fg: "#7e22ce" },
  PACKAGE:      { short: "PKG", bg: "#fef3c7", fg: "#a16207" },
  SUPPORT:      { short: "SUP", bg: "#e0e7ff", fg: "#4338ca" },
  EMERGENCY:    { short: "ER",  bg: "#fee2e2", fg: "#b91c1c" },
};
const CATEGORY_DEFAULT = { short: "SVC", bg: "#f1f5f9", fg: "#475569" };
const catBadge = (cat) => CATEGORY_BADGE[cat] || CATEGORY_DEFAULT;

const fmtPrice = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function ServiceAutocomplete({
  label,
  value,
  onChange,
  onPick,
  applicableTo,       // optional — restricts search to e.g. "OPD" / "IPD"
  placeholder = "Search service / test / procedure…",
  inputClassName = "his-field",
  inputStyle,
  showLabel = true,
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const debRef = useRef(null);
  const inputRef = useRef(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });
  const val = value ?? "";

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
        const params = { search: q, isActive: "true", limit: 25 };
        if (applicableTo) params.applicableTo = applicableTo;
        const { data } = await axios.get(
          `${API_ENDPOINTS.BASE}/services`,
          { params, signal: ac.signal },
        );
        if (ac.signal.aborted) return;
        // ServiceMaster `$text` index search returns ranked results.
        // Fall back to a client-side `name contains q` if Mongo text
        // index isn't built yet (the field-mode response shape stays
        // the same).
        const rows = data?.services || data?.data || [];
        setResults(Array.isArray(rows) ? rows : []);
      } catch (e) {
        if (!axios.isCancel(e)) console.warn("[ServiceAutocomplete]", e?.message);
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    }, 200);
    return () => { ac.abort(); if (debRef.current) clearTimeout(debRef.current); };
  }, [val, applicableTo]);

  const handlePick = (svc) => {
    if (typeof onPick === "function") onPick(svc);
    setOpen(false);
    setResults([]);
  };

  return (
    <div style={{ position: "relative", width: "100%", minWidth: 0 }}>
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
              <i className="pi pi-spin pi-spinner" /> Searching services…
            </div>
          )}
          {results.map((s) => {
            const cb = catBadge(s.category);
            const price = s.defaultPrice ?? s.priceCash ?? s.price;
            return (
              <button
                key={s._id}
                type="button"
                onMouseDown={() => handlePick(s)}
                style={{
                  display: "flex", width: "100%", textAlign: "left",
                  padding: "5px 10px", border: 0, gap: 8,
                  borderBottom: "1px solid #f1f5f9", background: "#fff",
                  cursor: "pointer", fontFamily: "inherit",
                  alignItems: "center",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#eff6ff")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
              >
                <span style={{
                  flexShrink: 0,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 36, height: 18,
                  background: cb.bg, color: cb.fg,
                  borderRadius: 4, fontWeight: 800, fontSize: 10,
                  letterSpacing: 0.4, fontFamily: "'DM Mono', monospace",
                }}>
                  {cb.short}
                </span>
                <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, color: "#0f172a", fontSize: 12 }}>
                      {s.serviceName}
                    </span>
                    {s.serviceCode && (
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#94a3b8" }}>
                        {s.serviceCode}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 1, display: "flex", gap: 6, alignItems: "center" }}>
                    <span>{s.category}</span>
                    {s.billingType && <span>· {s.billingType}</span>}
                    {s.applicableTo?.length && <span>· {(Array.isArray(s.applicableTo) ? s.applicableTo : [s.applicableTo]).join("/")}</span>}
                  </div>
                </div>
                {price != null && (
                  <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 800, fontSize: 12, color: "#047857", flexShrink: 0 }}>
                    {fmtPrice(price)}
                  </span>
                )}
              </button>
            );
          })}
          {!busy && results.length === 0 && val.trim().length >= 2 && (
            <div style={{ padding: 12, fontSize: 12, color: "#94a3b8" }}>
              No service found — you can still type the name manually.
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
