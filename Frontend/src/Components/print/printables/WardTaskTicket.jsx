// Components/print/printables/WardTaskTicket.jsx
// Ward Boy / orderly task work-order. Issued by the requesting unit
// (nurse-in-charge / ward clerk) and carried by the ward boy to the
// destination; signed at both ends so the chain-of-custody is
// auditable for NABH FMS / HRM and for the daily ward-boy log.
//
// Task types: transport (patient / equipment / sample / documents),
// errand (pharmacy pickup, central-store run), generic.

import React from "react";
import PrintShell from "../PrintShell";
import { toNum } from "../../../utils/printUtils";

const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-IN", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}) : "—";

const PRIORITY_STYLE = {
  STAT:    { bg: "#fee2e2", color: "#7f1d1d", border: "#fca5a5" },
  Urgent:  { bg: "#fef3c7", color: "#78350f", border: "#fde68a" },
  Routine: { bg: "#dcfce7", color: "#14532d", border: "#86efac" },
};

const WardTaskTicket = ({ settings, receipt = {} }) => {
  const r = receipt;
  const priority = r.priority || "Routine";
  const pStyle = PRIORITY_STYLE[priority] || PRIORITY_STYLE.Routine;

  return (
    <PrintShell
      settings={settings}
      documentTitle="Ward Task Ticket"
      serialNo={r.taskNo}
      printCount={toNum(r.printCount)}
      infoItems={[
        { label: "Task #",        value: r.taskNo },
        { label: "Type",          value: r.taskType },
        { label: "Requested By",  value: r.requestedBy },
        { label: "Requested At",  value: fmtDateTime(r.requestedAt) },
        { label: "Assigned To",   value: r.assignedTo },
        { label: "Accepted At",   value: fmtDateTime(r.acceptedAt) },
      ]}
      showBank={false}
      signatureLabels={["Requester", "Ward Boy / Orderly"]}
    >
      {/* Priority chip + task type */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{
          display: "inline-block",
          padding: "4px 12px",
          borderRadius: 999,
          background: pStyle.bg,
          color: pStyle.color,
          border: `1.5px solid ${pStyle.border}`,
          fontSize: 11, fontWeight: 800,
          textTransform: "uppercase", letterSpacing: ".5px",
        }}>
          {priority}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
          {r.taskType || "General"}
        </span>
      </div>

      {/* From → To */}
      <div className="pr-section">
        <div className="pr-section__title">Movement</div>
        <div className="pr-section__body" style={{ fontSize: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center" }}>
            <div style={{ textAlign: "center", padding: 8, border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc" }}>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>From</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{r.fromLocation || "—"}</div>
            </div>
            <div style={{ fontSize: 20, color: "#1d4ed8" }}>→</div>
            <div style={{ textAlign: "center", padding: 8, border: "1px solid #e2e8f0", borderRadius: 6, background: "#f8fafc" }}>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: ".5px" }}>To</div>
              <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{r.toLocation || "—"}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Patient context, only when this is a patient transport */}
      {(r.uhid || r.patientName) && (
        <div className="pr-section">
          <div className="pr-section__title">Patient</div>
          <div className="pr-section__body" style={{ fontSize: 12 }}>
            <div><strong>Name:</strong> {r.patientName || "—"}</div>
            <div><strong>UHID:</strong> {r.uhid || "—"}</div>
            {r.bedNumber && <div><strong>Bed / Ward:</strong> {[r.bedNumber, r.wardName].filter(Boolean).join(" · ")}</div>}
            {r.diagnosis && <div><strong>Notes:</strong> {r.diagnosis}</div>}
          </div>
        </div>
      )}

      {r.notes && (
        <div className="pr-section">
          <div className="pr-section__title">Task Notes</div>
          <div className="pr-section__body" style={{ fontSize: 11.5, whiteSpace: "pre-wrap" }}>
            {r.notes}
          </div>
        </div>
      )}

      {/* Completion block */}
      <div className="pr-section">
        <div className="pr-section__title">Completion</div>
        <div className="pr-section__body" style={{ fontSize: 11 }}>
          <div><strong>Completed At:</strong> {fmtDateTime(r.completedAt) || "—"}</div>
          <div><strong>Received By:</strong> {r.receivedBy || "—"}</div>
          {r.completionRemarks && <div><strong>Remarks:</strong> {r.completionRemarks}</div>}
        </div>
      </div>

      <div style={{
        marginTop: 10, padding: "8px 12px", border: "1px dashed #cbd5e1",
        borderRadius: 6, background: "#f8fafc", fontSize: 10, color: "#475569",
      }}>
        <strong>NABH FMS / HRM:</strong> This work-ticket forms part of the ward-boy daily
        log. Retain in the ward register for at least 90 days. Disputed transfers are
        investigated under the IMS.5 incident workflow.
      </div>
    </PrintShell>
  );
};

export default WardTaskTicket;
