import React from "react";

/**
 * PickPatientPrompt.jsx
 * Friendly empty-state for a clinical page's content area when no patient
 * is selected yet. Instead of dead-ending with a "go to patient list" link,
 * it points the user at the AdmittedPatientPanel picker on the left so the
 * page is productive the moment they land on it.
 */
export default function PickPatientPrompt({
  icon = "pi-user",
  title = "Select a patient",
  lines = [],
}) {
  return (
    <div
      style={{
        height: "100%",
        minHeight: 380,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "40px 24px",
        fontFamily: "'DM Sans',sans-serif",
      }}
    >
      <div
        style={{
          width: 66,
          height: 66,
          borderRadius: 18,
          background: "linear-gradient(135deg,#eef2ff,#e0e7ff)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 18,
          boxShadow: "0 10px 28px rgba(79,70,229,.18)",
        }}
      >
        <i className={`pi ${icon}`} style={{ fontSize: 27, color: "#4f46e5" }} />
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ fontSize: 13.5, color: "#64748b", lineHeight: 1.6, maxWidth: 400 }}>
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <div
        style={{
          marginTop: 22,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 17px",
          borderRadius: 999,
          background: "#eef2ff",
          border: "1.5px solid #c7d2fe",
          color: "#4338ca",
          fontSize: 12.5,
          fontWeight: 700,
        }}
      >
        <i className="pi pi-arrow-left" style={{ fontSize: 12 }} />
        Pick a patient from the list on the left
      </div>
    </div>
  );
}
