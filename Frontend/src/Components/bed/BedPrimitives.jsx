// Components/bed/BedPrimitives.jsx
// Shared lightweight presentational primitives used by every Bed
// Management section page. Naming matches the bed-mgmt.css class
// vocabulary (`bm-*`) so adoption is just import + use.

import React from "react";
import "./bed-mgmt.css";

export const BmStatStrip = ({ stats = [] }) => (
  <div className="bm-stat-strip">
    {stats.map((s, i) => (
      <div key={s.key || i} className={`bm-stat bm-stat--${s.tone || "slate"}`}>
        <div className="bm-stat__icon">
          <i className={`pi ${s.icon || "pi-chart-bar"}`} />
        </div>
        <div>
          <div className="bm-stat__val">{s.value}</div>
          <div className="bm-stat__lbl">{s.label}</div>
        </div>
      </div>
    ))}
  </div>
);

export const BmCard = ({ title, count, icon, action, children }) => (
  <div className="bm-card">
    {(title || action) && (
      <div className="bm-card__head">
        {title && (
          <div className="bm-card__title">
            {icon && <i className={`pi ${icon}`} />} {title}
            {count != null && <span className="bm-card__title-count">{count}</span>}
          </div>
        )}
        {action}
      </div>
    )}
    <div className="bm-card__body">{children}</div>
  </div>
);

export const BmFilter = ({ value, onChange, placeholder = "Search…" }) => (
  <div className="bm-filter">
    <i className="pi pi-search" />
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  </div>
);

export const BmEmpty = ({ icon = "pi-inbox", title, msg, ctaLabel, ctaIcon = "pi-plus", onCta }) => (
  <div className="bm-empty">
    <i className={`pi ${icon} bm-empty__icon`} />
    <div className="bm-empty__title">{title}</div>
    {msg && <div className="bm-empty__msg">{msg}</div>}
    {onCta && (
      <button type="button" className="bm-empty__cta" onClick={onCta}>
        <i className={`pi ${ctaIcon}`} /> {ctaLabel}
      </button>
    )}
  </div>
);

export const BmPill = ({ tone = "neutral", icon, children }) => (
  <span className={`bm-pill bm-pill--${tone}`}>
    {icon && <i className={`pi ${icon}`} />} {children}
  </span>
);

export const BmIconBtn = ({ icon, variant, onClick, title, disabled }) => (
  <button
    type="button"
    className={`bm-icon-btn ${variant ? "bm-icon-btn--" + variant : ""}`}
    onClick={onClick}
    title={title}
    disabled={disabled}
  >
    <i className={`pi ${icon}`} />
  </button>
);

/* ── Visualization helpers ─────────────────────────────────────── */

/**
 * Mini progress bar with threshold-driven color.
 * @param {Number} value      current value
 * @param {Number} max        total (used as denominator)
 * @param {String} tone       force a color: low / mid / high / info / purple
 * @param {Boolean} showLabel render "N / max · X%" next to the bar
 */
export const BmBar = ({ value = 0, max = 0, tone, showLabel = false, width = 80 }) => {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const auto = pct > 85 ? "high" : pct > 65 ? "mid" : "low";
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <div className="bm-bar" style={{ width }}>
        <div className={`bm-bar__fill bm-bar__fill--${tone || auto}`} style={{ width: `${pct}%` }} />
      </div>
      {showLabel && (
        <span style={{ fontSize: 11, color: "#475569", fontWeight: 700, whiteSpace: "nowrap" }}>
          {value}/{max} · {pct}%
        </span>
      )}
    </div>
  );
};

/**
 * Dot-row visual showing N beds: occupied/available/reserved/maintenance counts.
 * Pass `breakdown` as { occ, avail, reserved, maint, blocked } — renders that many dots.
 * Caps at `maxDots`; surplus becomes a "+N" chip.
 */
export const BmDots = ({ breakdown = {}, maxDots = 20 }) => {
  const order = ["occ", "reserved", "maint", "blocked", "avail"];
  const cls   = { occ: "occ", reserved: "reserved", maint: "maint", blocked: "blocked", avail: "avail" };
  const dots = [];
  let total = 0;
  for (const k of order) {
    const n = Number(breakdown[k] || 0);
    for (let i = 0; i < n && dots.length < maxDots; i++) dots.push(cls[k]);
    total += n;
  }
  const extra = total - dots.length;
  return (
    <div className="bm-dots">
      {dots.map((c, i) => <span key={i} className={`bm-dot bm-dot--${c}`} />)}
      {extra > 0 && (
        <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", marginLeft: 4 }}>+{extra}</span>
      )}
      {total === 0 && (
        <span style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>no beds</span>
      )}
    </div>
  );
};

export const BmChip = ({ icon, children }) => (
  <span className="bm-chip">{icon && <i className={`pi ${icon}`} />} {children}</span>
);

export const BmAvatar = ({ icon, tone = "slate", label }) => (
  <span className={`bm-avatar bm-avatar--${tone}`}>
    {icon ? <i className={`pi ${icon}`} /> : (label || "").slice(0, 1).toUpperCase()}
  </span>
);

export const BmCellStack = ({ avatar, title, sub }) => (
  <div className="bm-cell-stack">
    {avatar}
    <div>
      <div className="bm-cell-stack__main">{title}</div>
      {sub && <div className="bm-cell-stack__sub">{sub}</div>}
    </div>
  </div>
);

/** Price chip — renders ₹VALUE/unit nicely */
export const BmPrice = ({ value, unit = "day", cur = "₹" }) => (
  <span className="bm-price">
    <span className="bm-price__cur">{cur}</span>
    <span className="bm-price__val">{Number(value || 0).toLocaleString("en-IN")}</span>
    <span className="bm-price__unit">/ {unit}</span>
  </span>
);

export const BmClass = ({ value }) => (
  <span className={`bm-class bm-class--${value || "Standard"}`}>
    <i className="pi pi-star-fill" /> {value || "Standard"}
  </span>
);
