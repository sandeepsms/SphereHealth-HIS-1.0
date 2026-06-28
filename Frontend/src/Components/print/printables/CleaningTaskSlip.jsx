// Components/print/printables/CleaningTaskSlip.jsx
// Housekeeping cleaning-task slip — printed when a discrete clean
// (routine, terminal, spillage response, isolation prep, discharge
// turnaround) is dispatched to the housekeeping staff and completed.
//
// Maps to NABH HIC.6 (infection control — environmental cleaning)
// requirement of a traceable per-task record for terminal cleans
// and isolation-room turnover.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const TYPE_BADGE = {
  routine:           { color: "#3730a3", bg: "#e0e7ff", border: "#93c5fd" },
  terminal:          { color: "#7f1d1d", bg: "#fee2e2", border: "#fca5a5" },
  spillage:          { color: "#78350f", bg: "#fef3c7", border: "#fde68a" },
  "isolation-prep":  { color: "#581c87", bg: "#ede9fe", border: "#c4b5fd" },
  "discharge-clean": { color: "#14532d", bg: "#dcfce7", border: "#86efac" },
};

const CleaningTaskSlip = ({ settings, receipt = {} }) => {
  const r = receipt;
  const type = r.cleaningType || r.taskType || "routine";
  const badge = TYPE_BADGE[type] || TYPE_BADGE.routine;
  const isTerminal = type === "terminal" || type === "isolation-prep";

  return (
    <PrintShell
      settings={settings}
      documentTitle="Housekeeping Cleaning Task Slip"
      serialNo={r.taskNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Task #",       value: r.taskNo },
        { label: "Area",         value: r.area },
        { label: "Type",         value: type },
        { label: "Priority",     value: r.priority || "Routine" },
        { label: "Requested By", value: r.requestedBy },
        { label: "Completed At", value: fmtDateTime(r.completedAt) },
      ]}
      showBank={false}
      signatureLabels={["Housekeeper", "Supervisor (HIC sign-off)"]}
    >
      {/* Type chip */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{
          display: "inline-block",
          padding: "4px 12px", borderRadius: 999,
          background: badge.bg, color: badge.color,
          border: `1.5px solid ${badge.border}`,
          fontSize: 11, fontWeight: 800,
          textTransform: "uppercase", letterSpacing: ".5px",
        }}>
          {type}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
          {r.area || "—"}
        </span>
      </div>

      {/* Workflow timeline */}
      <div className="pr-section">
        <div className="pr-section__title">Workflow</div>
        <div className="pr-section__body" style={{ fontSize: 11.5 }}>
          <div><strong>Requested:</strong> {fmtDateTime(r.requestedAt)} — by {r.requestedBy || "—"}</div>
          <div><strong>Claimed:</strong> {fmtDateTime(r.claimedAt)} — by {r.claimedBy || "—"}</div>
          <div><strong>Started:</strong> {fmtDateTime(r.startedAt)}</div>
          <div><strong>Completed:</strong> {fmtDateTime(r.completedAt)}</div>
          {r.verifiedAt && (
            <div><strong>Verified:</strong> {fmtDateTime(r.verifiedAt)} — by {r.verifiedBy || "—"}</div>
          )}
        </div>
      </div>

      {/* Products & protocol */}
      <div className="pr-section">
        <div className="pr-section__title">Products &amp; Protocol</div>
        <table className="pr-table" style={{ fontSize: 11.5 }}>
          <tbody>
            <tr>
              <td style={{ width: "30%", fontWeight: 700 }}>Products Used</td>
              <td>{Array.isArray(r.productsUsed) ? r.productsUsed.join(", ") : (r.productsUsed || "—")}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Disinfectant + Dilution</td>
              <td>{[r.disinfectant, r.dilution].filter(Boolean).join(" · ") || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Contact Time</td>
              <td>{r.contactTime || "—"}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Protocol</td>
              <td>{r.protocolFollowed || (isTerminal ? "HIC SOP-04 Terminal Clean" : "HIC SOP-01 Routine Clean")}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>PPE Used</td>
              <td>{Array.isArray(r.ppe) ? r.ppe.join(", ") : (r.ppe || "Gloves, mask, apron")}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {r.remarks && (
        <div className="pr-section">
          <div className="pr-section__title">Remarks</div>
          <div className="pr-section__body" style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }}>
            {r.remarks}
          </div>
        </div>
      )}

      {isTerminal && (
        <div style={{
          marginTop: 8, padding: "10px 12px",
          background: "#fef2f2", border: "1.5px solid #fca5a5",
          borderRadius: 8, fontSize: 11, color: "#7f1d1d",
        }}>
          <strong>NABH HIC.6 — Terminal-Clean Attestation:</strong> I certify that
          this area was cleaned and disinfected per the hospital's terminal-clean
          protocol prior to next admission / use. Contact times observed; high-touch
          surfaces, bed-frame, mattress cover, monitor handles, and toilet
          fixtures were treated. Bed-bug / fomite check completed.
        </div>
      )}
    </PrintShell>
  );
};

export default CleaningTaskSlip;
