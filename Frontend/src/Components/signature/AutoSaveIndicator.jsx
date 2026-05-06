/**
 * AutoSaveIndicator.jsx
 * Small inline badge showing auto-save status.
 *
 * Props:
 *   savedAt : Date | null
 *   hasDraft: boolean
 */
import React from "react";

function fmt(date) {
  if (!date) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function AutoSaveIndicator({ savedAt, hasDraft }) {
  if (!hasDraft && !savedAt) return null;

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: savedAt ? "#f0fdf4" : "#fefce8",
      border: `1px solid ${savedAt ? "#bbf7d0" : "#fde68a"}`,
      borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 600,
      color: savedAt ? "#15803d" : "#92400e",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: savedAt ? "#16a34a" : "#d97706",
        animation: savedAt ? "none" : "pulse 1.5s infinite",
      }} />
      {savedAt ? `Draft saved ${fmt(savedAt)}` : "Saving draft…"}
    </span>
  );
}
