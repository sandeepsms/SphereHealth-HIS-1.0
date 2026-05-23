// Components/print/printables/AdverseFoodReactionPrint.jsx
// R7bm-F7 — Adverse Food Reaction report (NABH COP.21 + JCI FMS).
// Captures the patient, suspect meal item / allergen, severity grade,
// onset window, action taken, and outcome. Links back to the source
// KitchenIndent (if any) and to the linked clinical note that
// recorded the doctor's response.
//
// Used by dietitian / treating doctor / quality lead during regulator
// review of food-allergy adverse events.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", {
  day: "2-digit", month: "short", year: "numeric",
}) : "—";

const SEVERITY = {
  MILD:        { color: "#14532d", bg: "#dcfce7", border: "#86efac", label: "MILD" },
  MODERATE:    { color: "#78350f", bg: "#fef3c7", border: "#fde68a", label: "MODERATE" },
  SEVERE:      { color: "#9a3412", bg: "#ffedd5", border: "#fdba74", label: "SEVERE" },
  ANAPHYLAXIS: { color: "#7f1d1d", bg: "#fee2e2", border: "#fca5a5", label: "ANAPHYLAXIS" },
};

const STATUS_TONE = {
  OPEN:      { color: "#9a3412", bg: "#ffedd5", border: "#fdba74" },
  ESCALATED: { color: "#7f1d1d", bg: "#fee2e2", border: "#fca5a5" },
  CLOSED:    { color: "#14532d", bg: "#dcfce7", border: "#86efac" },
};

const AdverseFoodReactionPrint = ({ settings, receipt = {} }) => {
  const r = receipt;
  const sev = SEVERITY[r.severity] || SEVERITY.MODERATE;
  const stat = STATUS_TONE[r.status] || STATUS_TONE.OPEN;
  const audit = Array.isArray(r.auditTrail) ? r.auditTrail : [];

  return (
    <PrintShell
      settings={settings}
      documentTitle="Adverse Food Reaction Report"
      serialNo={r._id || r.reportId || r.id}
      printCount={toNum(r.printCount)}
      watermarkLabel="COP.21 — FOOD ADR"
      infoItems={[
        { label: "Patient UHID", value: r.patientUHID },
        { label: "Patient",      value: r.patientName },
        { label: "Reported At",  value: fmtDateTime(r.reportedAt) },
        { label: "Reported By",  value: r.reportedByName },
        { label: "Severity",     value: sev.label },
        { label: "Status",       value: r.status },
      ]}
      signatureLabels={["Dietitian / Nutritionist", "Treating Doctor"]}
    >
      {/* Severity banner */}
      <div style={{
        background: sev.bg, border: `2px solid ${sev.border}`,
        borderRadius: 8, padding: "12px 16px", marginBottom: 14,
      }}>
        <div style={{ fontSize: 10, color: sev.color, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 800 }}>
          Adverse Food Reaction
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, color: sev.color, lineHeight: 1, marginTop: 4 }}>
          {sev.label}
          <span style={{ fontSize: 12, marginLeft: 12, fontWeight: 700 }}>
            · Status: <span style={{ color: stat.color }}>{r.status || "OPEN"}</span>
          </span>
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: sev.color }}>
          {r.patientName || "—"} <span style={{ fontFamily: "'DM Mono', monospace" }}>({r.patientUHID || "—"})</span>
          {r.onsetMinutesAfterMeal != null && (
            <> · Onset {r.onsetMinutesAfterMeal} min after meal</>
          )}
        </div>
      </div>

      {/* Suspect meal */}
      <div className="pr-section">
        <div className="pr-section__title">Suspect Meal / Allergen</div>
        <table className="pr-table" style={{ fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={{ width: "25%", fontWeight: 700 }}>Meal Item</td>
              <td>{r.mealItem || "—"}</td>
              <td style={{ width: "25%", fontWeight: 700 }}>Suspected Allergen</td>
              <td>{r.suspectedAllergen || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Kitchen Indent #</td>
              <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 10.5 }}>{r.kitchenIndentNumber || r.kitchenIndentId || "—"}</td>
              <td style={{ fontWeight: 700 }}>Onset (min after meal)</td>
              <td>{r.onsetMinutesAfterMeal == null ? "—" : `${r.onsetMinutesAfterMeal} min`}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Reaction details */}
      <div className="pr-section">
        <div className="pr-section__title">Reaction Symptoms &amp; Description</div>
        <div className="pr-section__body" style={{ fontSize: 11.5, whiteSpace: "pre-wrap", lineHeight: 1.5, textAlign: "justify" }}>
          {r.reactionDescription || "—"}
        </div>
      </div>

      {/* Action taken */}
      <div className="pr-section">
        <div className="pr-section__title">Action Taken</div>
        <div className="pr-section__body" style={{ fontSize: 11.5, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
          {r.actionTaken || "—"}
        </div>
      </div>

      {/* Outcome */}
      <div className="pr-section">
        <div className="pr-section__title">Outcome / Resolution</div>
        <table className="pr-table" style={{ fontSize: 11 }}>
          <tbody>
            <tr>
              <td style={{ width: "25%", fontWeight: 700 }}>Outcome</td>
              <td>{r.outcome || "—"}</td>
              <td style={{ width: "25%", fontWeight: 700 }}>Linked Clinical Note</td>
              <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 10 }}>{r.linkedClinicalNote || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Reported By</td>
              <td>{r.reportedByName || "—"} ({r.reportedByRole || "—"})</td>
              <td style={{ fontWeight: 700 }}>Reported At</td>
              <td>{fmtDateTime(r.reportedAt)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Audit trail (append-only — regulator-grade) */}
      {audit.length > 0 && (
        <div className="pr-section">
          <div className="pr-section__title">Audit Trail</div>
          <table className="pr-table" style={{ fontSize: 10 }}>
            <thead>
              <tr>
                <th style={{ width: 140 }}>Timestamp</th>
                <th style={{ width: 110 }}>Action</th>
                <th style={{ width: 140 }}>By</th>
                <th>Reason / Note</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a, i) => (
                <tr key={i} style={{ pageBreakInside: "avoid" }}>
                  <td>{fmtDateTime(a.at)}</td>
                  <td><strong>{a.action || "—"}</strong></td>
                  <td>{a.byName || "—"}{a.byRole ? ` (${a.byRole})` : ""}</td>
                  <td style={{ fontSize: 9.5 }}>{a.reason || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{
        marginTop: 8, padding: "10px 12px",
        background: "#fef9c3", border: "1.5px solid #facc15",
        borderRadius: 8, fontSize: 10.5, color: "#713f12",
      }}>
        <strong>NABH COP.21 + JCI FMS:</strong> Adverse food reactions must be
        recorded with severity grading, action taken, and clinical outcome.
        The KitchenIndent linkage (where present) supports closed-loop traceback
        to the source tray and any cohort-impact follow-up. Retention per
        hospital MRD policy.
      </div>
    </PrintShell>
  );
};

export default AdverseFoodReactionPrint;
