/**
 * FieldLabel — replacement for the duplicated <FL> helpers
 * across Doctor/Nursing pages. Pure className (no inline style).
 *
 * Usage:
 *   <FieldLabel label="Pulse">
 *     <input className="his-field" type="number" />
 *   </FieldLabel>
 *
 *   <FieldLabel label="Notes" span={2}>
 *     <textarea className="his-textarea" />
 *   </FieldLabel>
 */
import React from "react";
import "./clinical-forms.css";

export default function FieldLabel({ label, children, span, className = "" }) {
  return (
    <div
      className={`his-field-group ${className}`}
      style={span ? { gridColumn: `span ${span}` } : undefined}
    >
      {label && <label className="his-label">{label}</label>}
      {children}
    </div>
  );
}
