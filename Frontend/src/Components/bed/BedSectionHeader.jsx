// Components/bed/BedSectionHeader.jsx
// Shared Bed Management section header — gives every page in the
// group (/bed-visual, /beds, /wards, /rooms, /roomcategory, /floors,
// /buildings, /bed-transfers, /bed-reports/monthly) the same slate
// gradient chrome, title styling, "Back to Bed Management" pill,
// and a slot for per-page actions.
//
// Theme tokens are pulled from the Sidebar's "beds" group
// (color: #475569 / light: #f8fafc) so the visual identity matches
// what shows in the sidebar pill.

import React from "react";
import { useNavigate, useLocation } from "react-router-dom";

const ACCENT_BY_SECTION = {
  // Each route gets a subtle accent override so the user can tell
  // sections apart inside the same group. Slate is the default.
  "/bed-dashboard":       { tint: "#0f172a", to: "#1e293b" },
  "/bed-visual":          { tint: "#0d9488", to: "#115e59" },
  "/beds":                { tint: "#475569", to: "#1e293b" },
  "/wards":               { tint: "#2563eb", to: "#1e40af" },
  "/rooms":               { tint: "#7c3aed", to: "#5b21b6" },
  "/roomcategory":        { tint: "#db2777", to: "#9d174d" },
  "/floors":              { tint: "#ea580c", to: "#9a3412" },
  "/buildings":           { tint: "#0891b2", to: "#0e7490" },
  "/bed-transfers":       { tint: "#7c3aed", to: "#5b21b6" },
  "/bed-reports/monthly": { tint: "#0d9488", to: "#115e59" },
};
const DEFAULT_ACCENT = { tint: "#475569", to: "#1e293b" };

/**
 * @param {Object}  props
 * @param {String}  props.title         Section title — e.g. "Manage Beds"
 * @param {String}  props.subtitle      One-line description below the title
 * @param {String}  props.icon          PrimeIcons class — e.g. "pi-list"
 * @param {Node}    props.actions       Right-side action buttons (search, +Add, etc.)
 * @param {Boolean} props.hideBack      Hide the "Back to Bed Management" pill (used on the hub itself)
 */
const BedSectionHeader = ({ title, subtitle, icon = "pi-th-large", actions, hideBack = false }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const accent   = ACCENT_BY_SECTION[location.pathname] || DEFAULT_ACCENT;

  return (
    <div
      style={{
        background: `linear-gradient(135deg, ${accent.tint}, ${accent.to})`,
        borderRadius: 14,
        padding: "16px 22px",
        color: "white",
        display: "flex",
        flexWrap: "wrap",
        gap: 14,
        alignItems: "center",
        marginBottom: 18,
        boxShadow: `0 6px 22px ${accent.tint}40`,
      }}
    >
      {/* Back-to-hub pill */}
      {!hideBack && (
        <button
          type="button"
          onClick={() => navigate("/bed-dashboard")}
          title="Back to Bed Management"
          style={{
            background: "rgba(255,255,255,.18)",
            border: "1px solid rgba(255,255,255,.35)",
            color: "white",
            borderRadius: 999,
            padding: "5px 13px 5px 10px",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontFamily: "inherit",
          }}
        >
          <i className="pi pi-arrow-left" style={{ fontSize: 10 }} />
          Bed Management
        </button>
      )}

      {/* Icon + title block */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 240 }}>
        <div
          style={{
            width: 42, height: 42, borderRadius: 11,
            background: "rgba(255,255,255,.18)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <i className={`pi ${icon}`} style={{ fontSize: 19 }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: ".3px", lineHeight: 1.1 }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ fontSize: 11, opacity: .85, marginTop: 3 }}>{subtitle}</div>
          )}
        </div>
      </div>

      {/* Page-specific actions on the right */}
      {actions && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {actions}
        </div>
      )}
    </div>
  );
};

export default BedSectionHeader;
