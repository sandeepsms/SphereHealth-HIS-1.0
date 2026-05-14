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

export const C = {
  bg: "#f8fafc", card: "#fff", border: "#e2e8f0",
  text: "#0f172a", muted: "#64748b", subtle: "#f8fafc",
  amber: "#d97706", amberL: "#fffbeb",
  blue: "#1d4ed8", blueL: "#eff6ff",
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
  blue:   ["#1d4ed8", "#1e40af"],
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

export function Hero({ icon, title, subtitle, color = "orange", right }) {
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
        background: "rgba(255,255,255,.18)", border: "1.5px solid rgba(255,255,255,.32)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <i className={`pi ${icon}`} style={{ fontSize: 22 }} />
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
export function TabStrip({ tabs, value, onChange, accent = C.orange, accentL = C.orangeL }) {
  return (
    <div style={{
      background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
      padding: 6, marginBottom: 14, display: "flex", gap: 4, overflowX: "auto",
    }}>
      {tabs.map(t => {
        const active = value === t.key;
        return (
          <button key={t.key} onClick={() => onChange(t.key)}
            style={{
              padding: "9px 16px", borderRadius: 8, border: "none",
              background: active ? accentL : "transparent",
              color:      active ? accent  : C.muted,
              fontWeight: 700, fontSize: 12.5, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 7,
              whiteSpace: "nowrap",
              borderBottom: active ? `2px solid ${accent}` : "2px solid transparent",
              transition: "all .12s",
            }}>
            <i className={`pi ${t.icon}`} style={{ fontSize: 11 }} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function KPI({ label, value, color, icon }) {
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 3px rgba(15,23,42,.04)", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: color + "12", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <i className={`pi ${icon}`} style={{ fontSize: 15, color }} />
      </div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", marginTop: 4 }}>{label}</div>
      </div>
    </div>
  );
}

export function Card({ title, color, icon, right, children, padding = 16 }) {
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(15,23,42,.04)" }}>
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

export function Table({ cols, children, compact }) {
  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "auto", boxShadow: "0 1px 3px rgba(15,23,42,.04)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: compact ? 11.5 : 12 }}>
        <thead>
          <tr style={{ background: C.subtle, borderBottom: `1.5px solid ${C.border}` }}>
            {cols.map((c, i) => (
              <th key={i} style={{ padding: compact ? "7px 10px" : "9px 12px", textAlign: "left", fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: ".5px", fontSize: 10, whiteSpace: "nowrap" }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyRow({ span, text }) {
  return <tr><td colSpan={span} style={{ padding: "24px 16px", textAlign: "center", color: C.muted, fontSize: 12, fontStyle: "italic" }}>{text}</td></tr>;
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
  approved: { bg: C.blueL,   fg: "#1e40af", bd: "#93c5fd" },
  rejected: { bg: C.redL,    fg: "#b91c1c", bd: "#fecaca" },
  opd:      { bg: C.blueL,   fg: "#1e40af", bd: "#93c5fd" },
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

export function Modal({ title, color = C.orange, onClose, onSubmit, submitting, submitLabel = "Save", children, hideFooter, size = 560, icon }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, width: size, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 50px rgba(0,0,0,.25)", overflow: "hidden" }}>
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
