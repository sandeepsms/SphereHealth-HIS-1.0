// Components/print/printables/claimBits.jsx
// R7hr(CLAIM-P3) — shared claim-form primitives, used by every claim
// printable (IRDAI Part A/B, Pre-Auth, CGHS-MRC, ESIC, docket).
//
//   • Fill (P3.2) — a field the system genuinely can't know (the patient's
//     bank account, occupation, IFSC, referral no…). Rendered as a typeable
//     input so staff fill it ON-SCREEN in the print preview and hit Print —
//     the typed value prints. No more hand-writing on every claim.
//   • dxText / DiagnosisTable (P3.1) — ICD-10 coded diagnosis, sourced from
//     the discharge summary via claimFormService.buildClaimData.
import React from "react";

// Typeable blank-field. The parent cell carries the dashed underline; this
// input sits transparently on it. Uncontrolled (defaultValue) so the DOM
// holds whatever the user types and window.print() captures it.
export const Fill = ({ value = "", ph = "" }) => (
  <input
    className="claim-fill"
    defaultValue={value || ""}
    placeholder={ph}
    style={{
      width: "100%", boxSizing: "border-box", border: "none",
      background: "transparent", font: "inherit", fontWeight: 600,
      color: "#0f172a", padding: 0, outline: "none",
    }}
  />
);

// Compact one-line diagnosis: "J18.9 — Pneumonia  (+ HTN; DM)".
export function dxText(a = {}) {
  const dx = Array.isArray(a.diagnoses) ? a.diagnoses.filter((d) => d && (d.code || d.description)) : [];
  if (dx.length) {
    const primary = dx.find((d) => d.type === "Primary") || dx[0];
    const head = [primary.code, primary.description].filter(Boolean).join(" — ");
    const rest = dx.filter((d) => d !== primary)
      .map((d) => [d.code, d.description].filter(Boolean).join(" ")).filter(Boolean);
    return rest.length ? `${head}  (+ ${rest.join("; ")})` : head;
  }
  const code = a.icdCode ? `${a.icdCode} — ` : "";
  return (code + (a.finalDiagnosis || a.provisionalDiagnosis || "")) || "";
}

// Full coded diagnosis table (used on the hospital Part B). Renders nothing
// when there are no coded diagnoses, so it is safe to drop in unconditionally.
export function DiagnosisTable({ diagnoses = [] }) {
  const rows = (diagnoses || []).filter((d) => d && (d.code || d.description));
  if (!rows.length) return null;
  return (
    <table className="pr-table" style={{ fontSize: 10.5, marginTop: 4 }}>
      <thead><tr><th style={{ width: 80 }}>Type</th><th style={{ width: 90 }}>ICD-10</th><th>Diagnosis</th></tr></thead>
      <tbody>
        {rows.map((d, i) => (
          <tr key={i}><td>{d.type || "—"}</td><td>{d.code || "—"}</td><td>{d.description || "—"}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
