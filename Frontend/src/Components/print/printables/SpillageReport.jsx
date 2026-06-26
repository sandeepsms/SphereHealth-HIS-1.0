// Components/print/printables/SpillageReport.jsx
// Spillage incident response report — printed when blood / body
// fluid / chemical / cytotoxic spillage is contained and cleaned.
// Mandated under NABH HIC.6 and applicable Bio-Medical Waste rules
// (BMW Rules 2016, Schedule II); the report is filed in the
// infection-control register and copied to the incident system.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const TYPE_BADGE = {
  blood:       { color: "#7f1d1d", bg: "#fee2e2", border: "#fca5a5", label: "BLOOD" },
  "body-fluid":{ color: "#78350f", bg: "#fef3c7", border: "#fde68a", label: "BODY FLUID" },
  chemical:    { color: "#581c87", bg: "#ede9fe", border: "#c4b5fd", label: "CHEMICAL" },
  cytotoxic:   { color: "#831843", bg: "#fce7f3", border: "#f9a8d4", label: "CYTOTOXIC" },
  mercury:     { color: "#3730a3", bg: "#e0e7ff", border: "#93c5fd", label: "MERCURY" },
};

const SEVERITY = {
  minor:    { color: "#14532d", bg: "#dcfce7", border: "#86efac" },
  moderate: { color: "#78350f", bg: "#fef3c7", border: "#fde68a" },
  major:    { color: "#7f1d1d", bg: "#fee2e2", border: "#fca5a5" },
};

const SpillageReport = ({ settings, receipt = {} }) => {
  const r = receipt;
  const type = r.spillType || "blood";
  const typeBadge = TYPE_BADGE[type] || TYPE_BADGE.blood;
  const sev = r.severity || "moderate";
  const sevBadge = SEVERITY[sev] || SEVERITY.moderate;

  return (
    <PrintShell
      settings={settings}
      documentTitle="Spillage Incident Report"
      serialNo={r.incidentNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Incident #",   value: r.incidentNo },
        { label: "Location",     value: r.location },
        { label: "Type",         value: typeBadge.label },
        { label: "Severity",     value: sev },
        { label: "Reported By",  value: r.reportedBy },
        { label: "Reported At",  value: fmtDateTime(r.reportedAt) },
      ]}
      showBank={false}
      signatureLabels={["Cleaner / Responder", "HIC Witness"]}
    >
      {/* Chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{
          padding: "4px 12px", borderRadius: 999,
          background: typeBadge.bg, color: typeBadge.color,
          border: `1.5px solid ${typeBadge.border}`,
          fontSize: 11, fontWeight: 800,
          textTransform: "uppercase", letterSpacing: ".5px",
        }}>{typeBadge.label} SPILL</span>
        <span style={{
          padding: "4px 12px", borderRadius: 999,
          background: sevBadge.bg, color: sevBadge.color,
          border: `1.5px solid ${sevBadge.border}`,
          fontSize: 11, fontWeight: 800,
          textTransform: "uppercase", letterSpacing: ".5px",
        }}>Severity: {sev}</span>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Incident</div>
        <div className="pr-section__body" style={{ fontSize: 11.5 }}>
          <div><strong>Location:</strong> {r.location || "—"}</div>
          <div><strong>Occurred At:</strong> {fmtDateTime(r.occurredAt || r.reportedAt)}</div>
          <div><strong>Approx. Volume:</strong> {r.volume || "—"}</div>
          <div><strong>Patient / Source (if known):</strong> {r.source || "—"}</div>
          {r.description && (
            <div style={{ marginTop: 6 }}>
              <strong>Description:</strong> {r.description}
            </div>
          )}
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Containment &amp; Cleanup Timeline</div>
        <table className="pr-table" style={{ fontSize: 11.5 }}>
          <tbody>
            <tr>
              <td style={{ width: "30%", fontWeight: 700 }}>Reported</td>
              <td>{fmtDateTime(r.reportedAt)} — {r.reportedBy || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Contained</td>
              <td>{fmtDateTime(r.containedAt)} — {r.containedBy || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Cleaned</td>
              <td>{fmtDateTime(r.cleanedAt)} — {r.cleanedBy || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Area Released</td>
              <td>{fmtDateTime(r.releasedAt)} — {r.releasedBy || "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Products &amp; PPE Used</div>
        <div className="pr-section__body" style={{ fontSize: 11.5 }}>
          <div><strong>Spill kit:</strong> {r.spillKitUsed || "Standard biohazard spill kit"}</div>
          <div><strong>Disinfectant:</strong> {r.disinfectant || "1% Sodium Hypochlorite"}
            {r.dilution && <> · <strong>Dilution:</strong> {r.dilution}</>}
            {r.contactTime && <> · <strong>Contact:</strong> {r.contactTime}</>}
          </div>
          <div><strong>PPE:</strong> {Array.isArray(r.ppe) ? r.ppe.join(", ") : (r.ppe || "Gloves, mask, apron, eye-shield, shoe covers")}</div>
          <div><strong>Waste category:</strong> {r.wasteCategory || "Yellow (infectious)"}</div>
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section__title">Escalation &amp; Follow-up</div>
        <div className="pr-section__body" style={{ fontSize: 11.5 }}>
          <div>
            <strong>Infection Control informed:</strong>{" "}
            {r.reportedToInfectionControl ? "YES" : "NO"}
            {r.icoName && <> — {r.icoName}</>}
          </div>
          <div>
            <strong>Staff exposure reported:</strong>{" "}
            {r.staffExposure ? "YES (PEP workflow triggered)" : "NO"}
          </div>
          <div><strong>Follow-up action:</strong> {r.followUpAction || "—"}</div>
          <div><strong>Reviewed by:</strong> {r.reviewedBy || "—"}</div>
        </div>
      </div>

      <div style={{
        marginTop: 8, padding: "10px 12px",
        background: "#fef2f2", border: "1.5px solid #fca5a5",
        borderRadius: 8, fontSize: 11, color: "#7f1d1d",
      }}>
        <strong>NABH HIC.6 / BMW Rules 2016 Schedule II:</strong> Spillage of blood
        and body fluids must be contained and disinfected by trained staff using
        the standard spill kit. Waste segregated to the appropriate colour bag.
        Any staff exposure triggers the PEP / source-evaluation workflow.
      </div>
    </PrintShell>
  );
};

export default SpillageReport;
