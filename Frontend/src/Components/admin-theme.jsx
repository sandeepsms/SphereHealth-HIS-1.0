/**
 * admin-theme.jsx — shared design-system primitives for the admin /
 * management pages (Pharmacy, Departments, Doctors, Hospital Charges,
 * Settings, Suppliers, etc.).
 *
 * Lifted from PharmacyHomePage.jsx so every admin page renders with
 * the same hero band + tab strip + KPI cards + Card sections + Table
 * + Modal + Field primitives without duplication.
 *
 * USAGE
 *   import { C, Hero, Card, KPI, Table, EmptyRow, RowAction, Modal,
 *            Field, AdminPage } from "../../Components/admin-theme";
 *
 *   <AdminPage>
 *     <Hero icon="pi-building" title="Department Management"
 *           subtitle="Manage hospital departments and their services"
 *           color="orange" />
 *     <Card title="All Departments" color={C.orange} icon="pi-list">
 *       <Table cols={["Code","Name","Category","Status","Action"]}>
 *         …rows
 *       </Table>
 *     </Card>
 *   </AdminPage>
 */
import React from "react";
import { createPortal } from "react-dom";
import { AnimatedCounter } from "./anim/AnimKit"; // R7hr-276 — count-up KPI numbers

export const C = {
  bg: "#f8fafc", card: "#fff", border: "#e2e8f0",
  text: "#0f172a", muted: "#64748b", subtle: "#f8fafc",
  amber: "#d97706", amberL: "#fffbeb",
  blue: "#4338ca", blueL: "#eef2ff",
  green: "#16a34a", greenL: "#dcfce7",
  red: "#dc2626", redL: "#fef2f2",
  purple: "#7c3aed", purpleL: "#f5f3ff",
  pink: "#db2777", pinkL: "#fdf2f8",
  teal: "#0d9488", tealL: "#f0fdfa",
  orange: "#ea580c", orangeL: "#fff7ed",
  slate: "#475569",
};

// Mapping for the Hero — pass a colour name and we look up the gradient pair.
const HERO_GRADIENTS = {
  orange: ["#ea580c", "#c2410c"],
  teal:   ["#0d9488", "#0f766e"],
  blue:   ["#4f46e5", "#3730a3"],
  purple: ["#7c3aed", "#5b21b6"],
  green:  ["#16a34a", "#15803d"],
  pink:   ["#db2777", "#9d174d"],
  amber:  ["#d97706", "#b45309"],
};

export function AdminPage({ children, maxWidth = 1600 }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: 20, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

export function Hero({ icon, title, subtitle, color = "orange", right, logo }) {
  const [from, to] = HERO_GRADIENTS[color] || HERO_GRADIENTS.orange;
  return (
    <div style={{
      background: `linear-gradient(135deg, ${from}, ${to})`,
      borderRadius: 14, padding: "16px 22px", marginBottom: 16,
      color: "#fff", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
      boxShadow: `0 4px 14px ${from}40`,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: logo ? "#fff" : "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.32)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden",
      }}>
        {/* R7hr-329 — show the hospital/BIMS logo in the hero badge when a
            `logo` src is passed (dashboards); otherwise the contextual icon. */}
        {logo
          ? <img src={logo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", padding: 5 }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
          : <i className={`pi ${icon}`} style={{ fontSize: 22 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.2px" }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, opacity: .85, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}

// Optional tab strip — same look as the pharmacy module's nav.
// Modern segmented-pill tab strip.
//
// Design decisions:
// - Track background with subtle inner shadow ("inset") so the
//   container reads as a control rather than a generic card.
// - Active pill carries a soft drop shadow + accent-tinted background
//   + accent left-side icon dot → unambiguous active state without
//   being loud.
// - Inactive tabs are muted text only. On hover they pick up a faint
//   gray pill so the click target reads clearly.
// - 220ms cubic-bezier transition on all pill properties so switching
//   between tabs feels animated without being slow.
// - Optional badge prop per tab (`{ key, label, icon, badge, badgeTone }`)
//   renders a small count pill — colour driven by `badgeTone`:
//     "idle"    → green calm dot (no pending work)
//     "normal"  → blue (some pending work, nothing urgent)
//     "warn"    → amber (Urgent-priority pending work)
//     "urgent"  → red + soft pulse (STAT or stale work — demands attention)
//   Default tone is "idle" so the pill is always visible (R7-style "always
//   resonant" badge) but doesn't scream when there's nothing to act on.
// - Mobile: horizontal scroll with snap; tabs never wrap.

// Tone → background colour. Active tab still wins (accent colour) when
// the tab itself is selected, but inactive tabs honour the tone so the
// receptionist/pharmacist sees urgency at a glance even from another tab.
const BADGE_TONE_BG = {
  idle:   "#10b981", // emerald — calm "all clear"
  normal: "#4f46e5", // blue — work in queue
  warn:   "#d97706", // amber — urgent (non-STAT)
  urgent: "#dc2626", // red — STAT / stuck — demands attention
};

// One-time injection of the pulse keyframes. Idempotent so HMR / multi-mount
// doesn't duplicate the <style> tag. Inline-style is the codebase convention
// (R1 only restricts Reception pages, not Components).
let _badgePulseInjected = false;
function ensureBadgePulseKeyframes() {
  if (_badgePulseInjected || typeof document === "undefined") return;
  const id = "admin-theme-badge-pulse";
  if (document.getElementById(id)) { _badgePulseInjected = true; return; }
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    @keyframes adminBadgePulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, .55); transform: scale(1); }
      50%      { box-shadow: 0 0 0 6px rgba(220, 38, 38, 0);  transform: scale(1.08); }
    }
  `;
  document.head.appendChild(style);
  _badgePulseInjected = true;
}

export function TabStrip({ tabs, value, onChange, accent = C.orange, accentL = C.orangeL }) {
  // Mount-once side effect (cheap — guarded by module flag).
  if (typeof document !== "undefined") ensureBadgePulseKeyframes();
  return (
    <div role="tablist" style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: 5,
      marginBottom: 14,
      display: "flex",
      gap: 3,
      overflowX: "auto",
      scrollSnapType: "x proximity",
      boxShadow: "inset 0 1px 2px rgba(15,23,42,.03)",
    }}>
      {tabs.map(t => {
        // Tab identity comes from either `id` (used by newer pages —
        // Accounts / Dietician) or `key` (legacy pages — Pharmacy /
        // Hospital Settings). Without this fallback, newer pages never
        // matched `value === t.key` → no tab ever appeared active and
        // onChange(undefined) silently broke the controlled state.
        const tabId = t.id ?? t.key;
        const active = value === tabId;
        return (
          <button key={tabId}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tabId)}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#f1f5f9"; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
            style={{
              position: "relative",
              padding: "9px 16px",
              borderRadius: 9,
              border: "none",
              background: active ? "#fff" : "transparent",
              color: active ? accent : C.muted,
              fontWeight: active ? 800 : 700,
              fontSize: 12.5,
              letterSpacing: ".1px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              whiteSpace: "nowrap",
              flexShrink: 0,
              scrollSnapAlign: "start",
              transition: "background .22s cubic-bezier(.4,0,.2,1), color .18s, box-shadow .22s, transform .12s",
              boxShadow: active
                ? `0 1px 0 ${accent}, 0 1px 3px rgba(15,23,42,.10), 0 4px 14px ${accent}26`
                : "none",
              outline: "none",
            }}
            onFocus={(e) => { e.currentTarget.style.outline = `2px solid ${accent}55`; e.currentTarget.style.outlineOffset = "2px"; }}
            onBlur={(e) => { e.currentTarget.style.outline = "none"; }}
          >
            {/* Coloured dot on the icon when active for instant visual scan */}
            <span style={{
              width: 18, height: 18, borderRadius: 6,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: active ? `${accent}18` : "transparent",
              transition: "background .22s",
            }}>
              <i className={`pi ${t.icon}`} style={{
                fontSize: 11, color: active ? accent : C.muted, transition: "color .18s",
              }} />
            </span>
            <span>{t.label}</span>
            {t.badge != null && (() => {
              // Pick badge background — active tab wins (accent), otherwise
              // tone drives colour. Unknown tone → slate (back-compat with
              // older tab definitions that don't set badgeTone).
              const tone     = t.badgeTone;
              const toneBg   = BADGE_TONE_BG[tone] || "#cbd5e1";
              const bg       = active ? accent : toneBg;
              const isUrgent = tone === "urgent";
              return (
                <span
                  // aria-live so screen readers announce STAT/escalation
                  // transitions without the user having to focus the tab.
                  aria-live={isUrgent ? "polite" : undefined}
                  style={{
                    marginLeft: 2,
                    minWidth: 18, height: 18,
                    padding: "0 6px",
                    borderRadius: 999,
                    background: bg,
                    color: "#fff",
                    fontSize: 10, fontWeight: 800,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    lineHeight: 1,
                    transition: "background .25s ease",
                    // Soft pulsing ring for STAT / stuck work — only when
                    // the tab is NOT currently active (active state is
                    // already visually loud, don't double-up).
                    animation: isUrgent && !active
                      ? "adminBadgePulse 1.4s ease-in-out infinite"
                      : "none",
                  }}
                >{t.badge}</span>
              );
            })()}
          </button>
        );
      })}
    </div>
  );
}

// R7hr-276 — count-up a KPI value when it's purely numeric (counts); leave
// currency strings / "—" / composites untouched.
function _kpiValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return <AnimatedCounter value={value} />;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return <AnimatedCounter value={Number(value)} />;
  return value;
}
export function KPI({ label, value, color, icon }) {
  return (
    <div className="hga-lift" style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 4px 12px rgba(16,24,40,.07)", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: color + "12", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <i className={`pi ${icon}`} style={{ fontSize: 15, color }} />
      </div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{_kpiValue(value)}</div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginTop: 4 }}>{label}</div>
      </div>
    </div>
  );
}

export function Card({ title, color, icon, right, children, padding = 16 }) {
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 4px 12px rgba(16,24,40,.07)" }}>
      {(title || right) && (
        <div style={{ padding: "10px 16px", background: color + "08", borderBottom: `1px solid ${color}20`, display: "flex", alignItems: "center", gap: 8 }}>
          {icon && <i className={`pi ${icon}`} style={{ color, fontSize: 13 }} />}
          {title && <span style={{ fontWeight: 800, fontSize: 13, color, flex: 1 }}>{title}</span>}
          {right}
        </div>
      )}
      <div style={{ padding }}>{children}</div>
    </div>
  );
}

// Table accepts either string headers (legacy) or { label, align } objects
// (newer pages use these so they can right-align numeric columns). Passing
// a raw object as a child was a hard crash — "Objects are not valid as a
// React child" — encountered when DieticianConsole was opened in the
// browser on 13 May 2026.
// Table — supports TWO call styles so every caller is covered:
//   • <Table cols={[...]}>{rows as <tr>…}</Table>   (manual body)
//   • <Table headers={[...]} rows={[[cell,…],…]} />  (auto-rendered body)
// `cols`/`headers` are interchangeable and default to [] so a not-yet-loaded
// data set never crashes the header map (was: cols.map on undefined → white
// screen on /tax-returns, /tds-certificates and ~8 other report pages).
export function Table({ cols, headers, rows, children, compact }) {
  const columns = cols || headers || [];
  const cellPad = compact ? "7px 10px" : "9px 12px";
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "auto", boxShadow: "0 1px 2px rgba(16,24,40,.04), 0 4px 12px rgba(16,24,40,.07)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: compact ? 11.5 : 12 }}>
        <thead>
          <tr style={{ background: C.subtle, borderBottom: `1.5px solid ${C.border}` }}>
            {columns.map((c, i) => {
              const label = typeof c === "string" ? c : c?.label ?? "";
              const align = typeof c === "object" && c?.align ? c.align : "left";
              return (
                <th key={i} style={{ padding: cellPad, textAlign: align, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", fontSize: 10, whiteSpace: "nowrap" }}>{label}</th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {Array.isArray(rows)
            ? rows.map((r, ri) => (
                <tr key={ri} style={{ borderBottom: `1px solid ${C.border}` }}>
                  {(Array.isArray(r) ? r : [r]).map((cell, ci) => {
                    const col = columns[ci];
                    const align = typeof col === "object" && col?.align ? col.align : "left";
                    return <td key={ci} style={{ padding: cellPad, textAlign: align, color: C.text, verticalAlign: "middle" }}>{cell}</td>;
                  })}
                </tr>
              ))
            : children}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyRow({ span, text }) {
  return <tr><td colSpan={span} style={{ padding: "24px 16px", textAlign: "center", color: C.muted, fontSize: 12, fontStyle: "italic" }}>{text}</td></tr>;
}

// Empty — block-level empty-state. Use this OUTSIDE a <table> (EmptyRow
// only works inside a <tbody>; rendering it bare causes "tr cannot be a
// child of div" hydration errors).
export function Empty({ text, msg, icon = "pi-inbox" }) {
  return (
    <div style={{ padding: "24px 16px", textAlign: "center", color: C.muted, fontSize: 12.5, fontStyle: "italic" }}>
      <i className={`pi ${icon}`} style={{ fontSize: 24, color: C.border, display: "block", marginBottom: 8 }} />
      {text ?? msg}
    </div>
  );
}

export function RowAction({ icon, label, color, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} title={label}
      style={{ marginRight: 4, padding: "4px 10px", borderRadius: 5,
        border: `1px solid ${color}40`, background: "#fff", color, fontSize: 10.5,
        fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        display: "inline-flex", alignItems: "center", gap: 4 }}>
      <i className={`pi ${icon}`} style={{ fontSize: 10 }} />{label}
    </button>
  );
}

// Status badge — auto-coloured by "active"/"inactive" or any string.
const BADGE_PALETTE = {
  active:   { bg: C.greenL,  fg: "#15803d", bd: "#86efac" },
  inactive: { bg: C.redL,    fg: "#b91c1c", bd: "#fecaca" },
  pending:  { bg: C.amberL,  fg: "#b45309", bd: "#fcd34d" },
  approved: { bg: C.blueL,   fg: "#4338ca", bd: "#93c5fd" },
  rejected: { bg: C.redL,    fg: "#b91c1c", bd: "#fecaca" },
  opd:      { bg: C.blueL,   fg: "#4338ca", bd: "#93c5fd" },
  ipd:      { bg: C.amberL,  fg: "#b45309", bd: "#fcd34d" },
  emergency:{ bg: C.redL,    fg: "#b91c1c", bd: "#fecaca" },
  default:  { bg: C.subtle,  fg: C.muted,   bd: C.border },
};
export function Badge({ value, palette }) {
  const key = String(palette || value || "").toLowerCase();
  const p = BADGE_PALETTE[key] || BADGE_PALETTE.default;
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 4,
      background: p.bg, color: p.fg, border: `1px solid ${p.bd}`,
      fontSize: 10, fontWeight: 800, letterSpacing: ".3px", textTransform: "uppercase",
      whiteSpace: "nowrap",
    }}>{value}</span>
  );
}

// Modal — rendered via React portal at document.body to decouple it
// from the caller's render tree. This fixes the bed-visual blink bug:
// the BedVisualLayout listens to SSE bed events and refetches every
// 400ms-debounced; each refetch caused the bed-card subtree (where the
// inline modal lived) to re-render, which in turn could unmount the
// modal mid-interaction whenever a conditional ancestor (`{occ && pName
// && <RequestWardBoyButton />}`) flipped during the brief in-flight
// fetch window. With the portal, the modal lives at document.body and
// is unaffected by parent re-renders.
//
// Also: ESC key closes the modal, and body scroll is locked while open
// so the page underneath doesn't jiggle when the user scrolls inside
// the modal's content area.
export function Modal({ title, color = C.orange, onClose, onSubmit, submitting, submitLabel = "Save", children, hideFooter, size = 560, icon }) {
  // ESC-to-close + body scroll lock. Both effects run only while the
  // Modal is mounted, so multiple stacked modals each push/pop their
  // own listeners and restore overflow on cleanup.
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && typeof onClose === "function") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // SSR-safe portal target — `document` is undefined during SSR; fall
  // back to inline render in that environment.
  if (typeof document === "undefined") return null;

  const tree = (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: size, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(16,24,40,.30)", overflow: "hidden", animation: "modalIn .22s cubic-bezier(.34,1.4,.64,1)" }}>
        <div style={{ padding: "12px 18px", background: `linear-gradient(135deg, ${color}, ${color}cc)`, color: "#fff", display: "flex", alignItems: "center", gap: 10 }}>
          {icon && <i className={`pi ${icon}`} style={{ fontSize: 16 }} />}
          <div style={{ fontWeight: 800, fontSize: 15, flex: 1 }}>{title}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: "rgba(255,255,255,.18)", color: "#fff", cursor: "pointer" }}><i className="pi pi-times" /></button>
        </div>
        <div style={{ padding: "16px 18px", overflowY: "auto", flex: 1 }}>{children}</div>
        {!hideFooter && (
          <div style={{ padding: "10px 18px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} disabled={submitting} style={{ padding: "8px 16px", borderRadius: 7, border: `1.5px solid ${C.border}`, background: "#fff", color: C.muted, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Cancel</button>
            <button onClick={onSubmit} disabled={submitting} style={{ padding: "8px 20px", borderRadius: 7, border: "none", background: submitting ? "#94a3b8" : color, color: "#fff", fontWeight: 800, fontSize: 12, cursor: submitting ? "not-allowed" : "pointer" }}>{submitting ? "Saving…" : submitLabel}</button>
          </div>
        )}
      </div>
    </div>
  );
  return createPortal(tree, document.body);
}

export function Field({ label, required, children }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>
        {label}{required && <span style={{ color: C.red, marginLeft: 3 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

export function Check({ label, v, on }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, color: C.text }}>
      <input type="checkbox" checked={!!v} onChange={on}
        style={{ accentColor: C.orange, margin: 0, width: 15, height: 15 }} />
      {label}
    </label>
  );
}

// Convenience: search input pre-styled to the his-field look.
export function SearchInput({ value, onChange, placeholder = "Search…", width = 240 }) {
  return (
    <div style={{ position: "relative", width }}>
      <i className="pi pi-search" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 11 }} />
      <input className="his-field" value={value} onChange={onChange}
        placeholder={placeholder}
        style={{ paddingLeft: 30, width: "100%" }} />
    </div>
  );
}

// Primary button matching the modal's submit pill.
export function PrimaryButton({ label, icon, onClick, color = C.orange, disabled, busy }) {
  return (
    <button onClick={onClick} disabled={disabled || busy}
      style={{ padding: "9px 18px", borderRadius: 8, border: "none",
        background: busy ? "#94a3b8" : color, color: "#fff",
        fontWeight: 800, fontSize: 12.5, cursor: disabled || busy ? "not-allowed" : "pointer",
        display: "inline-flex", alignItems: "center", gap: 7,
        boxShadow: `0 2px 8px ${color}30`,
      }}>
      {icon && <i className={`pi ${icon}`} style={{ fontSize: 12 }} />}
      {busy ? "Working…" : label}
    </button>
  );
}

// Image upload box with thumbnail preview + remove button.
// Returns a base64 data URL via onChange.
export function ImageUpload({ label, value, onChange, hint, maxKB = 500, width = 160, height = 100 }) {
  const id = React.useId();
  const handle = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > maxKB * 1024) { alert(`Image must be under ${maxKB} KB`); return; }
    const reader = new FileReader();
    reader.onload = (ev) => onChange(ev.target.result);
    reader.readAsDataURL(f);
  };
  return (
    <div>
      {label && <div style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 5 }}>{label}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ width, height, border: `2px dashed ${C.border}`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: C.subtle, overflow: "hidden", flexShrink: 0 }}>
          {value
            ? <img src={value} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
            : <span style={{ fontSize: 10.5, color: C.muted, textAlign: "center" }}>No image</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 140 }}>
          <input type="file" accept="image/*" onChange={handle} id={id} style={{ display: "none" }} />
          <label htmlFor={id} style={{ padding: "6px 12px", borderRadius: 6, border: `1.5px solid ${C.blue}`, background: "#fff", color: C.blue, fontSize: 11.5, fontWeight: 700, cursor: "pointer", textAlign: "center" }}>
            <i className="pi pi-upload" style={{ marginRight: 5, fontSize: 10 }} /> Upload
          </label>
          {value && (
            <button onClick={() => onChange("")} style={{ padding: "6px 12px", borderRadius: 6, border: `1.5px solid ${C.red}`, background: "#fff", color: C.red, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
              <i className="pi pi-trash" style={{ marginRight: 5, fontSize: 10 }} /> Remove
            </button>
          )}
          {hint && <span style={{ fontSize: 10, color: C.muted }}>{hint}</span>}
        </div>
      </div>
    </div>
  );
}

// Sub-card inside a Card for grouping related fields.
export function SubCard({ title, color = C.muted, icon, children, hint }) {
  return (
    <div style={{ padding: "12px 14px", background: C.subtle, border: `1.5px solid ${C.border}`, borderRadius: 9 }}>
      {(title || hint) && (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          {title && (
            <div style={{ fontSize: 11, fontWeight: 800, color, textTransform: "uppercase", letterSpacing: ".5px", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {icon && <i className={`pi ${icon}`} style={{ fontSize: 11 }} />}
              {title}
            </div>
          )}
          {hint && <span style={{ fontSize: 10.5, color: C.muted, fontWeight: 600 }}>{hint}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

const ADMIN_THEME = {
  C, AdminPage, Hero, TabStrip, KPI, Card, Table, EmptyRow, RowAction,
  Badge, Modal, Field, Check, SearchInput, PrimaryButton, ImageUpload, SubCard,
};
export default ADMIN_THEME;
