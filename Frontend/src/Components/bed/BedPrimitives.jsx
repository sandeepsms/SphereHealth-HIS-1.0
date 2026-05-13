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
