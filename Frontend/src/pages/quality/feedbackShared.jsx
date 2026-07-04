/**
 * feedbackShared.jsx — shared UI for the patient-feedback module.
 * Used by both the staff entry page (PatientFeedbackPage) and the public,
 * no-login patient page (PublicFeedbackPage) so the rating experience is
 * identical whoever fills it in.
 */
import React from "react";

// Service categories the patient rates. Order + keys MUST match the backend
// RATING_KEYS (models/Quality/PatientFeedbackModel.js).
export const CATEGORY_META = [
  { key: "doctor",      label: "Doctors",              icon: "pi-user-edit" },
  { key: "nursing",     label: "Nursing care",         icon: "pi-heart" },
  { key: "cleanliness", label: "Cleanliness & hygiene", icon: "pi-sparkles" },
  { key: "food",        label: "Food & diet",          icon: "pi-apple" },
  { key: "billing",     label: "Billing & admin",      icon: "pi-receipt" },
  { key: "facilities",  label: "Facilities & comfort",  icon: "pi-building" },
  { key: "overall",     label: "Overall experience",   icon: "pi-star", emphasise: true },
];

export const emptyRatings = () =>
  CATEGORY_META.reduce((o, c) => { o[c.key] = 0; return o; }, {});

/* ── One row of 1-5 stars ─────────────────────────────────────────── */
export function StarRating({ value = 0, onChange, size = 30, readOnly = false }) {
  return (
    <div style={{ display: "inline-flex", gap: 4 }} role="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          onClick={() => !readOnly && onChange?.(n === value ? 0 : n)}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          aria-checked={n === value}
          role="radio"
          style={{
            background: "none", border: "none", padding: 0, lineHeight: 1,
            cursor: readOnly ? "default" : "pointer",
            fontSize: size, color: n <= value ? "#f59e0b" : "#d1d5db",
            transition: "transform .1s, color .12s",
          }}
          onMouseEnter={(e) => { if (!readOnly) e.currentTarget.style.transform = "scale(1.18)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}
        >
          <i className={n <= value ? "pi pi-star-fill" : "pi pi-star"} />
        </button>
      ))}
    </div>
  );
}

/* ── The full category-ratings block ──────────────────────────────── */
export function CategoryRatings({ ratings, setRating, compact = false }) {
  return (
    <div style={{ display: "grid", gap: compact ? 10 : 14 }}>
      {CATEGORY_META.map((c) => (
        <div
          key={c.key}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 12, flexWrap: "wrap",
            padding: c.emphasise ? "12px 14px" : "6px 2px",
            borderRadius: c.emphasise ? 12 : 0,
            background: c.emphasise ? "#eef2ff" : "transparent",
            border: c.emphasise ? "1px solid #c7d2fe" : "none",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontWeight: c.emphasise ? 800 : 600, color: "#1e293b", fontSize: c.emphasise ? 15 : 14 }}>
            <i className={`pi ${c.icon}`} style={{ color: "#4338ca", fontSize: 16 }} />
            {c.label}
          </span>
          <StarRating value={ratings[c.key] || 0} onChange={(v) => setRating(c.key, v)} size={c.emphasise ? 32 : 26} />
        </div>
      ))}
    </div>
  );
}

/* ── NPS 0-10 "would you recommend us" scale ──────────────────────── */
export function NpsScale({ value, onChange }) {
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {Array.from({ length: 11 }, (_, n) => {
          const active = value === n;
          const tint = n <= 6 ? "#dc2626" : n <= 8 ? "#d97706" : "#16a34a";
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(active ? null : n)}
              style={{
                width: 38, height: 38, borderRadius: 9, cursor: "pointer",
                fontWeight: 800, fontSize: 14,
                border: active ? `2px solid ${tint}` : "1px solid #e2e8f0",
                background: active ? tint : "#fff",
                color: active ? "#fff" : "#334155",
                transition: "transform .1s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 11, color: "#94a3b8" }}>
        <span>Not at all likely</span>
        <span>Extremely likely</span>
      </div>
    </div>
  );
}

/* ── Free-text "went well" + "improve" boxes ──────────────────────── */
export function FeedbackTextFields({ wentWell, improvements, setField }) {
  const boxStyle = {
    width: "100%", minHeight: 74, padding: "10px 12px", borderRadius: 10,
    border: "1px solid #e2e8f0", fontSize: 14, fontFamily: "inherit", resize: "vertical",
  };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ fontWeight: 600, color: "#1e293b", fontSize: 14 }}>
        What went well? <span style={{ color: "#94a3b8", fontWeight: 400 }}>(optional)</span>
        <textarea style={boxStyle} value={wentWell} maxLength={4000}
          onChange={(e) => setField("wentWell", e.target.value)}
          placeholder="Anything you appreciated about your visit…" />
      </label>
      <label style={{ fontWeight: 600, color: "#1e293b", fontSize: 14 }}>
        What can we improve? <span style={{ color: "#94a3b8", fontWeight: 400 }}>(optional)</span>
        <textarea style={boxStyle} value={improvements} maxLength={4000}
          onChange={(e) => setField("improvements", e.target.value)}
          placeholder="Tell us how we could have served you better…" />
      </label>
    </div>
  );
}
